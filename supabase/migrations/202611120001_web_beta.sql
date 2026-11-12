-- Apply with the Supabase SQL editor/CLI. Service role is backend-only.
create table if not exists public.feature_configuration (
 environment text primary key,
 version bigint not null default 0,
 overrides jsonb not null default '{}',
 updated_by uuid,
 updated_at timestamptz not null default now()
);
create table if not exists public.feature_audit (
 id bigint generated always as identity primary key,
 environment text not null, version bigint not null,
 overrides jsonb not null, updated_by uuid not null,
 updated_at timestamptz not null default now()
);
create table if not exists public.workspace_resources (
 user_id uuid not null references auth.users(id) on delete cascade,
 namespace text not null, resource_key text not null,
 revision bigint not null default 1,
 value jsonb, deleted boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(user_id, namespace, resource_key)
);
create table if not exists public.provider_credentials (
 user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null, ciphertext text not null,
 updated_at timestamptz not null default now(), primary key(user_id, provider)
);
create table if not exists public.attachments (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 object_key text not null unique, filename text not null,
 content_type text not null, bytes bigint not null check(bytes > 0),
 state text not null check(state in ('pending','ready','deleting')),
 created_at timestamptz not null default now()
);
alter table public.feature_configuration enable row level security;
alter table public.feature_audit enable row level security;
alter table public.workspace_resources enable row level security;
alter table public.provider_credentials enable row level security;
alter table public.attachments enable row level security;
-- No public table access: every operation passes authenticated backend gates.
revoke all on public.feature_configuration, public.feature_audit, public.workspace_resources,
 public.provider_credentials, public.attachments from anon, authenticated;
grant all on public.feature_configuration, public.feature_audit, public.workspace_resources,
 public.provider_credentials, public.attachments to service_role;
grant usage, select on sequence public.feature_audit_id_seq to service_role;

create or replace function public.write_feature_configuration(p_environment text, p_expected bigint, p_overrides jsonb, p_user uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare result feature_configuration;
begin
 insert into feature_configuration(environment) values(p_environment) on conflict do nothing;
 update feature_configuration set overrides=p_overrides, version=version+1,
 updated_by=p_user, updated_at=now() where environment=p_environment and version=p_expected returning * into result;
 if not found then raise sqlstate '23505' using message='configuration conflict'; end if;
 insert into feature_audit(environment,version,overrides,updated_by) values(p_environment,result.version,p_overrides,p_user);
 return to_jsonb(result);
end $$;

create unique index if not exists attachments_owner_id on public.attachments(user_id,id);
create table if not exists public.resource_attachment_refs (
 user_id uuid not null, namespace text not null, resource_key text not null, attachment_id uuid not null,
 primary key(user_id,namespace,resource_key,attachment_id),
 foreign key(user_id,namespace,resource_key) references public.workspace_resources(user_id,namespace,resource_key) on delete cascade,
 foreign key(user_id,attachment_id) references public.attachments(user_id,id) on delete cascade
);
create index if not exists resource_attachment_lookup on public.resource_attachment_refs(user_id,attachment_id);
alter table public.resource_attachment_refs enable row level security;
revoke all on public.resource_attachment_refs from anon,authenticated;
grant all on public.resource_attachment_refs to service_role;

create or replace function public.write_workspace_resource(p_user uuid,p_namespace text,p_key text,p_expected bigint,p_value jsonb,p_deleted boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result workspace_resources; file_id uuid;
begin
 if p_expected=0 then
  insert into workspace_resources(user_id,namespace,resource_key,value,deleted)
  values(p_user,p_namespace,p_key,p_value,p_deleted) returning * into result;
 else
  update workspace_resources set value=p_value,deleted=p_deleted,revision=revision+1,updated_at=now()
  where user_id=p_user and namespace=p_namespace and resource_key=p_key and revision=p_expected returning * into result;
  if not found then raise sqlstate '23505' using message='resource conflict'; end if;
 end if;
 delete from resource_attachment_refs where user_id=p_user and namespace=p_namespace and resource_key=p_key;
 if not p_deleted then
  for file_id in
   select distinct reference::uuid from (
    select matched[1] as reference from regexp_matches(p_value::text,'notlinear-r2://([0-9a-f-]{36})','g') as matched
    union select matched[2] from regexp_matches(p_value::text,'"(cloudAttachmentId|attachmentId)"[[:space:]]*:[[:space:]]*"([0-9a-f-]{36})"','g') as matched
   ) refs order by 1
  loop
   perform 1 from attachments where user_id=p_user and id=file_id and state='ready' for update;
   if not found then raise sqlstate '23503' using message='attachment unavailable';end if;
   insert into resource_attachment_refs values(p_user,p_namespace,p_key,file_id);
  end loop;
 end if;
 return to_jsonb(result);
end $$;

create or replace function public.reserve_attachment(p_user uuid,p_id uuid,p_key text,p_name text,p_type text,p_bytes bigint,p_quota bigint)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result attachments;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if (select count(*) from attachments where user_id=p_user)>=200 or (select coalesce(sum(bytes),0) from attachments where user_id=p_user)+p_bytes > p_quota then
  raise sqlstate '23514' using message='attachment quota exceeded';
 end if;
 insert into attachments(id,user_id,object_key,filename,content_type,bytes,state)
 values(p_id,p_user,p_key,p_name,p_type,p_bytes,'pending') returning * into result;
 return to_jsonb(result);
end $$;
revoke all on function public.write_feature_configuration(text,bigint,jsonb,uuid),
 public.write_workspace_resource(uuid,text,text,bigint,jsonb,boolean),
 public.reserve_attachment(uuid,uuid,text,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.write_feature_configuration(text,bigint,jsonb,uuid),
 public.write_workspace_resource(uuid,text,text,bigint,jsonb,boolean),
 public.reserve_attachment(uuid,uuid,text,text,text,bigint,bigint) to service_role;

-- Durable per-user generation leases survive Cloud Run instance changes.
create table if not exists public.generation_leases (
 user_id uuid primary key references auth.users(id) on delete cascade,
 token uuid not null, expires_at timestamptz not null
);
alter table public.generation_leases enable row level security;
revoke all on public.generation_leases from anon,authenticated;
grant all on public.generation_leases to service_role;
create or replace function public.acquire_generation(p_user uuid,p_token uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 insert into generation_leases(user_id,token,expires_at) values(p_user,p_token,now()+interval '360 seconds')
 on conflict(user_id) do update set token=excluded.token,expires_at=excluded.expires_at
 where generation_leases.expires_at<now();
 return found;
end $$;
revoke all on function public.acquire_generation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquire_generation(uuid,uuid) to service_role;

create table if not exists public.product_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, duration_ms integer,
 created_at timestamptz not null default now()
);
alter table public.product_events enable row level security;
revoke all on public.product_events from anon,authenticated;
grant all on public.product_events to service_role;
grant usage,select on sequence public.product_events_id_seq to service_role;


create or replace function public.begin_attachment_delete(p_user uuid,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result attachments;
begin
 select * into result from attachments where user_id=p_user and id=p_id for update;
 if not found then raise sqlstate '23503' using message='attachment unavailable';end if;
 if exists(select 1 from resource_attachment_refs where user_id=p_user and attachment_id=p_id) then
  raise sqlstate '55006' using message='attachment referenced by saved work';
 end if;
 update attachments set state='deleting' where user_id=p_user and id=p_id returning * into result;
 return to_jsonb(result);
end $$;
create or replace function public.list_orphan_attachments(p_cutoff timestamptz)
returns setof attachments language sql security invoker set search_path=public as $$
 select a.* from attachments a where a.state='deleting' or (a.created_at<p_cutoff and
 (a.state='pending' or a.state='ready' and not exists(select 1 from resource_attachment_refs r where r.user_id=a.user_id and r.attachment_id=a.id)))
$$;
revoke all on function public.begin_attachment_delete(uuid,uuid),public.list_orphan_attachments(timestamptz) from public,anon,authenticated;
grant execute on function public.begin_attachment_delete(uuid,uuid),public.list_orphan_attachments(timestamptz) to service_role;
