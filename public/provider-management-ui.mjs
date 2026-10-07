import {PROVIDER_IDS,providerManifest} from './core/providers.mjs';
import {providerAvailable} from './provider-ui.mjs';
import {formatShortDateTime} from './core/time-format.mjs';

// PRV-06: one card per registered provider with what it is, where it runs, whether it is
// connected or needs a sign-in (PRV-02), what it can do and whether it passed the conformance
// suite, plus the on/off switch. Everything comes from the registry and the server state.
const CAPABILITY_TEXT={
 fileArtifacts:{true:'결과 파일 전달'},
 resultCallback:{desktop_bridge:'이 PC 연결기가 결과 전달',mcp_checkpoint:'Routine이 결과를 직접 기록'},
 cancellation:{process_terminate:'중단 시 실행 프로세스 종료',confirmation_required:'중단 시 종료 확인 필요'},
 usageReport:{runtime_reported:'사용량 실측 보고',self_reported_optional:'사용량 자체 보고(선택)'},
 deliveryReceipts:{1:'결과 전달 영수증'},
 executionEvidence:{cli_arguments:'실행 조건 기록'},
 evaluationBudget:{true:'비교 평가 예산 대상'},
};
const AUTH={subscription_cli:'구독 로그인 (이 PC의 CLI)',subscription_cloud_routine:'구독 Routine (클라우드)'};
const MODELS={account_catalog:'계정에서 확인한 모델 목록',built_in_roles:'역할별 기본 모델'};
const NOT_READY={codex_login:'로그인 확인 필요',run_storage:'저장 공간 정리 필요'};

function connectionText(id,manifest,capabilities,desktop){
 const local=manifest.execution.location==='local';
 if(!providerAvailable(id,capabilities))return local?'이 서버에 연결되지 않음':'서버에 Routine 설정 필요';
 if(!local)return 'Routine 설정됨';
 if(desktop?.online)return desktop.notReady?`연결됨 · ${NOT_READY[desktop.notReady]??'준비 안 됨'}`:'연결됨';
 return `오프라인${desktop?.lastSeen?` · 마지막 확인 ${formatShortDateTime(desktop.lastSeen)}`:''}`;
}

export function providerCards({tasks=[],capabilities={},desktop={}}={}){
 const off=capabilities.disabledProviders??[];
 return PROVIDER_IDS.map(id=>{
  const manifest=providerManifest(id),enabled=!off.includes(id);
  // A sign-in failure counts only if this provider has not completed any work since.
  const lastSuccess=Math.max(-Infinity,...tasks.filter(task=>task?.checkpoint?.provider===id&&task.status==='completed').map(task=>Date.parse(task.checkpoint?.completedAt)).filter(Number.isFinite));
  const needsConnection=tasks.filter(task=>task?.checkpoint?.provider===id&&task.status==='waiting_connection'&&task.checkpoint?.failure?.kind==='authentication'&&!(Date.parse(task.checkpoint.failure.occurredAt)<=lastSuccess)).length;
  const status=[enabled?null:'사용 중지',connectionText(id,manifest,capabilities,desktop),needsConnection?`연결 필요 · 인증 실패 작업 ${needsConnection}개`:null].filter(Boolean).join(' · ');
  return {
   id,label:manifest.label,vendor:manifest.vendor,
   location:manifest.execution.location==='local'?'이 PC':'클라우드',
   auth:AUTH[manifest.auth.kind]??manifest.auth.kind,
   models:MODELS[manifest.models.catalog]??manifest.models.catalog,
   conformance:manifest.conformance.status==='passed'?`적합성 시험 통과 (v${manifest.conformance.suiteVersion})`:'적합성 시험 미통과 · 배정 제외',
   capabilities:Object.entries(manifest.capabilities).map(([key,value])=>CAPABILITY_TEXT[key]?.[String(value)]).filter(Boolean),
   enabled,needsConnection,status,usageUrl:manifest.ui.usageUrl,
  };
 });
}

// Renders the cards with DOM nodes only (no HTML strings). onToggle(card) turns it on or off;
// turning off takes a second click on the armed card, which first shows what it means.
export function renderProviderCards(root,cards,{onToggle,busy=false,canToggle=true,armed=null,focusId=null}={}){
 const enabledCount=cards.filter(card=>card.enabled).length;
 // Keep keyboard focus on the same card's switch across a re-render.
 const active=root.ownerDocument?.activeElement,focused=root.contains(active)?active.dataset?.provider:null;
 root.replaceChildren(...cards.map(card=>{
  const article=document.createElement('article');article.className='integration-card provider-card'+(card.enabled?'':' off');
  const heading=document.createElement('h2');heading.textContent=`${card.label} · ${card.location}`;
  const status=document.createElement('p');status.className='provider-status';status.textContent=card.status;
  const facts=document.createElement('p');facts.textContent=`${card.vendor} · ${card.auth} · ${card.models} · ${card.conformance}`;
  const list=document.createElement('ul');list.className='provider-capabilities';
  for(const text of card.capabilities){const item=document.createElement('li');item.textContent=text;list.append(item);}
  const actions=document.createElement('div');actions.className='provider-actions';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='secondary-button';
  const confirming=card.enabled&&armed===card.id;
  toggle.textContent=card.enabled?(confirming?'사용 중지 확인':'사용 중지'):'다시 사용';
  const note=confirming?document.createElement('p'):null;
  if(note){note.className='provider-confirm';note.id=`provider-confirm-${card.id}`;note.setAttribute('aria-live','polite');note.textContent='새 실행만 막습니다. 실행 중인 작업은 끝까지 진행하고, 대기 중인 작업은 다시 켤 때까지 기다립니다. 한 번 더 누르면 사용 중지합니다.';toggle.setAttribute('aria-describedby',note.id);}
  toggle.dataset.provider=card.id;
  toggle.disabled=busy||!canToggle||(card.enabled&&enabledCount<=1);
  // Phones have no hover, so a switch that cannot change says why in visible text.
  const reason=!canToggle?'서버에 연결하면 바꿀 수 있습니다.':card.enabled&&enabledCount<=1?'실행기는 하나 이상 켜져 있어야 합니다.':null;
  const hint=reason?document.createElement('span'):null;if(hint){hint.className='provider-hint';hint.textContent=reason;}
  toggle.onclick=()=>onToggle?.(card);
  const usage=document.createElement('a');usage.href=card.usageUrl;usage.target='_blank';usage.rel='noopener noreferrer';usage.textContent='구독 사용량 ↗';
  actions.append(toggle,usage,...(hint?[hint]:[]));
  article.append(heading,status,facts,list,...(note?[note]:[]),actions);
  return article;
 }));
 const target=focusId??focused;
 if(target)[...root.querySelectorAll('button[data-provider]')].find(button=>button.dataset.provider===target&&!button.disabled)?.focus();
}

// PRV-05: the Claude Routine model panel. The recorded model, the recommendation and its
// reasons, the listed options (only a newer model of the same family is marked 추천) and a
// pending change request, which a Claude Code session confirms and applies to the Routine.
const ROUTINE_STATUS={unknown:'판단 불가',keep:'유지 추천',candidate:'교체 후보 있음'};
export function routineModelView({record,recommendation,request}={}){
 const runs=recommendation?.runs;
 return {
  current:record?`현재 Routine 모델: ${record.label} (${record.model}) · ${formatShortDateTime(record.recordedAt)} 기록`:'현재 Routine 모델: 기록 없음',
  status:ROUTINE_STATUS[recommendation?.status]??'판단 불가',
  reasons:recommendation?.reasons??[],
  runs:runs?`최근 30일 Claude 실행: 완료 ${runs.completed}건 · 끝나지 못함 ${runs.failed}건`:null,
  options:(recommendation?.options??[]).map(option=>({alias:option.alias,recommended:option.recommended,note:option.note,label:`${option.target?`${option.target} (${option.alias})`:option.alias}${option.recommended?' · 추천':''}`})),
  request:request?.status==='pending'?`교체 요청됨: ${request.target??request.alias} — Claude Code 세션이 확인한 뒤 Routine에 반영합니다.`:null,
 };
}

export function renderRoutineModel(root,view,{onRequest,onWithdraw,busy=false}={}){
 const heading=document.createElement('h2');heading.className='section-label';heading.textContent='Claude Routine 모델';
 if(!view){const note=document.createElement('p');note.className='section-note';note.textContent='추천 정보를 불러오지 못했습니다. 연결을 확인한 뒤 다시 열어 주세요.';root.replaceChildren(heading,note);return;}
 const current=document.createElement('p');current.className='routine-current';current.textContent=view.current;
 const status=document.createElement('p');status.className='provider-status';status.textContent=view.status;
 const reasons=document.createElement('ul');reasons.className='provider-capabilities';
 for(const text of [...view.reasons,...(view.runs?[view.runs]:[])]){const item=document.createElement('li');item.textContent=text;reasons.append(item);}
 const options=document.createElement('ul');options.className='routine-options';
 for(const option of view.options){
  const item=document.createElement('li');
  const label=document.createElement('strong');label.textContent=option.label;
  const note=document.createElement('span');note.className='provider-hint';note.textContent=option.note;
  const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent='교체 요청';
  button.disabled=busy||Boolean(view.request);button.onclick=()=>onRequest?.(option);
  item.append(label,note,button);options.append(item);
 }
 const parts=[heading,current,status,reasons,...(view.options.length?[options]:[])];
 if(view.request){
  const pending=document.createElement('p');pending.className='provider-confirm';pending.textContent=view.request;
  const withdraw=document.createElement('button');withdraw.type='button';withdraw.className='text-button';withdraw.textContent='요청 취소';withdraw.disabled=busy;withdraw.onclick=()=>onWithdraw?.();
  parts.push(pending,withdraw);
 }
 const note=document.createElement('p');note.className='section-note';note.textContent='INNO는 Routine 설정을 직접 바꾸지 않습니다. 근거를 보여 주고 요청을 기록하며, 실제 교체는 Claude Code 세션이 확인을 받은 뒤 반영합니다.';
 root.replaceChildren(...parts,note);
}
