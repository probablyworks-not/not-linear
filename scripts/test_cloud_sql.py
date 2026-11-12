from pathlib import Path
import subprocess,tempfile
root=Path(__file__).resolve().parents[1]
import os,shutil
bin=Path(os.environ.get('NOTLINEAR_PG_BIN') or str(Path(shutil.which('psql') or '/usr/bin/psql').parent))
with tempfile.TemporaryDirectory(prefix='notlinear-pg-') as folder:
 p=Path(folder);db=p/'data';log=p/'postgres.log'
 def run(*args,**kw):return subprocess.run(list(map(str,args)),check=True,**kw)
 run(bin/'initdb','-D',db,'--auth=trust','--no-locale',stdout=subprocess.DEVNULL)
 run(bin/'pg_ctl','-D',db,'-l',log,'-o',f"-k {p} -c listen_addresses=''",'start',stdout=subprocess.DEVNULL)
 try:
  def sql(query):run(bin/'psql','-h',p,'-d','postgres','-v','ON_ERROR_STOP=1','-c',query,stdout=subprocess.DEVNULL)
  sql('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);')
  run(bin/'psql','-h',p,'-d','postgres','-v','ON_ERROR_STOP=1','-f',root/'supabase/migrations/202611120001_web_beta.sql',stdout=subprocess.DEVNULL)
  sql("""insert into auth.users values('00000000-0000-4000-8000-000000000001');
  set role service_role;
  select write_workspace_resource('00000000-0000-4000-8000-000000000001','notes','one',0,'{"text":"hello"}',false);
  select write_workspace_resource('00000000-0000-4000-8000-000000000001','notes','one',1,'{"text":"updated"}',false);
  select write_feature_configuration('staging',0,'{"notesV2":false}','00000000-0000-4000-8000-000000000001');
  select reserve_attachment('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','private/key','x','text/plain',10,20);
  update attachments set state='ready' where id='00000000-0000-4000-8000-000000000002';
  select write_workspace_resource('00000000-0000-4000-8000-000000000001','notes','with-file',0,'{"cloudAttachmentId":"00000000-0000-4000-8000-000000000002"}',false);
  do $$ begin
    if (select count(*) from resource_attachment_refs)<>1 then raise exception 'file reference missing';end if;
    if exists(select 1 from list_orphan_attachments(now()+interval '1 day')) then raise exception 'referenced file collected';end if;
    begin perform begin_attachment_delete('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');raise exception 'referenced file deletion allowed';exception when object_in_use then null;end;
    begin perform write_workspace_resource('00000000-0000-4000-8000-000000000001','notes','foreign-file',0,'{"cloudAttachmentId":"00000000-0000-4000-8000-000000000099"}',false);raise exception 'foreign file reference accepted';exception when foreign_key_violation then null;end;
  end $$;
  do $$ begin
    begin perform write_workspace_resource('00000000-0000-4000-8000-000000000001','notes','one',1,'{}',false);raise exception 'stale revision accepted'; exception when unique_violation then null;end;
    begin perform reserve_attachment('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','private/key2','x','text/plain',15,20);raise exception 'quota exceeded';exception when check_violation then null;end;
    if not acquire_generation('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004') then raise exception 'first generation denied';end if;
    if acquire_generation('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005') then raise exception 'second generation allowed';end if;
  end $$;
  reset role;
  do $$ begin if has_table_privilege('authenticated','provider_credentials','select') then raise exception 'credential access granted';end if;
  if has_function_privilege('authenticated','write_feature_configuration(text,bigint,jsonb,uuid)','execute') then raise exception 'admin rpc exposed';end if;end $$;
  """)
  print('PASS: migration, revision conflicts, audited flags, atomic quotas, generation leases, owned attachment references, safe orphan/deletion rules, private grants')
 finally:run(bin/'pg_ctl','-D',db,'stop','-m','fast',stdout=subprocess.DEVNULL)
