"""Cloud integrations. All authority derives from Supabase's validated user token."""
from __future__ import annotations
import json
import os
from pathlib import Path
from uuid import UUID
import httpx
from fastapi import HTTPException, Request

DEFAULTS = json.loads(Path(__file__).with_name('features.json').read_text())
DEPENDENCIES = {'chatNotes': ['notesV2', 'chat'], 'contextRanking': ['attachments'],
                'linkedFolders': ['attachments']}

def cloud_enabled():
    return os.getenv('NOTLINEAR_RUNTIME', 'desktop') == 'cloud'

def effective_flags(overrides):
    result = {**DEFAULTS, **{k: v for k, v in overrides.items() if k in DEFAULTS and isinstance(v, bool)}}
    for name, parents in DEPENDENCIES.items():
        result[name] = result[name] and all(result[p] for p in parents)
    return result

def required(name):
    value = os.getenv(name)
    if not value:
        raise HTTPException(503, 'Cloud service is not configured')
    return value

class CloudService:
    async def request(self, method, path, *, body=None, token=None, auth=False, params=None):
        url = required('SUPABASE_URL').rstrip('/')
        if not url.startswith('https://') and not url.startswith('http://127.0.0.1:'):
            raise HTTPException(503, 'Invalid Supabase endpoint')
        key = required('SUPABASE_SERVICE_ROLE_KEY')
        headers = {'apikey': key, 'Prefer': 'return=representation,resolution=merge-duplicates'}
        # New sb_secret keys are API keys, not JWTs. User JWTs stay on Bearer.
        if token or not key.startswith('sb_secret_'):
            headers['Authorization'] = 'Bearer ' + (token or key)
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.request(method, url + ('/auth/v1/' if auth else '/rest/v1/') + path,
                                            json=body, headers=headers, params=params)
        if response.status_code >= 400:
            if response.status_code in (401, 403):
                raise HTTPException(401, 'Sign in again to continue')
            if response.status_code == 400 and response.json().get('code') == '23514':
                raise HTTPException(413, 'Attachment storage quota exceeded')
            error_code=response.json().get('code') if 'application/json' in response.headers.get('content-type','') else None
            if error_code=='23503':raise HTTPException(422,'Referenced file is not available in this account')
            if error_code=='55006':raise HTTPException(409,'File is still used by saved work')
            if response.status_code == 409:
                raise HTTPException(409, 'Saved work changed elsewhere. Export your draft before reloading.')
            raise HTTPException(502, 'Cloud service request failed')
        return response.json() if response.content else None

    async def identity(self, request: Request):
        authorization = request.headers.get('authorization', '')
        if not authorization.startswith('Bearer '):
            raise HTTPException(401, 'Sign in to continue')
        user = await self.request('GET', 'user', token=authorization[7:], auth=True)
        try:
            user_id = str(UUID(user['id']))
        except (KeyError, ValueError, TypeError):
            raise HTTPException(401, 'Invalid account')
        return user_id

    def is_admin(self, user_id):
        return user_id in {s.strip() for s in os.getenv('NOTLINEAR_ADMIN_IDS', '').split(',') if s.strip()}

    async def configuration(self):
        rows = await self.request('GET', 'feature_configuration', params={'environment': 'eq.' + os.getenv('NOTLINEAR_ENV', 'staging')})
        row = rows[0] if rows else {'version': 0, 'overrides': {}}
        return {**row, 'flags': effective_flags(row['overrides'])}

    async def guard(self, feature):
        if not (await self.configuration())['flags'].get(feature, False):
            raise HTTPException(403, 'Feature is disabled; saved work is preserved')

service = CloudService()

async def all_rows(table,params=None):
    """PostgREST projects cap individual pages; never silently truncate exports."""
    result=[];offset=0
    while True:
        page=await service.request('GET',table,params={**(params or {}),'limit':'500','offset':str(offset)})
        result.extend(page)
        if len(page)<500:return result
        offset+=len(page)
