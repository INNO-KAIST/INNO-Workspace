import {ConflictError,ValidationError} from '../public/core/tasks.mjs';
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const decode=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret){return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function executionCapability(secret,claim,now=Date.now()){
 const payload=encode(new TextEncoder().encode(JSON.stringify({taskId:claim.task.id,executionId:claim.executionId,generation:claim.generation,expires:now+86400000})));
 return payload+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),new TextEncoder().encode(payload))));
}
export async function authorizeExecution(store,secret,message,now=Date.now()){
 if(message?.method!=='tools/call'||message.params?.name==='available_models')return null;
 const token=message.executionCapability;
 if(typeof token!=='string'||token.length>2048)throw new ValidationError('A scoped execution capability from the current INNO task is required');
 let scope;try{const parts=token.split('.');if(parts.length!==2||!await crypto.subtle.verify('HMAC',await key(secret),decode(parts[1]),new TextEncoder().encode(parts[0])))throw Error();scope=JSON.parse(new TextDecoder().decode(decode(parts[0])));}catch{throw new ValidationError('Invalid execution capability');}
 if(!scope||!Number.isSafeInteger(scope.expires)||scope.expires<now||typeof scope.taskId!=='string'||typeof scope.executionId!=='string'||!Number.isInteger(scope.generation))throw new ValidationError('Expired or invalid execution capability');
 const name=message.params?.name,args=message.params?.arguments??{};
 const task=await store.requireTask(scope.taskId),owner=task.checkpoint;
 const matches=value=>value?.executionId===scope.executionId&&value?.generation===scope.generation;
 const allocated=task.delegation?.sourceExecutionId===scope.executionId&&task.delegation?.sourceGeneration===scope.generation&&!['cancelled','superseded'].includes(task.delegation.state);
 const completionReplay=name==='checkpoint_task'&&args.status==='completed'&&task.status==='completed'&&matches(owner);
 const replay=completionReplay||(name==='delegate_task'&&allocated)||(name==='retry_delegation'&&!['superseded','cancelled'].includes(task.delegation?.state)&&matches(task.delegation?.lastReviewRetry))||(name==='handoff_task'&&(task.checkpoint?.handoffHistory??[]).some(matches));
 if(!(task.status==='running'&&matches(owner))&&!replay)throw new ConflictError('Execution scope has been superseded',task.version);
 if(name==='claim_execution')throw new ValidationError('A Routine may only use its already assigned execution');
 const readable=new Set([task.id]);if(task.delegation?.state==='reviewing')for(const child of task.delegation.children)readable.add(child.taskId);
 if(name==='read_task'||name==='read_task_context'){if(!readable.has(args.taskId))throw new ValidationError('Read is outside this execution assignment');}
 else if(name!=='list_tasks'){
  if(args.taskId!==scope.taskId||args.executionId!==scope.executionId||args.generation!==scope.generation)throw new ValidationError('Write is outside this execution assignment');
 }
 return {task,scope,readable};
}
export async function scopedRead(store,scope,id){
 const task=await store.requireTask(id);
 if(!scope?.readable.has(id))throw new ValidationError('Read is outside this execution assignment');
 if(id===scope.task.id)return task;
 if(task.parentTaskId!==scope.task.id||task.batchId!==scope.task.delegation.batchId||task.status!=='completed')throw new ConflictError('Review child has changed',scope.task.version);
 const manifest=scope.task.delegation.review?.children.find(child=>child.taskId===id),ids=new Set(manifest?.artifacts.map(a=>a.artifactId)??[]);
 return {...task,artifacts:task.artifacts.filter(a=>ids.has(a.id)),checkpoint:{status:task.checkpoint?.status}};
}
