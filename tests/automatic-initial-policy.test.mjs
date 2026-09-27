import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {Delegations} from '../worker/delegations.mjs';
import {D1ModelPolicies,profileKey} from '../worker/model-policies.mjs';
import {delegationProfile} from '../worker/allocation-policy.mjs';

const children=['codex','claude'].map(provider=>({role:provider,provider,requestedModel:provider==='codex'?'gpt-5.6-luna':'haiku',effort:'low',sufficientReason:'bounded independent work',acceptanceCriteria:['answer checked'],instructions:'Check the answer'}));
const catalog={read:async()=>({codex:[{model:'gpt-5.6-luna',efforts:['low']}],claude:['haiku'],availability:'fresh',reportedAt:Date.now()}),validate:async routes=>{
  for(const route of routes)if(route.provider==='codex'&&route.requestedModel!=='gpt-5.6-luna'||route.provider==='claude'&&route.requestedModel!=='haiku')throw Error('unsupported account route');
}};
async function setup(t){
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db),service=new Delegations(store,{catalog});
 const parent=await store.createTask({prompt:'two independent checks'});
 const claim=await store.claimExecution(parent.id,{provider:'codex',expectedVersion:parent.version});
 const input={executionId:claim.executionId,generation:claim.generation,independent:true,children};
 const count=()=>db.db.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key GLOB 'model_policy:*'").get().n;
 return {db,store,service,parent,input,count};
}

test('first allocation atomically creates two unverified baselines and replay creates none',async t=>{
 const f=await setup(t);assert.equal(f.count(),0);
 const first=await f.service.allocate(f.parent.id,f.input);
 assert.equal(f.count(),2);
 for(const assignment of first.parent.delegation.children){
  assert.equal(assignment.selection.status,'fallback');
  assert.equal(assignment.selection.reason,'baseline_version_unverified');
  assert.equal(assignment.selection.policyVersion,1);
  assert.equal(assignment.selection.modelVersion,null);
  assert.deepEqual(assignment.selection.evidenceIds,[]);
  const key=await profileKey(await delegationProfile(assignment));
  const row=f.db.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
  assert.ok(row);
  const policy=JSON.parse(row.value);
  assert.equal(policy.candidates[0].modelVersion,null);
  assert.equal(policy.candidates[0].status,'active');
  assert.equal(policy.observations.length,0);
 }
 const replay=await f.service.allocate(f.parent.id,f.input);
 assert.equal(replay.replayed,true);assert.equal(f.count(),2);
 assert.deepEqual(replay.parent.delegation.children,first.parent.delegation.children);
});

test('SQL failure leaves no child or initial policy and retains the claimed parent',async t=>{
 const f=await setup(t),original=f.db.batch.bind(f.db);
 f.db.batch=statements=>{
  if(statements[0]?.sql?.startsWith('UPDATE tasks SET version')){
   const index=statements.findIndex(s=>s.sql?.startsWith('INSERT INTO metadata'));
   if(index>=0)return original([...statements.slice(0,index+1),f.db.prepare('INSERT INTO missing_initial_policy_table VALUES (1)'),...statements.slice(index+1)]);
  }
  return original(statements);
 };
 await assert.rejects(f.service.allocate(f.parent.id,f.input));
 assert.equal(f.count(),0);
 assert.equal((await f.store.requireTask(f.parent.id)).status,'running');
 assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE json_extract(body,'$.parentTaskId') IS NOT NULL").get().n,0);
});

test('full exact policy capacity keeps validated normal allocation with an explicit uninitialized reason',async t=>{
 const f=await setup(t);
 for(let i=0;i<32;i++)f.db.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(`model_policy:occupied${i}`,'{}');
 const result=await f.service.allocate(f.parent.id,f.input);
 assert.equal(f.count(),32);
 assert.equal(result.parent.delegation.children.length,2);
 for(const assignment of result.parent.delegation.children){
  assert.equal(assignment.selection.status,'fallback');
  assert.equal(assignment.selection.reason,'policy_capacity_unavailable');
  assert.equal(assignment.selection.policyVersion,null);
  assert.equal(assignment.selection.modelVersion,null);
  assert.deepEqual(assignment.selection.evidenceIds,[]);
 }
});

test('existing withdrawn policy is never overwritten by automatic initialization',async t=>{
 const f=await setup(t),profile=await delegationProfile(children[0]);
 const policies=new D1ModelPolicies(f.db,{now:Date.now});
 const existing=await policies.create({profile,baseline:{id:'baseline',provider:'codex',model:'gpt-5.6-luna',modelVersion:null,effort:'low'},expectedStateVersion:0});
 const key=await profileKey(profile);
 const withdrawn={...existing,activeId:null,candidates:[{...existing.candidates[0],status:'withdrawn'}]};
 f.db.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(JSON.stringify(withdrawn),key);
 await assert.rejects(f.service.allocate(f.parent.id,f.input),/eligible|route/i);
 assert.deepEqual(JSON.parse(f.db.db.prepare('SELECT value FROM metadata WHERE key=?').get(key).value),withdrawn);
 assert.equal((await f.store.requireTask(f.parent.id)).status,'running');
 assert.equal(f.count(),1);
});

test('validation and allocation preparation failures leave no policy or children',async t=>{
 for(const failure of ['validate','prepare']){
  const f=await setup(t);
  if(failure==='validate')f.service.catalog={...catalog,validate:async()=>{throw Error('account validation failed');}};
  else f.store.id=()=>{throw Error('allocation id failed');};
  await assert.rejects(f.service.allocate(f.parent.id,f.input),/failed/);
  assert.equal(f.count(),0);
  assert.equal((await f.store.requireTask(f.parent.id)).status,'running');
  assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE json_extract(body,'$.parentTaskId') IS NOT NULL").get().n,0);
 }
});

test('one remaining policy slot initializes the first profile and explicitly defers the second',async t=>{
 const f=await setup(t);
 for(let i=0;i<31;i++)f.db.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(`model_policy:occupied${i}`,'{}');
 f.db.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run('modelXpolicy:lookalike','{}');
 const result=await f.service.allocate(f.parent.id,f.input);
 assert.equal(f.count(),32);
 const [codex,claude]=result.parent.delegation.children;
 assert.equal(codex.selection.reason,'baseline_version_unverified');assert.equal(codex.selection.policyVersion,1);
 assert.equal(claude.selection.reason,'policy_capacity_unavailable');assert.equal(claude.selection.policyVersion,null);
});

test('full policy capacity still validates both account routes',async t=>{
 const f=await setup(t),checked=[];
 for(let i=0;i<32;i++)f.db.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(`model_policy:occupied${i}`,'{}');
 f.service.catalog={...catalog,validate:async routes=>{checked.push(...routes);await catalog.validate(routes);}};
 await f.service.allocate(f.parent.id,f.input);
 assert.deepEqual(checked.map(row=>row.provider),['codex','claude']);
});

test('policy collision at parent CAS retries against the existing withdrawn policy without overwriting it',async t=>{
 const f=await setup(t),original=f.db.batch.bind(f.db),profile=await delegationProfile(children[0]),key=await profileKey(profile);
 let collided=false;
 f.db.batch=statements=>{
  if(!collided&&statements[0]?.sql?.startsWith('UPDATE tasks SET version')){
   collided=true;
   const state={schemaVersion:1,stateVersion:1,policyVersion:2,profile,baselineId:'baseline',activeId:null,previousId:null,pin:null,minSamples:3,candidates:[{id:'baseline',provider:'codex',model:'gpt-5.6-luna',modelVersion:null,effort:'low',status:'withdrawn'}],observations:[],activeEvidenceIds:[]};
   f.db.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(key,JSON.stringify(state));
  }
  return original(statements);
 };
 await assert.rejects(f.service.allocate(f.parent.id,f.input),/eligible|route/i);
 assert.equal(collided,true);assert.equal(f.count(),1);
 assert.equal(JSON.parse(f.db.db.prepare('SELECT value FROM metadata WHERE key=?').get(key).value).candidates[0].status,'withdrawn');
 assert.equal((await f.store.requireTask(f.parent.id)).status,'running');
 assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE json_extract(body,'$.parentTaskId') IS NOT NULL").get().n,0);
});

test('parent CAS loser retries once and commits one matching policy and child set',async t=>{
 const f=await setup(t),original=f.db.batch.bind(f.db);let raced=false,attempts=0;
 f.db.batch=statements=>{
  if(statements[0]?.sql?.startsWith('UPDATE tasks SET version')){
   attempts++;
   if(!raced){
    raced=true;const row=f.db.db.prepare('SELECT body FROM tasks WHERE id=?').get(f.parent.id),body=JSON.parse(row.body);
    body.version++;
    f.db.db.prepare('UPDATE tasks SET version=?,body=? WHERE id=?').run(body.version,JSON.stringify(body),f.parent.id);
   }
  }
  return original(statements);
 };
 const result=await f.service.allocate(f.parent.id,f.input);
 assert.equal(attempts,2);assert.equal(result.parent.delegation.children.length,2);assert.equal(f.count(),2);
 assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE json_extract(body,'$.parentTaskId') IS NOT NULL").get().n,2);
});

test('an unexpected zero-change policy insert aborts the entire allocation batch',async t=>{
 const f=await setup(t),original=f.db.batch.bind(f.db);
 f.db.batch=statements=>{
  if(statements[0]?.sql?.startsWith('UPDATE tasks SET version')){
   const index=statements.findIndex(s=>s.sql?.startsWith('INSERT INTO metadata'));
   if(index>=0){
    const noChange=f.db.prepare('INSERT INTO metadata(key,value) SELECT ?1,?2 WHERE 0').bind(...statements[index].values.slice(0,2));
    return original([...statements.slice(0,index),noChange,...statements.slice(index+1)]);
   }
  }
  return original(statements);
 };
 await assert.rejects(f.service.allocate(f.parent.id,f.input));
 assert.equal(f.count(),0);
 assert.equal((await f.store.requireTask(f.parent.id)).status,'running');
 assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE json_extract(body,'$.parentTaskId') IS NOT NULL").get().n,0);
});

test('an unexpected zero-change child insert cannot leave an orphan initial policy',async t=>{
 const f=await setup(t),original=f.db.batch.bind(f.db);
 f.db.batch=statements=>{
  if(statements[0]?.sql?.startsWith('UPDATE tasks SET version')){
   const index=statements.findIndex(s=>s.sql?.startsWith('INSERT INTO tasks'));
   if(index>=0){
    const noChange=f.db.prepare('INSERT INTO tasks(id,version,updated_at,body) SELECT ?1,?2,?3,?4 WHERE 0').bind(...statements[index].values.slice(0,4));
    return original([...statements.slice(0,index),noChange,...statements.slice(index+1)]);
   }
  }
  return original(statements);
 };
 await assert.rejects(f.service.allocate(f.parent.id,f.input));
 assert.equal(f.count(),0);
 assert.equal((await f.store.requireTask(f.parent.id)).status,'running');
 assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE json_extract(body,'$.parentTaskId') IS NOT NULL").get().n,0);
});
