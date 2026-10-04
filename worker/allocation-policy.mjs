import {D1ModelPolicies,MAX_MODEL_POLICY_PROFILES,profileKey} from './model-policies.mjs';
import {ValidationError} from '../public/core/tasks.mjs';
import {baselineExcluded,createSelectionState} from '../public/core/model-selection.mjs';
import {providerModels} from '../public/core/providers.mjs';

const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const instant=value=>Date.parse(value);

// The request supplies task requirements, never a policy identity or evidence.
export async function delegationProfile(child){
 const criteria=await Promise.all(child.acceptanceCriteria.map(async text=>'c'+(await digest(text.normalize('NFC'))).slice(0,32)));
 return {family:'delegation_'+child.provider,requirementsVersion:'r'+(await digest(JSON.stringify([child.role,child.instructions,child.sourceIds??[]]))).slice(0,32),evaluationVersion:'e'+(await digest(JSON.stringify(criteria))).slice(0,32),criteria,requiredCapabilities:child.sourceIds?.length?['text','source_view']:['text'],contextClass:`text_${Math.ceil(child.instructions.length/4000)}_sources_${Math.min(child.sourceIds?.length??0,20)}`};
}

// This metadata is written only by trusted runtime ingestion, never from delegation input.
// The desktop list does not include exact serving versions or capabilities.
export async function availabilitySnapshot(store,catalog){
 const row=await store.db.prepare("SELECT value FROM metadata WHERE key='model_policy_availability'").first();
 let observations=[];
 try{observations=JSON.parse(row?.value??'[]');}catch{}
 const now=instant(store.now());
 const rows=Array.isArray(observations)?observations.filter(x=>x?.source==='account_catalog'&&providerModels(x.provider)?.catalog==='account_catalog'&&typeof x.modelVersion==='string'&&x.modelVersion.length>0&&catalog.availability==='fresh'&&catalog.codex.some(m=>m.model===x.model&&x.efforts?.every(e=>m.efforts.includes(e)))&&Number.isSafeInteger(x.observedAt)&&x.observedAt<=now&&x.expiresAt>now&&x.expiresAt-x.observedAt<=7_200_000):[];
 return {rows:rows.slice(0,100),raw:row?.value??null};
}

export function unverifiedBaselineRoute(state,choice,provider){
 const baseline=state?.candidates.find(x=>x.id===state.baselineId);
 return choice?.status==='wait'&&!baselineExcluded(state)&&(!state?.pin||state.pin.candidateId===state.activeId)&&state?.policyVersion===1&&state?.previousId===null&&state?.activeEvidenceIds.length===0&&state?.activeId===state?.baselineId&&baseline?.status==='active'&&baseline.modelVersion===null&&baseline.provider===provider?baseline:null;
}

export async function resolveAllocationPolicy(store,catalog,assignments){
 const account=await catalog.read(),availability=await availabilitySnapshot(store,account);
 const catalogRow=await store.db.prepare("SELECT value FROM metadata WHERE key='desktop_models'").first();
 const guards=[{key:'desktop_models',value:catalogRow?.value??null,...(account.reportedAt!==null?{expiresAt:account.reportedAt+7_200_000}:{})},{key:'model_policy_availability',value:availability.raw}];
 const policies=new D1ModelPolicies(store.db,{now:()=>instant(store.now()),getAvailability:()=>availability.rows});
 const count=Number((await store.db.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key GLOB 'model_policy:*'").first()).n);
 let slots=Math.max(0,MAX_MODEL_POLICY_PROFILES-count);
 const resolved=[],initialPolicies=[];
 for(const child of assignments){
  const profile=await delegationProfile(child),key=await profileKey(profile);
  let state=null,choice=null;
  try{state=await policies.read(profile);choice=await policies.select(profile);}catch(error){if(error.message!=='model policy not found')throw error;}
  guards.push({key,stateVersion:state?.stateVersion??null});
  const unverifiedBaseline=unverifiedBaselineRoute(state,choice,child.provider);
  if(choice?.status==='wait'&&!unverifiedBaseline)throw new ValidationError(`No fresh eligible policy route for ${child.provider}: ${choice.reason}`);
  if(choice?.provider&&choice.provider!==child.provider)throw new ValidationError('Policy provider differs from fixed child provider');
  const promoted=choice?.status==='selected';
  if(choice?.status==='selected'||choice?.status==='fallback'){
   const matched=availability.rows.find(x=>x.provider===choice.provider&&x.model===choice.model&&x.modelVersion===choice.modelVersion&&x.efforts.includes(choice.effort)&&profile.requiredCapabilities.every(c=>x.capabilities.includes(c))&&x.contextClasses.includes(profile.contextClass));
   if(!matched)throw new ValidationError('Policy route lost trusted availability');
   guards.push({key:'model_policy_availability',value:availability.raw,expiresAt:matched.expiresAt});
  }
  if(promoted){
   const evidence=choice.evidenceIds.map(id=>state.observations.find(row=>row.id===id));
   if(evidence.some(row=>!row))throw new ValidationError('Selected policy evidence is missing');
   guards.push({key,stateVersion:state.stateVersion,expiresAt:Math.min(...evidence.map(row=>row.observedAt+90*86_400_000))});
  }
  const policyRoute=choice?.status==='fallback'||promoted;
  const model=policyRoute?choice.model:unverifiedBaseline?unverifiedBaseline.model:child.requestedModel,effort=policyRoute?choice.effort:unverifiedBaseline?unverifiedBaseline.effort:child.effort;
  // Even a valid policy cannot skip the account's present model/effort check.
  await catalog.validate([{provider:child.provider,requestedModel:model,effort}]);
  let initializing=false;
  if(!state&&slots>0&&!initialPolicies.some(item=>item.key===key)){
   initialPolicies.push({key,state:createSelectionState({profile,baseline:{id:'baseline',provider:child.provider,model:child.requestedModel,modelVersion:null,effort:child.effort}})});
   slots--;initializing=true;
  }
  const selection=promoted
   ?{status:'selected',policyVersion:choice.policyVersion,evidenceIds:[...choice.evidenceIds],reason:choice.reason,modelVersion:choice.modelVersion,profile}
   :{status:'fallback',policyVersion:state?.policyVersion??(initializing?1:null),evidenceIds:[],reason:unverifiedBaseline||initializing?'baseline_version_unverified':choice?.reason??'policy_capacity_unavailable',modelVersion:null,profile,confidence:'unvalidated_fallback'};
  resolved.push({...child,requestedModel:model,effort,selection});
 }
 return {assignments:resolved,guards,initialPolicies};
}
