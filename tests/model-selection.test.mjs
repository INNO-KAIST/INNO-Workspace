import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectionState,registerCandidate,recordObservation,pruneObservations,promoteCandidate,withdrawCandidate,selectAssignment,pinCandidate,unpinCandidate} from '../public/core/model-selection.mjs';
import {unverifiedBaselineRoute} from '../worker/allocation-policy.mjs';

const now=1_800_000_000_000;
const profile={family:'analysis',requirementsVersion:'r1',evaluationVersion:'e1',criteria:['correct','sources'],requiredCapabilities:['tools','long_context'],contextClass:'large'};
const baseline={id:'base',provider:'codex',model:'established',modelVersion:'v1',effort:'high'};
const candidate={id:'new',provider:'claude',model:'candidate',modelVersion:'v2',effort:'medium'};
const availability=(at=now)=>[
 {provider:'codex',model:'established',modelVersion:'v1',efforts:['high'],capabilities:['tools','long_context'],contextClasses:['large'],observedAt:at,expiresAt:at+60_000,source:'account_catalog'},
 {provider:'claude',model:'candidate',modelVersion:'v2',efforts:['medium'],capabilities:['tools','long_context'],contextClasses:['large'],observedAt:at,expiresAt:at+60_000,source:'account_catalog'},
];
const fresh=()=>createSelectionState({profile,baseline,minSamples:3});
const observation=(id,modelId,comparisonId,opts={})=>({id,provider:modelId==='base'?'codex':'claude',executionId:`execution-${id}`,generation:1,candidateId:modelId,modelVersion:modelId==='base'?'v1':'v2',comparisonId,profile:{family:profile.family,requirementsVersion:profile.requirementsVersion,evaluationVersion:profile.evaluationVersion,contextClass:profile.contextClass,criteria:profile.criteria,requiredCapabilities:profile.requiredCapabilities},observedAt:now,source:'normal_execution',quality:{source:'independent_review',criteria:[{id:'correct',status:'pass'},{id:'sources',status:'pass'}],critical:false},usage:{source:'executor_report',inputTokens:modelId==='base'?100:70,outputTokens:20,latencyMs:modelId==='base'?1000:800},...opts});
const criticalQuality={source:'independent_review',criteria:[{id:'correct',status:'fail'},{id:'sources',status:'pass'}],critical:true};
function paired(state,count=3){for(let i=0;i<count;i++){state=recordObservation(state,observation(`b${i}`,'base',`pair${i}`),{now,availability:availability()}).state;state=recordObservation(state,observation(`c${i}`,'new',`pair${i}`),{now,availability:availability()}).state;}return state;}

test('manual pin locks the active route without changing its policy version',()=>{
 let state=registerCandidate(fresh(),candidate);
 assert.throws(()=>pinCandidate(state,'new',{now,availability:availability()}),/active/i);
 const pinned=pinCandidate(state,'base',{now,availability:availability()});
 assert.deepEqual(pinned.state.pin,{candidateId:'base'});
 assert.equal(pinned.state.stateVersion,state.stateVersion+1);
 assert.equal(pinned.state.policyVersion,state.policyVersion);
 state=paired(pinned.state);
 assert.equal(promoteCandidate(state,'new',{now,availability:availability()}).reason,'manual_pin_active_route');
 const cleared=unpinCandidate(state);
 assert.equal(cleared.state.pin,null);
 assert.equal(cleared.state.policyVersion,state.policyVersion);
 assert.equal(promoteCandidate(cleared.state,'new',{now,availability:availability()}).promoted,true);
});

test('pin eligibility and selected route expiry never cause a silent baseline switch',()=>{
 let state=promoteCandidate(paired(registerCandidate(fresh(),candidate)),'new',{now,availability:availability()}).state;
 assert.throws(()=>pinCandidate(state,'new',{now,availability:[]}),/eligible|available/i);
 state=pinCandidate(state,'new',{now,availability:availability()}).state;
 assert.equal(selectAssignment(state,{profile,availability:availability(),now}).candidateId,'new');
 assert.deepEqual({status:selectAssignment(state,{profile,availability:availability().slice(0,1),now}).status,reason:selectAssignment(state,{profile,availability:availability().slice(0,1),now}).reason},{status:'wait',reason:'pinned_route_unavailable'});
 const later=now+91*86400_000,refreshed=availability(later);
 assert.equal(selectAssignment(state,{profile,availability:refreshed,now:later}).reason,'pinned_evidence_expired');
 assert.equal(selectAssignment(unpinCandidate(state).state,{profile,availability:refreshed,now:later}).status,'fallback');
});

test('critical regression and explicit withdrawal clear an active pin before rollback',()=>{
 const promoted=promoteCandidate(paired(registerCandidate(fresh(),candidate)),'new',{now,availability:availability()}).state;
 const pinned=pinCandidate(promoted,'new',{now,availability:availability()}).state;
 const withdrawn=withdrawCandidate(pinned,'new',{now,availability:availability()}).state;
 assert.equal(withdrawn.pin,null);
 assert.equal(withdrawn.activeId,'base');
 const regressed=recordObservation(pinned,observation('pin-critical','new','critical',{quality:{source:'independent_review',criteria:[{id:'correct',status:'fail'},{id:'sources',status:'pass'}],critical:true}}),{now,availability:availability()}).state;
 assert.equal(regressed.pin,null);
 assert.equal(regressed.activeId,'base');
});
test('inconsistent pin state fails closed during selection and promotion',()=>{
 const registered=registerCandidate(fresh(),candidate);
 const mismatched={...registered,pin:{candidateId:'new'}};
 assert.equal(selectAssignment(mismatched,{profile,availability:availability(),now}).status,'wait');
 assert.equal(promoteCandidate(mismatched,'new',{now,availability:availability()}).reason,'manual_pin_active_route');
 const inactive={...registered,pin:{candidateId:'base'},candidates:registered.candidates.map(x=>x.id==='base'?{...x,status:'testing'}:x)};
 assert.equal(selectAssignment(inactive,{profile,availability:availability(),now}).status,'wait');
 assert.equal(promoteCandidate(inactive,'new',{now,availability:availability()}).reason,'manual_pin_active_route');
});

test('starts with a conservative existing route and never mutates the caller state',()=>{
 const state=fresh(),copy=structuredClone(state),choice=selectAssignment(state,{profile,availability:availability(),now});
 assert.equal(choice.status,'fallback');assert.equal(choice.model,'established');assert.equal(choice.confidence,'unvalidated_fallback');assert.deepEqual(state,copy);
 assert.equal(selectAssignment(state,{profile,availability:[],now}).status,'wait');
 assert.equal(selectAssignment(state,{profile:{...profile,requiredCapabilities:['tools']},availability:availability(),now}).status,'wait');
 assert.equal(selectAssignment(state,{profile,availability:availability().map(x=>({...x,capabilities:[]})),now}).status,'wait');
 assert.equal(selectAssignment(state,{profile,availability:availability().map(x=>({...x,contextClasses:[]})),now}).status,'wait');
});

test('promotion needs matched independent all-pass samples and measured efficiency',()=>{
 let state=registerCandidate(fresh(),candidate),result=promoteCandidate(state,'new',{now,availability:availability()});
 assert.equal(result.promoted,false);assert.equal(result.reason,'insufficient_comparable_evidence');
 state=paired(state,2);result=promoteCandidate(state,'new',{now,availability:availability()});assert.equal(result.promoted,false);
 state=paired(state,3);result=promoteCandidate(state,'new',{now,availability:availability()});
 assert.equal(result.promoted,true);assert.equal(result.state.policyVersion,2);
 const choice=selectAssignment(result.state,{profile,availability:availability(),now});
 assert.equal(choice.status,'selected');assert.equal(choice.model,'candidate');assert.equal(choice.effort,'medium');assert.equal(choice.policyVersion,2);assert.equal(choice.evidenceIds.length,6);assert.equal(choice.confidence,'profile_scoped_observation');
 assert.equal(promoteCandidate(result.state,'new',{now,availability:availability()}).state.policyVersion,2);
});

test('promotion vetoes every independent candidate failure in the eligible cohort',()=>{
 for(const [name,criteria,critical,comparisonId] of [
  ['critical',[{id:'correct',status:'fail'},{id:'sources',status:'pass'}],true,'extra'],
  ['noncritical',[{id:'correct',status:'pass'},{id:'sources',status:'fail'}],false,'extra'],
  ['unverifiable',[{id:'correct',status:'pass'},{id:'sources',status:'unverifiable'}],false,'extra'],
  ['repeat_pair',[{id:'correct',status:'fail'},{id:'sources',status:'pass'}],false,'pair0'],
 ]){
  let state=paired(registerCandidate(fresh(),candidate));
  state=recordObservation(state,observation(`negative-${name}`,'new',comparisonId,{quality:{source:'independent_review',criteria,critical}}),{now}).state;
  const result=promoteCandidate(state,'new',{now,availability:availability()});
  assert.equal(result.promoted,false,name);assert.equal(result.reason,'candidate_quality_regression',name);
 }
});

test('promotion leaves unrelated candidates in their existing state',()=>{
 let state=registerCandidate(registerCandidate(fresh(),candidate),{id:'other',provider:'codex',model:'other',modelVersion:'v3',effort:'low'});
 assert.equal(state.candidates.find(x=>x.id==='other').status,'candidate');
 state=promoteCandidate(paired(state),'new',{now,availability:availability()}).state;
 assert.equal(state.candidates.find(x=>x.id==='other').status,'candidate');
});

test('executor quality self-report and missing metrics cannot establish promotion',()=>{
 let state=registerCandidate(fresh(),candidate);
 for(let i=0;i<3;i++){
  state=recordObservation(state,observation(`sb${i}`,'base',`p${i}`),{now}).state;
  state=recordObservation(state,observation(`sc${i}`,'new',`p${i}`,{quality:{source:'executor_self_report',criteria:[{id:'correct',status:'pass'},{id:'sources',status:'pass'}],critical:false}}),{now}).state;
 }
 assert.equal(promoteCandidate(state,'new',{now,availability:availability()}).reason,'insufficient_comparable_evidence');
 state=registerCandidate(fresh(),candidate);
 for(let i=0;i<3;i++){
  state=recordObservation(state,observation(`mb${i}`,'base',`p${i}`),{now}).state;
  state=recordObservation(state,observation(`mc${i}`,'new',`p${i}`,{usage:{source:'executor_report',inputTokens:null,outputTokens:20,latencyMs:800}}),{now}).state;
 }
 assert.equal(promoteCandidate(state,'new',{now,availability:availability()}).reason,'missing_measured_efficiency');
});

test('deduplicates execution and generation and never borrows evidence across profile or model version',()=>{
 let state=registerCandidate(fresh(),candidate);
 const first=recordObservation(state,observation('x','new','p'),{now});state=first.state;
 assert.equal(state.candidates.find(x=>x.id==='new').status,'testing');
 assert.equal(recordObservation(state,{...observation('different','new','p'),executionId:'execution-x'},{now}).reason,'duplicate_execution');
 assert.throws(()=>recordObservation(state,observation('x','new','other',{executionId:'new-execution'}),{now}),/duplicate observation id/i);
 assert.equal(state.observations.length,1);
 assert.throws(()=>recordObservation(state,observation('wrong','new','p',{profile:{...profile,evaluationVersion:'e2'}}),{now}),/profile/i);
 assert.throws(()=>recordObservation(state,observation('wrong2','new','p',{modelVersion:'v3'}),{now}),/version/i);
 let unknown=registerCandidate(fresh(),{...candidate,modelVersion:null});
 for(let i=0;i<3;i++){unknown=recordObservation(unknown,observation(`ub${i}`,'base',`up${i}`),{now}).state;unknown=recordObservation(unknown,observation(`uc${i}`,'new',`up${i}`,{modelVersion:null}),{now}).state;}
 assert.equal(promoteCandidate(unknown,'new',{now,availability:availability()}).reason,'unobserved_model_version');
});

test('unobserved actual version and repeated comparison IDs cannot inflate promotion proof',()=>{
 let state=registerCandidate(fresh(),candidate);
 for(let i=0;i<3;i++){
  state=recordObservation(state,observation(`vb${i}`,'base',`p${i}`),{now}).state;
  const row=observation(`vc${i}`,'new',`p${i}`);delete row.modelVersion;
  state=recordObservation(state,row,{now}).state;
 }
 assert.equal(promoteCandidate(state,'new',{now,availability:availability()}).reason,'insufficient_comparable_evidence');
 state=registerCandidate(fresh(),candidate);
 for(let i=0;i<3;i++){
  state=recordObservation(state,observation(`rb${i}`,'base','same'),{now}).state;
  state=recordObservation(state,observation(`rc${i}`,'new','same'),{now}).state;
 }
 assert.equal(promoteCandidate(state,'new',{now,availability:availability()}).reason,'insufficient_comparable_evidence');
});

test('availability is fresh, account-backed, exact-version and capability checked',()=>{
 const state=paired(registerCandidate(fresh(),candidate));
 for(const a of [availability(now-120_000),availability().map(x=>({...x,source:'official_release'})),availability().map(x=>({...x,modelVersion:null})),availability().map(x=>({...x,capabilities:['tools']})),availability().map(x=>({...x,expiresAt:now+3*60*60_000}))]){
  assert.equal(promoteCandidate(state,'new',{now,availability:a}).reason,'candidate_unavailable');
 }
});

test('critical independent regression withdraws active policy and restores eligible prior route',()=>{
 let state=promoteCandidate(paired(registerCandidate(fresh(),candidate)),'new',{now,availability:availability()}).state;
 const report=recordObservation(state,observation('regression','new','regression',{quality:{source:'independent_review',criteria:[{id:'correct',status:'fail'},{id:'sources',status:'pass'}],critical:true}}),{now,availability:availability()});
 assert.equal(report.reason,'critical_regression');assert.equal(report.state.policyVersion,3);assert.equal(report.state.activeId,'base');assert.equal(report.state.candidates.find(x=>x.id==='new').status,'withdrawn');
 assert.equal(selectAssignment(report.state,{profile,availability:availability(),now}).model,'established');
 assert.equal(withdrawCandidate(report.state,'new',{now,availability:availability()}).state.policyVersion,3);
});

test('critical regression without eligible prior route enters safe wait',()=>{
 let state=promoteCandidate(paired(registerCandidate(fresh(),candidate)),'new',{now,availability:availability()}).state;
 const onlyNew=availability().slice(1);
 state=recordObservation(state,observation('critical','new','later',{quality:{source:'independent_review',criteria:[{id:'correct',status:'fail'},{id:'sources',status:'pass'}],critical:true}}),{now,availability:onlyNew}).state;
 assert.equal(state.activeId,null);assert.equal(selectAssignment(state,{profile,availability:onlyNew,now}).status,'wait');
});

test('rollback does not reactivate a prior promoted route after its evidence expires',()=>{
 let state=promoteCandidate(paired(registerCandidate(fresh(),candidate)),'new',{now,availability:availability()}).state;
 state=registerCandidate(state,{id:'new2',provider:'claude',model:'candidate2',modelVersion:'v3',effort:'medium'});
 for(let i=0;i<3;i++){
  state=recordObservation(state,observation(`xb${i}`,'base',`xp${i}`),{now}).state;
  state=recordObservation(state,observation(`xn${i}`,'new',`xp${i}`),{now}).state;
  state=recordObservation(state,observation(`xc${i}`,'new2',`xp${i}`,{modelVersion:'v3',usage:{source:'executor_report',inputTokens:60,outputTokens:20,latencyMs:800}}),{now}).state;
 }
 const all=[...availability(),{provider:'claude',model:'candidate2',modelVersion:'v3',efforts:['medium'],capabilities:['tools','long_context'],contextClasses:['large'],observedAt:now,expiresAt:now+60_000,source:'account_catalog'}];
 state=promoteCandidate(state,'new2',{now,availability:all}).state;
 const later=now+91*86400_000,refreshed=all.map(row=>({...row,observedAt:later,expiresAt:later+60_000}));
 state=recordObservation(state,observation('latecritical','new2','later',{modelVersion:'v3',observedAt:later,quality:{source:'independent_review',criteria:[{id:'correct',status:'fail'},{id:'sources',status:'pass'}],critical:true}}),{now:later,availability:refreshed}).state;
 assert.equal(state.activeId,null);assert.equal(selectAssignment(state,{profile,availability:refreshed,now:later}).status,'fallback');
});

test('expired evidence IDs reused by new executions cannot restore prior promoted policy',()=>{
 let state=promoteCandidate(paired(registerCandidate(fresh(),candidate)),'new',{now,availability:availability()}).state;
 const oldIds=[...state.activeEvidenceIds];
 state=registerCandidate(state,{id:'new2',provider:'claude',model:'candidate2',modelVersion:'v3',effort:'medium'});
 for(let i=0;i<3;i++){
  state=recordObservation(state,observation(`yb${i}`,'base',`yp${i}`),{now}).state;
  state=recordObservation(state,observation(`yn${i}`,'new',`yp${i}`),{now}).state;
  state=recordObservation(state,observation(`yc${i}`,'new2',`yp${i}`,{modelVersion:'v3',usage:{source:'executor_report',inputTokens:60,outputTokens:20,latencyMs:800}}),{now}).state;
 }
 const all=[...availability(),{provider:'claude',model:'candidate2',modelVersion:'v3',efforts:['medium'],capabilities:['tools','long_context'],contextClasses:['large'],observedAt:now,expiresAt:now+60_000,source:'account_catalog'}];
 state=promoteCandidate(state,'new2',{now,availability:all}).state;
 const later=now+91*86400_000,refreshed=all.map(row=>({...row,observedAt:later,expiresAt:later+60_000}));
 state=recordObservation(state,observation('prune-trigger','base','prune',{observedAt:later,quality:undefined}),{now:later}).state;
 for(let i=0;i<oldIds.length;i++)state=recordObservation(state,observation(oldIds[i],'base',`reused${i}`,{observedAt:later,quality:undefined}),{now:later}).state;
 state=recordObservation(state,observation('identitycritical','new2','late',{modelVersion:'v3',observedAt:later,quality:{source:'independent_review',criteria:[{id:'correct',status:'fail'},{id:'sources',status:'pass'}],critical:true}}),{now:later,availability:refreshed}).state;
 assert.equal(state.activeId,null);
 assert.equal(selectAssignment(state,{profile,availability:refreshed,now:later}).status,'fallback');
});

test('full bounded history admits critical regression and preserves active evidence while pinned',()=>{
 let state=promoteCandidate(paired(registerCandidate(fresh(),candidate)),'new',{now,availability:availability()}).state;
 const pinned=[...state.activeEvidenceIds];
 for(let i=0;i<994;i++)state=recordObservation(state,observation(`fill${i}`,'base',`f${i}`,{quality:undefined}),{now}).state;
 assert.equal(state.observations.length,1000);
 state=recordObservation(state,observation('atcapacity','base','last',{quality:undefined}),{now}).state;
 assert.equal(state.observations.length,1000);
 assert.ok(pinned.every(id=>state.observations.some(x=>x.id===id)));
 const result=recordObservation(state,observation('fullcritical','new','regression',{quality:{source:'independent_review',criteria:[{id:'correct',status:'fail'},{id:'sources',status:'pass'}],critical:true}}),{now,availability:availability()});
 assert.equal(result.reason,'critical_regression');assert.equal(result.state.activeId,'base');assert.equal(result.state.observations.length,1000);
 assert.ok(result.state.observations.some(x=>x.id==='fullcritical'));
});

test('bounds identities and history, and expires old evidence before promotion',()=>{
 let state=registerCandidate(fresh(),candidate);
 assert.throws(()=>registerCandidate(state,{...candidate,id:'third',model:'candidate'}),/duplicate/i);
 assert.throws(()=>recordObservation(state,observation('bad','new','p',{id:'x'.repeat(201)}),{now}),/invalid/i);
 state=paired(state);
 assert.equal(promoteCandidate(state,'new',{now:now+91*86400_000,availability:availability(now+91*86400_000)}).reason,'insufficient_comparable_evidence');
});

test('trusted critical review withdraws the active pinned baseline, while self-report and later pass cannot undo it',()=>{
 let state=pinCandidate(fresh(),'base',{now,availability:availability()}).state;
 const self={...criticalQuality,source:'executor_self_report'};
 state=recordObservation(state,observation('self-critical','base','self',{quality:self}),{now,availability:availability()}).state;
 assert.equal(selectAssignment(state,{profile,availability:availability(),now}).status,'fallback');
 const report=recordObservation(state,observation('base-critical','base','critical',{quality:criticalQuality}),{now,availability:availability()});
 assert.equal(report.reason,'critical_regression');state=report.state;
 assert.equal(state.candidates.find(x=>x.id==='base').status,'withdrawn');
 assert.equal(state.activeId,null);assert.equal(state.pin,null);
 assert.deepEqual({status:selectAssignment(state,{profile,availability:availability(),now}).status,reason:selectAssignment(state,{profile,availability:availability(),now}).reason},{status:'wait',reason:'baseline_critical_regression'});
 assert.equal(recordObservation(state,observation('base-critical','base','critical',{quality:criticalQuality}),{now}).recorded,false);
 state=recordObservation(state,observation('base-pass','base','later'),{now,availability:availability()}).state;
 assert.equal(state.candidates.find(x=>x.id==='base').status,'withdrawn');
 assert.equal(selectAssignment(state,{profile,availability:availability(),now}).status,'wait');
});

test('inactive baseline critical leaves healthy active and frozen evidence, but prevents rollback and new promotion',()=>{
 let state=promoteCandidate(paired(registerCandidate(fresh(),candidate)),'new',{now,availability:availability()}).state;
 const frozen=[...state.activeEvidenceIds];
 const report=recordObservation(state,observation('inactive-critical','base','later',{quality:criticalQuality}),{now,availability:availability()});
 state=report.state;
 assert.equal(report.reason,'critical_regression');
 assert.equal(state.activeId,'new');assert.deepEqual(state.activeEvidenceIds,frozen);
 assert.equal(state.candidates.find(x=>x.id==='base').status,'withdrawn');
 assert.equal(selectAssignment(state,{profile,availability:availability(),now}).status,'selected');
 const attempted=registerCandidate(state,{id:'new2',provider:'claude',model:'candidate2',modelVersion:'v3',effort:'high'});
 assert.equal(promoteCandidate(attempted,'new2',{now,availability:availability()}).promoted,false);
 state=withdrawCandidate(state,'new',{now,availability:availability()}).state;
 assert.equal(state.activeId,null);
 assert.equal(selectAssignment(state,{profile,availability:availability(),now}).reason,'baseline_critical_regression');
});

test('legacy recorded baseline critical is never selected or pinned and prune persists withdrawal past evidence expiry',()=>{
 const critical=observation('legacy-critical','base','legacy',{quality:criticalQuality});
 let state={...fresh(),observations:[critical]};
 assert.equal(selectAssignment(state,{profile,availability:availability(),now}).status,'wait');
 assert.throws(()=>pinCandidate(state,'base',{now,availability:availability()}),/eligible|regression|active/i);
 state=registerCandidate(state,candidate);
 assert.equal(promoteCandidate(state,'new',{now,availability:availability()}).promoted,false);
 const later=now+91*86_400_000;
 state=pruneObservations(state,{now:later}).state;
 assert.equal(state.candidates.find(x=>x.id==='base').status,'withdrawn');
 assert.equal(state.observations.some(x=>x.id==='legacy-critical'),false);
 assert.equal(selectAssignment(state,{profile,availability:availability(later),now:later}).status,'wait');
});

test('legacy null-version baseline critical cannot bypass wait through unverified allocation',()=>{
 const unknown={...fresh(),candidates:[{...fresh().candidates[0],modelVersion:null}],observations:[observation('unknown-critical','base','unknown',{modelVersion:null,quality:criticalQuality})]};
 const choice=selectAssignment(unknown,{profile,availability:availability(),now});
 assert.equal(choice.status,'wait');
 assert.equal(unverifiedBaselineRoute(unknown,choice,'codex'),null);
});

test('a versioned candidate also needs direct evidence against the promoted current route',()=>{
 let state=promoteCandidate(paired(registerCandidate(fresh(),candidate)),'new',{now,availability:availability()}).state;
 state=registerCandidate(state,{id:'new2',provider:'claude',model:'candidate2',modelVersion:'v3',effort:'medium'});
 const lean={source:'executor_report',inputTokens:60,outputTokens:20,latencyMs:800};
 for(let i=0;i<3;i++)state=recordObservation(recordObservation(state,observation(`zb${i}`,'base',`zp${i}`),{now}).state,observation(`zc${i}`,'new2',`zp${i}`,{modelVersion:'v3',usage:lean}),{now}).state;
 const all=[...availability(),{provider:'claude',model:'candidate2',modelVersion:'v3',efforts:['medium'],capabilities:['tools','long_context'],contextClasses:['large'],observedAt:now,expiresAt:now+60_000,source:'account_catalog'}];
 assert.equal(promoteCandidate(state,'new2',{now,availability:all}).reason,'insufficient_current_route_evidence');
 for(let i=0;i<3;i++)state=recordObservation(state,observation(`zn${i}`,'new',`zp${i}`),{now}).state;
 const result=promoteCandidate(state,'new2',{now,availability:all});
 assert.equal(result.promoted,true);assert.equal(result.state.candidates.find(x=>x.id==='new2').comparedWithId,'new');
 assert.equal(selectAssignment(result.state,{profile,availability:all,now}).candidateId,'new2');
});
