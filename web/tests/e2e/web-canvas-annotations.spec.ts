import { test,expect,type Page } from '@playwright/test';
import { emptyDoc } from '../../src/canvas/types';
import { addMessage,createRootThread,setGeometry,textPart } from '../../src/canvas/domain/commands';

function fixture(id:string,title:string){
  const doc=emptyDoc({id,title,projectId:null,rev:1,createdAt:1,updatedAt:1,counts:{threads:0,messages:0,outputs:0}});
  const root=createRootThread(doc,'Read this saved explanation.',{now:1},'Saved answer');
  const answer=addMessage(doc,{threadId:root.thread.id,author:{kind:'model',provider:'anthropic',model:'test'},parts:[textPart('Canvas annotations follow this exact paragraph when you pan, zoom, or read the full reply.\n\nAnother paragraph stays unmarked.')]},{now:2});
  setGeometry(doc,root.thread.id,{x:50,y:50,w:650,h:400});
  return {doc,answer,root};
}
async function seed(page:Page){
  const a=fixture('cv_annotation_a','Annotation canvas A'),b=fixture('cv_annotation_b','Annotation canvas B');
  await page.goto('/web/');
  await page.evaluate(async docs=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('notlinear-canvas');r.onupgradeneeded=()=>r.result.createObjectStore('kv',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('kv','readwrite'),kv=tx.objectStore('kv');kv.put({key:'canvas_index_v1',value:docs.map(d=>d.summary)});for(const d of docs){kv.put({key:`canvas_doc_v1:${d.summary.id}`,value:d});kv.put({key:`canvas_view_v1:${d.summary.id}`,value:{viewport:{x:0,y:0,zoom:1},updatedAt:1}});}tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
    localStorage.setItem('nl_tabs_v1',JSON.stringify({tabs:docs.map(d=>({id:`canvas:${d.summary.id}`})),active:`canvas:${docs[0]!.summary.id}`}));
  },[a.doc,b.doc]);
  await page.reload();
  await expect(page.getByTestId('canvas-workspace')).toHaveAttribute('data-canvas',a.doc.summary.id);
  return {a,b};
}
async function draw(page:Page,selector:string){
  const marker=page.locator('.annotation-toolbar [data-action="draw"]');
  await marker.click();await marker.click();
  const box=(await page.locator(selector).boundingBox())!;
  await page.keyboard.down('h');await expect(marker).toHaveAttribute('aria-pressed','true');
  await page.mouse.move(box.x+8,box.y+10);await page.mouse.down();await page.mouse.move(box.x+Math.min(180,box.width/2),box.y+10,{steps:10});await page.mouse.up();await page.keyboard.up('h');
  await expect(marker).toHaveAttribute('aria-pressed','false');
}

test('Canvas marker is visible here, follows zoom, reading/full reply, reload and canvas ownership',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const {a}=await seed(page);
  const marker=page.locator('.annotation-toolbar [data-action="draw"]');
  await expect(page.getByTestId('canvas-annotation-controls').getByText('Amber marker · H')).toBeVisible();
  const paragraph=`[data-message="${a.answer.id}"] p`;
  const card=page.getByTestId(`thread-node-${a.root.thread.id}`);
  const before=await card.boundingBox();
  await draw(page,`${paragraph}:first-of-type`);
  await expect(page.locator('.annotation-layer path')).toHaveCount(1);
  expect(await card.boundingBox()).toEqual(before); // drawing must not drag the card
  const width=await page.locator('.annotation-layer path').evaluate(el=>el.getBoundingClientRect().width);
  await page.getByRole('button',{name:'Zoom Out',exact:true}).click();
  await expect.poll(async()=>page.locator('.annotation-layer path').evaluate(el=>el.getBoundingClientRect().width)).toBeLessThan(width);
  await page.getByTestId('canvas-reading-toggle').click();
  await expect(page.getByTestId('canvas-reading')).toBeVisible();
  await expect(page.locator('.annotation-layer path')).toHaveCount(1);
  await page.getByRole('button',{name:'Back to the canvas',exact:true}).click();
  await card.getByTestId('view-output').click();
  await expect(page.getByTestId('canvas-output-detail')).toBeVisible();
  await expect(page.getByTestId('canvas-output-detail').locator('.annotation-toolbar')).toBeVisible();
  await expect(page.locator('.annotation-layer path')).toHaveCount(1);
  await draw(page,'[data-testid="canvas-output-detail"] p:first-of-type');
  await expect(page.locator('.annotation-layer path')).toHaveCount(2);
  await page.getByTestId('output-detail-close').click();
  await page.reload();
  await expect(page.locator('.annotation-layer path')).toHaveCount(2);
  await page.getByRole('tab').filter({hasText:'Annotation canvas B'}).click();
  await expect(page.locator('.annotation-layer path')).toHaveCount(0);
  await page.getByRole('tab').filter({hasText:'Annotation canvas A'}).click();
  await expect(page.locator('.annotation-layer path')).toHaveCount(2);
  await page.screenshot({path:'/private/tmp/notlinear-canvas-annotations.png'});
  await page.locator('.annotation-toolbar [data-action="clear"]').click();
  await page.getByRole('button',{name:'Clear annotations',exact:true}).click();
  await expect(page.locator('.annotation-layer path')).toHaveCount(0);
  expect(errors).toEqual([]);
});
