import {DELEGATION_MIN_CHILDREN,DELEGATION_MAX_CHILDREN} from './core/delegation.mjs';
import {formatDateTime} from './core/time-format.mjs';
const savedId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const positive=value=>Number.isSafeInteger(value)&&value>=1&&value<=1_000_000;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const shortRole=value=>{
 const clean=typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim():'';
 const chars=Array.from(clean||'하위 작업');
 return escape(chars.slice(0,80).join('')+(chars.length>80?'…':''));
};
const reasonLabels={
 recorded:'정책 관측이 기록됐습니다.',critical_regression:'중대한 품질 문제의 관측이 기록됐습니다.',
 profile_scoped_observation:'현재 작업군의 검토 관측이 기록됐습니다.',duplicate_execution:'동일 실행의 기존 관측이 있습니다.',
 saved_profile_missing:'저장된 작업군 정보가 없습니다.',evidence_task_missing:'하위 작업 기록을 찾을 수 없습니다.',
 incomplete_or_self_review:'완료된 독립 검토로 확인할 수 없습니다.',stale_execution_owner:'검토 실행 식별자가 현재 기록과 다릅니다.',
 stale_delegation_batch:'배정 묶음이 현재 기록과 다릅니다.',review_mapping_mismatch:'검토 결과와 하위 작업의 대응을 확인할 수 없습니다.',
 saved_assignment_mismatch:'저장된 하위 배정과 일치하지 않습니다.',saved_profile_mismatch:'저장된 작업군과 일치하지 않습니다.',
 invalid_comparable_input:'비교 가능한 검토 근거가 아닙니다.',unsupported_model_evidence_source:'모델 증거 출처를 확인할 수 없습니다.',
 execution_evidence_mismatch:'실행 근거가 검토 기록과 일치하지 않습니다.',unverified_model_version:'실제 모델 버전이 확인되지 않았습니다.',
 saved_selection_version_mismatch:'저장된 정책 선택 버전과 일치하지 않습니다.',invalid_completion_time:'완료 시각을 확인할 수 없습니다.',
 invalid_evidence_reference:'검토 근거 식별자를 확인할 수 없습니다.',invalid_policy_observation:'정책 관측 근거를 확인할 수 없습니다.',
 critical_regression_evidence_capacity:'중대한 품질 문제의 관측 기록 용량이 부족합니다.',
 policy_conflict:'정책이 처리 중에 변경됐습니다.',storage_error:'관측 저장소 처리에 실패했습니다.',
};
const reason=value=>typeof value==='string'&&Object.hasOwn(reasonLabels,value)?reasonLabels[value]:'원인 미확인';
const nextTime=value=>{
 if(typeof value!=='string'||value.length>64)return '다음 저장 재시도 시각 미확인';
 const time=Date.parse(value);
 return Number.isFinite(time)?`다음 저장 재시도 시각 · ${formatDateTime(time)}`:'다음 저장 재시도 시각 미확인';
};
function trustedRows(task){
 const d=task.delegation,c=task.checkpoint,marker=task.reviewObservation;
 if(typeof c?.executionId!=='string'||!savedId.test(c.executionId)||typeof d?.batchId!=='string'||!savedId.test(d.batchId)||!positive(c?.generation)||!positive(d?.epoch))return null;
 if(!marker||marker.reviewExecutionId!==c.executionId||marker.reviewGeneration!==c.generation||marker.batchId!==d.batchId||marker.epoch!==d.epoch)return null;
 const ids=d.children.map(child=>child?.taskId);
 if(ids.some(id=>typeof id!=='string'||!savedId.test(id))||new Set(ids).size!==ids.length)return null;
 const rows=marker.children;
 if(!Array.isArray(rows)||rows.length!==ids.length||rows.some(row=>!row||typeof row!=='object'||!ids.includes(row.childTaskId))||new Set(rows.map(row=>row.childTaskId)).size!==ids.length)return null;
 return new Map(rows.map(row=>[row.childTaskId,row]));
}
function description(row){
 if(!row||!Number.isSafeInteger(row.attempts)||row.attempts<0||row.attempts>3)return '관측 상태 미확인';
 switch(row.status){
  case 'recorded':return `정책 관측 저장됨 · ${reason(row.reason)}`;
  case 'duplicate':return `기존 정책 관측 기록 확인됨 · ${reason(row.reason)}`;
  case 'pending':return '정책 관측 저장 대기';
  case 'retry':return `정책 관측 저장 재시도 대기 · ${reason(row.reason)} · ${nextTime(row.nextAt)}`;
  case 'failed':return `정책 관측 저장 자동 재시도 종료 · ${reason(row.reason)} 작업 결과는 유지됩니다. AI를 다시 실행하지 않습니다.`;
  case 'policy_missing':return '모델 정책이 없어 관측을 저장하지 못했습니다.';
  case 'not_attributable':return `검토 근거를 현재 배정 정책에 연결할 수 없습니다. ${reason(row.reason)}`;
  default:return '관측 상태 미확인';
 }
}

// Read-only projection of the current completed parent. A stale or malformed
// marker never contributes a saved/duplicate success label.
export function reviewObservationSection(task,{recovery}={}){
 if(!task||task.parentTaskId||task.status!=='completed'||task.delegation?.state!=='completed')return '';
 const assignments=task.delegation.children;
 if(!Array.isArray(assignments)||assignments.length<DELEGATION_MIN_CHILDREN||assignments.length>DELEGATION_MAX_CHILDREN)return '<section class="delegation-child" aria-label="정책 관측 기록"><strong>정책 관측 기록</strong><p class="small-copy">관측 상태 미확인</p></section>';
 const rows=trustedRows(task);
 const action=recovery&&rows&&[...rows.values()].some(row=>row.status==='failed')?`<p class="small-copy">저장된 검토 결과로 관측 기록만 다시 수집합니다. AI를 다시 실행하지 않습니다. 다음 정기 처리에서 저장 상태가 갱신됩니다.</p><button type="button" class="secondary-button" ${recovery.mode==='verify'?'data-review-observation-check':'data-review-observation-retry'}${recovery.disabled?' disabled':''}>${recovery.mode==='verify'?'상태 다시 확인':'관측 기록 다시 수집'}</button>`:'';
 return `<section class="delegation-child" aria-label="정책 관측 기록"><strong>정책 관측 기록</strong><p class="small-copy">작업 결과와 별도인 정책 관측 저장 상태입니다. 저장 여부는 품질 통과나 자동 승격을 뜻하지 않습니다.</p>${assignments.map(assignment=>`<p class="review-observation-row small-copy"><strong>${shortRole(assignment?.role)}</strong> · ${escape(description(rows?.get(assignment?.taskId)))}</p>`).join('')}${action}</section>`;
}

export function createReviewObservationRecovery({getContext,onChange=()=>{},onNotice=()=>{}}){
 let pending=null,uncertain=null;
 const identity=task=>({reviewExecutionId:task.reviewObservation.reviewExecutionId,reviewGeneration:task.reviewObservation.reviewGeneration,batchId:task.reviewObservation.batchId,epoch:task.reviewObservation.epoch});
 const sameIdentity=(a,b)=>a.reviewExecutionId===b.reviewExecutionId&&a.reviewGeneration===b.reviewGeneration&&a.batchId===b.batchId&&a.epoch===b.epoch;
 const snapshot=()=>{
  const context=getContext(),task=context?.task;
  if(context?.capabilities?.reviewObservationRecovery!==true||!context.client?.remote||!task||task.parentTaskId||task.status!=='completed'||task.delegation?.state!=='completed'||!Array.isArray(task.delegation.children)||task.delegation.children.length<DELEGATION_MIN_CHILDREN||task.delegation.children.length>DELEGATION_MAX_CHILDREN||!Number.isSafeInteger(task.version)||task.version<1)return null;
  const rows=trustedRows(task);
  if(!rows||[...rows.values()].some(row=>!['pending','retry','failed','recorded','duplicate','policy_missing','not_attributable'].includes(row.status)||!Number.isSafeInteger(row.attempts)||row.attempts<0||row.attempts>3||row.reason!==undefined&&(typeof row.reason!=='string'||row.reason.length>100)||row.nextAt!=null&&(typeof row.nextAt!=='string'||row.nextAt.length>64||!Number.isFinite(Date.parse(row.nextAt))))||![...rows.values()].some(row=>row.status==='failed'))return null;
  return {client:context.client,id:task.id,epoch:context.epoch,version:task.version,identity:identity(task)};
 };
 const sameSelection=(a,b)=>Boolean(a&&b&&a.client===b.client&&a.id===b.id&&a.epoch===b.epoch&&sameIdentity(a.identity,b.identity));
 const sameTask=token=>{
  const context=getContext();return Boolean(context?.client===token.client&&context?.task?.id===token.id&&context.epoch===token.epoch);
 };
 const selected=token=>{
  const context=getContext(),task=context?.task;
  return Boolean(sameTask(token)&&task.status==='completed'&&task.delegation?.state==='completed'&&Array.isArray(task.delegation.children)&&task.delegation.children.length>=DELEGATION_MIN_CHILDREN&&task.delegation.children.length<=DELEGATION_MAX_CHILDREN&&trustedRows(task)&&sameIdentity(token.identity,identity(task)));
 };
 const control=()=>{
  const now=snapshot();if(!now)return null;
  return {mode:uncertain&&sameSelection(uncertain,now)?'verify':'retry',disabled:Boolean(pending&&sameSelection(pending,now))};
 };
 const retry=async()=>{
  const mode=control();if(!mode||mode.mode!=='retry'||mode.disabled)return;
  const token=snapshot();pending=token;onChange();
  let error;
  try{await token.client.retryReviewObservations(token.id,{operation:'retry_failed',expectedVersion:token.version,...token.identity});}
  catch(problem){error=problem;}
  if(!sameTask(token)){if(pending===token)pending=null;return;}
  try{await token.client.refresh();}
  catch{
   if(sameTask(token)){if(selected(token))uncertain=token;if(pending===token)pending=null;onChange();if(selected(token))onNotice('요청 결과와 최신 저장 상태를 확인하지 못했습니다. 상태 다시 확인으로 기록을 조회하세요.');}
   else if(pending===token)pending=null;
   return;
  }
  if(pending===token)pending=null;
  if(!sameTask(token))return;
  if(uncertain&&sameSelection(uncertain,token))uncertain=null;
  onChange();
  if(selected(token))onNotice(error?.status===409?'최신 상태를 확인했습니다. 관측 기록을 확인한 뒤 필요하면 다시 수집하세요.':error?'최신 저장 상태를 확인했습니다. 실패한 관측이 남아 있으면 새로 요청할 수 있습니다.':'관측 기록 수집을 요청했습니다. 다음 정기 처리에서 저장 상태가 갱신됩니다.');
 };
 const verify=async()=>{
  const mode=control();if(!mode||mode.mode!=='verify'||mode.disabled)return;
  const token=snapshot();pending=token;onChange();
  try{await token.client.refresh();}
  catch{
   if(sameTask(token)){if(pending===token)pending=null;onChange();if(selected(token))onNotice('최신 저장 상태를 확인하지 못했습니다. 연결을 확인한 뒤 다시 확인하세요.');}
   else if(pending===token)pending=null;
   return;
  }
  if(pending===token)pending=null;
  if(!sameTask(token))return;
  if(uncertain&&sameSelection(uncertain,token))uncertain=null;
  onChange();if(selected(token))onNotice('최신 저장 상태를 확인했습니다.');
 };
 return {control,retry,verify};
}
