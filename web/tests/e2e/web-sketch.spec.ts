import { emptyState } from '../../src/db/thread-ops';
import { test,expect,type Page,type Locator } from '@playwright/test';
import type { SketchDocument } from '../../src/sketch/store';
async function saved(page:Page,card:Locator):Promise<SketchDocument>{
 const id=await card.getAttribute('data-sketch');
 return page.evaluate(id=>new Promise<SketchDocument>((resolve,reject)=>{
  const open=indexedDB.open('notlinear-sketch');open.onerror=()=>reject(open.error);open.onsuccess=()=>{
   const db=open.result,get=db.transaction('documents').objectStore('documents').get(id!);
   get.onsuccess=()=>{resolve(get.result);db.close();};get.onerror=()=>reject(get.error);
  };
 }),id);
}
const events=(text:string)=>[
 {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
 {type:'content_block_delta',index:0,delta:{type:'text_delta',text}},
 {type:'content_block_stop',index:0},
 {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:20}},
].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('');
async function enter(page:Page){
 await page.addInitScript(()=>{localStorage.setItem('nl_api_keys',JSON.stringify({anthropic:'sk-test'}));localStorage.setItem('nl_autohide_bars','0');});
 await page.route('**/__notlinear_runtime_logs',r=>r.fulfill({json:{ok:true}}));
 await page.goto('/web/');await page.getByRole('button',{name:'Open left pane'}).click();await page.getByRole('button',{name:'New canvas',exact:true}).click();await page.getByRole('button',{name:'Close left pane'}).click();
}
test('Sketch opens as a Canvas card; create-first, image input, routing, Ask/Edit and persistence work in place',async({page})=>{
 test.setTimeout(90_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
 const canvasId=await page.getByTestId('canvas-workspace').getAttribute('data-canvas');const beforeTabs=await page.getByRole('tab').count();
 await page.getByTestId('canvas-sketch').click();await expect(page.getByTestId('canvas-sketch-card')).toHaveCount(1);const firstId=await page.getByTestId('canvas-sketch-card').getAttribute('data-sketch');const card=page.locator(`[data-testid="canvas-sketch-card"][data-sketch="${firstId}"]`);
 await expect(card).toBeVisible();expect(await page.getByTestId('canvas-workspace').getAttribute('data-canvas')).toBe(canvasId);await expect(page.getByRole('tab')).toHaveCount(beforeTabs);
 await expect(card.getByRole('button',{name:'Edit',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(card.getByRole('button',{name:'Create Sketch',exact:true})).toBeVisible();
 await expect.poll(async()=>{
  const h=await card.locator('.sketch-card-drag').boundingBox(),pane=await page.locator('.react-flow').first().boundingBox();
  return !!h&&!!pane&&h.y>=pane.y-1&&h.y+h.height<=pane.y+pane.height;
 }).toBe(true);
 await card.locator('.sketch-card-drag').hover();const beforeMove=await card.boundingBox();
 const grip=await card.locator('.sketch-card-drag').boundingBox();
 await page.mouse.move(grip!.x+80,grip!.y+grip!.height/2);await page.mouse.down();await page.mouse.move(grip!.x+95,grip!.y+grip!.height/2,{steps:8});await page.mouse.up();
 const movedCard=await card.boundingBox();expect(movedCard).not.toBeNull();expect(movedCard!.x).toBeGreaterThan(beforeMove!.x+5);
 const resize=page.locator('.react-flow__node-sketch').first().locator('.react-flow__resize-control.handle.bottom.right');
 await expect(resize).toBeVisible();await resize.hover();const handle=await resize.boundingBox();
 await page.mouse.move(handle!.x+handle!.width/2,handle!.y+handle!.height/2);await page.mouse.down();await page.mouse.move(handle!.x+handle!.width/2+35,handle!.y+handle!.height/2,{steps:8});await page.mouse.up();
 await expect.poll(async()=>(await card.boundingBox())!.width).toBeGreaterThan(movedCard!.width+10);

 // Reference screenshot is transmitted as native image data, not merely its filename.
 let kind='create',delay=0,sawImage=false;
 await page.route('https://api.anthropic.com/v1/messages',async route=>{
  const body=route.request().postDataJSON() as {messages:Array<{content:string|Array<{type:string;source?:{data:string};text?:string}>}>},blocks=body.messages[0]!.content;
  sawImage=Array.isArray(blocks)&&blocks.some(b=>b.type==='image'&&!!b.source?.data.length);
  const text=typeof blocks==='string'?blocks:blocks.find(b=>b.type==='text')!.text!;
  const context=JSON.parse(text.split('User request:\n').pop()!);
  const response=kind==='ask'?'The flow needs an abandonment path.':JSON.stringify({revision:context.revision,operations:kind==='create'?[
   {op:'addNode',id:'start',type:'start',label:'Start'},{op:'addNode',id:'signup',type:'step',label:'Sign up'},{op:'addNode',id:'verify',type:'decision',label:'Email verified?'},{op:'addNode',id:'retry',type:'step',label:'Resend email'},{op:'addNode',id:'dashboard',type:'step',label:'Open dashboard'},{op:'addNode',id:'upload',type:'step',label:'Upload PDF'},{op:'addNode',id:'valid',type:'decision',label:'PDF valid?'},{op:'addNode',id:'analysis',type:'step',label:'Analyze PDF'},{op:'addNode',id:'download',type:'end',label:'View or download results'},
   ...[['start','signup',''],['signup','verify',''],['verify','retry','No'],['retry','verify','Retry'],['verify','dashboard','Yes'],['dashboard','upload',''],['upload','valid',''],['valid','upload','Retry'],['valid','analysis','Yes'],['analysis','download','']].map(([source,target,label],i)=>({op:'addEdge',id:'edge-'+i,source,target,label})),
  ]:kind==='bad'?[{op:'updateNode',id:'signup',label:'Must not apply'},{op:'addEdge',id:'bad',source:'missing',target:'signup'}]:[{op:'addNode',id:'late',type:'step',label:'Late response'}]});
  if(delay)await new Promise(r=>setTimeout(r,delay));await route.fulfill({contentType:'text/event-stream',body:events(response)}).catch(()=>{});
 });
 await card.getByLabel('Reference images').setInputFiles({name:'flow.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=','base64')});
 await card.getByRole('button',{name:'Create Sketch',exact:true}).click();await expect(card.locator('.x6-node')).toHaveCount(9);expect(sawImage).toBe(true);
 await expect(card.getByRole('button',{name:'Saved locally',exact:true})).toBeVisible();const created=await saved(page,card);expect(created.messages[0]?.images?.[0]?.name).toBe('flow.png');
 for(const [a,b] of [['start','signup'],['signup','verify'],['verify','dashboard'],['dashboard','upload'],['upload','valid'],['valid','analysis'],['analysis','download']])expect(created.graph.layout[b!]!.y).toBeGreaterThan(created.graph.layout[a!]!.y);
 await page.screenshot({path:'/tmp/sketch-inline-generated.png'});
 // Orthogonal connectors use bends and avoid unrelated node interiors.
 const routing=await card.locator('[data-testid="sketch-graph"]').evaluate(host=>{
  const nodes=[...host.querySelectorAll<SVGGElement>('.x6-node')].map(el=>({id:el.getAttribute('data-cell-id'),r:el.getBoundingClientRect()}));
  const paths=[...host.querySelectorAll<SVGPathElement>('.x6-edge > path[marker-end]')];
  let intersections=0;const hits=new Set<string>();
  for(const path of paths){const group=path.closest('.x6-edge')!,id=group.getAttribute('data-cell-id');const edgeNumber=Number(id?.replace('edge-',''));const ends=[['start','signup'],['signup','verify'],['verify','retry'],['retry','verify'],['verify','dashboard'],['dashboard','upload'],['upload','valid'],['valid','upload'],['valid','analysis'],['analysis','download']][edgeNumber]??[];const m=path.getScreenCTM();if(!m)continue;for(let d=5;d<path.getTotalLength();d+=5){const p=path.getPointAtLength(d).matrixTransform(m);for(const n of nodes)if(!ends.includes(n.id??'')&&p.x>n.r.left+4&&p.x<n.r.right-4&&p.y>n.r.top+4&&p.y<n.r.bottom-4){intersections++;hits.add(id+'→'+n.id);}}}
  return {count:paths.length,intersections,hits:[...hits]};
 });expect(routing.count).toBe(10);expect(routing.intersections,JSON.stringify(routing)).toBe(0);
 await card.getByRole('textbox',{name:'Sketch title'}).fill('Signup and PDF flow');
 const composer=card.getByRole('textbox',{name:'Message to Sketch AI'});kind='ask';await card.getByRole('button',{name:'Ask',exact:true}).click();await composer.fill('What is missing?');await card.getByRole('button',{name:'Send',exact:true}).click();await expect(card).toContainText('abandonment path');expect((await saved(page,card)).graph).toEqual(created.graph);
 kind='bad';await card.getByRole('button',{name:'Edit',exact:true}).click();await composer.fill('Invalid edit');await card.getByRole('button',{name:'Send',exact:true}).click();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeEnabled();expect((await saved(page,card)).graph).toEqual(created.graph);
 kind='slow';delay=500;await composer.fill('Slow edit');await card.getByRole('button',{name:'Send',exact:true}).click();await card.getByRole('button',{name:'+ Step',exact:true}).click();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeEnabled();await expect(card).toContainText('Sketch changed');expect((await saved(page,card)).graph.nodes.some(n=>n.id==='late')).toBe(false);
 await card.getByRole('button',{name:'Undo',exact:true}).click();await expect(card.locator('.x6-node')).toHaveCount(9);await card.getByRole('button',{name:'Redo',exact:true}).click();await expect(card.locator('.x6-node')).toHaveCount(10);
 await composer.fill('Cancel edit');await card.getByRole('button',{name:'Send',exact:true}).click();await card.getByRole('button',{name:'Cancel',exact:true}).click();await expect(card).toContainText('Canceled.');
 await card.getByRole('button',{name:'Collapse Sketch',exact:true}).click();await expect(card.getByTestId('sketch-graph')).toHaveCount(0);await card.getByRole('button',{name:'Expand Sketch',exact:true}).click();await expect(card.locator('.x6-node')).toHaveCount(10);
 await page.reload();await expect(page.getByTestId('canvas-workspace')).toHaveAttribute('data-canvas',canvasId!);await expect(card.getByRole('textbox',{name:'Sketch title'})).toHaveValue('Signup and PDF flow');await expect(card.locator('.x6-node')).toHaveCount(10);
 await page.getByTestId('canvas-sketch').click();await expect(page.getByTestId('canvas-sketch-card')).toHaveCount(2);const ids=await page.getByTestId('canvas-sketch-card').evaluateAll(cards=>cards.map(c=>c.getAttribute('data-sketch')));const secondId=ids.find(id=>id!==firstId);const second=page.locator(`[data-testid="canvas-sketch-card"][data-sketch="${secondId}"]`);await second.getByRole('textbox',{name:'Sketch title'}).fill('Another flow');await second.getByRole('button',{name:'+ End',exact:true}).click();await expect(second.locator('.x6-node')).toHaveCount(1);await expect(card.locator('.x6-node')).toHaveCount(10);await expect(second.getByRole('button',{name:'Saved locally',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByTestId('canvas-sketch-card')).toHaveCount(2);await expect(second.getByRole('textbox',{name:'Sketch title'})).toHaveValue('Another flow');
 expect(errors).toEqual([]);
});


test('pasted and dropped references stay inside Sketch instead of creating Canvas threads',async({page})=>{
 await enter(page);await page.getByTestId('canvas-sketch').click();const card=page.getByTestId('canvas-sketch-card');
 const canvasId=await page.getByTestId('canvas-workspace').getAttribute('data-canvas');
 const readCanvas=()=>page.evaluate(canvasId=>new Promise(resolve=>{const open=indexedDB.open('notlinear-canvas');open.onsuccess=()=>{const db=open.result,r=db.transaction('kv').objectStore('kv').get('canvas_doc_v1:'+canvasId);r.onsuccess=()=>{resolve(r.result);db.close();};};}),canvasId);
 const before=await readCanvas();
 await card.getByRole('textbox',{name:'Message to Sketch AI'}).evaluate(el=>{
  const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71])],'pasted.png',{type:'image/png'}));
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 });
 await expect(card.getByRole('img',{name:'pasted.png'})).toBeVisible();
 await card.locator('form').last().evaluate(el=>{
  const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71])],'dropped.png',{type:'image/png'}));
  el.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
 });
 await expect(card.getByRole('img',{name:'dropped.png'})).toBeVisible();
 await expect(card.getByRole('button',{name:'Edit',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.waitForTimeout(450);expect(await readCanvas()).toEqual(before);
 const placement=()=>page.evaluate(()=>new Promise<Array<{id:string;width:number;height:number;x:number;y:number}>>(resolve=>{const r=indexedDB.open('notlinear-sketch');r.onsuccess=()=>{const db=r.result,q=db.transaction('placements').objectStore('placements').getAll();q.onsuccess=()=>{resolve(q.result);db.close();};};}));
 const position=(await placement())[0]!;await page.reload();await expect(page.getByTestId('canvas-sketch-card')).toBeVisible();expect((await placement())[0]).toEqual(position);
});

test('a lone Start creates a flow after reload; removing the card retains and reattaches its document',async({page})=>{
 await enter(page);const canvasId=await page.getByTestId('canvas-workspace').getAttribute('data-canvas');
 await page.getByTestId('canvas-sketch').click();const card=page.getByTestId('canvas-sketch-card');
 await card.getByRole('textbox',{name:'Sketch title'}).fill('Start anchor regression');
 await card.getByRole('button',{name:'+ Start',exact:true}).click();await expect(card.locator('.x6-node')).toHaveCount(1);
 await expect(card.getByRole('button',{name:'Saved locally',exact:true})).toBeVisible();const initial=await saved(page,card),start=initial.graph.nodes[0]!;
 await page.reload();await expect(card.getByRole('button',{name:'Edit',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.route('https://api.anthropic.com/v1/messages',r=>r.fulfill({contentType:'text/event-stream',body:events(JSON.stringify({revision:initial.revision,operations:[{op:'addNode',id:'signup',type:'step',label:'Sign up'},{op:'addNode',id:'done',type:'end',label:'Done'},{op:'addEdge',id:'first',source:start.id,target:'signup'},{op:'addEdge',id:'last',source:'signup',target:'done'}]}))}));
 await card.getByRole('textbox',{name:'Message to Sketch AI'}).fill('Create signup then finish');await card.getByRole('button',{name:'Create Sketch',exact:true}).click();await expect(card.locator('.x6-node')).toHaveCount(3);await expect(card.getByRole('button',{name:'Saved locally',exact:true})).toBeVisible();
 const after=await saved(page,card);expect(after.graph.layout[start.id]).toEqual(initial.graph.layout[start.id]);expect(after.graph.layout.signup!.y).toBeGreaterThan(after.graph.layout[start.id]!.y);
 await card.getByRole('button',{name:'Remove Sketch from Canvas'}).click();await expect(card).toHaveCount(0);
 await page.getByRole('button',{name:'Open left pane'}).click();await page.getByRole('button',{name:'Sketches',exact:true}).click();
 const tile=page.locator('div.rounded-lg').filter({has:page.getByRole('button',{name:'Start anchor regression',exact:true})}).last();
 await tile.getByRole('button',{name:'Add to current Canvas'}).click();await expect(page.getByTestId('canvas-workspace')).toHaveAttribute('data-canvas',canvasId!);await expect(card.locator('.x6-node')).toHaveCount(3);await expect(card.getByRole('textbox',{name:'Sketch title'})).toHaveValue('Start anchor regression');
});

test('Sketch inherits project uploads, Canvas knowledge and linked repository tools for Create and Ask',async({page})=>{
 await enter(page);const canvasId=await page.getByTestId('canvas-workspace').getAttribute('data-canvas');
 await page.evaluate(async ({canvasId,initialState})=>{
  await new Promise<void>(resolve=>{const open=indexedDB.open('notlinear');open.onsuccess=()=>{const db=open.result,tx=db.transaction('kv','readwrite'),store=tx.objectStore('kv'),r=store.get('state');r.onsuccess=()=>{const row=r.result??{key:'state',value:initialState};row.value.projects={...row.value.projects,'sk-project':{id:'sk-project',name:'Sketch repository project',path:'/fixture/sketch-project',rules:'Use the uploaded requirements and repository evidence',files:[{name:'requirements.md',kind:'file',type:'text/plain',size:25,content:'Uploaded project requirement: signup uses verification'}]}};store.put(row);};tx.oncomplete=()=>{db.close();resolve();};};});
  await new Promise<void>(resolve=>{const open=indexedDB.open('notlinear-canvas');open.onsuccess=()=>{const db=open.result,tx=db.transaction('kv','readwrite'),store=tx.objectStore('kv'),r=store.get('canvas_doc_v1:'+canvasId);r.onsuccess=()=>{const row=r.result;row.value.summary.projectId='sk-project';row.value.memory=[{id:'m',text:'Canvas context: enterprise onboarding',createdAt:1}];row.value.files=[{id:'f',name:'canvas-reference.md',content:'Canvas attachment: use the dashboard',mime:'text/plain',size:25,createdAt:1}];store.put(row);};const index=store.get('canvas_index_v1');index.onsuccess=()=>{const row=index.result;if(row){row.value=row.value.map((entry:{id:string})=>entry.id===canvasId?{...entry,projectId:'sk-project'}:entry);store.put(row);}};tx.oncomplete=()=>{db.close();resolve();};};});
 },{canvasId,initialState:emptyState()});
 await page.reload();await page.getByTestId('canvas-sketch').click();const card=page.getByTestId('canvas-sketch-card');
 await expect(card).toContainText('Project: Sketch repository project');
 const reads:string[]=[],prompts:string[]=[];
 await page.route('**/__notlinear_scan_project',route=>route.fulfill({json:{ok:true,contextFiles:[{present:true,filename:'widget.ts',relativePath:'src/widget.ts',text:'Widget signup routes through verification in the linked repository'}]}}));
 await page.route('**/__notlinear_read_file',route=>{const input=route.request().postDataJSON();reads.push(input.path);return route.fulfill({json:{ok:true,text:'function widgetSignup() { return verifyEmail(); }',start:0,end:50,total:50}});});
 let phase:'edit'|'ask'='edit';
 await page.route('https://api.anthropic.com/v1/messages',route=>{
  const request=route.request().postDataJSON();prompts.push(request.system);
  expect(request.system).toContain('Uploaded project requirement: signup uses verification');expect(request.system).toContain('Use the uploaded requirements');expect(request.system).toContain('Canvas context: enterprise onboarding');expect(request.system).toContain('Canvas attachment: use the dashboard');
  expect(request.tools.map((t:{name:string})=>t.name)).toContain('read_project_file');
  const hasResult=request.messages.some((m:{content:unknown})=>Array.isArray(m.content)&&m.content.some((b:{type:string})=>b.type==='tool_result'));
  if(!hasResult){
   const chunks=[{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'read-widget',name:'read_project_file'}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({path:'src/widget.ts',folderRoot:'/model-must-not-control-root'})}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:10}}];
   return route.fulfill({contentType:'text/event-stream',body:chunks.map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')});
  }
  expect(JSON.stringify(request.messages)).toContain('function widgetSignup');
  const text=phase==='edit'?JSON.stringify({revision:0,operations:[{op:'addNode',id:'widget',type:'step',label:'Widget signup and verification'}]}):'The project repository uses widgetSignup and verifyEmail.';
  return route.fulfill({contentType:'text/event-stream',body:events(text)});
 });
 await card.getByRole('textbox',{name:'Message to Sketch AI'}).fill('Create the signup flow from the attached project repository');await card.getByRole('button',{name:'Create Sketch',exact:true}).click();await expect(card.locator('.x6-node')).toHaveCount(1);
 const before=await saved(page,card);phase='ask';await card.getByRole('button',{name:'Ask',exact:true}).click();await card.getByRole('textbox',{name:'Message to Sketch AI'}).fill('Which function implements this?');await card.getByRole('button',{name:'Send',exact:true}).click();await expect(card).toContainText('uses widgetSignup and verifyEmail');expect((await saved(page,card)).graph).toEqual(before.graph);
 expect(reads).toEqual(['/fixture/sketch-project','/fixture/sketch-project']);expect(prompts).toHaveLength(4);
});
