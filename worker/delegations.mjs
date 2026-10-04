import {usageHistory} from '../public/core/execution-usage.mjs';
import {failureRecord} from '../public/core/failures.mjs';
import {ConflictError,ValidationError} from '../public/core/tasks.mjs';
import {allocateDelegation,isDelegationReplay,buildReview,validateReviewReport} from '../public/core/delegation.mjs';
import {validateAssignments} from '../public/core/delegation.mjs';
import {resolveAllocationPolicy} from './allocation-policy.mjs';
const mayStillRun=child=>child.status==='running'||(child.status==='paused'&&Boolean(child.checkpoint?.executionId));
export class Delegations {
 constructor(store,{sourceDelegationVersion=0,catalog,plugins}={}){this.store=store;this.sourceDelegationVersion=sourceDelegationVersion===1?1:0;this.catalog=catalog;this.plugins=plugins;}
 async children(parent){return Promise.all(parent.delegation.children.map(c=>this.store.requireTask(c.taskId)));}
 async pending(limit=20){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new ValidationError('Recovery limit must be 1 to 100');
  const rows=await this.store.db.prepare("SELECT body FROM tasks WHERE json_extract(body,'$.status') = 'waiting_children' ORDER BY updated_at ASC,id ASC LIMIT ?1").bind(limit).all();
  return rows.results.map(r=>JSON.parse(r.body));
 }
 async allocate(parentId,input,{deliveryReceipt}={}){
  if(deliveryReceipt===null)throw new ValidationError('Invalid desktop delivery receipt');
  for(let attempt=0;attempt<3;attempt++){
   const parent=await this.store.requireTask(parentId);
   if(isDelegationReplay(parent,input)){
    if(deliveryReceipt!==undefined||parent.checkpoint?.deliveryReceiptVersion===1)throw new ConflictError('Delivery receipt replay requires stored verification',parent.version);
    return {parent,children:await this.children(parent),replayed:true};
   }
   const validated=validateAssignments(parent,input,{sourceDelegationVersion:this.sourceDelegationVersion});
   // A master may assign only plugins the user approved (resolution re-checks at dispatch).
   const assigned=validated.flatMap(child=>child.plugins??[]);
   if(assigned.length){if(!this.plugins)throw new ValidationError('Assigned plugins must be approved.');await this.plugins.requireApproved(assigned);}
   const resolved=this.catalog?await resolveAllocationPolicy(this.store,this.catalog,validated):null;
   const allocation=allocateDelegation(parent,input,{now:this.store.now,id:this.store.id,sourceDelegationVersion:this.sourceDelegationVersion,...(resolved?{assignments:resolved.assignments}:{})});
   try{await this.store.replaceDelegation(parent,allocation.parent,allocation.children.map(next=>({next})),resolved?{guards:resolved.guards,initialPolicies:resolved.initialPolicies}:[],{deliveryReceipt});return {...allocation,replayed:false};}
   catch(error){if(!(error instanceof ConflictError)||attempt===2)throw error;}
  }
 }
 async reconcile(parentId){
  for(let attempt=0;attempt<3;attempt++){
   const parent=await this.store.requireTask(parentId);
   if(!parent.delegation)return {parent,children:[],queued:false};
   const children=await this.children(parent);
   if(parent.status!=='waiting_children'||parent.delegation.state!=='waiting_children'||!children.every(c=>c.status==='completed'))return {parent,children,queued:false};
   const now=this.store.now();let review,reviewError;
   try{review=buildReview(parent,children);}catch(error){if(!(error instanceof ValidationError))throw error;reviewError=error.message;}
   const status=reviewError?'waiting_user':'queued_for_review';
   const next={...parent,status,version:parent.version+1,updatedAt:now,delegation:{...parent.delegation,state:status,review,reviewError},checkpoint:{...parent.checkpoint,provider:parent.delegation.masterProvider,status,executionId:undefined,expiresAt:undefined,updatedAt:now}};
   try{await this.store.replaceDelegation(parent,next,children.map(current=>({current})));return {parent:next,children,queued:!reviewError};}
   catch(error){if(!(error instanceof ConflictError)||attempt===2)throw error;}
  }
 }
 async resume(parentId,input){
  const parent=await this.store.requireTask(parentId);
  if(!Number.isInteger(input.expectedVersion)||parent.version!==input.expectedVersion)throw new ConflictError('Delegation resume version conflict',parent.version);
  if(parent.checkpoint?.confirmationRequired)throw new ConflictError('Confirm the previous remote execution before resuming',parent.version);
  const failedReview=parent.delegation?.state==='reviewing'&&['failed','waiting_quota','waiting_connection'].includes(parent.status);
  if(!parent.delegation||(!failedReview&&!['paused','waiting_children'].includes(parent.status))||['superseded','cancelled'].includes(parent.delegation.state))throw new ConflictError('Delegation cannot resume from this state',parent.version);
  const children=await this.children(parent),paused=parent.status==='paused';
  if(paused&&parent.delegation.review&&parent.checkpoint?.executionId){
   const marked=await this.store.replaceTask(parent.id,parent.version,current=>{const now=this.store.now();return {...current,version:current.version+1,updatedAt:now,checkpoint:{...current.checkpoint,confirmationRequired:{reason:'parent_pause',executionId:current.checkpoint.executionId,generation:current.checkpoint.generation,createdAt:now},updatedAt:now}};});
   return {parent:marked,children,queued:false};
  }
  if(failedReview){
   if(!children.every(c=>c.status==='completed'))throw new ConflictError('Review recovery requires completed children',parent.version);
   return this.requeue(parent,children,[]);
  }
  const failed=children.filter(c=>c.status==='failed');
  if(failed.length&&parent.delegation.retryCount>=1)throw new ConflictError('Delegation retry limit reached',parent.version);
  const selected=children.filter(c=>!c.checkpoint?.confirmationRequired&&(c.status==='failed'||(paused&&!mayStillRun(c)&&['queued','ready','paused'].includes(c.status))));
  if(!paused&&!selected.length)throw new ConflictError('No failed children eligible for retry; quota/connection require user action',parent.version);
  return this.requeue(parent,children,selected,{retry:failed.length>0,confirmRunning:paused});
 }
 async recoverChild(parentId,input){
  const parent=await this.store.requireTask(parentId);
  if(!Number.isInteger(input.expectedVersion)||parent.version!==input.expectedVersion)throw new ConflictError('Recovery parent version conflict',parent.version);
  if(!parent.delegation||!['waiting_children','paused'].includes(parent.status)||!['waiting_children','paused'].includes(parent.delegation.state))throw new ConflictError('Parent cannot recover a child from this state',parent.version);
  if(parent.checkpoint?.confirmationRequired)throw new ConflictError('Confirm the parent remote execution separately',parent.version);
  const children=await this.children(parent),child=children.find(c=>c.id===input.childTaskId);
  if(!child||child.parentTaskId!==parent.id||child.batchId!==parent.delegation.batchId)throw new ValidationError('Recovery child is outside the current batch');
  if(!Number.isInteger(input.expectedChildVersion)||child.version!==input.expectedChildVersion)throw new ConflictError('Recovery child version conflict',child.version);
  const interrupted=child.status==='paused'&&child.checkpoint?.interruptedBy==='lease_expiry'&&child.checkpoint?.interruptedVersion===child.version;
  if(!['waiting_quota','waiting_connection'].includes(child.status)&&!interrupted)throw new ConflictError('Only blocked or lease-interrupted children can recover; completed children are immutable',child.version);
  const uncertain=child.checkpoint?.confirmationRequired||interrupted||['connection','unknown','interrupted'].includes(child.checkpoint?.failure?.kind);
  if(uncertain&&input.confirmedStopped!==true)throw new ValidationError('Confirm the previous execution has stopped before recovering this child');
  return this.requeue(parent,children,[child],{manualRecovery:true,clearConfirmation:true,preserveRevoked:true,confirmRunning:parent.status==='paused'});
 }
 async retryReview(parentId,input,{deliveryReceipt}={}){
  if(deliveryReceipt===null)throw new ValidationError('Invalid desktop delivery receipt');
  for(let attempt=0;attempt<3;attempt++){
   const parent=await this.store.requireTask(parentId);
   const previous=parent.delegation?.lastReviewRetry;
   if(previous&&previous.executionId===input.executionId&&previous.generation===input.generation&&!['superseded','cancelled'].includes(parent.delegation.state)){
    if(deliveryReceipt!==undefined||parent.checkpoint?.deliveryReceiptVersion===1)throw new ConflictError('Delivery receipt replay requires stored verification',parent.version);
    return {parent,children:await this.children(parent),replayed:true};
   }
   this.store.assertExecution(parent,input);
   const report=validateReviewReport(parent,input,{requirePass:false});
   if(parent.delegation.retryCount>=1)throw new ConflictError('Delegation retry limit reached',parent.version);
   const ids=report.filter(r=>r.criteria.some(c=>c.status==='fail')).map(r=>r.childTaskId);
   if(!ids.length)throw new ValidationError('Review retry requires an explicit failed acceptance criterion');
   const children=await this.children(parent);
   try{return await this.requeue(parent,children,children.filter(c=>ids.includes(c.id)),{retry:true,report,usage:input.usage,reviewRetry:{executionId:input.executionId,generation:input.generation},deliveryReceipt});}
   catch(error){if(!(error instanceof ConflictError)||attempt===2)throw error;}
  }
 }
 async requeue(parent,children,selected,{retry=false,report,reviewRetry,usage,clearConfirmation=false,preserveRevoked=false,confirmRunning=false,manualRecovery=false,deliveryReceipt}={}){
  const now=this.store.now(),epoch=parent.delegation.epoch+1,ids=new Set(selected.map(c=>c.id));
  const records=children.map(current=>{
   if(current.status==='completed'&&!ids.has(current.id))return {current};
   if(preserveRevoked&&!confirmRunning&&!ids.has(current.id)&&['running','paused'].includes(current.status)&&current.parentEpoch!==parent.delegation.epoch)return {current};
   // Refresh blocked children, but never adopt an owner revoked by parent pause.
   const next={...current,parentEpoch:epoch,version:current.version+1,updatedAt:now};
   if(confirmRunning&&!ids.has(current.id)&&mayStillRun(current)){
    next.status='waiting_connection';
    next.checkpoint={...current.checkpoint,status:'waiting_connection',confirmationRequired:{reason:'parent_pause',executionId:current.checkpoint?.executionId,generation:current.checkpoint?.generation,createdAt:now},failure:failureRecord({failure:{kind:'connection'}},now),updatedAt:now};
    return {current,next};
   }
   if(ids.has(current.id)){
    next.status='queued';
    next.checkpoint={...current.checkpoint,...(clearConfirmation?{confirmationRequired:undefined}:{}),provider:current.assignment.provider,status:'queued',executionId:undefined,expiresAt:undefined,sessionUrl:undefined,interruptedBy:undefined,interruptedVersion:undefined,failure:undefined,updatedAt:now};
   }
   return {current,next};
  });
  const next={...parent,status:'waiting_children',version:parent.version+1,updatedAt:now,delegation:{...parent.delegation,state:'waiting_children',epoch,retryCount:parent.delegation.retryCount+(retry?1:0),manualRecoveryCount:(parent.delegation.manualRecoveryCount??0)+(manualRecovery?1:0),review:undefined,reviewError:undefined,...(report?{reviewReport:report}:{}),...(reviewRetry?{lastReviewRetry:reviewRetry}:{})},checkpoint:{...parent.checkpoint,...(reviewRetry?{usageHistory:usageHistory(parent.checkpoint,usage,now,{task:parent,transition:'retry'})}:{}),status:'waiting_children',executionId:undefined,expiresAt:undefined,sessionUrl:undefined,interruptedBy:undefined,interruptedVersion:undefined,updatedAt:now}};
  await this.store.replaceDelegation(parent,next,records,[],{deliveryReceipt});
  if(records.every(r=>(r.next??r.current).status==='completed'))return this.reconcile(parent.id);
  return {parent:next,children:records.map(r=>r.next??r.current)};
 }
}
