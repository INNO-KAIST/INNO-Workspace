import {ContextRetrievalRequiredError} from '../public/core/context-errors.mjs';
import {ConflictError} from '../public/core/tasks.mjs';
import {failureInput,runnerError} from '../public/core/failures.mjs';
const queued=t=>['queued','queued_for_review'].includes(t.status)&&t.checkpoint?.provider==='claude';
const owns=(task,claim)=>task.status==='running'&&task.checkpoint?.executionId===claim.executionId&&task.checkpoint?.generation===claim.generation;
// A durable claim precedes the external side effect. Ambiguous outcomes require
// confirmation; neither a request retry nor the normal failed-work retry fires again.
export async function dispatchClaude({store,taskId,hasRoutine,fire,waitUntil}){
 let task=await store.requireTask(taskId),claim;
 for(let attempt=0;attempt<3;attempt++){
  if(!queued(task)||task.attachments?.length)return task;
  if(!hasRoutine)return store.markWaiting(task.id,{expectedVersion:task.version,provider:'claude',reason:'Claude Routine is not configured.'});
  try{claim=await store.claimExecution(task.id,{provider:'claude',expectedVersion:task.version});break;}
  catch(error){if(!(error instanceof ConflictError)||attempt===2)throw error;task=await store.requireTask(task.id);}
 }
 const execution=runClaudeClaim({store,claim,fire});
 if(waitUntil)waitUntil(execution);else await execution;
 return claim.task;
}

export async function runClaudeClaim({store,claim,fire}){
 const task={id:claim.task.id};
  let fired;
  try{
   fired=await fire(claim);
   if(typeof fired?.claude_code_session_url!=='string'||!fired.claude_code_session_url)throw Error('Unconfirmed routine response');
  }catch(error){
   const failure=failureInput(error?.code?error:runnerError(error));
   const definitive=error instanceof ContextRetrievalRequiredError||['quota','authentication'].includes(failure.failure.kind);
   for(let attempt=0;attempt<3;attempt++){
    const current=await store.requireTask(task.id);
    if(!owns(current,claim))return;
    try{
     const owner={executionId:claim.executionId,generation:claim.generation};
     if(definitive)await store.failExecution(task.id,{...owner,...failure});
     else await store.markExecutionUncertain(task.id,{...owner,reason:'uncertain_fire'});
     return;
    }catch(writeError){if(!(writeError instanceof ConflictError))throw writeError;}
   }
   return;
  }
  // The remote session is accepted. Metadata conflicts must never revoke its
  // owner or reclassify it as a failed launch. Recovery handles persistent loss.
  for(let attempt=0;attempt<3;attempt++){
   try{
    const current=await store.requireTask(task.id);
    if(!owns(current,claim))return;
    await store.leaveExecutionRunning(task.id,{executionId:claim.executionId,generation:claim.generation,sessionUrl:fired.claude_code_session_url,checkpoint:'Claude session started; results await verification.'});
    return;
   }catch{/* Retry only this local metadata write, never the external fire. */}
  }
}
