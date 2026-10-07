import {ConflictError,ValidationError,applyAction} from './tasks.mjs';
import {executionUsage,usageHistory} from './execution-usage.mjs';
import {isAssignableProvider,usesTransport} from './providers.mjs';
const bounded=(value,label,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new ValidationError('Invalid handoff '+label);return value.trim();};
export function isHandoffReplay(task,input){return (task.checkpoint?.handoffHistory??[]).some(h=>h.executionId===input.executionId&&h.generation===input.generation);}
export function handoffTask(task,input,{now=()=>new Date().toISOString(),id=()=>crypto.randomUUID(),recoverInterrupted=false}={}){
 const c=task.checkpoint??{};
 const recover=recoverInterrupted&&usesTransport(c.provider,'desktop_bridge')&&task.status==='paused'&&c.interruptedBy==='lease_expiry'&&c.interruptedVersion===task.version;
 if((task.status!=='running'&&!recover)||c.executionId!==input.executionId||c.generation!==input.generation)throw new ConflictError('Stale handoff owner',task.version);
 if(task.attachments?.length||task.checkpoint?.sourceBound)throw new ValidationError('Reconnect original sources: automatic handoff does not transfer attachments.');
 const history=c.handoffHistory??[];if(history.length>=2)throw new ValidationError('At most two provider handoffs per task.');
 const h=input.handoff;if(!h||!isAssignableProvider(h.provider)||h.provider===c.provider)throw new ValidationError('Handoff must target the other provider.');
 const record={executionId:input.executionId,generation:input.generation,from:c.provider,to:h.provider,instructions:bounded(h.instructions,'instructions',12000),reason:bounded(h.reason,'reason',1000),acceptance:bounded(h.acceptance,'acceptance',2000),createdAt:now()};
 const content=bounded(input.content,'verified progress',12000);
 if(input.artifacts!==undefined&&(!Array.isArray(input.artifacts)||input.artifacts.length>10))throw new ValidationError('Invalid handoff artifacts');
 let updated=task;for(const artifact of input.artifacts??[])updated=applyAction(updated,{action:'artifact',expectedVersion:updated.version,artifact},{now,id});
 if(updated.artifacts.length>20||updated.artifacts.reduce((sum,a)=>sum+a.content.length,0)>5000000)throw new ValidationError('Handoff generated files exceed 20 files or 5 MB encoded content.');
 record.artifactIds=updated.artifacts.map(a=>a.id);
 return {...updated,status:'queued',version:task.version+1,updatedAt:record.createdAt,messages:[...updated.messages,{id:id(),role:'assistant',content,createdAt:record.createdAt}],checkpoint:{...c,executionId:undefined,provider:h.provider,routing:undefined,status:'queued',expiresAt:undefined,sessionUrl:undefined,failure:undefined,content,usage:executionUsage(c,input.usage,record.createdAt),usageHistory:usageHistory(c,input.usage,record.createdAt,{task,transition:'handoff'}),updatedAt:record.createdAt,handoffHistory:[...history,record],handoff:record}};
}
export function handoffContext(task){const h=task.checkpoint?.handoff;return h?['Current provider handoff (continue this stage, not the old provider stage):',JSON.stringify({from:h.from,to:h.to,instructions:h.instructions,reason:h.reason,acceptance:h.acceptance,transitions:task.checkpoint.handoffHistory?.length}), 'Previous generated progress:',task.checkpoint.content,'Newer user messages override these stage instructions. Validate the handed-off work before final integration. Generated progress is not primary-source evidence. Do not repeat completed work.'].join('\n'):'';}
