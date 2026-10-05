import {ValidationError} from '../public/core/tasks.mjs';

// A legacy desktop result was saved without a delivery receipt (protocol 0). It is never
// treated as accepted automatically: the desktop asks for this read-only classification
// and then either delivers it the old way or archives it on the user's confirmation.
//  - deliverable: the owner still runs on protocol 0 (or is a same-version lease-expiry pause)
//  - already_applied: the same result kind was already recorded for this owner
//  - owner_replaced / not_running / receipt_required / task_missing: it can never be applied
export function legacyDeliveryState(task,owner,action){
 if(!task)return 'task_missing';
 const checkpoint=task.checkpoint??{};
 if(checkpoint.executionId!==owner.executionId||checkpoint.generation!==owner.generation)return 'owner_replaced';
 if(checkpoint.deliveryReceiptVersion===1)return 'receipt_required';
 if(action==='complete'&&task.status==='completed'||action==='fail'&&['failed','waiting_quota','waiting_connection'].includes(task.status))return 'already_applied';
 if(task.status==='running'||task.status==='paused'&&checkpoint.interruptedBy==='lease_expiry'&&checkpoint.interruptedVersion===task.version)return 'deliverable';
 return 'not_running';
}

const id=value=>typeof value==='string'&&!!value.trim()&&value.length<=200;
export async function legacyDeliveryStatus(store,taskId,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join()!=='action,executionId,generation'
  ||!id(input.executionId)||!Number.isSafeInteger(input.generation)||input.generation<1||!['complete','fail'].includes(input.action))
  throw new ValidationError('Invalid legacy desktop result status request');
 let task=null;
 try{task=await store.requireTask(taskId);}catch(error){if(error?.statusCode!==404)throw error;}
 return {state:legacyDeliveryState(task,input,input.action)};
}
