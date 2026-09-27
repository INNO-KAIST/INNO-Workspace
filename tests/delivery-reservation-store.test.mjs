import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {D1EvaluationBudgets} from '../worker/evaluation-budgets.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';

async function fixture(t){
 const db=new TestD1();t.after(()=>db.close());
 const clock={value:1000},store=new D1TaskStore(db,{now:()=>new Date(clock.value).toISOString()}),workspaceId=await workspaceIdentity(db);
 const task=await store.createTask({prompt:'Check one result'});
 const rows=async()=>((await db.prepare("SELECT key,value FROM metadata WHERE key GLOB 'desktop_reservation:*' ORDER BY key").all()).results);
 const revision=async()=>Number((await db.prepare("SELECT value FROM metadata WHERE key='revision'").first()).value);
 const claim=(current,options={deliveryReceiptVersion:1,workspaceId},extra={})=>store.claimExecution(current.id,{provider:'codex',expectedVersion:current.version,leaseMs:1000,...extra},options);
 return {db,store,clock,workspaceId,task,rows,revision,claim};
}
const filled=async(db,prefix,count)=>{for(let index=0;index<count;index++)await db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(prefix+index,'held').run();};
function raceTwoBatches(db){
 const original=db.batch.bind(db);let arrived=0,release;
 const both=new Promise(resolve=>{release=resolve;});let previous=Promise.resolve();
 db.batch=async statements=>{
  if(++arrived===2)release();
  await both;
  const operation=previous.then(()=>original(statements));
  previous=operation.catch(()=>{});
  return operation;
 };
}

test('opted Codex claim atomically saves one owner reservation and one revision',async t=>{
 const f=await fixture(t),before=await f.revision(),held=await f.claim(f.task),rows=await f.rows();
 assert.equal(rows.length,1);assert.equal(held.task.checkpoint.deliveryReceiptVersion,1);
 assert.deepEqual(JSON.parse(rows[0].value),{version:1,workspaceId:f.workspaceId,taskId:f.task.id,executionId:held.executionId,generation:held.generation,claimedAt:held.task.checkpoint.claimedAt});
 assert.equal(await f.revision(),before+1);
});

test('the final shared slot admits one claim, then receipt plus reservation capacity blocks another',async t=>{
 const f=await fixture(t);await filled(f.db,'desktop_receipt:held-',1023);
 const first=await f.claim(f.task);assert.equal(first.task.status,'running');assert.equal((await f.rows()).length,1);
 const second=await f.store.createTask({prompt:'Second request'}),before=await f.revision();
 await assert.rejects(()=>f.claim(second),/capacity/i);
 assert.equal((await f.store.requireTask(second.id)).status,'ready');assert.equal((await f.rows()).length,1);assert.equal(await f.revision(),before);
});

test('two simultaneous claims for the last slot yield one owner and a capacity-coded loser',async t=>{
 const f=await fixture(t),second=await f.store.createTask({prompt:'Other request'});await filled(f.db,'desktop_receipt:held-',1023);
 const before=await f.revision();raceTwoBatches(f.db);
 const results=await Promise.allSettled([f.claim(f.task),f.claim(second)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.code==='DESKTOP_DELIVERY_CAPACITY').length,1);
 assert.deepEqual([(await f.store.requireTask(f.task.id)).status,(await f.store.requireTask(second.id)).status].sort(),['ready','running']);
 assert.equal((await f.rows()).length,1);assert.equal(await f.revision(),before+1);
});

test('two simultaneous claims for one task yield one owner and one CAS loser',async t=>{
 const f=await fixture(t),before=await f.revision();raceTwoBatches(f.db);
 const results=await Promise.allSettled([f.claim(f.task),f.claim(f.task)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.statusCode===409).length,1);
 const owner=results.find(result=>result.status==='fulfilled').value,rows=await f.rows();
 assert.equal(rows.length,1);assert.equal(JSON.parse(rows[0].value).executionId,owner.executionId);
 assert.equal((await f.store.requireTask(f.task.id)).checkpoint.executionId,owner.executionId);
 assert.equal(await f.revision(),before+1);
});

test('an intervening capacity fill defeats the task UPDATE guard without partial writes',async t=>{
 const f=await fixture(t);await filled(f.db,'desktop_receipt:held-',1023);
 const original=f.db.batch.bind(f.db),before=await f.revision();let injected=false;
 f.db.batch=async statements=>{if(!injected&&statements.some(s=>s.values.some(v=>typeof v==='string'&&v.startsWith('desktop_reservation:')))){injected=true;await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind('desktop_receipt:last-slot','held').run();}return original(statements);};
 await assert.rejects(()=>f.claim(f.task),/capacity/i);
 assert.equal((await f.store.requireTask(f.task.id)).status,'ready');assert.equal((await f.rows()).length,0);assert.equal(await f.revision(),before);
});

test('reservation insertion failure rolls owner and revision back',async t=>{
 const f=await fixture(t),before=await f.revision();
 f.db.db.exec("CREATE TRIGGER reservation_abort BEFORE INSERT ON metadata WHEN NEW.key GLOB 'desktop_reservation:*' BEGIN SELECT RAISE(ABORT,'injected reservation failure'); END");
 await assert.rejects(()=>f.claim(f.task),/reservation failure/);
 assert.equal((await f.store.requireTask(f.task.id)).status,'ready');assert.equal(await f.revision(),before);assert.equal((await f.rows()).length,0);
});

test('a silent zero-write reservation insert rolls the whole claim back',async t=>{
 const f=await fixture(t),before=await f.revision();
 f.db.db.exec("CREATE TRIGGER reservation_ignore BEFORE INSERT ON metadata WHEN NEW.key GLOB 'desktop_reservation:*' BEGIN SELECT RAISE(IGNORE); END");
 await assert.rejects(()=>f.claim(f.task));
 assert.equal((await f.store.requireTask(f.task.id)).status,'ready');assert.equal(await f.revision(),before);assert.equal((await f.rows()).length,0);
});

test('invalid or changing workspace metadata fails closed before admitting a claim',async t=>{
 const f=await fixture(t),before=await f.revision();
 await assert.rejects(()=>f.claim(f.task,{deliveryReceiptVersion:1,workspaceId:crypto.randomUUID()}),/workspace/i);
 await f.db.prepare("UPDATE metadata SET value='broken' WHERE key='desktop_workspace_id'").run();
 await assert.rejects(()=>f.claim(f.task),/workspace/i);
 assert.equal((await f.store.requireTask(f.task.id)).status,'ready');assert.equal((await f.rows()).length,0);assert.equal(await f.revision(),before);
});

test('workspace replacement after preflight fails the in-batch owner guard',async t=>{
 const f=await fixture(t),before=await f.revision(),original=f.db.batch.bind(f.db);let injected=false;
 f.db.batch=async statements=>{
  if(!injected&&statements.some(s=>s.values.some(v=>typeof v==='string'&&v.startsWith('desktop_reservation:')))){
   injected=true;await f.db.prepare("UPDATE metadata SET value=?1 WHERE key='desktop_workspace_id'").bind(crypto.randomUUID()).run();
  }
  return original(statements);
 };
 await assert.rejects(()=>f.claim(f.task),/workspace/i);
 assert.equal((await f.store.requireTask(f.task.id)).status,'ready');assert.equal((await f.rows()).length,0);assert.equal(await f.revision(),before);
});

test('later generations retain old reservations and a legacy claim clears inherited receipt version',async t=>{
 const f=await fixture(t),first=await f.claim(f.task);f.clock.value=3000;
 const second=await f.claim(first.task);assert.equal(second.generation,first.generation+1);assert.equal((await f.rows()).length,2);
 f.clock.value=5000;const legacy=await f.claim(second.task,{});assert.equal(legacy.task.checkpoint.deliveryReceiptVersion,undefined);assert.equal((await f.rows()).length,2);
});

test('evaluation budget and desktop reservation commit or roll back together',async t=>{
 const f=await fixture(t),ledger=new D1EvaluationBudgets(f.db,{now:()=>f.clock.value});
 await ledger.create({jobId:'reservation-budget',maxExecutions:1,totalDurationMs:100});
 const bound=await f.store.attachEvaluationBudget(f.task.id,{jobId:'reservation-budget',phase:'candidate',maxDurationMs:100,expectedVersion:f.task.version});
 const before=await f.revision(),claimed=await f.claim(bound,undefined,{executionBudgetVersion:1});
 assert.equal(claimed.task.checkpoint.deliveryReceiptVersion,1);assert.equal((await f.rows()).length,1);assert.equal((await ledger.read('reservation-budget')).usedExecutions,1);assert.equal(await f.revision(),before+1);
 const second=await fixture(t),otherLedger=new D1EvaluationBudgets(second.db,{now:()=>second.clock.value});
 await otherLedger.create({jobId:'rollback-budget',maxExecutions:1,totalDurationMs:100});
 const other=await second.store.attachEvaluationBudget(second.task.id,{jobId:'rollback-budget',phase:'candidate',maxDurationMs:100,expectedVersion:second.task.version});
 second.db.db.exec("CREATE TRIGGER reservation_abort BEFORE INSERT ON metadata WHEN NEW.key GLOB 'desktop_reservation:*' BEGIN SELECT RAISE(ABORT,'injected reservation failure'); END");
 const rollbackRevision=await second.revision();await assert.rejects(()=>second.claim(other,undefined,{executionBudgetVersion:1}),/reservation failure/);
 assert.equal((await second.store.requireTask(other.id)).status,'ready');assert.equal((await otherLedger.read('rollback-budget')).usedExecutions,0);assert.equal((await second.rows()).length,0);assert.equal(await second.revision(),rollbackRevision);
});

test('client-shaped claim input cannot request a reservation and bridge start waits at capacity',async t=>{
 const f=await fixture(t);await assert.rejects(()=>f.claim(f.task,{}, {reservation:{workspaceId:f.workspaceId}}),/unsupported|reservation/i);
 await filled(f.db,'desktop_receipt:held-',1024);
 const bridge=new CloudBridge(f.store),before=await f.revision();
 await assert.rejects(()=>bridge.start(f.task.id,{expectedVersion:f.task.version,sourceNames:[]},{deliveryReceiptVersion:1,workspaceId:f.workspaceId}),error=>error.code==='DESKTOP_DELIVERY_CAPACITY');
 assert.equal((await f.store.requireTask(f.task.id)).status,'ready');assert.equal(await f.revision(),before);
 await bridge.enqueue(f.task.id,{expectedVersion:f.task.version,materials:[]});
 await assert.rejects(()=>bridge.claim({deliveryReceiptVersion:1,workspaceId:f.workspaceId}),error=>error.code==='DESKTOP_DELIVERY_CAPACITY');
 assert.equal((await f.store.requireTask(f.task.id)).status,'queued');
});
