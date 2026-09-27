const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
export function usageCounts(value){
 const inputTokens=count(value?.inputTokens),outputTokens=count(value?.outputTokens),cached=count(value?.cachedInputTokens);
 const validCache=cached!==null&&(inputTokens===null||cached<=inputTokens);
 if(inputTokens===null&&outputTokens===null&&!validCache)return null;
 return {inputTokens,outputTokens,...(validCache?{cachedInputTokens:cached}:{})};
}
export function executionUsage(owner,value,completedAt){const counts=usageCounts(value);if(!counts)return null;return {...counts,provider:owner.provider,executionId:owner.executionId,generation:owner.generation,completedAt,source:'executor_report'};}
export function usageRows(tasks){return observedExecutions(tasks).sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt))).slice(0,50);}
const key=u=>JSON.stringify([u.provider,u.executionId,u.generation]);
const PHASES=new Set(['master','child','review']);
const TRANSITIONS=new Set(['delegation','handoff','retry','decision','failure','completion']);
const model=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)?value:null;
const elapsed=(claimedAt,at)=>{
 if(typeof claimedAt!=='string'||typeof at!=='string')return null;
 const duration=Date.parse(at)-Date.parse(claimedAt);
 return Number.isSafeInteger(duration)&&duration>=0?duration:null;
};
function records(owner,{trustedMetadata=true}={}){
 const raw=Array.isArray(owner?.usageHistory)?owner.usageHistory:(owner?.usage?[owner.usage]:[]);
 return raw.filter(u=>u&&['codex','claude'].includes(u.provider)&&typeof u.executionId==='string'&&u.executionId.length<=200&&Number.isSafeInteger(u.generation)&&u.generation>=1).slice(-100).map(u=>{
  const trusted=trustedMetadata&&u.phaseSource==='server_state';
  return {...usageCounts(u)||{inputTokens:null,outputTokens:null},provider:u.provider,executionId:u.executionId,generation:u.generation,completedAt:String(u.completedAt||'').slice(0,40),source:'executor_report',phase:trusted&&PHASES.has(u.phase)?u.phase:'unknown',transition:trusted&&TRANSITIONS.has(u.transition)?u.transition:'unknown',wallElapsedMs:trusted&&Number.isSafeInteger(u.wallElapsedMs)&&u.wallElapsedMs>=0?u.wallElapsedMs:null,requestedModel:trusted?model(u.requestedModel):null,...(trusted?{phaseSource:'server_state'}:{})};
 });
}
export function usageHistory(owner,value,completedAt,{task,transition}={}){
 const history=records(owner);
 const phase=task?.parentTaskId?'child':task?.delegation?.state==='reviewing'?'review':task?'master':'unknown';
 const record={...(usageCounts(value)||{inputTokens:null,outputTokens:null}),provider:owner.provider,executionId:owner.executionId,generation:owner.generation,completedAt,source:'executor_report',phase,transition:task&&TRANSITIONS.has(transition)?transition:'unknown',wallElapsedMs:task?elapsed(owner.claimedAt,completedAt):null,requestedModel:task?.parentTaskId&&task.assignment?.provider===owner.provider?model(task.assignment.requestedModel):null,...(task?{phaseSource:'server_state'}:{})};
 if(!['codex','claude'].includes(record.provider)||!record.executionId)return history;
 if(!history.some(u=>key(u)===key(record)))history.push(record);
 return history.slice(-100);
}
export function observedExecutions(tasks){const seen=new Set(),result=[];for(const task of tasks||[])for(const u of records(task.checkpoint)){const id=key(u);if(seen.has(id))continue;seen.add(id);result.push({...u,taskId:task.id,title:task.title});}return result;}
export function usageSummary(tasks){const summary={};for(const provider of ['codex','claude']){const rows=observedExecutions(tasks).filter(u=>u.provider===provider),inputs=rows.filter(u=>u.inputTokens!==null),outputs=rows.filter(u=>u.outputTokens!==null),cached=rows.filter(u=>u.cachedInputTokens!==undefined);const sum=(rows,k)=>{const n=rows.reduce((a,u)=>a+u[k],0);return rows.length&&Number.isSafeInteger(n)?n:null;};summary[provider]={executions:rows.length,inputTokens:sum(inputs,'inputTokens'),outputTokens:sum(outputs,'outputTokens'),cachedInputTokens:sum(cached,'cachedInputTokens'),missingCachedInput:rows.length-cached.length,missingInput:rows.length-inputs.length,missingOutput:rows.length-outputs.length};}return summary;}

export function sanitizeUsageHistory(value){return records({usageHistory:value},{trustedMetadata:false});}
