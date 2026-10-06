import {delegationAttachments,validateDelegationSourceIds} from './delegation-sources.mjs';
import {usageHistory} from './execution-usage.mjs';
import {ConflictError,ValidationError,createTask} from './tasks.mjs';
import {isAssignableProvider} from './providers.mjs';
import {validatePluginSelection} from './plugins.mjs';
const bounded=(value,label,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new ValidationError(`Invalid delegation ${label}`);return value.trim();};
// A master splits independent work into 2 to 4 children in any provider mix with
// distinct roles (user decision 2026-10-06, H7).
export const DELEGATION_MIN_CHILDREN=2,DELEGATION_MAX_CHILDREN=4;
export function validateAssignments(parent,input,options={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ValidationError('Delegation input is required');
 if(parent.evaluationBudget)throw new ValidationError('Evaluation budget task cannot use ordinary delegation');
 const sourceUrl=value=>typeof value==='string'&&/(?:https?:\/\/|www\.)\S+/i.test(value);
 if(sourceUrl(parent.prompt)||(parent.messages??[]).some(m=>m.role==='user'&&sourceUrl(m.content)))throw new ValidationError('Source URL references are not supported in this delegation release');
 if(parent.parentTaskId)throw new ValidationError('A child cannot perform nested delegation');
 if(parent.checkpoint?.sourceBound&&(options.sourceDelegationVersion!==1||!parent.attachments?.length))throw new ValidationError('Source-bound executions cannot delegate');
 if((parent.attachments?.length&&options.sourceDelegationVersion!==1)||input.attachments?.length||input.materials?.length)throw new ValidationError('Delegation cannot transfer source attachments');
 if(input.independent!==true)throw new ValidationError('Independent assignments are required');
 if(!Array.isArray(input.children)||input.children.length<DELEGATION_MIN_CHILDREN||input.children.length>DELEGATION_MAX_CHILDREN)throw new ValidationError('Delegation requires 2 to 4 children');
 const children=input.children.map(c=>{
  if(!c||typeof c!=='object'||c.attachments?.length||c.materials?.length||c.dependencies?.length)throw new ValidationError('Independent source-free children are required');
  if(sourceUrl(c.instructions))throw new ValidationError('Source URLs are not supported in delegated instructions');
  if(!isAssignableProvider(c.provider))throw new ValidationError('Invalid delegation provider');
  const sourceIds=validateDelegationSourceIds(c.sourceIds,options);
  delegationAttachments(parent,sourceIds,options);
  const requestedModel=bounded(c.requestedModel,'requestedModel',100);
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(requestedModel))throw new ValidationError('Invalid delegation model identifier');
  if(!['none','minimal','low','medium','high','xhigh','max'].includes(c.effort))throw new ValidationError('Invalid delegation effort');
  if(!Array.isArray(c.acceptanceCriteria)||c.acceptanceCriteria.length<1||c.acceptanceCriteria.length>8)throw new ValidationError('Acceptance criteria require 1 to 8 items');
  const acceptanceCriteria=c.acceptanceCriteria.map(v=>bounded(v,'acceptance criterion',1000));
  if(new Set(acceptanceCriteria).size!==acceptanceCriteria.length)throw new ValidationError('Duplicate acceptance criteria');
  const plugins=c.plugins===undefined?[]:validatePluginSelection(c.plugins);
  return {...(sourceIds.length?{sourceIds}:{}),...(plugins.length?{plugins}:{}),role:bounded(c.role,'role',100),provider:c.provider,requestedModel,effort:c.effort,sufficientReason:bounded(c.sufficientReason,'sufficientReason',1000),acceptanceCriteria,instructions:bounded(c.instructions,'instructions',12000)};
 });
 if(new Set(children.map(c=>c.role)).size!==children.length)throw new ValidationError('Children require distinct roles');
 return children;
}
export function isDelegationReplay(parent,input){const d=parent.delegation;return !!d&&d.state!=='superseded'&&d.sourceExecutionId===input.executionId&&d.sourceGeneration===input.generation;}
export function allocateDelegation(parent,input,{now,id,sourceDelegationVersion=0,assignments:resolvedAssignments}={}){
 const options={sourceDelegationVersion};
 const validated=validateAssignments(parent,input,options);
 const assignments=resolvedAssignments??validated;
 if(resolvedAssignments&&(!Array.isArray(resolvedAssignments)||resolvedAssignments.length!==validated.length||resolvedAssignments.some((x,i)=>x.provider!==validated[i].provider||x.role!==validated[i].role)))throw new ValidationError('Invalid resolved delegation assignments');
 if(parent.delegation&&parent.delegation.state!=='superseded')throw new ConflictError('Task already has a delegation batch',parent.version);
 if(parent.status!=='running'||parent.checkpoint?.executionId!==input.executionId||parent.checkpoint?.generation!==input.generation)throw new ConflictError('Stale delegation execution owner',parent.version);
 const content=input.content===undefined?undefined:bounded(input.content,'master interpretation',12000);
 const batchId=id(),at=now();
 const children=assignments.map(assignment=>({...createTask({prompt:assignment.instructions,title:assignment.role,attachments:delegationAttachments(parent,assignment.sourceIds,options)},{now:()=>at,id}),status:'queued',parentTaskId:parent.id,batchId,parentEpoch:1,assignment,...(assignment.plugins?.length?{plugins:assignment.plugins}:{}),checkpoint:{provider:assignment.provider,status:'queued',generation:0,updatedAt:at}}));
 return {parent:{...parent,...(content?{messages:[...parent.messages,{id:id(),role:'assistant',content,createdAt:at}]}:{}),status:'waiting_children',version:parent.version+1,updatedAt:at,delegation:{...(sourceDelegationVersion===1&&parent.attachments?.length?{sourceDelegationVersion:1}:{}),batchId,sourceExecutionId:input.executionId,sourceGeneration:input.generation,masterProvider:parent.checkpoint.provider,state:'waiting_children',epoch:1,retryCount:0,children:children.map(c=>({taskId:c.id,...c.assignment}))},checkpoint:{...parent.checkpoint,usageHistory:usageHistory(parent.checkpoint,input.usage,at,{task:parent,transition:'delegation'}),status:'waiting_children',executionId:undefined,expiresAt:undefined,updatedAt:at}},children};
}
export function buildReview(parent,children){
 let count=0,total=0;
 const records=children.map((child,childIndex)=>{
  if(child.status!=='completed'||child.parentTaskId!==parent.id||child.batchId!==parent.delegation.batchId)throw new ValidationError('Review requires completed children from this batch');
  const summary=bounded(child.messages.filter(m=>m.role==='assistant').at(-1)?.content,'review summary (maximum 12000 characters)',12000);
  const seen=new Set();
  const stored=child.artifacts??[];
  if(new Set(stored.map(a=>a.id)).size!==stored.length)throw new ValidationError('Duplicate stored artifact identifiers');
  const selected=child.checkpoint?.resultArtifactIds;
  if(selected!==undefined&&(!Array.isArray(selected)||new Set(selected).size!==selected.length))throw new ValidationError('Invalid result artifact selection');
  const artifacts=(selected?selected.map(id=>{const a=stored.find(a=>a.id===id);if(!a)throw new ValidationError('Missing selected result artifact');return a;}):stored).map((artifact,index)=>{
   if(++count>20)throw new ValidationError('Review manifest exceeds 20 files');
   if(!artifact.id||seen.has(artifact.id))throw new ValidationError('Review artifact missing or duplicate identifier');
   seen.add(artifact.id);
   const name=bounded(artifact.name,'artifact filename',500);
   if(/[\\/\x00-\x1f:*?"<>|]/.test(name)||name==='.'||name==='..'||/[. ]$/.test(name))throw new ValidationError('Unsafe review artifact filename');
   if(typeof artifact.content!=='string'||!['utf-8','base64'].includes(artifact.encoding))throw new ValidationError('Invalid review artifact content or encoding');
   let bytes;
   if(artifact.encoding==='base64'){
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(artifact.content))throw new ValidationError('Invalid review artifact base64');
    bytes=artifact.content.length/4*3-(artifact.content.endsWith('==')?2:artifact.content.endsWith('=')?1:0);
   }else bytes=new TextEncoder().encode(artifact.content).byteLength;
   total+=bytes;if(total>5_000_000)throw new ValidationError('Review generated files exceed 5 MB; select a smaller set');
   const extension=name.match(/\.[a-z0-9]{1,8}$/i)?.[0]??'.bin';
   return {artifactId:artifact.id,taskId:child.id,name,mime:artifact.mime,encoding:artifact.encoding,bytes,path:`child-${childIndex+1}-artifact-${index+1}${extension}`};
  });
  return {...(child.assignment.sourceIds?.length?{sourceIds:[...child.assignment.sourceIds]}:{}),taskId:child.id,role:child.assignment.role,provider:child.assignment.provider,requestedModel:child.assignment.requestedModel,summary,artifacts};
 });
 return {children:records,totalBytes:total};
}
export function validateReviewReport(parent,input,{requirePass=true}={}){
 if(parent.delegation?.state!=='reviewing'||parent.status!=='running')throw new ConflictError('Delegation must enter review before completion',parent.version);
 const report=input.reviewReport;
 if(!Array.isArray(report)||report.length!==parent.delegation.children.length)throw new ValidationError('Review report must cover every child');
 const ids=new Set();
 const normalized=report.map(row=>{
  const assignment=parent.delegation.children.find(c=>c.taskId===row?.childTaskId);
  if(!assignment||ids.has(row.childTaskId))throw new ValidationError('Unknown or duplicate child in review report');
  ids.add(row.childTaskId);
  if(!Array.isArray(row.criteria)||row.criteria.length!==assignment.acceptanceCriteria.length)throw new ValidationError('Review report must cover every acceptance criterion');
  const criteriaSeen=new Set();
  return {childTaskId:row.childTaskId,criteria:row.criteria.map(item=>{
   if(!assignment.acceptanceCriteria.includes(item?.criterion)||criteriaSeen.has(item.criterion))throw new ValidationError('Unknown or duplicate review criterion');
   criteriaSeen.add(item.criterion);
   if(!['pass','fail','unverifiable'].includes(item.status)||(requirePass&&item.status!=='pass'))throw new ValidationError('Every review criterion must pass before completion');
   return {criterion:item.criterion,status:item.status,evidence:bounded(item.evidence,'review evidence',2000)};
  })};
 });
 return normalized;
}
