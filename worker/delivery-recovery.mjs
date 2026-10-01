import {ConflictError,ValidationError,TASK_STATUSES} from '../public/core/tasks.mjs';
import {reservationKey} from './delivery-reservations.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';

const FIELDS=['version','workspaceId','taskId','executionId','generation','claimedAt'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const positive=value=>Number.isSafeInteger(value)&&value>0;
const identifier=value=>typeof value==='string'&&!!value.trim()&&value.length<=200;
function checkedReservation(value){
 if(!exact(value,FIELDS))throw new ValidationError('Invalid desktop delivery reservation');
 const reservation=Object.fromEntries(FIELDS.map(field=>[field,value[field]]));
 const time=typeof reservation.claimedAt==='string'?Date.parse(reservation.claimedAt):NaN;
 if(reservation.version!==1||typeof reservation.workspaceId!=='string'||!UUID.test(reservation.workspaceId)||!identifier(reservation.taskId)||!identifier(reservation.executionId)||!positive(reservation.generation)||!Number.isFinite(time)||new Date(time).toISOString()!==reservation.claimedAt)throw new ValidationError('Invalid desktop delivery reservation');
 return reservation;
}
function checkedInput(input){
 if(!exact(input,['reservation','expectedVersion','confirmDiscard'])||input.confirmDiscard!==true||!positive(input.expectedVersion))throw new ValidationError('Explicit desktop reservation discard confirmation is required');
 // Copy every primitive before the first asynchronous key or database operation.
 return {reservation:checkedReservation(input.reservation),expectedVersion:input.expectedVersion};
}
const conflict=message=>new ConflictError(message);
const parse=(raw,label)=>{try{return JSON.parse(raw);}catch{throw conflict('Invalid stored '+label);}};

// Internal, explicitly authorized discard only. No lease timeout or caller
// status alone proves that an offline result does not exist. A missing row is
// reported as missing, never as evidence of acceptance or successful discard.
export async function releaseDeliveryReservation(db,input){
 const {reservation,expectedVersion}=checkedInput(input);
 const key=await reservationKey(reservation);
 const receiptKeys=await Promise.all(['complete','fail'].map(async action=>'desktop_receipt:'+(await createDeliveryReceipt({workspaceId:reservation.workspaceId,taskId:reservation.taskId,action,input:{executionId:reservation.executionId,generation:reservation.generation}})).id));
 const inspect=async()=>{
  if((await db.prepare("SELECT value FROM metadata WHERE key='desktop_workspace_id'").first())?.value!==reservation.workspaceId)throw conflict('Desktop reservation workspace mismatch');
  const task=await db.prepare('SELECT id,version,body FROM tasks WHERE id=?1').bind(reservation.taskId).first();
  if(!task||typeof task.body!=='string')throw conflict('Desktop reservation task is missing');
  const body=parse(task.body,'desktop reservation task');
  if(!body||typeof body!=='object'||Array.isArray(body)||task.id!==reservation.taskId||body.id!==task.id||task.version!==expectedVersion||body.version!==task.version||!TASK_STATUSES.includes(body.status))throw conflict('Desktop reservation task changed or is invalid');
  if(body.status==='running')throw conflict('Running desktop reservation cannot be discarded');
  if(await db.prepare('SELECT key FROM metadata WHERE key IN (?1,?2) LIMIT 1').bind(...receiptKeys).first())throw conflict('Accepted desktop delivery receipt prevents reservation discard');
  const row=await db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first();
  if(row){
   const saved=parse(row.value,'desktop delivery reservation');
   if(!exact(saved,FIELDS)||FIELDS.some(field=>saved[field]!==reservation[field]))throw conflict('Desktop delivery reservation changed');
  }
  return {task,row};
 };
 const before=await inspect();
 const missing=()=>({reservation,released:false,reason:'reservation_not_found'});
 if(!before.row)return missing();
 const result=await db.prepare(`DELETE FROM metadata WHERE key=?1 AND value=?2
  AND EXISTS (SELECT 1 FROM tasks WHERE id=?3 AND version=?4 AND body=?5)
  AND EXISTS (SELECT 1 FROM metadata WHERE key='desktop_workspace_id' AND value=?6)
  AND NOT EXISTS (SELECT 1 FROM metadata WHERE key IN (?7,?8))`)
  .bind(key,before.row.value,reservation.taskId,expectedVersion,before.task.body,reservation.workspaceId,...receiptKeys).run();
 if(Number(result?.meta?.changes??0)===1)return {reservation,released:true};
 const after=await inspect();
 if(after.task.body!==before.task.body||after.task.version!==before.task.version)throw conflict('Desktop reservation task changed during discard');
 if(!after.row)return missing();
 throw conflict(after.row.value!==before.row.value?'Desktop delivery reservation changed during discard':'Desktop delivery reservation could not be released');
}

// A bounded, read-only page, not a snapshot across requests. Every discard still
// needs its own explicit confirmation and current task/version CAS checks.
export async function listDeliveryReservations(db,taskId,input,workspaceId){
 if(!identifier(taskId)||typeof workspaceId!=='string'||!UUID.test(workspaceId)
  ||!input||typeof input!=='object'||Array.isArray(input)
  ||!exact(input,Object.hasOwn(input,'afterKey')?['expectedVersion','afterKey']:['expectedVersion'])
  ||!positive(input.expectedVersion)
  ||Object.hasOwn(input,'afterKey')&&(typeof input.afterKey!=='string'||!/^desktop_reservation:[0-9a-f]{64}$/.test(input.afterKey)))throw new ValidationError('Invalid desktop reservation listing request');
 const expectedVersion=input.expectedVersion,afterKey=input.afterKey;
 if((await db.prepare("SELECT value FROM metadata WHERE key='desktop_workspace_id'").first())?.value!==workspaceId)throw conflict('Desktop reservation workspace mismatch');
 const task=await db.prepare('SELECT id,version,body FROM tasks WHERE id=?1').bind(taskId).first();
 if(!task||typeof task.body!=='string')throw conflict('Desktop reservation task is missing');
 const body=parse(task.body,'desktop reservation task');
 if(!body||typeof body!=='object'||Array.isArray(body)||task.id!==taskId||body.id!==task.id||task.version!==expectedVersion||body.version!==task.version||!TASK_STATUSES.includes(body.status))throw conflict('Desktop reservation task changed or is invalid');
 const rows=(await db.prepare("SELECT key,value FROM metadata WHERE key GLOB 'desktop_reservation:*' ORDER BY key LIMIT 1025").all()).results;
 if(!Array.isArray(rows)||rows.length>1024)throw conflict('Desktop delivery reservation listing limit exceeded');
 const matches=[];
 for(const row of rows){
  let reservation;try{reservation=checkedReservation(parse(row.value,'desktop delivery reservation'));}catch{throw conflict('Invalid stored desktop delivery reservation');}
  if(reservation.workspaceId!==workspaceId||row.key!==await reservationKey(reservation))throw conflict('Desktop delivery reservation identity mismatch');
  if(reservation.taskId===taskId&&(afterKey===undefined||row.key>afterKey))matches.push({key:row.key,reservation});
 }
 const page=matches.slice(0,50);
 return {reservations:page.map(row=>row.reservation),nextAfterKey:matches.length>50?page.at(-1).key:null,taskVersion:expectedVersion,workspaceId};
}
