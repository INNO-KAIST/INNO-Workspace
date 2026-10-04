import {validateDelegationSourceIds,SOURCE_DELEGATION_POLICY} from '../public/core/delegation-sources.mjs';
import {spawn} from 'node:child_process';
import {isAssignableProvider,providerModels} from '../public/core/providers.mjs';
import {CLAUDE_ROLE_MODELS} from '../public/core/claude-routing.mjs';
const EFFORTS=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
const DELEGATION_EFFORTS=new Set(['none','minimal','low','medium','high','xhigh','max']);
export function modelCatalogRows(rows){
 return (Array.isArray(rows)?rows:[]).slice(0,100).filter(m=>typeof m?.model==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(m.model)&&!m.hidden).map(m=>({model:m.model,efforts:(m.efforts??m.supportedReasoningEfforts?.map(e=>e.reasoningEffort)??[]).filter(e=>EFFORTS.has(e)),isDefault:m.isDefault===true}));
}
// Read-only app-server catalog; no model execution, credentials, or transcript retained.
export function createModelCatalog({spawnProcess=spawn,env=process.env,cwd=process.cwd(),now=Date.now,ttlMs=3600000,timeoutMs=10000}={}){
 let current={models:[],observedAt:null,status:'unavailable'},lastGood=null,expires=0,inflight;
 function query(){return new Promise(resolve=>{
  let child,pending='',done=false,timer,bytes=0,page=0,rows=[],requested=2,initialized=false;
  const cursors=new Set();
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);child?.kill();resolve(value);};
  try{child=spawnProcess('codex',['app-server','--stdio'],{env,cwd,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch{finish(null);return;}
  const send=value=>{if(done)return;try{child.stdin.write(JSON.stringify(value)+'\n');}catch{finish(null);}};
  child.on('error',()=>finish(null));child.on('close',()=>finish(null));child.stdin.on('error',()=>finish(null));child.stderr.resume();
  timer=setTimeout(()=>finish(null),timeoutMs);
  child.stdout.on('data',chunk=>{
   bytes+=Buffer.byteLength(chunk);if(bytes>256000){finish(null);return;}
   pending+=String(chunk);
   let index;while(!done&&(index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);let event;try{event=JSON.parse(line);}catch{continue;}
    if(event.id===1){if(initialized)continue;if(event.error||!event.result||typeof event.result!=='object'||Array.isArray(event.result)){finish(null);return;}initialized=true;send({method:'initialized'});send({id:requested,method:'model/list',params:{includeHidden:false}});}
    if(event.id===requested){
     const result=event.result;
     if(event.error||!result||!Array.isArray(result.data)||rows.length+result.data.length>100||++page>20){finish(null);return;}
     if(result.data.some(row=>{
      if(!row||typeof row!=='object'||typeof row.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(row.model))return true;
      const efforts=row.efforts??row.supportedReasoningEfforts;
      return !Array.isArray(efforts)||efforts.some(e=>!EFFORTS.has(typeof e==='string'?e:e?.reasoningEffort));
     })){finish(null);return;}
     rows.push(...result.data);
     const cursor=result.nextCursor;
     if(cursor===null||cursor===undefined){
      const models=modelCatalogRows(rows);
      if(new Set(models.map(item=>item.model)).size!==models.length){finish(null);return;}
      finish(models);return;
     }
     if(typeof cursor!=='string'||!cursor||cursors.has(cursor)){finish(null);return;}
     cursors.add(cursor);requested++;send({id:requested,method:'model/list',params:{includeHidden:false,cursor}});
    }
   }
  });
  send({id:1,method:'initialize',params:{clientInfo:{name:'inno_model_catalog',version:'1.0'},capabilities:{experimentalApi:true}}});
 });}
 const snapshot=async()=>{
  if(now()<expires)return current;
  if(!inflight)inflight=query().then(models=>{
   if(models!==null){current={models,observedAt:now(),status:'fresh'};lastGood=current;expires=now()+ttlMs;}
   else{current={models:[],observedAt:lastGood?.observedAt??null,status:'unavailable'};expires=now()+Math.min(ttlMs,60000);}
   return current;
  }).finally(()=>{inflight=null;});
  return inflight;
 };
 const get=async()=> (await snapshot()).models;
 get.snapshot=snapshot;
 return get;
}
export function routingPolicy(rows){
 const models=modelCatalogRows(rows);
 if(!models.length)return 'Model routing: the supported model catalog is unavailable. Do not spawn subagents or guess model names. Work directly with the current master model; report this fallback in routing.';
 return [
  'MASTER-FIRST MODEL ROUTING (subscription only):',
  'BEFORE spawning any subagent, understand the latest request, deliverables, evidence gaps, dependencies and failure costs. Decide whether delegation saves useful work. Respect explicit no-subagent requests. Simple or indivisible tasks stay with the master.',
  'For each delegated part FIRST record a compact assignment: role, model, effort, reason, acceptance check. Use native spawn model and reasoning_effort parameters explicitly; do not rely on inheritance for a cheaper worker. Use a compact self-contained handoff instead of full conversation history (fork_turns="none" when supported). Never launch a paid API or another provider directly. Only an explicitly supplied INNO handoff contract may transfer progress to the other existing subscription.',
  'Available models/efforts (use only these): '+JSON.stringify(models),
  'Keep request interpretation, ambiguous research reasoning, consequential decisions and final integration with the master. A light model is eligible only when scope is narrow, inputs are sufficient, errors have low cost and the master can independently check the result.',
  'When available: luna for bounded extraction/format conversion with exact checks; terra for bounded analysis or implementation with tests; sol for broader implementation; astra/current master for ambiguity, novelty, difficult science and high failure cost. These are capabilities, not a rule that every task must use all tiers. Choose sufficient effort from the catalog; do not automatically choose maximum effort.',
  'At most 2 subagents concurrently, 6 total planned roles. Do not delegate the same work twice. A worker must return its result, evidence/checks and uncertainties, not create its own agent tree.',
  'Validate acceptance checks before incorporating each result. If failed, incomplete or unsupported model: at most one escalation for that part to a stronger available model or handle it with the master; do not loop cheap retries. Quota/authentication failures must be reported, never bypassed by switching accounts or providers. Do not claim unchanged quality or measured token savings without evidence.',
  'Include routing in the final JSON: {"understanding":"brief goal, no source originals","assignments":[{"role":"...","model":"...","effort":"...","reason":"why sufficient","acceptance":"check","outcome":"verified/failed/escalated with evidence"}],"review":"master checks and remaining limits"}. Use an empty assignments list when working directly. This is a self-report; never describe it as independently verified runtime telemetry.'
 ].join('\n');
}
export function assignedCodexModel(assignment,rows){
 const models=modelCatalogRows(rows);
 const requested=typeof assignment?.requestedModel==='string'?assignment.requestedModel:'';
 const model=models.find(item=>item.model===requested);
 if(!model)throw new Error(`Assigned Codex model is not present in the account catalog: ${requested}`);
 if(!model.efforts.includes(assignment?.effort))throw new Error(`Assigned Codex effort is not present in the account catalog for ${requested}: ${assignment?.effort??''}`);
 return {model:model.model,effort:assignment.effort};
}
function boundedAssignmentText(value,label,max){
 if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`Invalid delegation ${label}`);
 return value.trim();
}
export function validateDelegationResult(value,rows,options={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.independent!==true||!Array.isArray(value.children)||value.children.length!==2)throw new Error('Invalid delegation: exactly two independent children are required');
 const children=value.children.map(child=>{
  if(!child||typeof child!=='object'||!isAssignableProvider(child.provider))throw new Error('Invalid delegation provider');
  if(!DELEGATION_EFFORTS.has(child.effort))throw new Error(`Invalid delegation effort: ${child.effort??''}`);
  if(!Array.isArray(child.acceptanceCriteria)||child.acceptanceCriteria.length<1||child.acceptanceCriteria.length>8)throw new Error('Invalid delegation acceptance criteria');
  const sourceIds=validateDelegationSourceIds(child.sourceIds,options);
  const normalized={
   ...(sourceIds.length?{sourceIds}:{}),
   role:boundedAssignmentText(child.role,'role',100),provider:child.provider,
   requestedModel:boundedAssignmentText(child.requestedModel,'requestedModel',100),effort:child.effort,
   sufficientReason:boundedAssignmentText(child.sufficientReason,'sufficientReason',1000),
   acceptanceCriteria:child.acceptanceCriteria.map(item=>boundedAssignmentText(item,'acceptance criterion',1000)),
   instructions:boundedAssignmentText(child.instructions,'instructions',12000),
  };
  if(new Set(normalized.acceptanceCriteria).size!==normalized.acceptanceCriteria.length)throw new Error('Invalid delegation: duplicate acceptance criteria');
  const declared=providerModels(child.provider);
  if(declared.catalog==='account_catalog')assignedCodexModel(normalized,rows);
  if(declared.catalog==='built_in_roles'&&!declared.roles.includes(normalized.requestedModel))throw new Error(`Assigned Claude role model is not supported: ${normalized.requestedModel}`);
  return normalized;
 });
 if(new Set(children.map(child=>child.provider)).size!==2||new Set(children.map(child=>child.role)).size!==2)throw new Error('Invalid delegation: one Codex and one Claude child with distinct roles are required');
 return {independent:true,children};
}
export function delegationRoutingPolicy(rows,{sourceDelegationVersion=0}={}){
 const sourceAware=sourceDelegationVersion===1;
 const models=modelCatalogRows(rows);
 if(!models.length)return 'Managed parallel delegation is unavailable because the Codex account model catalog could not be verified. Work directly with the current master. Do not spawn native subagents, hand off, or guess model names. Return the ordinary result JSON without delegation.';
 return [
  'MANAGED PARALLEL ALLOCATION (existing subscriptions only):',
  'First understand the latest request and decide whether two independent, '+(sourceAware?'source-scoped':'source-free')+' results materially help. Respect explicit no-subagent or direct-work requests. Simple, indivisible, '+(sourceAware?'':'attachment-backed, ')+'or URL-backed requests stay with the master. The task role plan contains static suggestions only; decide their relevance from the actual objective and do not allocate roles merely because they are listed.',
  'Do not spawn native subagents or call another provider. If parallel work is useful, return delegation in the final JSON so INNO Workspace can persist and run it. Delegation must be {"independent":true,"children":[exactly two assignments]} with exactly one codex and one claude assignment. Each assignment must contain role, provider, requestedModel, effort, sufficientReason, acceptanceCriteria (1-8 exact strings), and bounded instructions. The two roles must be distinct and independently executable '+(sourceAware?'using only assigned transient materials and no task dependencies':'without source originals or dependencies')+'.',
  sourceAware?SOURCE_DELEGATION_POLICY:'',
  'Verified Codex account models and efforts: '+JSON.stringify(models),
  'Claude subscription role-model candidates: '+JSON.stringify([...CLAUDE_ROLE_MODELS])+'. Claude child effort is planning intent; the Routine wrapper must report whether it can apply it and must not invent an unsupported per-Agent effort control.',
  'Keep request interpretation and final integration with this master. Do not allocate when wrapper and review overhead outweighs the bounded work. Never use API keys, paid overage, provider switching for quota failures, or claims of measured savings.',
  'Return one JSON object with summary, checkpoint, artifacts, routing, and optional delegation. Omit delegation when direct work is better. Do not return both delegation and handoff.',
 ].join('\n');
}
export function routingReport(value,rows){
 const models=modelCatalogRows(rows),text=v=>typeof v==='string'?v.slice(0,700):'';
 const valid=value&&typeof value==='object'&&!Array.isArray(value);
 return {version:1,source:'executor_self_report',runtimeVerified:false,status:valid?'reported':'not_reported',understanding:text(value?.understanding),review:text(value?.review),assignments:(Array.isArray(value?.assignments)?value.assignments:[]).slice(0,6).map(a=>{const model=models.find(m=>m.model===a?.model);return Object.fromEntries([...['role','model','effort','reason','acceptance','outcome'].map(k=>[k,text(a?.[k])]),['catalogMatch',Boolean(model&&model.efforts.includes(a?.effort))]]);})};
}
export function withRoutingArtifact(artifacts,answer,report,managedDelivery=false){
 const result=artifacts.length?[...artifacts]:[{name:'final.md',mime:'text/markdown',encoding:'utf-8',content:answer}];
 const item={name:'inno-model-routing.json',mime:'application/json',encoding:'utf-8',content:JSON.stringify(report,null,2)};
 if(result.length<10&&result.reduce((sum,a)=>sum+a.content.length,0)+item.content.length<=10000000&&(!managedDelivery||Buffer.byteLength(JSON.stringify([...result,item]))<600000))result.push(item);
 return result;
}
