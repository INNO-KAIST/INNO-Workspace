import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
import {Delegations} from '../worker/delegations.mjs';

const token='receipt-http-test-token-0123456789';
const assignments=['codex','claude'].map(provider=>({role:provider+' check',provider,requestedModel:provider==='codex'?'gpt-5.6-luna':'haiku',effort:'low',sufficientReason:'Independent calculation',acceptanceCriteria:['Result is 4'],instructions:'Calculate 2+2'}));
const reviewReport=(children,status='pass')=>children.map(child=>({childTaskId:child.id,criteria:child.assignment.acceptanceCriteria.map(criterion=>({criterion,status,evidence:'Checked arithmetic'}))}));
async function fixture(t,{enabled=true}={}){
 const db=new TestD1();t.after(()=>db.close());
 let external=0;const worker=createWorker({deliveryReceiptVersion:enabled?1:0,fetchFn:async()=>{external++;throw Error('AI must not run');}}),env={DB:db,ACCESS_TOKEN:token};
 const store=new D1TaskStore(db),workspaceId=await workspaceIdentity(db);
 const task=await store.createTask({prompt:'Check 2+2'}),owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 const post=async(id,action,input,{version='1',workspace=workspaceId,auth=true}={})=>{
  const headers={'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{}),...(version!==null?{'x-inno-delivery-receipt-version':version}:{}),...(workspace!==null?{'x-inno-workspace-id':workspace}:{})};
  const response=await worker.fetch(new Request(`https://inno.example/api/desktop/${encodeURIComponent(id)}/${action}`,{method:'POST',headers,body:typeof input==='string'?input:JSON.stringify(input)}),env);
  return {status:response.status,...await response.json()};
 };
 const receipt=(id,action,input)=>createDeliveryReceipt({workspaceId,taskId:id,action,input});
 const saved=async id=>(await db.prepare('SELECT value FROM metadata WHERE key=?1').bind('desktop_receipt:'+id).first())?.value??null;
 const revision=async()=>Number((await db.prepare("SELECT value FROM metadata WHERE key='revision'").first()).value);
 return {db,store,worker,env,workspaceId,task,owner,post,receipt,saved,revision,external:()=>external};
}
const input=owner=>({executionId:owner.executionId,generation:owner.generation,content:'4'});

async function reviewFixture(t){
 const f=await fixture(t),delegations=new Delegations(f.store);
 const allocated=await delegations.allocate(f.task.id,{...f.owner,independent:true,children:assignments});
 for(const child of allocated.children){const claimed=await f.store.claimExecution(child.id,{provider:child.assignment.provider,expectedVersion:child.version});await f.store.finishExecution(child.id,{...claimed,content:'4'});}
 const ready=await delegations.reconcile(f.task.id),review=await f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:ready.parent.version});
 return {...f,allocated,review};
}

test('HTTP accepts a receipt then lost-response replay before model report or task read, even after follow-up',async t=>{
 const f=await fixture(t),models={models:[{model:'gpt-5.6-luna',efforts:['low'],isDefault:false}],observedAt:Date.now(),status:'fresh'},result={...input(f.owner),models},expected=await f.receipt(f.task.id,'complete',result);
 const first=await f.post(f.task.id,'complete',result);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.replayed,false);assert.deepEqual(first.deliveryReceipt,{...expected,acceptedAt:first.deliveryReceipt?.acceptedAt});
 assert.ok(await f.saved(expected.id));
 let taskReads=0,modelCalls=0;const original=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>{if(sql.includes('FROM tasks'))taskReads++;if(sql.includes('desktop_models'))modelCalls++;return original(sql);};
 const before=await f.revision(),replay=await f.post(f.task.id,'complete',result);
 assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.replayed,true);assert.equal(replay.task,undefined);assert.deepEqual(replay.deliveryReceipt,first.deliveryReceipt);
 assert.equal(taskReads,0);assert.equal(modelCalls,0);assert.equal(await f.revision(),before);assert.equal(f.external(),0);
 f.db.prepare=original;
 const changed=await f.store.applyAction(f.task.id,{action:'message',expectedVersion:first.task.version,content:'Do one more check'});
 assert.ok(changed.version>first.task.version);
 const newOwner=await f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:changed.version});
 assert.ok(newOwner.generation>f.owner.generation);
 const current=await f.store.requireTask(f.task.id),currentRevision=await f.revision();
 assert.equal(current.status,'running');assert.equal(current.checkpoint.executionId,newOwner.executionId);
 const afterFollowUp=await f.post(f.task.id,'complete',result);
 assert.equal(afterFollowUp.status,200);assert.equal(afterFollowUp.replayed,true);assert.equal(afterFollowUp.task,undefined);
 assert.deepEqual(await f.store.requireTask(f.task.id),current);assert.equal(await f.revision(),currentRevision);
});

test('same receipt identity with different wire payload conflicts and cannot silently reuse accepted output',async t=>{
 const f=await fixture(t),result=input(f.owner),first=await f.post(f.task.id,'complete',result);assert.equal(first.status,200);
 const before=await f.revision(),changed=await f.post(f.task.id,'complete',{...result,content:'different'});
 assert.equal(changed.status,409);assert.equal(await f.revision(),before);
 assert.equal((await f.store.requireTask(f.task.id)).messages.filter(message=>message.role==='assistant').length,1);
});

test('version and workspace headers gate all receipt requests before body or task mutation',async t=>{
 const f=await fixture(t),result=input(f.owner),before=await f.revision();
 for(const options of [{version:'2'},{workspace:null},{workspace:'e3f2aac2-77c5-43df-9088-aaf7ea402b49'}]){
  const response=await f.post(f.task.id,'complete','{broken',options);assert.ok([400,409].includes(response.status),JSON.stringify(response));assert.notEqual(response.error,'request body must be valid JSON');
 }
 const off=await fixture(t,{enabled:false});const disabled=await off.post(off.task.id,'complete','{broken');assert.equal(disabled.status,400);assert.notEqual(disabled.error,'request body must be valid JSON');
 const renew=await f.post(f.task.id,'renew','{broken');assert.equal(renew.status,400);assert.notEqual(renew.error,'request body must be valid JSON');
 const unauth=await f.post(f.task.id,'complete',result,{auth:false});assert.equal(unauth.status,401);
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');assert.equal(await f.revision(),before);
});

test('legacy preaccepted result has no receipt and opt-in replay cannot manufacture one',async t=>{
 const f=await fixture(t),result=input(f.owner),legacy=await f.post(f.task.id,'complete',result,{version:null});assert.equal(legacy.status,200);assert.equal(legacy.deliveryReceipt,undefined);
 const descriptor=await f.receipt(f.task.id,'complete',result);assert.equal(await f.saved(descriptor.id),null);
 const before=await f.revision(),replay=await f.post(f.task.id,'complete',result);assert.equal(replay.status,409);assert.equal(await f.saved(descriptor.id),null);assert.equal(await f.revision(),before);
});

test('receipt insert failure rolls task and revision back; later retry can accept exactly once',async t=>{
 const f=await fixture(t),result=input(f.owner),expected=await f.receipt(f.task.id,'complete',result),before=await f.revision();
 f.db.db.exec("CREATE TRIGGER receipt_abort BEFORE INSERT ON metadata WHEN NEW.key GLOB 'desktop_receipt:*' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");
 const failed=await f.post(f.task.id,'complete',result);assert.equal(failed.status,500);assert.equal((await f.store.requireTask(f.task.id)).status,'running');assert.equal(await f.revision(),before);assert.equal(await f.saved(expected.id),null);
 f.db.db.exec('DROP TRIGGER receipt_abort');
 const accepted=await f.post(f.task.id,'complete',result);assert.equal(accepted.status,200);assert.equal(accepted.replayed,false);assert.ok(await f.saved(expected.id));
});

test('HTTP fail, handoff, and delegation save the wire-input receipt before any later dispatch',async t=>{
 const failed=await fixture(t),failure={...input(failed.owner),failure:{kind:'unknown'}},fail=await failed.post(failed.task.id,'fail',failure);assert.equal(fail.status,200,JSON.stringify(fail));assert.equal(fail.replayed,false);assert.ok(await failed.saved(fail.deliveryReceipt.id));
 const handoff=await fixture(t),handoffInput={...input(handoff.owner),handoff:{provider:'claude',instructions:'Finish',reason:'Independent check',acceptance:'Verify 4'}},hand=await handoff.post(handoff.task.id,'complete',handoffInput);assert.equal(hand.status,200,JSON.stringify(hand));assert.ok(await handoff.saved(hand.deliveryReceipt.id));assert.equal(handoff.external(),0);
 const allocation=await fixture(t),delegationInput={...input(allocation.owner),models:{models:[{model:'gpt-5.6-luna',efforts:['low'],isDefault:false}],observedAt:Date.now(),status:'fresh'},delegation:{independent:true,children:assignments}},allocated=await allocation.post(allocation.task.id,'complete',delegationInput);assert.equal(allocated.status,200,JSON.stringify(allocated));assert.equal(allocated.task.status,'waiting_children');assert.ok(await allocation.saved(allocated.deliveryReceipt.id));assert.equal(allocation.external(),0);
});

test('HTTP review retry, decision, and pass save receipts derived from original wire input',async t=>{
 const retried=await reviewFixture(t),report=reviewReport(retried.allocated.children);report[0].criteria[0].status='fail';const retryInput={...input(retried.review),reviewReport:report},retry=await retried.post(retried.task.id,'complete',retryInput);assert.equal(retry.status,200,JSON.stringify(retry));assert.ok(await retried.saved(retry.deliveryReceipt.id));assert.equal(retry.replayed,false);
 const decided=await reviewFixture(t),unverifiable={...input(decided.review),reviewReport:reviewReport(decided.allocated.children,'unverifiable')},decision=await decided.post(decided.task.id,'complete',unverifiable);assert.equal(decision.status,200,JSON.stringify(decision));assert.equal(decision.task.status,'waiting_user');assert.ok(await decided.saved(decision.deliveryReceipt.id));assert.equal(decision.deliveryReceipt.payloadDigest,(await decided.receipt(decided.task.id,'complete',unverifiable)).payloadDigest);
 const passed=await reviewFixture(t),passInput={...input(passed.review),reviewReport:reviewReport(passed.allocated.children)},pass=await passed.post(passed.task.id,'complete',passInput);assert.equal(pass.status,200,JSON.stringify(pass));assert.equal(pass.task.status,'completed');assert.ok(await passed.saved(pass.deliveryReceipt.id));
});

test('an older accepted receipt replays after a later execution generation completes',async t=>{
 const f=await fixture(t),firstInput=input(f.owner),first=await f.post(f.task.id,'complete',firstInput);assert.equal(first.status,200);
 const followUp=await f.store.applyAction(f.task.id,{action:'message',expectedVersion:first.task.version,content:'Check it again'});
 const secondOwner=await f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:followUp.version});
 const second=await f.post(f.task.id,'complete',{...input(secondOwner),content:'Still 4'});assert.equal(second.status,200);
 assert.notEqual(second.deliveryReceipt.id,first.deliveryReceipt.id);
 const before=await f.revision(),replay=await f.post(f.task.id,'complete',firstInput);
 assert.equal(replay.status,200);assert.equal(replay.replayed,true);assert.deepEqual(replay.deliveryReceipt,first.deliveryReceipt);assert.equal(await f.revision(),before);
});

test('corrupt stored receipt cannot be used as a replay acknowledgement',async t=>{
 const f=await fixture(t),result=input(f.owner),first=await f.post(f.task.id,'complete',result);assert.equal(first.status,200);
 await f.db.prepare('UPDATE metadata SET value=?1 WHERE key=?2').bind('{broken','desktop_receipt:'+first.deliveryReceipt.id).run();
 const before=await f.revision(),replay=await f.post(f.task.id,'complete',result);assert.notEqual(replay.status,200);assert.equal(await f.revision(),before);
});

test('losing task CAS writes no receipt and returns the conflict',async t=>{
 const f=await fixture(t),result=input(f.owner),descriptor=await f.receipt(f.task.id,'complete',result),original=f.db.batch.bind(f.db);
 let injected=false;
 f.db.batch=async statements=>{
  if(!injected&&statements.some(statement=>statement.values.some(value=>typeof value==='string'&&value.startsWith('desktop_receipt:')))){
   injected=true;
   const row=await f.db.prepare('SELECT body,version FROM tasks WHERE id=?1').bind(f.task.id).first();
   const body={...JSON.parse(row.body),version:row.version+1};body.checkpoint={...body.checkpoint,executionId:crypto.randomUUID()};
   await f.db.prepare('UPDATE tasks SET version=?1,body=?2 WHERE id=?3').bind(body.version,JSON.stringify(body),f.task.id).run();
  }
  return original(statements);
 };
 const response=await f.post(f.task.id,'complete',result);assert.equal(response.status,409,JSON.stringify(response));assert.equal(await f.saved(descriptor.id),null);
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');
});

test('accepted handoff returns a stored receipt after a later dispatch read fails',async t=>{
 const f=await fixture(t),result={...input(f.owner),handoff:{provider:'claude',instructions:'Finish',reason:'Independent check',acceptance:'Verify 4'}},originalBatch=f.db.batch.bind(f.db),originalPrepare=f.db.prepare.bind(f.db);
 let committed=false;
 f.db.batch=async statements=>{const rows=await originalBatch(statements);if(statements.some(statement=>statement.values.some(value=>typeof value==='string'&&value.startsWith('desktop_receipt:'))))committed=true;return rows;};
 f.db.prepare=sql=>{if(committed&&sql==='SELECT body FROM tasks WHERE id = ?1')throw Error('injected post-commit dispatch read failure');return originalPrepare(sql);};
 const reply=await f.post(f.task.id,'complete',result);f.db.prepare=originalPrepare;
 assert.equal(reply.status,200,JSON.stringify(reply));assert.equal(reply.replayed,true);assert.ok(await f.saved(reply.deliveryReceipt.id));
 assert.equal((await f.store.requireTask(f.task.id)).status,'queued');
});
