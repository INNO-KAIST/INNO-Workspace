import {randomBytes} from 'node:crypto';
import {readTaskContext} from '../public/core/task-context-read.mjs';
import {sanitizeResumeState} from '../public/core/context-resume.mjs';

// Fixed production ceilings: one active snapshot, one read at a time. 32 MiB
// allows a complete 4 MiB snapshot read even with worst-case JSON escaping.
export const CONTEXT_ACCESS_LIMITS = Object.freeze({maxSnapshotBytes:4*1024*1024,maxRequestBytes:4096,maxResponseBytes:128*1024,maxTotalBytes:32*1024*1024,maxRequests:1024});
const reject = (statusCode,message) => {throw Object.assign(new Error(message),{statusCode});};
export function checkedContextUrl(value) {
  if(typeof value!=='string'||!/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/api\/desktop\/context$/.test(value))reject(400,'Invalid local context endpoint');
  const port=Number(value.match(/^http:\/\/127\.0\.0\.1:(\d+)\//)[1]);
  if(port<1||port>65535)reject(400,'Invalid local context endpoint');
  return value;
}
const scalar=value=>value==null?null:typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)?value:reject(400,'Invalid local context metadata');
const metadata=(value,keys)=>Object.fromEntries(keys.map(key=>[key,scalar(value?.[key])]));
function sourceSnapshot(task) {
  if(typeof task?.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(task.id)||!Number.isSafeInteger(task.version)||task.version<1)reject(400,'Invalid local context task');
  let resumeState;
  if(task.checkpoint?.resumeState!==undefined){try{resumeState=sanitizeResumeState(task.checkpoint.resumeState);}catch{resumeState=null;}}
  // Only durable conversation and scope metadata enter this snapshot. Transient
  // materials, original attachments, generated artifacts and credentials do not.
  return {id:task.id,version:task.version,prompt:String(task.prompt??''),
    messages:(Array.isArray(task.messages)?task.messages:[]).map(message=>({id:message?.id==null?null:String(message.id),role:['user','assistant','system'].includes(message?.role)?message.role:'system',content:String(message?.content??'')})),
    checkpoint:{content:String((typeof task.checkpoint==='string'?task.checkpoint:task.checkpoint?.content)??''),...(resumeState===undefined?{}:{resumeState})},
    parentTaskId:scalar(task.parentTaskId),batchId:scalar(task.batchId),assignment:structuredClone(task.assignment??null),
    delegation:{state:scalar(task.delegation?.state),review:structuredClone(task.delegation?.review??null)},
    attachments:(Array.isArray(task.attachments)?task.attachments:[]).map(attachment=>({...metadata(attachment,['id','name','path','size','lastModified','type','source','url']),
      view:attachment?.view==null?null:metadata(attachment.view,['kind','sha256','start','end','startPage','endPage'])})),
  };
}

/** Memory-only, execution-scoped registry. Overrides may lower, never raise, limits. */
export function createContextAccess(overrides={}) {
  if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))reject(400,'Invalid local context limits');
  const limits={...CONTEXT_ACCESS_LIMITS};
  for(const [key,value] of Object.entries(overrides)){
    if(!['maxSnapshotBytes','maxResponseBytes','maxTotalBytes','maxRequests'].includes(key)||!Number.isSafeInteger(value)||value<1||value>limits[key])reject(400,'Invalid local context limits');
    limits[key]=value;
  }
  let active=null,closed=false;
  const live=token=>{
    if(!active||active.revoked||typeof token!=='string'||token!==active.token)reject(401,'Local context access is unavailable');
    return active;
  };
  return {
    open(task,signal){
      if(closed||signal?.aborted)reject(401,'Local context access is unavailable');
      if(active)reject(409,'Local context access is already active');
      let json;
      try{json=JSON.stringify(sourceSnapshot(task));}catch(error){if(error.statusCode)throw error;reject(400,'Invalid local context task');}
      if(Buffer.byteLength(json)>limits.maxSnapshotBytes)reject(413,'Local context snapshot exceeds the supported byte limit');
      const record={token:randomBytes(32).toString('base64url'),source:JSON.parse(json),requests:0,bytes:0,busy:false,revoked:false};
      const revoke=()=>{record.revoked=true;record.source=null;if(active===record)active=null;signal?.removeEventListener('abort',revoke);};
      record.revoke=revoke;active=record;signal?.addEventListener('abort',revoke,{once:true});
      return {token:record.token,revoke};
    },
    async read(token,input){
      const record=live(token);
      if(record.busy)reject(429,'Local context read is already in progress');
      if(record.requests>=limits.maxRequests||record.bytes>=limits.maxTotalBytes)reject(429,'Local context execution read budget is exhausted');
      let requestBytes;
      try{requestBytes=Buffer.byteLength(JSON.stringify(input));}catch{reject(400,'Invalid local context request');}
      if(requestBytes>limits.maxRequestBytes)reject(413,'Local context request exceeds the supported byte limit');
      record.busy=true;record.requests++;
      try{
        const result=await readTaskContext(record.source,input);
        // Abort/revocation while a digest is running must suppress its response.
        if(record.revoked||active!==record)reject(401,'Local context access is unavailable');
        const responseBytes=Buffer.byteLength(JSON.stringify(result));
        if(responseBytes>limits.maxResponseBytes)reject(413,'Local context response exceeds the supported byte limit');
        if(record.bytes+responseBytes>limits.maxTotalBytes)reject(429,'Local context execution read budget is exhausted');
        record.bytes+=responseBytes;
        return result;
      }catch(error){
        if(record.revoked||active!==record)reject(401,'Local context access is unavailable');
        throw error;
      }finally{record.busy=false;}
    },
    close(){closed=true;active?.revoke();},
  };
}
