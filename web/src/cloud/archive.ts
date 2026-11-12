import { encodeRow } from './record-codec';
import { cloudRequest } from './client';
import { uploadCloudFile,externalizeBinary,stripAttachmentBytes } from './attachments';
import { accountStorage } from './local-storage';
interface Resource {namespace:string;resource_key:string;revision:number;value:unknown;deleted:boolean}
interface ExportedFile {id:string;filename:string;content_type:string;bytes:number;download_url:string;data?:string}
interface Archive {format:string;resources:Resource[];attachments:ExportedFile[];localDrafts?:unknown}
async function asBase64(blob:Blob):Promise<string>{
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=reject;reader.readAsDataURL(blob);});
}
export async function downloadArchive():Promise<void>{
 const archive=await cloudRequest<Archive>('/account/export');
 for(const attachment of archive.attachments){
  const {url}=await cloudRequest<{url:string}>('/account/export-file/'+attachment.id);
  const response=await fetch(url);if(!response.ok)throw new Error('A backup attachment could not be downloaded. Please retry.');
  attachment.data=await asBase64(await response.blob());delete (attachment as Partial<ExportedFile>).download_url;
 }
 const {dumpLocalDrafts}=await import('./database');archive.localDrafts=await dumpLocalDrafts();
 const url=URL.createObjectURL(new Blob([JSON.stringify(archive)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='notlinear-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function rewrite(value:unknown,ids:Map<string,string>):unknown{
 if(typeof value==='string'){let result=value;for(const [oldId,newId] of ids)result=result.replaceAll('notlinear-r2://'+oldId,'notlinear-r2://'+newId);return result;}
 if(Array.isArray(value))return value.map(item=>rewrite(item,ids));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,key==='cloudAttachmentId'&&typeof v==='string'?(ids.get(v)??v):rewrite(v,ids)]));
 return value;
}
const databases:Record<string,string>={'notlinear':'chat','notlinear-notes':'notes','notlinear-canvas':'canvas','notlinear-skills':'skills','notlinear-artifacts':'artifacts','notlinear-sketch':'sketch','notlinear-designs':'designs'};
export async function importArchive(file:File):Promise<{imported:number;existing:number}>{
 const parsed=JSON.parse(await file.text());let archive:Archive;
 if(parsed.format==='notlinear-backup/v1'&&parsed.databases){
  const resources:Resource[]=[];
  for(const [name,db] of Object.entries(parsed.databases) as Array<[string,{stores:Record<string,{records:Array<{value:Record<string,unknown>}>}>}]>){
   if(!databases[name])continue;
   for(const [table,store] of Object.entries(db.stores))for(const record of store.records){
    const row=record.value;const key=row.key??row.id;if(typeof key!=='string')throw new Error('Invalid desktop backup key');
    for(const piece of encodeRow(name,table,key,row))resources.push({namespace:piece.namespace,resource_key:piece.key,revision:0,value:piece.value,deleted:false});
   }
  }
  archive={format:'notlinear-cloud/v1',resources,attachments:[]};
 }else archive=parsed;
 if(archive.format!=='notlinear-cloud/v1'||!Array.isArray(archive.resources)||!Array.isArray(archive.attachments))throw new Error('Not a supported Notlinear backup.');
 const ids=new Map<string,string>();
 for(const attachment of archive.attachments){
  if(!attachment.data)throw new Error('Backup has links instead of file bytes. Export a portable backup first.');
  const marker='import-attachment:'+attachment.id;let id=accountStorage.getItem(marker);
  if(id){try{await cloudRequest('/attachments/'+id);}catch{id=null;}}
  if(!id){
   const binary=atob(attachment.data);const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
   if(bytes.length!==attachment.bytes)throw new Error('Backup attachment size mismatch.');
   id=await uploadCloudFile(new File([bytes],attachment.filename,{type:attachment.content_type}));accountStorage.setItem(marker,id);
  }
  ids.set(attachment.id,id);
 }
 let imported=0,existing=0;
 const namespaces=new Map<string,Map<string,Resource>>();
 for(const row of archive.resources){
  if(row.deleted)continue;
  if(!namespaces.has(row.namespace)){const records=await cloudRequest<Resource[]>('/resources/'+row.namespace);namespaces.set(row.namespace,new Map(records.map(item=>[item.resource_key,item])));}
  const known=namespaces.get(row.namespace)!;const prior=known.get(row.resource_key);
  if(prior){
   if(row.namespace==='preferences'&&row.resource_key===JSON.stringify(['kv','state','meta'])){
    const old=prior.value as Record<string,unknown>,incoming=row.value as Record<string,unknown>;
    const combined=[...(Array.isArray(old.dynamic)?old.dynamic:[]),...(Array.isArray(incoming.dynamic)?incoming.dynamic:[])];
    const dynamic=[...new Map(combined.map(item=>[item.id,item])).values()];
    await cloudRequest('/resources/preferences',{method:'PUT',body:JSON.stringify({key:row.resource_key,revision:prior.revision,value:{...old,dynamic,chatCount:Math.max(Number(old.chatCount??0),Number(incoming.chatCount??0)),projectCount:Math.max(Number(old.projectCount??0),Number(incoming.projectCount??0))}})});
   }
   existing++;continue;
  }
  const value=await externalizeBinary(stripAttachmentBytes(rewrite(row.value,ids)));
  const saved=await cloudRequest<Resource>('/resources/'+row.namespace,{method:'PUT',body:JSON.stringify({key:row.resource_key,revision:0,value})});known.set(row.resource_key,saved);imported++;
 }
 return {imported,existing};
}
