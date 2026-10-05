import {reservationKey} from './delivery-reservations.mjs';
import {readDeliveryRecord} from './delivery-receipts.mjs';

const sameOwner=(checkpoint,owner)=>checkpoint?.executionId===owner.executionId&&checkpoint?.generation===owner.generation;
const RESERVATION_FIELDS=['version','workspaceId','taskId','executionId','generation','claimedAt'];

// True only when this task can never accept a result from this owner again: the owner was
// replaced, or the task left running for a reason other than a same-version lease expiry
// (the only paused state whose result is still accepted). Statuses never return to an
// older owner, so this refusal is permanent.
export function ownerPermanentlyRefused(task,owner){
 if(!task||typeof task!=='object')return false;
 const checkpoint=task.checkpoint??{};
 if(!sameOwner(checkpoint,owner))return true;
 if(task.status==='running')return false;
 return !(task.status==='paused'&&checkpoint.interruptedBy==='lease_expiry'&&checkpoint.interruptedVersion===task.version);
}

// A refused desktop result is settled with a stored "discarded" receipt only while the
// owner's claim reservation still exists. Accepting a result always deletes that
// reservation, so its presence proves nothing from this owner was ever applied. The task
// itself is never changed; the desktop acknowledges the receipt and clears its outbox.
export async function dischargeRefusedDelivery(store,descriptor,now){
 const db=store.db;
 let task;
 try{task=await store.requireTask(descriptor.taskId);}catch(error){if(error?.statusCode===404)return null;throw error;}
 if(!ownerPermanentlyRefused(task,descriptor))return null;
 const key=await reservationKey(descriptor),row=await db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first();
 if(typeof row?.value!=='string')return null;
 let saved;
 try{saved=JSON.parse(row.value);}catch{return null;}
 if(!saved||typeof saved!=='object'||Array.isArray(saved)||Object.keys(saved).length!==RESERVATION_FIELDS.length
  ||RESERVATION_FIELDS.some(field=>!Object.hasOwn(saved,field))||saved.version!==1||saved.workspaceId!==descriptor.workspaceId
  ||saved.taskId!==task.id||saved.executionId!==descriptor.executionId||saved.generation!==descriptor.generation)return null;
 const receipt=Object.fromEntries(['version','id','workspaceId','taskId','executionId','generation','action','payloadDigest'].map(field=>[field,descriptor[field]]));
 const value=JSON.stringify({...receipt,acceptedAt:now,disposition:'discarded'});
 try{
  await db.batch([
   db.prepare(`DELETE FROM metadata WHERE key=?1 AND value=?2
    AND EXISTS (SELECT 1 FROM tasks t WHERE t.id=?3 AND t.version=?4)
    AND EXISTS (SELECT 1 FROM metadata w WHERE w.key='desktop_workspace_id' AND w.value=?5)`).bind(key,row.value,task.id,task.version,descriptor.workspaceId),
   db.prepare('INSERT INTO metadata(key,value) SELECT ?1,?2 WHERE changes()=1').bind('desktop_receipt:'+descriptor.id,value),
   // Rolls the batch back when the reservation or task changed after it was read.
   db.prepare("INSERT INTO metadata(key,value) SELECT 'revision',0 WHERE changes()!=1"),
  ]);
 }catch{
  // A lost race, a changed task or an unavailable database all end here. Only a stored
  // record counts; otherwise the caller returns its original refusal and the desktop
  // keeps the result for a later attempt.
 }
 // A concurrent discharge of the same delivery leaves the same stored receipt.
 return readDeliveryRecord(db,descriptor);
}
