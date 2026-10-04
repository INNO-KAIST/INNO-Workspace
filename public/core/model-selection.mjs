// Pure policy core. The caller must authenticate independent_review provenance before ingestion.
import {isAssignableProvider} from './providers.mjs';
const DAY=86_400_000, EVIDENCE_MS=90*DAY, AVAILABILITY_MS=2*60*60_000, MAX_OBSERVATIONS=1000, MAX_CANDIDATES=32;
const IDENTIFIER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const EFFORTS=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
const fail=message=>{throw new TypeError(`Invalid model selection ${message}`);};
function id(value,label){if(typeof value!=='string'||!IDENTIFIER.test(value))fail(label);return value;}
function instant(value,label){if(!Number.isSafeInteger(value)||value<0)fail(label);return value;}
function profileOf(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('profile');
 const family=id(value.family,'profile family'),requirementsVersion=id(value.requirementsVersion,'requirements version'),evaluationVersion=id(value.evaluationVersion,'evaluation version'),contextClass=id(value.contextClass,'context class');
 const criteria=value.criteria,requiredCapabilities=value.requiredCapabilities;
 if(!Array.isArray(criteria)||criteria.length<1||criteria.length>8||new Set(criteria).size!==criteria.length)fail('criteria');
 if(!Array.isArray(requiredCapabilities)||requiredCapabilities.length<1||requiredCapabilities.length>16||new Set(requiredCapabilities).size!==requiredCapabilities.length)fail('capabilities');
 return {family,requirementsVersion,evaluationVersion,criteria:criteria.map(x=>id(x,'criterion')),requiredCapabilities:requiredCapabilities.map(x=>id(x,'capability')),contextClass};
}
function route(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('route');
 const provider=value.provider;if(!isAssignableProvider(provider))fail('provider');
 const modelVersion=value.modelVersion===null?null:id(value.modelVersion,'model version');
 const effort=value.effort;if(!EFFORTS.has(effort))fail('effort');
 return {id:id(value.id,'route id'),provider,model:id(value.model,'model'),modelVersion,effort};
}
function matchingProfile(expected,actual){return !!actual&&expected.family===actual.family&&expected.requirementsVersion===actual.requirementsVersion&&expected.evaluationVersion===actual.evaluationVersion&&expected.contextClass===actual.contextClass&&Array.isArray(actual.criteria)&&actual.criteria.length===expected.criteria.length&&expected.criteria.every((x,i)=>actual.criteria[i]===x)&&Array.isArray(actual.requiredCapabilities)&&actual.requiredCapabilities.length===expected.requiredCapabilities.length&&expected.requiredCapabilities.every((x,i)=>actual.requiredCapabilities[i]===x);}
function available(route,profile,rows,now){
 if(!Array.isArray(rows)||rows.length>100)return false;
 return rows.some(row=>row&&row.source==='account_catalog'&&row.provider===route.provider&&row.model===route.model&&row.modelVersion===route.modelVersion&&Number.isSafeInteger(row.observedAt)&&Number.isSafeInteger(row.expiresAt)&&row.observedAt<=now&&row.expiresAt>now&&row.expiresAt-row.observedAt<=AVAILABILITY_MS&&Array.isArray(row.efforts)&&row.efforts.includes(route.effort)&&Array.isArray(row.capabilities)&&profile.requiredCapabilities.every(x=>row.capabilities.includes(x))&&Array.isArray(row.contextClasses)&&row.contextClasses.includes(profile.contextClass));
}
function liveObservations(state,now){return state.observations.filter(x=>x.observedAt<=now&&x.observedAt>now-EVIDENCE_MS);}
function routeById(state,id){return state.candidates.find(x=>x.id===id);}
function baselineCritical(state){
 const baseline=routeById(state,state.baselineId);
 return !!baseline&&state.observations.some(row=>row.candidateId===baseline.id&&row.modelVersion===baseline.modelVersion&&row.quality?.source==='independent_review'&&row.quality.critical===true);
}
export function baselineExcluded(state){
 return !!state&&(routeById(state,state.baselineId)?.status==='withdrawn'||baselineCritical(state));
}
function validUsage(value){
 if(value===undefined)return null;
 if(!value||!['executor_report','server_metered'].includes(value.source))fail('usage provenance');
 const result={source:value.source};
 for(const key of ['inputTokens','outputTokens','latencyMs']){const v=value[key]??null;if(v!==null&&(!Number.isSafeInteger(v)||v<0))fail(key);result[key]=v;}
 return result;
}
function validQuality(value,profile){
 if(value===undefined)return null;
 if(!value||!['independent_review','executor_self_report'].includes(value.source)||typeof value.critical!=='boolean'||!Array.isArray(value.criteria)||value.criteria.length!==profile.criteria.length)fail('quality provenance');
 const seen=new Set();const criteria=value.criteria.map(x=>{if(!x||!profile.criteria.includes(x.id)||seen.has(x.id)||!['pass','fail','unverifiable'].includes(x.status))fail('quality criterion');seen.add(x.id);return {id:x.id,status:x.status};});
 return {source:value.source,critical:value.critical,criteria};
}
function validObservation(state,value,now){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('observation');
 const candidate=routeById(state,id(value.candidateId,'candidate id'));
 if(!candidate)fail('candidate');
 if(value.provider!==candidate.provider)fail('provider');
 if(value.modelVersion!==undefined&&value.modelVersion!==candidate.modelVersion)fail('model version');
 if(!matchingProfile(state.profile,value.profile))fail('profile');
 const observedAt=instant(value.observedAt,'observation time');if(observedAt>now||observedAt<=now-EVIDENCE_MS)fail('observation time');
 const generation=value.generation;if(!Number.isSafeInteger(generation)||generation<1||generation>1_000_000)fail('generation');
 if(value.source!=='normal_execution'&&value.source!=='bounded_evaluation')fail('observation source');
 return {id:id(value.id,'observation id'),provider:value.provider,executionId:id(value.executionId,'execution id'),generation,candidateId:candidate.id,modelVersion:value.modelVersion??null,comparisonId:id(value.comparisonId,'comparison id'),profile:{family:state.profile.family,requirementsVersion:state.profile.requirementsVersion,evaluationVersion:state.profile.evaluationVersion,contextClass:state.profile.contextClass,criteria:[...state.profile.criteria],requiredCapabilities:[...state.profile.requiredCapabilities]},observedAt,source:value.source,quality:validQuality(value.quality,state.profile),usage:validUsage(value.usage)};
}
function allPass(record,profile){return record.quality?.source==='independent_review'&&!record.quality.critical&&profile.criteria.every(id=>record.quality.criteria.some(c=>c.id===id&&c.status==='pass'));}
function measured(record){const u=record.usage;return u&&u.inputTokens!==null&&u.outputTokens!==null&&u.latencyMs!==null;}
function qualifiedPairs(state,candidateId,now){
 const observations=liveObservations(state,now),baseline=new Map(),candidates=new Map();
 const baseRoute=routeById(state,state.baselineId),candidateRoute=routeById(state,candidateId);
 for(const x of observations)if(x.candidateId===state.baselineId&&x.modelVersion!==null&&x.modelVersion===baseRoute.modelVersion&&allPass(x,state.profile)&&!baseline.has(x.comparisonId))baseline.set(x.comparisonId,x);
 for(const x of observations)if(x.candidateId===candidateId&&x.modelVersion!==null&&x.modelVersion===candidateRoute.modelVersion&&allPass(x,state.profile)&&!candidates.has(x.comparisonId))candidates.set(x.comparisonId,x);
 const pairs=[];
 for(const [comparisonId,x] of candidates)if(baseline.has(comparisonId))pairs.push([baseline.get(comparisonId),x]);
 return pairs;
}
const evidenceIdentity=x=>({id:x.id,provider:x.provider,executionId:x.executionId,generation:x.generation,candidateId:x.candidateId,modelVersion:x.modelVersion});
const sameEvidence=(a,b)=>a.id===b.id&&a.provider===b.provider&&a.executionId===b.executionId&&a.generation===b.generation&&a.candidateId===b.candidateId&&a.modelVersion===b.modelVersion;
function evidenceCurrent(state,candidate,now){
 const refs=candidate.evidenceRefs;
 if(!Array.isArray(refs)||refs.length<state.minSamples*2)return false;
 const matched=qualifiedPairs(state,candidate.id,now).flat();
 return refs.every(ref=>matched.some(row=>sameEvidence(ref,row)&&matchingProfile(state.profile,row.profile)&&allPass(row,state.profile)&&measured(row)));
}
function choice(state,route,status,confidence,evidenceIds,reason){return {status,candidateId:route.id,provider:route.provider,model:route.model,modelVersion:route.modelVersion,effort:route.effort,policyVersion:state.policyVersion,evidenceIds,confidence,reason};}
export function createSelectionState({profile,baseline,minSamples=3}){
 const p=profileOf(profile),b=route(baseline);
 if(!Number.isSafeInteger(minSamples)||minSamples<3||minSamples>20)fail('minimum samples');
 return {schemaVersion:1,stateVersion:1,policyVersion:1,profile:p,baselineId:b.id,activeId:b.id,previousId:null,pin:null,minSamples,candidates:[{...b,status:'active'}],observations:[],activeEvidenceIds:[]};
}
export function registerCandidate(state,value){
 const candidate=route(value);
 if(state.candidates.length>=MAX_CANDIDATES)fail('candidate limit');
 if(state.candidates.some(x=>x.id===candidate.id||x.provider===candidate.provider&&x.model===candidate.model&&x.modelVersion===candidate.modelVersion&&x.effort===candidate.effort))fail('duplicate candidate');
 return {...state,stateVersion:state.stateVersion+1,candidates:[...state.candidates,{...candidate,status:'candidate'}]};
}
function retentionPins(state,taskEvidenceIds=[],now){
 if(!Array.isArray(taskEvidenceIds)||taskEvidenceIds.some(x=>typeof x!=='string'||!IDENTIFIER.test(x)))fail('task evidence pins');
 const pinned=new Set([...state.activeEvidenceIds,...taskEvidenceIds]);
 for(const row of state.observations)if(row.quality?.source==='independent_review'&&row.quality.critical&&row.observedAt>now-EVIDENCE_MS)pinned.add(row.id);
 const previous=routeById(state,state.previousId);
 for(const id of previous?.evidenceIds??[])if(state.observations.some(row=>row.id===id&&row.observedAt>now-EVIDENCE_MS))pinned.add(id);
 return pinned;
}
export function pruneObservations(state,{now,taskEvidenceIds=[]}={}){
 instant(now,'now');
 if(baselineCritical(state)&&routeById(state,state.baselineId)?.status!=='withdrawn')state=withdrawCandidate(state,state.baselineId,{now}).state;
 const pinned=retentionPins(state,taskEvidenceIds,now);
 const retained=state.observations.filter(x=>pinned.has(x.id)||x.observedAt>now-EVIDENCE_MS);
 let removed=state.observations.length-retained.length;
 while(retained.length>MAX_OBSERVATIONS){
  let victim=-1;
  for(let i=0;i<retained.length;i++)if(!pinned.has(retained[i].id)&&(victim<0||retained[i].observedAt<retained[victim].observedAt))victim=i;
  if(victim<0)break;
  retained.splice(victim,1);removed++;
 }
 const expiredPinned=retained.filter(x=>x.observedAt<=now-EVIDENCE_MS&&pinned.has(x.id)).length;
 return {state:removed?{...state,stateVersion:state.stateVersion+1,observations:retained}:state,removed,expiredPinned,overLimit:Math.max(0,retained.length-MAX_OBSERVATIONS),retainedExceptions:retained.filter(x=>pinned.has(x.id)).length};
}
export function recordObservation(state,value,{now,availability=[],taskEvidenceIds=[],preserveAllForCritical=false}={}){
 instant(now,'now');const observation=validObservation(state,value,now);
 const existing=state.observations.find(x=>x.provider===observation.provider&&x.executionId===observation.executionId&&x.generation===observation.generation);
 if(existing)return {state,recorded:false,reason:'duplicate_execution'};
 if(state.observations.some(x=>x.id===observation.id))fail('duplicate observation id');
 if(baselineCritical(state)&&routeById(state,state.baselineId)?.status!=='withdrawn')state=withdrawCandidate(state,state.baselineId,{now,availability}).state;
 const critical=(observation.candidateId===state.activeId||observation.candidateId===state.baselineId)&&observation.quality?.source==='independent_review'&&observation.quality.critical;
 // Withdraw first so critical evidence can be recorded even when the old active policy pinned every slot.
 const withdrawalInput=critical&&observation.candidateId===state.baselineId?{...state,observations:[...state.observations,observation]}:state;
 const current=critical?withdrawCandidate(withdrawalInput,observation.candidateId,{now,availability}).state:state;
 const pinned=retentionPins(current,taskEvidenceIds,now);
 const preserve=critical&&preserveAllForCritical;
 const priorRows=current.observations.filter(x=>x.id!==observation.id);
 const retained=preserve?[...priorRows]:priorRows.filter(x=>pinned.has(x.id)||x.observedAt>now-EVIDENCE_MS);
 while(!preserve&&retained.length>=MAX_OBSERVATIONS){
  let victim=-1;
  for(let i=0;i<retained.length;i++)if(!pinned.has(retained[i].id)&&(victim<0||retained[i].observedAt<retained[victim].observedAt))victim=i;
  if(victim<0)fail('observation capacity: all evidence pinned');
  retained.splice(victim,1);
 }
 const next={...current,stateVersion:current.stateVersion+1,observations:[...retained,observation],candidates:current.candidates.map(x=>x.id===observation.candidateId&&x.status==='candidate'?{...x,status:'testing'}:x)};
 return {state:next,recorded:true,reason:critical?'critical_regression':'recorded'};
}
export function promoteCandidate(state,candidateId,{now,availability=[]}={}){
 instant(now,'now');const candidate=routeById(state,id(candidateId,'candidate id'));if(!candidate)fail('candidate');
 if(candidate.status==='active')return {state,promoted:false,reason:'already_active'};
 if(state.pin)return {state,promoted:false,reason:'manual_pin_active_route'};
 if(candidate.status==='withdrawn')return {state,promoted:false,reason:'withdrawn'};
 if(baselineExcluded(state))return {state,promoted:false,reason:'baseline_critical_regression'};
 if(candidate.modelVersion===null)return {state,promoted:false,reason:'unobserved_model_version'};
 if(!available(candidate,state.profile,availability,now))return {state,promoted:false,reason:'candidate_unavailable'};
 const cohort=liveObservations(state,now).filter(x=>x.candidateId===candidateId&&x.modelVersion===candidate.modelVersion&&matchingProfile(state.profile,x.profile));
 if(cohort.some(x=>x.quality?.source==='independent_review'&&!allPass(x,state.profile)))return {state,promoted:false,reason:'candidate_quality_regression'};
 const pairs=qualifiedPairs(state,candidateId,now);
 if(pairs.length<state.minSamples)return {state,promoted:false,reason:'insufficient_comparable_evidence'};
 if(pairs.some(([base,next])=>!measured(base)||!measured(next)))return {state,promoted:false,reason:'missing_measured_efficiency'};
 const total=(rows,index,key)=>rows.reduce((sum,pair)=>sum+BigInt(pair[index].usage[key]),0n);
 const baseTokens=total(pairs,0,'inputTokens')+total(pairs,0,'outputTokens'),newTokens=total(pairs,1,'inputTokens')+total(pairs,1,'outputTokens');
 if(newTokens>=baseTokens||total(pairs,1,'latencyMs')>total(pairs,0,'latencyMs'))return {state,promoted:false,reason:'no_measured_efficiency_gain'};
 const evidenceIds=pairs.flatMap(pair=>pair.map(x=>x.id));
 const evidenceRefs=pairs.flatMap(pair=>pair.map(evidenceIdentity));
 const candidates=state.candidates.map(x=>({...x,status:x.id===candidateId?'active':x.id===state.activeId?'testing':x.status,...(x.id===candidateId?{evidenceIds,evidenceRefs}: {})}));
 return {state:{...state,stateVersion:state.stateVersion+1,policyVersion:state.policyVersion+1,previousId:state.activeId,activeId:candidateId,activeEvidenceIds:evidenceIds,candidates},promoted:true,reason:'profile_scoped_evidence'};
}
export function withdrawCandidate(state,candidateId,{now,availability=[]}={}){
 instant(now,'now');const candidate=routeById(state,id(candidateId,'candidate id'));if(!candidate)fail('candidate');
 if(candidate.status==='withdrawn')return {state,withdrawn:false,reason:'already_withdrawn'};
 if(candidate.id===state.baselineId&&!baselineCritical(state))fail('baseline withdrawal');
 const active=state.activeId===candidateId,prior=active?routeById(state,state.previousId):null;
 const priorProven=prior?.id===state.baselineId?!baselineExcluded(state):prior&&evidenceCurrent(state,prior,now);
 const restored=prior&&prior.status!=='withdrawn'&&priorProven&&available(prior,state.profile,availability,now)?prior:null;
 const candidates=state.candidates.map(x=>({...x,status:x.id===candidateId?'withdrawn':restored&&x.id===restored.id?'active':x.status}));
 return {state:{...state,stateVersion:state.stateVersion+1,policyVersion:state.policyVersion+(active?1:0),activeId:active?(restored?.id??null):state.activeId,previousId:active?null:state.previousId,activeEvidenceIds:active?(restored?.evidenceIds??[]):state.activeEvidenceIds,pin:active?null:state.pin??null,candidates},withdrawn:true,reason:active?(restored?'restored_previous':'safe_fallback_required'):'withdrawn'};
}
export function pinCandidate(state,candidateId,{now,availability=[],allowUnverifiedBaseline=false}={}){
 instant(now,'now');id(candidateId,'candidate id');
 const active=routeById(state,state.activeId);
 if(!active||active.id!==candidateId||active.status!=='active')fail('active candidate');
 if(candidateId===state.baselineId&&baselineExcluded(state))fail('active route is not eligible');
 if(state.pin&&state.pin.candidateId!==candidateId)fail('inconsistent pin');
 const selection=selectAssignment(state,{profile:state.profile,availability,now});
 const eligible=selection.candidateId===candidateId&&selection.status!=='wait';
 const unverified=allowUnverifiedBaseline===true&&candidateId===state.baselineId&&!baselineExcluded(state)&&state.policyVersion===1&&state.previousId===null&&state.activeEvidenceIds.length===0&&active.modelVersion===null&&selection.status==='wait';
 if(!eligible&&!unverified)fail('active route is not eligible');
 if(state.pin?.candidateId===candidateId)return {state,pinned:false,reason:'already_pinned'};
 return {state:{...state,stateVersion:state.stateVersion+1,pin:{candidateId}},pinned:true,reason:'manual_pin_set'};
}
export function unpinCandidate(state){
 if(!state.pin)return {state,pinned:false,reason:'already_unpinned'};
 return {state:{...state,stateVersion:state.stateVersion+1,pin:null},pinned:false,reason:'manual_pin_cleared'};
}
export function selectAssignment(state,{profile,availability=[],now}={}){
 instant(now,'now');if(!matchingProfile(state.profile,profile)||!Array.isArray(profile.criteria)||profile.criteria.length!==state.profile.criteria.length||!state.profile.criteria.every((x,i)=>profile.criteria[i]===x))return {status:'wait',policyVersion:state.policyVersion,evidenceIds:[],reason:'profile_mismatch'};
 const active=routeById(state,state.activeId),base=routeById(state,state.baselineId);
 if(state.pin){
  if(state.pin.candidateId!==state.activeId||active?.status!=='active')return {status:'wait',policyVersion:state.policyVersion,evidenceIds:[],reason:'pinned_route_unavailable'};
  if(active.id===state.baselineId&&baselineExcluded(state))return {status:'wait',policyVersion:state.policyVersion,evidenceIds:[],reason:'baseline_critical_regression'};
  if(!available(active,state.profile,availability,now))return {status:'wait',policyVersion:state.policyVersion,evidenceIds:[],reason:'pinned_route_unavailable'};
  if(active.id!==state.baselineId){
   if(!evidenceCurrent(state,active,now)||state.activeEvidenceIds.length!==active.evidenceRefs?.length||!state.activeEvidenceIds.every((id,i)=>id===active.evidenceRefs[i].id))return {status:'wait',policyVersion:state.policyVersion,evidenceIds:[],reason:'pinned_evidence_expired'};
   return choice(state,active,'selected','profile_scoped_observation',[...state.activeEvidenceIds],'manual_pin_selected');
  }
  return choice(state,active,'fallback','unvalidated_fallback',[],'manual_pin_existing_route_pending_evidence');
 }
 if(active&&active.id!==state.baselineId&&available(active,state.profile,availability,now)&&evidenceCurrent(state,active,now)&&state.activeEvidenceIds.length===active.evidenceRefs.length&&state.activeEvidenceIds.every((id,i)=>id===active.evidenceRefs[i].id))return choice(state,active,'selected','profile_scoped_observation',[...state.activeEvidenceIds],'matched_quality_and_measured_efficiency');
 if(base&&!baselineExcluded(state)&&available(base,state.profile,availability,now))return choice(state,base,'fallback','unvalidated_fallback',[],'existing_route_pending_evidence');
 return {status:'wait',policyVersion:state.policyVersion,evidenceIds:[],reason:base&&baselineExcluded(state)?'baseline_critical_regression':'no_fresh_eligible_route'};
}
