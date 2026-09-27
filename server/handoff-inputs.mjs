import {writeFile} from 'node:fs/promises';
import path from 'node:path';
export async function prepareHandoffInputs(task,directory){
 const ids=task.checkpoint?.handoff?.artifactIds??[];
 if(!Array.isArray(ids)||ids.length>20||new Set(ids).size!==ids.length)throw Error('Invalid handoff artifact manifest');
 let total=0;
 const files=ids.map((id,index)=>{
  const a=task.artifacts?.find(a=>a.id===id);if(!a||typeof a.content!=='string')throw Error('Handoff artifact missing');
  if(a.content.length>7000000)throw Error('Handoff artifact exceeds limit');
  if(a.encoding&&!['utf-8','base64'].includes(a.encoding))throw Error('Invalid handoff artifact encoding');
  const bytes=Buffer.from(a.content,a.encoding==='base64'?'base64':'utf8');
  if(a.encoding==='base64'&&bytes.toString('base64')!==a.content.replace(/\s/g,''))throw Error('Invalid handoff base64');
  total+=bytes.length;if(total>5000000)throw Error('Handoff generated files exceed 5 MB');
  const extension=String(a.name).match(/\.[a-z0-9]{1,8}$/i)?.[0]??'.bin';
  return {bytes,manifest:{name:String(a.name).slice(0,500),mime:a.mime,path:'inno-handoff-'+String(index+1).padStart(3,'0')+extension}};
 });
 for(const file of files)await writeFile(path.join(directory,file.manifest.path),file.bytes,{flag:'wx'});
 return files.map(file=>file.manifest);
}

function bounded(value,label,max){
 if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`Review ${label} is missing or invalid`);
 return value.trim();
}
function reviewBytes(artifact){
 if(typeof artifact?.content!=='string')throw Error('Review artifact content is missing');
 const encoding=artifact.encoding??'utf-8';
 if(!['utf-8','base64'].includes(encoding))throw Error('Invalid review artifact encoding');
 if(encoding==='utf-8')return Buffer.from(artifact.content,'utf8');
 const compact=artifact.content.replace(/\s/g,'');
 const bytes=Buffer.from(compact,'base64');
 if(bytes.toString('base64').replace(/=+$/,'')!==compact.replace(/=+$/,''))throw Error('Invalid review artifact base64');
 return bytes;
}
export async function prepareReviewInputs(reviewInputs,directory){
 if(!Array.isArray(reviewInputs)||reviewInputs.length<1||reviewInputs.length>2)throw Error('Review inputs require one or two completed children');
 const seen=new Set(),files=[];let total=0;
 const manifest=reviewInputs.map((child,childIndex)=>{
  if(!child||typeof child!=='object'||child.attachments?.length||child.materials?.length)throw Error('Review inputs may contain generated artifacts only');
  const taskId=bounded(child.taskId,'child taskId',200),role=bounded(child.role,'child role',100),summary=bounded(child.summary,'child summary',12000);
  if(seen.has(taskId))throw Error('Duplicate review child taskId');seen.add(taskId);
  if(!Array.isArray(child.artifacts)||child.artifacts.length>10)throw Error('Invalid review artifact manifest');
  const artifacts=child.artifacts.map((artifact,artifactIndex)=>{
   if(!artifact||typeof artifact!=='object')throw Error('Invalid review artifact');
   const name=bounded(artifact.name,'artifact name',500),mime=bounded(artifact.mime,'artifact mime',255);
   const bytes=reviewBytes(artifact);total+=bytes.length;if(total>5_000_000)throw Error('Review generated files exceed 5 MB limit');
   const extension=name.match(/\.[a-z0-9]{1,8}$/i)?.[0]??'.bin';
   const safeTaskId=taskId.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,60)||String(childIndex+1);
   const fileName=`inno-review-${String(childIndex+1).padStart(3,'0')}-${safeTaskId}-${String(artifactIndex+1).padStart(3,'0')}${extension}`;
   files.push({path:fileName,bytes});
   return {artifactId:typeof artifact.artifactId==='string'?artifact.artifactId:typeof artifact.id==='string'?artifact.id:null,name,mime,encoding:artifact.encoding??'utf-8',bytes:bytes.length,path:fileName};
  });
  return {taskId,role,summary,artifacts};
 });
 for(const file of files)await writeFile(path.join(directory,file.path),file.bytes,{flag:'wx'});
 return manifest;
}
