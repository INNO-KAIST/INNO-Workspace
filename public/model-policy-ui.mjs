import {providerHas,providerLabel,providerModels} from './core/providers.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const providerName=value=>providerLabel(value)??(value||'미확인');
const time=value=>{if(value==null)return '확인 불가';const date=new Date(value);return Number.isNaN(+date)?'확인 불가':date.toLocaleString('ko-KR');};
const reasonNames={baseline_version_unverified:'기준 모델의 실제 버전 미확인',policy_capacity_unavailable:'정책 저장 한도로 기준 정책 미등록',baseline_critical_regression:'기준 모델의 중대한 품질 문제로 새 배정·승격 보류',account_model_unavailable:'계정에서 모델 사용 가능 여부 미확인',unobserved_model_version:'후보의 실제 적용 실행 경로 관측 없음',insufficient_current_route_evidence:'현재 사용 중인 경로와의 직접 비교 근거 부족',active_route_not_current:'사용 중 경로의 근거가 만료됐거나 계정 목록에 없어 기준 경로로 배정(배정마다 계정 확인)',profile_mismatch:'작업군 기준이 저장된 정책과 달라 다음 배정 대기',candidate_unavailable:'계정 가용성 확인 필요',candidate_quality_regression:'필수 품질 기준 미충족',insufficient_comparable_evidence:'비교 가능한 검토 근거 부족',missing_measured_efficiency:'실측 토큰 또는 지연 기록 부족',no_measured_efficiency_gain:'실측 효율 개선 미확인',already_active:'이미 사용 중',withdrawn:'후보 철회됨',existing_route_pending_evidence:'기준 경로에서 추가 근거 대기',no_fresh_eligible_route:'현재 사용 가능한 경로 없음',profile_scoped_observation:'이 작업군에서 검증된 관측',policy_missing_evidence_insufficient:'정책의 비교 근거 부족',policy_missing:'정책 미등록',matched_quality_and_measured_efficiency:'필수 품질 기준과 실측 효율 확인',manual_pin_active_route:'현재 정책 고정 중: 후보 승격 보류',manual_pin_selected:'고정된 현재 정책 경로',manual_pin_existing_route_pending_evidence:'고정된 기준 경로: 검토 근거 대기',pinned_route_unavailable:'고정한 경로를 사용할 수 없어 다음 배정 대기',pinned_evidence_expired:'고정한 경로의 검토 근거가 만료되어 다음 배정 대기'};
const routeText=(route,provider)=>!route?'정책 경로가 아직 없습니다.':`${route.status==='selected'?'정책 선택':route.status==='wait'?'다음 배정 대기':'기준 경로'} · ${route.model||'모델 미확인'}${route.effort?' · '+route.effort:''} · ${reasonNames[route.reason]||route.reason||'선택 이유 미제공'}${route.status==='selected'&&route.modelVersion==null&&providerHas(provider,'executionEvidence','cli_arguments')?' · 이 실행 경로의 관측 결과(내부 버전 미확인)':''}`;
const statusName={active:'사용 중',candidate:'후보',testing:'검토 중',withdrawn:'철회'};
const activePinTarget=(policy,route)=>{
 if(!policy?.activeId||!route||route.status==='wait'||route.candidateId!==policy.activeId)return null;
 return policy.candidates?.find(candidate=>candidate.id===policy.activeId&&candidate.status==='active'&&candidate.model===route.model&&candidate.effort===route.effort)||null;
};

export function modelPolicyChoices(availability){
 if(!Array.isArray(availability?.models))return [];
 return availability.models.flatMap(row=>typeof row?.model==='string'&&Array.isArray(row.efforts)?row.efforts.filter(effort=>typeof effort==='string').map(effort=>({model:row.model,effort})):[]);
}
export function modelPolicyOutcome(operation,result){
 const reason=result?.reason;
 if(operation==='promote')return reason==='profile_scoped_evidence'?'이 작업군의 검증 근거로 후보를 앞으로의 배정 정책에 승격했습니다.':`승격 보류 · ${reasonNames[reason]||reason||'근거 부족'}. 다음 배정 정책은 유지됩니다.`;
 if(operation==='withdraw')return reason==='restored_previous'?'사용 중인 후보를 철회하고 검증된 이전 경로로 복구했습니다. 앞으로의 배정부터 적용됩니다.':reason==='safe_fallback_required'?'사용 중인 후보를 철회했습니다. 복구할 이전 경로가 없어 이후 배정은 기준 경로를 계정 목록에서 다시 확인해 사용하며, 확인할 수 없으면 확인을 기다립니다.':'후보를 철회했습니다. 앞으로의 배정에서 제외됩니다.';
 if(operation==='pin')return '현재 정책을 앞으로의 배정에 고정했습니다. 새 후보는 자동 승격되지 않으며 가용성과 품질 확인은 계속 적용됩니다.';
 if(operation==='unpin')return '정책 고정을 해제했습니다. 해제만으로 AI 실행이나 후보 승격이 자동으로 시작되지는 않습니다.';
 return operation==='initialize'?'현재 배정을 기준 정책으로 등록했습니다. 이미 배정된 작업은 바뀌지 않습니다.':'후보를 등록했습니다. 품질과 사용량은 아직 검증되지 않았습니다.';
}

export function createModelPolicyUI({dialog,getContext}){
 const content=dialog.querySelector('[data-policy-content]'),error=dialog.querySelector('[data-policy-error]'),notice=dialog.querySelector('[data-policy-notice]');
 let generation=0,readSequence=0,opened=null,data=null,busy=false,choices=[];
 const current=token=>{
  const context=getContext();
  return dialog.open&&generation===token.generation&&context.client===token.client&&context.activeTaskId===token.activeTaskId&&context.epoch===token.epoch&&context.client?.remote&&context.capabilities?.modelPolicyManagement===true&&context.tasks?.some(task=>task.id===token.childId&&task.parentTaskId&&task.assignment?.selection?.profile);
 };
 const token=()=>opened&&{...opened,generation};
 const setError=message=>{error.textContent=message||'';};
 const setNotice=message=>{notice.textContent=message||'';};
 const render=()=>{
  if(!data)return;
  const assignment=data.assignment||{},policy=data.policy,availability=data.accountAvailability||{},route=data.route;
  const supportedChoices=modelPolicyChoices(availability);
  choices=supportedChoices.filter(choice=>!policy?.candidates?.some(candidate=>candidate.model===choice.model&&candidate.effort===choice.effort));
  const isClaude=providerModels(assignment.provider)?.catalog==='built_in_roles';
  const routeEvidenceNote=providerHas(assignment.provider,'executionEvidence','cli_arguments')
   ?'내부 버전이 확인되지 않은 경로는 이 실행 경로의 관측 결과(실행기가 CLI로 적용한 모델·검토 강도, 동일한 실행 조건, 같은 입력의 독립 검토)로만 비교합니다. 내부 제공 버전이나 다른 작업의 같은 품질을 보장하지 않습니다. 같은 입력의 비교 사례는 정상 작업만으로 거의 생기지 않고 추가 비교 예산이 0이라, 승격 검토를 해도 근거 부족으로 보류될 수 있습니다.'
   :`${providerName(assignment.provider)} 실행은 CLI 적용 실행 경로 근거가 없어 승격 대상이 아닙니다. 정책 등록·고정과 보고된 사용량 확인만 가능합니다.`;
  const accountStatus=availability.status==='fresh'?'최근 계정 목록 확인':availability.status==='static_supported_models_unverified'?'내장 목록 · 계정 사용 가능성 미확인':availability.status==='expired'?'계정 목록 만료':availability.status==='refresh_failed'?'최근 조회 실패':availability.status==='legacy_unverified'?'기존 보고 · 시각 미확인':availability.status||'확인 불가';
  const source=availability.source==='desktop_account_catalog'?'데스크톱 계정 목록':availability.source==='built_in_catalog'?'앱 내장 목록':availability.source||'출처 미확인';
  const pinned=policy?.pin?.candidateId!=null;
  const active=activePinTarget(policy,route);
  const pinnedCandidate=policy?.candidates?.find(candidate=>candidate.id===policy.pin?.candidateId);
  const rows=(policy?.candidates||[]).map(candidate=>`<li class="model-policy-candidate"><span><strong>${escape(candidate.model)}</strong> · ${escape(candidate.effort)} · 실제 버전 ${escape(candidate.modelVersion??'미확인')}<br><small>${escape(statusName[candidate.status]||candidate.status||'상태 미확인')}</small></span><span class="model-policy-actions">${!pinned&&candidate.status!=='active'&&candidate.status!=='withdrawn'&&candidate.id!==policy.baselineId?`<button type="button" class="secondary-button" data-policy-action="promote" data-candidate="${escape(candidate.id)}">승격 검토</button>`:''}${candidate.status!=='withdrawn'&&candidate.id!==policy.baselineId?`<button type="button" class="secondary-button" data-policy-action="withdraw" data-candidate="${escape(candidate.id)}">${candidate.status==='active'?'철회 · 이후 배정 복구':'후보 철회'}</button>`:''}</span></li>`).join('');
  content.innerHTML=`<p class="model-policy-scope">이 정책의 변경은 <strong>앞으로 같은 작업군에 배정되는 작업</strong>에만 적용됩니다. 현재 하위 작업의 배정과 실행은 그대로 유지됩니다.</p><p class="small-copy">${escape(routeEvidenceNote)}</p><section><h3>현재 작업의 고정 배정</h3><p>${escape(providerName(assignment.provider))} · ${escape(assignment.model||'모델 미확인')} · ${escape(assignment.effort||'강도 미확인')} · 실제 모델 버전 ${escape(assignment.selection?.modelVersion??'미확인')}</p><p class="small-copy">배정 이유 · ${escape(reasonNames[assignment.selection?.reason]||assignment.selection?.reason||'기록 없음')} · 정책 버전 ${escape(assignment.selection?.policyVersion??'미확인')}</p></section><section><h3>계정 확인 상태</h3><p>${escape(accountStatus)} · ${escape(source)}</p><p class="small-copy">관측 ${escape(time(availability.observedAt))} · 만료 ${escape(time(availability.expiresAt))}${isClaude?' · 계획의 검토 강도(실제 CLI 적용 미확인)':''}</p></section><section><h3>앞으로의 정책 경로</h3><p>${escape(routeText(route,assignment.provider))}</p>${policy?`<p class="small-copy">정책 버전 ${escape(policy.policyVersion)} · 관측 기록 ${escape(policy.observationCount)}건 / 비교 최소 ${escape(policy.minSamples)}쌍. 건수만으로 품질이 검증되지는 않습니다.</p><ul class="model-policy-list">${rows}</ul>`:'<p class="small-copy">저장된 정책이 없습니다. 현재 배정을 기준으로 초기화할 수 있습니다.</p><button type="button" class="primary-button" data-policy-action="initialize">기준 정책 초기화</button>'}</section>${policy?`<section><h3>후보 등록</h3>${choices.length?`<label for="model-policy-choice">${isClaude?'역할 별칭과 계획의 검토 강도 (계정 사용 가능성 미확인)':'계정 목록의 모델과 검토 강도'}</label><select id="model-policy-choice">${choices.map((choice,index)=>`<option value="${index}">${escape(choice.model)} · ${escape(choice.effort)}</option>`).join('')}</select><button type="button" class="secondary-button" data-policy-action="register_candidate">선택한 후보 등록</button><p class="small-copy">후보 등록은 품질 검증이나 자동 승격을 뜻하지 않습니다.</p>`:`<p class="small-copy">${supportedChoices.length?'계정 목록의 모든 모델·강도 조합이 이미 후보로 등록돼 있습니다.':'등록 가능한 계정 모델 목록이 없습니다. 계정 연결과 관측 시각을 확인하세요.'}</p>`}</section>`:''}`;
  if(policy){
   const pinDetails=pinned?`<p>현재 정책 고정 중 · ${escape(providerName(assignment.provider))} · ${escape(pinnedCandidate?.model??'모델 미확인')} · ${escape(pinnedCandidate?.effort??'강도 미확인')} · 실제 모델 버전 ${escape(pinnedCandidate?.modelVersion??'미확인')}</p><p class="small-copy">${route?.status==='wait'?'고정한 경로의 가용성 또는 검토 근거가 부족해 다음 배정을 기다립니다.':'고정된 정책은 앞으로의 배정에 적용됩니다.'} 철회 가능한 활성 후보를 철회하면 검증된 이전 경로로 복구하며, 없으면 다음 배정을 기다립니다.</p><button type="button" class="secondary-button" data-policy-action="unpin">정책 고정 해제</button>`:active?`<p>현재 활성 정책 · ${escape(providerName(assignment.provider))} · ${escape(active.model)} · ${escape(active.effort)} · 실제 모델 버전 ${escape(active.modelVersion??'미확인')}</p><button type="button" class="secondary-button" data-policy-action="pin">현재 정책 고정</button>`:'<p class="small-copy">현재 활성 정책의 실제 배정 경로를 확인할 수 없어 고정할 수 없습니다.</p>';
   content.innerHTML+=`<section><h3>앞으로의 배정 정책 고정</h3>${pinDetails}<p class="small-copy">고정은 배정 정책의 모델 또는 별칭을 유지합니다. 실제 제공 모델 버전과 동일 품질을 보장하지 않습니다. 가용성·품질 보호와 긴급 철회는 계속 적용됩니다. 고정 해제만으로 AI 실행이나 후보 승격이 자동으로 시작되지 않습니다.</p></section>`;
  }
  const canInitialize=isClaude||availability.status==='fresh'&&supportedChoices.some(choice=>choice.model===assignment.model&&choice.effort===assignment.effort);
  if(!policy&&!canInitialize){
   const initialize=content.querySelector('[data-policy-action="initialize"]');
   if(initialize){const note=document.createElement('p');note.className='small-copy';note.textContent='계정에서 현재 배정 모델을 다시 확인해야 기준 정책을 초기화할 수 있습니다.';initialize.replaceWith(note);}
  }
  content.querySelectorAll('[data-policy-action]').forEach(button=>button.disabled=busy);
 };
 const read=async tokenValue=>{
  if(!current(tokenValue))return;
  const sequence=++readSequence;
  let response;try{response=await tokenValue.client.readModelPolicy(tokenValue.childId);}catch(error){if(current(tokenValue)&&sequence===readSequence)throw error;return;}
  if(!current(tokenValue)||sequence!==readSequence)return;
  data=response;render();
 };
 const close=()=>{generation++;opened=null;data=null;busy=false;if(dialog.open)dialog.close();};
 dialog.addEventListener('close',()=>{if(dialog.open)return;generation++;opened=null;data=null;busy=false;content.replaceChildren();setError('');setNotice('');});
 dialog.addEventListener('click',async event=>{
  const button=event.target.closest('[data-policy-action]');if(!button||busy)return;
  const captured=token();if(!captured||!current(captured))return;
  const operation=button.dataset.policyAction;
  if(operation==='refresh'){busy=true;setError('');setNotice('');try{await read(captured);}catch(e){if(current(captured))setError(e.message||'정책 조회 실패');}finally{if(current(captured)){busy=false;render();}}return;}
  if(!data)return;
  const expectedStateVersion=data.policy?.stateVersion??0;
  let input={operation,expectedStateVersion};
  if(operation==='register_candidate'){
   const index=Number(content.querySelector('#model-policy-choice')?.value),choice=choices[index];if(!choice)return;
   input.candidate={id:`candidate-${crypto.randomUUID()}`,model:choice.model,effort:choice.effort};
  }else if(operation==='promote'||operation==='withdraw')input.candidateId=button.dataset.candidate;
  else if(operation==='pin'){
   if(data.policy?.pin?.candidateId||!activePinTarget(data.policy,data.route))return;
   input.candidateId=data.policy.activeId;
  }else if(operation==='unpin'){
   if(!data.policy?.pin?.candidateId)return;
  }
  else if(operation!=='initialize')return;
  if(operation==='promote'&&data.policy?.pin?.candidateId)return;
  if(!current(captured))return;
  busy=true;render();setError('');setNotice('');
  try{
   const response=await captured.client.changeModelPolicy(captured.childId,input);
   if(!current(captured))return;
   data=response;render();setNotice(modelPolicyOutcome(operation,response));
  }catch(e){
   if(!current(captured))return;
   if(e.status===409){setError('다른 기기에서 정책이 변경됐습니다. 최신 내용을 다시 확인한 뒤 원하는 작업을 다시 선택하세요.');try{await read(captured);}catch(readError){if(current(captured))setError(`최신 정책 조회 실패 · ${readError.message}`);}}
   else setError(e.message||'정책 변경 실패. 서버 상태를 확인하세요.');
  }finally{if(current(captured)){busy=false;render();}}
 });
 return {
  close,
  async open(childId){
   close();const context=getContext();
   if(!context.client?.remote||context.capabilities?.modelPolicyManagement!==true)return;
   if(!context.tasks?.some(task=>task.id===childId&&task.parentTaskId&&task.assignment?.selection?.profile))return;
   opened={client:context.client,activeTaskId:context.activeTaskId,epoch:context.epoch,childId};
   dialog.showModal();content.textContent='모델 정책을 불러오는 중입니다.';setError('');setNotice('');
   const captured=token();try{await read(captured);}catch(e){if(current(captured)){content.replaceChildren();setError(e.message||'정책 조회 실패. 연결을 확인하세요.');}}
  },
 };
}
