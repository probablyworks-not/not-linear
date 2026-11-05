import Dexie, { type Table } from 'dexie';
import { create } from 'zustand';
import { applyOperations, clone, emptyGraph, uid, validateGraph, type Operation, type SketchGraph } from './model';
import type { Attachment } from '../attachments/read-files';
export interface SketchMessage { role:'user'|'assistant'; content:string; mode:'ask'|'edit'; images?:Attachment[] }
export interface SketchPlacement { id:string; documentId:string; canvasId:string; x:number; y:number; width:number; height:number; collapsed?:boolean }
export interface SketchDocument { version:1; id:string; title:string; revision:number; graph:SketchGraph; messages:SketchMessage[]; updatedAt:number }
const db = new Dexie('notlinear-sketch') as Dexie & {documents:Table<SketchDocument,string>; placements:Table<SketchPlacement,string>};
db.version(1).stores({documents:'id'});
// Add placements without rewriting Canvas documents or losing standalone v1 Sketches.
db.version(2).stores({documents:'id',placements:'id,canvasId'}).upgrade(tx =>
 tx.table('documents').toCollection().modify(doc => {
  for (const message of doc.messages ?? []) if (!message.images) message.images = [];
 }));
let loading:Promise<void>|null = null, writes:Promise<unknown> = Promise.resolve();
const history = new Map<string,{undo:SketchGraph[];redo:SketchGraph[]}>();
const histories = (id:string) => { if(!history.has(id)) history.set(id,{undo:[],redo:[]}); return history.get(id)!; };
interface Store {
 placements:Record<string,SketchPlacement>; placementErrors:Record<string,string>;
 attach(canvasId:string,documentId:string,position?:{x:number;y:number}):Promise<string>;
 place(id:string,patch:Partial<Pick<SketchPlacement,'x'|'y'|'width'|'height'|'collapsed'>>,persist?:boolean):void;
 removePlacement(id:string):Promise<void>;
 documents:Record<string,SketchDocument>; status:Record<string,string>; error:string|null;
 load():Promise<void>; create():Promise<string>; save(id:string):Promise<void>;
 change(id:string,patch:Partial<Pick<SketchDocument,'title'|'messages'>>):void;
 apply(id:string,ops:Operation[]):void; replaceGraph(id:string,graph:SketchGraph):void;
 undo(id:string,redo?:boolean):void; canUndo(id:string):boolean; canRedo(id:string):boolean;
}
export const useSketchStore = create<Store>((set,get)=>({
 documents:{},placements:{},placementErrors:{},status:{},error:null,
 async load(){
  if(!loading) loading=Promise.all([db.documents.toArray(),db.placements.toArray()]).then(([rows,placements])=>{
   const documents:Record<string,SketchDocument>={};
   for(const row of rows){validateGraph(row.graph);if(row.version!==1||!Number.isSafeInteger(row.revision)||!Array.isArray(row.messages))throw new Error('Unsupported Sketch document.');documents[row.id]=row;}
   set({documents,placements:Object.fromEntries(placements.filter(p=>documents[p.documentId]).map(p=>[p.id,p])),error:null});
  }).catch(e=>{loading=null;set({error:String(e)});throw e;});
  return loading;
 },
 async attach(canvasId,documentId,position={x:80,y:80}){
  await get().load(); if(!get().documents[documentId]) throw new Error('Sketch not found.');
  const id=uid(),placement:SketchPlacement={id,documentId,canvasId,...position,width:1120,height:760};
  await db.placements.put(placement);set(s=>({placements:{...s.placements,[id]:placement}}));return id;
 },
 place(id,patch,persist=true){
  const current=get().placements[id];if(!current)return;
  const next={...current,...patch};
  if(!Number.isFinite(next.x)||!Number.isFinite(next.y)||!Number.isFinite(next.width)||!Number.isFinite(next.height)||next.width<760||next.height<500)return;
  if(JSON.stringify(current)!==JSON.stringify(next))set(s=>({placements:{...s.placements,[id]:next}}));
  if(persist){
   const write=writes.catch(()=>{}).then(()=>db.placements.put(next));writes=write;
   void write.then(()=>{if(get().placementErrors[id])set(s=>{const placementErrors={...s.placementErrors};delete placementErrors[id];return {placementErrors};});}).catch(()=>set(s=>({placementErrors:{...s.placementErrors,[id]:'Card position not saved'}})));
  }
 },
 async removePlacement(id){
  const original=get().placements[id];if(!original)return;
  // Remove from memory first, so late resize/drag events cannot queue a resurrection.
  set(s=>{const placements={...s.placements};delete placements[id];return {placements};});
  const write=writes.catch(()=>{}).then(()=>db.placements.delete(id));writes=write;
  try{await write;}catch(error){set(s=>({placements:{...s.placements,[id]:original}}));throw error;}
 },
 async create(){
  await get().load();const id=uid();const doc:SketchDocument={version:1,id,title:'Untitled Sketch',revision:0,graph:emptyGraph(),messages:[],updatedAt:Date.now()};
  await db.documents.put(doc);set(s=>({documents:{...s.documents,[id]:doc}}));return id;
 },
 async save(id){
  const doc=get().documents[id];if(!doc)return;const snapshot=clone(doc);
  set(s=>({status:{...s.status,[id]:'Saving…'}}));
  const write=writes.catch(()=>{}).then(()=>db.documents.put(snapshot));writes=write;
  try{await write;if(get().documents[id]===doc)set(s=>({status:{...s.status,[id]:'Saved locally'}}));}
  catch{set(s=>({status:{...s.status,[id]:'Not saved — Retry save'}}));}
 },
 change(id,patch){
  const doc=get().documents[id];if(!doc)return;
  set(s=>({documents:{...s.documents,[id]:{...doc,...patch,updatedAt:Date.now()}}}));void get().save(id);
 },
 apply(id,ops){const doc=get().documents[id];if(doc)get().replaceGraph(id,applyOperations(doc.graph,ops));},
 replaceGraph(id,graph){
  const doc=get().documents[id];if(!doc)return;validateGraph(graph);if(JSON.stringify(doc.graph)===JSON.stringify(graph))return;
  const h=histories(id);h.undo.push(clone(doc.graph));if(h.undo.length>100)h.undo.shift();h.redo=[];
  set(s=>({documents:{...s.documents,[id]:{...doc,graph,revision:doc.revision+1,updatedAt:Date.now()}}}));void get().save(id);
 },
 undo(id,redo=false){
  const doc=get().documents[id];if(!doc)return;const h=histories(id),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo;
  const graph=from.pop();if(!graph)return;to.push(clone(doc.graph));
  set(s=>({documents:{...s.documents,[id]:{...doc,graph,revision:doc.revision+1,updatedAt:Date.now()}}}));void get().save(id);
 },
 canUndo:id=>!!history.get(id)?.undo.length,canRedo:id=>!!history.get(id)?.redo.length,
}));
