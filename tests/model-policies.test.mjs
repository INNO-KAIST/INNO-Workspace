import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {TestD1} from './helpers/d1.mjs';
import {D1ModelPolicies} from '../worker/model-policies.mjs';
import {SqliteModelPolicies} from '../server/model-policies.mjs';

const now=1_800_000_000_000;
const profile={family:'analysis',requirementsVersion:'r1',evaluationVersion:'e1',criteria:['correct'],requiredCapabilities:['tools'],contextClass:'large'};
const baseline={id:'base',provider:'codex',model:'established',modelVersion:'v1',effort:'high'};
const candidate={id:'next',provider:'codex',model:'candidate',modelVersion:'v2',effort:'medium'};
const availability=[baseline,candidate].map(x=>({provider:x.provider,model:x.model,modelVersion:x.modelVersion,efforts:[x.effort],capabilities:['tools'],contextClasses:['large'],observedAt:now,expiresAt:now+60_000,source:'account_catalog'}));
const observation=(id,candidateId,comparisonId)=>({id,provider:'codex',executionId:`execution-${id}`,generation:1,candidateId,modelVersion:candidateId==='base'?'v1':'v2',comparisonId,profile,observedAt:now,source:'normal_execution',quality:{source:'independent_review',critical:false,criteria:[{id:'correct',status:'pass'}]},usage:{source:'executor_report',inputTokens:candidateId==='base'?100:70,outputTokens:20,latencyMs:candidateId==='base'?1000:800}});

for(const [name,open] of [
 ['D1',()=>{const db=new TestD1(),reopen=(at=now)=>new D1ModelPolicies(db,{now:()=>at,getAvailability:()=>availability,verifyObservation:ref=>ref});return {store:reopen(),reopen,withoutVerifier:()=>new D1ModelPolicies(db,{now:()=>now}),close:()=>db.close()};}],
 ['SQLite',()=>{const db=new DatabaseSync(':memory:'),reopen=(at=now)=>new SqliteModelPolicies(db,{now:()=>at,getAvailability:()=>availability,verifyObservation:ref=>ref});return {store:reopen(),reopen,withoutVerifier:()=>new SqliteModelPolicies(db,{now:()=>now}),close:()=>db.close()};}],
]){
 test(`${name} persists policy transitions, replays exact operations, and rejects stale writes`,async()=>{
  const a=open();try{
   const {store}=a;
   const initial=await store.create({profile,baseline,minSamples:3,expectedStateVersion:0});
   assert.equal(initial.stateVersion,1);
   assert.deepEqual(await store.create({profile,baseline,minSamples:3,expectedStateVersion:0}),initial);
   assert.equal((await store.select(profile)).status,'fallback');
   const registered=await store.register({profile,candidate,expectedStateVersion:1});
   assert.equal(registered.stateVersion,2);
   assert.deepEqual(await store.register({profile,candidate,expectedStateVersion:1}),registered);
   await assert.rejects(store.register({profile,candidate:{...candidate,id:'other',model:'other'},expectedStateVersion:1}),/version/i);
   let version=registered.stateVersion;
   for(let i=0;i<3;i++)for(const which of ['base','next']){
    const row=observation(`${which}${i}`,which,`pair${i}`);
    const result=await store.observe({profile,evidenceRef:row,expectedStateVersion:version});
    assert.equal(result.recorded,true);version=result.state.stateVersion;
    const replay=await store.observe({profile,evidenceRef:row,expectedStateVersion:version-1});
    assert.equal(replay.recorded,false);assert.equal(replay.state.stateVersion,version);
   }
   const promotion=await store.promote({profile,candidateId:'next',expectedStateVersion:version});
   assert.equal(promotion.promoted,true);assert.equal((await store.select(profile)).model,'candidate');
   assert.deepEqual(await a.reopen().read(profile),promotion.state);
   assert.equal((await store.promote({profile,candidateId:'next',expectedStateVersion:version})).promoted,false);
   const withdrawal=await store.withdraw({profile,candidateId:'next',expectedStateVersion:promotion.state.stateVersion});
   assert.equal(withdrawal.withdrawn,true);assert.equal((await store.select(profile)).model,'established');
  }finally{a.close();}
 });
 test(`${name} rejects untrusted observation path and profile collisions`,async()=>{
  const a=open();try{
   const {store}=a;
   await store.create({profile,baseline,expectedStateVersion:0});
   await assert.rejects(store.create({profile,baseline:{...baseline,model:'other'},expectedStateVersion:0}),/conflict|exists/i);
   await assert.rejects(store.read({...profile,criteria:['changed']}),/not found/i);
   await assert.rejects(store.observe({profile,evidenceRef:observation('x','base','pair'),expectedStateVersion:1,observedAt:0}),/unknown|invalid/i);
  }finally{a.close();}
 });
 test(`${name} bounds profile count and requires a trusted observation verifier`,async()=>{
  const a=open();try{
   const {store}=a;
   for(let i=0;i<32;i++)await store.create({profile:{...profile,family:`family${i}`},baseline,expectedStateVersion:0});
   await assert.rejects(store.create({profile:{...profile,family:'overflow'},baseline,expectedStateVersion:0}),/limit/i);
   await assert.rejects(a.withoutVerifier().observe({profile:{...profile,family:'family0'},evidenceRef:observation('x','base','pair'),expectedStateVersion:1}),/trusted observation verifier/i);
   assert.equal((await store.read({...profile,family:'family0'})).stateVersion,1);
  }finally{a.close();}
 });
 test(`${name} never refreshes old evidence when ingestion is delayed`,async()=>{
  const a=open();try{
   await a.store.create({profile,baseline,expectedStateVersion:0});
   const old=observation('old','base','pair');
   await assert.rejects(a.reopen(now+91*86_400_000).observe({profile,evidenceRef:old,expectedStateVersion:1}),/observation time/i);
   assert.equal((await a.store.read(profile)).observations.length,0);
   await a.store.observe({profile,evidenceRef:old,expectedStateVersion:1});
   const replay=await a.reopen(now+91*86_400_000).observe({profile,evidenceRef:old,expectedStateVersion:1});
   assert.equal(replay.recorded,false);
   await assert.rejects(a.store.observe({profile,evidenceRef:{...old,observedAt:now-1},expectedStateVersion:1}),/version conflict/i);
  }finally{a.close();}
 });
}

test('SQLite policy survives closing and reopening its database file',async()=>{
 const directory=mkdtempSync(resolve('.inno/tmp/model-policy-')),file=join(directory,'state.sqlite');
 assert.ok(resolve(directory).startsWith(resolve('.inno/tmp')+sep));
 try{
  let db=new DatabaseSync(file);
  const store=new SqliteModelPolicies(db,{now:()=>now,getAvailability:()=>availability});
  const state=await store.create({profile,baseline,expectedStateVersion:0});
  db.close();db=new DatabaseSync(file);
  try{
   const restored=new SqliteModelPolicies(db,{now:()=>now,getAvailability:()=>availability});
   assert.deepEqual(await restored.read(profile),state);
   assert.equal((await restored.select(profile)).status,'fallback');
  }finally{db.close();}
 }finally{rmSync(directory,{recursive:true,force:true});}
});
