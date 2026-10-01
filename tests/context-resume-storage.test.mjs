import {readTaskContext} from '../public/core/task-context-read.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMcp} from '../server/mcp.mjs';
import {SqliteTaskStore} from '../server/store.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {createWorker} from '../worker/index.mjs';
import {executionCapability} from '../worker/execution-scope.mjs';
import {TestD1} from './helpers/d1.mjs';

const decoded=response=>JSON.parse(response.result.content[0].text);
async function fixture(t,kind){
 const db=kind==='worker'?new TestD1():null;
 const store=db?new D1TaskStore(db):new SqliteTaskStore(':memory:');
 t.after(()=>db?db.close():store.close());
 let task=await store.createTask({prompt:'PRIVATE_REQUEST finish the report'});
 task=await store.replaceTask(task.id,task.version,current=>({...current,version:current.version+1,attachments:[{id:'source',name:'evidence.txt',content:'PRIVATE_ATTACHMENT_BYTES'}],artifacts:[{id:'generated',content:'PRIVATE_ARTIFACT_BYTES'}]}));
 const claim=await store.claimExecution(task.id,{provider:'claude',expectedVersion:task.version}),owner={taskId:task.id,executionId:claim.executionId,generation:claim.generation};
 const env={DB:db,ACCESS_TOKEN:'test-resume-context-01234567890123456789'},token=await executionCapability(env.ACCESS_TOKEN,claim);
 const worker=createWorker({fetchFn:async()=>{throw Error('No external execution');}});
 const call=async(name,args)=>{
  const message={jsonrpc:'2.0',id:1,method:'tools/call',executionCapability:token,params:{name,arguments:args}};
  if(!db)return handleMcp(store,message);
  const response=await worker.fetch(new Request('https://inno.test/mcp',{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify(message)}),env);
  return response.json();
 };
 const read=async(section,extra={})=>call('read_task_context',{taskId:task.id,expectedVersion:(await store.requireTask(task.id)).version,section,...extra});
 return {store,owner,call,read,id:task.id};
}
for(const kind of ['local','worker']){
 test(`${kind} MCP saves one resume state atomically with bounded acknowledgements, preserves omissions and clears null`,async t=>{
  const f=await fixture(t,kind),basisReply=await f.read('basis');
  assert.equal(basisReply.result.isError,undefined);
  const basis=decoded(basisReply);
  assert.doesNotMatch(JSON.stringify(basis),/PRIVATE_/);
  const state={version:1,taskId:f.id,mode:basis.mode,basis:basis.basis,items:[{kind:'goal',text:'Finish report',references:[{section:'request',digest:basis.basis.requestDigest}]}]};
  const saved=await f.call('checkpoint_task',{...f.owner,content:'PRIVATE_CHECKPOINT_TEXT',resumeState:state});
  assert.equal(saved.result.isError,undefined);
  assert.deepEqual(decoded(saved),{task:{id:f.id,status:'running',version:(await f.store.requireTask(f.id)).version},resumeStateSaved:true});
  assert.doesNotMatch(JSON.stringify(saved),/PRIVATE_|messages|attachments|artifacts|executionId/);
  assert.deepEqual((await f.store.requireTask(f.id)).checkpoint.resumeState,state);
  const before=(await f.store.requireTask(f.id)).version;
  const overwritten={...state,items:[{...state.items[0],text:'Finish revised report'}]};
  await f.call('checkpoint_task',{...f.owner,content:'checkpoint update',resumeState:overwritten});
  assert.deepEqual((await f.store.requireTask(f.id)).checkpoint.resumeState,overwritten);
  await f.call('checkpoint_task',{...f.owner,content:'checkpoint without resume state'});
  assert.deepEqual((await f.store.requireTask(f.id)).checkpoint.resumeState,overwritten);
  await assert.rejects(async()=>f.store.applyAction(f.id,{action:'checkpoint',expectedVersion:before,content:'stale write',resumeState:null}));
  const snapshot=await f.store.requireTask(f.id);
  for(const invalid of [{...state,taskId:'wrong-task'},{...state,raw:'PRIVATE_INVALID'},{...state,items:[]}]){
   const rejected=await f.call('checkpoint_task',{...f.owner,content:'must not persist',resumeState:invalid});
   assert.equal(rejected.result.isError,true);assert.deepEqual(await f.store.requireTask(f.id),snapshot);
  }
  const wrongOwner=await f.call('checkpoint_task',{...f.owner,generation:f.owner.generation+1,content:'wrong owner',resumeState:null});
  assert.ok(wrongOwner.error||wrongOwner.result?.isError);assert.deepEqual(await f.store.requireTask(f.id),snapshot);
  const completed=await f.call('checkpoint_task',{...f.owner,status:'completed',content:'must not complete',resumeState:state});
  assert.equal(completed.result.isError,true);assert.deepEqual(await f.store.requireTask(f.id),snapshot);
  const cleared=await f.call('checkpoint_task',{...f.owner,content:'clear state',resumeState:null});
  assert.equal(decoded(cleared).resumeStateSaved,false);
  assert.equal((await f.store.requireTask(f.id)).checkpoint.resumeState,undefined);
  assert.equal(decoded(await f.read('resume')).status,'missing');
 });

 test(`${kind} resume reads verify sources, survive ownership metadata updates, and reject incompatible selectors`,async t=>{
  const f=await fixture(t,kind),basis=decoded(await f.read('basis'));
  const state={version:1,taskId:f.id,mode:basis.mode,basis:basis.basis,items:[{kind:'pending',text:'Write remaining section',references:[{section:'request',digest:basis.basis.requestDigest}]}]};
  await f.call('checkpoint_task',{...f.owner,content:'checkpoint',resumeState:state});
  let result=decoded(await f.read('resume'));
  assert.equal(result.status,'source_matched');assert.deepEqual(result.state,state);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
  if(kind==='worker')await f.store.renewExecution(f.id,{...f.owner,leaseMs:60000});
  else await f.call('checkpoint_task',{...f.owner,content:'Updated checkpoint only'});
  assert.equal(decoded(await f.read('resume')).status,'source_matched');
  for(const [section,extra] of [['basis',{offset:0}],['basis',{maxBytes:4}],['basis',{messageIndex:0}],['resume',{messageCount:0}],['request',{messageCount:0}],['resume',{expectedDigest:'0'.repeat(64)}]]){
   assert.equal((await f.read(section,extra)).result.isError,true);
  }
  const prefix=decoded(await f.read('basis',{messageCount:0}));assert.equal(prefix.basis.messageCount,0);
  const task=await f.store.requireTask(f.id);
  await f.store.replaceTask(f.id,task.version,current=>({...current,version:current.version+1,prompt:'PRIVATE_CHANGED_REQUEST'}));
  result=decoded(await f.read('resume'));assert.equal(result.status,'stale');assert.equal(result.state,null);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|Finish report|Write remaining section/);
 });
}

test('structured context selectors and stale versions reject before inspecting source content',async()=>{
 const task={id:'safe-task',version:2,get prompt(){throw Error('source content must not be inspected');},get messages(){throw Error('messages must not be inspected');}};
 for(const args of [
  {section:'basis',offset:0},{section:'basis',messageCount:-1},{section:'basis',messageCount:undefined},
  {section:'resume',messageCount:0},{section:'resume',maxBytes:4},
 ])await assert.rejects(()=>readTaskContext(task,{taskId:task.id,expectedVersion:2,...args}),error=>error.statusCode===400);
 for(const section of ['basis','resume'])await assert.rejects(()=>readTaskContext(task,{taskId:task.id,expectedVersion:1,section}),error=>error.code==='CONTEXT_VERSION_CONFLICT');
});
