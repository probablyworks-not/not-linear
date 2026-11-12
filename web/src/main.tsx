import { CloudRecovery } from './cloud/CloudRecovery';
import { track } from './cloud/events';
import { createRoot } from 'react-dom/client';
import { configureRuntime,cloudMode,userId,recovering } from './cloud/client';
import { refreshConfiguration } from './features/configuration';
import { AccountGate } from './cloud/AccountGate';
import { PasswordRecovery } from './cloud/PasswordRecovery';
import './styles/app.css';
const root=createRoot(document.getElementById('root')!);
const pendingKeys:KeyboardEventInit[]=[];
const earlyKeys=(event:KeyboardEvent)=>{
 if(!(event.metaKey||event.ctrlKey)||!['/','n','k','b','c','r'].includes(event.key.toLowerCase()))return;
 event.preventDefault();pendingKeys.push({key:event.key,code:event.code,metaKey:event.metaKey,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,altKey:event.altKey,bubbles:true});
};
document.addEventListener('keydown',earlyKeys);
function finishStartup(replay:boolean){document.removeEventListener('keydown',earlyKeys);const keys=pendingKeys.splice(0);if(replay)for(const key of keys)document.dispatchEvent(new KeyboardEvent('keydown',key));}
root.render(<div role="status" className="p-8">Loading workspace…</div>);

export async function enterWorkspace(){
 if(cloudMode()&&'serviceWorker' in navigator)void navigator.serviceWorker.register('/web/sw.js').catch(()=>{});
 await refreshConfiguration();
 if(cloudMode())track('workspace_returned');
 if(cloudMode()){const {refreshCloudKeys}=await import('./cloud/provider-fetch');await refreshCloudKeys();}
 const {boot}=await import('./boot');await boot(root);finishStartup(true);
}
void configureRuntime().then(async()=>{
 if(cloudMode()&&userId()&&new URLSearchParams(location.search).has('recover')){finishStartup(false);root.render(<CloudRecovery/>);return;}
 if(recovering){finishStartup(false);root.render(<PasswordRecovery/>);return;}
 if(cloudMode()&&!userId()){finishStartup(false);root.render(<AccountGate onReady={enterWorkspace}/>);}
 else await enterWorkspace();
}).catch(()=>{finishStartup(false);if(cloudMode()&&userId()){root.render(<CloudRecovery/>);return;}root.render(<div role="alert" className="p-8">Unable to load your workspace. Your saved data has not been cleared. <button onClick={()=>location.reload()}>Retry</button></div>);});
