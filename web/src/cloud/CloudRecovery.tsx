import { useState } from 'react';
import Dexie from 'dexie';
import { userId } from './client';
export function CloudRecovery(){
 const [downloaded,setDownloaded]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const names=async()=> (await Dexie.getDatabaseNames()).filter(name=>name.startsWith('notlinear')&&name.endsWith(':account:'+userId()));
 const backup=async()=>{setBusy(true);try{
  const databases:Record<string,unknown>={};
  for(const name of await names()){
   const db=new Dexie(name);try{await db.open();const tables:Record<string,unknown>={};for(const table of db.tables)tables[table.name]=await table.toArray();databases[name]=tables;}finally{db.close();}
  }
  const url=URL.createObjectURL(new Blob([JSON.stringify({format:'notlinear-local-drafts/v1',databases})],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='notlinear-local-drafts.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setDownloaded(true);
 }catch(error){setMessage(String(error));}finally{setBusy(false);}};
 const reload=async()=>{if(!downloaded||!confirm('Discard this browser’s cached edits and reload your cloud copy? Keep the downloaded drafts file.'))return;setBusy(true);try{
  for(const name of await names())await Promise.race([Dexie.delete(name),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Close other Notlinear tabs, then retry.')),5000))]);
  const prefix=`notlinear-account:${userId()}:cloud-sync-v2:`;
  for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key);
  location.replace('/web/');
 }catch(error){setMessage(String(error));setBusy(false);}};
 return <main className="mx-auto flex max-w-xl flex-col gap-4 p-8"><h1 className="text-2xl font-semibold">Recover your workspace</h1>
 <p>Your cloud copy and this browser’s drafts may differ. Download the local drafts before replacing the browser cache. No cloud records are deleted by these controls.</p>
 <button disabled={busy} onClick={()=>void backup()}>Download local drafts</button>
 <button disabled={busy||!downloaded} onClick={()=>void reload()}>Reload cloud copy</button>
 <button onClick={()=>location.replace('/web/')}>Try again without changes</button><p role="status">{message}</p></main>;
}
