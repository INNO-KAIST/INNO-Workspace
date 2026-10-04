import {ConflictError,ValidationError} from '../public/core/tasks.mjs';
import {providerHas} from '../public/core/providers.mjs';

export const MAX_DESKTOP_DELIVERIES=1024;
const workspaceUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();

export class DesktopDeliveryCapacityError extends ConflictError{
 constructor(){super('Desktop delivery capacity unavailable');this.code='DESKTOP_DELIVERY_CAPACITY';}
}

async function digest(value){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(value))));
 return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function reservationKey({workspaceId,taskId,executionId,generation}){
 return 'desktop_reservation:'+await digest([workspaceId,taskId,executionId,generation]);
}

export async function prepareReceiptReservation(db,receipt,current){
 const checkpoint=current.checkpoint;
 if(checkpoint?.deliveryReceiptVersion!==1||!providerHas(checkpoint?.provider,'deliveryReceipts',1)
  ||checkpoint.executionId!==receipt.executionId||checkpoint.generation!==receipt.generation)
  throw new ConflictError('Desktop result requires a versioned execution reservation',current.version);
 const key=await reservationKey(receipt),row=await db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first();
 if(typeof row?.value!=='string')throw new ConflictError('Desktop delivery reservation is missing',current.version);
 let saved;
 try{saved=JSON.parse(row.value);}catch{throw new ConflictError('Desktop delivery reservation is invalid',current.version);}
 const expected={version:1,workspaceId:receipt.workspaceId,taskId:current.id,executionId:receipt.executionId,generation:receipt.generation,claimedAt:checkpoint.claimedAt};
 if(!saved||typeof saved!=='object'||Array.isArray(saved)||Object.keys(saved).length!==Object.keys(expected).length
  ||Object.entries(expected).some(([field,value])=>!Object.hasOwn(saved,field)||saved[field]!==value))
  throw new ConflictError('Desktop delivery reservation does not match execution owner',current.version);
 return {key,value:row.value,workspaceId:receipt.workspaceId};
}

export function reservationDeleteStatement(db,reservation,next,{operationId}={}){
 const operation=operationId?" AND json_extract(t.body,'$.delegation.operationId')=?5":'';
 const values=[reservation.key,reservation.value,next.id,next.version,...(operationId?[operationId]:[]),reservation.workspaceId];
 return db.prepare(`DELETE FROM metadata WHERE key=?1 AND value=?2 AND changes()=1
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.id=?3 AND t.version=?4${operation})
  AND EXISTS (SELECT 1 FROM metadata w WHERE w.key='desktop_workspace_id' AND w.value=?${values.length})`).bind(...values);
}

export async function reservationCapacity(db,workspaceId){
 const row=await db.prepare("SELECT value FROM metadata WHERE key='desktop_workspace_id'").first();
 if(typeof row?.value!=='string'||!workspaceUuid.test(row.value)||row.value!==workspaceId)
  throw new ConflictError('Desktop workspace identity mismatch');
 const count=Number((await db.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key GLOB 'desktop_reservation:*' OR key GLOB 'desktop_receipt:*'").first())?.n);
 if(!Number.isSafeInteger(count)||count<0)throw new ValidationError('Desktop delivery capacity is invalid');
 return count;
}

export async function prepareClaimReservation(db,intent,current,next){
 if(!intent||typeof intent!=='object'||Object.keys(intent).length!==1||typeof intent.workspaceId!=='string'||!workspaceUuid.test(intent.workspaceId))
  throw new ValidationError('Invalid desktop workspace identity');
 const checkpoint=next.checkpoint;
 if(next.id!==current.id||next.version!==current.version+1||next.status!=='running'
  ||!providerHas(checkpoint?.provider,'deliveryReceipts',1)||checkpoint.status!=='running'||checkpoint.deliveryReceiptVersion!==1
  ||typeof checkpoint.executionId!=='string'||!checkpoint.executionId||!Number.isSafeInteger(checkpoint.generation)||checkpoint.generation<1
  ||typeof checkpoint.claimedAt!=='string'||!Number.isFinite(Date.parse(checkpoint.claimedAt)))
  throw new ValidationError('Invalid desktop claim reservation');
 if(await reservationCapacity(db,intent.workspaceId)>=MAX_DESKTOP_DELIVERIES)
  throw new DesktopDeliveryCapacityError();
 const value={version:1,workspaceId:intent.workspaceId,taskId:current.id,executionId:checkpoint.executionId,generation:checkpoint.generation,claimedAt:checkpoint.claimedAt};
 return {key:await reservationKey(value),value:JSON.stringify(value),workspaceId:intent.workspaceId};
}

export function reservationCapacityGuard(reservation,parameterIndex){
 return {
  sql:` AND EXISTS (SELECT 1 FROM metadata w WHERE w.key='desktop_workspace_id' AND w.value=?${parameterIndex})
   AND (SELECT COUNT(*) FROM metadata WHERE key GLOB 'desktop_reservation:*' OR key GLOB 'desktop_receipt:*')<${MAX_DESKTOP_DELIVERIES}`,
  value:reservation.workspaceId,
 };
}

// This follows the successful revision UPDATE. The final assertion forces a
// rollback for a 0-change INSERT, including a trigger that silently ignores it.
export function reservationStatements(db,reservation,next){
 const insert=db.prepare(`INSERT INTO metadata(key,value) SELECT ?1,?2 WHERE changes()=1
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.id=?3 AND t.version=?4 AND json_extract(t.body,'$.checkpoint.executionId')=?5 AND json_extract(t.body,'$.checkpoint.generation')=?6 AND json_extract(t.body,'$.checkpoint.deliveryReceiptVersion')=1)
  AND EXISTS (SELECT 1 FROM metadata w WHERE w.key='desktop_workspace_id' AND w.value=?7)
  AND (SELECT COUNT(*) FROM metadata WHERE key GLOB 'desktop_reservation:*' OR key GLOB 'desktop_receipt:*')<${MAX_DESKTOP_DELIVERIES}`)
  .bind(reservation.key,reservation.value,next.id,next.version,next.checkpoint.executionId,next.checkpoint.generation,reservation.workspaceId);
 const assertion=db.prepare("INSERT INTO metadata(key,value) SELECT 'revision',0 WHERE changes()!=1");
 return [insert,assertion];
}
