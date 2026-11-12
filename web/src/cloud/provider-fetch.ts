import { track } from './events';
import { cloudMode,accessToken,cloudRequest } from './client';
const hosts:Record<string,string>={'api.anthropic.com':'anthropic','api.openai.com':'openai','api.deepseek.com':'deepseek','generativelanguage.googleapis.com':'gemini','google.serper.dev':'serper','api.firecrawl.dev':'firecrawl','api.github.com':'github'};
export async function providerFetch(url:string,options:RequestInit={}):Promise<Response>{
 if(!cloudMode())return fetch(url,options);
 const parsed=new URL(url,location.origin);const provider=hosts[parsed.hostname];
 if(!provider)return fetch(url,options);
 parsed.searchParams.delete('key');parsed.searchParams.delete('api_key');
 return fetch('/api/providers/'+provider,{method:'POST',signal:options.signal,
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+await accessToken()},
  body:JSON.stringify({path:parsed.pathname+parsed.search,method:options.method??'GET',body:typeof options.body==='string'?JSON.parse(options.body):null})});
}
let cached:Record<string,string>={};
export function cloudKeys(){return cached;}
export async function refreshCloudKeys(){
 const rows=await cloudRequest<Array<{provider:string}>>('/credentials');
 cached=Object.fromEntries(rows.map(r=>[r.provider,'cloud-credential-reference']));return cached;
}
export async function saveCloudKey(provider:string,key:string){await cloudRequest('/credentials/'+provider,{method:'PUT',body:JSON.stringify({key})});track('connection_succeeded');return refreshCloudKeys();}
export async function removeCloudKey(provider:string){await cloudRequest('/credentials/'+provider,{method:'DELETE'});return refreshCloudKeys();}
