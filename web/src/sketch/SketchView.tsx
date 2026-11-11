import { useEffect, useRef, useState } from 'react';
import { useSketchStore, type SketchDocument } from './store';
import { openSketch, newSketch } from './open-sketch';
import { applyEdit, applyOperations, arrangeOperations, parseEditResponse, clone, uid, type Operation } from './model';
import { createEditor, type SketchEditor } from './x6-adapter';
import { askSketch } from './ai';
import { toast } from '../ui/toast';
import { modelLabelFromId, planModel } from '../chat/models';
import { readFiles, type Attachment } from '../attachments/read-files';
import { useCanvasDoc } from '../canvas/canvas-doc-store';
import { openCanvas } from '../canvas/open-canvas';
import { useAppStore } from '../state/app-store';
const button='rounded-md border border-rule-2 bg-surface px-3 py-2 text-xs text-text hover:bg-bg-3 disabled:opacity-40';
let vendor:Promise<void>|null=null;
function loadEditor():Promise<void>{
 if(!vendor)vendor=new Promise<void>((resolve,reject)=>{
  const css=document.createElement('link');css.rel='stylesheet';css.href='/web/vendor/x6-2.18.1/index.css';document.head.append(css);
  const script=document.createElement('script');script.src='/web/vendor/x6-2.18.1/index.js';
  script.onload=()=>resolve();script.onerror=()=>{script.remove();css.remove();vendor=null;reject(new Error('Sketch editor could not load. Reopen to retry.'));};document.head.append(script);
 });return vendor;
}
export function SketchView({documentId,embedded=false,canvasId}:{documentId?:string;embedded?:boolean;canvasId?:string}){
 const placements=useSketchStore(s=>s.placements);
 const owners=[...new Set(Object.values(placements).filter(p=>p.documentId===documentId).map(p=>p.canvasId))];
 const ownerCanvasId=canvasId??(owners.length===1?owners[0]:undefined);
 const docs=useSketchStore(s=>s.documents),error=useSketchStore(s=>s.error);
 const [loaded,setLoaded]=useState(false);
 useEffect(()=>{let live=true;void useSketchStore.getState().load().then(()=>{if(live)setLoaded(true);}).catch(()=>{});return()=>{live=false;};},[]);
 if(error)return <main className="p-8 text-sm text-text" role="alert">Sketches could not load: {error}<button className={button} onClick={()=>{void useSketchStore.getState().load().then(()=>setLoaded(true)).catch(()=>{});}}>Retry</button></main>;
 if(!loaded)return <main className="p-8 text-sm text-text-2">Loading Sketches…</main>;
 if(documentId){const doc=docs[documentId];return doc?<SketchDocumentView key={documentId} doc={doc} embedded={embedded} canvasId={ownerCanvasId}/>:<main className="p-8 text-sm text-text">Sketch not found.<button className={button} onClick={()=>openSketch()}>Sketches</button></main>;}
 return <main className="flex-1 overflow-auto p-8"><div className="mb-6 flex items-center justify-between"><h1 className="text-base font-semibold">Sketches</h1><button className={button} onClick={()=>{void newSketch();}}>New Sketch</button></div><p className="mb-6 text-sm text-text-2">Describe a user flow, build it by hand, and ask questions about it.</p><div className="grid grid-cols-1 gap-4 md:grid-cols-3">{Object.values(docs).sort((a,b)=>b.updatedAt-a.updatedAt).map(doc=><div className="rounded-lg border border-rule-2 p-4" key={doc.id}><button className={`${button} w-full text-left`} onClick={()=>openSketch(doc.id)}>{doc.title}</button>{useCanvasDoc.getState().canvasId&&<button className={`${button} mt-2`} onClick={()=>{const canvasId=useCanvasDoc.getState().canvasId;if(canvasId)void useSketchStore.getState().attach(canvasId,doc.id).then(()=>openCanvas(canvasId)).catch(e=>toast(String(e)));}}>Add to current Canvas</button>}</div>)}</div></main>;
}
function SketchDocumentView({doc,embedded=false,canvasId}:{doc:SketchDocument;embedded?:boolean;canvasId?:string}){
 const creating=!doc.graph.nodes.length||(doc.graph.nodes.length===1&&doc.graph.nodes[0]?.type==='start'&&!doc.graph.edges.length);
 const host=useRef<HTMLDivElement>(null),editor=useRef<SketchEditor|null>(null),abort=useRef<AbortController|null>(null);
 const [ready,setReady]=useState(false),[failure,setFailure]=useState(''),[selected,setSelected]=useState<string[]>([]);
 const [mode,setMode]=useState<'ask'|'edit'>(creating ? 'edit' : 'ask'),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[liveText,setLiveText]=useState(''),[chat,setChat]=useState(true);
 const [workStatus,setWorkStatus]=useState('Thinking…');
 const [renaming,setRenaming]=useState<string|null>(null),[label,setLabel]=useState('');
 const messagesEl=useRef<HTMLDivElement>(null),imageInput=useRef<HTMLInputElement>(null);
 const [images,setImages]=useState<Attachment[]>([]),[readingImages,setReadingImages]=useState(false);
 const hadNodes=useRef(!!doc.graph.nodes.length);
 const Surface=embedded?'section':'main';
 const status=useSketchStore(s=>s.status[doc.id]??'Saved locally');
 const projectId=useCanvasDoc(s=>s.doc&&s.doc.summary.id===canvasId?s.doc.summary.projectId:null);
 const projectName=useAppStore(s=>projectId?s.projects[projectId]?.name:undefined);
 const prefs=useAppStore(s=>s.prefs);const plan=planModel(prefs.model,!!prefs.thinking);
 const current=()=>useSketchStore.getState().documents[doc.id]!;
 const rename=(id:string)=>{const c=current();const cell=[...c.graph.nodes,...c.graph.edges].find(n=>n.id===id);if(cell){setRenaming(id);setLabel(cell.label);}};
 const commit=(ops:Operation[])=>{try{useSketchStore.getState().apply(doc.id,ops);}catch(e){toast(e instanceof Error?e.message:String(e));editor.current?.render(current().graph);}};
 useEffect(()=>{
  let disposed=false;
  void loadEditor().then(()=>{
   if(disposed||!host.current)return;
   editor.current=createEditor(host.current,{commit,select:setSelected,rename});editor.current.render(current().graph);setReady(true);
   if(current().graph.nodes.length)editor.current.frame();
  }).catch(e=>{if(!disposed)setFailure(String(e));});
  return()=>{disposed=true;abort.current?.abort();editor.current?.dispose();editor.current=null;};
  // The editor owns its DOM for this document; callbacks read the current store snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[doc.id]);
 useEffect(()=>{if(ready){editor.current?.render(doc.graph);if(!hadNodes.current&&doc.graph.nodes.length)editor.current?.frame();hadNodes.current=!!doc.graph.nodes.length;}},[ready,doc.graph]);
 useEffect(()=>{messagesEl.current?.scrollTo(0,messagesEl.current.scrollHeight);},[doc.messages,liveText]);
 const undo=(redo=false)=>useSketchStore.getState().undo(doc.id,redo);
 const remove=()=>{
  const g=current().graph,ids=new Set(editor.current?.selected()??[]),nodes=new Set(g.nodes.filter(n=>ids.has(n.id)).map(n=>n.id));
  commit([...g.edges.filter(e=>ids.has(e.id)&&!nodes.has(e.source)&&!nodes.has(e.target)).map(e=>({op:'removeEdge',id:e.id})),...[...nodes].map(id=>({op:'removeNode',id}))]);
 };
 const attachImages=async(files:File[])=>{
  if(!files.length)return;
  setReadingImages(true);
  try{
   if(files.some(f=>!['image/png','image/jpeg','image/gif','image/webp'].includes(f.type)))throw new Error('Use PNG, JPEG, GIF or WebP reference images.');
   const loaded=await readFiles(files);
   if(loaded.some(f=>f.tooBig||!f.base64))throw new Error('A reference image is too large or could not be read.');
   if(images.length+loaded.length>4)throw new Error('Attach up to four reference images at a time.');
   setImages(previous=>[...previous,...loaded]);setMode('edit');
  }catch(e){toast(e instanceof Error?e.message:String(e));}finally{setReadingImages(false);}
 };
 const send=async()=>{
  const text=input.trim()||(images.length?'Create an editable user flow from the attached image.':'');if(!text||abort.current||readingImages)return;
  const controller=new AbortController();abort.current=controller;setBusy(true);setLiveText('');setInput('');
  const turnMode=mode,store=useSketchStore.getState();store.change(doc.id,{messages:[...current().messages,{role:'user',content:text,mode:turnMode,images}]});
  const snapshot=clone(current());setImages([]);
  let content='';
  try{
   const result=await askSketch(snapshot,turnMode,editor.current?.selected()??[],controller.signal,chunk=>setLiveText(t=>t+chunk),{canvasId,onStatus:setWorkStatus});controller.signal.throwIfAborted();content=result;
   if(turnMode==='edit'){
    const latest=current();if(latest.revision!==snapshot.revision)throw new Error('Sketch changed while AI was working. Submit again.');
    const response=parseEditResponse(result);let next=applyEdit(latest,response);
    const onlyStart=latest.graph.nodes.length===1&&latest.graph.nodes[0]?.type==='start'&&!latest.graph.edges.length;
    if(!latest.graph.nodes.length||onlyStart){
     const positions=arrangeOperations(next),start=onlyStart?latest.graph.nodes[0]:null;
     const anchor=start?positions.find(p=>p.id===start.id):null;
     const dx=start&&anchor?latest.graph.layout[start.id]!.x-anchor.x!:0,dy=start&&anchor?latest.graph.layout[start.id]!.y-anchor.y!:0;
     next=applyOperations(next,positions.map(p=>({...p,x:p.x!+dx,y:p.y!+dy})));
    }
    const changed=JSON.stringify(latest.graph)!==JSON.stringify(next);store.replaceGraph(doc.id,next);
    content=changed?'Sketch updated. You can undo these changes.':'No changes applied. Describe the flow or attach a clearer reference image.';
   }
  }catch(e){content=controller.signal.aborted?'Canceled. No graph changes applied.':`${e instanceof Error?e.message:String(e)} No graph changes applied.`;}
  finally{
   const latest=current();store.change(doc.id,{messages:[...latest.messages,{role:'assistant',content,mode:turnMode}]});abort.current=null;setBusy(false);setLiveText('');
  }
 };
 return <Surface className="flex h-full min-h-0 flex-1 flex-col bg-bg text-text" aria-label="Sketch editor" onKeyDown={event=>{
  if(event.key==='Escape'&&renaming){setRenaming(null);event.stopPropagation();return;}
  if((event.target as HTMLElement).closest('input,textarea,button'))return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo(event.shiftKey);}
  else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove();}
  else if(event.key==='Enter'&&selected.length===1){event.preventDefault();rename(selected[0]!);}
 }}>
 <header className="flex items-center gap-3 border-b border-rule px-4 py-3">{!embedded&&<button className={button} onClick={()=>openSketch()}>Sketches</button>}<input className="min-w-0 flex-1 rounded bg-bg px-2 py-1 text-sm font-semibold" aria-label="Sketch title" maxLength={160} value={doc.title} onChange={e=>useSketchStore.getState().change(doc.id,{title:e.target.value})} onBlur={()=>{if(!doc.title.trim())useSketchStore.getState().change(doc.id,{title:'Untitled Sketch'});}}/><button className={`${button} text-text-2`} onClick={()=>{void useSketchStore.getState().save(doc.id);}}>{status}</button><button className={button} aria-expanded={chat} onClick={()=>setChat(!chat)}>{chat?'Hide chat':'Show chat'}</button></header>
 <div className="flex min-h-0 flex-1"><section className="relative flex min-w-0 flex-1 flex-col" aria-label="User flow editor"><div className="flex flex-wrap gap-1.5 border-b border-rule p-3" role="toolbar" aria-label="Sketch tools">
 {['start','step','decision','end'].map(type=><button disabled={!ready} className={button} key={type} onClick={()=>{commit([{op:'addNode',id:uid(),type,label:type==='decision'?'Decision?':type[0]!.toUpperCase()+type.slice(1)}]);requestAnimationFrame(()=>editor.current?.fit());}}>+ {type[0]!.toUpperCase()+type.slice(1)}</button>)}
 <button className={button} disabled={selected.length!==1} onClick={()=>rename(selected[0]!)}>Rename</button><button className={button} disabled={!selected.length} onClick={remove}>Delete</button>
 <button className={button} disabled={!useSketchStore.getState().canUndo(doc.id)} onClick={()=>undo()}>Undo</button><button className={button} disabled={!useSketchStore.getState().canRedo(doc.id)} onClick={()=>undo(true)}>Redo</button><button className={button} onClick={()=>{commit(arrangeOperations(doc.graph));requestAnimationFrame(()=>editor.current?.fit());}}>Arrange</button><button className={button} onClick={()=>editor.current?.fit()}>Fit</button><button className={button} aria-label="Zoom out" onClick={()=>editor.current?.zoom(-.15)}>−</button><button className={button} aria-label="Zoom in" onClick={()=>editor.current?.zoom(.15)}>+</button></div>
 {renaming&&<form className="absolute left-4 top-24 z-10 flex gap-2 rounded-lg border border-rule-2 bg-surface p-3 shadow-lg" onSubmit={e=>{e.preventDefault();commit([{op:doc.graph.nodes.some(n=>n.id===renaming)?'updateNode':'updateEdge',id:renaming,label}]);setRenaming(null);}}><input autoFocus aria-label="Step or connection label" maxLength={2000} className="rounded border border-rule-2 bg-bg px-2 text-sm" value={label} onChange={e=>setLabel(e.target.value)}/><button className={button}>Save label</button><button type="button" className={button} onClick={()=>setRenaming(null)}>Cancel</button></form>}
 <div className="relative min-h-0 flex-1"><div ref={host} tabIndex={0} data-testid="sketch-graph" aria-label="Flow graph" className="absolute inset-0"/>{!doc.graph.nodes.length&&!failure&&<p className="pointer-events-none absolute inset-x-8 top-1/2 text-center text-sm text-text-2">Describe your flow or attach an image to create an editable Sketch here.</p>}{failure&&<p role="alert" className="absolute inset-x-8 top-1/2 text-sm text-text">{failure}</p>}</div><p className="border-t border-rule px-3 py-2 text-xs text-text-2">Connect bottom dot → top dot · Shift-drag to pan · Fit shows the whole flow · ⌘/Ctrl-scroll to zoom</p></section>
 {chat&&<aside className="flex w-[360px] min-w-[260px] flex-col border-l border-rule bg-surface" aria-label="Sketch chat"><div className="border-b border-rule p-4"><strong className="text-sm">Think through this flow</strong><p className="mt-2 text-xs text-text-2">{plan.supported?modelLabelFromId(plan.modelId):'Choose a model in Settings'}</p><p className="mt-2 text-xs text-text-2">{projectName?`Project: ${projectName}`:canvasId?'Inherits Canvas context':'Open inside a Canvas to inherit project context'}</p><p className="mt-2 text-xs text-text-2">{selected.length?`${selected.length} selected`:'Whole flow'}</p></div><div ref={messagesEl} className="min-h-0 flex-1 overflow-auto p-4" aria-live="polite">{doc.messages.map((message,i)=><div key={i} className={`mb-4 rounded-lg border border-rule p-3 text-sm leading-relaxed ${message.role==='user'?'bg-bg-3':''}`}><p className="mb-1 text-xs text-text-2">{message.role==='user'?'You':'AI'} · {message.mode==='ask'?'Ask':'Edit'}</p><div className="whitespace-pre-wrap break-words">{message.content}</div>{message.images?.map((image,index)=><img key={index} alt={image.name} src={`data:${image.type};base64,${image.base64}`} className="mt-2 max-h-24 max-w-full rounded"/>)}</div>)}{busy&&<p className="whitespace-pre-wrap text-sm text-text-2">{liveText||workStatus}</p>}</div>
 <form className="border-t border-rule p-4" onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{e.preventDefault();void attachImages([...e.dataTransfer.files]);}} onSubmit={e=>{e.preventDefault();void send();}}><div className="mb-3 flex gap-2">{(['ask','edit'] as const).map(m=><button type="button" key={m} aria-pressed={mode===m} onClick={()=>setMode(m)} className={`${button} ${mode===m?'border-accent bg-accent-soft':''}`}>{m==='ask'?'Ask':'Edit'}</button>)}</div><p className="mb-3 text-xs text-text-2">{mode==='ask'?'Ask questions without changing the flow.':'Describe changes to apply. Each AI edit can be undone.'}</p><textarea aria-label="Message to Sketch AI" onPaste={e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();void attachImages(files);}}} placeholder={!creating?"Ask or describe a change…":"Describe a flow or paste a reference image…"} rows={4} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();void send();}}} className="w-full resize-y rounded-md border border-rule-2 bg-bg p-3 text-sm"/><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label="Reference images" onChange={e=>{void attachImages([...e.target.files??[]]);e.target.value='';}}/>
 <div className="mt-2 flex flex-wrap gap-2">{images.map((image,i)=><div className="flex items-center gap-1 rounded border border-rule-2 p-1" key={i}><img className="h-12 w-12 object-cover" alt={image.name} src={`data:${image.type};base64,${image.base64}`}/><button type="button" aria-label={`Remove ${image.name}`} className={button} onClick={()=>setImages(previous=>previous.filter((_,index)=>index!==i))}>×</button></div>)}</div>
 <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={readingImages||busy} onClick={()=>imageInput.current?.click()}>{readingImages?'Reading…':'Attach image'}</button><small className="flex-1 text-xs text-text-2">⌘/Ctrl+Enter to send</small>{busy&&<button type="button" className={button} onClick={()=>abort.current?.abort()}>Cancel</button>}<button disabled={busy||readingImages} className={button}>{mode==='edit'&&creating?'Create Sketch':'Send'}</button></div></form></aside>}
 </div></Surface>;
}
