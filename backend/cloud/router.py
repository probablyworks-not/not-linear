from __future__ import annotations
import asyncio
import json
import os
import re
from uuid import uuid4
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from .service import DEFAULTS, service, cloud_enabled, effective_flags, required, all_rows
from . import storage

router = APIRouter(prefix='/api')
identity = service.identity
NAMESPACES = {'chat': 'chat','notes': 'notesV2','canvas': 'canvas','skills': 'skills',
              'artifacts': 'artifacts','designs': 'designs','sketch': 'sketch',
              'annotations': 'highlights','projects': 'projects','preferences': None,'onboarding': None,'logs':'logs'}
PROVIDERS = {'anthropic': ('apiAnthropic','https://api.anthropic.com'),
             'openai': ('apiOpenai','https://api.openai.com'),
             'deepseek': ('apiDeepseek','https://api.deepseek.com'),
             'gemini': ('apiGemini','https://generativelanguage.googleapis.com'),
             'serper': ('toolSerper','https://google.serper.dev'),
             'firecrawl': ('toolFirecrawl','https://api.firecrawl.dev'),
             'github': ('toolGithub','https://api.github.com'),
             'assemblyai': ('voice','https://streaming.assemblyai.com')}

@router.get('/runtime')
async def runtime():
    return {'mode': 'cloud' if cloud_enabled() else 'desktop',
            'supabaseUrl': os.getenv('SUPABASE_URL','') if cloud_enabled() else '',
            'supabaseAnonKey': os.getenv('SUPABASE_ANON_KEY','') if cloud_enabled() else '',
            # Never imply the local subscription prototype is remotely supported.
            'subscriptions': {'claude':False,'chatgpt':False} if cloud_enabled() else {'claude':True,'chatgpt':True}}

@router.get('/features')
async def features(request: Request):
    if not cloud_enabled():
        try: overrides=json.loads(os.getenv('NOTLINEAR_FLAGS_JSON','{}'))
        except ValueError: overrides={}
        return {'flags': effective_flags(overrides), 'overrides': overrides, 'version': 0, 'admin':False}
    user = await identity(request)
    return {**await service.configuration(), 'admin':service.is_admin(user)}

class FlagWrite(BaseModel):
    version: int = Field(ge=0)
    overrides: dict[str,bool]

@router.put('/admin/features')
async def write_flags(body: FlagWrite, user: str = Depends(identity)):
    if not service.is_admin(user): raise HTTPException(403,'Administrator access required')
    if set(body.overrides)-set(DEFAULTS): raise HTTPException(422,'Unknown feature flag')
    row = await service.request('POST','rpc/write_feature_configuration',body={
        'p_environment':os.getenv('NOTLINEAR_ENV','staging'),'p_expected':body.version,
        'p_overrides':body.overrides,'p_user':user})
    return {**row, 'flags':effective_flags(row['overrides']), 'admin':True}

async def check_namespace(namespace):
    if namespace not in NAMESPACES: raise HTTPException(422,'Unknown resource type')
    feature=NAMESPACES[namespace]
    if feature: await service.guard(feature)

@router.get('/resources/{namespace}')
async def read_resources(namespace: str,user: str=Depends(identity)):
    await check_namespace(namespace)
    return await all_rows('workspace_resources',{'user_id':'eq.'+user,'namespace':'eq.'+namespace,'order':'resource_key.asc'})

class ResourceWrite(BaseModel):
    key: str = Field(min_length=1,max_length=512)
    revision: int = Field(ge=0)
    value: Any = None
    deleted: bool = False

@router.put('/resources/{namespace}')
async def write_resource(namespace:str, body:ResourceWrite,user:str=Depends(identity)):
    await check_namespace(namespace)
    if len(json.dumps(body.value))>10*1024*1024: raise HTTPException(413,'Resource is too large')
    return await service.request('POST','rpc/write_workspace_resource',body={
        'p_user':user,'p_namespace':namespace,'p_key':body.key,'p_expected':body.revision,
        'p_value':body.value,'p_deleted':body.deleted})

@router.get('/account/export')
async def export_account(user:str=Depends(identity)):
    resources=await all_rows('workspace_resources',{'user_id':'eq.'+user,'order':'namespace.asc,resource_key.asc'})
    attachments=await all_rows('attachments',{'user_id':'eq.'+user,'state':'eq.ready','order':'id.asc'})
    for file in attachments: file['download_url']=await asyncio.to_thread(storage.sign,'get_object',file['object_key'])
    return {'format':'notlinear-cloud/v1','resources':resources,'attachments':attachments}

@router.delete('/account')
async def delete_account(user:str=Depends(identity)):
    # Mark/delete objects before deleting Auth user; a failed R2 deletion remains retryable.
    files=await all_rows('attachments',{'user_id':'eq.'+user,'order':'id.asc'})
    for file in files:
        await service.request('PATCH','attachments',params={'id':'eq.'+file['id'],'user_id':'eq.'+user},body={'state':'deleting'})
        await asyncio.to_thread(storage.r2().delete_object,Bucket=storage.bucket(),Key=file['object_key'])
        await service.request('DELETE','attachments',params={'id':'eq.'+file['id'],'user_id':'eq.'+user})
    await service.request('DELETE','admin/users/'+user,auth=True)
    return {'ok':True}

class Upload(BaseModel):
    filename:str=Field(min_length=1,max_length=255)
    content_type:str=Field(min_length=1,max_length=128)
    bytes:int=Field(gt=0)

@router.post('/attachments')
async def reserve_upload(body:Upload,user:str=Depends(identity)):
    await service.guard('attachments')
    if body.bytes>int(os.getenv('NOTLINEAR_MAX_FILE_BYTES',str(10*1024*1024))): raise HTTPException(413,'File exceeds upload limit')
    if not re.fullmatch(r'[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+',body.content_type): raise HTTPException(422,'Invalid file type')
    id=str(uuid4()); key=user+'/'+id
    row=await service.request('POST','rpc/reserve_attachment',body={'p_user':user,'p_id':id,'p_key':key,
        'p_name':body.filename,'p_type':body.content_type,'p_bytes':body.bytes,
        'p_quota':int(os.getenv('NOTLINEAR_MAX_USER_ATTACHMENT_BYTES',str(100*1024*1024)))})
    return {'id':id,'url':await asyncio.to_thread(storage.sign,'put_object',key,body.content_type,body.bytes),'headers':{'Content-Type':body.content_type}}

async def owned_file(id,user):
    rows=await service.request('GET','attachments',params={'id':'eq.'+id,'user_id':'eq.'+user})
    if not rows: raise HTTPException(404,'Attachment not found')
    return rows[0]

@router.post('/attachments/{id}/complete')
async def complete_upload(id:str,user:str=Depends(identity)):
    await service.guard('attachments'); row=await owned_file(id,user)
    if row['state']!='pending': raise HTTPException(409,'Upload is not pending')
    metadata=await asyncio.to_thread(storage.r2().head_object,Bucket=storage.bucket(),Key=row['object_key'])
    if metadata['ContentLength']!=row['bytes'] or metadata.get('ContentType')!=row['content_type']:
        await asyncio.to_thread(storage.r2().delete_object,Bucket=storage.bucket(),Key=row['object_key'])
        await service.request('DELETE','attachments',params={'id':'eq.'+id,'user_id':'eq.'+user})
        raise HTTPException(422,'Uploaded file does not match its reservation')
    if row['content_type'] in ('application/pdf','image/png','image/jpeg','image/gif','image/webp'):
        probe=await asyncio.to_thread(storage.r2().get_object,Bucket=storage.bucket(),Key=row['object_key'],Range='bytes=0-15')
        signature=probe['Body'].read();probe['Body'].close()
        matches={'application/pdf':signature.startswith(b'%PDF-'),'image/png':signature.startswith(b'\x89PNG\r\n\x1a\n'),
                 'image/jpeg':signature.startswith(b'\xff\xd8\xff'),'image/gif':signature.startswith((b'GIF87a',b'GIF89a')),
                 'image/webp':signature.startswith(b'RIFF') and signature[8:12]==b'WEBP'}
        if not matches[row['content_type']]:raise HTTPException(422,'File contents do not match declared type')
    await service.request('PATCH','attachments',params={'id':'eq.'+id,'user_id':'eq.'+user},body={'state':'ready'})
    return {'id':id,'ready':True}

@router.get('/attachments/{id}')
async def download(id:str,user:str=Depends(identity)):
    await service.guard('attachments'); row=await owned_file(id,user)
    if row['state']!='ready': raise HTTPException(409,'Attachment is not available')
    return {'url':await asyncio.to_thread(storage.sign,'get_object',row['object_key'])}

@router.delete('/attachments/{id}')
async def delete_file(id:str,user:str=Depends(identity)):
    row=await service.request('POST','rpc/begin_attachment_delete',body={'p_user':user,'p_id':id})
    await asyncio.to_thread(storage.r2().delete_object,Bucket=storage.bucket(),Key=row['object_key'])
    await service.request('DELETE','attachments',params={'id':'eq.'+id,'user_id':'eq.'+user})
    return {'ok':True}

class Credential(BaseModel):
    key:str=Field(min_length=1,max_length=4096)

@router.get('/credentials')
async def credentials(user:str=Depends(identity)):
    return await service.request('GET','provider_credentials',params={'user_id':'eq.'+user,'select':'provider'})

@router.put('/credentials/{provider}')
async def save_credential(provider:str,body:Credential,user:str=Depends(identity)):
    from cryptography.fernet import Fernet
    if provider not in PROVIDERS: raise HTTPException(422,'Provider not supported in cloud mode')
    await service.guard(PROVIDERS[provider][0])
    encrypted=Fernet(required('NOTLINEAR_CREDENTIAL_KEY').encode()).encrypt(body.key.strip().encode()).decode()
    await service.request('POST','provider_credentials',params={'on_conflict':'user_id,provider'},body={'user_id':user,'provider':provider,'ciphertext':encrypted})
    return {'connected':True}

@router.delete('/credentials/{provider}')
async def delete_credential(provider:str,user:str=Depends(identity)):
    await service.request('DELETE','provider_credentials',params={'user_id':'eq.'+user,'provider':'eq.'+provider})
    return {'ok':True}

class ProviderRequest(BaseModel):
    path:str=Field(min_length=1,max_length=2048)
    method:str='POST'
    body:Any=None

@router.post('/providers/{provider}')
async def provider_request(provider:str,body:ProviderRequest,request:Request,user:str=Depends(identity)):
    import httpx
    from urllib.parse import urlsplit,parse_qsl,urlencode
    from starlette.responses import StreamingResponse
    if provider not in PROVIDERS: raise HTTPException(422,'Unsupported provider')
    flag,base=PROVIDERS[provider];await service.guard(flag)
    parsed=urlsplit(body.path)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith('/') or body.method not in ('GET','POST'):
        raise HTTPException(422,'Invalid provider operation')
    allowed={'anthropic':r'^/v1/messages$', 'openai':r'^/v1/(chat/completions|responses|models)$',
             'deepseek':r'^/(v1/)?chat/completions$', 'gemini':r'^/v1beta/models/[a-zA-Z0-9._:-]+$',
             'serper':r'^/(search|news)$','firecrawl':r'^/v[12]/scrape$',
             'github':r'^/(search/(repositories|issues|code)|repos/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+/(issues/[0-9]+|contents/[a-zA-Z0-9_./-]+))$'}
    if not re.fullmatch(allowed[provider],parsed.path) or '..' in parsed.path: raise HTTPException(422,'Provider operation is not allowed')
    if isinstance(body.body,dict) and len(json.dumps(body.body))>12*1024*1024: raise HTTPException(413,'Request too large')
    if provider in ('serper','firecrawl','github'):await service.guard('research')
    if isinstance(body.body,dict):
        for tool in body.body.get('tools',[]):
            if not isinstance(tool,dict):raise HTTPException(422,'Invalid tool specification')
            name=tool.get('name') or (tool.get('function') or {}).get('name') or tool.get('type')
            if name=='create_note':await service.guard('chatNotes')
            elif name in ('list_project_files','read_project_file'):await service.guard('linkedFolders')
            else:
                await service.guard('research')
                extra={'serper_search':'toolSerper','firecrawl_scrape':'toolFirecrawl','web_search':'toolSearxng'}.get(name)
                if isinstance(name,str) and name.startswith('github_'):extra='toolGithub'
                if extra:await service.guard(extra)
    rows=await service.request('GET','provider_credentials',params={'user_id':'eq.'+user,'provider':'eq.'+provider})
    if not rows: raise HTTPException(409,'Connect your own provider key in Settings')
    from cryptography.fernet import Fernet
    key=Fernet(required('NOTLINEAR_CREDENTIAL_KEY').encode()).decrypt(rows[0]['ciphertext'].encode()).decode()
    query={k:v for k,v in parse_qsl(parsed.query) if k not in ('key','api_key','access_token')}
    headers={'Content-Type':'application/json'}
    if provider=='anthropic':headers.update({'x-api-key':key,'anthropic-version':'2023-06-01'})
    elif provider=='serper':headers['X-API-KEY']=key
    elif provider=='gemini':headers['x-goog-api-key']=key
    else:headers['Authorization']='Bearer '+key
    target=base+parsed.path+('?' + urlencode(query) if query else '')
    lease=str(uuid4()) if provider in ('anthropic','openai','deepseek','gemini') and body.method=='POST' else None
    if lease and not await service.request('POST','rpc/acquire_generation',body={'p_user':user,'p_token':lease}):
        raise HTTPException(429,'Finish or stop the current response before starting another')
    async def release():
        if lease:await service.request('DELETE','generation_leases',params={'user_id':'eq.'+user,'token':'eq.'+lease})
    client=httpx.AsyncClient(timeout=httpx.Timeout(120,connect=15),follow_redirects=False)
    try:
        upstream=await client.send(client.build_request(body.method,target,headers=headers,json=body.body if body.method=='POST' else None),stream=True)
    except Exception:
        await client.aclose();await release();raise HTTPException(502,'Provider connection failed')
    if upstream.status_code>=400:
        code=upstream.status_code;await upstream.aclose();await client.aclose();await release()
        raise HTTPException(code if code in (400,401,403,404,429) else 502,
                            'Provider limit reached' if code==429 else 'Provider request failed; check your connection and selected model')
    async def events():
        checked=asyncio.get_running_loop().time()
        try:
            async with asyncio.timeout(300):
                async for chunk in upstream.aiter_bytes():
                    if await request.is_disconnected():break
                    now=asyncio.get_running_loop().time()
                    if now-checked>=5:
                        await service.guard(flag);checked=now
                    yield chunk
        finally:
            import anyio
            with anyio.CancelScope(shield=True):
                await upstream.aclose();await client.aclose();await release()
    return StreamingResponse(events(),media_type=upstream.headers.get('content-type','application/json'),headers={'Cache-Control':'no-store'})

@router.post('/voice/token')
async def voice_token(user:str=Depends(identity)):
    import httpx
    from cryptography.fernet import Fernet
    await service.guard('voice')
    rows=await service.request('GET','provider_credentials',params={'user_id':'eq.'+user,'provider':'eq.assemblyai'})
    if not rows:raise HTTPException(409,'Connect AssemblyAI in Settings')
    key=Fernet(required('NOTLINEAR_CREDENTIAL_KEY').encode()).decrypt(rows[0]['ciphertext'].encode()).decode()
    async with httpx.AsyncClient(timeout=20) as client:
        response=await client.get('https://streaming.assemblyai.com/v3/token',headers={'Authorization':key},params={'expires_in_seconds':60})
    if not response.is_success:raise HTTPException(502,'Unable to start dictation')
    return {'ok':True,'token':response.json()['token']}

@router.get('/account/export-file/{id}')
async def export_file(id:str,user:str=Depends(identity)):
    row=await owned_file(id,user)
    if row['state']!='ready':raise HTTPException(409,'File is not ready')
    return {'url':await asyncio.to_thread(storage.sign,'get_object',row['object_key'])}

class ProductEvent(BaseModel):
    name: str
    duration_ms: int | None = Field(default=None,ge=0,le=3600000)

@router.post('/events')
async def product_event(body:ProductEvent,user:str=Depends(identity)):
    if body.name not in {'connection_succeeded','first_answer','branch_created','workspace_saved','workspace_returned','save_failed','feature_error'}:
        raise HTTPException(422,'Unknown product event')
    await service.request('POST','product_events',body={'user_id':user,'name':body.name,'duration_ms':body.duration_ms})
    return {'ok':True}

class RuntimeLogs(BaseModel):
    session:str=Field(pattern=r'^[0-9a-f-]{36}$')
    events:list[dict[str,Any]]=Field(max_length=500)

@router.post('/runtime-logs')
async def runtime_logs(body:RuntimeLogs,user:str=Depends(identity)):
    await service.guard('logs')
    fields={'kind','phase','provider','status','durationMs','ok'}
    events=[{key:value for key,value in event.items() if key in fields and
             (isinstance(value,(bool,int,float)) or isinstance(value,str) and len(value)<=50)} for event in body.events]
    key='session:'+body.session
    prior=await service.request('GET','workspace_resources',params={'user_id':'eq.'+user,'namespace':'eq.logs','resource_key':'eq.'+key})
    await service.request('POST','rpc/write_workspace_resource',body={'p_user':user,'p_namespace':'logs','p_key':key,
        'p_expected':prior[0]['revision'] if prior else 0,'p_value':events,'p_deleted':False})
    return {'ok':True}
