import { beforeEach,it,expect,vi } from 'vitest';
import { runTurn } from '../../src/chat/run-turn';
import { useAppStore } from '../../src/state/app-store';
import { askSketch } from '../../src/sketch/ai';
import { emptyGraph } from '../../src/sketch/model';
import type { SketchDocument } from '../../src/sketch/store';
vi.mock('../../src/chat/run-turn',()=>({runTurn:vi.fn()}));
const doc:SketchDocument={version:1,id:'vision',title:'Vision',revision:0,graph:emptyGraph(),updatedAt:1,messages:[{role:'user',mode:'edit',content:'Create this',images:[{name:'flow.png',type:'image/png',size:4,kind:'image',content:null,base64:'aW1hZ2U='}]}]};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();useAppStore.setState({prefs:{model:'gpt-4o'}});});
it('sends actual image bytes, graph and image names to vision providers, without silent DeepSeek fallback',async()=>{
 localStorage.setItem('nl_api_keys',JSON.stringify({deepseek:'test'}));
 vi.mocked(runTurn).mockImplementation(async function*(input,deps){
  const message=input.messagesFor('openai')[0]!;expect(Array.isArray(message.content)).toBe(true);
  const blocks=message.content as Array<{type:string;source?:{data:string};text?:string}>;
  expect(blocks.find(b=>b.type==='image')?.source?.data).toBe('aW1hZ2U=');
  expect(blocks.find(b=>b.type==='text')?.text).toContain('flow.png');
  expect(blocks.find(b=>b.type==='text')?.text).not.toContain('aW1hZ2U=');
  expect(deps.canFallBackToDeepSeek).toBe(false);expect(input.tools?.map(t=>t.name)).toContain('fetch_url');expect(input.toolRunner).toBeTypeOf('function');
  yield {plan:input.plan,ev:{t:'done',text:'{"revision":0,"operations":[]}'}};
 });
 await expect(askSketch(doc,'edit',[],new AbortController().signal,()=>{})).resolves.toContain('operations');
});
it('explains unsupported vision instead of dropping the image',async()=>{
 useAppStore.setState({prefs:{model:'deepseek'}});
 await expect(askSketch(doc,'edit',[],new AbortController().signal,()=>{})).rejects.toThrow(/vision model/);expect(runTurn).not.toHaveBeenCalled();
});
it('rejects a token-truncated edit rather than accepting partial JSON',async()=>{
 vi.mocked(runTurn).mockImplementation(async function*(input){yield {plan:input.plan,ev:{t:'done',text:'{"revision":0',usage:{inputTokens:1,outputTokens:2,stopReason:'max_tokens'}}};});
 await expect(askSketch(doc,'edit',[],new AbortController().signal,()=>{})).rejects.toThrow(/cut off/);
});
