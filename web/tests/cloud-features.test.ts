import { describe,it,expect,afterEach } from 'vitest';
import { featureDefaults,flags,applyFlags,resolveFlags,requireFeature } from '../src/flags';
import { stripAttachmentBytes,materializeBinary } from '../src/cloud/attachments';
describe('global feature configuration',()=>{
 afterEach(()=>applyFlags(featureDefaults));
 it('preserves available desktop defaults',()=>{expect(flags.notesV2).toBe(true);expect(flags.projectMemory).toBe(false);});
 it('resolves dependency flags, not just navigation',()=>{const value=resolveFlags({notesV2:false,chatNotes:true});expect(value.chatNotes).toBe(false);expect(value.chat).toBe(true);});
 it('does not disable content when projects is off',()=>{const value=resolveFlags({projects:false});expect(value.canvas).toBe(true);expect(value.notesV2).toBe(true);});
 it('keeps stable identity for non-React action guards',()=>{const reference=flags;applyFlags({notesV2:false});expect(reference.notesV2).toBe(false);expect(()=>requireFeature('notesV2')).toThrow();applyFlags({notesV2:true});expect(()=>requireFeature('notesV2')).not.toThrow();});
 it('removes R2 attachment bytes from cloud content records',()=>{expect(stripAttachmentBytes({files:[{cloudAttachmentId:'file',base64:'private-large-data',content:'text'}]})).toEqual({files:[{cloudAttachmentId:'file',content:'text'}]});});
});

import { encodeRow,applyPiece } from '../src/cloud/record-codec';
describe('cloud record compatibility',()=>{
 it('separates thread/project/preferences revisions while retaining IDs',()=>{
  const pieces=encodeRow('notlinear','kv','state',{key:'state',value:{threads:{a:{title:'A'},b:{title:'B'}},projects:{p:{id:'p'}},prefs:{theme:'light'},current:'a'}});
  expect(pieces.filter(p=>p.namespace==='chat')).toHaveLength(2);expect(pieces.filter(p=>p.namespace==='projects')).toHaveLength(1);
  let row:Record<string,unknown>|undefined;
  for(const piece of pieces)row=applyPiece(row,piece,false);
  expect(row).toEqual({key:'state',value:{threads:{a:{title:'A'},b:{title:'B'}},projects:{p:{id:'p'}},prefs:{theme:'light'},current:'a'}});
 });
 it('stores notes individually and preserves order',()=>{
  const pieces=encodeRow('notlinear-notes','kv','nl_notes_v1',{key:'nl_notes_v1',value:[{id:'b'},{id:'a'}]});
  let row:Record<string,unknown>|undefined;for(const piece of pieces)row=applyPiece(row,piece,false);
  expect(row?.value).toEqual([{id:'b'},{id:'a'}]);
  row=applyPiece(row,pieces[0]!,true);expect(row?.value).toEqual([{id:'a'}]);
 });
});

it('disabling attachments preserves cloud references without blocking text hydration',async()=>{
 applyFlags({attachments:false});const reference='notlinear-r2://00000000-0000-4000-8000-000000000001';
 expect(await materializeBinary({text:'Keep reading',image:reference})).toEqual({text:'Keep reading',image:reference});applyFlags(featureDefaults);
});

import { startCanvasRun,stopAllCanvasRuns,useCanvasRuns } from '../src/canvas/exec/live-runs';
it('the flag kill-switch cancels background Canvas work without discarding its runtime entry',()=>{
 const first=startCanvasRun('flag-canvas','thread-one')!,second=startCanvasRun('flag-canvas','thread-two')!;
 const controller=new AbortController();first.register(controller);stopAllCanvasRuns();
 expect(controller.signal.aborted).toBe(true);expect(second.signal.aborted).toBe(true);
 expect(Object.keys(useCanvasRuns.getState().runs)).toHaveLength(2);
 first.finish();second.finish();expect(Object.keys(useCanvasRuns.getState().runs)).toHaveLength(0);
});
