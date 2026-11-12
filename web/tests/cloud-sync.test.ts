import { webcrypto } from 'node:crypto';
import { describe,it,expect,vi,afterEach } from 'vitest';
import NativeDexie from 'dexie';
const gate=vi.hoisted(()=>({namespace:'',wait:null as Promise<void>|null,entered:null as (()=>void)|null}));
const remote=vi.hoisted(()=>new Map<string,{resource_key:string;revision:number;value:unknown;deleted:boolean}>());
vi.mock('../src/cloud/client',()=>({cloudMode:()=>true,userId:()=> 'test-user',cloudRequest:async(path:string,init:RequestInit={})=>{
 const namespace=path.split('/').pop()!;
 if(!init.method&&gate.wait&&namespace===gate.namespace){gate.entered?.();await gate.wait;}
 if(!init.method)return [...remote.entries()].filter(([key])=>key.startsWith(namespace+'|')).map(([,value])=>value);
 const body=JSON.parse(String(init.body));const key=namespace+'|'+body.key;const existing=remote.get(key);
 if((existing?.revision??0)!==body.revision)throw new Error('Revision conflict');
 const row={resource_key:body.key,revision:(existing?.revision??0)+1,value:body.value,deleted:body.deleted??false};remote.set(key,row);return row;
}}));
import CloudDatabase from '../src/cloud/database';
vi.stubGlobal('crypto',webcrypto);
const opened:CloudDatabase[]=[];
function database(){const db=new CloudDatabase('notlinear');db.version(1).stores({kv:'key'});opened.push(db);return db;}
afterEach(async()=>{for(const db of opened)db.close();opened.length=0;await NativeDexie.delete('notlinear:account:test-user');localStorage.clear();remote.clear();gate.wait=null;gate.namespace='';gate.entered=null;});
describe('account cache and versioned cloud synchronization',()=>{
 it('restores threads, projects and preferences into a fresh browser cache',async()=>{
  const first=database();const original={key:'state',value:{threads:{one:{title:'Research'}},projects:{p:{id:'p'}},prefs:{theme:'grey'},current:'one'}};
  await first.table('kv').put(original);await first.synchronize(false);
  expect([...remote.keys()].some(key=>key.startsWith('chat|'))).toBe(true);
  first.close();await NativeDexie.delete(first.name);localStorage.clear();
  const second=database();expect(await second.table('kv').get('state')).toEqual(original);
 });
 it('does not treat PostgreSQL JSON key reordering as an edit',async()=>{
  const db=database();await db.table('kv').put({key:'state',value:{threads:{one:{title:'A',stream:'B'}},projects:{},prefs:{}}});await db.synchronize(false);
  const key=[...remote.keys()].find(key=>key.startsWith('chat|'))!;const prior=remote.get(key)!;
  remote.set(key,{...prior,value:{stream:'B',title:'A'}});await db.synchronize(true);await db.synchronize(false);
  expect(remote.get(key)!.revision).toBe(prior.revision);
 });
 it('does not overwrite an edit made while a cloud pull is in flight',async()=>{
  const db=database();await db.table('kv').put({key:'state',value:{threads:{one:{title:'Before'}},projects:{},prefs:{}}});await db.synchronize(false);
  let release!:()=>void,entered!:()=>void;gate.namespace='chat';gate.wait=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});gate.entered=entered;
  const pulling=db.synchronize(true);await started;
  await db.table('kv').put({key:'state',value:{threads:{one:{title:'Typed during network request'}},projects:{},prefs:{}}});
  release();await pulling;expect((await db.table('kv').get('state')).value.threads.one.title).toBe('Typed during network request');
 });
 it('rejects stale writes and preserves the local draft',async()=>{
  const db=database();await db.table('kv').put({key:'state',value:{threads:{one:{title:'Before'}},projects:{},prefs:{}}});await db.synchronize(false);
  const key=[...remote.keys()].find(key=>key.startsWith('chat|'))!;const row=remote.get(key)!;remote.set(key,{...row,revision:row.revision+1,value:{title:'Other device'}});
  await db.table('kv').put({key:'state',value:{threads:{one:{title:'My draft'}},projects:{},prefs:{}}});
  await expect(db.synchronize(false)).rejects.toThrow('Revision conflict');
  expect((await db.table('kv').get('state')).value.threads.one.title).toBe('My draft');
 });
});
