import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {TestD1} from './helpers/d1.mjs';
import {D1ModelPolicies,profileKey} from '../worker/model-policies.mjs';
import {SqliteModelPolicies} from '../server/model-policies.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1_SCHEMA} from '../worker/store.mjs';

const DAY=86_400_000,now=1_800_000_000_000;
const profile={family:'retention',requirementsVersion:'r1',evaluationVersion:'e1',criteria:['correct'],requiredCapabilities:['tools'],contextClass:'large'};
const baseline={id:'base',provider:'codex',model:'base',modelVersion:'v1',effort:'high'};
const availability=[{provider:'codex',model:'base',modelVersion:'v1',efforts:['high'],capabilities:['tools'],contextClasses:['large'],observedAt:now,expiresAt:now+60_000,source:'account_catalog'}];
const evidence=(id,observedAt=now-91*DAY)=>({id,observedAt});
const observation=id=>({id,provider:'codex',executionId:`exec-${id}`,generation:1,candidateId:'base',modelVersion:'v1',comparisonId:`compare-${id}`,profile,observedAt:now,source:'normal_execution',quality:{source:'independent_review',critical:false,criteria:[{id:'correct',status:'pass'}]},usage:{source:'executor_report',inputTokens:1,outputTokens:1,latencyMs:1}});
const setup=(kind,at=now)=>{
 const db=kind==='D1'?new TestD1():new DatabaseSync(':memory:');
 if(kind==='SQLite')db.exec(D1_SCHEMA);
 const make=(time=at)=>kind==='D1'?new D1ModelPolicies(db,{now:()=>time,getAvailability:()=>availability,verifyObservation:ref=>ref}):new SqliteModelPolicies(db,{now:()=>time,getAvailability:()=>availability,verifyObservation:ref=>ref});
 return {db,store:make(),make,close:()=>db.close(),sql:db.db??db};
};
async function seed(f,state){f.sql.prepare('UPDATE metadata SET value=? WHERE key=?').run(JSON.stringify(state),await profileKey(profile));}
function task(f,id,status,own,children){
 const body={id,status,...(own?{assignment:{selection:{evidenceIds:own}}}:{}),...(children?{delegation:{children:children.map(ids=>({selection:{evidenceIds:ids}}))}}:{})};
 f.sql.prepare('INSERT INTO tasks(id,version,updated_at,body) VALUES(?,?,?,?)').run(id,1,new Date(now).toISOString(),JSON.stringify(body));
}

for(const kind of ['D1','SQLite']){
 test(`${kind} ignores 513 empty fallback snapshots but preserves mixed real task pins`,async t=>{
  const f=setup(kind);t.after(f.close);
  const initial=await f.store.create({profile,baseline,expectedStateVersion:0});
  await seed(f,{...initial,observations:[evidence('own-pin'),evidence('child-pin'),evidence('orphan')]});
  for(let i=0;i<513;i++)task(f,`empty-${i}`,'queued',i%2?[]:null,i%2?null:[[],[]]);
  task(f,'owner','paused',['own-pin']);
  task(f,'parent','waiting_children',[],[['child-pin'],[]]);
  const result=await f.store.prune({profile,expectedStateVersion:1});
  assert.equal(result.removed,1);
  assert.deepEqual(result.state.observations.map(row=>row.id),['own-pin','child-pin']);
  const added=await f.store.observe({profile,evidenceRef:observation('new'),expectedStateVersion:result.state.stateVersion});
  assert.ok(added.state.observations.some(row=>row.id==='new'));
 });

 test(`${kind} still defers at 513 real pins and on malformed or unsupported selections`,async t=>{
  const f=setup(kind);t.after(f.close);
  const initial=await f.store.create({profile,baseline,expectedStateVersion:0});
  await seed(f,{...initial,observations:[evidence('old')]});
  for(let i=0;i<513;i++)task(f,`real-${i}`,'queued',[`pin-${i}`]);
  await assert.rejects(f.store.prune({profile,expectedStateVersion:1}),/task pin scan limit/);
  f.sql.prepare('DELETE FROM tasks').run();
  for(let i=0;i<513;i++)task(f,`empty-${i}`,'queued',[]);
  task(f,'malformed','paused','not-an-array');
  await assert.rejects(f.store.prune({profile,expectedStateVersion:1}),/invalid task evidence/);
  f.sql.prepare('DELETE FROM tasks WHERE id=?').run('malformed');
  task(f,'unknown','paused',null,[[],[],[],[],[]]);
  await assert.rejects(f.store.prune({profile,expectedStateVersion:1}),/unsupported task selection shape/);
 });

 test(`${kind} keeps active and paused task evidence past 90 days, trims to 1000, and no-ops`,async t=>{
  const f=setup(kind);t.after(f.close);let state=await f.store.create({profile,baseline,expectedStateVersion:0});
  state={...state,activeEvidenceIds:['active'],observations:[evidence('active'),evidence('paused'),...Array.from({length:1000},(_,i)=>evidence(`old${i}`,i<1?now-91*DAY:now))]};await seed(f,state);
  task(f,'paused-task','paused',['paused']);task(f,'done-task','completed',['old0']);
  const result=await f.store.prune({profile,expectedStateVersion:1});
  assert.equal(result.removed,2);assert.equal(result.state.observations.length,1000);
  assert.ok(result.state.observations.some(x=>x.id==='active'));
  assert.ok(result.state.observations.some(x=>x.id==='paused'));
  assert.ok(!result.state.observations.some(x=>x.id==='old0'));
  assert.equal(result.expiredPinned,2);
  const again=await f.make().prune({profile,expectedStateVersion:2});
  assert.equal(again.removed,0);assert.equal(again.state.stateVersion,2);
  await assert.rejects(f.store.prune({profile,expectedStateVersion:1}),/conflict/i);
 });

 test(`${kind} observes without losing paused review snapshots and fails closed on unknown pins`,async t=>{
  const f=setup(kind);t.after(f.close);let state=await f.store.create({profile,baseline,expectedStateVersion:0});
  state={...state,observations:[evidence('parent-pin',now-91*DAY),...Array.from({length:999},(_,i)=>evidence(`recent${i}`,now))]};await seed(f,state);
  task(f,'review-parent','queued_for_review',null,[['parent-pin'],[]]);
  const added=await f.store.observe({profile,evidenceRef:observation('new'),expectedStateVersion:1});
  assert.equal(added.state.observations.length,1000);
  assert.ok(added.state.observations.some(x=>x.id==='parent-pin'));
  task(f,'unexpected-parent','paused',null,[[],[],[],[],[]]);
  await assert.rejects(f.store.prune({profile,expectedStateVersion:2}),/deferred/i);
  assert.equal((await f.store.read(profile)).stateVersion,2);
 });

 test(`${kind} preserves critical withdrawal even when all 1000 records are pinned`,async t=>{
  const f=setup(kind);t.after(f.close);let state=await f.store.create({profile,baseline,expectedStateVersion:0});
  const ids=Array.from({length:1000},(_,i)=>`p${i}`);
  state={...state,activeId:'next',previousId:'base',activeEvidenceIds:ids,candidates:[{...baseline,status:'testing'},{id:'next',provider:'codex',model:'next',modelVersion:'v2',effort:'medium',status:'active',evidenceIds:ids,evidenceRefs:[]}],observations:ids.map(id=>evidence(id,now))};await seed(f,state);
  task(f,'running-child','running',ids);
  const critical={...observation('critical'),candidateId:'next',modelVersion:'v2',quality:{source:'independent_review',critical:true,criteria:[{id:'correct',status:'fail'}]}};
  const result=await f.store.observe({profile,evidenceRef:critical,expectedStateVersion:1});
  assert.equal(result.reason,'critical_regression');assert.equal(result.state.activeId,'base');
  assert.equal(result.state.observations.length,1001);
  assert.ok(ids.every(id=>result.state.observations.some(row=>row.id===id)));
  const cleanup=await f.store.prune({profile,expectedStateVersion:result.state.stateVersion});
  assert.equal(cleanup.overLimit,1);assert.equal(cleanup.removed,0);
 });

 test(`${kind} reports cleanup deferral and read-only diagnostics`,async t=>{
  const f=setup(kind);t.after(f.close);let state=await f.store.create({profile,baseline,expectedStateVersion:0});
  state={...state,observations:[evidence('old')]};await seed(f,state);
  task(f,'bad-task','paused',null,[[],[],[],[],[]]);
  const status=await f.store.cleanupBatch();
  assert.equal(status.status,'deferred');assert.equal(status.deferredCount,1);
  assert.equal((await f.store.read(profile)).observations.length,1);
  assert.deepEqual(await f.store.retentionStatus(),status);
 });
}

test('scheduled cleanup failure does not stop the baseline drain; status route is authenticated and read only',async t=>{
 const f=setup('D1');t.after(f.close);const worker=createWorker({fetchFn:async()=>{throw Error('offline');}}),env={DB:f.db,ACCESS_TOKEN:'retention-token-123456789012345'};
 const created=await f.store.create({profile,baseline,expectedStateVersion:0});await seed(f,{...created,observations:[evidence('old',0)]});
 task(f,'bad-task','paused',null,[[],[],[],[],[]]);
 assert.deepEqual(await worker.scheduled({},env),{checked:0,failed:0});
 assert.equal((await worker.fetch(new Request('https://inno.test/api/model-policy-retention'),env)).status,401);
 const revision=f.sql.prepare("SELECT value FROM metadata WHERE key='revision'").get().value;
 const response=await worker.fetch(new Request('https://inno.test/api/model-policy-retention',{headers:{authorization:`Bearer ${env.ACCESS_TOKEN}`}}),env);
 assert.equal(response.status,200);assert.equal((await response.json()).status,'deferred');
 assert.equal(f.sql.prepare("SELECT value FROM metadata WHERE key='revision'").get().value,revision);
});

test('a task revision change after pin lookup rejects the prune CAS',async t=>{
 const f=setup('D1');t.after(f.close);const initial=await f.store.create({profile,baseline,expectedStateVersion:0});
 await seed(f,{...initial,observations:[evidence('old')]});task(f,'paused','paused',['other']);
 const original=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>{
  const statement=original(sql);
  if(!sql.includes('AS own'))return statement;
  return {...statement,all:async()=>{const rows=await statement.all();f.sql.prepare("UPDATE metadata SET value=value+1 WHERE key='revision'").run();return rows;}};
 };
 await assert.rejects(f.store.prune({profile,expectedStateVersion:1}),/version conflict/i);
 assert.equal((await f.store.read(profile)).stateVersion,1);
});

test('clock rollback cannot delete a policy evidence reference',async t=>{
 const f=setup('D1');t.after(f.close);const initial=await f.store.create({profile,baseline,expectedStateVersion:0});
 await seed(f,{...initial,activeEvidenceIds:['future-pin'],observations:[evidence('future-pin',now+DAY)]});
 const result=await f.store.prune({profile,expectedStateVersion:1});
 assert.equal(result.removed,0);assert.equal(result.state.observations[0].id,'future-pin');
});

test('SQLite retains cleaned policy and cleanup status across database restart',async()=>{
 const directory=mkdtempSync(resolve('.inno/tmp/policy-retention-')),file=join(directory,'state.sqlite');
 try{
  let db=new DatabaseSync(file);db.exec(D1_SCHEMA);
  let policies=new SqliteModelPolicies(db,{now:()=>now});
  const initial=await policies.create({profile,baseline,expectedStateVersion:0});
  db.prepare('UPDATE metadata SET value=? WHERE key=?').run(JSON.stringify({...initial,observations:[evidence('old')]}),await profileKey(profile));
  const pending=await policies.cleanupBatch({limit:1});
  assert.equal(pending.removed,1);assert.equal(pending.status,'running');assert.equal(pending.cursor,await profileKey(profile));
  db.close();db=new DatabaseSync(file);
  try{
   policies=new SqliteModelPolicies(db,{now:()=>now});
   assert.equal((await policies.read(profile)).observations.length,0);
   assert.equal((await policies.retentionStatus()).cursor,pending.cursor);
   const completed=await policies.cleanupBatch({limit:1});
   assert.equal(completed.status,'complete');assert.equal(completed.cursor,null);assert.equal(completed.removed,1);
  }finally{db.close();}
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('critical regression still withdraws at the 2 MB state limit',async t=>{
 const f=setup('D1');t.after(f.close);const initial=await f.store.create({profile,baseline,expectedStateVersion:0});
 const prior={...initial,activeId:'next',previousId:'base',candidates:[{...baseline,status:'testing'},{id:'next',provider:'codex',model:'next',modelVersion:'v2',effort:'medium',status:'active'}],observations:[{...evidence('large',now),filler:''}]};
 const target=1_999_850,baseBytes=Buffer.byteLength(JSON.stringify(prior));
 prior.observations[0].filler='x'.repeat(target-baseBytes);
 assert.equal(Buffer.byteLength(JSON.stringify(prior)),target);await seed(f,prior);
 const critical={...observation('critical-capacity'),candidateId:'next',modelVersion:'v2',quality:{source:'independent_review',critical:true,criteria:[{id:'correct',status:'fail'}]}};
 const result=await f.store.observe({profile,evidenceRef:critical,expectedStateVersion:1});
 assert.equal(result.recorded,false);assert.equal(result.reason,'critical_regression_evidence_capacity');
 assert.equal(result.state.activeId,'base');assert.equal(result.state.observations.length,1);
 assert.equal((await f.make().read(profile)).activeId,'base');
});

test('baseline critical at the 2 MB limit persists exclusion without losing prior observations',async t=>{
 const f=setup('D1');t.after(f.close);
 const initial=await f.store.create({profile,baseline,expectedStateVersion:0});
 const pinned=await f.store.pin({profile,candidateId:'base',expectedStateVersion:initial.stateVersion});
 const prior={...pinned.state,observations:[{...evidence('large',now),filler:''}]};
 const target=1_999_850,baseBytes=Buffer.byteLength(JSON.stringify(prior));
 prior.observations[0].filler='x'.repeat(target-baseBytes);
 await seed(f,prior);
 const critical={...observation('baseline-capacity'),quality:{source:'independent_review',critical:true,criteria:[{id:'correct',status:'fail'}]}};
 const result=await f.store.observe({profile,evidenceRef:critical,expectedStateVersion:prior.stateVersion});
 assert.equal(result.recorded,false);assert.equal(result.reason,'critical_regression_evidence_capacity');
 assert.equal(result.state.activeId,null);assert.equal(result.state.pin,null);
 assert.equal(result.state.candidates.find(x=>x.id==='base').status,'withdrawn');
 assert.deepEqual(result.state.observations,prior.observations);
 assert.equal((await f.make().select(profile)).status,'wait');
 await assert.rejects(f.make().observe({profile,evidenceRef:observation('different'),expectedStateVersion:prior.stateVersion}),/version conflict/i);
});
