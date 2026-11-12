import { useState } from 'react';
import { featureDefaults,resolveFlags,type FeatureFlags,type FeatureId } from '../../flags';
import { getConfiguration,saveConfiguration } from '../../features/configuration';
import { PageBody } from '../ui';
export function FeatureFlagsTab(){
 const config=getConfiguration();
 const [draft,setDraft]=useState<Partial<FeatureFlags>>(config?.overrides??{});
 const effective=resolveFlags(draft);
 const label=(key:string)=>({chat:'Chats',notesV2:'Notes',canvas:'Canvas',projects:'Projects',chatNotes:'Chat to Notes',apiAnthropic:'Anthropic API',apiOpenai:'OpenAI API',apiDeepseek:'DeepSeek API',apiGemini:'Gemini API',apiCustom:'Custom provider',changelog:'Product updates',logs:'Runtime logs'} as Record<string,string>)[key]??key.replace(/([A-Z])/g,' $1').replace(/^./,letter=>letter.toUpperCase());
 const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);
 if(!config?.admin)return null;
 const save=async()=>{setBusy(true);try{await saveConfiguration(draft);setStatus('Feature configuration saved.');}catch(e){setStatus(e instanceof Error?e.message:'Save failed');}finally{setBusy(false);}};
 return <PageBody><p>Changes apply to all users in this environment. Disabling a feature preserves saved work.</p>
 {Object.entries(featureDefaults).map(([key,value])=><label key={key} className="flex items-center gap-3 border-b border-rule py-3">
 <input type="checkbox" checked={draft[key as FeatureId]??value} onChange={e=>setDraft({...draft,[key]:e.target.checked})}/>
 <span>{label(key)}</span>{(draft[key as FeatureId]??value)&&!effective[key as FeatureId]&&<span className="text-xs text-text-3">Requires another enabled feature</span>}<span className="ml-auto text-xs text-text-3">Default: {value?'on':'off'}</span></label>)}
 <button type="button" disabled={busy} onClick={()=>void save()} className="mt-4 rounded-lg bg-text px-4 py-2 text-bg">Save flags</button>
 <p role="status">{status}</p></PageBody>;
}
