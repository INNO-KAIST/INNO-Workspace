import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteTaskStore} from '../server/store.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';

const delivery=(provider='codex',readiness='full_over_budget')=>({version:1,provider,unit:'utf8_bytes',readiness,contextBytes:120000,originalBytes:121000,selectionSavedBytes:0,omittedMessages:0,maxBytes:96000,hardMaxBytes:384000,reader:false,promptBytes:150000,materialBytes:0,inputTokens:null,cachedTokens:null});
async function claimed(t,kind,provider='codex'){
 const db=kind==='worker'?new TestD1():null,store=db?new D1TaskStore(db):new SqliteTaskStore(':memory:');
 t.after(()=>db?db.close():store.close());
 const task=await store.createTask({prompt:'Report'}),claim=await store.claimExecution(task.id,{provider,expectedVersion:task.version});
 return {store,id:task.id,owner:{executionId:claim.executionId,generation:claim.generation}};
}

for(const kind of ['local','worker']){
 test(`${kind} completion stores the execution's context delivery once`,async t=>{
  const {store,id,owner}=await claimed(t,kind);
  const done=await store.finishExecution(id,{...owner,content:'done',contextDelivery:delivery()});
  assert.deepEqual(done.checkpoint.contextDelivery,delivery());
 });

 test(`${kind} completion keeps measured scoped re-reads with the delivery`,async t=>{
  const {store,id,owner}=await claimed(t,kind);
  const measured={...delivery('codex','selected_ready'),reader:true,retrievalRequests:4,retrievalBytes:9000};
  const done=await store.finishExecution(id,{...owner,content:'done',contextDelivery:measured});
  assert.deepEqual(done.checkpoint.contextDelivery,measured);
 });

 test(`${kind} failure stores the context delivery that explains it`,async t=>{
  const {store,id,owner}=await claimed(t,kind);
  const failed=await store.failExecution(id,{...owner,failure:{kind:'context'},contextDelivery:delivery('codex','blocked')});
  assert.equal(failed.status,'failed');assert.equal(failed.checkpoint.contextDelivery.readiness,'blocked');
 });

 for(const bad of [{...delivery(),inputTokens:5},delivery('claude')])test(`${kind} drops ${bad.provider==='claude'?'mismatched':'invalid'} delivery evidence but keeps the result`,async t=>{
  const {store,id,owner}=await claimed(t,kind);
  const done=await store.finishExecution(id,{...owner,content:'kept',contextDelivery:bad});
  assert.equal(done.status,'completed');assert.equal(done.messages.at(-1).content,'kept');assert.equal(done.checkpoint.contextDelivery,undefined);
 });

 test(`${kind} drops mismatched delivery evidence but keeps the failure`,async t=>{
  const {store,id,owner}=await claimed(t,kind);
  const failed=await store.failExecution(id,{...owner,failure:{kind:'unknown'},contextDelivery:delivery('claude')});
  assert.equal(failed.status,'failed');assert.equal(failed.checkpoint.contextDelivery,undefined);
 });

 test(`${kind} a new claim clears the previous execution's delivery`,async t=>{
  const {store,id,owner}=await claimed(t,kind);
  const failed=await store.failExecution(id,{...owner,failure:{kind:'unknown'},contextDelivery:delivery()});
  const again=await store.claimExecution(id,{provider:'codex',expectedVersion:failed.version});
  assert.equal(again.task.checkpoint.contextDelivery,undefined);
 });
}
