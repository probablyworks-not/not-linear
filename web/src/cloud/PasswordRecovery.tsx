import { useState } from 'react';
import { accessToken,runtime,setSession } from './client';
export function PasswordRecovery(){
 const [password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 return <main className="mx-auto flex max-w-md flex-col gap-4 p-8"><h1 className="text-xl font-semibold">Choose a new password</h1>
 <form className="flex flex-col gap-4" onSubmit={e=>{e.preventDefault();setBusy(true);void (async()=>{
  try{const response=await fetch(runtime.supabaseUrl+'/auth/v1/user',{method:'PUT',headers:{apikey:runtime.supabaseAnonKey,Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'},body:JSON.stringify({password})});
   if(!response.ok)throw new Error('Unable to reset password. Request another recovery link.');
   setSession(null);location.replace('/web/');
  }catch(error){setMessage(String(error));}finally{setBusy(false);}
 })();}}><label>New password<input aria-label="New password" className="block border border-rule bg-bg p-3" type="password" minLength={8} required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
 <button disabled={busy}>Save password</button></form><p role="status">{message}</p></main>;
}
