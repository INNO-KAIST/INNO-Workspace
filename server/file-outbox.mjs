import {readFileSync,writeFileSync,renameSync,unlinkSync,existsSync} from 'node:fs';

export function createFileOutbox(pendingPath){
 return {
  read:()=>existsSync(pendingPath)?JSON.parse(readFileSync(pendingPath,'utf8')):null,
  write:record=>{const raw=JSON.stringify(record);writeFileSync(pendingPath+'.tmp',raw,{mode:0o600});renameSync(pendingPath+'.tmp',pendingPath);},
  clear:()=>{if(existsSync(pendingPath))unlinkSync(pendingPath);}
 };
}
