import {createTask,ValidationError} from './tasks.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function creationId(input){
 if(input?.requestId===undefined)return null;
 if(typeof input.requestId!=='string'||!uuid.test(input.requestId))throw new ValidationError('requestId must be a UUID');
 return 'create-'+input.requestId.toLowerCase();
}
export function creationPayload(input){
 let sequence=0;const task=createTask(input,{now:()=>'',id:()=>`field-${++sequence}`});
 return JSON.stringify({prompt:task.prompt,title:task.title,type:task.type,attachments:task.attachments,...(task.projectId?{projectId:task.projectId}:{})});
}
export async function digestText(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');}
export class CreationRetries {
 constructor(scope,storage){this.scope=scope;this.storage=storage;this.rows=[];this.loaded=null;this.persistent=false;}
 async load(){
  this.key='inno-create-retries:'+await digestText(this.scope);
  try{if(this.storage===undefined)this.storage=globalThis.sessionStorage;const raw=JSON.parse(this.storage?.getItem(this.key)??'[]');if(Array.isArray(raw))this.rows=raw.filter(r=>r&&/^[0-9a-f]{64}$/.test(r.hash)&&typeof r.id==='string'&&uuid.test(r.id)).slice(0,16);}catch{/* Memory-only fallback when session storage is unavailable. */}
 }
 save(){try{if(this.rows.length)this.storage?.setItem(this.key,JSON.stringify(this.rows));else this.storage?.removeItem(this.key);this.persistent=!!this.storage;}catch{this.persistent=false;}}
 async begin(input){
  await (this.loaded??=this.load());const hash=await digestText(creationPayload(input));let row=this.rows.find(r=>r.hash===hash);
  if(!row){if(this.rows.length>=16)throw Error('확인되지 않은 생성 요청이 16개입니다. 기존 요청을 같은 내용으로 다시 보내 저장 여부를 확인하세요.');row={hash,id:crypto.randomUUID()};this.rows.push(row);this.save();}
  return row;
 }
 finish(row){this.rows=this.rows.filter(r=>r.id!==row.id);this.save();}
}
