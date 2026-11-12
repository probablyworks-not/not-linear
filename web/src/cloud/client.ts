export interface Runtime { mode:'desktop'|'cloud'; supabaseUrl:string; supabaseAnonKey:string; subscriptions:Record<string,boolean> }
export let runtime:Runtime = {mode:'desktop',supabaseUrl:'',supabaseAnonKey:'',subscriptions:{claude:true,chatgpt:true}};
export interface Session {access_token:string;refresh_token:string;expires_at?:number;user:{id:string;email?:string}}
let session:Session|null=null;
export let recovering=false;
export const cloudMode=():boolean=>runtime.mode==='cloud';
export const userId=():string|null=>session?.user.id??null;
const SESSION_KEY='notlinear_cloud_session_v1';
export async function configureRuntime():Promise<void>{
  recovering=false;
  const r=await fetch('/api/runtime');
  if(r.status===404) return; // older desktop servers
  if(!r.ok) throw new Error('Unable to load application configuration. Please retry.');
  runtime=await r.json();
  if(cloudMode()) {
    try{session=JSON.parse(sessionStorage.getItem(SESSION_KEY)??'null');}catch{session=null;}
    const fragment=new URLSearchParams(location.hash.slice(1));
    const hasRecovery=fragment.get('type')==='recovery'&&fragment.has('access_token')&&fragment.has('refresh_token');
    if(session&&!hasRecovery){
      let token:string|null=null;
      try{token=await accessToken();}catch(error){if(error instanceof AuthError&&[400,401,403].includes(error.status))setSession(null);else throw error;}
      if(token){
      const response=await fetch(runtime.supabaseUrl+'/auth/v1/user',{headers:{apikey:runtime.supabaseAnonKey,Authorization:'Bearer '+token}});
      if(response.status===401||response.status===403)setSession(null);
      else if(!response.ok)throw new Error('Account validation is temporarily unavailable.');
      else {const user=await response.json();if(typeof user.id!=='string')throw new Error('Invalid account response');setSession({...session!,user});}
      }
    }
    if(fragment.get('type')==='recovery'&&fragment.get('access_token')&&fragment.get('refresh_token')){
      const token=fragment.get('access_token')!;
      const response=await fetch(runtime.supabaseUrl+'/auth/v1/user',{headers:{apikey:runtime.supabaseAnonKey,Authorization:'Bearer '+token}});
      if(!response.ok)throw new Error('Recovery link expired.');
      setSession({access_token:token,refresh_token:fragment.get('refresh_token')!,expires_at:Date.now()/1000+Number(fragment.get('expires_in')??0),user:await response.json()});
      recovering=true;history.replaceState(null,'',location.pathname);
    }
  }
}
export function setSession(next:Session|null):void{
 session=next;
 if(next)sessionStorage.setItem(SESSION_KEY,JSON.stringify(next));else sessionStorage.removeItem(SESSION_KEY);
}
export class AuthError extends Error {constructor(message:string,public status:number){super(message);}}
let refreshing:Promise<void>|null=null;
export async function authRequest(path:string,body:object):Promise<Session>{
 const r=await fetch(runtime.supabaseUrl+'/auth/v1/'+path,{method:'POST',headers:{apikey:runtime.supabaseAnonKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw new AuthError(data.msg??data.error_description??'Unable to authenticate.',r.status);
 return data;
}
export async function accessToken():Promise<string>{
 if(!session)throw new Error('Sign in to continue.');
 if(!session.expires_at||session.expires_at<Date.now()/1000+60){
  refreshing??=authRequest('token?grant_type=refresh_token',{refresh_token:session.refresh_token}).then(setSession).finally(()=>{refreshing=null;});
  await refreshing;
 }
 return session!.access_token;
}
export class CloudError extends Error {constructor(message:string,public status:number){super(message);}}
export async function cloudRequest<T=unknown>(path:string,init:RequestInit={}):Promise<T>{
 const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+await accessToken());
 if(init.body)headers.set('Content-Type','application/json');
 const r=await fetch('/api'+path,{...init,headers});
 if(!r.ok){const data=await r.json().catch(()=>({}));throw new CloudError(data.detail??data.error??'Unable to save. Your local draft is preserved.',r.status);}
 return r.json();
}
export async function signOut():Promise<void>{
 // Full navigation disposes every feature store, open DB and provider request.
 if(session)await fetch(runtime.supabaseUrl+'/auth/v1/logout',{method:'POST',headers:{apikey:runtime.supabaseAnonKey,Authorization:'Bearer '+session.access_token}}).catch(()=>{});
 setSession(null);location.replace('/web/');
}
