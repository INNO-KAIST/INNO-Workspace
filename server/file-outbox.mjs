import * as nodeFs from 'node:fs';

export function createFileOutbox(pendingPath,{fs=nodeFs}={}){
 const temporaryPath=pendingPath+'.tmp';
 const checkedRecord=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(Error('Invalid saved delivery requires explicit recovery.'),{status:409,code:'OUTBOX_RECOVERY_REQUIRED'});
  return value;
 };
 const assertNoTemporary=()=>{
  if(fs.existsSync(temporaryPath))throw Object.assign(Error('An unfinished outbox write requires explicit recovery. Preserve both pending and temporary files.'),{status:409,code:'OUTBOX_RECOVERY_REQUIRED'});
 };
 return {
  read:()=>{assertNoTemporary();return fs.existsSync(pendingPath)?checkedRecord(JSON.parse(fs.readFileSync(pendingPath,'utf8'))):null;},
  write:record=>{
   assertNoTemporary();const raw=JSON.stringify(checkedRecord(record));checkedRecord(JSON.parse(raw));
   const fd=fs.openSync(temporaryPath,'wx',0o600);let failure;
   try{fs.writeFileSync(fd,raw,{encoding:'utf8'});fs.fsyncSync(fd);}catch(error){failure=error;}
   // Close exactly once: a failed close may already have released the descriptor.
   // Retain the first error and all on-disk evidence; never rename on failure.
   try{fs.closeSync(fd);}catch(error){failure??=error;}
   if(failure)throw failure;
   // File flush + rename supports tested process restarts, not Windows power-loss
   // durability of the parent directory entry.
   fs.renameSync(temporaryPath,pendingPath);
  },
  clear:()=>{assertNoTemporary();if(fs.existsSync(pendingPath))fs.unlinkSync(pendingPath);}
 };
}
