import { planModel } from '../chat/models';
import { runTurn } from '../chat/run-turn';
import { claudeProvider } from '../providers/claude';
import { deepseekProvider } from '../providers/deepseek';
import { openaiProvider, geminiProvider } from '../providers/openai';
import { readApiKeys } from '../lib/api-keys';
import { useAppStore } from '../state/app-store';
import { buildSystemPrompt } from '../chat/system-prompt';
import { sketchProjectContext } from './project-context';
import { sketchPrompt } from './prompt';
import { userContentFor } from '../chat/user-content';
import type { SketchDocument } from './store';
export async function askSketch(doc:SketchDocument, mode:'ask'|'edit',selectedIds:string[],signal:AbortSignal,onDelta:(text:string)=>void,context?:{canvasId?:string;onStatus?:(text:string)=>void}):Promise<string>{
 const prefs={...useAppStore.getState().prefs};const plan=planModel(prefs.model,!!prefs.thinking);
 if(!plan.supported)throw new Error(plan.reason);
 const images=doc.messages.filter(m=>m.role==='user').flatMap(m=>m.images??[]);
 if(images.length && plan.provider==='deepseek')throw new Error('Image-to-Sketch needs a vision model. Choose Claude, OpenAI or Gemini in Settings.');
 context?.onStatus?.('Reading Canvas and project context…');
 const inherited=await sketchProjectContext(doc.id,context?.canvasId,doc.messages.filter(m=>m.role==='user').at(-1)?.content||'',prefs,signal);
 const systemPrompt=buildSystemPrompt({prefs,project:inherited.project,apiKeys:inherited.apiKeys,extraContext:inherited.extraContext})+'\n\n'+sketchPrompt(mode)+'\nSketch output contract overrides general prose, reference-list and HTML formatting instructions. Use available tools to inspect supplied project evidence before answering or editing; an empty graph does not mean project context is absent.';
 context?.onStatus?.('Thinking…');
 const content=JSON.stringify({graph:doc.graph,revision:doc.revision,selectedIds,conversation:doc.messages.map(({role,content,mode,images})=>({role,content,mode,images:images?.map(i=>i.name)}))});
 for await(const {ev} of runTurn({messagesFor:provider=>{if(images.length&&provider==='deepseek')throw new Error('This provider cannot read images. Choose a vision model.');return [{role:'user',content:userContentFor(provider,content,images)}];},systemPrompt,plan,signal,tools:inherited.tools,toolRunner:inherited.toolRunner},{
  providers:{claude:claudeProvider,deepseek:deepseekProvider,openai:openaiProvider,gemini:geminiProvider},canFallBackToDeepSeek:!images.length&&!!readApiKeys().deepseek,
 })){
  signal.throwIfAborted();
  if(ev.t==='status')context?.onStatus?.(ev.label||'Thinking…');
  if(ev.t==='delta'&&mode==='ask')onDelta(ev.text);
  if(ev.t==='error')throw new Error(ev.message);
  if(ev.t==='done'){if(mode==='edit'&&ev.usage?.stopReason==='max_tokens')throw new Error('Sketch generation was cut off. Try a smaller flow.');return ev.text;}
 }
 throw new Error('Response ended unexpectedly. No changes applied.');
}
