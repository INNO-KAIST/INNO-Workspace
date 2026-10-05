import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';
import {legacyDeliveryState} from '../worker/legacy-delivery.mjs';

const token='legacy-delivery-token-0123456789';
async function fixture(t){
 const db=new TestD1();t.after(()=>db.close());
 const worker=createWorker({deliveryReceiptVersion:1,fetchFn:async()=>{throw Error('AI must not run');}}),env={DB:db,ACCESS_TOKEN:token};
 const store=new D1TaskStore(db),workspaceId=await workspaceIdentity(db);
 const task=await store.createTask({prompt:'Check 2+2'});
 const post=async(route,input,{receipts=true}={})=>{
  const headers={'content-type':'application/json',authorization:'Bearer '+token,...(receipts?{'x-inno-delivery-receipt-version':'1','x-inno-workspace-id':workspaceId}:{})};
  const response=await worker.fetch(new Request('https://inno.example'+route,{method:'POST',headers,body:JSON.stringify(input)}),env);
  return {status:response.status,...await response.json()};
 };
 return {db,store,task,workspaceId,post};
}

test('legacy results are classified only from the task state, never applied by the check',()=>{
 const owner={executionId:'e1',generation:2};
 const task=(status,checkpoint={})=>({status,version:5,checkpoint:{executionId:'e1',generation:2,...checkpoint}});
 assert.equal(legacyDeliveryState(null,owner,'complete'),'task_missing');
 assert.equal(legacyDeliveryState(task('running',{generation:3}),owner,'complete'),'owner_replaced');
 assert.equal(legacyDeliveryState(task('running',{deliveryReceiptVersion:1}),owner,'complete'),'receipt_required');
 assert.equal(legacyDeliveryState(task('running'),owner,'complete'),'deliverable');
 assert.equal(legacyDeliveryState(task('paused',{interruptedBy:'lease_expiry',interruptedVersion:5}),owner,'fail'),'deliverable');
 assert.equal(legacyDeliveryState(task('paused',{interruptedBy:'lease_expiry',interruptedVersion:4}),owner,'fail'),'not_running');
 assert.equal(legacyDeliveryState(task('completed'),owner,'complete'),'already_applied');
 assert.equal(legacyDeliveryState(task('waiting_connection'),owner,'fail'),'already_applied');
 assert.equal(legacyDeliveryState(task('completed'),owner,'fail'),'not_running');
 assert.equal(legacyDeliveryState(task('paused'),owner,'complete'),'not_running');
});

test('the legacy status route needs the receipt protocol and reports without changing the task',async t=>{
 const f=await fixture(t),owner=await f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:f.task.version});
 const route=`/api/desktop/${f.task.id}/legacy-status`,input={executionId:owner.executionId,generation:owner.generation,action:'complete'};
 assert.equal((await f.post(route,input,{receipts:false})).status,400);
 const before=await f.store.requireTask(f.task.id);
 assert.deepEqual(await f.post(route,input),{status:200,state:'deliverable'});
 assert.deepEqual(await f.store.requireTask(f.task.id),before);
 assert.deepEqual(await f.post(route,{...input,generation:owner.generation+1}),{status:200,state:'owner_replaced'});
 assert.deepEqual(await f.post('/api/desktop/missing-task/legacy-status',input),{status:200,state:'task_missing'});
 for(const bad of [{...input,action:'renew'},{...input,generation:0},{executionId:'',generation:1,action:'fail'},{...input,content:'x'}])assert.equal((await f.post(route,bad)).status,400);
});
