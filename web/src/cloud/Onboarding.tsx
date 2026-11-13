import { useEffect,useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { accountStorage } from './local-storage';
import { cloudRequest } from './client';
import { useAppStore } from '../state/app-store';
import { useBranchStore } from '../branch/branch-store';
import { syncStatus,subscribeSync } from './database';
import { track } from './events';
import { flags } from '../flags';
interface Journey {resource_key:string;revision:number;value:{step:number}}
const journey=create<{step:number;revision:number;loaded:boolean}>(()=>({step:Number(accountStorage.getItem('onboarding-step')??'0'),revision:0,loaded:false}));
let loading:Promise<void>|null=null,writes:Promise<void>=Promise.resolve();
function loadJourney(){
 loading??=cloudRequest<Journey[]>('/resources/onboarding').then(rows=>{const row=rows.find(r=>r.resource_key==='journey');journey.setState(row?{step:row.value.step,revision:row.revision,loaded:true}:{loaded:true});}).catch(()=>{journey.setState({loaded:true});});
 return loading;
}
function advance(step:number){
 const previous=journey.getState().step;
 if(step===2)track('first_answer',true);if(step===3)track('branch_created',true);if(step===4&&previous===3)track('workspace_saved',true);
 journey.setState({step});accountStorage.setItem('onboarding-step',String(step));
 writes=writes.catch(()=>{}).then(async()=>{const row=await cloudRequest<Journey>('/resources/onboarding',{method:'PUT',body:JSON.stringify({key:'journey',revision:journey.getState().revision,value:{step}})});journey.setState({revision:row.revision});});
 void writes.catch(()=>{});
}
export function Onboarding({placement='connection'}:{placement?:'connection'|'inline'}){
 const {step,loaded}=journey();
 const keys=useAppStore(s=>s.apiKeys),threads=useAppStore(s=>s.threadState),branches=useBranchStore(s=>s.open);
 useSyncExternalStore(subscribeSync,()=>JSON.stringify(syncStatus()));
 useEffect(()=>{void loadJourney();},[]);
 const answered=Object.values(threads).some(t=>Array.isArray(t?.mainMessages)&&t.mainMessages.some((m:unknown)=>!!m&&typeof m==='object'&&(m as {role?:string}).role==='assistant'));
 const branched=Object.keys(branches).length>0||Object.values(threads).some(t=>Object.keys(t?.branchSnapshots??{}).length>0);
 if(!loaded||step>=4||(placement==='connection'&&step!==0)||(placement==='inline'&&step===0))return null;
 const canContinue=step===0?Object.keys(keys).length>0:step===1?answered:step===2?branched:syncStatus().status==='Saved';
 const content=<aside className={step===0?'w-full max-w-xl rounded-xl border border-rule bg-surface p-8 shadow-lg':'my-5 rounded-xl border border-rule bg-surface p-5'} aria-label="Getting started">
 <p className="mb-2 text-xs text-text-3">Getting started · {step+1} of 4</p>
 <h2 className="text-xl font-semibold">{['Connect your AI access','Start with your own question','Explore a branch','Your workspace is ready'][step]}</h2>
 <p className="my-3 text-sm text-text-2">{['Choose the subscription you already use.','Ask about something you are working on, or attach a document. Continue after your first answer arrives.','Highlight a passage in an answer and ask a follow-up in a branch. Return to the original thread when ready.','Your chats and branches are saved to your account. Explore Canvas, Notes and Projects whenever you need them.'][step]}</p>
 {step===0&&<div className="my-5 grid gap-3">
 {([{id:'chatgpt',label:'ChatGPT',flag:flags.subscriptionChatgpt},{id:'claude',label:'Claude',flag:flags.subscriptionClaude}] as const).filter(provider=>provider.flag).map(provider=><button key={provider.id} type="button" aria-label={`Authenticate via ${provider.label} subscription`} disabled className="flex items-center gap-3 rounded-xl border border-rule bg-surface p-4 text-left disabled:cursor-not-allowed" aria-describedby="subscription-availability">
 <img src={`/web/provider-logos/${provider.id==='claude'?'claude-color':'openai'}.svg`} alt="" className="h-7 w-7"/>
 <span><span className="block font-medium">Authenticate via {provider.label} subscription</span><span className="block text-xs text-text-3">Not available in the web beta yet</span></span>
 </button>)}
 <p id="subscription-availability" className="text-xs text-text-3">Subscription sign-in needs provider approval and a hosted connection. Neither is configured for this beta yet. You can explore your workspace while these connections are being prepared.</p>
 </div>}
 <div className="flex items-center gap-4">
 <button className="disabled:cursor-not-allowed disabled:opacity-40" disabled={!canContinue} onClick={()=>advance(step+1)}>{step===3?'Open workspace':'Continue'}</button>
 <button className="text-text-3" onClick={()=>advance(4)}>{step===0?'Explore saved work':'Later'}</button>
 </div></aside>;
 return step===0?<div className="fixed inset-0 z-[250] flex items-center justify-center bg-bg p-8">{content}</div>:content;
}
