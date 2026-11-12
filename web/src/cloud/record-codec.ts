/** Compatibility boundary: existing local schemas; independently versioned cloud content. */
export interface Piece {namespace:string;key:string;value:unknown}
const namespaces:Record<string,string>={'notlinear':'chat','notlinear-notes':'notes','notlinear-canvas':'canvas','notlinear-skills':'skills','notlinear-artifacts':'artifacts','notlinear-designs':'designs','notlinear-sketch':'sketch'};
export function databaseNamespaces(name:string):string[]{return name==='notlinear'?['preferences','chat','projects','annotations']:[namespaces[name]!].filter(Boolean);}
export function encodeRow(db:string,table:string,key:string,row:Record<string,unknown>):Piece[]{
 if(db==='notlinear'&&table==='kv'&&key==='state'){
  const value=(row.value??{}) as Record<string,unknown>;const {threads={},projects={},prefs={},...meta}=value;
  const result:Piece[]=[{namespace:'preferences',key:JSON.stringify([table,key,'meta']),value:meta},
   {namespace:'preferences',key:JSON.stringify([table,key,'prefs']),value:prefs}];
  for(const [field,records,namespace] of [['threads',threads,'chat'],['projects',projects,'projects']] as const){
   for(const [id,record] of Object.entries(records as object))result.push({namespace,key:JSON.stringify([table,key,field,id]),value:record});
  }
  return result;
 }
 if(((db==='notlinear-notes'&&key==='nl_notes_v1')||(db==='notlinear-artifacts'&&key==='artifacts_v1'))&&table==='kv'&&Array.isArray(row.value)){
  if(row.value.some((item:Record<string,unknown>)=>typeof item?.id!=='string'||!item.id))throw new Error('Content item is missing an ID. The local source is preserved.');
  return row.value.map((note:Record<string,unknown>,position:number)=>({namespace:db==='notlinear-notes'?'notes':'artifacts',key:JSON.stringify([table,key,'item',String(note.id)]),value:{entry:note,position}}));
 }
 return [{namespace:db==='notlinear'&&key.startsWith('annotations:')?'annotations':namespaces[db]!,key:JSON.stringify([table,key]),value:row}];
}
export function applyPiece(current:Record<string,unknown>|undefined,piece:Piece,deleted:boolean):Record<string,unknown>|undefined{
 const [,key,field,id]=JSON.parse(piece.key) as string[];
 if(!field)return deleted?undefined:piece.value as Record<string,unknown>;
 const row=current??{key,value:field==='item'?[]:{}};
 if(field==='item'){
  const notes=Array.isArray(row.value)?[...row.value] as Array<Record<string,unknown>>:[];
  const remaining=notes.filter(note=>String(note.id)!==id);
  if(!deleted){const {entry,position}=piece.value as {entry:Record<string,unknown>;position:number};remaining.splice(Math.min(position,remaining.length),0,entry);}
  return {...row,value:remaining};
 }
 const value={...(row.value as Record<string,unknown>??{})};
 if(field==='meta')return {...row,value:{...value,...(piece.value as object)}};
 if(field==='prefs')return {...row,value:{...value,prefs:deleted?{}:piece.value}};
 const records={...(value[field] as Record<string,unknown>??{})};
 if(deleted)delete records[id!];else records[id!]=piece.value;
 return {...row,value:{...value,[field]:records}};
}
