/* eslint-disable @typescript-eslint/no-explicit-any -- SDK bridge events have provider-specific payloads. */
import type { ChatProvider, ChatRequest, ProviderEvent } from './types';

export type SubscriptionProvider = 'claude' | 'chatgpt';
export type SubscriptionModel = { id:string; label:string };
let session: Promise<{token:string;installed:boolean}> | undefined;
async function post(path:string, payload:object, signal?:AbortSignal) {
  const base = {'Content-Type':'application/json','X-Notlinear-Local':'1','X-Notlinear-Agent':'1'};
  session ??= fetch('/__notlinear_agents/session',{method:'POST',headers:base,body:'{}'}).then(r=>r.json());
  const auth = await session;
  if (!auth.installed) throw new Error('Install the subscription companion, then restart Notlinear.');
  const response = await fetch('/__notlinear_agents/'+path,{method:'POST',headers:{...base,'X-Notlinear-Session':auth.token},body:JSON.stringify(payload),signal});
  const data = await response.json();
  if(response.status===403) session=undefined;
  if(!response.ok) throw new Error(data.error || 'Subscription request failed.');
  return data;
}
export async function* subscriptionEvents(payload:object, signal?:AbortSignal):AsyncGenerator<Record<string,any>> {
  const {id}=await post('start',payload);
  const cancel=()=>{void post('cancel',{id}).catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  let cursor=0, done=false;
  try {
    if(signal?.aborted) throw new DOMException('Stopped','AbortError');
    for (;;) {
      const page=await post('poll',{id,cursor},signal); cursor=page.cursor;
      for (const event of page.events) { if(event.type==='error') throw new Error(event.message); if(event.type==='done'||event.type==='result') done=true; yield event; }
      if(page.finished){if(!done)throw new Error('Subscription request ended before completion.');return;}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
  } finally {signal?.removeEventListener('abort',cancel); if(!done)cancel();}
}
export async function subscriptionOperation(action:string,provider?:SubscriptionProvider):Promise<any>{
  for await(const event of subscriptionEvents({action,provider})) if(event.type==='result') return event.data;
}
export const subscriptionProvider:ChatProvider={
  id:'claude',caps:{thinking:true,nativeToolUse:true,maxToolRounds:0},
  async *stream(req:ChatRequest):AsyncGenerator<ProviderEvent>{
    const [,provider,...model]=req.model.split(':');
    try {
      for await(const event of subscriptionEvents({action:'run',provider,model:model.join(':'),messages:req.messages,systemPrompt:req.systemPrompt,research:true},req.signal)) {
        if(event.type==='delta')yield {t:'delta',text:event.text};
        else if(event.type==='thinking')yield {t:'thinking',text:event.text};
        else if(event.type==='status')yield {t:'status',label:event.text};
        else if(event.type==='done')yield {t:'done',text:event.text,usage:{inputTokens:event.usage?.inputTokens ?? 0,outputTokens:event.usage?.outputTokens ?? 0}};
      }
    } catch(e) {yield {t:'error',kind:req.signal.aborted?'aborted':'other',message:e instanceof Error?e.message:'Subscription request failed.'};}
  }
};
