import { applyFlags, type FeatureFlags } from '../flags';
import { cloudMode,cloudRequest } from '../cloud/client';
export interface Configuration {version:number;flags:FeatureFlags;overrides:Partial<FeatureFlags>;admin:boolean}
let configuration:Configuration|null=null;
const listeners=new Set<()=>void>();
export function getConfiguration():Configuration|null{return configuration;}
export function subscribeConfiguration(fn:()=>void):()=>void{listeners.add(fn);return()=>listeners.delete(fn);}
export async function refreshConfiguration():Promise<void>{
 const next=cloudMode()?await cloudRequest<Configuration>('/features'):await fetch('/api/features').then(async r=>r.ok?await r.json():null);
 if(!next)return;
 configuration=next;applyFlags(next.flags);listeners.forEach(fn=>fn());
}
export async function saveConfiguration(overrides:Partial<FeatureFlags>):Promise<void>{
 if(!configuration?.admin)throw new Error('Administrator access required.');
 await cloudRequest('/admin/features',{method:'PUT',body:JSON.stringify({version:configuration.version,overrides})});
 await refreshConfiguration();
}
export function watchConfiguration():()=>void{
 const refresh=()=>{void refreshConfiguration().catch(()=>{/* Keep last server configuration; server still enforces changes. */});};
 window.addEventListener('focus',refresh);const interval=setInterval(refresh,60000);
 return()=>{window.removeEventListener('focus',refresh);clearInterval(interval);};
}
