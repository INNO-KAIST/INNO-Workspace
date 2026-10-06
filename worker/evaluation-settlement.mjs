import {D1EvaluationBudgets} from './evaluation-budgets.mjs';
import {verifiedLocalExecution} from '../public/core/local-execution.mjs';

// Settles a bounded execution's reservation from the proof stored with its completion or
// failure (H6). The proof is durable before settlement runs, so settlement is a separate,
// idempotent step: if it is missed it can run again, and without a verified proof the
// reservation stays held (the job stays blocked) instead of guessing.
// A claim clears the stored proof, so a proof always belongs to the task's current owner.
// Only states written by finish or fail are settled (not paused, running or queued).
const SETTLEABLE=['completed','failed','waiting_quota','waiting_connection'];
const settleable=task=>SETTLEABLE.includes(task?.status);

export function storedCompletionVerifier(store){
 return async({jobId,executionId,generation,phase})=>{
  const rows=(await store.db.prepare(`SELECT body FROM tasks WHERE json_extract(body,'$.evaluationBudget.jobId')=?1 AND json_extract(body,'$.checkpoint.executionId')=?2 LIMIT 2`).bind(jobId,executionId).all()).results??[];
  if(rows.length!==1)throw new Error('completion evidence is missing or ambiguous');
  const task=JSON.parse(rows[0].body),proof=verifiedLocalExecution(task.checkpoint?.localExecution);
  if(!settleable(task)||task.checkpoint?.generation!==generation||task.evaluationBudget?.phase!==phase||!proof)throw new Error('completion evidence is not verified');
  return {jobId,executionId,generation,phase,confirmed:true,elapsedMs:proof.elapsedMs};
 };
}

export async function settleBoundedExecution(store,task,{now=()=>Date.now()}={}){
 const binding=task?.evaluationBudget,owner=task?.checkpoint;
 if(!binding||typeof owner?.executionId!=='string'||!Number.isSafeInteger(owner.generation)||!settleable(task))return null;
 if(!verifiedLocalExecution(owner.localExecution))return null;
 const ledger=new D1EvaluationBudgets(store.db,{now,verifyCompletion:storedCompletionVerifier(store)});
 try{
  const state=await ledger.read(binding.jobId);
  return await ledger.settle(binding.jobId,{executionId:owner.executionId,generation:owner.generation,expectedStateVersion:state.stateVersion});
 }catch{return null;}
}

// Retry path for the scheduled handler: only tasks whose own reservation is still held in
// the ledger are selected, oldest first, so settled tasks never crowd out a missed one.
export async function sweepBoundedSettlements(store,{now=()=>Date.now(),limit=10}={}){
 let settled=0;
 try{
  const rows=(await store.db.prepare(`SELECT t.body FROM tasks t JOIN metadata m ON m.key='evaluation_budget:'||json_extract(t.body,'$.evaluationBudget.jobId')
   WHERE json_type(t.body,'$.evaluationBudget')='object'
   AND json_extract(t.body,'$.status') IN (${SETTLEABLE.map(s=>`'${s}'`).join(',')})
   AND json_extract(t.body,'$.checkpoint.localExecution.tree.outcome')='verified'
   AND EXISTS (SELECT 1 FROM json_each(json_extract(m.value,'$.reservations')) r
    WHERE json_extract(r.value,'$.executionId')=json_extract(t.body,'$.checkpoint.executionId') AND json_extract(r.value,'$.status')='reserved')
   ORDER BY t.updated_at ASC LIMIT ?1`).bind(limit).all()).results??[];
  for(const row of rows)if(await settleBoundedExecution(store,JSON.parse(row.body),{now}))settled++;
 }catch{}
 return settled;
}
