import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {SqliteTaskStore} from '../server/store.mjs';
import {createWorker} from '../worker/index.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {executionCapability} from '../worker/execution-scope.mjs';
import {validateOwnedExecutionEvidence,wallElapsedMs} from '../public/core/execution-evidence.mjs';

const evidence={provider:'codex',source:'cli_arguments',requestedModel:null,requestedEffort:null,cliAppliedModel:null,cliAppliedEffort:null,actualModelVersion:null,processElapsedMs:250};
const expected={...evidence,wallElapsedMs:5000};
const claimedAt='2026-09-27T00:00:00.000Z';
const completedAt='2026-09-27T00:00:05.000Z';

for(const backend of ['sqlite','d1'])test(`${backend} stores trusted evidence on the owning completion only`,async t=>{
 const db=backend==='d1'?new TestD1():null;
 const store=db?new D1TaskStore(db):new SqliteTaskStore(':memory:');
 t.after(()=>db?db.close():store.close());
 store.now=()=>claimedAt;
 const task=await store.createTask({prompt:'Work'});
 const owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 store.now=()=>completedAt;
 const input={...owner,content:'Done',executionEvidence:evidence};
 const done=backend==='d1'?await new CloudBridge(store).complete(task.id,input):await store.finishExecution(task.id,input,{allowDesktopEvidence:true});
 assert.deepEqual(done.checkpoint.executionEvidence,expected);
 assert.equal(done.checkpoint.claimedAt,claimedAt);assert.equal(done.checkpoint.completedAt,completedAt);
 assert.deepEqual((await store.requireTask(task.id)).checkpoint.executionEvidence,expected);
 await assert.rejects(async()=>store.finishExecution(task.id,{...input,executionEvidence:{...evidence,processElapsedMs:999}},{allowDesktopEvidence:true}));
 assert.deepEqual((await store.requireTask(task.id)).checkpoint.executionEvidence,expected);
});

for(const backend of ['sqlite','d1'])test(`${backend} ignores untrusted completion evidence and invalid wall clock`,async t=>{
 const db=backend==='d1'?new TestD1():null;
 const store=db?new D1TaskStore(db):new SqliteTaskStore(':memory:');t.after(()=>db?db.close():store.close());
 store.now=()=>completedAt;
 const task=await store.createTask({prompt:'Work'}),owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 store.now=()=>claimedAt;
 const done=await store.finishExecution(task.id,{...owner,content:'Done',executionEvidence:evidence});
 assert.equal(done.checkpoint.executionEvidence,undefined);
 assert.equal(done.checkpoint.wallElapsedMs,null);
});

for(const backend of ['sqlite','d1'])test(`${backend} clears prior execution evidence when a new owner claims the task`,async t=>{
 const db=backend==='d1'?new TestD1():null;
 const store=db?new D1TaskStore(db):new SqliteTaskStore(':memory:');t.after(()=>db?db.close():store.close());
 const task=await store.createTask({prompt:'Work'}),owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 const completed=await store.finishExecution(task.id,{...owner,content:'First',executionEvidence:evidence},{allowDesktopEvidence:true});
 const followup=await store.applyAction(task.id,{action:'message',expectedVersion:completed.version,content:'Continue'});
 const fresh=await store.claimExecution(task.id,{provider:'codex',expectedVersion:followup.version});
 assert.notEqual(fresh.executionId,owner.executionId);
 assert.equal(fresh.task.checkpoint.executionEvidence,undefined);
 assert.equal(fresh.task.checkpoint.wallElapsedMs,undefined);
 await assert.rejects(async()=>store.finishExecution(task.id,{...owner,content:'Late',executionEvidence:{...evidence,processElapsedMs:999}},{allowDesktopEvidence:true}));
 assert.equal((await store.requireTask(task.id)).checkpoint.executionEvidence,undefined);
});

test('interrupted lease recovery retains the same owner and trusted evidence',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),bridge=new CloudBridge(store);
 store.now=()=>claimedAt;const task=await store.createTask({prompt:'Work'}),owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 const paused=await store.replaceTask(task.id,owner.task.version,current=>({...current,status:'paused',version:current.version+1,checkpoint:{...current.checkpoint,status:'paused',interruptedBy:'lease_expiry',interruptedVersion:current.version+1}}));
 store.now=()=>completedAt;
 const done=await bridge.complete(task.id,{...owner,content:'Saved result',executionEvidence:evidence});
 assert.equal(done.status,'completed');assert.equal(done.checkpoint.executionId,owner.executionId);
 assert.equal(done.checkpoint.generation,owner.generation);assert.deepEqual(done.checkpoint.executionEvidence,expected);
 assert.equal(paused.checkpoint.executionEvidence,undefined);
});

test('authenticated desktop HTTP persists evidence, but MCP completion cannot forge it',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db),worker=createWorker(),token='test-secret-01234567890123456789',env={DB:db,ACCESS_TOKEN:token};
 const post=async(path,input)=>{const response=await worker.fetch(new Request('https://inno.example'+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input)}),env);return {status:response.status,body:await response.json()};};
 store.now=()=>claimedAt;
 const task=await store.createTask({prompt:'Desktop work'}),owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 store.now=()=>completedAt;
 const first=await post(`/api/desktop/${task.id}/complete`,{...owner,content:'Done',executionEvidence:evidence});
 assert.equal(first.status,200);
 const saved=(await store.requireTask(task.id)).checkpoint;
 assert.deepEqual({...saved.executionEvidence,wallElapsedMs:5000},expected);
 assert.equal(saved.executionEvidence.wallElapsedMs,Date.parse(saved.completedAt)-Date.parse(saved.claimedAt));
 const replay=await post(`/api/desktop/${task.id}/complete`,{...owner,content:'Different',executionEvidence:{...evidence,processElapsedMs:999}});
 assert.equal(replay.status,200);assert.deepEqual(replay.body.task.checkpoint.executionEvidence,saved.executionEvidence);
 const other=await store.createTask({prompt:'MCP work'}),claim=await store.claimExecution(other.id,{provider:'claude',expectedVersion:other.version});
 const capability=await executionCapability(token,{task:{id:other.id},executionId:claim.executionId,generation:claim.generation});
 const mcp=await post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',executionCapability:capability,params:{name:'checkpoint_task',arguments:{taskId:other.id,...claim,status:'completed',summary:'Done',executionEvidence:evidence}}});
 assert.equal(mcp.status,200);assert.equal((await store.requireTask(other.id)).checkpoint.executionEvidence,undefined);
});

test('desktop evidence rejects provider mismatch before committing result',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),bridge=new CloudBridge(store);
 const task=await store.createTask({prompt:'Work'}),claim=await store.claimExecution(task.id,{provider:'claude',expectedVersion:task.version});
 await assert.rejects(()=>bridge.complete(task.id,{...claim,content:'Done',executionEvidence:evidence}),/provider|evidence/i);
 assert.equal((await store.requireTask(task.id)).status,'running');
});

test('assigned model and effort must match the claimed CLI arguments',()=>{
 const child={parentTaskId:'parent',assignment:{requestedModel:'gpt-5.6-terra',effort:'high'},checkpoint:{provider:'codex'}};
 const matching={...evidence,requestedModel:'gpt-5.6-terra',requestedEffort:'high',cliAppliedModel:'gpt-5.6-terra',cliAppliedEffort:'high'};
 assert.deepEqual(validateOwnedExecutionEvidence(child,matching),matching);
 assert.throws(()=>validateOwnedExecutionEvidence(child,{...matching,cliAppliedModel:'gpt-5.6-luna'}),/assignment/);
 assert.throws(()=>validateOwnedExecutionEvidence(child,{...matching,requestedEffort:'low'}),/assignment/);
 assert.throws(()=>validateOwnedExecutionEvidence(child,{...matching,actualModelVersion:'gpt-5.6-terra'}),/provenance/);
 assert.throws(()=>validateOwnedExecutionEvidence(child,{...matching,processElapsedMs:-1}),/process time/);
 assert.throws(()=>validateOwnedExecutionEvidence(child,{...matching,processElapsedMs:NaN}),/process time/);
});

test('server wall time includes long callback delay while invalid timestamps stay unknown',()=>{
 assert.equal(wallElapsedMs('2026-01-01T00:00:00.000Z','2026-05-01T00:00:00.000Z'),10_368_000_000);
 assert.equal(wallElapsedMs(null,completedAt),null);
 assert.equal(wallElapsedMs(completedAt,claimedAt),null);
});
