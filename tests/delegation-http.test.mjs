import {executionCapability} from '../worker/execution-scope.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {D1ModelPolicies} from '../worker/model-policies.mjs';
import {delegationProfile} from '../worker/allocation-policy.mjs';
const models=[{model:'gpt-5.6-luna',efforts:['low'],isDefault:false}];
const observedModels=()=>({models,observedAt:Date.now(),status:'fresh'});
const children=['codex','claude'].map(provider=>({role:provider,provider,requestedModel:provider==='codex'?'gpt-5.6-luna':'haiku',effort:'low',sufficientReason:'bounded exact arithmetic',acceptanceCriteria:['equals 4'],instructions:'Return 2+2'}));
async function fixture(t){const db=new TestD1();t.after(()=>db.close());let fires=0;const worker=createWorker({fetchFn:async()=>{fires++;return Response.json({claude_code_session_id:'s',claude_code_session_url:'https://claude.ai/code/s'});}}),env={DB:db,ACCESS_TOKEN:'test-secret-01234567890123456789',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'mock'};const post=async(path,input)=>{const r=await worker.fetch(new Request('https://inno.example'+path,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify(input)}),env);return {status:r.status,...await r.json()};};const mcp=async(name,args)=>post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',executionCapability:await executionCapability(env.ACCESS_TOKEN,{task:{id:args.taskId},executionId:args.executionId,generation:args.generation}),params:{name,arguments:args}});return {db,store:new D1TaskStore(db),post,mcp,fires:()=>fires};}
const owner=c=>({executionId:c.executionId,generation:c.generation});
test('HTTP master allocates, preserves siblings, then reviews once with hydrated generated files',async t=>{
 const f=await fixture(t);await f.post('/api/desktop/poll',{models:observedModels()});const {task}=await f.post('/api/tasks',{prompt:'Compare two independent calculations'});await f.post(`/api/tasks/${task.id}/run`,{provider:'codex',expectedVersion:1});const {claim:master}=await f.post('/api/desktop/poll',{});
 const input={...owner(master),content:'Two checkable roles',delegation:{independent:true,children}};
 for(let i=0;i<2;i++)assert.equal((await f.post(`/api/desktop/${task.id}/complete`,input)).status,200);
 assert.equal(f.fires(),1);const parent=await f.store.requireTask(task.id);const claude=await f.store.requireTask(parent.delegation.children.find(c=>c.provider==='claude').taskId);
 const done=await f.mcp('checkpoint_task',{taskId:claude.id,executionId:claude.checkpoint.executionId,generation:claude.checkpoint.generation,content:'4',status:'completed'});assert.equal(done.result.isError,undefined);
 const {claim:child}=await f.post('/api/desktop/poll',{});assert.equal(child.task.parentTaskId,task.id);
 const childResult={...owner(child),content:'4',artifacts:[{name:'answer.txt',mime:'text/plain',encoding:'utf-8',content:'4'}]};
 for(let i=0;i<2;i++)assert.equal((await f.post(`/api/desktop/${child.task.id}/complete`,childResult)).status,200);
 const {claim:review}=await f.post('/api/desktop/poll',{});assert.equal(review.task.id,task.id);assert.equal(review.reviewInputs.length,2);assert.equal(review.reviewInputs.find(c=>c.taskId===child.task.id).artifacts[0].content,'4');
 const report=parent.delegation.children.map(c=>({childTaskId:c.taskId,criteria:[{criterion:'equals 4',status:'pass',evidence:'Recomputed 2+2=4'}]}));
 for(let i=0;i<2;i++)assert.equal((await f.post(`/api/desktop/${task.id}/complete`,{...owner(review),content:'Both equal 4',reviewReport:report})).status,200);
 const finished=await f.store.requireTask(task.id);assert.equal(finished.status,'completed');assert.deepEqual(finished.reviewObservation.children.map(x=>x.status),['policy_missing','policy_missing']);assert.equal(f.fires(),1);assert.equal((await f.post('/api/desktop/poll',{})).claim,null);
});
test('catalog rejects unsupported assignments before starting either child',async t=>{const f=await fixture(t);const {task}=await f.post('/api/tasks',{prompt:'plan'});const claim=await f.store.claimExecution(task.id,{provider:'claude',expectedVersion:1});const result=await f.mcp('delegate_task',{taskId:task.id,...owner(claim),independent:true,children});assert.equal(result.result.isError,true);assert.equal((await f.store.requireTask(task.id)).status,'running');assert.equal(f.fires(),0);});
async function reviewing(t){const f=await fixture(t);await f.post('/api/desktop/poll',{models:observedModels()});const {task}=await f.post('/api/tasks',{prompt:'independent checks'});await f.post(`/api/tasks/${task.id}/run`,{provider:'codex',expectedVersion:1});const {claim}=await f.post('/api/desktop/poll',{});await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),content:'planned',delegation:{independent:true,children}});let parent=await f.store.requireTask(task.id);for(const assignment of parent.delegation.children){let child=await f.store.requireTask(assignment.taskId);const c=child.status==='running'?owner(child.checkpoint):owner((await f.post('/api/desktop/poll',{})).claim);await f.post(`/api/desktop/${child.id}/complete`,{...c,content:'4'});}const {claim:review}=await f.post('/api/desktop/poll',{});return {...f,parent,review};}
test('failed review delivery replays without rerunning the successful sibling',async t=>{const f=await reviewing(t);const report=f.parent.delegation.children.map((c,i)=>({childTaskId:c.taskId,criteria:[{criterion:'equals 4',status:i===0?'fail':'pass',evidence:i===0?'wrong formatting':'recomputed 4'}]}));const input={...owner(f.review),content:'Needs correction',reviewReport:report};for(let i=0;i<2;i++)assert.equal((await f.post(`/api/desktop/${f.parent.id}/complete`,input)).status,200);const parent=await f.store.requireTask(f.parent.id);assert.equal(parent.delegation.retryCount,1);assert.equal((await f.store.requireTask(parent.delegation.children[1].taskId)).status,'completed');assert.equal(f.fires(),1);});
test('unverifiable review persists evidence and replay returns the same decision',async t=>{const f=await reviewing(t);const report=f.parent.delegation.children.map(c=>({childTaskId:c.taskId,criteria:[{criterion:'equals 4',status:'unverifiable',evidence:'Independent source missing'}]}));const input={...owner(f.review),content:'Cannot verify',reviewReport:report};const first=await f.post(`/api/desktop/${f.parent.id}/complete`,input);assert.equal(first.status,200);assert.equal(first.task.status,'waiting_user');assert.deepEqual(first.task.delegation.reviewReport,report);const second=await f.post(`/api/desktop/${f.parent.id}/complete`,input);assert.equal(second.status,200);assert.equal(second.task.version,first.task.version);});
test('HTTP recovery requires explicit stopped confirmation and retains completed child',async t=>{const f=await fixture(t);await f.post('/api/desktop/poll',{models:observedModels()});const parent=await f.store.createTask({prompt:'checks'}),master=await f.store.claimExecution(parent.id,{provider:'codex',expectedVersion:1});const allocated=await f.post(`/api/desktop/${parent.id}/complete`,{...owner(master),content:'plan',delegation:{independent:true,children}});const claude=await f.store.requireTask(allocated.task.delegation.children[1].taskId);await f.store.markExecutionUncertain(claude.id,{...owner(claude.checkpoint),reason:'uncertain_fire'});let p=await f.store.requireTask(parent.id),c=await f.store.requireTask(claude.id);const input={expectedVersion:p.version,childTaskId:c.id,expectedChildVersion:c.version};assert.equal((await f.post(`/api/tasks/${p.id}/delegation/recover`,input)).status,400);assert.equal((await f.post(`/api/tasks/${p.id}/delegation/recover`,{...input,confirmedStopped:true})).status,200);assert.equal(f.fires(),2);});
test('legacy desktop model arrays cannot authorize HTTP delegation',async t=>{
 const f=await fixture(t);assert.equal((await f.post('/api/desktop/poll',{models})).status,200);
 const {task}=await f.post('/api/tasks',{prompt:'legacy desktop check'});
 const claim=await f.store.claimExecution(task.id,{provider:'codex',expectedVersion:1});
 const denied=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),content:'plan',delegation:{independent:true,children}});
 assert.equal(denied.status,400);assert.match(JSON.stringify(denied),/Reconnect desktop.*Codex model/i);
 assert.equal((await f.store.requireTask(task.id)).status,'running');assert.equal(f.fires(),0);
});

test('authenticated child policy management derives its baseline and keeps null-version allocation usable',async t=>{
 const f=await fixture(t),observedAt=Date.now();await f.post('/api/desktop/poll',{models:{models,observedAt,status:'fresh'}});
 const {task,claim}=await claimMaster(f);
 const allocated=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:{independent:true,children}});
 assert.equal(allocated.status,200);
 const child=allocated.task.delegation.children.find(x=>x.provider==='codex');
 const path=`/api/tasks/${child.taskId}/model-policy`;
 const before=await f.post(path,{operation:'initialize',expectedStateVersion:0,modelVersion:'forged'});
 assert.equal(before.status,400);
 const initialized=await f.post(path,{operation:'initialize',expectedStateVersion:0});
 assert.equal(initialized.status,200);
 assert.equal(initialized.policy.baseline.model,child.requestedModel);
 assert.equal(initialized.policy.baseline.modelVersion,null);
 assert.equal(initialized.policy.observationCount,0);
 const read=await createWorker().fetch(new Request('https://inno.example'+path,{headers:{authorization:'Bearer test-secret-01234567890123456789'}}),{DB:f.db,ACCESS_TOKEN:'test-secret-01234567890123456789'});
 assert.equal(read.status,200);
 const current=await read.json();assert.equal(current.profile.family,'delegation_codex');
 assert.equal(current.route.status,'fallback');assert.equal(current.route.reason,'baseline_version_unverified');
 assert.equal(current.accountAvailability.provider,'codex');
 assert.deepEqual(current.accountAvailability,{provider:'codex',source:'desktop_account_catalog',status:'fresh',observedAt,expiresAt:observedAt+7_200_000,effortSource:'account_catalog',models:[{model:'gpt-5.6-luna',efforts:['low']}]});
 const claude=allocated.task.delegation.children.find(x=>x.provider==='claude');
 const claudeRead=await createWorker().fetch(new Request(`https://inno.example/api/tasks/${claude.taskId}/model-policy`,{headers:{authorization:'Bearer test-secret-01234567890123456789'}}),{DB:f.db,ACCESS_TOKEN:'test-secret-01234567890123456789'});
 assert.deepEqual((await claudeRead.json()).accountAvailability,{provider:'claude',source:'built_in_catalog',status:'static_supported_models_unverified',observedAt:null,expiresAt:null,effortSource:'assignment_planning_intent',models:['haiku','sonnet','opus'].map(model=>({model,efforts:['low']}))});
 assert.equal((await f.post(`/api/tasks/${task.id}/model-policy`,{operation:'initialize',expectedStateVersion:0})).status,400);
 const next=await claimMaster(f);
 const second=await f.post(`/api/desktop/${next.task.id}/complete`,{...owner(next.claim),delegation:{independent:true,children}});
 assert.equal(second.status,200,JSON.stringify(second));
 assert.equal(second.task.delegation.children.find(x=>x.provider==='codex').selection.reason,'baseline_version_unverified');
});
test('HTTP pin controls only the active null-version baseline and preserves frozen assignments',async t=>{
 const f=await fixture(t);await f.post('/api/desktop/poll',{models:observedModels()});
 const {task,claim}=await claimMaster(f);
 const allocated=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:{independent:true,children}});
 const child=allocated.task.delegation.children.find(x=>x.provider==='codex'),path=`/api/tasks/${child.taskId}/model-policy`;
 const frozen=structuredClone((await f.store.requireTask(child.taskId)).assignment);
 assert.equal((await f.post(path,{operation:'initialize',expectedStateVersion:0})).status,200);
 for(const extra of [{model:'gpt-5.6-luna'},{modelVersion:'v9'},{quality:{critical:false}},{availability:true}])assert.equal((await f.post(path,{operation:'pin',candidateId:'baseline',expectedStateVersion:1,...extra})).status,400);
 assert.equal((await f.post(path,{operation:'pin',candidateId:'other',expectedStateVersion:1})).status,400);
 const pinned=await f.post(path,{operation:'pin',candidateId:'baseline',expectedStateVersion:1});
 assert.equal(pinned.status,200);assert.equal(pinned.reason,'manual_pin_set');
 assert.deepEqual(pinned.policy.pin,{candidateId:'baseline'});
 assert.equal(pinned.policy.policyVersion,1);assert.equal(pinned.policy.stateVersion,2);
 assert.equal(pinned.route.candidateId,'baseline');assert.equal(pinned.route.reason,'baseline_version_unverified');
 assert.equal((await f.post(path,{operation:'unpin',expectedStateVersion:1})).status,409);
 assert.equal((await f.post(path,{operation:'unpin',expectedStateVersion:2,candidateId:'baseline'})).status,400);
 const next=await claimMaster(f),allocatedNext=await f.post(`/api/desktop/${next.task.id}/complete`,{...owner(next.claim),delegation:{independent:true,children}});
 assert.equal(allocatedNext.status,200,JSON.stringify(allocatedNext));
 assert.equal(allocatedNext.task.delegation.children.find(x=>x.provider==='codex').selection.reason,'baseline_version_unverified');
 const unpinned=await f.post(path,{operation:'unpin',expectedStateVersion:2});
 assert.equal(unpinned.status,200);assert.equal(unpinned.reason,'manual_pin_cleared');assert.equal(unpinned.policy.pin,null);
 assert.deepEqual((await f.store.requireTask(child.taskId)).assignment,frozen);
});
test('policy choices retain a valid last-good observation after refresh failure and clear on expiry',async t=>{
 const f=await fixture(t),observedAt=Date.now();await f.post('/api/desktop/poll',{models:{models,observedAt,status:'fresh'}});
 const {task,claim}=await claimMaster(f);
 const allocated=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:{independent:true,children}});
 const child=allocated.task.delegation.children.find(x=>x.provider==='codex'),path=`/api/tasks/${child.taskId}/model-policy`;
 const read=async()=>{const response=await createWorker().fetch(new Request('https://inno.example'+path,{headers:{authorization:'Bearer test-secret-01234567890123456789'}}),{DB:f.db,ACCESS_TOKEN:'test-secret-01234567890123456789'});assert.equal(response.status,200);return (await response.json()).accountAvailability;};
 await f.post('/api/desktop/poll',{models:{models:[],observedAt,status:'unavailable'}});
 const failed=await read();assert.equal(failed.status,'refresh_failed');assert.equal(failed.observedAt,observedAt);assert.equal(failed.expiresAt,observedAt+7_200_000);assert.deepEqual(failed.models,[{model:'gpt-5.6-luna',efforts:['low']}]);
 await f.db.prepare("UPDATE metadata SET value=json_set(value,'$.reportedAt',?1) WHERE key='desktop_models'").bind(Date.now()-7_200_001).run();
 const expired=await read();assert.equal(expired.status,'expired');assert.deepEqual(expired.models,[]);assert.equal(expired.expiresAt,expired.observedAt+7_200_000);
 assert.equal((await f.post(path,{operation:'withdraw',expectedStateVersion:0,candidateId:'baseline'})).status,404);
});
test('worker state advertises model policy management on full and unchanged responses',async t=>{
 const f=await fixture(t),worker=createWorker(),env={DB:f.db,ACCESS_TOKEN:'test-secret-01234567890123456789'};
 const get=async path=>{const response=await worker.fetch(new Request('https://inno.example'+path,{headers:{authorization:'Bearer '+env.ACCESS_TOKEN}}),env);assert.equal(response.status,200);return response.json();};
 const first=await get('/api/state');assert.equal(first.capabilities.modelPolicyManagement,true);
 const unchanged=await get(`/api/state?since=${first.revision}`);assert.equal(unchanged.unchanged,true);assert.equal(unchanged.capabilities.modelPolicyManagement,true);
});

test('child policy operations reject forged inputs and stale writes while preserving frozen assignments',async t=>{
 const f=await fixture(t);await f.post('/api/desktop/poll',{models:{models:[...models,{model:'gpt-next',efforts:['low']}],observedAt:Date.now(),status:'fresh'}});
 const {task,claim}=await claimMaster(f);
 const allocated=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:{independent:true,children}});
 const child=allocated.task.delegation.children.find(x=>x.provider==='codex'),path=`/api/tasks/${child.taskId}/model-policy`;
 const unauthorized=await createWorker().fetch(new Request('https://inno.example'+path),{DB:f.db,ACCESS_TOKEN:'test-secret-01234567890123456789'});
 assert.equal(unauthorized.status,401);
 assert.equal((await f.post(path,{operation:'initialize',expectedStateVersion:0})).status,200);
 assert.equal((await f.post(path,{operation:'register_candidate',expectedStateVersion:1,candidate:{id:'next',model:'gpt-next',effort:'low',modelVersion:'fake'}})).status,400);
 assert.equal((await f.post(path,{operation:'register_candidate',expectedStateVersion:1,candidate:{id:'next',model:'not-in-account',effort:'low'}})).status,400);
 const registered=await f.post(path,{operation:'register_candidate',expectedStateVersion:1,candidate:{id:'next',model:'gpt-next',effort:'low'}});
 assert.equal(registered.status,200);assert.equal(registered.policy.candidates.find(x=>x.id==='next').modelVersion,null);
 assert.equal((await f.post(path,{operation:'register_candidate',expectedStateVersion:1,candidate:{id:'other',model:'gpt-next',effort:'low'}})).status,409);
 const promotion=await f.post(path,{operation:'promote',expectedStateVersion:2,candidateId:'next'});
 assert.equal(promotion.status,200);assert.equal(promotion.reason,'unobserved_model_version');
 const withdrawn=await f.post(path,{operation:'withdraw',expectedStateVersion:2,candidateId:'next'});
 assert.equal(withdrawn.status,200);assert.equal(withdrawn.reason,'withdrawn');
 assert.deepEqual((await f.store.requireTask(child.taskId)).assignment,(({taskId,...rest})=>rest)(child));
});

async function seededPolicy(f,{promote=true}={}){
 const now=Date.now(),profile=await delegationProfile(children[0]);
 const baseline={id:'baseline',provider:'codex',model:'gpt-5.6-luna',modelVersion:'v1',effort:'low'};
 const candidate={id:'candidate',provider:'codex',model:'gpt-next',modelVersion:'v2',effort:'low'};
 const availability=[baseline,candidate].map(x=>({source:'account_catalog',provider:'codex',model:x.model,modelVersion:x.modelVersion,efforts:['low'],capabilities:['text'],contextClasses:[profile.contextClass],observedAt:now,expiresAt:now+3_600_000}));
 await f.db.prepare("INSERT INTO metadata(key,value) VALUES('model_policy_availability',?1)").bind(JSON.stringify(availability)).run();
 const policies=new D1ModelPolicies(f.db,{now:()=>Date.now(),getAvailability:()=>availability,verifyObservation:ref=>ref});
 let state=await policies.create({profile,baseline,expectedStateVersion:0});
 state=await policies.register({profile,candidate,expectedStateVersion:state.stateVersion});
 for(let i=0;i<3;i++)for(const route of [baseline,candidate]){
  const observation={id:`${route.id}${i}`,provider:'codex',executionId:`fixture-${route.id}-${i}`,generation:1,candidateId:route.id,modelVersion:route.modelVersion,comparisonId:`pair${i}`,profile,observedAt:now,source:'normal_execution',quality:{source:'independent_review',critical:false,criteria:profile.criteria.map(id=>({id,status:'pass'}))},usage:{source:'executor_report',inputTokens:route.id==='baseline'?100:50,outputTokens:20,latencyMs:route.id==='baseline'?1000:500}};
  state=(await policies.observe({profile,evidenceRef:observation,expectedStateVersion:state.stateVersion})).state;
 }
 if(promote)state=(await policies.promote({profile,candidateId:'candidate',expectedStateVersion:state.stateVersion})).state;
 return {policies,profile,state,availability};
}
async function claimMaster(f){const {task}=await f.post('/api/tasks',{prompt:'two exact calculations'});const claim=await f.store.claimExecution(task.id,{provider:'codex',expectedVersion:1});return {task,claim};}
test('HTTP policy selection is frozen on both task records and replay ignores changed policy',async t=>{
 const f=await fixture(t);await f.post('/api/desktop/poll',{models:{models:[...models,{model:'gpt-next',efforts:['low']}],observedAt:Date.now(),status:'fresh'}});
 const seeded=await seededPolicy(f),{task,claim}=await claimMaster(f);
 const input={...owner(claim),independent:true,children:children.map(x=>({...x,selection:{status:'selected',evidenceIds:['forged']},policyVersion:999,evidenceIds:['forged']}))};
 const first=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:input});assert.equal(first.status,200);
 const selected=first.task.delegation.children.find(x=>x.provider==='codex');assert.equal(selected.requestedModel,'gpt-next');assert.equal(selected.selection.status,'selected');assert.equal(selected.selection.policyVersion,seeded.state.policyVersion);assert.equal(selected.selection.evidenceIds.includes('forged'),false);
 assert.deepEqual((await f.store.requireTask(selected.taskId)).assignment,((await f.store.requireTask(task.id)).delegation.children.find(x=>x.taskId===selected.taskId)&&(({taskId,...a})=>a)(selected)));
 await seeded.policies.withdraw({profile:seeded.profile,candidateId:'candidate',expectedStateVersion:seeded.state.stateVersion});
 const replay=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:input});assert.equal(replay.status,200);assert.deepEqual(replay.task.delegation.children,first.task.delegation.children);
});
test('HTTP missing policy records unvalidated fallback; expired account rejects allocation',async t=>{
 const f=await fixture(t);await f.post('/api/desktop/poll',{models:observedModels()});const {task,claim}=await claimMaster(f);
 const result=await f.mcp('delegate_task',{taskId:task.id,...owner(claim),independent:true,children});assert.equal(result.result.isError,undefined);
 const saved=await f.store.requireTask(task.id);assert.equal(saved.delegation.children[0].selection.status,'fallback');assert.equal(saved.delegation.children[0].selection.reason,'policy_missing_evidence_insufficient');assert.equal(saved.delegation.children[0].selection.policyVersion,null);
 const g=await fixture(t);await g.post('/api/desktop/poll',{models:{models,observedAt:Date.now()-7_200_001,status:'fresh'}});const second=await claimMaster(g);const denied=await g.mcp('delegate_task',{taskId:second.task.id,...owner(second.claim),independent:true,children});assert.equal(denied.result.isError,true);assert.equal((await g.store.requireTask(second.task.id)).status,'running');
});
test('withdrawn or expired promoted route gives a new HTTP batch the verified baseline',async t=>{
 for(const mode of ['withdrawn','expired']){
  const f=await fixture(t);await f.post('/api/desktop/poll',{models:{models:[...models,{model:'gpt-next',efforts:['low']}],observedAt:Date.now(),status:'fresh'}});
  const seeded=await seededPolicy(f);
  if(mode==='withdrawn')await seeded.policies.withdraw({profile:seeded.profile,candidateId:'candidate',expectedStateVersion:seeded.state.stateVersion});
  else await f.db.prepare("UPDATE metadata SET value=?1 WHERE key='model_policy_availability'").bind(JSON.stringify(seeded.availability.map(row=>row.model==='gpt-next'?{...row,expiresAt:Date.now()-1}:row))).run();
  const {task,claim}=await claimMaster(f);const result=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:{independent:true,children}});
  assert.equal(result.status,200);const route=result.task.delegation.children.find(x=>x.provider==='codex');assert.equal(route.requestedModel,'gpt-5.6-luna');assert.equal(route.selection.status,'fallback');assert.equal(route.selection.evidenceIds.length,0);
 }
});
test('policy withdrawal during the allocation CAS recomputes before creating children',async t=>{
 const f=await fixture(t);await f.post('/api/desktop/poll',{models:{models:[...models,{model:'gpt-next',efforts:['low']}],observedAt:Date.now(),status:'fresh'}});
 const seeded=await seededPolicy(f),{task,claim}=await claimMaster(f),originalBatch=f.db.batch.bind(f.db);let raced=false;
 f.db.batch=async statements=>{
  if(!raced&&statements[0]?.sql?.startsWith('UPDATE tasks SET version')){raced=true;await seeded.policies.withdraw({profile:seeded.profile,candidateId:'candidate',expectedStateVersion:seeded.state.stateVersion});}
  return originalBatch(statements);
 };
 const result=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:{independent:true,children}});
 assert.equal(result.status,200);assert.equal(raced,true);const saved=result.task.delegation.children.find(x=>x.provider==='codex');assert.equal(saved.requestedModel,'gpt-5.6-luna');assert.equal(saved.selection.status,'fallback');
 assert.equal((await f.store.requireTask(saved.taskId)).assignment.selection.status,'fallback');
});
test('policy pin during allocation CAS forces a fresh guarded attempt',async t=>{
 const f=await fixture(t);await f.post('/api/desktop/poll',{models:{models:[...models,{model:'gpt-next',efforts:['low']}],observedAt:Date.now(),status:'fresh'}});
 const seeded=await seededPolicy(f),{task,claim}=await claimMaster(f),originalBatch=f.db.batch.bind(f.db);let attempts=0,firstChanges=null;
 f.db.batch=async statements=>{
  if(statements[0]?.sql?.includes("json_extract(m.value,'$.stateVersion')")){
   attempts++;
   if(attempts===1)await seeded.policies.pin({profile:seeded.profile,candidateId:'candidate',expectedStateVersion:seeded.state.stateVersion});
  }
  const result=await originalBatch(statements);
  if(attempts===1&&firstChanges===null&&statements[0]?.sql?.includes("json_extract(m.value,'$.stateVersion')"))firstChanges=result[0]?.meta?.changes;
  return result;
 };
 const result=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:{independent:true,children}});
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(firstChanges,0);assert.ok(attempts>=2);
 assert.deepEqual((await seeded.policies.read(seeded.profile)).pin,{candidateId:'candidate'});
 assert.equal(result.task.delegation.children.find(x=>x.provider==='codex').requestedModel,'gpt-next');
});
test('proof expiring inside the D1 batch cannot commit selected or fallback policy routes',async t=>{
 for(const mode of ['selected','fallback']){
  const f=await fixture(t);await f.post('/api/desktop/poll',{models:{models:[...models,{model:'gpt-next',efforts:['low']}],observedAt:Date.now(),status:'fresh'}});
  const seeded=await seededPolicy(f);
  if(mode==='fallback')await seeded.policies.withdraw({profile:seeded.profile,candidateId:'candidate',expectedStateVersion:seeded.state.stateVersion});
  const expiring=mode==='selected'?'gpt-next':'gpt-5.6-luna';
  await f.db.prepare("UPDATE metadata SET value=?1 WHERE key='model_policy_availability'").bind(JSON.stringify(seeded.availability.map(row=>row.model===expiring?{...row,expiresAt:Date.now()+500}:row))).run();
  const {task,claim}=await claimMaster(f),originalBatch=f.db.batch.bind(f.db);let draft;
  f.db.batch=async statements=>{
   if(!draft&&statements[0]?.sql?.startsWith('UPDATE tasks SET version')){
    draft=JSON.parse(statements[0].values[2]).delegation.children.find(x=>x.provider==='codex').requestedModel;
    await new Promise(resolve=>setTimeout(resolve,650));
   }
   return originalBatch(statements);
  };
  const result=await f.post(`/api/desktop/${task.id}/complete`,{...owner(claim),delegation:{independent:true,children}});
  assert.equal(draft,expiring);
  if(mode==='selected'){
   assert.equal(result.status,200);assert.equal(result.task.delegation.children.find(x=>x.provider==='codex').requestedModel,'gpt-5.6-luna');
  }else{
   assert.equal(result.status,400);assert.equal((await f.store.requireTask(task.id)).status,'running');
   assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE json_extract(body,'$.parentTaskId')=?1").bind(task.id).first()).n,0);
  }
 }
});
