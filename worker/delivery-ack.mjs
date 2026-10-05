import {ConflictError} from '../public/core/tasks.mjs';

const FIELDS=['version','id','workspaceId','taskId','executionId','generation','action','payloadDigest','acceptedAt'];
const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;
const conflict=message=>new ConflictError(message);

function canonicalTime(value){
 if(typeof value!=='string')return false;
 const time=Date.parse(value);
 if(!Number.isFinite(time))return false;
 try{return new Date(time).toISOString()===value;}catch{return false;}
}

async function checkedReceipt(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==FIELDS.length
  ||FIELDS.some(field=>!Object.hasOwn(value,field)))throw conflict('Invalid desktop delivery acknowledgment');
 const receipt=Object.fromEntries(FIELDS.map(field=>[field,value[field]]));
 if(receipt.version!==1||typeof receipt.workspaceId!=='string'||!UUID_V4.test(receipt.workspaceId)
  ||typeof receipt.id!=='string'||!HEX64.test(receipt.id)
  ||typeof receipt.payloadDigest!=='string'||!HEX64.test(receipt.payloadDigest)
  ||typeof receipt.taskId!=='string'||!receipt.taskId.trim()||receipt.taskId.length>200
  ||typeof receipt.executionId!=='string'||!receipt.executionId.trim()||receipt.executionId.length>200
  ||!Number.isSafeInteger(receipt.generation)||receipt.generation<1
  ||!['complete','fail'].includes(receipt.action)||!canonicalTime(receipt.acceptedAt))
  throw conflict('Invalid desktop delivery acknowledgment');
 const tuple=JSON.stringify([1,receipt.workspaceId,receipt.taskId,receipt.executionId,receipt.generation,receipt.action]);
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tuple));
 const id=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(id!==receipt.id)throw conflict('Desktop delivery acknowledgment identity mismatch');
 return receipt;
}

// A discarded receipt (worker/delivery-discharge.mjs) is released the same way.
function sameReceipt(saved,receipt){
 const extra=saved?.disposition==='discarded'?1:0;
 return saved&&typeof saved==='object'&&!Array.isArray(saved)
  &&Object.keys(saved).length===FIELDS.length+extra
  &&FIELDS.every(field=>Object.hasOwn(saved,field)&&saved[field]===receipt[field]);
}

// A missing row is an idempotent ACK only under the caller's durable
// ack_pending contract. This operation never changes a task or revision.
export async function releaseDeliveryReceipt(db,input){
 const receipt=await checkedReceipt(input);
 const workspace=()=>db.prepare("SELECT value FROM metadata WHERE key='desktop_workspace_id'").first();
 if((await workspace())?.value!==receipt.workspaceId)throw conflict('Desktop delivery acknowledgment workspace mismatch');
 const key='desktop_receipt:'+receipt.id;
 const read=()=>db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first();
 const row=await read();
 if(!row)return {receipt,released:false};
 let saved;
 try{saved=JSON.parse(row.value);}catch{throw conflict('Stored desktop delivery receipt is invalid');}
 if(!sameReceipt(saved,receipt))throw conflict('Desktop delivery acknowledgment conflicts with the settled result');
 const result=await db.prepare(`DELETE FROM metadata WHERE key=?1 AND value=?2
  AND EXISTS (SELECT 1 FROM metadata WHERE key='desktop_workspace_id' AND value=?3)`)
  .bind(key,row.value,receipt.workspaceId).run();
 if(Number(result?.meta?.changes??0)===1)return {receipt,released:true};
 if((await workspace())?.value!==receipt.workspaceId)throw conflict('Desktop delivery acknowledgment workspace mismatch');
 const latest=await read();
 if(!latest)return {receipt,released:false};
 let current;
 try{current=JSON.parse(latest.value);}catch{throw conflict('Stored desktop delivery receipt is invalid');}
 if(!sameReceipt(current,receipt))throw conflict('Desktop delivery acknowledgment conflicts with the settled result');
 throw conflict('Desktop delivery acknowledgment could not release its receipt');
}
