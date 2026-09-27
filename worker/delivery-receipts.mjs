import {ValidationError} from '../public/core/tasks.mjs';

const workspaceUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex=/^[0-9a-f]{64}$/;
const fields=['version','id','workspaceId','taskId','executionId','generation','action','payloadDigest'];
const encoder=new TextEncoder();
const invalid=()=>{throw new ValidationError('Invalid desktop delivery receipt');};
const sameOwner=(value,receipt)=>value?.executionId===receipt.executionId&&value?.generation===receipt.generation;

async function sha256(text){
 const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(text));
 return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function acceptedTransition(receipt,current,next,delegation){
 const old=current.checkpoint??{},after=next.checkpoint??{};
 if(old.provider!=='codex'||!sameOwner(old,receipt)||!['running','paused'].includes(current.status))return false;
 if(current.status==='paused'&&(old.interruptedBy!=='lease_expiry'||old.interruptedVersion!==current.version))return false;
 if(receipt.action==='fail')return !delegation&&['failed','waiting_quota','waiting_connection'].includes(next.status)
  &&after.provider==='codex'&&after.status===next.status&&after.failure&&typeof after.failure==='object'&&!after.confirmationRequired&&sameOwner(after,receipt);
 if(receipt.action!=='complete')return false;
 if(!delegation&&next.status==='completed')return after.provider==='codex'&&after.status==='completed'&&sameOwner(after,receipt);
 if(!delegation&&next.status==='queued')return after.status==='queued'
  &&sameOwner(after.handoff,receipt)&&after.handoff.from==='codex'&&after.provider!==old.provider;
 if(!delegation&&next.status==='waiting_user')return after.provider==='codex'&&after.status==='waiting_user'
  &&sameOwner(after,receipt)&&current.delegation?.state==='reviewing'
  &&next.decision&&typeof next.decision==='object'&&typeof next.decision.prompt==='string'
  &&Array.isArray(next.decision.options)&&next.decision.options.length>=2&&next.decision.options.length<=5;
 if(next.status==='waiting_children')return delegation&&after.status==='waiting_children'
  &&next.delegation?.state==='waiting_children'
  &&(sameOwner({executionId:next.delegation.sourceExecutionId,generation:next.delegation.sourceGeneration},receipt)
   ||sameOwner(next.delegation.lastReviewRetry,receipt));
 return false;
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
 return {key:'desktop_receipt:'+receipt.id,value:JSON.stringify({...Object.fromEntries(fields.map(key=>[key,receipt[key]])),acceptedAt}),workspaceId:receipt.workspaceId};
}

// Must immediately follow the existing revision UPDATE. The assertion rolls
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
