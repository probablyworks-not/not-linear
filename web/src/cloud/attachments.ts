import { flags } from '../flags';
import { cloudRequest,CloudError } from './client';
import type { Attachment } from '../attachments/read-files';
export async function uploadCloudFile(file:File):Promise<string>{
 const type=file.type||'application/octet-stream';
 const reservation=await cloudRequest<{id:string;url:string;headers:Record<string,string>}>('/attachments',{method:'POST',body:JSON.stringify({filename:file.name,content_type:type,bytes:file.size})});
 try{
  const r=await fetch(reservation.url,{method:'PUT',headers:reservation.headers,body:file});
  if(!r.ok)throw new Error('Attachment upload failed. Please retry.');
  await cloudRequest('/attachments/'+reservation.id+'/complete',{method:'POST'});return reservation.id;
 }catch(e){await cloudRequest('/attachments/'+reservation.id,{method:'DELETE'}).catch(()=>{});throw e;}
}
export async function restoreAttachment(attachment:Attachment):Promise<Attachment>{
 if(!flags.attachments||!attachment.cloudAttachmentId||attachment.base64)return attachment;
 const {url}=await cloudRequest<{url:string}>('/attachments/'+String(attachment.cloudAttachmentId));
 const response=await fetch(url);if(!response.ok)throw new Error('Unable to download attachment. Retry to obtain a new link.');
 const buffer=await response.arrayBuffer();const bytes=new Uint8Array(buffer);let binary='';
 for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]!);
 return {...attachment,base64:btoa(binary)};
}
export function stripAttachmentBytes(value:unknown):unknown{
 if(Array.isArray(value))return value.map(stripAttachmentBytes);
 if(value&&typeof value==='object'){
  const object=value as Record<string,unknown>;
  return Object.fromEntries(Object.entries(object).filter(([key])=>!(object.cloudAttachmentId&&key==='base64')).map(([key,v])=>[key,stripAttachmentBytes(v)]));
 }
 return value;
}
export async function restoreAttachmentBytes(value:unknown):Promise<unknown>{
 if(Array.isArray(value))return Promise.all(value.map(restoreAttachmentBytes));
 if(value&&typeof value==='object'){
  const object=value as Record<string,unknown>;
  if(object.cloudAttachmentId)return restoreAttachment(object as unknown as Attachment);
  const entries=await Promise.all(Object.entries(object).map(async([key,v])=>[key,await restoreAttachmentBytes(v)]));
  return Object.fromEntries(entries);
 }
 return value;
}

const verifiedReferences=new Set<string>();
const DATA_URL=/data:[a-zA-Z0-9.+/-]+;base64,[a-zA-Z0-9+/=]+/g;
async function referenceFor(data:string):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const {accountStorage}=await import('./local-storage');const key='r2-content:'+hash;
 let id=accountStorage.getItem(key);
 if(id&&!verifiedReferences.has(id)){
  try{await cloudRequest('/attachments/'+id);verifiedReferences.add(id);}catch(error){if(error instanceof CloudError&&[404,422].includes(error.status)){id=null;accountStorage.removeItem(key);}else throw error;}
 }
 if(!id){const response=await fetch(data);const blob=await response.blob();id=await uploadCloudFile(new File([blob],'embedded-file',{type:blob.type}));accountStorage.setItem(key,id);verifiedReferences.add(id);}
 return 'notlinear-r2://'+id;
}
/** Handles Notes images, file-block JSON, HTML and chat image blocks without changing editor schemas. */
export async function externalizeBinary(value:unknown):Promise<unknown>{
 if(typeof value==='string'){
  const matches=[...value.matchAll(DATA_URL)];let result=value;
  for(const match of matches)result=result.replace(match[0],await referenceFor(match[0]));
  return result;
 }
 if(Array.isArray(value))return Promise.all(value.map(externalizeBinary));
 if(value&&typeof value==='object'){
  const object=value as Record<string,unknown>;
  if(typeof object.base64==='string'&&!object.cloudAttachmentId){
   const reference=await referenceFor(`data:${object.type||'application/octet-stream'};base64,${object.base64}`);
   const {base64:discard,...rest}=object;void discard;return externalizeBinary({...rest,cloudAttachmentId:reference.slice(15)});
  }
  if(object.type==='base64'&&typeof object.data==='string'&&!object.data.startsWith('notlinear-r2://')&&typeof object.media_type==='string')return {...object,data:await referenceFor(`data:${object.media_type};base64,${object.data}`)};
  return Object.fromEntries(await Promise.all(Object.entries(object).map(async([key,v])=>[key,await externalizeBinary(v)])));
 }
 return value;
}
export async function materializeBinary(value:unknown):Promise<unknown>{
 if(typeof value==='string'){
  if(!flags.attachments)return value;
  const matches=[...value.matchAll(/notlinear-r2:\/\/[0-9a-f-]{36}/g)];let result=value;
  for(const match of matches){const {url}=await cloudRequest<{url:string}>('/attachments/'+match[0].slice(15));
   const response=await fetch(url);if(!response.ok)throw new Error('Attachment could not be loaded.');
   const blob=await response.blob();const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});
   const hashBuffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
   const hash=Array.from(new Uint8Array(hashBuffer),b=>b.toString(16).padStart(2,'0')).join('');
   const {accountStorage}=await import('./local-storage');accountStorage.setItem('r2-content:'+hash,match[0].slice(15));verifiedReferences.add(match[0].slice(15));
   result=result.replace(match[0],data);
  }
  return result;
 }
 if(Array.isArray(value))return Promise.all(value.map(materializeBinary));
 if(value&&typeof value==='object'){
  const result=Object.fromEntries(await Promise.all(Object.entries(value).map(async([key,v])=>[key,await materializeBinary(v)])));
  if(result.type==='base64'&&typeof result.data==='string'&&result.data.startsWith('data:'))result.data=result.data.split(',')[1];
  return result;
 }
 return value;
}
