import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { runTurn } from '../../src/chat/run-turn';
import { askSketch } from '../../src/sketch/ai';
import { emptyGraph } from '../../src/sketch/model';
import { useSketchStore, type SketchDocument } from '../../src/sketch/store';
import { useAppStore } from '../../src/state/app-store';
import { createCanvas,updateCanvas,resetCanvasDbForTests } from '../../src/canvas/canvas-repo';
import { clearProjectContextCaches } from '../../src/chat/project-context';
import { setToolEnvForTests } from '../../src/tools/env';
import type { PersistedProject } from '../../src/db/types';
vi.mock('../../src/chat/run-turn',()=>({runTurn:vi.fn()}));
const doc:SketchDocument={version:1,id:'sketch-a',title:'Flow',revision:0,graph:emptyGraph(),updatedAt:1,messages:[{role:'user',mode:'ask',content:'Map the agent repository'}]};
const owner:PersistedProject={id:'owner',name:'Owning project',rules:'Use repository evidence',path:'/repo/owner',files:[{name:'requirements.md',content:'Owner upload: onboarding rules',kind:'file',type:'text/plain',size:30}]};
const posts:Array<{url:string;body:Record<string,unknown>}>=[];
beforeEach(()=>{
 vi.clearAllMocks();clearProjectContextCaches();posts.length=0;
 resetCanvasDbForTests('sketch-context-'+crypto.randomUUID());
 useSketchStore.setState({placements:{}});
 useAppStore.setState({prefs:{model:'sonnet',rankingLlm:'keywords'},projects:{owner:structuredClone(owner),other:{...owner,id:'other',name:'Unrelated project',path:'/repo/other',rules:'OTHER_PRIVATE_RULE',files:[]}}});
 setToolEnvForTests(()=>({apiKeys:{}}));
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body??'{}'));posts.push({url:String(url),body});
  const data=String(url).includes('scan_project')?{ok:true,contextFiles:[{present:true,filename:'agents.ts',relativePath:'src/agents.ts',text:`Agent Orion routes to Vega in ${body.path}`}]}:String(url).includes('list_dir')?{ok:true,entries:[{name:'agents.ts',type:'file'}]}:{ok:true,text:'Orion calls Vega',start:0,end:16,total:16};
  return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 }));
});
afterEach(()=>{setToolEnvForTests(null);vi.unstubAllGlobals();});
async function canvas(projectId:string|null='owner'){
 const c=await createCanvas({projectId,title:'Project architecture'});
 await updateCanvas(c.summary.id,d=>{d.memory=[{id:'memory',text:'Canvas memory: onboarding uses email verification',createdAt:1}];d.files=[{id:'file',name:'canvas-guide.txt',content:'Canvas attachment evidence',mime:'text/plain',size:26,createdAt:1}];});
 return c.summary.id;
}
it.each(['ask','edit'] as const)('inherits project rules/uploads, Canvas memory/files and real folder tools in %s',async mode=>{
 const id=await canvas();
 vi.mocked(runTurn).mockImplementation(async function*(input){
  expect(input.systemPrompt).toContain('Use repository evidence');expect(input.systemPrompt).toContain('Owner upload: onboarding rules');expect(input.systemPrompt).toContain('Canvas memory: onboarding');expect(input.systemPrompt).toContain('Canvas attachment evidence');expect(input.systemPrompt).toContain('Agent Orion');expect(input.systemPrompt).not.toContain('OTHER_PRIVATE_RULE');
  expect(input.tools?.map(t=>t.name)).toEqual(expect.arrayContaining(['list_project_files','read_project_file','fetch_url']));expect(input.tools?.map(t=>t.name)).not.toContain('create_note');
  expect(await input.toolRunner!('list_project_files',{path:''},input.signal)).toContain('agents.ts');
  expect(await input.toolRunner!('read_project_file',{path:'src/agents.ts',folderRoot:'/injected'},input.signal)).toContain('Vega');
  yield {plan:input.plan,ev:{t:'done',text:mode==='edit'?'{"revision":0,"operations":[]}':'Repository explained'}};
 });
 await askSketch(doc,mode,[],new AbortController().signal,()=>{},{canvasId:id});
 expect(posts.find(p=>p.url.includes('read_file'))?.body).toMatchObject({path:'/repo/owner',file:'src/agents.ts'});
 expect(doc.graph).toEqual(emptyGraph());
});
it('does not use a different project after a tab or folder switch during the request',async()=>{
 const id=await canvas();
 vi.mocked(runTurn).mockImplementation(async function*(input){
  useAppStore.setState({projects:{...useAppStore.getState().projects,owner:{...owner,path:'/repo/changed'}},currentThreadId:'other-thread'});
  await input.toolRunner!('read_project_file',{path:'src/agents.ts'},input.signal);
  yield {plan:input.plan,ev:{t:'done',text:'OK'}};
 });
 await askSketch(doc,'ask',[],new AbortController().signal,()=>{},{canvasId:id});
 expect(posts.find(p=>p.url.includes('read_file'))?.body.path).toBe('/repo/owner');
});
it('does not borrow project access for an unassigned Canvas',async()=>{
 const id=await canvas(null);
 vi.mocked(runTurn).mockImplementation(async function*(input){expect(input.tools?.map(t=>t.name)).not.toContain('read_project_file');expect(input.systemPrompt).not.toContain('Owner upload');expect(input.systemPrompt).toContain('Canvas attachment evidence');yield {plan:input.plan,ev:{t:'done',text:'OK'}};});
 await askSketch(doc,'ask',[],new AbortController().signal,()=>{},{canvasId:id});expect(posts).toEqual([]);
});
it('uses the one stored Canvas association for a library document, and refuses ambiguous associations',async()=>{
 const id=await canvas();const p={id:'p1',documentId:doc.id,canvasId:id,x:0,y:0,width:1120,height:760};useSketchStore.setState({placements:{p1:p}});
 vi.mocked(runTurn).mockImplementation(async function*(input){expect(input.systemPrompt).toContain('Owner upload');yield {plan:input.plan,ev:{t:'done',text:'OK'}};});
 await askSketch(doc,'ask',[],new AbortController().signal,()=>{});
 useSketchStore.setState({placements:{p1:p,p2:{...p,id:'p2',canvasId:'different'}}});
 await expect(askSketch(doc,'ask',[],new AbortController().signal,()=>{})).rejects.toThrow(/inside the Canvas/);expect(runTurn).toHaveBeenCalledTimes(1);
});
it('uses fresh linked-folder evidence when the owning project changes folders',async()=>{
 const id=await canvas();const prompts:string[]=[];
 vi.mocked(runTurn).mockImplementation(async function*(input){prompts.push(input.systemPrompt);yield {plan:input.plan,ev:{t:'done',text:'OK'}};});
 await askSketch(doc,'ask',[],new AbortController().signal,()=>{},{canvasId:id});useAppStore.setState({projects:{owner:{...owner,path:'/repo/new-root'}}});
 await askSketch(doc,'ask',[],new AbortController().signal,()=>{},{canvasId:id});expect(prompts[1]).toContain('/repo/new-root');expect(prompts[1]).not.toContain('/repo/owner');
});
