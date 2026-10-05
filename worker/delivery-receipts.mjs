import {ConflictError,ValidationError} from '../public/core/tasks.mjs';
import {prepareReceiptReservation} from './delivery-reservations.mjs';
import {providerHas} from '../public/core/providers.mjs';

const workspaceUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex=/^[0-9a-f]{64}$/;
const fields=['version','id','workspaceId','taskId','executionId','generation','action','payloadDigest'];
const encoder=new TextEncoder();
const invalid=()=>{throw new ValidationError('Invalid desktop delivery receipt');};

export async function readDeliveryReceipt(db,descriptor){return (await readDeliveryRecord(db,descriptor))?.receipt??null;}
// A stored receipt either records an applied result or, with disposition 'discarded', a
// result the Worker settled without applying (worker/delivery-discharge.mjs). The receipt
// returned to the desktop never carries the disposition.
export async function readDeliveryRecord(db,descriptor){
 const row=await db.prepare('SELECT value FROM metadata WHERE key=?1').bind('desktop_receipt:'+descriptor.id).first();
 if(!row)return null;
 let saved;
 try{saved=JSON.parse(row.value);}catch{throw new ConflictError('Stored desktop delivery receipt is invalid');}
 const discarded=saved?.disposition==='discarded';
 const keys=[...fields,'acceptedAt',...(discarded?['disposition']:[])];
 if(!saved||typeof saved!=='object'||Array.isArray(saved)||Object.keys(saved).length!==keys.length
  ||keys.some(key=>!Object.hasOwn(saved,key))||typeof saved.acceptedAt!=='string'
  ||!Number.isFinite(Date.parse(saved.acceptedAt))||new Date(saved.acceptedAt).toISOString()!==saved.acceptedAt)
  throw new ConflictError('Stored desktop delivery receipt is invalid');
 if(fields.some(key=>saved[key]!==descriptor[key]))throw new ConflictError('Desktop delivery receipt payload conflicts with the settled result');
 return {receipt:Object.fromEntries([...fields,'acceptedAt'].map(key=>[key,saved[key]])),discarded};
}
const sameOwner=(value,receipt)=>value?.executionId===receipt.executionId&&value?.generation===receipt.generation;

async function sha256(text){
 const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(text));
 return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function acceptedTransition(receipt,current,next,delegation){
 const old=current.checkpoint??{},after=next.checkpoint??{};
 if(!providerHas(old.provider,'deliveryReceipts',1)||!sameOwner(old,receipt)||!['running','paused'].includes(current.status))return false;
 if(current.status==='paused'&&(old.interruptedBy!=='lease_expiry'||old.interruptedVersion!==current.version))return false;
 if(receipt.action==='fail')return !delegation&&['failed','waiting_quota','waiting_connection'].includes(next.status)
  &&after.provider===old.provider&&after.status===next.status&&after.failure&&typeof after.failure==='object'&&!after.confirmationRequired&&sameOwner(after,receipt);
 if(receipt.action!=='complete')return false;
 if(!delegation&&next.status==='completed')return after.provider===old.provider&&after.status==='completed'&&sameOwner(after,receipt);
 if(!delegation&&next.status==='queued')return after.status==='queued'
  &&sameOwner(after.handoff,receipt)&&after.handoff.from===old.provider&&after.provider!==old.provider;
 if(!delegation&&next.status==='waiting_user')return after.provider===old.provider&&after.status==='waiting_user'
  &&sameOwner(after,receipt)&&current.delegation?.state==='reviewing'
  &&next.decision&&typeof next.decision==='object'&&typeof next.decision.prompt==='string'
  &&Array.isArray(next.decision.options)&&next.decision.options.length>=2&&next.decision.options.length<=5;
 if(next.status==='waiting_children')return delegation&&after.status==='waiting_children'
  &&next.delegation?.state==='waiting_children'
  &&(sameOwner({executionId:next.delegation.sourceExecutionId,generation:next.delegation.sourceGeneration},receipt)
   ||sameOwner(next.delegation.lastReviewRetry,receipt));
 return false;
}

export function requiresDeliveryReceipt(current,next,{delegation=false}={}){
 const checkpoint=current.checkpoint;
 if(checkpoint?.deliveryReceiptVersion!==1)return false;
 const owner={executionId:checkpoint.executionId,generation:checkpoint.generation};
 return ['complete','fail'].some(action=>acceptedTransition({...owner,action},current,next,delegation));
}

export async function prepareDeliveryReceipt(db,receipt,current,next,acceptedAt,{delegation=false,records=[]}={}){
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||Object.keys(receipt).length!==fields.length||fields.some(key=>!Object.hasOwn(receipt,key)))invalid();
 receipt=Object.fromEntries(fields.map(key=>[key,receipt[key]]));
 if(receipt.version!==1||typeof receipt.workspaceId!=='string'||!workspaceUuid.test(receipt.workspaceId)
  ||typeof receipt.taskId!=='string'||!receipt.taskId.trim()||receipt.taskId.length>200
  ||typeof receipt.executionId!=='string'||!receipt.executionId.trim()||receipt.executionId.length>200
  ||!Number.isSafeInteger(receipt.generation)||receipt.generation<1
  ||!['complete','fail'].includes(receipt.action)||typeof receipt.id!=='string'||!hex.test(receipt.id)
  ||typeof receipt.payloadDigest!=='string'||!hex.test(receipt.payloadDigest))invalid();
 if(receipt.taskId!==current.id||next.id!==current.id||next.version!==current.version+1||!acceptedTransition(receipt,current,next,delegation))invalid();
 if(delegation){
  const frozen=next.delegation?.children;
  if(!Array.isArray(frozen)||frozen.length!==2||!Array.isArray(records)||records.length!==2)invalid();
  const frozenIds=frozen.map(item=>item?.taskId),recordIds=records.map(item=>(item?.next??item?.current)?.id);
  if(new Set(frozenIds).size!==2||new Set(recordIds).size!==2
   ||frozenIds.some(id=>typeof id!=='string'||!recordIds.includes(id))
   ||records.some(item=>{const child=item?.next??item?.current;return child?.parentTaskId!==next.id||child?.batchId!==next.delegation.batchId;})
   ||(!current.delegation&&records.some(item=>item.current||!item.next)))invalid();
  for(const item of records){
   const before=item.current,after=item.next;
   if(!before){if(after?.version!==1)invalid();continue;}
   if(before.parentTaskId!==next.id||before.batchId!==next.delegation.batchId
    ||(after&&(after.id!==before.id||after.version!==before.version+1)))invalid();
   const row=await db.prepare('SELECT version,body FROM tasks WHERE id=?1').bind(before.id).first();
   if(row?.version!==before.version)invalid();
   let actual;
   try{actual=JSON.parse(row.body);}catch{invalid();}
   if(actual.id!==before.id||actual.parentTaskId!==next.id||actual.batchId!==next.delegation.batchId)invalid();
  }
 }
 if(receipt.id!==await sha256(JSON.stringify([1,receipt.workspaceId,receipt.taskId,receipt.executionId,receipt.generation,receipt.action])))invalid();
 const row=await db.prepare("SELECT value FROM metadata WHERE key='desktop_workspace_id'").first();
 if(row?.value!==receipt.workspaceId)invalid();
 const reservation=await prepareReceiptReservation(db,receipt,current);
 return {key:'desktop_receipt:'+receipt.id,value:JSON.stringify({...Object.fromEntries(fields.map(key=>[key,receipt[key]])),acceptedAt}),workspaceId:receipt.workspaceId,reservation};
}

// Must immediately follow the reservation DELETE. The assertion rolls
// the entire D1 batch back if the receipt was not inserted after a successful
// accepted transition. No receipt is written on a losing parent/task CAS.
export function receiptStatements(db,receipt,next,{operationId}={}){
 const operation=operationId?" AND json_extract(t.body,'$.delegation.operationId')=?5":'';
 const values=[receipt.key,receipt.value,next.id,next.version,...(operationId?[operationId]:[]),receipt.workspaceId];
 const workspaceIndex=values.length;
 const insert=db.prepare(`INSERT INTO metadata(key,value) SELECT ?1,?2 WHERE changes()=1
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.id=?3 AND t.version=?4${operation})
  AND EXISTS (SELECT 1 FROM metadata w WHERE w.key='desktop_workspace_id' AND w.value=?${workspaceIndex})`).bind(...values);
 const assertion=db.prepare(`INSERT INTO metadata(key,value) SELECT 'revision',0 WHERE changes()!=1
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.id=?1 AND t.version=?2${operationId?" AND json_extract(t.body,'$.delegation.operationId')=?3":''})`).bind(next.id,next.version,...(operationId?[operationId]:[]));
 return [insert,assertion];
}
