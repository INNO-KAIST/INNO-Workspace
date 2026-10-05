import test from 'node:test';
import assert from 'node:assert/strict';
import {createTask,applyAction,ValidationError} from '../public/core/tasks.mjs';
import {buildTaskContext,FULL_CONTEXT_HARD_MAX_BYTES} from '../public/core/task-context.mjs';
import {FULL_CONTEXT_HARD_MAX_BYTES as LIMIT,EMPTY_CHECKPOINT_TEXT,EMPTY_CONVERSATION_TEXT,messageLine} from '../public/core/context-limits.mjs';
import {createWorker} from '../worker/index.mjs';
import {TestD1} from './helpers/d1.mjs';

// The request, the checkpoint and every user turn are always delivered inline. A write
// that makes those alone exceed the hard cap could never run, so it is refused when
// written instead of failing at every run.
let sequence=0;
const fixed={now:()=>'2026-10-06T00:00:00.000Z',id:()=>`cap-${++sequence}`};
const utf8=text=>Buffer.byteLength(text);
const korean=bytes=>'가'.repeat(Math.floor(bytes/3))+'a'.repeat(bytes%3); // stays far below 200000 characters
const refused=error=>error instanceof ValidationError&&/384KB/.test(error.message)&&/첨부/.test(error.message);
const runnable=async task=>(await buildTaskContext(task)).readiness!=='blocked';

test('the hard cap and placeholders have one source shared by the assembler and input validation',()=>{
 assert.equal(LIMIT,384_000);assert.equal(FULL_CONTEXT_HARD_MAX_BYTES,LIMIT);
});

test('a new request is accepted exactly while the new task can still run',async()=>{
 const largest=LIMIT-utf8(EMPTY_CHECKPOINT_TEXT)-utf8(EMPTY_CONVERSATION_TEXT);
 const accepted=createTask({prompt:korean(largest)},fixed);
 assert.equal(await runnable(accepted),true);
 assert.equal(await runnable({...accepted,prompt:korean(largest+1),messages:[{...accepted.messages[0],content:korean(largest+1)}]}),false);
 assert.throws(()=>createTask({prompt:korean(largest+1)},fixed),refused);
});

test('a user message or decision is refused once request, checkpoint and that turn exceed the cap',async()=>{
 const task=createTask({prompt:'Draft'},fixed);
 const largest=LIMIT-utf8('Draft')-utf8(EMPTY_CHECKPOINT_TEXT)-utf8(messageLine(1,'user',''));
 const accepted=applyAction(task,{action:'message',expectedVersion:1,content:korean(largest)},fixed);
 assert.equal(await runnable(accepted),true);
 assert.throws(()=>applyAction(task,{action:'message',expectedVersion:1,content:korean(largest+1)},fixed),refused);
 assert.equal(task.messages.length,1);
 const withCheckpoint={...task,checkpoint:{content:'c'.repeat(1000)}};
 const checkpointExtra=1000-utf8(EMPTY_CHECKPOINT_TEXT);
 assert.equal(await runnable(applyAction(withCheckpoint,{action:'message',expectedVersion:1,content:korean(largest-checkpointExtra)},fixed)),true);
 assert.throws(()=>applyAction(withCheckpoint,{action:'message',expectedVersion:1,content:korean(largest-checkpointExtra+1)},fixed),refused);
 const waiting={...task,status:'waiting_user'};
 assert.throws(()=>applyAction(waiting,{action:'decide',expectedVersion:1,content:korean(largest+1)},fixed),refused);
});

test('a first message equal to the request is counted the way the assembler sends it',async()=>{
 // Imported tasks may have no messages; the assembler then sends such a first
 // message as a reference to the request, not as a second copy.
 const prompt=korean(250_000);
 const imported={...createTask({prompt:'Draft'},fixed),prompt,messages:[]};
 const accepted=applyAction(imported,{action:'message',expectedVersion:1,content:prompt},fixed);
 assert.equal(accepted.messages.length,1);assert.equal(await runnable(accepted),true);
});

test('the Worker answers an oversized request with 400 and stores nothing',async t=>{
 const DB=new TestD1();t.after(()=>DB.close());
 const env={DB,ACCESS_TOKEN:'test-inline-cap-0123456789012345678901'};
 const worker=createWorker();
 const call=(path,body)=>worker.fetch(new Request('https://inno.test'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
 const response=await call('/api/tasks',{prompt:korean(LIMIT)});
 assert.equal(response.status,400);assert.match((await response.json()).error,/384KB/);
 assert.equal((await (await call('/api/state')).json()).tasks.length,0);
});
