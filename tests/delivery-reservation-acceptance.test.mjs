import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {D1EvaluationBudgets} from '../worker/evaluation-budgets.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {Delegations} from '../worker/delegations.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';

const assignments=['codex','claude'].map(provider=>({role:provider+' check',provider,requestedModel:provider==='codex'?'gpt-5.6-luna':'haiku',effort:'low',sufficientReason:'Independent check',acceptanceCriteria:['Result is 4'],instructions:'Calculate 2+2'}));
const result=owner=>({executionId:owner.executionId,generation:owner.generation,content:'4'});
const report=(children,status='pass')=>children.map(child=>({childTaskId:child.id,criteria:child.assignment.acceptanceCriteria.map(criterion=>({criterion,status,evidence:'Checked 4'}))}));

async function fixture(t){
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),workspaceId=await workspaceIdentity(db);
 const task=await store.createTask({prompt:'Check 2+2'}),owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version},{deliveryReceiptVersion:1,workspaceId});
 const reservations=async()=>((await db.prepare("SELECT key,value FROM metadata WHERE key GLOB 'desktop_reservation:*'").all()).results);
 const receipts=async()=>((await db.prepare("SELECT key,value FROM metadata WHERE key GLOB 'desktop_receipt:*'").all()).results);
 const revision=async()=>Number((await db.prepare("SELECT value FROM metadata WHERE key='revision'").first()).value);
 const descriptor=(action,input,id=task.id)=>createDeliveryReceipt({workspaceId,taskId:id,action,input});
 return {db,store,workspaceId,task,owner,bridge:new CloudBridge(store),delegations:new Delegations(store),reservations,receipts,revision,descriptor};
}
async function reviewFixture(t){
 const f=await fixture(t),allocation={...f.owner,independent:true,children:assignments};
 await f.delegations.allocate(f.task.id,allocation,{deliveryReceipt:await f.descriptor('complete',allocation)});
 const parent=await f.store.requireTask(f.task.id);
 for(const child of parent.delegation.children){const row=await f.store.requireTask(child.taskId),claimed=await f.store.claimExecution(row.id,{provider:row.assignment.provider,expectedVersion:row.version});await f.store.finishExecution(row.id,result(claimed));}
 const ready=await f.delegations.reconcile(f.task.id),review=await f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:ready.parent.version},{deliveryReceiptVersion:1,workspaceId:f.workspaceId});
 return {...f,review,parent:ready.parent};
}

test('opted complete, fail, and handoff convert exactly one reservation into one receipt',async t=>{
 const completed=await fixture(t),content=result(completed.owner),descriptor=await completed.descriptor('complete',content),before=await completed.revision();
 await completed.bridge.complete(completed.task.id,content,{deliveryReceipt:descriptor});
 assert.equal((await completed.reservations()).length,0);assert.equal((await completed.receipts()).length,1);assert.equal(await completed.revision(),before+1);
 const failed=await fixture(t),failure={...failed.owner,failure:{kind:'quota'}},failReceipt=await failed.descriptor('fail',failure);
 await failed.bridge.fail(failed.task.id,failure,{deliveryReceipt:failReceipt});
 assert.equal((await failed.reservations()).length,0);assert.equal((await failed.receipts()).length,1);
 const handoff=await fixture(t),input={...result(handoff.owner),handoff:{provider:'claude',instructions:'Finish',reason:'Independent check',acceptance:'Verify 4'}};
 await handoff.store.handoffExecution(handoff.task.id,input,{deliveryReceipt:await handoff.descriptor('complete',input)});
 assert.equal((await handoff.reservations()).length,0);assert.equal((await handoff.receipts()).length,1);
});

test('opted delegation and review retry, decision, pass consume their own reservations',async t=>{
 const allocated=await fixture(t),allocation={...allocated.owner,independent:true,children:assignments};
 await allocated.delegations.allocate(allocated.task.id,allocation,{deliveryReceipt:await allocated.descriptor('complete',allocation)});
 assert.equal((await allocated.reservations()).length,0);assert.equal((await allocated.receipts()).length,1);
 const retried=await reviewFixture(t),failed=report(retried.parent.delegation.children.map(x=>({id:x.taskId,assignment:x})));failed[0].criteria[0].status='fail';
 const retryInput={...retried.review,reviewReport:failed};
 await retried.delegations.retryReview(retried.task.id,retryInput,{deliveryReceipt:await retried.descriptor('complete',retryInput)});
 assert.equal((await retried.reservations()).length,0);assert.equal((await retried.receipts()).length,2);
 const decided=await reviewFixture(t),decision={...decided.review,prompt:'Which evidence?',options:[{label:'A',pros:'Fast',cons:'Less detail'},{label:'B',pros:'Detail',cons:'Slow'}],reviewReport:report(decided.parent.delegation.children.map(x=>({id:x.taskId,assignment:x})),'unverifiable')};
 await decided.store.requestDecision(decided.task.id,decision,{deliveryReceipt:await decided.descriptor('complete',decision)});
 assert.equal((await decided.reservations()).length,0);assert.equal((await decided.receipts()).length,2);
 const passed=await reviewFixture(t),pass={...result(passed.review),reviewReport:report(passed.parent.delegation.children.map(x=>({id:x.taskId,assignment:x})))};
 await passed.store.finishExecution(passed.task.id,pass,{deliveryReceipt:await passed.descriptor('complete',pass)});
 assert.equal((await passed.reservations()).length,0);assert.equal((await passed.receipts()).length,2);
});

test('missing, malformed, or owner-mismatched reservation rejects without accepted writes',async t=>{
 for(const change of ['missing','malformed','owner','claimedAt']){
  const f=await fixture(t),row=(await f.reservations())[0],before=await f.revision();
  if(change==='missing')await f.db.prepare('DELETE FROM metadata WHERE key=?1').bind(row.key).run();
  if(change==='malformed')await f.db.prepare('UPDATE metadata SET value=?1 WHERE key=?2').bind('{broken',row.key).run();
  if(change==='owner')await f.db.prepare('UPDATE metadata SET value=?1 WHERE key=?2').bind(JSON.stringify({...JSON.parse(row.value),executionId:crypto.randomUUID()}),row.key).run();
  if(change==='claimedAt')await f.db.prepare('UPDATE metadata SET value=?1 WHERE key=?2').bind(JSON.stringify({...JSON.parse(row.value),claimedAt:'2020-01-01T00:00:00.000Z'}),row.key).run();
  const input=result(f.owner),receipt=await f.descriptor('complete',input);
  await assert.rejects(()=>f.bridge.complete(f.task.id,input,{deliveryReceipt:receipt}));
  assert.equal((await f.store.requireTask(f.task.id)).status,'running');assert.equal((await f.receipts()).length,0);assert.equal(await f.revision(),before);
 }
});

test('a zero-write child or losing parent CAS restores the versioned reservation',async t=>{
 const child=await fixture(t),allocation={...child.owner,independent:true,children:assignments},childReceipt=await child.descriptor('complete',allocation),row=(await child.reservations())[0],before=await child.revision();
 child.db.db.exec("CREATE TRIGGER child_ignore BEFORE INSERT ON tasks WHEN json_extract(NEW.body,'$.parentTaskId') IS NOT NULL BEGIN SELECT RAISE(IGNORE); END");
 await assert.rejects(()=>child.delegations.allocate(child.task.id,allocation,{deliveryReceipt:childReceipt}));
 assert.equal((await child.store.requireTask(child.task.id)).status,'running');assert.deepEqual((await child.reservations())[0],row);assert.equal((await child.receipts()).length,0);assert.equal(await child.revision(),before);
 const parent=await fixture(t),input=result(parent.owner),receipt=await parent.descriptor('complete',input),original=parent.db.batch.bind(parent.db),held=(await parent.reservations())[0];let injected=false;
 parent.db.batch=async statements=>{if(!injected&&statements.some(s=>s.values.some(v=>typeof v==='string'&&v.startsWith('desktop_receipt:')))){injected=true;const current=await parent.store.requireTask(parent.task.id),next={...current,version:current.version+1,checkpoint:{...current.checkpoint,executionId:crypto.randomUUID()}};await parent.db.prepare('UPDATE tasks SET version=?1,body=?2 WHERE id=?3').bind(next.version,JSON.stringify(next),next.id).run();}return original(statements);};
 await assert.rejects(()=>parent.bridge.complete(parent.task.id,input,{deliveryReceipt:receipt}),error=>error.statusCode===409);
 assert.deepEqual((await parent.reservations())[0],held);assert.equal((await parent.receipts()).length,0);
});

test('reservation value changed after preflight makes DELETE zero and rolls result back',async t=>{
 const f=await fixture(t),input=result(f.owner),row=(await f.reservations())[0],before=await f.revision(),original=f.db.batch.bind(f.db);let changed=false;
 f.db.batch=async statements=>{if(!changed&&statements.some(s=>s.values.some(v=>typeof v==='string'&&v.startsWith('desktop_receipt:')))){changed=true;await f.db.prepare('UPDATE metadata SET value=?1 WHERE key=?2').bind(JSON.stringify({...JSON.parse(row.value),claimedAt:'2020-01-01T00:00:00.000Z'}),row.key).run();}return original(statements);};
 const receipt=await f.descriptor('complete',input);
 await assert.rejects(()=>f.bridge.complete(f.task.id,input,{deliveryReceipt:receipt}));
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');assert.equal((await f.receipts()).length,0);assert.equal(await f.revision(),before);
});

test('receipt insert error restores task, revision, and the consumed reservation',async t=>{
 const f=await fixture(t),input=result(f.owner),before=await f.revision(),reservation=(await f.reservations())[0];
 f.db.db.exec("CREATE TRIGGER receipt_abort BEFORE INSERT ON metadata WHEN NEW.key GLOB 'desktop_receipt:*' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");
 const receipt=await f.descriptor('complete',input);
 await assert.rejects(()=>f.bridge.complete(f.task.id,input,{deliveryReceipt:receipt}),/receipt failure/);
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');assert.deepEqual((await f.reservations())[0],reservation);assert.equal((await f.receipts()).length,0);assert.equal(await f.revision(),before);
});

test('opted result cannot be accepted without receipt while renew and cancel preserve reservation',async t=>{
 const f=await fixture(t),before=await f.revision(),input=result(f.owner);
 await assert.rejects(()=>f.bridge.complete(f.task.id,input));await assert.rejects(()=>f.bridge.fail(f.task.id,{...f.owner,failure:{kind:'unknown'}}));
 await assert.rejects(()=>f.store.handoffExecution(f.task.id,{...input,handoff:{provider:'claude',instructions:'Finish',reason:'Check',acceptance:'Verify'}}));
 await assert.rejects(()=>f.delegations.allocate(f.task.id,{...f.owner,independent:true,children:assignments}));
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');assert.equal(await f.revision(),before);assert.equal((await f.reservations()).length,1);
 await f.bridge.renew(f.task.id,f.owner);assert.equal((await f.reservations()).length,1);
 const current=await f.store.requireTask(f.task.id);await f.store.applyAction(f.task.id,{action:'cancel',expectedVersion:current.version});assert.equal((await f.reservations()).length,1);
});

test('at full shared capacity, result acceptance swaps reservation for receipt without growth',async t=>{
 const f=await fixture(t);
 for(let index=0;index<1023;index++)await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind('desktop_receipt:held-'+index,'held').run();
 const input=result(f.owner);await f.bridge.complete(f.task.id,input,{deliveryReceipt:await f.descriptor('complete',input)});
 assert.equal((await f.reservations()).length,0);assert.equal((await f.receipts()).length,1024);
});

test('lease expiry preserves reservation and accepted allocation still reconciles completed children',async t=>{
 const expiring=await fixture(t),held=(await expiring.reservations())[0];
 expiring.store.now=()=>new Date(Date.parse(expiring.owner.task.checkpoint.expiresAt)+1000).toISOString();
 await expiring.bridge.claim();assert.equal((await expiring.store.requireTask(expiring.task.id)).status,'paused');assert.deepEqual((await expiring.reservations())[0],held);
 const f=await fixture(t),allocation={...f.owner,independent:true,children:assignments};
 const allocated=await f.delegations.allocate(f.task.id,allocation,{deliveryReceipt:await f.descriptor('complete',allocation)});
 for(const child of allocated.children){const owner=await f.store.claimExecution(child.id,{provider:child.assignment.provider,expectedVersion:child.version});await f.store.finishExecution(child.id,result(owner));}
 const ready=await f.delegations.reconcile(f.task.id);
 assert.equal(ready.parent.status,'queued_for_review');assert.equal((await f.reservations()).length,0);assert.equal((await f.receipts()).length,1);
});

test('a budgeted opted claim can accept a receipt while an ordinary legacy claim remains compatible',async t=>{
 const f=await fixture(t),legacy=await f.store.createTask({prompt:'Legacy request'}),legacyOwner=await f.store.claimExecution(legacy.id,{provider:'codex',expectedVersion:legacy.version});
 await f.store.finishExecution(legacy.id,result(legacyOwner));
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),workspaceId=await workspaceIdentity(db),ledger=new D1EvaluationBudgets(db,{now:()=>Date.now()});
 await ledger.create({jobId:'receipt-budget',maxExecutions:1,totalDurationMs:100});
 const task=await store.createTask({prompt:'Budget request'}),bound=await store.attachEvaluationBudget(task.id,{jobId:'receipt-budget',phase:'candidate',maxDurationMs:100,expectedVersion:task.version});
 const owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:bound.version,executionBudgetVersion:1},{deliveryReceiptVersion:1,workspaceId});
 const input=result(owner),receipt=await createDeliveryReceipt({workspaceId,taskId:task.id,action:'complete',input});
 await store.finishExecution(task.id,input,{deliveryReceipt:receipt});
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key GLOB 'desktop_reservation:*'").first()).n,0);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key GLOB 'desktop_receipt:*'").first()).n,1);
});
