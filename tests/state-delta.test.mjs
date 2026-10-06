import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {WorkspaceClient} from '../public/core/client.mjs';
import {TestD1} from './helpers/d1.mjs';

// H9-3: a page that already holds the workspace asks only for tasks changed since its
// revision, so a change no longer resends every task. Pages that do not ask still get
// the full state, and a client re-reads everything periodically and on any mismatch.
const token='test-state-delta-0123456789012345';
function api(db,extra={}){
 const env={DB:db,ACCESS_TOKEN:token,...extra};
 const call=async(path,body)=>{const response=await worker.fetch(new Request('https://inno.test'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env);return response.json();};
 return call;
}

test('a delta asks only for tasks changed since the revision; other pages keep the full state',async t=>{
 const db=new TestD1();t.after(()=>db.close());const call=api(db);
 const created=[];for(const prompt of ['a','b','c'])created.push((await call('/api/tasks',{prompt})).task);
 const full=await call('/api/state');assert.equal(full.tasks.length,3);
 const changed=(await call(`/api/tasks/${created[1].id}/actions`,{action:'message',content:'more',expectedVersion:created[1].version})).task;
 const delta=await call(`/api/state?since=${full.revision}&delta=1`);
 assert.equal(delta.delta,true);assert.equal(delta.since,full.revision);assert.equal(delta.revision,full.revision+1);
 assert.deepEqual(delta.tasks.map(task=>[task.id,task.version]),[[changed.id,changed.version]]);
 assert.equal(delta.taskCount,3);assert.ok(Array.isArray(delta.usage));assert.equal(delta.capabilities.cloud,true);
 const old=await call(`/api/state?since=${full.revision}`);
 assert.equal(old.delta,undefined);assert.equal(old.tasks.length,3);
 assert.equal((await call(`/api/state?since=${delta.revision}&delta=1`)).unchanged,true);
 // An imported record is part of the next delta too.
 const record={...created[0],id:'imported-record',title:'Imported'};
 assert.equal((await call('/api/imports',{task:record})).status,'created');
 const next=await call(`/api/state?since=${delta.revision}&delta=1`);
 assert.deepEqual(next.tasks.map(task=>task.id),['imported-record']);assert.equal(next.taskCount,4);
});

test('the migrations build a schema the store can use',()=>{
 const sqlite=new DatabaseSync(':memory:');
 const dir=new URL('../worker/migrations/',import.meta.url);
 for(const name of readdirSync(dir).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(name,dir),'utf8'));
 const columns=sqlite.prepare('PRAGMA table_info(tasks)').all().map(row=>row.name);
 assert.ok(columns.includes('rev'),columns.join(','));
 assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='tasks_rev'").get());
 sqlite.close();
});

test('the client merges a delta, re-reads all on a count mismatch and refreshes fully every 10 minutes',async()=>{
 let clock=1_000_000;
 const client=new WorkspaceClient({remote:true,baseUrl:'https://example.test',now:()=>clock});
 const paths=[];let reply;
 client.request=async path=>{paths.push(path);return reply(path);};
 const task=(id,version,updatedAt)=>({id,version,updatedAt,title:id});
 reply=()=>({revision:5,tasks:[task('b',1,'2026-10-06T00:00:02Z'),task('a',1,'2026-10-06T00:00:01Z')],usage:[],capabilities:{cloud:true}});
 await client.refresh();assert.equal(paths.at(-1),'/api/state');
 reply=()=>({revision:6,delta:true,since:5,taskCount:2,tasks:[task('a',2,'2026-10-06T00:00:03Z')],usage:[{provider:'x'}],capabilities:{cloud:true}});
 await client.refresh();assert.equal(paths.at(-1),'/api/state?since=5&delta=1');
 assert.deepEqual(client.state.tasks.map(t=>[t.id,t.version]),[['a',2],['b',1]]);assert.equal(client.state.revision,6);assert.equal(client.state.usage.length,1);
 assert.equal(Object.hasOwn(client.state,'delta'),false);
 // A count mismatch means something was missed: read everything again.
 reply=path=>path.includes('delta=1')?{revision:7,delta:true,since:6,taskCount:3,tasks:[],usage:[],capabilities:{cloud:true}}:{revision:7,tasks:[task('c',1,'2026-10-06T00:00:04Z'),task('a',2,'2026-10-06T00:00:03Z'),task('b',1,'2026-10-06T00:00:02Z')],usage:[],capabilities:{cloud:true}};
 await client.refresh();
 assert.deepEqual(paths.slice(-2),['/api/state?since=6&delta=1','/api/state']);assert.equal(client.state.tasks.length,3);
 // After 10 minutes the next refresh is full even with a known revision.
 clock+=10*60_000+1;
 reply=()=>({revision:7,tasks:[task('c',1,'2026-10-06T00:00:04Z')],usage:[],capabilities:{cloud:true}});
 await client.refresh();assert.equal(paths.at(-1),'/api/state?since=7');
});

test('overlapping delta refreshes merge without a false sync error or regressing a task',async()=>{
 const client=new WorkspaceClient({remote:true,baseUrl:'https://example.test'});
 const task=(id,version,updatedAt)=>({id,version,updatedAt});
 client.request=async()=>({revision:5,tasks:[task('a',1,'2026-10-06T00:00:01Z'),task('b',1,'2026-10-06T00:00:00Z')],usage:[],capabilities:{}});
 await client.refresh();
 const pending=[];client.request=()=>new Promise(resolve=>pending.push(resolve));
 const first=client.refresh(),second=client.refresh();
 pending[0]({revision:6,delta:true,since:5,taskCount:2,versionSum:4,tasks:[task('a',3,'2026-10-06T00:00:03Z')],usage:[],capabilities:{}});
 await first;
 // The second answer was computed from the same revision 5 but arrives after state moved to 6.
 pending[1]({revision:6,delta:true,since:5,taskCount:2,versionSum:3,tasks:[task('a',2,'2026-10-06T00:00:02Z')],usage:[],capabilities:{}});
 await second;
 assert.equal(client.syncError,null);
 assert.deepEqual(client.state.tasks.map(t=>[t.id,t.version]),[['a',3],['b',1]]);
});

test('a delta whose version sum differs from the merge triggers a full read',async()=>{
 const client=new WorkspaceClient({remote:true,baseUrl:'https://example.test'});
 const task=(id,version,updatedAt)=>({id,version,updatedAt});
 const paths=[];let reply=()=>({revision:5,tasks:[task('a',1,'2026-10-06T00:00:01Z'),task('b',1,'2026-10-06T00:00:00Z')],usage:[],capabilities:{}});
 client.request=async path=>{paths.push(path);return reply(path);};
 await client.refresh();
 // An update written without rev (for example by an older Worker) is missing from the delta.
 reply=path=>path.includes('delta=1')?{revision:7,delta:true,since:5,taskCount:2,versionSum:4,tasks:[task('a',2,'2026-10-06T00:00:02Z')],usage:[],capabilities:{}}:{revision:7,tasks:[task('a',2,'2026-10-06T00:00:02Z'),task('b',2,'2026-10-06T00:00:01Z')],usage:[],capabilities:{}};
 await client.refresh();
 assert.deepEqual(paths.slice(-2),['/api/state?since=5&delta=1','/api/state']);
 assert.equal(client.state.tasks.find(t=>t.id==='b').version,2);
});

test('the Worker reports the version sum, and without the rev column a delta request gets the full state',async t=>{
 const db=new TestD1();t.after(()=>db.close());const call=api(db);
 const a=(await call('/api/tasks',{prompt:'a'})).task;
 const full=await call('/api/state');
 await call(`/api/tasks/${a.id}/actions`,{action:'message',content:'more',expectedVersion:a.version});
 const delta=await call(`/api/state?since=${full.revision}&delta=1`);
 assert.equal(delta.versionSum,a.version+1);
 db.db.exec('DROP INDEX tasks_rev;ALTER TABLE tasks DROP COLUMN rev;');
 const fallback=await call(`/api/state?since=${full.revision}&delta=1`);
 assert.equal(fallback.delta,undefined);assert.equal(fallback.tasks.length,1);
});
