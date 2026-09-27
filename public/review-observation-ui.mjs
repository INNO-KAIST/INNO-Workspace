const savedId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const positive=value=>Number.isSafeInteger(value)&&value>=1&&value<=1_000_000;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const shortRole=value=>{
 const clean=typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim():'';
 const chars=Array.from(clean||'하위 작업');
 return escape(chars.slice(0,80).join('')+(chars.length>80?'…':''));
};
const reasonLabels={
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
 return Number.isFinite(time)?`다음 저장 재시도 시각 · ${new Date(time).toLocaleString('ko-KR')}`:'다음 저장 재시도 시각 미확인';
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
export function reviewObservationSection(task){
 if(!task||task.parentTaskId||task.status!=='completed'||task.delegation?.state!=='completed')return '';
 const assignments=task.delegation.children;
 if(!Array.isArray(assignments)||assignments.length!==2)return '<section class="delegation-child" aria-label="정책 관측 기록"><strong>정책 관측 기록</strong><p class="small-copy">관측 상태 미확인</p></section>';
 const rows=trustedRows(task);
 return `<section class="delegation-child" aria-label="정책 관측 기록"><strong>정책 관측 기록</strong><p class="small-copy">작업 결과와 별도인 정책 관측 저장 상태입니다. 저장 여부는 품질 통과나 자동 승격을 뜻하지 않습니다.</p>${assignments.map(assignment=>`<p class="review-observation-row small-copy"><strong>${shortRole(assignment?.role)}</strong> · ${escape(description(rows?.get(assignment?.taskId)))}</p>`).join('')}</section>`;
}
