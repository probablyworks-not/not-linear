import { memo } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronUp, GripHorizontal, X } from 'lucide-react';
import { SketchView } from './SketchView';
import { useSketchStore } from './store';
import { toast } from '../ui/toast';
export type SketchNodeType=Node<{placementId:string;documentId:string},'sketch'>;
export const SketchNode=memo(function SketchNode({id,data,selected}:NodeProps<SketchNodeType>){
 const placement=useSketchStore(s=>s.placements[data.placementId]);
 const error=useSketchStore(s=>s.placementErrors[data.placementId]);
 const title=useSketchStore(s=>s.documents[data.documentId]?.title??'Sketch');
 if(!placement)return null;
 return <div className="relative h-full w-full">
  {!placement.collapsed&&<NodeResizer nodeId={id} isVisible={selected} minWidth={760} minHeight={500} handleClassName="z-20" lineClassName="z-20"/>}
  <article data-testid="canvas-sketch-card" data-sketch={data.documentId} className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-cv-edge bg-cv-card shadow-lg">
  <header className="sketch-card-drag flex h-10 flex-none cursor-grab items-center gap-2 border-b border-rule px-3 text-sm text-text-2"><GripHorizontal size={14}/><span className="min-w-0 flex-1 truncate">{title||'Sketch'}</span>{error&&<button type="button" className="nodrag rounded border border-rule-2 px-2 text-xs" onClick={()=>useSketchStore.getState().place(placement.id,{})}>{error} — Retry</button>}
   <button type="button" className="nodrag rounded p-1 hover:bg-bg-3" aria-label={placement.collapsed?'Expand Sketch':'Collapse Sketch'} onClick={()=>useSketchStore.getState().place(placement.id,{collapsed:!placement.collapsed})}>{placement.collapsed?<ChevronDown size={14}/>:<ChevronUp size={14}/>}</button>
   <button type="button" className="nodrag rounded p-1 hover:bg-bg-3" aria-label="Remove Sketch from Canvas" title="Remove card; keep the document in Sketches" onClick={()=>{void useSketchStore.getState().removePlacement(placement.id).catch(e=>toast(String(e)));}}><X size={14}/></button>
  </header>
  {!placement.collapsed&&<div className="nodrag nopan nowheel flex min-h-0 flex-1 flex-col" data-canvas-decoration onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} onPaste={e=>e.stopPropagation()}>
   <SketchView documentId={data.documentId} canvasId={placement.canvasId} embedded/>
  </div>}
 </article></div>;
});
