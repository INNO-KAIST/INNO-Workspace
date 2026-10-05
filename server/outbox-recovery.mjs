import * as nodeFs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkedRecord,checkedReceipt} from './delivery-protocol.mjs';
import {checkedDeliveryBinding} from './delivery-binding.mjs';

const LIMIT=1024*1024;
const HEX=/^[0-9a-f]{64}$/;
const conflict=()=>Object.assign(Error('Outbox recovery could not verify the saved files. Preserve both files for explicit recovery.'),{code:'OUTBOX_RECOVERY_CONFLICT',status:409});
const identity=stat=>({dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});
const same=(left,right)=>Object.keys(left).length===Object.keys(right).length&&Object.keys(left).every(key=>left[key]===right[key]);
const safeOwner=record=>record.phase==='ack_pending'
 ? {taskId:record.receipt.taskId,executionId:record.receipt.executionId,generation:record.receipt.generation,action:record.receipt.action}
 : {taskId:record.taskId,executionId:record.input.executionId,generation:record.input.generation,action:record.action};
const id=value=>typeof value==='string'&&!!value.trim()&&value.length<=200;

// The caller must supply a real exclusive lock shared with every outbox writer.
// Node path checks cannot prove complete Windows reparse-point protection or
// compare-and-swap against arbitrary external editors. No power-loss guarantee.
export function createOutboxRecovery(pendingPath,{fs=nodeFs,withExclusive}={}){
 if(typeof pendingPath!=='string'||!path.isAbsolute(pendingPath)||pendingPath.includes('\0'))throw conflict();
 const temporaryPath=pendingPath+'.tmp',parent=path.dirname(pendingPath);
 const openFlags=write=>(write?fs.constants.O_RDWR:fs.constants.O_RDONLY)|(fs.constants.O_NOFOLLOW??0);
 const parentPath=()=>fs.realpathSync(parent);
 async function readOne(file){
  let before;try{before=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return {meta:{exists:false,bytes:0,sha256:null,phase:'missing'}};throw conflict();}
  const meta={exists:true,bytes:before.size,sha256:null,phase:'unsafe_file'},initial=identity(before);
  if(before.isSymbolicLink()||!before.isFile())return {meta,identity:initial};
  let fd,failure,total=0;const bytes=Buffer.alloc(LIMIT+1);
  try{
   fd=fs.openSync(file,openFlags(false));const opened=fs.fstatSync(fd);
   if(!opened.isFile()||!same(initial,identity(opened)))throw conflict();
   while(total<bytes.length){const count=fs.readSync(fd,bytes,total,bytes.length-total,null);if(count===0)break;total+=count;}
   if(!same(initial,identity(fs.fstatSync(fd))))throw conflict();
  }catch(error){failure=error;}
  if(fd!==undefined)try{fs.closeSync(fd);}catch(error){failure??=error;}
  if(failure)throw conflict();
  const after=fs.lstatSync(file);if(after.isSymbolicLink()||!after.isFile()||!same(initial,identity(after)))throw conflict();
  if(total>LIMIT||before.size>LIMIT)return {meta:{...meta,phase:'oversize'},identity:initial};
  if(total!==before.size)throw conflict();
  const raw=bytes.subarray(0,total);meta.sha256=createHash('sha256').update(raw).digest('hex');meta.phase='invalid';
  let record;try{record=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));}catch{return {meta,identity:initial};}
  if(record&&typeof record==='object'&&!Array.isArray(record)&&record.version===undefined&&record.phase===undefined){
   if(id(record.taskId)&&['complete','fail'].includes(record.action)&&id(record.input?.executionId)&&Number.isSafeInteger(record.input?.generation)&&record.input.generation>0){
    meta.phase='legacy';meta.owner=safeOwner(record);
    if(record.binding!==undefined)try{meta.binding=checkedDeliveryBinding(record.binding);}catch{/* diagnostic only; never promoted */}
    return {meta,identity:initial,legacy:record};
   }
   return {meta,identity:initial};
  }
  try{
   const checked=await checkedRecord(record);meta.phase=record.phase;meta.binding=checked.binding;meta.owner=safeOwner(record);
   return {meta,identity:initial,record,descriptor:checked.descriptor};
  }catch{return {meta,identity:initial};}
 }
 async function readPair(){
  const realParent=parentPath(),pending=await readOne(pendingPath),temporary=await readOne(temporaryPath);
  if(parentPath()!==realParent)throw conflict();
  return {pending,temporary,parent:realParent};
 }
 async function permitted(pair){
  const {pending,temporary}=pair,p=pending.meta.phase,t=temporary.meta.phase;
  if(t!=='pending'&&t!=='ack_pending')return false;
  if(p==='missing')return t==='pending';
  if(!['pending','ack_pending'].includes(p)||!same(pending.meta.binding,temporary.meta.binding))return false;
  if(p==='pending'&&t==='pending')return same(pending.descriptor,temporary.descriptor);
  if(p==='pending'&&t==='ack_pending'){
   try{await checkedReceipt(temporary.record.receipt,pending.meta.binding,pending.descriptor);return true;}catch{return false;}
  }
  return p==='ack_pending'&&t==='ack_pending'&&same(pending.record.receipt,temporary.record.receipt);
 }
 const unchanged=(before,after)=>before.parent===after.parent&&['pending','temporary'].every(key=>{
  const a=before[key],b=after[key];return a.meta.exists===b.meta.exists&&a.meta.sha256===b.meta.sha256&&(!a.meta.exists||same(a.identity,b.identity));
 });
 return {
  // Internal only: the caller holds the bridge lock through subsequent delivery.
  // Return this bounded, verified snapshot; arbitrary external writers are excluded.
  async readPending(hash){
   if(typeof hash!=='string'||!HEX.test(hash))throw conflict();
   const expectedHash=hash;
   try{
    const pair=await readPair();
    if(pair.temporary.meta.exists||!['pending','ack_pending'].includes(pair.pending.meta.phase)||pair.pending.meta.sha256!==expectedHash)throw conflict();
    return pair.pending.record;
   }catch{throw conflict();}
  },
  // A legacy (protocol 0, receipt-less) saved result. It is never promoted or treated as
  // accepted; the caller checks the Worker and either delivers it the old way or archives it.
  async readLegacy(hash){
   if(typeof hash!=='string'||!HEX.test(hash))throw conflict();
   try{
    const pair=await readPair();
    if(pair.temporary.meta.exists||pair.pending.meta.phase!=='legacy'||pair.pending.meta.sha256!==hash)throw conflict();
    return pair.pending.legacy;
   }catch{throw conflict();}
  },
  // Moves the exact legacy file aside (same directory, never deleted) once `allowed`, a
  // Worker check run under the same lock, confirms it can no longer be applied.
  async archiveLegacy(input,{allowed}={}){
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||input.confirm!==true||typeof input.pendingHash!=='string'||!HEX.test(input.pendingHash)||typeof allowed!=='function')
    throw Object.assign(Error('Invalid legacy archive confirmation'),{status:400});
   const archivePath=pendingPath+'.legacy-'+input.pendingHash.slice(0,16)+'.json';let committed;
   try{
    await withExclusive(async()=>{
     if(committed)return committed;
     const before=await readPair();
     if(before.temporary.meta.exists||before.pending.meta.phase!=='legacy'||before.pending.meta.sha256!==input.pendingHash||fs.existsSync(archivePath))throw conflict();
     if(await allowed(before.pending.legacy)!==true)throw conflict();
     const after=await readPair();if(!unchanged(before,after))throw conflict();
     // Rename replaces an existing target, so check again after the awaited Worker call.
     if(fs.existsSync(archivePath))throw conflict();
     fs.renameSync(pendingPath,archivePath);committed={archived:true,archive:path.basename(archivePath)};return committed;
    });
   }catch{if(!committed)throw conflict();committed={...committed,recoveryLockUncertain:true};}
   if(!committed)throw conflict();
   return committed;
  },
  async inspect(){
   try{const pair=await readPair();return {pending:pair.pending.meta,temporary:pair.temporary.meta,canPromote:await permitted(pair)};}catch{throw conflict();}
  },
  async promote(input){
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==3||!['pendingHash','temporaryHash','confirm'].every(key=>Object.hasOwn(input,key))||input.confirm!==true||(input.pendingHash!==null&&(typeof input.pendingHash!=='string'||!HEX.test(input.pendingHash)))||typeof input.temporaryHash!=='string'||!HEX.test(input.temporaryHash)||typeof withExclusive!=='function')throw conflict();
   const expected={pendingHash:input.pendingHash,temporaryHash:input.temporaryHash};let committed;
   try{
    await withExclusive(async()=>{
     if(committed)return committed;
     const before=await readPair();
     if(before.pending.meta.sha256!==expected.pendingHash||before.temporary.meta.sha256!==expected.temporaryHash||before.pending.meta.exists===(expected.pendingHash===null)||!await permitted(before))throw conflict();
     let fd,failure;
     try{
      fd=fs.openSync(temporaryPath,openFlags(true));const opened=fs.fstatSync(fd);
      if(!opened.isFile()||!same(identity(opened),before.temporary.identity))throw conflict();
      fs.fsyncSync(fd);
     }catch(error){failure=error;}
     // A failed close may already release the descriptor: never retry it.
     if(fd!==undefined)try{fs.closeSync(fd);}catch(error){failure??=error;}
     if(failure)throw conflict();
     const after=await readPair();if(!unchanged(before,after))throw conflict();
     const result={promoted:true,phase:after.temporary.meta.phase,sha256:after.temporary.meta.sha256};
     fs.renameSync(temporaryPath,pendingPath);committed=result;return result;
    });
   }catch{if(!committed)throw conflict();committed={...committed,recoveryLockUncertain:true};}
   if(!committed)throw conflict();
   // No I/O after rename, including no verification that could turn an already
   // committed promotion into a reported failure. Lock cleanup may fail too.
   return committed;
  }
 };
}
