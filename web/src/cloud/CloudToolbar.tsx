import { InstallApp } from './InstallApp';
import { downloadArchive,importArchive } from './archive';
import { useSyncExternalStore,useState,useRef,useEffect } from 'react';
import { syncStatus,subscribeSync,flushCloud,clearAccountCache } from './database';
import { cloudRequest,signOut } from './client';
import { getConfiguration } from '../features/configuration';
import { useUiStore } from '../state/ui-store';
import { Onboarding } from './Onboarding';
export function CloudToolbar(){
 const toolbar=useRef<HTMLDivElement>(null);
 useEffect(()=>{const element=toolbar.current;if(!element)return;const resize=()=>document.documentElement.style.setProperty('--cloud-toolbar-height',element.getBoundingClientRect().height+'px');resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();},[]);
 useSyncExternalStore(subscribeSync,()=>JSON.stringify(syncStatus()));
 const {status,error}=syncStatus();const [message,setMessage]=useState('');
 const exportData=async()=>{try{await downloadArchive();}catch(e){setMessage(String(e));}};
 const logout=async()=>{try{await flushCloud();signOut();}catch{setMessage('Save failed. Export your work before signing out.');}};
 return <><div ref={toolbar} className="sticky top-0 z-[400] flex flex-wrap items-center justify-end gap-3 border-b border-rule bg-bg px-4 py-1 text-xs">
 <span className="mr-auto text-sm font-semibold">notlinear</span><InstallApp/><span role="status" title={error}>{status}</span>{error&&<button onClick={()=>void flushCloud().catch(e=>setMessage(String(e)))}>Retry save</button>}{error&&<button onClick={()=>location.assign('/web/?recover=1')}>Resolve sync problem</button>}
 <button onClick={()=>useUiStore.getState().openSettings('general')}>Account & settings</button>
 {getConfiguration()?.admin&&<button onClick={()=>useUiStore.getState().openSettings('featureFlags')}>Feature flags</button>}
 <button onClick={()=>void exportData()}>Export account</button>
 <label className="cursor-pointer">Import backup<input aria-label="Import backup" type="file" accept="application/json,.json" className="hidden" onChange={e=>{const file=e.target.files?.[0];if(file)void importArchive(file).then(result=>setMessage(`Imported ${result.imported}; ${result.existing} existing records preserved. Reload to view imported work.`)).catch(error=>setMessage(String(error)));e.target.value='';}}/></label><button onClick={()=>void logout()}>Sign out</button>
 <button onClick={()=>{if(confirm('Delete your account and all cloud content?'))void cloudRequest('/account',{method:'DELETE'}).then(async()=>{await clearAccountCache().catch(()=>{});await signOut();}).catch(e=>setMessage(String(e)));}}>Delete account</button>
 {message&&<span role="alert">{message}</span>}</div><Onboarding/></>;
}
