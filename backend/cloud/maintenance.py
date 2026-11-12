"""Daily Cloud Run Job: PYTHONPATH=backend python -m cloud.maintenance."""
import asyncio
from datetime import datetime,timedelta,timezone
from fastapi import HTTPException
from .service import service
from .storage import r2,bucket
async def cleanup():
    cutoff=(datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()
    cleaned=0
    while True:
        rows=await service.request('POST','rpc/list_orphan_attachments',body={'p_cutoff':cutoff},params={'limit':'500'})
        if not rows:break
        for row in rows:
            if row['state']!='deleting':
                try:
                    await service.request('POST','rpc/begin_attachment_delete',body={'p_user':row['user_id'],'p_id':row['id']})
                except HTTPException as error:
                    if error.status_code==409:continue  # another write linked the file
                    raise
            await asyncio.to_thread(r2().delete_object,Bucket=bucket(),Key=row['object_key'])
            await service.request('DELETE','attachments',params={'id':'eq.'+row['id'],'user_id':'eq.'+row['user_id']})
            cleaned+=1
    retention=(datetime.now(timezone.utc)-timedelta(days=30)).isoformat()
    await service.request('DELETE','product_events',params={'created_at':'lt.'+retention})
    await service.request('DELETE','workspace_resources',params={'namespace':'eq.logs','updated_at':'lt.'+retention})
    print(f'Cleaned {cleaned} abandoned/deleting attachments; pruned expired diagnostics')
if __name__=='__main__':asyncio.run(cleanup())
