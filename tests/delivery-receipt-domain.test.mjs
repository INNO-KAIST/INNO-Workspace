import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {Delegations} from '../worker/delegations.mjs';
import {createOrchestration} from '../worker/orchestration.mjs';

const assignments=['codex','claude'].map(provider=>({role:provider+' check',provider,requestedModel:provider==='codex'?'gpt-5.6-luna':'haiku',effort:'low',sufficientReason:'Independent check',acceptanceCriteria:['Result is 4'],instructions:'Calculate 2+2'}));
async function fixture(t){const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),workspaceId=await workspaceIdentity(db),task=await store.createTask({prompt:'Check 2+2'}),owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});const bridge=new CloudBridge(store),delegations=new Delegations(store),orchestration=createOrchestration({store,delegations,hasRoutine:false,fire:async()=>{throw Error('AI must not fire');}});const descriptor=(action,input,taskId=task.id)=>createDeliveryReceipt({workspaceId,taskId,action,input});const saved=async id=>(await db.prepare('SELECT value FROM metadata WHERE key=?1').bind('desktop_receipt:'+id).first())?.value??null;const receiptCount=async()=>Number((await db.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key GLOB 'desktop_receipt:*'").first()).n);return {db,store,workspaceId,task,owner,bridge,delegations,orchestration,descriptor,saved,receiptCount};}
const resultInput=owner=>({executionId:owner.executionId,generation:owner.generation,content:'4'});
const allocationInput=owner=>({...owner,independent:true,children:assignments});
const report=(children,status='pass')=>children.map(child=>({childTaskId:child.id,criteria:child.assignment.acceptanceCriteria.map(criterion=>({criterion,status,evidence:'Checked arithmetic'}))}));
async function reviewFixture(t){const f=await fixture(t),allocated=await f.delegations.allocate(f.task.id,allocationInput(f.owner));for(const child of allocated.children){const claimed=await f.store.claimExecution(child.id,{provider:child.assignment.provider,expectedVersion:child.version});await f.store.finishExecution(child.id,{...claimed,content:'4'});}const ready=await f.delegations.reconcile(f.task.id),review=await f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:ready.parent.version});return {...f,allocated,review};}

test('bridge complete and fail opt in to atomic receipts; legacy replay remains while opted replay waits for lookup',async t=>{
 const complete=await fixture(t),input=resultInput(complete.owner),receipt=await complete.descriptor('complete',input);
 await complete.bridge.complete(complete.task.id,input,{deliveryReceipt:receipt});
 assert.ok(await complete.saved(receipt.id));assert.equal(await complete.receiptCount(),1);
 await assert.rejects(()=>complete.bridge.complete(complete.task.id,input,{deliveryReceipt:receipt}),e=>e?.statusCode===409);
 assert.equal((await complete.bridge.complete(complete.task.id,input)).status,'completed');
 const failed=await fixture(t),failure={...failed.owner,failure:{kind:'quota'}},failedReceipt=await failed.descriptor('fail',failure);
 await failed.bridge.fail(failed.task.id,failure,{deliveryReceipt:failedReceipt});
 assert.ok(await failed.saved(failedReceipt.id));
 await assert.rejects(()=>failed.bridge.fail(failed.task.id,failure,{deliveryReceipt:failedReceipt}),e=>e?.statusCode===409);
 assert.equal((await failed.bridge.fail(failed.task.id,failure)).status,'waiting_quota');
});

test('handoff records the accepted Codex owner without treating its legacy replay as a new receipt',async t=>{
 const f=await fixture(t),input={...f.owner,content:'Verified progress',handoff:{provider:'claude',instructions:'Finish',reason:'Independent review',acceptance:'Check 4'}},receipt=await f.descriptor('complete',input);
 const task=await f.store.handoffExecution(f.task.id,input,{deliveryReceipt:receipt});
 assert.equal(task.status,'queued');assert.equal(task.checkpoint.provider,'claude');assert.ok(await f.saved(receipt.id));
 await assert.rejects(()=>f.store.handoffExecution(f.task.id,input,{deliveryReceipt:receipt}),e=>e?.statusCode===409);
 assert.equal((await f.store.handoffExecution(f.task.id,input)).version,task.version);
});

test('orchestration allocation stores only the parent receipt and gates opt-in replay before dispatch',async t=>{
 const f=await fixture(t),input=allocationInput(f.owner),receipt=await f.descriptor('complete',input);
 const first=await f.orchestration.allocate(f.task.id,input,{deliveryReceipt:receipt});
 assert.equal(first.parent.status,'waiting_children');assert.ok(await f.saved(receipt.id));assert.equal(await f.receiptCount(),1);
 await assert.rejects(()=>f.orchestration.allocate(f.task.id,input,{deliveryReceipt:receipt}),e=>e?.statusCode===409);
 assert.equal((await f.orchestration.allocate(f.task.id,input)).replayed,true);
});

test('review pass and waiting-user decision each persist a receipt on the accepted parent only',async t=>{
 const passed=await reviewFixture(t),passInput={...passed.review,content:'Final 4',reviewReport:report(passed.allocated.children)},passReceipt=await passed.descriptor('complete',passInput);
 await passed.store.finishExecution(passed.task.id,passInput,{deliveryReceipt:passReceipt});
 assert.ok(await passed.saved(passReceipt.id));assert.equal(await passed.receiptCount(),1);
 const decision=await reviewFixture(t),decisionInput={...decision.review,prompt:'Which evidence?',options:[{label:'A',pros:'Fast',cons:'Less detail'},{label:'B',pros:'Detail',cons:'Slow'}],reviewReport:report(decision.allocated.children,'unverifiable')},decisionReceipt=await decision.descriptor('complete',decisionInput);
 await decision.store.requestDecision(decision.task.id,decisionInput,{deliveryReceipt:decisionReceipt});
 assert.equal((await decision.store.requireTask(decision.task.id)).status,'waiting_user');assert.ok(await decision.saved(decisionReceipt.id));
});

test('review retry persists one parent receipt and never passes it into sibling dispatch or replay',async t=>{
 const f=await reviewFixture(t),failedReport=report(f.allocated.children);failedReport[0].criteria[0].status='fail';
 const input={...f.review,reviewReport:failedReport},receipt=await f.descriptor('complete',input);
 const retried=await f.orchestration.retryReview(f.task.id,input,{deliveryReceipt:receipt});
 assert.equal(retried.parent.status,'waiting_children');assert.ok(await f.saved(receipt.id));assert.equal(await f.receiptCount(),1);
 await assert.rejects(()=>f.orchestration.retryReview(f.task.id,input,{deliveryReceipt:receipt}),e=>e?.statusCode===409);
 assert.equal((await f.orchestration.retryReview(f.task.id,input)).replayed,true);
});

test('null receipt is never silently accepted by a domain method',async t=>{
 const f=await fixture(t),input=resultInput(f.owner);
 await assert.rejects(()=>f.bridge.complete(f.task.id,input,{deliveryReceipt:null}),e=>e?.statusCode===400);
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');assert.equal(await f.receiptCount(),0);
 await f.bridge.complete(f.task.id,input);
 await assert.rejects(()=>f.bridge.complete(f.task.id,input,{deliveryReceipt:null}),e=>e?.statusCode===400);
});

test('accepted Codex child completion and ordinary failure each create one matching receipt',async t=>{
 const f=await fixture(t),allocated=await f.delegations.allocate(f.task.id,allocationInput(f.owner));
 const codex=allocated.children.find(child=>child.assignment.provider==='codex');
 const claimed=await f.store.claimExecution(codex.id,{provider:'codex',expectedVersion:codex.version});
 const input=resultInput(claimed),receipt=await f.descriptor('complete',input,codex.id);
 await f.bridge.complete(codex.id,input,{deliveryReceipt:receipt});
 assert.ok(await f.saved(receipt.id));assert.equal(await f.receiptCount(),1);
 const failed=await fixture(t),failure={...failed.owner,failure:{kind:'unknown'}},failureReceipt=await failed.descriptor('fail',failure);
 await failed.bridge.fail(failed.task.id,failure,{deliveryReceipt:failureReceipt});
 assert.equal((await failed.store.requireTask(failed.task.id)).status,'failed');assert.ok(await failed.saved(failureReceipt.id));
});
