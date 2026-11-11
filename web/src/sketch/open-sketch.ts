import { registerView, mountView } from '../registry/views';
import { useUiStore } from '../state/ui-store';
import { closeProjectPanel } from '../state/actions';
import { toast } from '../ui/toast';
import { useCanvasStore } from '../canvas/canvas-store';
import { openCanvas } from '../canvas/open-canvas';
import { useSketchStore } from './store';
registerView({id:'sketch',label:'Sketch'});
export function openSketch(id?:string):void{
 closeProjectPanel();useUiStore.getState().setProjectsViewOpen(false);
 useUiStore.getState().activateTab(id ? `sketch:${id}` : 'sketch');mountView('sketch');
}
export async function newSketch(canvasId?:string,position?:{x:number;y:number}):Promise<string|null>{
 try{
  let target=canvasId;
  if(!target){
   const active=useUiStore.getState().activeTabId;
   if(active?.startsWith('canvas:'))target=active.slice(7);
   else {const canvas=await useCanvasStore.getState().create(null,'Sketch workspace');if(!canvas)throw new Error('Canvas could not be created.');target=canvas.id;}
  }
  const store=useSketchStore.getState(),documentId=await store.create();
  const placementId=await store.attach(target,documentId,position);
  if(!canvasId)openCanvas(target);
  return placementId;
 }catch(e){toast(e instanceof Error?e.message:String(e));return null;}
}
