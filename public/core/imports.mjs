import {sanitizeUsageHistory} from './execution-usage.mjs';
import {sanitizeArtifactChecks} from './artifact-checks.mjs';
import {sanitizeAttachments,ValidationError} from './tasks.mjs';
const text=(v,label,max=200000)=>{if(typeof v!=='string'||v.length>max)throw new ValidationError(`Invalid ${label}`);return v;};
const date=(v,fallback)=>{const x=v??fallback;if(typeof x!=='string'||!Number.isFinite(Date.parse(x)))throw new ValidationError('Invalid record date');return x;};
const array=(v,label,max)=>{if(!Array.isArray(v)||v.length>max)throw new ValidationError(`Invalid ${label}`);return v;};
const statuses=new Set(['ready','queued','claimed','running','paused','waiting_user','waiting_quota','waiting_connection','failed','completed','cancelled']);
export async function prepareImport(raw){
 if(!raw||typeof raw!=='object')throw new ValidationError('Invalid task');
 if(raw.evaluationBudget!==undefined||raw.checkpoint?.evaluationBudget!==undefined||raw.executionBudgetVersion!==undefined)
   throw new ValidationError('Server-owned evaluation budget cannot be imported');
 const id=text(raw.id,'task id',200);if(!id||!Number.isInteger(raw.version)||raw.version<1||!statuses.has(raw.status))throw new ValidationError('Invalid task identity or status');
 const createdAt=date(raw.createdAt),updatedAt=date(raw.updatedAt,createdAt);
 const status=['running','queued','claimed','ready'].includes(raw.status)?'paused':raw.status;
 let seq=0;const attachments=sanitizeAttachments(raw.attachments,{id:()=>`attachment-${seq++}`});
 for(const a of attachments)if(a.url){const u=new URL(a.url);if(u.username||u.password)throw new ValidationError('Credential-bearing URL cannot be imported');}
 const messages=array(raw.messages,'messages',10000).map((m,i)=>{if(!m||!['user','assistant','system'].includes(m.role))throw new ValidationError('Invalid message role');return {id:text(m.id??`message-${i}`,'message id',200),role:m.role,content:text(m.content,'message'),createdAt:date(m.createdAt,createdAt)};});
 const plan=array(raw.plan,'plan',6).map((p,i)=>{if(!p||!['pending','active','running','blocked','completed','cancelled','done','proposed'].includes(p.status))throw new ValidationError('Invalid plan status');return {id:text(p.id??`plan-${i}`,'plan id',200),role:text(p.role,'role',100),label:text(p.label,'label',200),instructions:text(p.instructions??'','instructions',4000),status:['active','running'].includes(p.status)?'pending':p.status};});
 const artifacts=array(raw.artifacts,'artifacts',1000).map((a,i)=>{if(!a||!['utf-8','base64'].includes(a.encoding??'utf-8'))throw new ValidationError('Invalid artifact encoding');return {id:text(a.id??`artifact-${i}`,'artifact id',200),name:text(a.name,'artifact name',500),mime:text(a.mime,'artifact mime',255),content:text(a.content,'artifact content',600000),encoding:a.encoding??'utf-8',checks:sanitizeArtifactChecks(a.checks),createdAt:date(a.createdAt,createdAt)};});
 const checkpointText=typeof raw.checkpoint==='string'?raw.checkpoint:raw.checkpoint?.content;
 const task={id,title:text(raw.title,'title',500),prompt:text(raw.prompt,'prompt'),type:text(raw.type??'general','type',100),status,version:raw.version,createdAt,updatedAt,messages,plan,artifacts,attachments,checkpoint:checkpointText===undefined?null:{content:text(checkpointText,'checkpoint'),status,updatedAt,usageHistory:sanitizeUsageHistory(raw.checkpoint?.usageHistory??(raw.checkpoint?.usage?[raw.checkpoint.usage]:[]))}};
 if(raw.decision){const d=raw.decision;task.decision={prompt:text(d.prompt,'decision',2000),options:array(d.options,'decision options',5).map(o=>({label:text(o.label,'option',500),pros:text(o.pros,'pros',2000),cons:text(o.cons,'cons',2000)}))};}
 const bytes=new TextEncoder().encode(JSON.stringify(task));if(bytes.length>680000)throw new ValidationError('Record exceeds 680000 bytes. Original record is preserved; no partial import.');
 const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 return {task,hash};
}
export async function importCopyId(id,hash){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id+'\n'+hash));return 'import-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
