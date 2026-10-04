import {delegationProfile} from './allocation-policy.mjs';
import {sanitizeSourceView} from '../public/core/source-coverage.mjs';

const refKeys=['parentTaskId','childTaskId','reviewExecutionId','reviewGeneration','childExecutionId','childGeneration'];
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const no=reason=>({status:'not_attributable',reason});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const time=value=>typeof value==='string'?Date.parse(value):NaN;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function digest(value){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))));}
function validRef(ref){
 return ref&&typeof ref==='object'&&!Array.isArray(ref)&&same(Object.keys(ref).sort(),[...refKeys].sort())&&
  ['parentTaskId','childTaskId','reviewExecutionId','childExecutionId'].every(k=>typeof ref[k]==='string'&&id.test(ref[k]))&&
  ['reviewGeneration','childGeneration'].every(k=>Number.isSafeInteger(ref[k])&&ref[k]>=1&&ref[k]<=1_000_000);
}
function matchesOwner(task,executionId,generation){return task.checkpoint?.executionId===executionId&&task.checkpoint?.generation===generation;}
function mapping(assignment,row){
 const expected=assignment?.acceptanceCriteria;
 if(!Array.isArray(expected)||expected.length<1||expected.length>8||new Set(expected).size!==expected.length||!Array.isArray(row?.criteria)||row.criteria.length!==expected.length)return null;
 const found=new Map();
 for(const item of row.criteria){
  if(!expected.includes(item?.criterion)||found.has(item.criterion)||!['pass','fail','unverifiable'].includes(item.status)||typeof item.evidence!=='string'||!item.evidence.trim()||item.evidence.length>2000)return null;
  found.set(item.criterion,item.status);
 }
 return expected.map(criterion=>found.get(criterion));
}
function sameAssignment(a,b){
 return !!a&&!!b&&['provider','requestedModel','effort','role','instructions'].every(k=>a[k]===b[k])&&same(a.acceptanceCriteria,b.acceptanceCriteria)&&same(a.sourceIds??[],b.sourceIds??[])&&same(a.selection,b.selection);
}
function sourceSignature(parent,child){
 const attachments=child.attachments??[];
 const sourceIds=child.assignment.sourceIds??[],parentAttachments=parent.attachments??[];
 if(!Array.isArray(attachments)||attachments.length>20||new Set(attachments.map(x=>x?.id)).size!==attachments.length||!Array.isArray(sourceIds)||sourceIds.length!==attachments.length||new Set(sourceIds).size!==sourceIds.length||sourceIds.some(x=>typeof x!=='string'||x.length>200)||!Array.isArray(parentAttachments)||parentAttachments.length>20||typeof child.prompt!=='string'||child.prompt.length>12000)return null;
 const refs=[];let unhashedSource=false;
 for(const a of attachments){
  if(typeof a?.id!=='string'||a.id.length>200||!sourceIds.includes(a.id)||typeof a.name!=='string'||a.name.length>500||typeof a.path!=='string'||a.path.length>2000||!Number.isSafeInteger(a.size)||a.size<0||!Number.isSafeInteger(a.lastModified)||a.lastModified<0)return null;
  const original=parentAttachments.find(x=>x.id===a.id);
  if(!original||parentAttachments.filter(x=>x.id===a.id).length!==1||['name','path','size','lastModified','source','url'].some(k=>original[k]!==a[k]))return null;
  const source=a.source??'file';
  if(!['file','folder','url'].includes(source)||source==='url'&&(typeof a.url!=='string'||a.url.length>2000))return null;
  let view=null;
  try{
   if(original.view||a.view){
    if(!original.view||!a.view)return null;
    view=sanitizeSourceView(a.view,{source,size:a.size});
    if(!same(view,sanitizeSourceView(original.view,{source,size:original.size})))return null;
   }else unhashedSource=true;
  }catch{return null;}
  refs.push([a.id,a.name,a.path,a.size,a.lastModified,source,source==='url'?a.url:null,view]);
 }
 // Parent and batch scope prevents equal generic prompts on unrelated jobs from pairing.
 return [parent.id,parent.delegation.batchId,child.prompt,sourceIds,refs,...(unhashedSource?[['unhashed_source_execution',child.id,child.checkpoint?.executionId,child.checkpoint?.generation]]:[])];
}

// Reads only durable task state. A caller provides identity references, never scores,
// model claims, timestamps, or usage. An independent parent AI judgment is not human proof.
export async function verifyReviewObservation(store,evidenceRef,state){
 if(!validRef(evidenceRef))return no('invalid_evidence_reference');
 let parent,child;
 try{[parent,child]=await Promise.all([store.requireTask(evidenceRef.parentTaskId),store.requireTask(evidenceRef.childTaskId)]);}catch(error){if(error?.statusCode===404)return no('evidence_task_missing');throw error;}
 if(parent?.id!==evidenceRef.parentTaskId||child?.id!==evidenceRef.childTaskId||parent.id===child.id||parent.status!=='completed'||child.status!=='completed'||parent.delegation?.state!=='completed')return no('incomplete_or_self_review');
 const d=parent.delegation,review=parent.checkpoint,owner=child.checkpoint;
 if(!matchesOwner(parent,evidenceRef.reviewExecutionId,evidenceRef.reviewGeneration)||!matchesOwner(child,evidenceRef.childExecutionId,evidenceRef.childGeneration)||review.executionId===owner.executionId||review.provider!==d.masterProvider||owner.provider!==child.assignment?.provider)return no('stale_execution_owner');
 if(child.parentTaskId!==parent.id||child.batchId!==d.batchId||child.parentEpoch!==d.epoch||typeof d.batchId!=='string'||!Number.isSafeInteger(d.epoch)||d.epoch<1)return no('stale_delegation_batch');
 const assignments=d.children,manifests=d.review?.children,report=d.reviewReport;
 if(!Array.isArray(assignments)||assignments.length!==2||!Array.isArray(manifests)||manifests.length!==2||!Array.isArray(report)||report.length!==2)return no('review_mapping_mismatch');
 const assignmentIds=assignments.map(x=>x?.taskId);
 const sameIds=values=>new Set(values).size===2&&same([...values].sort(),[...assignmentIds].sort());
 if(assignmentIds.some(x=>typeof x!=='string'||!id.test(x))||new Set(assignmentIds).size!==2||!assignmentIds.includes(child.id)||!sameIds(manifests.map(x=>x?.taskId))||!sameIds(report.map(x=>x?.childTaskId)))return no('review_mapping_mismatch');
 let targetAssignment,targetStatuses;
 for(const assignment of assignments){
  const row=report.find(x=>x.childTaskId===assignment.taskId),statuses=mapping(assignment,row);
  if(!statuses)return no('review_mapping_mismatch');
  if(assignment.taskId===child.id){targetAssignment=assignment;targetStatuses=statuses;}
 }
 if(!sameAssignment(targetAssignment,child.assignment))return no('saved_assignment_mismatch');
 const profile=await delegationProfile(targetAssignment);
 if(!same(profile,targetAssignment.selection?.profile)||!same(profile,child.assignment.selection?.profile)||!same(profile,state?.profile))return no('saved_profile_mismatch');
 const signature=sourceSignature(parent,child);
 if(!signature)return no('invalid_comparable_input');
 const evidence=owner.executionEvidence;
 if(evidence){
  if(evidence.source!=='cli_arguments')return no('unsupported_model_evidence_source');
  if(evidence.provider!==owner.provider||(evidence.executionId!==undefined&&evidence.executionId!==owner.executionId)||(evidence.generation!==undefined&&evidence.generation!==owner.generation)||(evidence.requestedModel&&evidence.requestedModel!==targetAssignment.requestedModel)||(evidence.requestedEffort&&evidence.requestedEffort!==targetAssignment.effort)||(evidence.cliAppliedModel&&evidence.cliAppliedModel!==targetAssignment.requestedModel)||(evidence.cliAppliedEffort&&evidence.cliAppliedEffort!==targetAssignment.effort))return no('execution_evidence_mismatch');
  if(evidence.routeConditions!==undefined&&evidence.routeConditions!==null&&(typeof evidence.routeConditions!=='string'||!/^[0-9a-f]{64}$/.test(evidence.routeConditions)))return no('execution_evidence_mismatch');
  if(evidence.actualModelVersion!==null&&evidence.actualModelVersion!==undefined)return no('unverified_model_version');
 }
 // Current durable CLI evidence has no serving-model attestation.
 const actualModelVersion=null;
 // The evaluated route is what the runner applied through CLI arguments under recorded run
 // conditions, never a model's own claim. Evidence without conditions stays route-less.
 const route=evidence&&typeof evidence.routeConditions==='string'&&evidence.cliAppliedModel===targetAssignment.requestedModel&&evidence.cliAppliedEffort===targetAssignment.effort
  ?{basis:'cli_arguments',model:evidence.cliAppliedModel,effort:evidence.cliAppliedEffort,conditions:evidence.routeConditions}:null;
 const candidates=state?.candidates?.filter(x=>x.provider===targetAssignment.provider&&x.model===targetAssignment.requestedModel&&x.effort===targetAssignment.effort&&x.modelVersion===actualModelVersion)??[];
 if(candidates.length!==1)return no(actualModelVersion===null?'unverified_model_version':'candidate_route_mismatch');
 if(targetAssignment.selection?.modelVersion&&targetAssignment.selection.modelVersion!==actualModelVersion)return no('saved_selection_version_mismatch');
 const observedAt=time(review.completedAt),reviewClaimedAt=time(review.claimedAt),claimedAt=time(owner.claimedAt),completedAt=time(owner.completedAt);
 if(!Number.isSafeInteger(observedAt)||observedAt<0||!Number.isSafeInteger(reviewClaimedAt)||reviewClaimedAt<completedAt||observedAt<reviewClaimedAt||!Number.isSafeInteger(completedAt)||completedAt<0)return no('invalid_completion_time');
 const latencyMs=Number.isSafeInteger(claimedAt)&&claimedAt>=0&&completedAt>=claimedAt?completedAt-claimedAt:null;
 const usage=owner.usage;
 const ownedUsage=usage?.provider===owner.provider&&usage.executionId===owner.executionId&&usage.generation===owner.generation&&usage.source==='executor_report'?usage:null;
 const inputTokens=count(ownedUsage?.inputTokens),outputTokens=count(ownedUsage?.outputTokens);
 const observation={
  id:'ro_'+await digest([parent.id,child.id,review.executionId,review.generation,owner.executionId,owner.generation]),
  provider:owner.provider,executionId:owner.executionId,generation:owner.generation,candidateId:candidates[0].id,modelVersion:actualModelVersion,...(route?{route}:{}),
  comparisonId:'pair_'+await digest(signature),profile,observedAt,source:'normal_execution',
  quality:{source:'independent_review',critical:false,criteria:profile.criteria.map((id,i)=>({id,status:targetStatuses[i]}))},
  usage:{source:ownedUsage?'executor_report':'server_metered',inputTokens,outputTokens,latencyMs},
 };
 return {status:'verified',verdict:'independent_reviewed_model_judgment',observation};
}
