import {createSelectionState,registerCandidate,recordObservation,pruneObservations,promoteCandidate,withdrawCandidate,selectAssignment,pinCandidate,unpinCandidate} from '../public/core/model-selection.mjs';
import {TASK_PINS_SQL,parseTaskEvidencePins} from './policy-retention.mjs';

const PREFIX='model_policy:';
const MAX_PROFILES=32;
const MAX_STATE_BYTES=2_000_000;
const identifier=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const fail=message=>{throw new TypeError(`Invalid model policy ${message}`);};
const conflict=()=>{throw new Error('model policy version conflict');};
function normalizedProfile(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('profile');
 const names=['family','requirementsVersion','evaluationVersion','contextClass'];
 if(names.some(key=>typeof value[key]!=='string'||!identifier.test(value[key])))fail('profile identifier');
 const arrays=[['criteria',8],['requiredCapabilities',16]];
 for(const [key,max] of arrays)if(!Array.isArray(value[key])||value[key].length<1||value[key].length>max||value[key].some(x=>typeof x!=='string'||!identifier.test(x))||new Set(value[key]).size!==value[key].length)fail(key);
 return {family:value.family,requirementsVersion:value.requirementsVersion,evaluationVersion:value.evaluationVersion,criteria:[...value.criteria],requiredCapabilities:[...value.requiredCapabilities],contextClass:value.contextClass};
}
export async function profileKey(profile){
 const encoded=new TextEncoder().encode(JSON.stringify(normalizedProfile(profile)));
 if(encoded.byteLength>3000)fail('profile size');
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoded));
 return PREFIX+Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');
}
function parseState(text,profile){
 if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>MAX_STATE_BYTES)fail('stored state size');
 const state=JSON.parse(text);
 if(!state||state.schemaVersion!==1||JSON.stringify(state.profile)!==JSON.stringify(normalizedProfile(profile))||!Number.isSafeInteger(state.stateVersion)||state.stateVersion<1)fail('stored state');
 if(state.pin!==undefined&&state.pin!==null&&(!state.pin||typeof state.pin!=='object'||Array.isArray(state.pin)||Object.keys(state.pin).length!==1||typeof state.pin.candidateId!=='string'||!identifier.test(state.pin.candidateId)||state.pin.candidateId!==state.activeId))fail('stored pin');
 if(state.pin&&!state.candidates?.some(row=>row.id===state.activeId&&row.status==='active'))fail('stored pin');
 state.pin??=null;
 return state;
}
function serialize(state){
 const text=JSON.stringify(state);
 if(new TextEncoder().encode(text).byteLength>MAX_STATE_BYTES)fail('state size');
 return text;
}
function expected(value){if(!Number.isSafeInteger(value)||value<0)fail('expectedStateVersion');return value;}
function sameCandidate(a,b){return !!a&&a.id===b?.id&&a.provider===b?.provider&&a.model===b?.model&&a.modelVersion===b?.modelVersion&&a.effort===b?.effort;}
function sameObservation(a,b){
 const usage=b.usage?{source:b.usage.source,inputTokens:b.usage.inputTokens??null,outputTokens:b.usage.outputTokens??null,latencyMs:b.usage.latencyMs??null}:null;
 const p=normalizedProfile(b.profile),profileSame=a.profile?.family===p.family&&a.profile?.requirementsVersion===p.requirementsVersion&&a.profile?.evaluationVersion===p.evaluationVersion&&a.profile?.contextClass===p.contextClass&&JSON.stringify(a.profile?.criteria)===JSON.stringify(p.criteria)&&JSON.stringify(a.profile?.requiredCapabilities)===JSON.stringify(p.requiredCapabilities);
 return !!a&&a.source===b.source&&a.observedAt===b.observedAt&&a.provider===b.provider&&a.executionId===b.executionId&&a.generation===b.generation&&a.id===b.id&&a.candidateId===b.candidateId&&a.comparisonId===b.comparisonId&&a.modelVersion===(b.modelVersion??null)&&profileSame&&JSON.stringify(a.quality)===JSON.stringify(b.quality??null)&&JSON.stringify(a.usage)===JSON.stringify(usage);
}

// `verifyObservation` and `getAvailability` are trusted server callbacks, never request payloads.
// The caller must authenticate the execution/review evidence before returning it here.
export function createModelPolicyMethods(adapter,{now=Date.now,getAvailability=()=>[],verifyObservation,validateUnverifiedBaseline}={}){
 const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)fail('clock');return value;};
 const availability=async()=>{const rows=await getAvailability();if(!Array.isArray(rows)||rows.length>100)fail('availability');return rows;};
 async function loaded(profile){const key=await profileKey(profile),raw=await adapter.read(key);if(raw===null)throw new Error('model policy not found');return {key,state:parseState(raw,profile)};}
 async function write(key,oldState,nextState,revision){
  if(nextState===oldState)return oldState;
  const changed=await adapter.compareAndSwap(key,oldState.stateVersion,serialize(nextState),revision);
  if(!changed)conflict();
  return nextState;
 }
 return {
  async read(profile){return (await loaded(profile)).state;},
  async create({profile,baseline,minSamples=3,expectedStateVersion}={}){
   if(expected(expectedStateVersion)!==0)conflict();
   const state=createSelectionState({profile:normalizedProfile(profile),baseline,minSamples}),key=await profileKey(profile),text=serialize(state);
   if(await adapter.create(key,text,MAX_PROFILES))return state;
   const existing=await adapter.read(key);
   if(existing!==null&&existing===text)return parseState(existing,profile);
   if(existing!==null)conflict();
   throw new Error('model policy profile limit reached');
  },
  async register({profile,candidate,expectedStateVersion}={}){
   expected(expectedStateVersion);const {key,state}=await loaded(profile);
   const prior=state.candidates.find(x=>x.id===candidate?.id);
   if(prior&&sameCandidate(prior,candidate))return state;
   if(state.stateVersion!==expectedStateVersion)conflict();
   return write(key,state,registerCandidate(state,candidate));
  },
  async observe({profile,evidenceRef,expectedStateVersion}={}){
   expected(expectedStateVersion);if(arguments[0]&&Object.keys(arguments[0]).some(key=>!['profile','evidenceRef','expectedStateVersion'].includes(key)))fail('observation input');
   if(typeof verifyObservation!=='function')throw new Error('trusted observation verifier required');
   const {key,state}=await loaded(profile),verified=await verifyObservation(evidenceRef,state);
   if(!verified||typeof verified!=='object'||Array.isArray(verified))fail('verified observation');
   const observation={...verified};
   const prior=state.observations.find(x=>x.provider===observation.provider&&x.executionId===observation.executionId&&x.generation===observation.generation);
   if(prior){if(!sameObservation(prior,observation))conflict();return {state,recorded:false,reason:'duplicate_execution'};}
   if(state.stateVersion!==expectedStateVersion)conflict();
   const at=clock(),critical=observation.candidateId===state.activeId&&state.activeId!==state.baselineId&&observation.quality?.source==='independent_review'&&observation.quality.critical===true;
   const noRemoval=critical||state.observations.length<1000&&state.observations.every(x=>x.observedAt>at-90*86_400_000);
   const pins=noRemoval?{ids:[],revision:null}:await adapter.taskPins();
   const availableRows=await availability();
   const result=recordObservation(state,observation,{now:at,availability:availableRows,taskEvidenceIds:pins.ids,preserveAllForCritical:critical});
   if(critical){
    try{serialize(result.state);}catch(error){
     if(!/state size/.test(error.message))throw error;
     const withdrawal=withdrawCandidate(state,state.activeId,{now:at,availability:availableRows});
     return {state:await write(key,state,withdrawal.state),recorded:false,reason:'critical_regression_evidence_capacity'};
    }
   }
   return {...result,state:await write(key,state,result.state,pins.revision)};
  },
  async promote({profile,candidateId,expectedStateVersion}={}){
   expected(expectedStateVersion);const {key,state}=await loaded(profile);
   if(state.stateVersion!==expectedStateVersion){if(state.activeId===candidateId)return {state,promoted:false,reason:'already_active'};conflict();}
   const result=promoteCandidate(state,candidateId,{now:clock(),availability:await availability()});
   return {...result,state:await write(key,state,result.state)};
  },
  async pin({profile,candidateId,expectedStateVersion}={}){
   if(arguments[0]&&Object.keys(arguments[0]).some(key=>!['profile','candidateId','expectedStateVersion'].includes(key)))fail('pin input');
   expected(expectedStateVersion);const {key,state}=await loaded(profile);
   if(state.stateVersion!==expectedStateVersion)conflict();
   const at=clock(),rows=await availability();
   const unverified=state.activeId===state.baselineId&&state.policyVersion===1&&state.previousId===null&&state.activeEvidenceIds.length===0&&state.candidates.find(x=>x.id===state.activeId)?.modelVersion===null;
   const allowed=unverified&&typeof validateUnverifiedBaseline==='function'&&await validateUnverifiedBaseline(state);
   const result=pinCandidate(state,candidateId,{now:at,availability:rows,allowUnverifiedBaseline:allowed});
   return {...result,state:await write(key,state,result.state)};
  },
  async unpin({profile,expectedStateVersion}={}){
   if(arguments[0]&&Object.keys(arguments[0]).some(key=>!['profile','expectedStateVersion'].includes(key)))fail('unpin input');
   expected(expectedStateVersion);const {key,state}=await loaded(profile);
   if(state.stateVersion!==expectedStateVersion)conflict();
   const result=unpinCandidate(state);
   return {...result,state:await write(key,state,result.state)};
  },
  async withdraw({profile,candidateId,expectedStateVersion}={}){
   expected(expectedStateVersion);const {key,state}=await loaded(profile);
   if(state.stateVersion!==expectedStateVersion){if(state.candidates.some(x=>x.id===candidateId&&x.status==='withdrawn'))return {state,withdrawn:false,reason:'already_withdrawn'};conflict();}
   const result=withdrawCandidate(state,candidateId,{now:clock(),availability:await availability()});
   return {...result,state:await write(key,state,result.state)};
  },
  async select(profile){const {state}=await loaded(profile);return selectAssignment(state,{profile:normalizedProfile(profile),now:clock(),availability:await availability()});},
  async prune({profile,expectedStateVersion}={}){
   expected(expectedStateVersion);const {key,state}=await loaded(profile);
   if(state.stateVersion!==expectedStateVersion)conflict();
   const at=clock();
   if(state.observations.length<=1000&&state.observations.every(x=>x.observedAt>at-90*86_400_000))return {...pruneObservations(state,{now:at}),state};
   const pins=await adapter.taskPins();
   const result=pruneObservations(state,{now:at,taskEvidenceIds:pins.ids});
   return {...result,state:await write(key,state,result.state,pins.revision)};
  },
  async retentionStatus(){const raw=await adapter.read('model_policy_retention_status');return raw===null?{status:'never_run',removed:0,retainedExceptions:0,deferredCount:0,failedCount:0}:JSON.parse(raw);},
  async cleanupBatch({limit=4}={}){
   if(!Number.isSafeInteger(limit)||limit<1||limit>8)fail('cleanup batch limit');
   const at=clock(),priorRaw=await adapter.read('model_policy_retention_status');
   const prior=priorRaw===null?{status:'never_run',removed:0,retainedExceptions:0,deferredCount:0,failedCount:0}:JSON.parse(priorRaw);
   if(prior.nextAt&&prior.nextAt>at)return prior;
   const cursor=prior.cursor??PREFIX;
   let rows;
   try{rows=await adapter.list(cursor,limit);}catch{
    const failed={...prior,status:'failed',lastAttemptAt:at,failedCount:(prior.failedCount??0)+1,lastError:'profile_scan_failed',nextAt:at+3_600_000};
    if(!await adapter.writeStatus(JSON.stringify(failed),priorRaw))return this.retentionStatus();
    return failed;
   }
   let removed=prior.cursor?prior.removed:0,retainedExceptions=prior.cursor?prior.retainedExceptions:0,deferredCount=prior.cursor?prior.deferredCount:0,failedCount=prior.cursor?prior.failedCount:0;
   for(const row of rows){
    try{
     const state=JSON.parse(row.value);
     const result=await this.prune({profile:state.profile,expectedStateVersion:state.stateVersion});
     removed+=result.removed;retainedExceptions+=result.expiredPinned+result.overLimit;
    }catch(error){
     if(/deferred|conflict/i.test(error.message))deferredCount++;else failedCount++;
    }
   }
   const complete=rows.length<limit;
   const next={status:!complete?'running':failedCount?'failed':deferredCount?'deferred':'complete',lastAttemptAt:at,lastCleanupAt:removed?at:prior.lastCleanupAt??null,removed,retainedExceptions,deferredCount,failedCount,lastError:failedCount?'policy_cleanup_failed':deferredCount?'pin_scan_deferred':null,cursor:complete?null:rows.at(-1).key,nextAt:complete?at+(failedCount||deferredCount?3_600_000:86_400_000):null};
   if(!await adapter.writeStatus(JSON.stringify(next),priorRaw))return this.retentionStatus();
   return next;
  },
 };
}

export class D1ModelPolicies{
 constructor(db,options={}){
  if(!db)fail('database');
  const adapter={
   read:async key=>(await db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first())?.value??null,
   list:async(after,limit)=>(await db.prepare("SELECT key,value FROM metadata WHERE key LIKE 'model_policy:%' AND key>?1 ORDER BY key LIMIT ?2").bind(after,limit).all()).results,
   taskPins:async()=>{
    const revision=Number((await db.prepare("SELECT value FROM metadata WHERE key='revision'").first())?.value??0);
    const rows=(await db.prepare(TASK_PINS_SQL).all()).results;
    return {revision,ids:parseTaskEvidencePins(rows)};
   },
   writeStatus:async(text,priorRaw)=>{
    const result=await db.prepare("INSERT INTO metadata(key,value) SELECT 'model_policy_retention_status',?1 WHERE (?2 IS NULL AND NOT EXISTS(SELECT 1 FROM metadata WHERE key='model_policy_retention_status')) OR (SELECT value FROM metadata WHERE key='model_policy_retention_status')=?2 ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE metadata.value=?2").bind(text,priorRaw).run();
    return Number(result.meta?.changes??0)===1;
   },
   create:async(key,text,limit)=>{
    const results=await db.batch([
     db.prepare("INSERT INTO metadata(key,value) SELECT ?1,?2 WHERE (SELECT COUNT(*) FROM metadata WHERE key LIKE 'model_policy:%') < ?3 ON CONFLICT(key) DO NOTHING").bind(key,text,limit),
     db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision' AND changes()=1"),
    ]);return Number(results[0]?.meta?.changes??0)===1;
   },
   compareAndSwap:async(key,version,text,revision)=>{
    const results=await db.batch([
     db.prepare("UPDATE metadata SET value=?1 WHERE key=?2 AND json_extract(value,'$.stateVersion')=?3 AND (?4 IS NULL OR (SELECT value FROM metadata WHERE key='revision')=?4)").bind(text,key,version,revision??null),
     db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision' AND changes()=1"),
    ]);return Number(results[0]?.meta?.changes??0)===1;
   },
  };
  Object.assign(this,createModelPolicyMethods(adapter,options));
 }
}
