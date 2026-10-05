import * as nodeFs from 'node:fs';

// Same atomic write as the result outbox (temporary file, flush, rename), but an unfinished
// temporary write is discarded. A "requested" record is always written before its claim
// request leaves, and an "owned" record replaces a committed "requested" record for the
// same nonce, so the committed file alone is always a safe basis for recovery. Flush and
// rename support process restarts, not Windows power-loss durability of the directory.
const invalid=()=>Object.assign(Error('The saved claim journal is unreadable. Keep it and recover explicitly before new desktop claims.'),{status:409,code:'CLAIM_JOURNAL_INVALID'});

export function createFileJournal(journalPath,{fs=nodeFs}={}){
 const temporaryPath=journalPath+'.tmp';
 const discardTemporary=()=>{if(fs.existsSync(temporaryPath))fs.unlinkSync(temporaryPath);};
 return {
  read(){
   discardTemporary();
   if(!fs.existsSync(journalPath))return null;
   let value;
   try{value=JSON.parse(fs.readFileSync(journalPath,'utf8'));}catch{throw invalid();}
   if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
   return value;
  },
  write(record){
   discardTemporary();
   const raw=JSON.stringify(record);
   const fd=fs.openSync(temporaryPath,'wx',0o600);let failure;
   try{fs.writeFileSync(fd,raw,{encoding:'utf8'});fs.fsyncSync(fd);}catch(error){failure=error;}
   try{fs.closeSync(fd);}catch(error){failure??=error;}
   if(failure)throw failure;
   fs.renameSync(temporaryPath,journalPath);
  },
  clear(){discardTemporary();if(fs.existsSync(journalPath))fs.unlinkSync(journalPath);},
 };
}
