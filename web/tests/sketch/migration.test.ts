import { it,expect } from 'vitest';
import Dexie from 'dexie';
it('upgrades v1 Sketches without changing their graphs or conversation',async()=>{
 const legacy=new Dexie('notlinear-sketch');legacy.version(1).stores({documents:'id'});
 const original={version:1,id:'old',title:'Existing flow',revision:7,graph:{version:1,nodes:[],edges:[],layout:{}},messages:[{role:'user',mode:'ask',content:'Keep this'}],updatedAt:10};
 await legacy.table('documents').put(original);legacy.close();
 const {useSketchStore}=await import('../../src/sketch/store');await useSketchStore.getState().load();
 const doc=useSketchStore.getState().documents.old!;
 expect(doc.graph).toEqual(original.graph);expect(doc.revision).toBe(7);expect(doc.messages[0]).toEqual({...original.messages[0],images:[]});expect(useSketchStore.getState().placements).toEqual({});
 const placement=await useSketchStore.getState().attach('canvas-a','old',{x:123,y:456});
 expect(useSketchStore.getState().placements[placement]).toMatchObject({canvasId:'canvas-a',documentId:'old',x:123,y:456});
 await useSketchStore.getState().removePlacement(placement);expect(useSketchStore.getState().documents.old?.title).toBe('Existing flow');
});
