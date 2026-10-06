import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {D1EvaluationBudgets} from '../worker/evaluation-budgets.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {boundedLocalExecution} from '../public/core/local-execution.mjs';
import {settleBoundedExecution} from '../worker/evaluation-settlement.mjs';

// H6-2: a bounded Codex execution's local observation, including the process-tree proof,
// is stored with its completion; the reservation settles only from a verified proof.
const verifiedTree={outcome:'verified',recorded:2,survivors:[],checkedAt:'2026-10-06T00:00:00.000Z'};
const observation=(extra={})=>({started:true,rootProcessClosed:true,elapsedMs:40,deadlineExceeded:false,tree:verifiedTree,...extra});

test('the local execution validator keeps exact bounded fields and drops anything else',()=>{
 assert.deepEqual(boundedLocalExecution(observation()),observation());
 assert.deepEqual(boundedLocalExecution({started:true,rootProcessClosed:false,elapsedMs:null,deadlineExceeded:true}),{started:true,rootProcessClosed:false,elapsedMs:null,deadlineExceeded:true});
 for(const bad of [null,{},observation({extra:1}),observation({elapsedMs:-1}),observation({tree:{...verifiedTree,outcome:'maybe'}}),observation({tree:{...verifiedTree,survivors:Array(65).fill(1)}}),observation({tree:{...verifiedTree,reason:'x'.repeat(41)}})])
  assert.equal(boundedLocalExecution(bad),null);
});

test('the desktop bridge carries the bounded observation on completion and failure',async()=>{
 const claim={claim:{task:{id:'t'},executionId:'e',generation:1}};
 const harness=run=>{const sent=[];let saved=null;const bridge=createDesktopBridge({outbox:{read:()=>saved,write:v=>{saved=v;},clear:()=>{saved=null;}},runner:{run},request:async(route,input)=>{if(route.endsWith('poll'))return claim;sent.push({route,input});return {};}});return {bridge,sent};};
 const done=harness(async()=>({content:'ok',localExecution:observation()}));await done.bridge.tick();
 assert.deepEqual(done.sent[0].input.localExecution,observation());
 const failed=harness(async()=>{throw Object.assign(new Error('evaluation deadline exceeded'),{name:'TimeoutError',localExecution:observation({deadlineExceeded:true})});});await failed.bridge.tick();
 assert.equal(failed.sent[0].route,'/api/desktop/t/fail');assert.equal(failed.sent[0].input.localExecution.deadlineExceeded,true);
 const forged=harness(async()=>({content:'kept',localExecution:{...observation(),tree:{outcome:'trust me'}}}));await forged.bridge.tick();
 assert.equal(forged.sent[0].input.content,'kept');assert.equal(Object.hasOwn(forged.sent[0].input,'localExecution'),false);
});

async function bounded(t,{maxExecutions=1,totalDurationMs=100}={}){
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db,{now:()=>new Date(1000).toISOString()});
 const ledger=new D1EvaluationBudgets(db,{now:()=>1000});
 await ledger.create({jobId:'comparison-1',maxExecutions,totalDurationMs});
 const ready=await store.createTask({prompt:'comparison'});
 const attached=await store.attachEvaluationBudget(ready.id,{jobId:'comparison-1',phase:'candidate',maxDurationMs:100,expectedVersion:ready.version});
 const owned=await store.claimExecution(attached.id,{provider:'codex',expectedVersion:attached.version,executionBudgetVersion:1});
 return {db,store,ledger,owned,owner:{executionId:owned.executionId,generation:owned.generation}};
}

test('a verified completion stores the proof and settles the reservation from it',async t=>{
 const f=await bounded(t);
 const done=await f.store.finishExecution(f.owned.task.id,{...f.owner,content:'done',localExecution:observation()},{allowDesktopEvidence:true});
 assert.deepEqual(done.checkpoint.localExecution,observation());
 const settled=await settleBoundedExecution(f.store,done,{now:()=>1050});
 assert.equal(settled.reservations[0].status,'settled');assert.equal(settled.reservations[0].elapsedMs,40);assert.equal(settled.chargedDurationMs,40);
 // Settling again is a no-op.
 assert.equal((await settleBoundedExecution(f.store,done,{now:()=>1060})).reservations[0].status,'settled');
});

test('the scheduled sweep settles a stored verified proof that was not settled yet',async t=>{
 const {sweepBoundedSettlements}=await import('../worker/evaluation-settlement.mjs');
 const f=await bounded(t);
 await f.store.finishExecution(f.owned.task.id,{...f.owner,content:'done',localExecution:observation()},{allowDesktopEvidence:true});
 assert.equal((await f.ledger.read('comparison-1')).reservations[0].status,'reserved');
 assert.equal(await sweepBoundedSettlements(f.store,{now:()=>1050}),1);
 assert.equal((await f.ledger.read('comparison-1')).reservations[0].status,'settled');
 assert.equal(await sweepBoundedSettlements(f.store,{now:()=>1060}),0);
});

test('without a verified tree proof the reservation stays held and the proof is still stored',async t=>{
 for(const proof of [observation({tree:{outcome:'survivors',recorded:3,survivors:[44],checkedAt:'x'}}),observation({tree:undefined}),observation({rootProcessClosed:false})]){
  const f=await bounded(t);
  const done=await f.store.finishExecution(f.owned.task.id,{...f.owner,content:'done',localExecution:proof},{allowDesktopEvidence:true});
  assert.equal(await settleBoundedExecution(f.store,done,{now:()=>1050}),null);
  assert.equal((await f.ledger.read('comparison-1')).reservations[0].status,'reserved');
 }
});

test('a verified failure settles too and keeps an overrun visible',async t=>{
 const f=await bounded(t);
 const failed=await f.store.failExecution(f.owned.task.id,{...f.owner,failure:{kind:'timeout'},localExecution:observation({elapsedMs:120,deadlineExceeded:true})},{allowDesktopEvidence:true});
 assert.equal(failed.checkpoint.localExecution.elapsedMs,120);
 const settled=await settleBoundedExecution(f.store,failed,{now:()=>1200});
 assert.equal(settled.reservations[0].status,'settled');assert.equal(settled.overrun,true);
});

test('observations from untrusted callers are ignored',async t=>{
 const f=await bounded(t);
 const done=await f.store.finishExecution(f.owned.task.id,{...f.owner,content:'done',localExecution:observation()});
 assert.equal(done.checkpoint.localExecution,undefined);
 assert.equal(await settleBoundedExecution(f.store,done,{now:()=>1050}),null);
});

test('the desktop claim loop skips a queued bounded task instead of failing the poll',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db),bridge=new CloudBridge(store);
 await new D1EvaluationBudgets(db).create({jobId:'comparison-1',maxExecutions:1,totalDurationMs:100});
 const ready=await store.createTask({prompt:'bounded'});
 const attached=await store.attachEvaluationBudget(ready.id,{jobId:'comparison-1',phase:'candidate',maxDurationMs:100,expectedVersion:ready.version});
 await store.replaceTask(attached.id,attached.version,c=>({...c,status:'queued',version:c.version+1,checkpoint:{...c.checkpoint,provider:'codex',status:'queued'}}));
 const plain=await store.createTask({prompt:'ordinary'});
 await bridge.enqueue(plain.id,{provider:'codex',expectedVersion:plain.version});
 const claim=await bridge.claim();
 assert.equal(claim.task.id,plain.id);
 assert.equal(await bridge.claim(),null);
});

test('a new claim clears the previous proof and a paused task never settles from a proof',async t=>{
 const f=await bounded(t,{maxExecutions:2,totalDurationMs:200});
 const failed=await f.store.failExecution(f.owned.task.id,{...f.owner,failure:{kind:'timeout'},localExecution:observation()},{allowDesktopEvidence:true});
 await settleBoundedExecution(f.store,failed,{now:()=>1000});
 const again=await f.store.claimExecution(failed.id,{provider:'codex',expectedVersion:failed.version,executionBudgetVersion:1});
 assert.equal(again.task.checkpoint.localExecution,undefined);
 // Even a task that somehow keeps a proof while paused is not settled from it.
 const paused={...again.task,status:'paused',checkpoint:{...again.task.checkpoint,localExecution:observation()}};
 assert.equal(await settleBoundedExecution(f.store,paused,{now:()=>1100}),null);
});

test('the sweep reaches an older unsettled proof even when many newer ones are settled',async t=>{
 const {sweepBoundedSettlements}=await import('../worker/evaluation-settlement.mjs');
 const db=new TestD1();t.after(()=>db.close());
 let clock=1000;const store=new D1TaskStore(db,{now:()=>new Date(clock).toISOString()});
 const ledger=new D1EvaluationBudgets(db,{now:()=>clock});
 await ledger.create({jobId:'comparison-1',maxExecutions:12,totalDurationMs:1200});
 const finish=async()=>{clock+=1;const ready=await store.createTask({prompt:'c'});const a=await store.attachEvaluationBudget(ready.id,{jobId:'comparison-1',phase:'candidate',maxDurationMs:100,expectedVersion:ready.version});const o=await store.claimExecution(a.id,{provider:'codex',expectedVersion:a.version,executionBudgetVersion:1});clock+=1;return store.finishExecution(a.id,{executionId:o.executionId,generation:o.generation,content:'done',localExecution:observation()},{allowDesktopEvidence:true});};
 const oldest=await finish();
 for(let i=0;i<11;i++)await settleBoundedExecution(store,await finish(),{now:()=>clock});
 assert.equal(await sweepBoundedSettlements(store,{now:()=>clock,limit:10}),1);
 assert.equal((await ledger.read('comparison-1')).reservations.find(r=>r.executionId===oldest.checkpoint.executionId).status,'settled');
});

test('a verified proof must have no survivors and a real check time',()=>{
 assert.equal(boundedLocalExecution(observation({tree:{...verifiedTree,survivors:[5]}}))?.tree.outcome,'verified');
 return import('../public/core/local-execution.mjs').then(({verifiedLocalExecution})=>{
  assert.equal(verifiedLocalExecution(observation({tree:{...verifiedTree,survivors:[5]}})),null);
  assert.equal(verifiedLocalExecution(observation({tree:{...verifiedTree,checkedAt:'not a date'}})),null);
  assert.ok(verifiedLocalExecution(observation()));
 });
});
