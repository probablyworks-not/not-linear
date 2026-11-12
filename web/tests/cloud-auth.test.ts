import { it,expect,vi,afterEach } from 'vitest';
import { configureRuntime,userId,setSession } from '../src/cloud/client';
afterEach(()=>{setSession(null);sessionStorage.clear();vi.unstubAllGlobals();history.replaceState(null,'',location.pathname);});
const runtime={mode:'cloud',supabaseUrl:'https://auth.example.test',supabaseAnonKey:'public-key',subscriptions:{claude:false,chatgpt:false}};
it('uses verified account identity rather than cached client-supplied user IDs',async()=>{
 sessionStorage.setItem('notlinear_cloud_session_v1',JSON.stringify({access_token:'jwt',refresh_token:'refresh',expires_at:Date.now()/1000+3600,user:{id:'spoofed'}}));
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url==='/api/runtime'?runtime:{id:'verified-user'}),{status:200,headers:{'Content-Type':'application/json'}})));
 await configureRuntime();expect(userId()).toBe('verified-user');
});
it('an expired unauthorized session cannot select another account cache',async()=>{
 sessionStorage.setItem('notlinear_cloud_session_v1',JSON.stringify({access_token:'jwt',refresh_token:'refresh',expires_at:Date.now()/1000+3600,user:{id:'old-user'}}));
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url==='/api/runtime'?runtime:{}),{status:url==='/api/runtime'?200:401,headers:{'Content-Type':'application/json'}})));
 await configureRuntime();expect(userId()).toBeNull();
});

it('a valid recovery link supersedes an expired stored session',async()=>{
 sessionStorage.setItem('notlinear_cloud_session_v1',JSON.stringify({access_token:'expired',refresh_token:'expired-refresh',expires_at:1,user:{id:'old-user'}}));
 history.replaceState(null,'',location.pathname+'#type=recovery&access_token=new-token&refresh_token=new-refresh&expires_in=3600');
 const calls=vi.fn(async(url:string)=>new Response(JSON.stringify(url==='/api/runtime'?runtime:{id:'recovered-user'}),{status:200,headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',calls);
 await configureRuntime();expect(userId()).toBe('recovered-user');expect(calls).toHaveBeenCalledTimes(2);expect(location.hash).toBe('');
});
it('invalid refresh credentials return to sign-in without loading cached content',async()=>{
 sessionStorage.setItem('notlinear_cloud_session_v1',JSON.stringify({access_token:'expired',refresh_token:'expired-refresh',expires_at:1,user:{id:'old-user'}}));
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url==='/api/runtime'?runtime:{error_description:'Session expired'}),{status:url==='/api/runtime'?200:400,headers:{'Content-Type':'application/json'}})));
 await configureRuntime();expect(userId()).toBeNull();
});
