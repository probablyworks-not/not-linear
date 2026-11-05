import { it,expect } from 'vitest';
import Dexie from 'dexie';
import { useSketchStore } from '../../src/sketch/store';
it('saves independent documents, chat and undo in a separate database',async()=>{
 const store=useSketchStore.getState(),a=await store.create(),b=await store.create();
 store.apply(a,[{op:'addNode',id:'step',type:'step',label:'Hello'}]);
 store.change(a,{title:'First',messages:[{role:'user',mode:'ask',content:'Explain'}]});
 store.change(b,{title:'Second'});await store.save(a);await store.save(b);
 const db=new Dexie('notlinear-sketch');db.version(2).stores({documents:'id',placements:'id,canvasId'});
 expect((await db.table('documents').get(a)).graph.nodes).toHaveLength(1);
 expect((await db.table('documents').get(a)).messages).toHaveLength(1);
 expect((await db.table('documents').get(b)).graph.nodes).toHaveLength(0);
 store.undo(a);expect(useSketchStore.getState().documents[a]?.graph.nodes).toHaveLength(0);
 store.undo(a,true);expect(useSketchStore.getState().documents[a]?.graph.nodes).toHaveLength(1);
 const placement=await store.attach('canvas-a',a);store.place(placement,{x:200,y:300});await store.removePlacement(placement);expect(await db.table('placements').get(placement)).toBeUndefined();expect(useSketchStore.getState().documents[a]?.title).toBe('First');
 expect(db.verno).toBe(2);db.close();
});
