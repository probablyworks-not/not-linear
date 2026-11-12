import { useState } from 'react';
import { authRequest,setSession } from './client';
export function AccountGate({onReady}:{onReady:()=>Promise<void>}){
 const [mode,setMode]=useState<'welcome'|'signin'|'signup'|'recover'>('welcome');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const submit=async()=>{setBusy(true);setError('');try{
  const data=await authRequest(mode==='signup'?'signup':mode==='recover'?'recover':'token?grant_type=password',{email,password});
  if(mode==='recover'){setError('If this account exists, a recovery email will arrive.');return;}
  if(!data.access_token)throw new Error('Account created. Sign in to continue; email confirmation may be required by this server.');
  setSession(data);await onReady();
 }catch(e){setError(e instanceof Error?e.message:'Sign-in failed.');}finally{setBusy(false);}};
 return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-8">
 <h1 className="text-3xl font-semibold">{mode==='welcome'?'Explore an idea without losing your train of thought.':mode==='signup'?'Create your workspace':mode==='recover'?'Reset your password':'Welcome back'}</h1>
 <p className="text-text-2">Connect your own AI access, ask a question, and branch into anything worth exploring. Free during beta; provider limits apply.</p>
 {mode==='welcome'?<><button onClick={()=>setMode('signup')} className="rounded-lg bg-text p-3 text-bg">Create your workspace</button><button onClick={()=>setMode('signin')}>Sign in</button></>:<form onSubmit={e=>{e.preventDefault();void submit();}} className="flex flex-col gap-4">
 <label>Email<input className="block w-full rounded border border-rule bg-bg p-3" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
 {mode!=='recover'&&<label>Password<input className="block w-full rounded border border-rule bg-bg p-3" type="password" minLength={8} required autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
 <button disabled={busy} className="rounded-lg bg-text p-3 text-bg">{busy?'Please wait…':mode==='signup'?'Create account':mode==='recover'?'Send reset link':'Sign in'}</button>
 <button type="button" onClick={()=>setMode(mode==='signin'?'signup':'signin')}>{mode==='signin'?'Create an account':'Back to sign in'}</button>
 {mode==='signin'&&<button type="button" onClick={()=>setMode('recover')}>Forgot password?</button>}
 </form>}
 <p role="status">{error}</p></main>;
}
