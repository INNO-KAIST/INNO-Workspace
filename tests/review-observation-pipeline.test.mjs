import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {D1ModelPolicies} from '../worker/model-policies.mjs';
import {delegationProfile} from '../worker/allocation-policy.mjs';
import {createReviewObservationPipeline} from '../worker/review-observation-pipeline.mjs';
import {createWorker} from '../worker/index.mjs';

const when='2026-09-27T00:00:04.000Z';
async function fixture(t,{policy=true}={}){
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db,{now:()=>when});
 const assignments=await Promise.all(['codex','claude'].map(async(provider,i)=>{
  const a={taskId:`child-${i}`,provider,requestedModel:provider==='codex'?'gpt-test':'sonnet',effort:'low',role:'analyst',instructions:`Check item ${i}`,acceptanceCriteria:['correct'],sourceIds:[]};
  return {...a,selection:{status:'fallback',modelVersion:null,profile:await delegationProfile(a)}};
 }));
 const children=assignments.map((a,i)=>({id:a.taskId,version:3,status:'completed',updatedAt:when,parentTaskId:'parent',batchId:'batch',parentEpoch:1,prompt:a.instructions,assignment:Object.fromEntries(Object.entries(a).filter(([k])=>k!=='taskId')),attachments:[],checkpoint:{provider:a.provider,executionId:`execution-${i}`,generation:1,claimedAt:'2026-09-27T00:00:00.000Z',completedAt:'2026-09-27T00:00:02.000Z'}}));
 const parent={id:'parent',version:4,status:'completed',updatedAt:when,attachments:[],checkpoint:{provider:'claude',executionId:'review',generation:1,claimedAt:'2026-09-27T00:00:02.000Z',completedAt:when},delegation:{state:'completed',batchId:'batch',epoch:1,masterProvider:'claude',children:assignments,review:{children:assignments.map(a=>({taskId:a.taskId,summary:'checked',artifacts:[]}))},reviewReport:assignments.map(a=>({childTaskId:a.taskId,criteria:[{criterion:'correct',status:'pass',evidence:'Checked'}]}))}};
 for(const task of [parent,...children])await db.prepare('INSERT INTO tasks(id,version,updated_at,body) VALUES(?1,?2,?3,?4)').bind(task.id,task.version,task.updatedAt,JSON.stringify(task)).run();
 if(policy)for(const a of assignments){const p=new D1ModelPolicies(db,{now:()=>Date.parse(when)});await p.create({profile:a.selection.profile,baseline:{id:`route-${a.provider}`,provider:a.provider,model:a.requestedModel,modelVersion:null,effort:a.effort},expectedStateVersion:0});}
 return {db,store,parent,children,assignments,pipeline:createReviewObservationPipeline(store)};
}

test('drain recovers an unmarked completed review, records both children once, and leaves a durable result',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.pipeline.drain(),{checked:1,failed:0});
 const parent=await f.store.requireTask('parent');assert.deepEqual(parent.reviewObservation.children.map(x=>x.status),['recorded','recorded']);
 for(const a of f.assignments){const state=await new D1ModelPolicies(f.db).read(a.selection.profile);assert.equal(state.observations.length,1);assert.equal(state.observations[0].modelVersion,null);}
 assert.deepEqual(await f.pipeline.drain(),{checked:0,failed:0});
});

test('missing policy is a terminal child diagnostic and does not fail the completed task',async t=>{
 const f=await fixture(t,{policy:false});await f.pipeline.process('parent');const parent=await f.store.requireTask('parent');
 assert.equal(parent.status,'completed');assert.deepEqual(parent.reviewObservation.children.map(x=>x.status),['policy_missing','policy_missing']);
 assert.deepEqual(await f.pipeline.drain(),{checked:0,failed:0});
});

test('partial recording recovers without duplicating the successful child',async t=>{
 const f=await fixture(t);await f.pipeline.process('parent');const parent=await f.store.requireTask('parent');
 const changed={...parent,version:parent.version+1,reviewObservation:{...parent.reviewObservation,children:parent.reviewObservation.children.map((x,i)=>i===0?{...x,status:'pending'}:x)}};
 await f.db.prepare('UPDATE tasks SET version=?1,body=?2 WHERE id=?3').bind(changed.version,JSON.stringify(changed),'parent').run();
 await f.pipeline.process('parent');const state=await new D1ModelPolicies(f.db).read(f.assignments[0].selection.profile);
 assert.equal(state.observations.length,1);assert.deepEqual((await f.store.requireTask('parent')).reviewObservation.children.map(x=>x.status),['duplicate','recorded']);
});

test('task scoped observation diagnostics are available only through authenticated GET',async t=>{
 const f=await fixture(t,{policy:false});await f.pipeline.process('parent');const worker=createWorker(),env={DB:f.db,ACCESS_TOKEN:'test-secret-01234567890123456789'};
 const url='https://inno.example/api/tasks/parent/review-observations';
 assert.equal((await worker.fetch(new Request(url),env)).status,401);
 const response=await worker.fetch(new Request(url,{headers:{authorization:`Bearer ${env.ACCESS_TOKEN}`}}),env);
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.reviewObservation.children[0].status,'policy_missing');
});

test('a later completed review replaces the old review observation identity atomically',async t=>{
 const f=await fixture(t);await f.pipeline.process('parent');let parent=await f.store.requireTask('parent');
 const reopened={...parent,version:parent.version+1,status:'running',checkpoint:{...parent.checkpoint,executionId:'review-next',generation:2,status:'running'},delegation:{...parent.delegation,state:'reviewing'},messages:[],artifacts:[]};
 await f.db.prepare('UPDATE tasks SET version=?1,body=?2 WHERE id=?3').bind(reopened.version,JSON.stringify(reopened),'parent').run();
 const finished=await f.store.finishExecution('parent',{executionId:'review-next',generation:2,content:'Checked again',reviewReport:reopened.delegation.reviewReport});
 assert.equal(finished.reviewObservation.reviewExecutionId,'review-next');assert.equal(finished.reviewObservation.reviewGeneration,2);
 assert.deepEqual(finished.reviewObservation.children.map(x=>x.status),['pending','pending']);
});

test('delayed old review processing cannot mark a later review with the same child IDs',async t=>{
 const f=await fixture(t);let release,entered;const gate=new Promise(resolve=>{release=resolve});const blocked=new Promise(resolve=>{entered=resolve});let paused=false;
 const wrapped={...f.store,db:f.db,now:f.store.now.bind(f.store),requireTask:async id=>{if(id==='child-0'&&!paused){paused=true;entered();await gate;}return f.store.requireTask(id)},replaceTask:f.store.replaceTask.bind(f.store)};
 const pipeline=createReviewObservationPipeline(wrapped),running=pipeline.process('parent');await blocked;
 const old=await f.store.requireTask('parent');const next={...old,version:old.version+1,checkpoint:{...old.checkpoint,executionId:'review-next',generation:2},reviewObservation:{...old.reviewObservation,reviewExecutionId:'review-next',reviewGeneration:2,children:old.reviewObservation.children.map(x=>({...x,status:'pending'}))}};
 await f.db.prepare('UPDATE tasks SET version=?1,body=?2 WHERE id=?3').bind(next.version,JSON.stringify(next),'parent').run();release();await running;
 assert.deepEqual((await f.store.requireTask('parent')).reviewObservation.children.map(x=>x.status),['pending','pending']);
});

test('drain advances through more than ten completed parents without replaying finished rows',async t=>{
 const f=await fixture(t);for(let i=1;i<=11;i++){
  const original=await f.store.requireTask('parent'),parent=structuredClone(original);parent.id=`parent-${String(i).padStart(2,'0')}`;parent.delegation.children=original.delegation.children.map((x,j)=>({...x,taskId:`child-${i}-${j}`}));
  parent.delegation.review.children=parent.delegation.children.map(x=>({taskId:x.taskId,summary:'checked',artifacts:[]}));parent.delegation.reviewReport=parent.delegation.children.map(x=>({childTaskId:x.taskId,criteria:[{criterion:'correct',status:'pass',evidence:'Checked'}]}));
  const originalChildren=await Promise.all(f.children.map(x=>f.store.requireTask(x.id)));
  const children=originalChildren.map((x,j)=>({...x,id:`child-${i}-${j}`,parentTaskId:parent.id,checkpoint:{...x.checkpoint,executionId:`execution-${i}-${j}`}}));
  for(const task of [parent,...children])await f.db.prepare('INSERT INTO tasks(id,version,updated_at,body) VALUES(?1,?2,?3,?4)').bind(task.id,task.version,task.updatedAt,JSON.stringify(task)).run();
 }
 assert.deepEqual(await f.pipeline.drain(),{checked:10,failed:0});assert.deepEqual(await f.pipeline.drain(),{checked:2,failed:0});assert.deepEqual(await f.pipeline.drain(),{checked:0,failed:0});
});

test('transient policy read failure retries one child after backoff without replaying the sibling',async t=>{
 const f=await fixture(t);let now=Date.parse(when);f.store.now=()=>new Date(now).toISOString();const original=f.db.prepare.bind(f.db);let fail=true;
 f.db.prepare=sql=>{const stmt=original(sql);if(sql==='SELECT value FROM metadata WHERE key=?1'&&fail){fail=false;return {...stmt,first:async()=>{throw Error('temporary D1 failure')}};}return stmt;};
 await f.pipeline.process('parent');let parent=await f.store.requireTask('parent');assert.deepEqual(parent.reviewObservation.children.map(x=>x.status),['retry','recorded']);assert.equal(parent.reviewObservation.children[0].attempts,1);
 assert.deepEqual(await f.pipeline.drain(),{checked:0,failed:0});now+=61_000;assert.deepEqual(await f.pipeline.drain(),{checked:1,failed:0});
 parent=await f.store.requireTask('parent');assert.deepEqual(parent.reviewObservation.children.map(x=>x.status),['recorded','recorded']);
 for(const a of f.assignments)assert.equal((await new D1ModelPolicies(f.db).read(a.selection.profile)).observations.length,1);
});

for(const [name,failureRead] of [['initial child fetch',1],['verifier task fetch',2]])test(`transient ${name} is retried and later records`,async t=>{
 const f=await fixture(t);let count=0,now=Date.parse(when);f.store.now=()=>new Date(now).toISOString();const wrapped=Object.create(f.store);
 wrapped.requireTask=async id=>{if(id==='child-0'&&++count===failureRead)throw Error('D1 temporarily unavailable');return f.store.requireTask(id);};
 const pipeline=createReviewObservationPipeline(wrapped);await pipeline.process('parent');
 assert.deepEqual((await f.store.requireTask('parent')).reviewObservation.children.map(x=>x.status),['retry','recorded']);
 now+=61_000;await pipeline.drain();assert.deepEqual((await f.store.requireTask('parent')).reviewObservation.children.map(x=>x.status),['recorded','recorded']);
});

test('one missing saved profile does not strand the valid sibling or repeat on cron',async t=>{
 const f=await fixture(t);const parent=await f.store.requireTask('parent');delete parent.delegation.children[1].selection.profile;
 parent.reviewObservation={createdAt:when,reviewExecutionId:'review',reviewGeneration:1,batchId:'batch',epoch:1,children:[{childTaskId:'child-0',status:'pending',attempts:0},{childTaskId:'child-1',status:'not_attributable',reason:'saved_profile_missing',attempts:0,nextAt:null}]};
 await f.db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify(parent),'parent').run();
 assert.deepEqual(await f.pipeline.drain(),{checked:1,failed:0});
 const result=(await f.store.requireTask('parent')).reviewObservation.children;assert.deepEqual(result.map(x=>x.status),['recorded','not_attributable']);
 assert.deepEqual(await f.pipeline.drain(),{checked:0,failed:0});
});
