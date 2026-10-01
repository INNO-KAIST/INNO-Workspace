import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import exportedWorker,{createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';
import {createOrchestration} from '../worker/orchestration.mjs';
const token='protocol-http-token-012345678901234';
async function fixture(t){
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),workspaceId=await workspaceIdentity(db);
 const worker=createWorker({deliveryReceiptVersion:1,fetchFn:async()=>{throw Error('AI must not run');}}),env={DB:db,ACCESS_TOKEN:token};
 const task=await store.createTask({prompt:'Calculate 2+2'});
 const post=async(path,input={},options={})=>{
  const {version='1',workspace=workspaceId,auth=true,target=worker}=options;
  const response=await target.fetch(new Request('https://inno.example/api/desktop/'+path,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{}),...(version!==null?{'x-inno-delivery-receipt-version':version}:{}),...(workspace!==null?{'x-inno-workspace-id':workspace}:{})},body:typeof input==='string'?input:JSON.stringify(input)}),env);
  return {status:response.status,...await response.json()};
 };
 const start=options=>post(task.id+'/start',{expectedVersion:task.version,sourceNames:[]},options);
 const rows=()=>db.prepare("SELECT key,value FROM metadata WHERE key GLOB 'desktop_reservation:*' OR key GLOB 'desktop_receipt:*' ORDER BY key").all();
 return {db,store,task,workspaceId,post,start,rows};
}
const result=claim=>({executionId:claim.executionId,generation:claim.generation,content:'4'});
test('versioned start confirms protocol and ACK frees last capacity slot without task/catalog reads',async t=>{
 const f=await fixture(t);for(let i=0;i<1023;i++)await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind('desktop_receipt:held'+i,'held').run();
 const started=await f.start();assert.equal(started.status,200,JSON.stringify(started));assert.equal(started.deliveryReceiptVersion,1);assert.equal(started.claim.task.checkpoint.deliveryReceiptVersion,1);
 const accepted=await f.post(f.task.id+'/complete',result(started.claim));assert.equal(accepted.status,200,JSON.stringify(accepted));assert.equal((await f.rows()).results.length,1024);
 const next=await f.store.createTask({prompt:'Another calculation'});await new CloudBridge(f.store).enqueue(next.id,{expectedVersion:next.version});
 const blocked=await f.post('poll');assert.equal(blocked.status,409);assert.equal(blocked.code,'DESKTOP_DELIVERY_CAPACITY');
 let reads=0;const original=f.db.prepare.bind(f.db);f.db.prepare=sql=>{if(/FROM tasks|desktop_models/i.test(sql))reads++;return original(sql);};
 const before=await original("SELECT value FROM metadata WHERE key='revision'").first();
 const ack=await f.post(f.task.id+'/ack',{receipt:accepted.deliveryReceipt,models:{bad:true}});assert.equal(ack.status,200,JSON.stringify(ack));assert.equal(ack.released,true);assert.deepEqual(ack.receipt,accepted.deliveryReceipt);
 const repeated=await f.post(f.task.id+'/ack',{receipt:ack.receipt});assert.equal(repeated.status,200);assert.equal(repeated.released,false);assert.equal(reads,0);assert.deepEqual(await original("SELECT value FROM metadata WHERE key='revision'").first(),before);f.db.prepare=original;
 const reused=await f.post('poll');assert.equal(reused.status,200);assert.equal(reused.deliveryReceiptVersion,1);assert.equal(reused.claim.task.id,next.id);assert.equal(reused.claim.task.checkpoint.deliveryReceiptVersion,1);
});
test('poll confirms version even when empty; no-header legacy claims and results remain supported',async t=>{
 const f=await fixture(t),empty=await f.post('poll');assert.equal(empty.status,200);assert.equal(empty.claim,null);assert.equal(empty.deliveryReceiptVersion,1);
 const legacy=await f.start({version:null});assert.equal(legacy.status,200);assert.equal(legacy.deliveryReceiptVersion,undefined);assert.equal(legacy.claim.task.checkpoint.deliveryReceiptVersion,undefined);assert.equal((await f.rows()).results.length,0);
 const completed=await f.post(f.task.id+'/complete',result(legacy.claim),{version:null});assert.equal(completed.status,200);assert.equal(completed.deliveryReceipt,undefined);
});
test('claim and ACK headers/auth/workspace reject before body parsing and mutation; exported worker stays disabled',async t=>{
 const f=await fixture(t),before=await f.store.requireTask(f.task.id);
 for(const path of ['poll',f.task.id+'/start',f.task.id+'/ack'])for(const options of [{version:'2'},{workspace:null},{workspace:'11111111-1111-4111-8111-111111111111'},{target:exportedWorker},{auth:false}]){
  const denied=await f.post(path,'{broken',options);assert.ok([400,401,409].includes(denied.status),JSON.stringify(denied));assert.notEqual(denied.error,'request body must be valid JSON');
 }
 assert.deepEqual(await f.store.requireTask(f.task.id),before);assert.equal((await f.rows()).results.length,0);
 const noHeader=await f.post(f.task.id+'/ack',{}, {version:null});assert.equal(noHeader.status,400);
});
test('ACK rejects URL mismatch, forged digest/time, incomplete or extra receipt fields and retains accepted receipt',async t=>{
 const f=await fixture(t),start=await f.start();assert.equal(start.status,200);const accepted=await f.post(f.task.id+'/complete',result(start.claim)),receipt=accepted.deliveryReceipt;assert.ok(receipt);
 for(const [path,value] of [['other/ack',receipt],[f.task.id+'/ack',{...receipt,payloadDigest:'0'.repeat(64)}],[f.task.id+'/ack',{...receipt,acceptedAt:'2026-01-01T00:00:00.000Z'}],[f.task.id+'/ack',{...receipt,extra:true}],[f.task.id+'/ack',null]]){
  const denied=await f.post(path,{receipt:value});assert.equal(denied.status,409,JSON.stringify(denied));assert.equal((await f.rows()).results.length,1);
 }
 assert.equal((await f.post(f.task.id+'/ack',{receipt})).released,true);
});
test('opted hydration failure preserves original error and owner reservation; legacy still records failure',async t=>{
 for(const opted of [true,false]){
  const f=await fixture(t),claim=await f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:f.task.version},opted?{deliveryReceiptVersion:1,workspaceId:f.workspaceId}:{});
  claim.task.delegation={state:'reviewing',review:{children:[]}};
  const orchestration=createOrchestration({store:f.store});await assert.rejects(()=>orchestration.hydrateClaim(claim),/Review child manifest missing/);
  assert.equal((await f.store.requireTask(f.task.id)).status,opted?'running':'failed');assert.equal((await f.rows()).results.length,opted?1:0);
 }
});
