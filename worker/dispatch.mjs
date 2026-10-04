import {ContextRetrievalRequiredError} from '../public/core/context-errors.mjs';
import {ConflictError} from '../public/core/tasks.mjs';
import {failureInput,runnerError} from '../public/core/failures.mjs';
import {boundedContextDelivery} from '../public/core/context-delivery.mjs';
import {usesTransport} from '../public/core/providers.mjs';
import {ROUTINE_UNAVAILABLE,routineLaunch} from './claude-routine.mjs';
// Optional evidence: an invalid record is dropped, never the launch outcome.
const deliveryOf=value=>{try{const delivery=boundedContextDelivery(value);return delivery?{contextDelivery:delivery}:{};}catch{return {};}};
const queued=t=>['queued','queued_for_review'].includes(t.status)&&usesTransport(t.checkpoint?.provider,'routine_fire');
const owns=(task,claim)=>task.status==='running'&&task.checkpoint?.executionId===claim.executionId&&task.checkpoint?.generation===claim.generation;
// A durable claim precedes the external side effect. Ambiguous outcomes require
// confirmation; neither a request retry nor the normal failed-work retry fires again.
export async function dispatchRemote({store,taskId,adapterFor,waitUntil}){
 let task=await store.requireTask(taskId),claim,adapter;
 for(let attempt=0;attempt<3;attempt++){
  if(!queued(task)||task.attachments?.length)return task;
  const provider=task.checkpoint.provider;adapter=adapterFor(provider);
  if(!adapter?.configured)return store.markWaiting(task.id,{expectedVersion:task.version,provider,reason:adapter?.unavailableReason??'Remote provider is not configured.'});
  try{claim=await store.claimExecution(task.id,{provider,expectedVersion:task.version});break;}
  catch(error){if(!(error instanceof ConflictError)||attempt===2)throw error;task=await store.requireTask(task.id);}
 }
 const execution=runRemoteClaim({store,claim,launch:adapter.launch});
 if(waitUntil)waitUntil(execution);else await execution;
 return claim.task;
}

export async function runRemoteClaim({store,claim,launch}){
 const task={id:claim.task.id};
  let started;
  try{
   started=await launch(claim);
  }catch(error){
   const failure=failureInput(error?.code?error:runnerError(error));
   const definitive=error instanceof ContextRetrievalRequiredError||['quota','authentication'].includes(failure.failure.kind);
   for(let attempt=0;attempt<3;attempt++){
    const current=await store.requireTask(task.id);
    if(!owns(current,claim))return;
    try{
     const owner={executionId:claim.executionId,generation:claim.generation};
     if(definitive)await store.failExecution(task.id,{...owner,...failure,...deliveryOf(error?.contextDelivery)});
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
    await store.leaveExecutionRunning(task.id,{executionId:claim.executionId,generation:claim.generation,sessionUrl:started.sessionUrl,checkpoint:started.checkpoint,...deliveryOf(started.contextDelivery)});
    return;
   }catch{/* Retry only this local metadata write, never the external fire. */}
  }
}

// Compatibility entry points taking a bare Routine fire function.
export const legacyRoutineAdapter=({hasRoutine,fire})=>({configured:!!hasRoutine,unavailableReason:ROUTINE_UNAVAILABLE,launch:routineLaunch(fire)});
export function dispatchClaude({store,taskId,hasRoutine,fire,waitUntil}){return dispatchRemote({store,taskId,waitUntil,adapterFor:()=>legacyRoutineAdapter({hasRoutine,fire})});}
export function runClaudeClaim({store,claim,fire}){return runRemoteClaim({store,claim,launch:routineLaunch(fire)});}
