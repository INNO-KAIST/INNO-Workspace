import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {profileKey} from '../worker/model-policies.mjs';
import {delegationProfile,resolveAllocationPolicy,unverifiedBaselineReason,unverifiedBaselineRoute} from '../worker/allocation-policy.mjs';
import {createSelectionState,registerCandidate,recordObservation,promoteCandidate,withdrawCandidate,selectAssignment,pinCandidate} from '../public/core/model-selection.mjs';

const now=1_800_000_000_000;
const profile={family:'delegation_codex',requirementsVersion:'r1',evaluationVersion:'e1',criteria:['correct'],requiredCapabilities:['text'],contextClass:'text_1_sources_0'};
const base={id:'base',provider:'codex',model:'gpt-5.6-terra',modelVersion:null,effort:'high'};
const next={id:'next',provider:'codex',model:'gpt-5.6-luna',modelVersion:null,effort:'low'};
const third={id:'third',provider:'codex',model:'gpt-5.6-terra',modelVersion:null,effort:'low'};
const routes={base,next,third};
const CONDITIONS='e'.repeat(64);
const exposure=(at=now,rows=[['gpt-5.6-terra',['high','low']],['gpt-5.6-luna',['low']]])=>rows.map(([model,efforts])=>({source:'account_exposure',provider:'codex',model,modelVersion:null,efforts,observedAt:at,expiresAt:at+7_200_000}));
const tokens={base:100,next:70,third:50};
const routeRow=(id,candidateId,comparisonId,opts={})=>{
 const route=routes[candidateId];
 return {id,provider:'codex',executionId:`execution-${id}`,generation:1,candidateId,modelVersion:null,route:{basis:'cli_arguments',model:route.model,effort:route.effort,conditions:CONDITIONS},comparisonId,profile,observedAt:now,source:'normal_execution',quality:{source:'independent_review',critical:false,criteria:[{id:'correct',status:'pass'}]},usage:{source:'executor_report',inputTokens:tokens[candidateId],outputTokens:20,latencyMs:candidateId==='base'?1000:800},...opts};
};
const fresh=()=>registerCandidate(createSelectionState({profile,baseline:base}),next);
const record=(state,row)=>recordObservation(state,row,{now}).state;
function paired(state,{left='base',right='next',prefix='p',count=3,rightOpts={}}={}){
 for(let i=0;i<count;i++){state=record(state,routeRow(`${prefix}${left}${i}`,left,`${prefix}${i}`));state=record(state,routeRow(`${prefix}${right}${i}`,right,`${prefix}${i}`,rightOpts));}
 return state;
}
const promoted=()=>promoteCandidate(paired(fresh()),'next',{now,availability:exposure()}).state;

test('route evidence promotes an unversioned candidate and selection uses it through account exposure',()=>{
 const result=promoteCandidate(paired(fresh()),'next',{now,availability:exposure()});
 assert.equal(result.promoted,true);assert.equal(result.reason,'profile_scoped_evidence');assert.equal(result.state.policyVersion,2);
 const choice=selectAssignment(result.state,{profile,availability:exposure(),now});
 assert.equal(choice.status,'selected');assert.equal(choice.model,'gpt-5.6-luna');assert.equal(choice.effort,'low');assert.equal(choice.modelVersion,null);assert.equal(choice.evidenceIds.length,6);
 assert.equal(selectAssignment(result.state,{profile,availability:[],now}).status,'wait');
 assert.equal(promoteCandidate(paired(fresh()),'next',{now,availability:[]}).reason,'candidate_unavailable');
});

test('account exposure never changes how the unverified baseline is chosen',()=>{
 const state=fresh(),choice=selectAssignment(state,{profile,availability:exposure(),now});
 assert.equal(choice.status,'wait');
 assert.equal(unverifiedBaselineRoute(state,choice,'codex')?.id,'base');
});

test('route pairs need the same comparison and run conditions, and route-less rows never pair',()=>{
 assert.equal(promoteCandidate(paired(fresh(),{rightOpts:{route:{basis:'cli_arguments',model:'gpt-5.6-luna',effort:'low',conditions:'f'.repeat(64)}}}),'next',{now,availability:exposure()}).reason,'insufficient_comparable_evidence');
 let legacy=fresh();
 for(let i=0;i<3;i++){const b=routeRow(`lb${i}`,'base',`l${i}`),c=routeRow(`lc${i}`,'next',`l${i}`);delete b.route;delete c.route;legacy=record(record(legacy,b),c);}
 assert.equal(promoteCandidate(legacy,'next',{now,availability:exposure()}).reason,'unobserved_model_version');
 let mixed=fresh();
 for(let i=0;i<3;i++){const b=routeRow(`mb${i}`,'base',`m${i}`);delete b.route;mixed=record(record(mixed,b),routeRow(`mc${i}`,'next',`m${i}`));}
 assert.equal(promoteCandidate(mixed,'next',{now,availability:exposure()}).reason,'insufficient_comparable_evidence');
 let repeated=fresh();
 for(let i=0;i<3;i++)repeated=record(record(repeated,routeRow(`rb${i}`,'base','same')),routeRow(`rc${i}`,'next','same'));
 assert.equal(promoteCandidate(repeated,'next',{now,availability:exposure()}).reason,'insufficient_comparable_evidence');
});

test('unversioned availability is fresh account exposure only, never a capability claim',()=>{
 const state=paired(fresh());
 const catalogRow=exposure().map(row=>({...row,source:'account_catalog',capabilities:['text'],contextClasses:['text_1_sources_0']}));
 for(const rows of [exposure(now-3*3_600_000),catalogRow,exposure(now,[['gpt-5.6-luna',['high']]]),exposure().map(row=>({...row,expiresAt:row.observedAt+3*3_600_000})),exposure().map(row=>({...row,provider:'claude'}))])
  assert.equal(promoteCandidate(state,'next',{now,availability:rows}).reason,'candidate_unavailable');
});

test('a new route must also beat the promoted current route on directly comparable evidence',()=>{
 let state=registerCandidate(promoted(),third);
 state=paired(state,{right:'third',prefix:'q'});
 assert.equal(promoteCandidate(state,'third',{now,availability:exposure()}).reason,'insufficient_current_route_evidence');
 state=paired(state,{left:'next',right:'third',prefix:'q'});
 const result=promoteCandidate(state,'third',{now,availability:exposure()});
 assert.equal(result.promoted,true);
 const promotedThird=result.state.candidates.find(row=>row.id==='third');
 assert.equal(promotedThird.comparedWithId,'next');
 assert.equal(new Set(promotedThird.evidenceIds).size,promotedThird.evidenceIds.length);
 assert.ok(promotedThird.evidenceIds.includes('qnext0'));
 const choice=selectAssignment(result.state,{profile,availability:exposure(),now});
 assert.equal(choice.status,'selected');assert.equal(choice.candidateId,'third');
 let costly=registerCandidate(promoted(),third);
 costly=paired(paired(costly,{right:'third',prefix:'k'}),{left:'next',right:'third',prefix:'j',rightOpts:{usage:{source:'executor_report',inputTokens:80,outputTokens:20,latencyMs:800}}});
 assert.equal(promoteCandidate(costly,'third',{now,availability:exposure()}).reason,'no_measured_efficiency_gain');
});

test('withdrawing a route-promoted candidate restores the unverified baseline for later assignments',()=>{
 const restored=withdrawCandidate(promoted(),'next',{now,availability:[]});
 assert.equal(restored.reason,'restored_previous');
 assert.equal(restored.state.activeId,'base');assert.equal(restored.state.previousId,null);assert.equal(restored.state.policyVersion,3);
 const choice=selectAssignment(restored.state,{profile,availability:exposure(),now});
 assert.equal(choice.status,'wait');
 assert.equal(unverifiedBaselineRoute(restored.state,choice,'codex')?.id,'base');
 assert.equal(pinCandidate(restored.state,'base',{now,availability:exposure(),allowUnverifiedBaseline:true}).pinned,true);
 const regressed=recordObservation(promoted(),routeRow('critical','next','late',{quality:{source:'independent_review',critical:true,criteria:[{id:'correct',status:'fail'}]}}),{now,availability:[]});
 assert.equal(regressed.reason,'critical_regression');assert.equal(regressed.state.activeId,'base');
});

const child={role:'codex',provider:'codex',requestedModel:'gpt-5.6-terra',effort:'high',sufficientReason:'bounded independent work',acceptanceCriteria:['answer checked'],instructions:'Check the answer'};
async function allocationFixture(t,{state:build,availability='fresh',accountModels}){
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db),at=Date.parse('2026-10-05T00:00:00.000Z');
 store.now=()=>new Date(at).toISOString();
 const reportedAt=at-1000,models=accountModels??[{model:'gpt-5.6-terra',efforts:['high','low']},{model:'gpt-5.6-luna',efforts:['low']}];
 const catalog={read:async()=>({codex:availability==='fresh'?models:[],lastGoodCodex:models,claude:['haiku'],availability,reportedAt}),validate:async routes=>{if(availability!=='fresh')throw Error('account catalog unavailable');for(const route of routes)if(!models.some(m=>m.model===route.requestedModel&&m.efforts.includes(route.effort)))throw Error('unsupported account route');}};
 await db.prepare("INSERT INTO metadata(key,value) VALUES('desktop_models',?1)").bind(JSON.stringify({models,reportedAt,refreshStatus:availability==='fresh'?'fresh':'unavailable'})).run();
 const childProfile=await delegationProfile(child),shift=row=>({...row,profile:childProfile,observedAt:reportedAt,quality:{...row.quality,criteria:childProfile.criteria.map(id=>({id,status:'pass'}))}});
 let state=registerCandidate(createSelectionState({profile:childProfile,baseline:base}),next);
 for(let i=0;i<3;i++){state=recordObservation(state,shift(routeRow(`b${i}`,'base',`p${i}`)),{now:at}).state;state=recordObservation(state,shift(routeRow(`c${i}`,'next',`p${i}`)),{now:at}).state;}
 state=promoteCandidate(state,'next',{now:at,availability:exposure(reportedAt)}).state;
 assert.equal(state.activeId,'next');
 if(build)state=build(state,{at,reportedAt});
 await db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(await profileKey(childProfile),JSON.stringify(state)).run();
 return {store,catalog,reportedAt};
}

test('allocation assigns a route-promoted candidate only while the account still exposes it',async t=>{
 const f=await allocationFixture(t,{});
 const {assignments,guards}=await resolveAllocationPolicy(f.store,f.catalog,[child]);
 assert.equal(assignments[0].requestedModel,'gpt-5.6-luna');assert.equal(assignments[0].effort,'low');
 assert.equal(assignments[0].selection.status,'selected');assert.equal(assignments[0].selection.modelVersion,null);assert.equal(assignments[0].selection.evidenceIds.length,6);
 assert.ok(guards.some(guard=>guard.key==='model_policy_availability'&&guard.expiresAt===f.reportedAt+7_200_000));
 const stale=await allocationFixture(t,{availability:'expired'});
 // Without a fresh account list the baseline cannot be re-checked either, so nothing is assigned.
 await assert.rejects(resolveAllocationPolicy(stale.store,stale.catalog,[child]),/account catalog unavailable/);
});

test('allocation falls back to the unverified baseline when the account stops exposing the promoted route',async t=>{
 const f=await allocationFixture(t,{accountModels:[{model:'gpt-5.6-terra',efforts:['high','low']}]});
 const {assignments}=await resolveAllocationPolicy(f.store,f.catalog,[child]);
 assert.equal(assignments[0].requestedModel,'gpt-5.6-terra');assert.equal(assignments[0].effort,'high');
 assert.equal(assignments[0].selection.status,'fallback');assert.equal(assignments[0].selection.reason,'active_route_not_current');
});

test('a pinned route-promoted candidate waits instead of silently switching to the baseline',async t=>{
 const f=await allocationFixture(t,{accountModels:[{model:'gpt-5.6-terra',efforts:['high','low']}],state:(state,{at,reportedAt})=>pinCandidate(state,'next',{now:at,availability:exposure(reportedAt)}).state});
 await assert.rejects(resolveAllocationPolicy(f.store,f.catalog,[child]),/No fresh eligible policy route/);
});

test('allocation returns to the unverified baseline after the route-promoted candidate is withdrawn',async t=>{
 const f=await allocationFixture(t,{state:(state,{at})=>withdrawCandidate(state,'next',{now:at,availability:[]}).state});
 const {assignments}=await resolveAllocationPolicy(f.store,f.catalog,[child]);
 assert.equal(assignments[0].requestedModel,'gpt-5.6-terra');assert.equal(assignments[0].effort,'high');
 assert.equal(assignments[0].selection.status,'fallback');assert.equal(assignments[0].selection.reason,'baseline_version_unverified');
});

test('an unversioned baseline stays reachable when the active route cannot be selected or restored',()=>{
 const twoLevel=()=>{
  let state=paired(paired(registerCandidate(promoted(),third),{right:'third',prefix:'q'}),{left:'next',right:'third',prefix:'q'});
  return promoteCandidate(state,'third',{now,availability:exposure()}).state;
 };
 let state=withdrawCandidate(twoLevel(),'third',{now,availability:exposure()}).state;
 assert.equal(state.activeId,'next');
 const dead=withdrawCandidate(state,'next',{now,availability:exposure()});
 assert.equal(dead.reason,'safe_fallback_required');assert.equal(dead.state.activeId,null);
 assert.equal(unverifiedBaselineReason(dead.state),'active_route_not_current');assert.equal(unverifiedBaselineReason(fresh()),'baseline_version_unverified');
 const cases=[
  dead.state,
  recordObservation(twoLevel(),routeRow('critical-third','third','late',{quality:{source:'independent_review',critical:true,criteria:[{id:'correct',status:'fail'}]}}),{now,availability:[]}).state,
 ];
 for(const current of cases){
  const choice=selectAssignment(current,{profile,availability:exposure(),now});
  assert.equal(choice.status,'wait');assert.equal(unverifiedBaselineRoute(current,choice,'codex')?.id,'base');
 }
 const later=now+91*86_400_000,expired=selectAssignment(promoted(),{profile,availability:exposure(later),now:later});
 assert.equal(expired.status,'wait');assert.equal(unverifiedBaselineRoute(promoted(),expired,'codex')?.id,'base');
 const lapsed=selectAssignment(promoted(),{profile,availability:exposure(now,[['gpt-5.6-terra',['high']]]),now});
 assert.equal(lapsed.status,'wait');assert.equal(unverifiedBaselineRoute(promoted(),lapsed,'codex')?.id,'base');
 const pinned=pinCandidate(promoted(),'next',{now,availability:exposure()}).state,held=selectAssignment(pinned,{profile,availability:[],now});
 assert.equal(held.reason,'pinned_route_unavailable');assert.equal(unverifiedBaselineRoute(pinned,held,'codex'),null);
});

test('withdrawing the compared route leaves its successor selected',()=>{
 let state=paired(paired(registerCandidate(promoted(),third),{right:'third',prefix:'q'}),{left:'next',right:'third',prefix:'q'});
 state=promoteCandidate(state,'third',{now,availability:exposure()}).state;
 state=withdrawCandidate(state,'next',{now,availability:exposure()}).state;
 assert.equal(state.candidates.find(row=>row.id==='next').status,'withdrawn');
 assert.equal(selectAssignment(state,{profile,availability:exposure(),now}).candidateId,'third');
});

test('later observations cannot displace the stored evidence of an active route',()=>{
 const other='a'.repeat(64),withConditions=(row,conditions)=>({...row,route:{...row.route,conditions}});
 let state=fresh();
 state=record(state,withConditions(routeRow('x0','next','c0'),other));
 state=record(record(state,routeRow('x1','next','c0')),routeRow('y1','base','c0'));
 for(let i=1;i<3;i++)state=record(record(state,routeRow(`b${i}`,'base',`c${i}`)),routeRow(`n${i}`,'next',`c${i}`));
 const result=promoteCandidate(state,'next',{now,availability:exposure()});
 assert.equal(result.promoted,true);
 const after=record(result.state,withConditions(routeRow('y0','base','c0'),other));
 const choice=selectAssignment(after,{profile,availability:exposure(),now});
 assert.equal(choice.status,'selected');assert.deepEqual(choice.evidenceIds,result.state.activeEvidenceIds);
});

test('a versioned candidate never pairs with route evidence of an unversioned baseline',()=>{
 const versioned={id:'vnext',provider:'codex',model:'gpt-5.6-luna',modelVersion:'v2',effort:'low'};
 let state=registerCandidate(createSelectionState({profile,baseline:base}),versioned);
 for(let i=0;i<3;i++){
  state=record(state,routeRow(`vb${i}`,'base',`v${i}`));
  const row=routeRow(`vc${i}`,'next',`v${i}`,{candidateId:'vnext',modelVersion:'v2'});delete row.route;
  state=record(state,row);
 }
 const rows=[{source:'account_catalog',provider:'codex',model:'gpt-5.6-luna',modelVersion:'v2',efforts:['low'],capabilities:['text'],contextClasses:['text_1_sources_0'],observedAt:now,expiresAt:now+60_000}];
 assert.equal(promoteCandidate(state,'vnext',{now,availability:rows}).reason,'insufficient_comparable_evidence');
});

test('a corrupted pin or a profile mismatch never reaches the unverified bypass',()=>{
 const state={...fresh(),pin:{candidateId:'base'},candidates:fresh().candidates.map(row=>row.id==='base'?{...row,status:'testing'}:row)};
 const choice=selectAssignment(state,{profile,availability:exposure(),now});
 assert.equal(choice.status,'wait');assert.equal(unverifiedBaselineRoute(state,choice,'codex'),null);
 assert.equal(unverifiedBaselineRoute(fresh(),{status:'wait',reason:'profile_mismatch'},'codex'),null);
});
