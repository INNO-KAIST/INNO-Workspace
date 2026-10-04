import {ConflictError,ValidationError} from '../public/core/tasks.mjs';
import {delegationProfile,availabilitySnapshot,unverifiedBaselineReason,unverifiedBaselineRoute} from './allocation-policy.mjs';
import {D1ModelPolicies} from './model-policies.mjs';
import {providerModels} from '../public/core/providers.mjs';

const own=(value,allowed,label)=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new ValidationError(`Invalid ${label}`);
 return value;
};
const missing=error=>error?.message==='model policy not found';
const translate=error=>{
 if(error instanceof TypeError&&/^Invalid model (?:policy|selection)/.test(error.message))throw new ValidationError(error.message);
 if(error?.message==='model policy version conflict')throw new ConflictError(error.message);
 if(missing(error)){const notFound=new Error(error.message);notFound.statusCode=404;throw notFound;}
 throw error;
};
const candidateSummary=({id,provider,model,modelVersion,effort,status})=>({id,provider,model,modelVersion,effort,status});
const projection=state=>state?{
 stateVersion:state.stateVersion,policyVersion:state.policyVersion,baselineId:state.baselineId,activeId:state.activeId,pin:state.pin??null,
 minSamples:state.minSamples,observationCount:state.observations.length,
 baseline:candidateSummary(state.candidates.find(row=>row.id===state.baselineId)),
 candidates:state.candidates.map(candidateSummary),
}:null;
const accountChoices=(provider,account,assignment)=>{
 const declared=providerModels(provider);
 if(declared?.catalog==='built_in_roles')return {provider,source:'built_in_catalog',status:'static_supported_models_unverified',observedAt:null,expiresAt:null,effortSource:'assignment_planning_intent',models:declared.roles.map(model=>({model,efforts:[assignment.effort]}))};
 const observedAt=Number.isFinite(account.reportedAt)&&account.reportedAt>=0?account.reportedAt:null;
 return {provider,source:'desktop_account_catalog',status:account.availability,observedAt,expiresAt:observedAt===null?null:observedAt+7_200_000,effortSource:'account_catalog',
  models:account.codex.map(({model,efforts})=>({model,efforts:[...efforts]}))};
};

export function createTaskPolicyManagement(store,catalog){
 async function context(taskId){
  const child=await store.requireTask(taskId);
  if(!child.parentTaskId||!child.assignment?.selection?.profile||child.provenance)throw new ValidationError('Task has no trusted policy assignment');
  const parent=await store.requireTask(child.parentTaskId);
  const parentChild=parent.delegation?.children?.find(row=>row.taskId===child.id);
  if(!parentChild||parent.provenance||parentChild.provider!==child.assignment.provider||JSON.stringify((({taskId,...rest})=>rest)(parentChild))!==JSON.stringify(child.assignment))throw new ValidationError('Task has no trusted policy assignment');
  const profile=await delegationProfile(child.assignment);
  if(JSON.stringify(profile)!==JSON.stringify(child.assignment.selection.profile))throw new ValidationError('Task policy profile does not match its frozen assignment');
  const account=await catalog.read(),snapshot=await availabilitySnapshot(store,account);
  const policies=new D1ModelPolicies(store.db,{now:()=>Date.parse(store.now()),getAvailability:()=>snapshot.rows,
   validateUnverifiedBaseline:async state=>{
    const baseline=unverifiedBaselineRoute(state,{status:'wait'},child.assignment.provider);
    if(!baseline)return false;
    await catalog.validate([{provider:baseline.provider,requestedModel:baseline.model,effort:baseline.effort}]);
    return true;
   },
  });
  return {child,profile,account,policies};
 }
 async function view(ctx,reason){
  let state=null,route=null;
  try{state=await ctx.policies.read(ctx.profile);route=await ctx.policies.select(ctx.profile);}catch(error){if(!missing(error))throw error;}
  const baseline=unverifiedBaselineRoute(state,route,ctx.child.assignment.provider);
  if(baseline){
   try{
    await catalog.validate([{provider:baseline.provider,requestedModel:baseline.model,effort:baseline.effort}]);
    route={status:'fallback',candidateId:baseline.id,provider:baseline.provider,model:baseline.model,modelVersion:null,effort:baseline.effort,policyVersion:state.policyVersion,evidenceIds:[],confidence:'unvalidated_fallback',reason:unverifiedBaselineReason(state)};
   }catch(error){if(!(error instanceof ValidationError))throw error;route={status:'wait',policyVersion:state.policyVersion,evidenceIds:[],reason:'account_model_unavailable'};}
  }
  const provider=ctx.child.assignment.provider;
  const accountAvailability=accountChoices(provider,ctx.account,ctx.child.assignment);
  return {taskId:ctx.child.id,profile:ctx.profile,accountAvailability,
   assignment:{provider:ctx.child.assignment.provider,model:ctx.child.assignment.requestedModel,effort:ctx.child.assignment.effort,selection:ctx.child.assignment.selection},
   policy:projection(state),route,...(reason?{reason}:{})};
 }
 return {
  async read(taskId){try{return await view(await context(taskId));}catch(error){translate(error);}},
  async apply(taskId,input){
   try{
    own(input,['operation','expectedStateVersion','candidate','candidateId'],'policy operation');
    if(!Number.isSafeInteger(input.expectedStateVersion)||input.expectedStateVersion<0)throw new ValidationError('expectedStateVersion is required');
    const ctx=await context(taskId),assignment=ctx.child.assignment;
    let result;
    switch(input.operation){
     case 'initialize':{
      own(input,['operation','expectedStateVersion'],'policy initialization');
      await catalog.validate([{provider:assignment.provider,requestedModel:assignment.requestedModel,effort:assignment.effort}]);
      result=await ctx.policies.create({profile:ctx.profile,baseline:{id:'baseline',provider:assignment.provider,model:assignment.requestedModel,modelVersion:null,effort:assignment.effort},expectedStateVersion:input.expectedStateVersion});
      break;
     }
     case 'register_candidate':{
      own(input,['operation','expectedStateVersion','candidate'],'candidate registration');
      const candidate=own(input.candidate,['id','model','effort'],'policy candidate');
      if(['id','model','effort'].some(key=>typeof candidate[key]!=='string'))throw new ValidationError('Candidate id, model and effort are required');
      await catalog.validate([{provider:assignment.provider,requestedModel:candidate.model,effort:candidate.effort}]);
      result=await ctx.policies.register({profile:ctx.profile,candidate:{id:candidate.id,provider:assignment.provider,model:candidate.model,modelVersion:null,effort:candidate.effort},expectedStateVersion:input.expectedStateVersion});
      break;
     }
     case 'promote':
     case 'withdraw':{
      own(input,['operation','expectedStateVersion','candidateId'],'policy transition');
      if(typeof input.candidateId!=='string')throw new ValidationError('candidateId is required');
      result=await ctx.policies[input.operation]({profile:ctx.profile,candidateId:input.candidateId,expectedStateVersion:input.expectedStateVersion});
      break;
     }
     case 'pin':{
      own(input,['operation','expectedStateVersion','candidateId'],'policy pin');
      if(typeof input.candidateId!=='string')throw new ValidationError('candidateId is required');
      result=await ctx.policies.pin({profile:ctx.profile,candidateId:input.candidateId,expectedStateVersion:input.expectedStateVersion});
      break;
     }
     case 'unpin':{
      own(input,['operation','expectedStateVersion'],'policy unpin');
      result=await ctx.policies.unpin({profile:ctx.profile,expectedStateVersion:input.expectedStateVersion});
      break;
     }
     default:throw new ValidationError('Unknown policy operation');
    }
    return view(ctx,result?.reason);
   }catch(error){translate(error);}
  },
 };
}
