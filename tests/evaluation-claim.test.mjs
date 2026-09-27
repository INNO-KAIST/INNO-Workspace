import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {SqliteTaskStore} from '../server/store.mjs';
import {D1EvaluationBudgets} from '../worker/evaluation-budgets.mjs';
import {SqliteEvaluationBudgets} from '../server/evaluation-budgets.mjs';
import {parseBundle} from '../public/core/client.mjs';
import {prepareImport} from '../public/core/imports.mjs';
import {validateAssignments} from '../public/core/delegation.mjs';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';

const bind={jobId:'comparison-1',phase:'candidate',maxDurationMs:100};
for(const backend of ['d1','sqlite']){
  function fixture(t,{maxExecutions=1,totalDurationMs=100,clock=1000}={}){
    const db=backend==='d1'?new TestD1():null;
    const store=db?new D1TaskStore(db,{now:()=>new Date(clock).toISOString()}):new SqliteTaskStore(':memory:',{now:()=>new Date(clock).toISOString()});
    const ledger=db?new D1EvaluationBudgets(db,{now:()=>clock}):new SqliteEvaluationBudgets(store.db,{now:()=>clock});
    t.after(()=>db?db.close():store.close());
    return {db,store,ledger,limits:{jobId:bind.jobId,maxExecutions,totalDurationMs}};
  }
  const task=async(store,prompt='comparison')=>await store.createTask({prompt});
  const claim=async(store,t,extra={})=>await store.claimExecution(t.id,{provider:'codex',expectedVersion:t.version,executionBudgetVersion:1,...extra});

  test(`${backend}: bound claim commits one owner, reservation, and revision`,async t=>{
    const f=fixture(t);await f.ledger.create(f.limits);
    const ready=await task(f.store);
    const bound=await f.store.attachEvaluationBudget(ready.id,{...bind,expectedVersion:ready.version});
    assert.deepEqual(bound.evaluationBudget,{...bind,provider:'codex'});
    const before=(await f.store.getState()).revision;
    const owned=await claim(f.store,bound);
    const held=await f.ledger.read(bind.jobId);
    assert.equal((await f.store.getState()).revision,before+1);
    assert.equal(held.reservations.length,1);
    assert.equal(held.reservations[0].executionId,owned.executionId);
    assert.equal(held.reservations[0].generation,owned.generation);
    assert.deepEqual(owned.task.checkpoint.evaluationBudget,{jobId:bind.jobId,phase:bind.phase,maxDurationMs:100,deadlineAtMs:1100});
    await assert.rejects(()=>claim(f.store,bound),/version|conflict/i);
    assert.equal((await f.ledger.read(bind.jobId)).usedExecutions,1);
  });

  test(`${backend}: defaults, capability, provider, and client grants hold before ownership`,async t=>{
    const f=fixture(t,{maxExecutions:0,totalDurationMs:0});await f.ledger.create(f.limits);
    const ready=await task(f.store);
    await assert.rejects(async()=>f.store.attachEvaluationBudget(ready.id,{...bind,expectedVersion:1}),/binding|ledger/i);
    assert.equal((await f.store.requireTask(ready.id)).status,'ready');
    await f.ledger.create({jobId:'comparison-2',maxExecutions:1,totalDurationMs:100});
    const bound=await f.store.attachEvaluationBudget(ready.id,{...bind,jobId:'comparison-2',expectedVersion:1});
    for(const input of [{provider:'codex',expectedVersion:bound.version},{provider:'claude',expectedVersion:bound.version,executionBudgetVersion:1},{provider:'codex',expectedVersion:bound.version,executionBudgetVersion:2},{provider:'codex',expectedVersion:bound.version,executionBudgetVersion:1,maxDurationMs:1},{provider:'codex',expectedVersion:bound.version,executionBudgetVersion:1,budgetGrant:true}])
      await assert.rejects(async()=>f.store.claimExecution(bound.id,input));
    assert.equal((await f.store.requireTask(bound.id)).status,'ready');
    assert.equal((await f.ledger.read('comparison-2')).usedExecutions,0);
  });

  test(`${backend}: final slot competition and task version race never leave halfwrite`,async t=>{
    const f=fixture(t);await f.ledger.create(f.limits);
    const a=await f.store.attachEvaluationBudget((await task(f.store,'baseline')).id,{...bind,phase:'baseline',expectedVersion:1});
    const b=await f.store.attachEvaluationBudget((await task(f.store,'candidate')).id,{...bind,expectedVersion:1});
    const outcomes=await Promise.allSettled([claim(f.store,a),claim(f.store,b)]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    const tasks=await Promise.all([f.store.requireTask(a.id),f.store.requireTask(b.id)]);
    assert.equal(tasks.filter(x=>x.status==='running').length,1);
    assert.equal((await f.ledger.read(bind.jobId)).usedExecutions,1);
    const winner=tasks.find(x=>x.status==='running');
    assert.equal((await f.ledger.read(bind.jobId)).reservations[0].executionId,winner.checkpoint.executionId);
  });

  test(`${backend}: two claimants of the same task consume one reservation`,async t=>{
    const f=fixture(t,{maxExecutions:2,totalDurationMs:200});await f.ledger.create(f.limits);
    const bound=await f.store.attachEvaluationBudget((await task(f.store)).id,{...bind,expectedVersion:1});
    const outcomes=await Promise.allSettled([claim(f.store,bound),claim(f.store,bound)]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal((await f.ledger.read(bind.jobId)).usedExecutions,1);
    assert.equal((await f.store.requireTask(bound.id)).status,'running');
  });

  test(`${backend}: expired lease and paused retry keep the prior reservation held`,async t=>{
    const f=fixture(t,{maxExecutions:2,totalDurationMs:200});await f.ledger.create(f.limits);
    const bound=await f.store.attachEvaluationBudget((await task(f.store)).id,{...bind,expectedVersion:1});
    const first=await claim(f.store,bound,{leaseMs:1000});
    f.store.now=()=>new Date(3000).toISOString();
    await assert.rejects(()=>claim(f.store,first.task,{leaseMs:1000}),/previous|settlement/i);
    assert.equal((await f.ledger.read(bind.jobId)).usedExecutions,1);
    const paused=await f.store.applyAction(bound.id,{action:'pause',expectedVersion:first.task.version});
    const resumed=await f.store.applyAction(bound.id,{action:'resume',expectedVersion:paused.version});
    await assert.rejects(()=>claim(f.store,resumed),/previous|settlement/i);
    assert.equal((await f.ledger.read(bind.jobId)).usedExecutions,1);
  });

  test(`${backend}: generated execution ID collision cannot replay another task reservation`,async t=>{
    const f=fixture(t,{maxExecutions:2,totalDurationMs:200});await f.ledger.create(f.limits);
    const a=await f.store.attachEvaluationBudget((await task(f.store,'first')).id,{...bind,expectedVersion:1});
    const b=await f.store.attachEvaluationBudget((await task(f.store,'second')).id,{...bind,expectedVersion:1});
    f.store.id=()=> 'collision-id';
    await claim(f.store,a);
    await assert.rejects(()=>claim(f.store,b),/identifier already reserved/i);
    assert.equal((await f.store.requireTask(b.id)).status,'ready');
    assert.equal((await f.ledger.read(bind.jobId)).usedExecutions,1);
  });

  test(`${backend}: expired pending or corrupt/missing ledger blocks claim`,async t=>{
    const f=fixture(t,{maxExecutions:2,totalDurationMs:200});await f.ledger.create(f.limits);
    const a=await f.store.attachEvaluationBudget((await task(f.store,'first')).id,{...bind,expectedVersion:1});
    await claim(f.store,a);
    const b=await f.store.attachEvaluationBudget((await task(f.store,'second')).id,{...bind,expectedVersion:1});
    f.store.now=()=>new Date(1200).toISOString();
    await assert.rejects(()=>claim(f.store,b),/expired/i);
    assert.equal((await f.store.requireTask(b.id)).status,'ready');
    const sql=backend==='d1'?f.db.db:f.store.db;
    sql.prepare('UPDATE metadata SET value=? WHERE key=?').run('{bad','evaluation_budget:'+bind.jobId);
    await assert.rejects(()=>claim(f.store,b),/invalid/i);
    assert.equal((await f.store.requireTask(b.id)).status,'ready');
  });

  test(`${backend}: create/import forgery and ordinary mutation cannot alter binding`,async t=>{
    const f=fixture(t);await f.ledger.create(f.limits);
    await assert.rejects(async()=>f.store.createTask({prompt:'fake',evaluationBudget:bind}));
    assert.throws(()=>parseBundle(JSON.stringify({format:'inno-workspace-v1',tasks:[{id:'x',title:'x',version:1,messages:[],plan:[],artifacts:[],attachments:[],evaluationBudget:bind}]})));
    const ready=await task(f.store);
    await assert.rejects(()=>prepareImport({...ready,evaluationBudget:bind}),/server-owned/i);
    await assert.rejects(()=>prepareImport({...ready,checkpoint:{evaluationBudget:bind}}),/server-owned/i);
    const bound=await f.store.attachEvaluationBudget(ready.id,{...bind,expectedVersion:1});
    await assert.rejects(async()=>f.store.replaceTask(bound.id,bound.version,current=>({...current,evaluationBudget:undefined,version:current.version+1})),/immutable/i);
    assert.deepEqual((await f.store.requireTask(bound.id)).evaluationBudget,{...bind,provider:'codex'});
    const updated=await f.store.applyAction(bound.id,{action:'message',content:'keep this input',expectedVersion:bound.version});
    assert.deepEqual(updated.evaluationBudget,bound.evaluationBudget);
    assert.throws(()=>validateAssignments(bound,{}),/evaluation budget/i);
  });

  test(`${backend}: imported provenance cannot receive a server budget binding`,async t=>{
    const f=fixture(t);await f.ledger.create(f.limits);
    const ready=await task(f.store);
    const sql=backend==='d1'?f.db.db:f.store.db;
    sql.prepare('UPDATE tasks SET body=? WHERE id=?').run(JSON.stringify({...ready,provenance:{sourceId:'imported'}}),ready.id);
    await assert.rejects(async()=>f.store.attachEvaluationBudget(ready.id,{...bind,expectedVersion:1}),/fresh ready root/i);
  });
}

test('D1 injected SQL failure rolls task claim and ledger reservation back',async t=>{
  const db=new TestD1();t.after(()=>db.close());
  const store=new D1TaskStore(db,{now:()=>new Date(1000).toISOString()});
  const ledger=new D1EvaluationBudgets(db,{now:()=>1000});
  await ledger.create({jobId:bind.jobId,maxExecutions:1,totalDurationMs:100});
  const ready=await store.createTask({prompt:'atomic'});
  const bound=await store.attachEvaluationBudget(ready.id,{...bind,expectedVersion:1});
  const original=db.batch.bind(db);
  db.batch=statements=>original(statements.length===4?
    [statements[0],db.prepare("INSERT INTO metadata(key,value) VALUES ('revision',0)"),...statements.slice(1)]:statements);
  await assert.rejects(()=>store.claimExecution(bound.id,{provider:'codex',expectedVersion:bound.version,executionBudgetVersion:1}));
  assert.equal((await store.requireTask(bound.id)).status,'ready');
  assert.equal((await ledger.read(bind.jobId)).usedExecutions,0);
});

test('D1 zero-change ledger update forces rollback of the prior task update',async t=>{
  const db=new TestD1();t.after(()=>db.close());
  const store=new D1TaskStore(db,{now:()=>new Date(1000).toISOString()});
  const ledger=new D1EvaluationBudgets(db,{now:()=>1000});
  await ledger.create({jobId:bind.jobId,maxExecutions:1,totalDurationMs:100});
  const bound=await store.attachEvaluationBudget((await store.createTask({prompt:'atomic'})).id,{...bind,expectedVersion:1});
  const before=(await store.getState()).revision;
  db.db.exec(`CREATE TRIGGER disrupt_budget AFTER UPDATE ON tasks
    WHEN json_extract(new.body,'$.checkpoint.evaluationBudget') IS NOT NULL
    BEGIN DELETE FROM metadata WHERE key='evaluation_budget:comparison-1'; END`);
  await assert.rejects(()=>store.claimExecution(bound.id,{provider:'codex',expectedVersion:bound.version,executionBudgetVersion:1}));
  assert.equal((await store.requireTask(bound.id)).status,'ready');
  assert.equal((await ledger.read(bind.jobId)).usedExecutions,0);
  assert.equal((await store.getState()).revision,before);
});

test('D1 bound task refuses ordinary handoff before changing state',async t=>{
  const db=new TestD1();t.after(()=>db.close());
  const store=new D1TaskStore(db,{now:()=>new Date(1000).toISOString()});
  const ledger=new D1EvaluationBudgets(db,{now:()=>1000});
  await ledger.create({jobId:bind.jobId,maxExecutions:1,totalDurationMs:100});
  const bound=await store.attachEvaluationBudget((await store.createTask({prompt:'comparison'})).id,{...bind,expectedVersion:1});
  const owner=await store.claimExecution(bound.id,{provider:'codex',expectedVersion:bound.version,executionBudgetVersion:1});
  await assert.rejects(()=>store.handoffExecution(bound.id,{...owner,content:'draft',handoff:{provider:'claude'}}),/evaluation budget/i);
  assert.equal((await store.requireTask(bound.id)).status,'running');
});

test('D1 delegation store primitive trusts the stored budget binding',async t=>{
  const db=new TestD1();t.after(()=>db.close());
  const store=new D1TaskStore(db,{now:()=>new Date(1000).toISOString()});
  const ledger=new D1EvaluationBudgets(db,{now:()=>1000});
  await ledger.create({jobId:bind.jobId,maxExecutions:1,totalDurationMs:100});
  const bound=await store.attachEvaluationBudget((await store.createTask({prompt:'comparison'})).id,{...bind,expectedVersion:1});
  const forged={...bound,evaluationBudget:undefined};
  await assert.rejects(()=>store.replaceDelegation(forged,{...forged,version:forged.version+1,delegation:{state:'waiting_children'}}),/evaluation budget/i);
  assert.deepEqual((await store.requireTask(bound.id)).evaluationBudget,bound.evaluationBudget);
  const parent=await store.createTask({prompt:'ordinary parent'});
  const nextParent={...parent,version:parent.version+1,delegation:{state:'waiting_children'}};
  const forgedRecord={...bound,evaluationBudget:undefined};
  await assert.rejects(()=>store.replaceDelegation(parent,nextParent,[{current:forgedRecord,next:{...forgedRecord,version:forgedRecord.version+1}}]),/evaluation budget/i);
  assert.equal((await store.requireTask(parent.id)).version,parent.version);
});

test('SQLite file restart preserves bound task and unresolved reservation',async t=>{
  const root=resolve('.inno/tmp');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'evaluation-claim-'));
  assert.ok(resolve(directory).startsWith(root+sep));
  const filename=join(directory,'claim.sqlite');
  let store;
  t.after(()=>{store?.close();if(!resolve(directory).startsWith(root+sep))throw Error('unsafe cleanup path');rmSync(directory,{recursive:true,force:true});});
  store=new SqliteTaskStore(filename,{now:()=>new Date(1000).toISOString()});
  const ledger=new SqliteEvaluationBudgets(store.db,{now:()=>1000});
  await ledger.create({jobId:bind.jobId,maxExecutions:2,totalDurationMs:200});
  const bound=store.attachEvaluationBudget(store.createTask({prompt:'restart'}).id,{...bind,expectedVersion:1});
  const owner=store.claimExecution(bound.id,{provider:'codex',expectedVersion:bound.version,executionBudgetVersion:1,leaseMs:1000});
  store.close();store=null;
  store=new SqliteTaskStore(filename,{now:()=>new Date(3000).toISOString()});
  const reopened=new SqliteEvaluationBudgets(store.db,{now:()=>3000});
  assert.equal(store.requireTask(bound.id).checkpoint.executionId,owner.executionId);
  assert.equal((await reopened.read(bind.jobId)).usedExecutions,1);
  await assert.rejects(async()=>store.claimExecution(bound.id,{provider:'codex',expectedVersion:owner.task.version,executionBudgetVersion:1}),/previous|settlement/i);
});
