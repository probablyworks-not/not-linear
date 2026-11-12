"""Cloud boundary tests; Supabase and R2 are mocked, never live credentials."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import httpx
from fastapi import FastAPI
from cloud.router import router
from cloud.service import service,effective_flags
from cloud.middleware import CloudBoundaryMiddleware

class FeatureRules(unittest.TestCase):
    def test_notes_dependencies_and_defaults(self):
        defaults=effective_flags({})
        self.assertTrue(defaults['notesV2']);self.assertTrue(defaults['canvas'])
        self.assertFalse(defaults['designs']);self.assertFalse(defaults['projectMemory'])
        flags=effective_flags({'notesV2':False,'chatNotes':True})
        self.assertFalse(flags['chatNotes']);self.assertTrue(flags['chat'])
    def test_projects_does_not_disable_content(self):
        flags=effective_flags({'projects':False})
        for key in ('chat','notesV2','canvas'):self.assertTrue(flags[key])

class CloudRoutes(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.app=FastAPI();self.app.include_router(router)
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='https://notlinear.test')
        self.user='00000000-0000-4000-8000-000000000001'
        self.app.dependency_overrides[service.identity]=lambda:self.user
        self.remote=AsyncMock(return_value=[])
        self.patcher=patch.object(service,'request',self.remote);self.patcher.start()
        self.config=patch.object(service,'configuration',AsyncMock(return_value={'flags':effective_flags({}),'version':0,'overrides':{}}));self.config.start()
    async def asyncTearDown(self):
        self.patcher.stop();self.config.stop();await self.client.aclose()
    async def test_non_admin_cannot_change_flags(self):
        with patch.dict(os.environ,{'NOTLINEAR_ADMIN_IDS':''}):
            response=await self.client.put('/api/admin/features',json={'version':0,'overrides':{'notesV2':False}})
        self.assertEqual(response.status_code,403);self.remote.assert_not_awaited()
    async def test_admin_identity_is_server_owned(self):
        with patch.dict(os.environ,{'NOTLINEAR_ADMIN_IDS':self.user}):
            self.remote.return_value={'version':1,'overrides':{'notesV2':False}}
            response=await self.client.put('/api/admin/features',json={'version':0,'overrides':{'notesV2':False}})
        self.assertEqual(response.status_code,200);self.assertFalse(response.json()['flags']['chatNotes'])
        self.assertEqual(self.remote.call_args.kwargs['body']['p_user'],self.user)
    async def test_unknown_flag_rejected(self):
        with patch.dict(os.environ,{'NOTLINEAR_ADMIN_IDS':self.user}):
            response=await self.client.put('/api/admin/features',json={'version':0,'overrides':{'secret':True}})
        self.assertEqual(response.status_code,422)
    async def test_disabled_notes_cannot_be_written(self):
        with patch.object(service,'configuration',AsyncMock(return_value={'flags':effective_flags({'notesV2':False})})):
            response=await self.client.put('/api/resources/notes',json={'key':'note','revision':0,'value':{}})
        self.assertEqual(response.status_code,403);self.remote.assert_not_awaited()
    async def test_resource_owner_cannot_be_supplied_by_browser(self):
        self.remote.return_value={'revision':1}
        response=await self.client.put('/api/resources/chat',json={'key':'one','revision':0,'value':{},'user_id':'another'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.remote.call_args.kwargs['body']['p_user'],self.user)
    async def test_attachment_other_owner_is_not_accessible(self):
        response=await self.client.get('/api/attachments/other')
        self.assertEqual(response.status_code,404)
        self.assertEqual(self.remote.call_args.kwargs['params']['user_id'],'eq.'+self.user)
    async def test_oversize_attachment_rejected_before_storage(self):
        response=await self.client.post('/api/attachments',json={'filename':'x','content_type':'text/plain','bytes':11*1024*1024})
        self.assertEqual(response.status_code,413);self.remote.assert_not_awaited()
    async def test_pending_attachment_cannot_download(self):
        self.remote.return_value=[{'state':'pending'}]
        response=await self.client.get('/api/attachments/test')
        self.assertEqual(response.status_code,409)
    async def test_model_tool_cannot_bypass_disabled_notes(self):
        with patch.object(service,'configuration',AsyncMock(return_value={'flags':effective_flags({'notesV2':False})})):
            response=await self.client.post('/api/providers/anthropic',json={'path':'/v1/messages','body':{'tools':[{'name':'create_note'}]}})
        self.assertEqual(response.status_code,403);self.remote.assert_not_awaited()
    async def test_provider_proxy_rejects_redirect_target(self):
        response=await self.client.post('/api/providers/openai',json={'path':'https://evil.test/','body':{}})
        self.assertEqual(response.status_code,422)
    async def test_unauthenticated_request_is_rejected(self):
        self.app.dependency_overrides.clear()
        response=await self.client.get('/api/resources/chat')
        self.assertEqual(response.status_code,401)
    async def test_credentials_are_encrypted_and_never_returned(self):
        from cryptography.fernet import Fernet
        key=Fernet.generate_key()
        with patch.dict(os.environ,{'NOTLINEAR_CREDENTIAL_KEY':key.decode()}):
            response=await self.client.put('/api/credentials/openai',json={'key':'private-test-credential'})
        self.assertEqual(response.status_code,200)
        body=self.remote.call_args.kwargs['body']
        self.assertNotIn('private-test-credential',response.text)
        self.assertNotEqual(body['ciphertext'],'private-test-credential')
        self.assertEqual(Fernet(key).decrypt(body['ciphertext'].encode()),b'private-test-credential')
    async def test_verified_upload_becomes_ready(self):
        from unittest.mock import MagicMock
        client=MagicMock();client.head_object.return_value={'ContentLength':4,'ContentType':'text/plain'}
        self.remote.side_effect=[[{'state':'pending','object_key':'private/file','bytes':4,'content_type':'text/plain'}],[]]
        with patch('cloud.storage.r2',return_value=client),patch('cloud.storage.bucket',return_value='private'):
            response=await self.client.post('/api/attachments/file/complete')
        self.assertEqual(response.status_code,200);self.assertTrue(response.json()['ready'])
        self.assertEqual(self.remote.call_args.kwargs['body'],{'state':'ready'})
    async def test_wrong_upload_size_is_deleted_and_not_usable(self):
        from unittest.mock import MagicMock
        client=MagicMock();client.head_object.return_value={'ContentLength':999,'ContentType':'text/plain'}
        self.remote.side_effect=[[{'state':'pending','object_key':'private/file','bytes':4,'content_type':'text/plain'}],[]]
        with patch('cloud.storage.r2',return_value=client),patch('cloud.storage.bucket',return_value='private'):
            response=await self.client.post('/api/attachments/file/complete')
        self.assertEqual(response.status_code,422);client.delete_object.assert_called_once()
    async def test_cloud_diagnostics_discard_content_and_credentials(self):
        self.remote.side_effect=[[],{}]
        response=await self.client.post('/api/runtime-logs',json={'session':'00000000-0000-4000-8000-000000000001',
            'events':[{'kind':'http','provider':'openai','status':200,'prompt':'private prompt','headers':{'Authorization':'secret'},'response':'private answer'}]})
        self.assertEqual(response.status_code,200)
        written=self.remote.call_args.kwargs['body']['p_value']
        self.assertEqual(written,[{'kind':'http','provider':'openai','status':200}])
    async def test_cloud_boundary_blocks_desktop_routes_and_foreign_origin(self):
        app=FastAPI();app.add_middleware(CloudBoundaryMiddleware)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='https://notlinear.test') as client:
            response=await client.post('/__notlinear_read_file',json={'path':'/etc/passwd'})
            self.assertEqual(response.status_code,404)
            response=await client.get('/api/runtime',headers={'Origin':'https://evil.test'})
            self.assertEqual(response.status_code,403)

if __name__=='__main__':unittest.main()
