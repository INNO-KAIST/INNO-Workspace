import {D1ModelPolicies} from './model-policies.mjs';
import {verifyReviewObservation} from './review-observation.mjs';
import {ConflictError} from '../public/core/tasks.mjs';

const MAX_ATTEMPTS=3;
const due=(row,now)=>['pending','retry'].includes(row.status)&&(!row.nextAt||row.nextAt<=now);
const eligible=task=>task?.status==='completed'&&task.delegation?.state==='completed'&&
 Array.isArray(task.delegation.children)&&task.delegation.children.length===2&&
 task.delegation.children.every(x=>typeof x?.taskId==='string');
const identity=task=>({reviewExecutionId:task.checkpoint?.executionId,reviewGeneration:task.checkpoint?.generation,batchId:task.delegation?.batchId,epoch:task.delegation?.epoch});
const sameIdentity=(a,b)=>!!a&&!!b&&a.reviewExecutionId===b.reviewExecutionId&&a.reviewGeneration===b.reviewGeneration&&a.batchId===b.batchId&&a.epoch===b.epoch;
const initial=(task,now)=>({...identity(task),createdAt:task.checkpoint?.completedAt??now,children:task.delegation.children.map(x=>({childTaskId:x.taskId,...(x.selection?.profile?{status:'pending',attempts:0}:{status:'not_attributable',reason:'saved_profile_missing',attempts:0,nextAt:null})}))});
const terminal=(status,reason)=>({status,reason,attempts:0,nextAt:null});
const errorCode=error=>{
 if(error?.message==='model policy not found')return 'policy_missing';
 if(error?.message==='model policy version conflict')return 'policy_conflict';
 if(/^Invalid model (policy|selection) /.test(error?.message??''))return 'invalid_policy_observation';
 return 'storage_error';
};

// Parent completion is authoritative. The marker is a small projection of its two
// frozen assignments; no source text, client verdict or global queue is persisted.
export function createReviewObservationPipeline(store){
 const policies=new D1ModelPolicies(store.db,{
  now:()=>Date.parse(store.now()),
  verifyObservation:async(ref,state)=>{
   const result=await verifyReviewObservation(store,ref,state);
   if(result.status!=='verified')throw Object.assign(new Error('unattributable review'),{reason:result.reason});
   return result.observation;
  },
 });
 async function ensureMarker(parent){
  if(!eligible(parent)||sameIdentity(parent.reviewObservation,identity(parent)))return parent;
  try{return await store.replaceTask(parent.id,parent.version,current=>({...current,version:current.version+1,updatedAt:store.now(),reviewObservation:initial(current,store.now())}));}
  catch(error){if(error instanceof ConflictError)return store.requireTask(parent.id);throw error;}
 }
 async function mark(parentId,childTaskId,reviewIdentity,expectedRow,outcome){
  for(let attempt=0;attempt<3;attempt++){
   const parent=await store.requireTask(parentId),rows=parent.reviewObservation?.children;
   if(!Array.isArray(rows)||!sameIdentity(parent.reviewObservation,reviewIdentity)||!sameIdentity(identity(parent),reviewIdentity))return;
   const row=rows.find(x=>x.childTaskId===childTaskId);
   if(!row||row.status!==expectedRow.status||row.attempts!==expectedRow.attempts)return;
   try{
    await store.replaceTask(parent.id,parent.version,current=>({
     ...current,version:current.version+1,updatedAt:store.now(),
     reviewObservation:{...current.reviewObservation,children:current.reviewObservation.children.map(x=>x.childTaskId===childTaskId?{...x,...outcome}:x)},
    }));
    return;
   }catch(error){if(!(error instanceof ConflictError)||attempt===2)throw error;}
  }
 }
 async function observe(parent,assignment){
  const profile=assignment.selection.profile;
  let child;
  try{child=await store.requireTask(assignment.taskId);}catch(error){if(error?.statusCode===404)return terminal('not_attributable','evidence_task_missing');throw error;}
  const ref={parentTaskId:parent.id,childTaskId:assignment.taskId,reviewExecutionId:parent.checkpoint?.executionId,reviewGeneration:parent.checkpoint?.generation,childExecutionId:child.checkpoint?.executionId,childGeneration:child.checkpoint?.generation};
  for(let attempt=0;attempt<3;attempt++){
   try{
    const state=await policies.read(profile);
    const checked=await verifyReviewObservation(store,ref,state);
    if(checked.status!=='verified')return terminal('not_attributable',checked.reason);
    const result=await policies.observe({profile,evidenceRef:ref,expectedStateVersion:state.stateVersion});
    return terminal(result.recorded?'recorded':'duplicate',result.reason);
   }catch(error){
    const code=error.reason?'not_attributable':errorCode(error);
    if(code==='policy_conflict'&&attempt<2)continue;
    if(code==='not_attributable')return terminal(code,error.reason);
    if(code==='policy_missing')return terminal(code,'policy_missing');
    if(code==='invalid_policy_observation')return terminal('not_attributable',code);
    throw Object.assign(new Error(code),{code});
   }
  }
 }
 async function process(parentId){
  let parent=await store.requireTask(parentId);
  if(!eligible(parent))return null;
  parent=await ensureMarker(parent);
  const reviewIdentity=identity(parent);
  const now=store.now();
  for(const assignment of parent.delegation.children){
   if(!sameIdentity(parent.reviewObservation,reviewIdentity)||!sameIdentity(identity(parent),reviewIdentity))break;
   const row=parent.reviewObservation?.children?.find(x=>x.childTaskId===assignment.taskId);
   if(!row||!due(row,now))continue;
   let result;
   try{result=assignment.selection?.profile?await observe(parent,assignment):terminal('not_attributable','saved_profile_missing');}
   catch(error){
    const attempts=row.attempts+1;
    result=attempts>=MAX_ATTEMPTS?{status:'failed',reason:error.code??'storage_error',attempts,nextAt:null}:{status:'retry',reason:error.code??'storage_error',attempts,nextAt:new Date(Date.parse(now)+60_000*2**(attempts-1)).toISOString()};
   }
   await mark(parent.id,assignment.taskId,reviewIdentity,row,result);
   parent=await store.requireTask(parent.id);
  }
  return parent.reviewObservation;
 }
 async function drain(limit=10){
  if(!Number.isInteger(limit)||limit<1||limit>10)throw new RangeError('review observation drain limit must be 1 to 10');
  const cursor=String((await store.db.prepare("SELECT value FROM metadata WHERE key='review_observation_cursor'").first())?.value??'');
  const now=store.now();
  const query=after=>store.db.prepare(`SELECT id FROM tasks WHERE id > ?1
   AND json_extract(body,'$.status')='completed' AND json_extract(body,'$.delegation.state')='completed'
   AND ((json_type(body,'$.reviewObservation') IS NULL
     AND (json_type(body,'$.delegation.children[0].selection.profile')='object'
       OR json_type(body,'$.delegation.children[1].selection.profile')='object'))
    OR EXISTS (SELECT 1 FROM json_each(json_extract(body,'$.reviewObservation.children')) AS child
      WHERE json_extract(child.value,'$.status') IN ('pending','retry')
      AND COALESCE(json_extract(child.value,'$.nextAt'),'') <= ?3))
   ORDER BY id LIMIT ?2`).bind(after,limit,now).all();
  let rows=(await query(cursor)).results;if(!rows.length&&cursor)rows=(await query('')).results;
  let checked=0,failed=0;
  for(const row of rows){try{await process(row.id);checked++;}catch{failed++;}}
  if(rows.length)await store.db.prepare("INSERT INTO metadata(key,value) VALUES('review_observation_cursor',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(rows.at(-1).id).run();
  return {checked,failed};
 }
 return {process,drain};
}
