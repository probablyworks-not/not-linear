import Dexie,{type Transaction} from 'dexie';
import { cloudMode,cloudRequest,userId } from './client';
import { accountStorage } from './local-storage';
import { flags,type FeatureId } from '../flags';
import { stripAttachmentBytes,restoreAttachmentBytes,externalizeBinary,materializeBinary } from './attachments';
import { databaseNamespaces,encodeRow,applyPiece,type Piece } from './record-codec';
export type SaveStatus='Saved'|'Saving'|'Save failed';
let status:SaveStatus='Saved',error='';
const listeners=new Set<()=>void>();
export function syncStatus(){return {status,error};}
export function subscribeSync(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
function announce(next:SaveStatus,message=''){status=next;error=message;listeners.forEach(fn=>fn());}
interface RemoteRow {resource_key:string;revision:number;value:unknown;deleted:boolean}
interface Marker {revision:number;fingerprint:string;deleted:boolean}
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
 return value;
}
async function fingerprint(value:unknown):Promise<string>{
 const bytes=new TextEncoder().encode(JSON.stringify(canonical(value))??'undefined');
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}

const namespaceFeatures:Record<string,FeatureId>={chat:'chat',projects:'projects',notes:'notesV2',canvas:'canvas',skills:'skills',artifacts:'artifacts',designs:'designs',sketch:'sketch',annotations:'highlights'};
const cacheEpochs=new Map<string,number>();
const active=new Set<CloudDatabase>();let running:Promise<void>|null=null;
function synchronizeAll(pull:boolean):Promise<void>{
 if(running)return running.then(()=>pull?synchronizeAll(true):undefined);
 running=(async()=>{try{for(const db of active)await db.synchronize(pull);announce('Saved');}
 catch(e){announce('Save failed',e instanceof Error?e.message:'Cloud save failed');throw e;}})().finally(()=>{running=null;});
 return running;
}
export async function flushCloud():Promise<void>{if(running)await running;await synchronizeAll(false);}
export const refreshCloud=()=>synchronizeAll(true);
if(typeof window!=='undefined'){
 setInterval(()=>{if(cloudMode()&&!running)void flushCloud().catch(()=>{});},1500);
 window.addEventListener('beforeunload',e=>{if(cloudMode()&&status!=='Saved')e.preventDefault();});
}
/** Existing desktop DB schemas stay unchanged. Cloud caches are account-specific. */
export default class CloudDatabase extends Dexie {
 private original:string;
 constructor(name:string){
  super(cloudMode()?`${name}:account:${userId()}`:name);this.original=name;
  if(cloudMode()&&databaseNamespaces(name).length){
   this.on('ready',async(vip)=>{
    await this.synchronize(true,vip);active.add(this);
    const changed=(transaction:Transaction)=>{
     if((transaction as Transaction&{cloudPull?:boolean}).cloudPull)return;
     cacheEpochs.set(this.name,(cacheEpochs.get(this.name)??0)+1);announce('Saving');
    };
    for(const table of this.tables){
     table.hook('creating',function(...args){this.onsuccess=()=>changed(args[2]);});
     table.hook('updating',function(...args){this.onsuccess=()=>changed(args[3]);});
     table.hook('deleting',function(...args){this.onsuccess=()=>changed(args[2]);});
    }
   });
  }
 }
 close(options?:{disableAutoOpen:boolean}):void {active.delete(this);super.close(options);}
 private async snapshot(connection:Dexie=this):Promise<Piece[]>{
  const result:Piece[]=[];
  for(const table of connection.tables)for(const row of await table.toArray()){
   const pk=table.schema.primKey.keyPath;const key=typeof pk==='string'?row[pk]:undefined;
   if(typeof key!=='string')throw new Error('Unsupported cloud cache key');
   result.push(...encodeRow(this.original,table.name,key,row));
  }
  return result;
 }
 async synchronize(pull:boolean,connection:Dexie=this):Promise<void>{
  for(const namespace of databaseNamespaces(this.original)){
   const feature=namespaceFeatures[namespace];if(feature&&!flags[feature])continue;
   const metaKey=`cloud-sync-v2:${this.original}:${namespace}`;
   const markers:Record<string,Marker>=JSON.parse(accountStorage.getItem(metaKey)??'{}');
   const pullEpoch=cacheEpochs.get(this.name)??0;
   let local=new Map((await this.snapshot(connection)).filter(p=>p.namespace===namespace).map(p=>[p.key,p]));
   if(pull){
    const rows=await cloudRequest<RemoteRow[]>('/resources/'+namespace);
    rows.sort((a,b)=>Number((a.value as {position?:number})?.position??0)-Number((b.value as {position?:number})?.position??0));
    for(const remote of rows){
     if((cacheEpochs.get(this.name)??0)!==pullEpoch)continue;
     if(!remote.resource_key.startsWith('['))continue; // backup/legacy records have their own consumers
     const marker=markers[remote.resource_key];const piece=local.get(remote.resource_key);
     const changed=marker?(await fingerprint(await externalizeBinary(stripAttachmentBytes(piece?.value))))!==marker.fingerprint:piece!==undefined;
     if(changed&&marker?.revision!==remote.revision)throw new Error('Work changed on another device. Your local draft is preserved; export it before resolving the conflict.');
     if(!changed){
      const [tableName,key]=JSON.parse(remote.resource_key) as [string,string];
      if(!this.tables.some(t=>t.name===tableName))continue;
      const table=connection.table(tableName);
      const value=await restoreAttachmentBytes(await materializeBinary(remote.value));
      const applied=await connection.transaction('rw',table,async(transaction)=>{
       (transaction as Transaction&{cloudPull?:boolean}).cloudPull=true;
       if((cacheEpochs.get(this.name)??0)!==pullEpoch)return false;
       const current=await table.get(key);
       const next=applyPiece(current,{namespace,key:remote.resource_key,value},remote.deleted);
       if(next)await table.put(next);else await table.delete(key);
       return true;
      });
      if(!applied)continue;
      markers[remote.resource_key]={revision:remote.revision,fingerprint:await fingerprint(remote.deleted?undefined:remote.value),deleted:remote.deleted};
      accountStorage.setItem(metaKey,JSON.stringify(markers));
     }
    }
    local=new Map((await this.snapshot(connection)).filter(p=>p.namespace===namespace).map(p=>[p.key,p]));
   }
   for(const key of new Set([...local.keys(),...Object.keys(markers)])){
    const value=local.get(key)?.value;const deleted=value===undefined;const marker=markers[key];
    const packed=await externalizeBinary(stripAttachmentBytes(value));const digest=await fingerprint(packed);
    if(marker&&marker.deleted===deleted&&marker.fingerprint===digest)continue;
    announce('Saving');
    const row=await cloudRequest<RemoteRow>('/resources/'+namespace,{method:'PUT',body:JSON.stringify({key,revision:marker?.revision??0,value:packed??null,deleted})});
    markers[key]={revision:row.revision,fingerprint:digest,deleted};accountStorage.setItem(metaKey,JSON.stringify(markers));
   }
  }
 }
}
export async function dumpLocalDrafts():Promise<unknown>{
 const databases:Record<string,Record<string,unknown[]>>={};
 for(const db of active){const stores:Record<string,unknown[]>={};for(const table of db.tables)stores[table.name]=await table.toArray();databases[db.name]=stores;}
 return {format:'notlinear-local-drafts/v1',databases};
}

export async function clearAccountCache():Promise<void>{
 const owner=userId();if(!owner)return;
 for(const db of active)db.close();
 for(const name of await Dexie.getDatabaseNames())if(name.startsWith('notlinear')&&name.endsWith(':account:'+owner)){
  await Promise.race([Dexie.delete(name),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Close other Notlinear tabs to clear the remaining local cache.')),5000))]);
 }
 const prefix=`notlinear-account:${owner}:`;
 for(const key of Object.keys(window.localStorage))if(key.startsWith(prefix))window.localStorage.removeItem(key);
}
