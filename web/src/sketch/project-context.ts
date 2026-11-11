import { getCanvas } from '../canvas/canvas-repo';
import { canvasContextBlock } from '../canvas/context/resolve';
import { buildProjectFolderContext } from '../chat/project-context';
import { availableTools, FOLDER_TOOL_HINT } from '../providers/tool-specs';
import { executeTool } from '../tools/tool-runners';
import { toolEnv } from '../tools/env';
import { useAppStore } from '../state/app-store';
import { useSketchStore } from './store';
import type { PersistedPrefs } from '../db/types';

/** Project authority comes from this Sketch's Canvas, never the currently focused tab. */
export async function sketchProjectContext(documentId:string, requestedCanvasId:string|undefined, query:string, prefs:PersistedPrefs, signal:AbortSignal){
 const owners=[...new Set(Object.values(useSketchStore.getState().placements).filter(p=>p.documentId===documentId).map(p=>p.canvasId))];
 if(!requestedCanvasId&&owners.length>1)throw new Error('Open this Sketch inside the Canvas whose project you want to use.');
 const canvasId=requestedCanvasId??owners[0];
 const canvas=canvasId?await getCanvas(canvasId):null;
 signal.throwIfAborted();
 if(canvasId&&!canvas)throw new Error('The owning Canvas could not be loaded. Reopen the Sketch from its Canvas.');
 const projectId=canvas?.summary.projectId;
 const liveProject=projectId?useAppStore.getState().projects[projectId]:undefined;
 if(projectId&&!liveProject)throw new Error('The Canvas project could not be loaded. Reopen the project before retrying.');
 // Snapshot before asynchronous retrieval: later tab, project or linked-folder changes cannot
 // change the root that a tool is allowed to read for this request.
 const project=liveProject?structuredClone(liveProject):undefined;
 const env=toolEnv(),folderRoot=project?.path||'';
 const folder=await buildProjectFolderContext(project?.id,query,'inherit',{
  path:folderRoot,deepseekKey:env.apiKeys.deepseek,globalMode:prefs.rankingLlm||'none',signal,
 });
 signal.throwIfAborted();
 const tools=availableTools({apiKeys:env.apiKeys,searxngUrl:env.searxngUrl,folder:!!folderRoot});
 const allowed=new Set(tools.map(t=>t.name));
 const toolRunner=(name:string,args:Record<string,unknown>,toolSignal:AbortSignal)=>{
  if(!allowed.has(name as typeof tools[number]['name']))throw new Error('This tool is not available in the Sketch project.');
  return executeTool(name,args,toolSignal,{folderRoot});
 };
 const extraContext=[canvas?`Owning Canvas: ${canvas.summary.title}\n${canvasContextBlock(canvas)}`:'',folder.contextBlock,folderRoot?FOLDER_TOOL_HINT:''].filter(Boolean).join('\n\n');
 return {project,extraContext,tools,toolRunner,apiKeys:env.apiKeys};
}
