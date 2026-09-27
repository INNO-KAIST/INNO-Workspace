import {ValidationError} from './tasks.mjs';

const MAX_WIRE_BYTES=700_000;
const MAX_DEPTH=64;
const MAX_ID_LENGTH=200;
const workspaceUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();

function invalid(message){throw new ValidationError(`Invalid delivery receipt ${message}`);}
function boundedId(value,label){
 if(typeof value!=='string'||!value.trim()||value.length>MAX_ID_LENGTH)invalid(label);
 return value;
}
function wireInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input))invalid('input');
 const depths=new WeakMap();
 let json;
 try{
  json=JSON.stringify(input,function(_key,value){
   if(typeof value==='string'&&value.length>MAX_WIRE_BYTES)invalid('payload size');
   if(value&&typeof value==='object'){
    const depth=(depths.get(this)??0)+1;
    if(depth>MAX_DEPTH)invalid('payload depth');
    depths.set(value,depth);
   }
   return value;
  });
 }catch(error){
  if(error instanceof ValidationError)throw error;
  invalid('input');
 }
 if(typeof json!=='string'||encoder.encode(json).length>MAX_WIRE_BYTES)invalid('payload size');
 let normalized;
 try{normalized=JSON.parse(json);}catch{invalid('input');}
 if(!normalized||typeof normalized!=='object'||Array.isArray(normalized))invalid('input');
 return normalized;
}
function canonical(value){
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
 return JSON.stringify(value);
}
async function digest(value){
 const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(value));
 return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function createDeliveryReceipt({workspaceId,taskId,action,input}={}){
 if(typeof workspaceId!=='string'||!workspaceUuid.test(workspaceId))invalid('workspaceId');
 boundedId(taskId,'taskId');
 if(action!=='complete'&&action!=='fail')invalid('action');
 const normalized=wireInput(input);
 const executionId=boundedId(normalized.executionId,'executionId');
 const generation=normalized.generation;
 if(!Number.isSafeInteger(generation)||generation<1)invalid('generation');
 const id=await digest(JSON.stringify([1,workspaceId,taskId,executionId,generation,action]));
 const payloadDigest=await digest(canonical(normalized));
 return {version:1,id,workspaceId,taskId,executionId,generation,action,payloadDigest};
}
