import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {SqliteTaskStore} from '../server/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {ConflictError} from '../public/core/tasks.mjs';
import {TASK_BODY_MAX_BYTES,TASK_GROWTH_MAX_BYTES,COMPLETION_GROWTH_MAX_BYTES,taskNearLimit} from '../public/core/task-size.mjs';

// H9-2: a task's stored body stays below D1's 2,000,000-byte row limit. Growth by a person or an
// executor stops at TASK_GROWTH_MAX_BYTES, an execution starts only below it, and one completion
// adds at most COMPLETION_GROWTH_MAX_BYTES, so a started run can always store its result.
// Refusals are 413 TASK_BODY_LIMIT with guidance, never a 500, and nothing stored is removed.
const bytes=task=>new TextEncoder().encode(JSON.stringify(task)).byteLength;
const big=n=>'a'.repeat(n);
const limited=error=>error?.statusCode===413&&error.code==='TASK_BODY_LIMIT'&&/새 작업/.test(error.message);

test('the limits keep a started run able to store its result below the D1 row limit',()=>{
 assert.ok(TASK_GROWTH_MAX_BYTES+COMPLETION_GROWTH_MAX_BYTES<TASK_BODY_MAX_BYTES);
 assert.ok(TASK_BODY_MAX_BYTES<2_000_000);
});

test('messages stop at the growth limit with guidance, and the task is unchanged',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const token='test-body-limit-0123456789012345',env={DB:db,ACCESS_TOKEN:token};
 const call=(path,body)=>worker.fetch(new Request('https://inno.test'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
 let task=(await (await call('/api/tasks',{title:'Long',prompt:'Work'})).json()).task;
 for(let i=0;i<4;i++){
  const response=await call(`/api/tasks/${task.id}/actions`,{action:'message',content:big(200_000),expectedVersion:task.version});
  assert.equal(response.status,200,`message ${i}`);task=(await response.json()).task;
 }
 const refused=await call(`/api/tasks/${task.id}/actions`,{action:'message',content:big(200_000),expectedVersion:task.version});
 assert.equal(refused.status,413);
 const body=await refused.json();assert.equal(body.code,'TASK_BODY_LIMIT');assert.match(body.error,/새 작업/);
 const stored=(await new D1TaskStore(db).requireTask(task.id));
 assert.equal(stored.version,task.version);assert.equal(stored.messages.length,5);
});

test('a task above the growth limit keeps non-growing actions but cannot grow or start a run',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const token='test-body-limit-0123456789012345',env={DB:db,ACCESS_TOKEN:token};
 const call=(path,body)=>worker.fetch(new Request('https://inno.test'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
 const store=new D1TaskStore(db);
 let task=await store.createTask({title:'Long',prompt:'Work'});
 for(let i=0;i<4;i++)task=await store.applyAction(task.id,{action:'message',content:big(200_000),expectedVersion:task.version});
 const claim=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 task=await store.finishExecution(task.id,{executionId:claim.executionId,generation:claim.generation,content:'done',artifacts:[{name:'out.txt',mime:'text/plain',content:big(500_000)}]});
 assert.ok(bytes(task)>TASK_GROWTH_MAX_BYTES,String(bytes(task)));
 assert.equal(taskNearLimit(task),true);
 const message=await call(`/api/tasks/${task.id}/actions`,{action:'message',content:'more',expectedVersion:task.version});
 assert.equal(message.status,413);assert.equal((await message.json()).code,'TASK_BODY_LIMIT');
 const run=await call(`/api/tasks/${task.id}/run`,{provider:'codex',expectedVersion:task.version});
 assert.equal(run.status,413);assert.equal((await run.json()).code,'TASK_BODY_LIMIT');
 assert.equal((await store.requireTask(task.id)).messages.length,6,'nothing stored is removed');
 // A ready task already above the growth limit (stored before this limit) can still change state.
 let old=await store.createTask({title:'Old',prompt:'Work'});
 old=await store.replaceTask(old.id,old.version,current=>({...current,version:current.version+1,notes:big(1_200_000)}));
 assert.equal(old.status,'ready');
 assert.equal((await call(`/api/tasks/${old.id}/run`,{provider:'codex',expectedVersion:old.version})).status,413);
 const pause=await call(`/api/tasks/${old.id}/actions`,{action:'pause',expectedVersion:old.version});
 assert.equal(pause.status,200);old=(await pause.json()).task;
 const cancel=await call(`/api/tasks/${old.id}/actions`,{action:'cancel',expectedVersion:old.version});
 assert.equal(cancel.status,200);
});

test('one completion may add at most the completion growth limit, and any write stays below the row limit',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db);
 let task=await store.createTask({title:'Result',prompt:'Work'});
 let claim=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 // No artifacts: the content is stored twice (message and final.md), 900 KB in all.
 await assert.rejects(store.finishExecution(task.id,{executionId:claim.executionId,generation:claim.generation,content:big(450_000)}),limited);
 task=await store.finishExecution(task.id,{executionId:claim.executionId,generation:claim.generation,content:'done',artifacts:[{name:'out.txt',mime:'text/plain',content:big(450_000)}]});
 assert.equal(task.status,'completed');
 await assert.rejects(store.replaceTask(task.id,task.version,current=>({...current,version:current.version+1,notes:big(TASK_BODY_MAX_BYTES)})),limited);
 assert.equal((await store.requireTask(task.id)).version,task.version);
});

test('the local store applies the same limits',()=>{
 const store=new SqliteTaskStore(':memory:');
 let task=store.createTask({title:'Long',prompt:'Work'});
 for(let i=0;i<4;i++)task=store.applyAction(task.id,{action:'message',content:big(200_000),expectedVersion:task.version});
 assert.throws(()=>store.applyAction(task.id,{action:'message',content:big(200_000),expectedVersion:task.version}),limited);
 assert.equal(store.requireTask(task.id).version,task.version);
});

// A task stored before this limit, or grown by a delegation, can be above the growth limit.
const padded=async(store,{status='ready',size=1_200_000,checkpoint}={})=>{
 const task=await store.createTask({title:'Old',prompt:'Work'});
 return store.replaceTask(task.id,task.version,current=>({...current,version:current.version+1,status,...(checkpoint?{checkpoint:{...(current.checkpoint??{}),...checkpoint}}:{}),notes:big(size)}));
};

test('an execution never starts above the growth limit: the task is paused and the desktop queue moves on',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db),bridge=new CloudBridge(store);
 const first=await padded(store,{status:'queued',checkpoint:{provider:'codex',status:'queued'}});
 await assert.rejects(store.claimExecution(first.id,{provider:'codex',expectedVersion:first.version}),error=>error instanceof ConflictError&&error.code==='TASK_BODY_LIMIT');
 const paused=await store.requireTask(first.id);
 assert.equal(paused.status,'paused');assert.equal(typeof paused.checkpoint.storageLimitAt,'string');assert.equal(paused.notes.length,1_200_000);
 const second=await padded(store,{status:'queued',checkpoint:{provider:'codex',status:'queued'}});
 const small=await store.createTask({prompt:'next'});await bridge.enqueue(small.id,{expectedVersion:1});
 assert.equal(await bridge.claim(),null);
 assert.equal((await store.requireTask(second.id)).status,'paused');
 assert.equal((await bridge.claim()).task.id,small.id);
});

test('a handoff ends a run like a completion, so it is stored even when it crosses the growth limit',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db);
 const task=await padded(store,{size:990_000});
 const claim=await store.claimExecution(task.id,{provider:'claude',expectedVersion:task.version});
 const handed=await store.handoffExecution(task.id,{...claim,content:'b'.repeat(11_000),handoff:{provider:'codex',instructions:'check',reason:'code tools',acceptance:'tests'}});
 assert.equal(handed.status,'queued');assert.ok(bytes(handed)>TASK_GROWTH_MAX_BYTES);
});

test('bytes are counted, not characters, and over-limit tasks keep resume and state changes',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db);
 let task=await store.createTask({title:'Korean',prompt:'Work'});
 for(let i=0;i<3;i++)task=await store.applyAction(task.id,{action:'message',content:'가'.repeat(100_000),expectedVersion:task.version});
 await assert.rejects(store.applyAction(task.id,{action:'message',content:'가'.repeat(100_000),expectedVersion:task.version}),limited);
 let over=await padded(store,{status:'paused'});
 over=await store.applyAction(over.id,{action:'resume',expectedVersion:over.version});
 assert.equal(over.status,'ready');
 // A row stored above the write limit before it existed can still be paused and cancelled.
 const legacy=await store.createTask({title:'Legacy',prompt:'Work'});
 const body={...legacy,notes:big(1_950_000)};
 await db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify(body),legacy.id).run();
 const pausedLegacy=await store.applyAction(legacy.id,{action:'pause',expectedVersion:legacy.version});
 assert.equal(pausedLegacy.status,'paused');
 assert.equal((await store.applyAction(legacy.id,{action:'cancel',expectedVersion:pausedLegacy.version})).status,'cancelled');
});
