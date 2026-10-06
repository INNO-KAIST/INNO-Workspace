import {ConflictError,ValidationError} from '../public/core/tasks.mjs';
import {DELEGATION_MIN_CHILDREN,DELEGATION_MAX_CHILDREN} from '../public/core/delegation.mjs';
const size=s=>new TextEncoder().encode(s).byteLength;
function byteLength(a){
 if(a.encoding!=='base64')return size(a.content);
 let raw;try{raw=atob(a.content);}catch{throw new ValidationError('Invalid generated file encoding');}
 if(btoa(raw)!==a.content.replace(/\s/g,''))throw new ValidationError('Non-canonical generated file encoding');return raw.length;
}
export async function reviewInputs(store,parent){
 if(parent.delegation?.state!=='reviewing')return [];
 const manifests=parent.delegation.review?.children;
 // One manifest per frozen child (2 to 4), each naming a distinct frozen child.
 const frozen=(parent.delegation.children??[]).map(c=>c?.taskId);
 if(!Array.isArray(manifests)||manifests.length<DELEGATION_MIN_CHILDREN||manifests.length>DELEGATION_MAX_CHILDREN||manifests.length!==frozen.length)throw new ValidationError('Review child manifest missing');
 if(new Set(manifests.map(m=>m.taskId)).size!==manifests.length||manifests.some(m=>!frozen.includes(m.taskId)))throw new ValidationError('Duplicate review child');
 let bytes=0,count=0;
 const results=[];
 for(const m of manifests){
  const child=await store.requireTask(m.taskId);
  if(child.id!==m.taskId||child.parentTaskId!==parent.id||child.batchId!==parent.delegation.batchId||child.status!=='completed')throw new ConflictError('Review child changed',parent.version);
  if(typeof m.summary!=='string'||m.summary.length>12000||!Array.isArray(m.artifacts))throw new ValidationError('Invalid review manifest');
  if(new Set(m.artifacts.map(ref=>ref.artifactId)).size!==m.artifacts.length)throw new ValidationError('Duplicate review artifact');
  const artifacts=m.artifacts.map(ref=>{
   const a=child.artifacts?.find(a=>a.id===ref.artifactId);
   if(!a||typeof a.content!=='string'||a.name!==ref.name||a.mime!==ref.mime||(a.encoding??'utf-8')!==(ref.encoding??'utf-8'))throw new ValidationError('Review artifact missing or changed');
   if(a.content.length>7000000)throw new ValidationError('Review input too large');
   const n=byteLength(a);if(n!==ref.bytes)throw new ValidationError('Review artifact size changed');
   bytes+=n;count++;if(bytes>5000000||count>20)throw new ValidationError('Review input limit exceeded');
   return {...a};
  });
  results.push({taskId:m.taskId,role:m.role,summary:m.summary,artifacts});
 }
 return results;
}
