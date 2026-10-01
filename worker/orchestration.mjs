import {dispatchClaude} from './dispatch.mjs';
import {reviewInputs} from './review-inputs.mjs';
export function createOrchestration({store,delegations,hasRoutine,fire,waitUntil}){
 async function dispatch(taskId){return dispatchClaude({store,taskId,hasRoutine,waitUntil,fire});}
 async function dispatchChildren(result){
  for(const child of result.children??[])if(child.assignment?.provider==='claude'&&child.status==='queued')await dispatch(child.id);
  if(result.parent?.status==='queued_for_review'&&result.parent.checkpoint?.provider==='claude')await dispatch(result.parent.id);
  return result;
 }
 async function reconcileTask(taskId){const task=await store.requireTask(taskId);const parentId=task.parentTaskId??(task.delegation?task.id:null);if(!parentId)return null;const result=await delegations.reconcile(parentId);return dispatchChildren(result);}
 return {
  dispatch,
  allocate:async(taskId,input,options)=>dispatchChildren(await delegations.allocate(taskId,input,options)),
  recoverChild:async(taskId,input)=>dispatchChildren(await delegations.recoverChild(taskId,input)),
  resume:async(taskId,input)=>dispatchChildren(await delegations.resume(taskId,input)),
  retryReview:async(taskId,input,options)=>dispatchChildren(await delegations.retryReview(taskId,input,options)),
  reconcileTask,
  hydrateClaim:async claim=>{
   if(!claim)return null;
   try{return {...claim,reviewInputs:await reviewInputs(store,claim.task)};}
   catch(error){if(claim.task.checkpoint?.deliveryReceiptVersion!==1)await store.failExecution(claim.task.id,{executionId:claim.executionId,generation:claim.generation,error:'Generated review inputs could not be loaded; no model was started.'});throw error;}
  },
  async drain(limit=10){
   if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('Recovery batch limit must be 1 to 20');
   const cursor=String((await store.db.prepare("SELECT value FROM metadata WHERE key='orchestration_cursor'").first())?.value??'');
   const query=after=>store.db.prepare("SELECT q.body FROM tasks q WHERE q.id > ?1 AND (json_extract(q.body,'$.parentTaskId') IS NULL OR EXISTS(SELECT 1 FROM tasks p WHERE p.id=json_extract(q.body,'$.parentTaskId') AND json_extract(p.body,'$.status')='waiting_children' AND json_extract(p.body,'$.delegation.state')='waiting_children' AND json_extract(p.body,'$.delegation.batchId')=json_extract(q.body,'$.batchId') AND json_extract(p.body,'$.delegation.epoch')=json_extract(q.body,'$.parentEpoch'))) AND (json_extract(q.body,'$.status') IN ('waiting_children','queued_for_review') OR (json_extract(q.body,'$.status')='running' AND json_extract(q.body,'$.checkpoint.provider')='claude' AND json_extract(q.body,'$.checkpoint.expiresAt') <= ?3) OR (json_extract(q.body,'$.status')='queued' AND json_extract(q.body,'$.checkpoint.provider')='claude' AND (json_extract(q.body,'$.parentTaskId') IS NOT NULL OR json_extract(q.body,'$.checkpoint.handoff') IS NOT NULL))) ORDER BY q.id LIMIT ?2").bind(after,limit,store.now()).all();
   let rows=(await query(cursor)).results;if(!rows.length&&cursor)rows=(await query('')).results;
   let checked=0,failed=0;
   for(const row of rows){const task=JSON.parse(row.body);try{if(task.status==='running')await store.markExecutionUncertain(task.id,{executionId:task.checkpoint.executionId,generation:task.checkpoint.generation,reason:'lease_expiry'});else if(task.status==='waiting_children')await reconcileTask(task.id);else await dispatch(task.id);checked++;}catch{failed++;}}
   if(rows.length)await store.db.prepare("INSERT INTO metadata(key,value) VALUES('orchestration_cursor',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.parse(rows.at(-1).body).id).run();
   return {checked,failed};
  }
 };
}
