import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteTaskStore} from '../server/store.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {handleMcp} from '../server/mcp.mjs';
import {createContextBasis,verifyResumeState} from '../public/core/context-resume.mjs';
import {createWorker} from '../worker/index.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';

async function fixture(t,kind){
 const db=kind==='worker'?new TestD1():null,store=db?new D1TaskStore(db):new SqliteTaskStore(':memory:');
 t.after(()=>db?db.close():store.close());
 const task=await store.createTask({prompt:'PRIVATE_SOURCE Complete report'}),claim=await store.claimExecution(task.id,{provider:'claude',expectedVersion:task.version});
 const context=await createContextBasis(claim.task);
 const state={version:1,...context,items:[{kind:'completed',text:'Prepared report',references:[{section:'request',digest:context.basis.requestDigest}]}]};
 const owner={executionId:claim.executionId,generation:claim.generation};
 const mcp=args=>handleMcp(store,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'checkpoint_task',arguments:{taskId:task.id,...owner,status:'completed',content:'PRIVATE_FINAL_BODY',...args}}});
 return {db,store,task:await store.requireTask(task.id),state,owner,mcp};
}
for(const kind of ['local','worker']){
 for(const action of ['preserve','replace','clear'])test(`${kind} final completion ${action}s resume state with result and artifacts atomically`,async t=>{
  const f=await fixture(t,kind);
  await f.store.applyExecutionAction(f.task.id,{...f.owner,action:'checkpoint',content:'progress',resumeState:f.state});
  const replacement={...f.state,items:[{...f.state.items[0],text:'Verified final report'}]};
  const field=action==='preserve'?{}:{resumeState:action==='replace'?replacement:null};
  const done=await f.store.finishExecution(f.task.id,{...f.owner,content:'Final report',...field});
  assert.equal(done.status,'completed');assert.equal(done.messages.at(-1).content,'Final report');assert.equal(done.artifacts.at(-1).content,'Final report');
  assert.deepEqual(done.checkpoint.resumeState,action==='clear'?undefined:action==='replace'?replacement:f.state);
  const verified=await verifyResumeState(done);
  assert.equal(verified.status,action==='clear'?'missing':'source_matched');
  if(action!=='clear')assert.deepEqual(verified.pendingMessageIndexes,[done.messages.length-1]);
 });
 test(`${kind} invalid final resume state and stale owner cannot partially complete`,async t=>{
  const f=await fixture(t,kind),snapshot=await f.store.requireTask(f.task.id);
  for(const patch of [{resumeState:{...f.state,taskId:'other-task'}},{resumeState:{...f.state,extra:'PRIVATE_UNKNOWN'}},{resumeState:{...f.state,items:[]}},{resumeState:f.state,generation:f.owner.generation+1}]){
   await assert.rejects(async()=>f.store.finishExecution(f.task.id,{...f.owner,content:'must not commit',...patch}));
   assert.deepEqual(await f.store.requireTask(f.task.id),snapshot);
  }
 });
 test(`${kind} MCP completion accepts identical resume replay and rejects changed late state`,async t=>{
  const f=await fixture(t,kind),first=await f.mcp({resumeState:f.state});
  assert.equal(first.result.isError,undefined);
  const saved=await f.store.requireTask(f.task.id),expected={task:{id:saved.id,status:'completed',version:saved.version},resumeStateSaved:true};
  assert.deepEqual(JSON.parse(first.result.content[0].text),expected);assert.doesNotMatch(JSON.stringify(first),/PRIVATE_|messages|artifacts|executionId/);
  const replay=await f.mcp({resumeState:JSON.parse(JSON.stringify(f.state))});assert.deepEqual(JSON.parse(replay.result.content[0].text),expected);
  for(const resumeState of [null,{...f.state,items:[{...f.state.items[0],text:'late change'}]}])assert.equal((await f.mcp({resumeState})).result.isError,true);
  assert.deepEqual(await f.store.requireTask(f.task.id),saved);
 });
 test(`${kind} MCP cleared-state completion replay rejects a late replacement`,async t=>{
  const f=await fixture(t,kind);
  assert.equal((await f.mcp({resumeState:null})).result.isError,undefined);
  assert.equal((await f.mcp({resumeState:null})).result.isError,undefined);
  assert.equal((await f.mcp({resumeState:f.state})).result.isError,true);
  assert.equal((await f.store.requireTask(f.task.id)).checkpoint.resumeState,undefined);
 });
}

test('receipt HTTP completion persists resume state and binds exact replay to its payload digest',async t=>{
 const DB=new TestD1();t.after(()=>DB.close());const store=new D1TaskStore(DB),workspaceId=await workspaceIdentity(DB);
 const task=await store.createTask({prompt:'PRIVATE_RECEIPT_SOURCE'}),claim=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version},{deliveryReceiptVersion:1,workspaceId});
 const context=await createContextBasis(claim.task),state={version:1,...context,items:[{kind:'completed',text:'Ready',references:[{section:'request',digest:context.basis.requestDigest}]}]};
 const input={executionId:claim.executionId,generation:claim.generation,content:'Final report',resumeState:state};
 const descriptor=await createDeliveryReceipt({workspaceId,taskId:task.id,action:'complete',input});
 const worker=createWorker({deliveryReceiptVersion:1,fetchFn:async()=>{throw Error('No provider execution');}}),env={DB,ACCESS_TOKEN:'test-resume-receipt-01234567890123456789'};
 const post=async value=>{const response=await worker.fetch(new Request(`https://inno.test/api/desktop/${task.id}/complete`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json','x-inno-delivery-receipt-version':'1','x-inno-workspace-id':workspaceId},body:JSON.stringify(value)}),env);return {status:response.status,...await response.json()};};
 const accepted=await post(input);assert.equal(accepted.status,200);assert.equal(accepted.deliveryReceipt.payloadDigest,descriptor.payloadDigest);
 const completed=await store.requireTask(task.id);assert.deepEqual(completed.checkpoint.resumeState,state);
 const replay=await post(input);assert.equal(replay.status,200);assert.equal(replay.replayed,true);
 const changed={...input,resumeState:{...state,items:[{...state.items[0],text:'Changed state'}]}};
 const changedReceipt=await createDeliveryReceipt({workspaceId,taskId:task.id,action:'complete',input:changed});
 assert.notEqual(changedReceipt.payloadDigest,descriptor.payloadDigest);
 assert.equal((await post(changed)).status,409);assert.deepEqual(await store.requireTask(task.id),completed);
});

test('legacy HTTP replay compares resume state and unsupported transitions reject before state mutation',async t=>{
 const f=await fixture(t,'worker'),worker=createWorker({fetchFn:async()=>{throw Error('No provider execution');}}),env={DB:f.db,ACCESS_TOKEN:'test-legacy-resume-01234567890123456789'};
 const post=async input=>{const response=await worker.fetch(new Request(`https://inno.test/api/desktop/${f.task.id}/complete`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify(input)}),env);return {status:response.status,...await response.json()};};
 const input={...f.owner,content:'Final report',resumeState:f.state};
 for(const patch of [{handoff:{provider:'codex'}},{delegation:{children:[]}},{reviewReport:[{criteria:[{status:'fail'}]}]}]){
  const rejected=await post({...input,...patch});assert.equal(rejected.status,400);assert.match(rejected.error,/Resume state is not supported/);
  assert.deepEqual(await f.store.requireTask(f.task.id),f.task);
 }
 assert.equal((await post(input)).status,200);
 const completed=await f.store.requireTask(f.task.id);
 assert.equal((await post(input)).status,200);
 assert.equal((await post({...input,resumeState:null})).status,409);
 assert.equal((await post({...input,resumeState:{...f.state,items:[{...f.state.items[0],text:'late edit'}]}})).status,409);
 assert.deepEqual(await f.store.requireTask(f.task.id),completed);
});

test('D1 completion CAS loss cannot save resume state, result, artifact, or usage partially',async t=>{
 const f=await fixture(t,'worker'),original=f.db.batch.bind(f.db);
 const changed={...f.task,version:f.task.version+1,checkpoint:{...f.task.checkpoint,executionId:'new-owner'}};
 f.db.batch=async statements=>{
  f.db.batch=original;
  f.db.db.prepare('UPDATE tasks SET version=?,body=? WHERE id=?').run(changed.version,JSON.stringify(changed),f.task.id);
  return original(statements);
 };
 await assert.rejects(()=>f.store.finishExecution(f.task.id,{...f.owner,content:'Rejected result',resumeState:f.state,usage:{inputTokens:10,outputTokens:5}}),error=>error.statusCode===409);
 assert.deepEqual(await f.store.requireTask(f.task.id),changed);
});

for(const phase of ['retry','waiting_user'])test(`review ${phase} replay cannot silently drop a later passing resume state`,async t=>{
 const f=await fixture(t,'worker');
 const parent=await f.store.replaceTask(f.task.id,f.task.version,current=>({...current,version:current.version+1,status:phase==='retry'?'waiting_children':'waiting_user',delegation:{state:phase==='retry'?'waiting_children':'reviewing',...(phase==='retry'?{lastReviewRetry:f.owner}:{})}}));
 const worker=createWorker(),env={DB:f.db,ACCESS_TOKEN:'test-review-replay-01234567890123456789'};
 const post=async field=>{const response=await worker.fetch(new Request(`https://inno.test/api/desktop/${f.task.id}/complete`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({...f.owner,content:'late pass',reviewReport:[{criteria:[{status:'pass'}]}],...field})}),env);return {status:response.status,...await response.json()};};
 assert.equal((await post({})).status,200);
 const rejected=await post({resumeState:f.state});assert.equal(rejected.status,400);assert.match(rejected.error,/non-completion review replay/);
 assert.deepEqual(await f.store.requireTask(f.task.id),parent);
});
