import {prepareTaskMaterials} from './core/source-materials.mjs';
import {taskNearLimit} from './core/task-size.mjs';
import {formatClock,formatShortDateTime} from './core/time-format.mjs';
import {providerCards,renderProviderCards} from './provider-management-ui.mjs';
import {NO_PROJECT,normalizeProjectFilter,taskInProjectFilter,projectListModel,creationProject,renderProjectList} from './project-ui.mjs';
import {projectForTask} from './core/projects.mjs';
import {artifactCheckSummary,sanitizeArtifactChecks} from './core/artifact-checks.mjs';
import {usageRows,usageSummary} from './core/execution-usage.mjs';
import {formatUsagePhase,formatUsageTransition,formatWallElapsed,formatRequestedModel} from './core/usage-presentation.mjs';
import {experimentPacket} from './core/experiment-links.mjs?v=direct-1';
import {createExperimentLinks} from './experiment-links.mjs?v=direct-1';
import {buildLiteratureReview} from './core/literature-review.mjs';
import {auditLiterature,repairLiteraturePrompt} from './core/literature-quality.mjs';
const literatureAudits=new WeakMap();
import {buildLiteratureWorkflow} from './core/literature-workflow.mjs';
import {createStorageUI} from './run-storage.mjs';
import {failureGuidance} from './core/failures.mjs';
import {executorStatusText,handoffLine,providerAvailable,providerName,providerOptions,queuedText,recoveryConfirmText,usageCardModels,SOURCE_TASK_NEEDS_DESKTOP_PAGE} from './provider-ui.mjs';
import {usesTransport} from './core/providers.mjs';
import {contextDeliveryText,contextHistoryRows} from './core/context-delivery.mjs';
import {createRecordImportUI} from './record-import.mjs';
import {createModelPolicyUI} from './model-policy-ui.mjs';
import {createPluginUI,pluginDeliveryText} from './plugin-ui.mjs';
import {createDeliveryRecoveryUI} from './delivery-recovery-ui.mjs';
import {createModelDiagnosticsUI} from './model-diagnostics-ui.mjs';
import {reviewObservationSection,createReviewObservationRecovery} from './review-observation-ui.mjs';
import {WorkspaceClient,exportBundle,parseBundle,validateEndpoint} from './core/client.mjs';
import {childRecoveryState,delegationPanel,delegationStateLabel,executionRecoveryState,taskControlState,taskDisplayStatus,taskListGroups} from './delegation-ui.mjs?v=parallel-ui-2';
import {AttachmentSession} from './core/attachments.mjs';
import {SourceExecutionCoordinator} from './source-execution.mjs';
import {collectDirectoryFiles,createSourcePickFence,matchesStoredSource,reconcileSourceSelection,sourceExecutionMessage,sourceExecutionRows,sourceReconnectLocked} from './source-execution-ui.mjs';
import {extractConnectedText} from './core/extract.mjs?v=formats-2';
import {applyAttachmentView,canChangeSourceView,coverageDescription,createSourceViewDraftGuard,prepareSourceViewPreview,selectionFromValues,sourceViewKind} from './source-views-ui.mjs?v=source-view-4';
import {INTEGRATIONS,parseRefAtlas,parsePrismReport,searchPapers} from './core/research.mjs';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames={ready:'실행 대기',queued:'실행 대기',claimed:'실행 준비',running:'진행 중',waiting_children:'하위 작업 대기',queued_for_review:'검토 대기',reviewing:'결과 검토 중',paused:'일시정지',waiting_user:'결정 대기',waiting_quota:'한도 대기',waiting_connection:'연결 대기',failed:'실행 실패',cancelled:'취소됨',completed:'완료',pending:'대기',proposed:'제안',done:'완료'};
const typeNames={general:'일반 작업',literature:'문헌 · 아이디어',analysis:'분석 · Figure',writing:'논문 · 문서',presentation:'발표자료',career:'CV · 지원서'};
const names={workspace:'작업실',research:'연구 자료',integrations:'연결 앱',usage:'사용량'};
const session=new AttachmentSession();
const selectedPapers=new Set();
let client,activeId=null,view='workspace',draftAttachments=[],papers=[],prismReports=[],busy=false,refreshing=false,previewUrls=[],lastRendered='',pendingRecovery=null;
let sourceStatus='',sourceTickRunning=false,selectionEpoch=0,pendingFilePick=null,contextHistoryOpen=new Set();
const sourcePickFence=createSourcePickFence(()=>({taskId:activeId,client,epoch:selectionEpoch}));
const sourceCoordinator=new SourceExecutionCoordinator({getClient:()=>client,connected:a=>connected(a),getFile:id=>session.getFile(id),extractText:extractConnectedText,verifyView:async(file,view)=>(await sourceViews()).verifySourceView(file,view)});
const storageUI=createStorageUI(()=>client);
const recordImports=createRecordImportUI({getClient:()=>client,onDone:()=>refresh()});
const state=()=>client?.state||{tasks:[],capabilities:{},usage:[]};
const current=()=>state().tasks.find(t=>t.id===activeId);
const reviewObservationRecovery=createReviewObservationRecovery({getContext:()=>({client,task:current(),epoch:selectionEpoch,capabilities:state().capabilities}),onChange:()=>render(),onNotice:message=>toast(message)});
const pluginUI=createPluginUI({dialog:$('plugin-dialog'),getContext:()=>({client,task:current(),afterChange:()=>{syncStatus();render();}})});
const modelPolicyUI=createModelPolicyUI({dialog:$('model-policy-dialog'),getContext:()=>({client,activeTaskId:activeId,epoch:selectionEpoch,capabilities:state().capabilities,tasks:state().tasks})});
const deliveryRecoveryUI=createDeliveryRecoveryUI({dialog:$('delivery-recovery-dialog'),getClient:()=>client,getState:()=>state(),getTask:()=>current(),getEpoch:()=>selectionEpoch,onChange:()=>refresh()});
const modelDiagnosticsUI=createModelDiagnosticsUI({root:$('model-diagnostics'),getContext:()=>({client,capabilities:state().capabilities})});
const attachments=()=>current()?.attachments||draftAttachments;
const sourceViews=()=>import('./core/source-views.mjs?v=source-view-3');
const bytes=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
const date=v=>formatShortDateTime(v);
const recoveryReasonName=value=>({uncertain_fire:'외부 실행 시작 여부를 확인할 수 없습니다.',lease_expiry:'이전 실행 연결 시간이 만료됐습니다.',parent_pause:'부모 작업 일시정지로 이전 실행 종료 확인이 필요합니다.',connection:'실행 연결이 중단됐습니다.',unknown:'실행 종료 상태를 확인할 수 없습니다.',interrupted:'실행이 중단됐습니다.'})[value]||value||'외부 실행 상태를 확인해야 합니다.';
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),6500);}
async function guarded(fn){if(busy)return;busy=true;try{await fn();}catch(e){toast(e.message||'작업을 처리하지 못했습니다.');if(e.status===409){await refresh();toast('다른 기기에서 변경된 최신 기록을 불러왔습니다. 내용을 확인하고 다시 시도하세요.');}}finally{busy=false;renderControls();}}
function linkSafe(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function openDialog(id){$(id).showModal();}
function closeSidebar(){$('sidebar').classList.remove('open');$('sidebar-scrim').classList.remove('open');}
function setView(next){view=next;for(const key of Object.keys(names))$(`${key}-view`).classList.toggle('hidden',key!==next);$('view-title').textContent=names[next];document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===next));closeSidebar();if(next==='research')renderResearch();if(next==='usage')renderUsage();}
function selectTask(id){modelPolicyUI.close();deliveryRecoveryUI.close();selectionEpoch++;activeId=id;lastRendered='';localStorage.setItem('inno-active-task',id||'');setView('workspace');render();$('conversation-scroll').scrollTop=$('conversation-scroll').scrollHeight;}
function newTask(){modelPolicyUI.close();deliveryRecoveryUI.close();selectionEpoch++;activeId=null;localStorage.removeItem('inno-active-task');draftAttachments=[];lastRendered='';$('prompt').value='';setView('workspace');render();$('prompt').focus();}
function renderList(){
 const query=$('task-search').value.toLowerCase();const filter=projectFilter(),ordered=[...state().tasks].filter(task=>taskInProjectFilter(task,state(),filter)).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));const groups=taskListGroups(ordered,query);renderProjects();
 $('task-count').textContent=taskListGroups(ordered).length;
 $('task-list').innerHTML=groups.length?groups.map(({task,children})=>{const displayStatus=taskDisplayStatus(task);return `<div class="task-group"><button class="task-item ${task.id===activeId?'active':''}" data-task="${esc(task.id)}"><span class="task-item-title">${esc(task.title)}</span><small>${esc(statusNames[displayStatus]||displayStatus)} · ${esc(date(task.updatedAt))}</small></button>${children.length?`<div class="child-task-list" aria-label="${esc(task.title)} 하위 작업">${children.map(child=>`<button class="task-item child-task-item ${child.id===activeId?'active':''}" data-task="${esc(child.id)}"><span class="task-item-title">${esc(child.assignment?.role||child.title||'하위 작업')}</span><small><span class="task-child-provider">${esc(providerName(child.assignment?.provider))}</span> · ${esc(statusNames[child.status]||child.status)}</small></button>`).join('')}</div>`:''}</div>`;}).join(''):'<p class="task-list-empty">기록된 작업이 없습니다.<br>첫 번째 질문을 남겨보세요.</p>';
}
function renderMessages(){
 const t=current();$('welcome').classList.toggle('hidden',!!t);$('task-toolbar').classList.toggle('hidden',!t);
 if(!t){$('messages').innerHTML='';return;}
 const displayStatus=taskDisplayStatus(t);$('task-title').textContent=t.title;{const project=projectForTask(t,state());$('task-type-label').textContent=(typeNames[t.type]||'WORKSPACE')+(project?` · ${project.name}`:'');}$('task-status').textContent=statusNames[displayStatus]||displayStatus;$('task-status').className=`status ${displayStatus}`;
 const key=t.id+':'+t.version;if(lastRendered===key)return;lastRendered=key;
 const wasBottom=$('conversation-scroll').scrollHeight-$('conversation-scroll').scrollTop-$('conversation-scroll').clientHeight<130;
 $('messages').innerHTML=(t.messages||[]).map(m=>`<article class="message ${['user','assistant','system'].includes(m.role)?m.role:'system'}"><div class="message-head"><strong>${m.role==='user'?'YOU':m.role==='assistant'?'INNO · ASSISTANT':'WORKSPACE · 상태 기록'}</strong><span>${esc(date(m.createdAt))}</span></div><div class="message-body">${esc(m.content)}</div></article>`).join('');
 if(t.status==='waiting_user'){
  const d=document.createElement('div');d.className='decision-box';d.innerHTML='<p>진행에 필요한 결정이 있습니다. 아래 대화창에 선택이나 수정 요청을 남기세요.</p>';
  const choices=t.decision?.options||[];
  for(const option of choices){const b=document.createElement('button');b.textContent=typeof option==='string'?option:option.label||option.title||'';if(option.pros||option.cons){const s=document.createElement('small');s.textContent=`장점: ${option.pros||'미제공'} · 단점: ${option.cons||'미제공'}`;b.append(s);}b.onclick=()=>guarded(()=>act('decide',{content:typeof option==='string'?option:option.label||option.title}));d.append(b);}
  $('messages').append(d);
 }
 const sessionUrl=t.sessionUrl||t.checkpoint?.sessionUrl;
 if(sessionUrl&&linkSafe(sessionUrl)){const a=document.createElement('a');a.className='text-button';a.href=linkSafe(sessionUrl);a.target='_blank';a.rel='noopener noreferrer';a.textContent='클라우드 실행 세션 열기 ↗';$('messages').append(a);}
 if(wasBottom)requestAnimationFrame(()=>$('conversation-scroll').scrollTop=$('conversation-scroll').scrollHeight);
}
function connected(a){return a.source==='url'||session.list().some(x=>matchesStoredSource(a,x));}
function renderAttachments(){
 const items=attachments();$('attachment-count').textContent=items.length;
 $('attachment-chips').innerHTML=items.map(a=>`<span class="attachment-chip"><span class="chip-name" data-preview="${esc(a.id)}" tabindex="0" role="button">${connected(a)?'◇':'↻'} ${esc(a.name)}${a.view?' · 부분 조회':''}</span><button type="button" data-remove="${esc(a.id)}" aria-label="${esc(a.name)} 연결 해제">×</button></span>`).join('');
 $('attachment-detail').innerHTML=items.length?items.map(a=>`<div class="file-row"><span class="file-icon">${a.source==='url'?'↗':'▤'}</span><div><button data-preview="${esc(a.id)}">${esc(a.path||a.name)}</button><small class="${connected(a)?'':'unavailable'}">${a.source==='url'?'링크 참조':`${bytes(a.size)} · ${connected(a)?'연결됨':'다시 연결 필요'}${a.view?' · 부분 조회 저장됨':''}`}</small></div></div>`).join(''):'<p class="small-copy">파일이나 폴더를 연결해 시작하세요.</p>';
}
function renderSourceExecution(){
 const rows=sourceExecutionRows(current(),state(),connected,sourceCoordinator.entries()),section=$('source-execution-section');
 section.classList.toggle('hidden',!rows.length&&!sourceStatus);
 $('source-execution-list').innerHTML=rows.map(row=>`<article class="source-execution-card"><div class="source-execution-head"><strong>${esc(row.role)}</strong><span class="status">${esc(statusNames[row.status]||row.status)}</span></div><p class="small-copy">${esc(providerName(row.provider))} · 요청 모델 ${esc(row.model)}</p><p class="small-copy">필요 원본: ${row.attachments.filter(a=>a.source!=='url').map(a=>esc(a.path||a.name)).join(' · ')}</p><p class="source-execution-warning">${esc(sourceExecutionMessage(row))}</p>${row.missing.length?`<p class="small-copy">누락: ${row.missing.map(a=>esc(a.path||a.name)).join(' · ')}</p><button type="button" class="secondary-button" data-source-pick-file>같은 파일 다시 연결</button><button type="button" class="text-button" data-source-pick-folder>폴더에서 다시 연결</button>`:''}${row.recoverable?`<button type="button" class="secondary-button" data-source-recover="${esc(row.taskId)}">복구된 작업 다시 확인</button>`:''}</article>`).join('');
 $('source-execution-global').textContent=sourceStatus;
}
function renderDelegation(){
 const panel=delegationPanel(current(),state().tasks),section=$('delegation-section');
 section.classList.toggle('hidden',!panel);if(!panel){$('delegation-list').replaceChildren();$('delegation-resume').hidden=true;return;}
 $('delegation-state').textContent=delegationStateLabel(panel.state);
 $('delegation-list').innerHTML=panel.children.map(child=>{const sessionUrl=linkSafe(child.recovery.sessionUrl);return `<article class="delegation-child"><div class="delegation-child-head"><strong>${esc(child.role)}</strong><span class="status ${esc(child.status)}">${esc(statusNames[child.status]||child.status)}</span></div><div class="delegation-assignment"><span>${esc(providerName(child.provider))}</span><span>요청 모델 · ${esc(child.requestedModel||'미기재')}</span>${child.effort?`<span>추론 강도 · ${esc(child.effort)}</span>`:''}</div>${child.sufficientReason?`<p class="delegation-reason">배정 이유 · ${esc(child.sufficientReason)}</p>`:''}${child.acceptanceCriteria.length?`<ul class="delegation-criteria" aria-label="검증 기준">${child.acceptanceCriteria.map(criterion=>`<li>${esc(criterion)}</li>`).join('')}</ul>`:''}${child.recovery.requiresConfirmation?`<p class="delegation-warning">확인 필요 · ${esc(recoveryReasonName(child.recovery.reason))} 기존 실행이 종료되기 전에 복구하면 중복 실행될 수 있습니다.</p>`:child.confirmationReason?`<p class="delegation-warning">확인 필요 · ${esc(recoveryReasonName(child.confirmationReason))} 자동으로 다시 실행하지 않습니다.</p>`:''}${child.summary?`<p class="delegation-summary">검토 기록 · ${esc(child.summary)}</p>`:''}${child.artifacts.length?`<div class="delegation-artifacts">결과물 · ${child.artifacts.map(artifact=>esc(artifact.name||artifact.id||'이름 미기재')).join(' · ')}</div>`:''}<div class="delegation-card-actions">${sessionUrl?`<a class="text-button" href="${esc(sessionUrl)}" target="_blank" rel="noopener noreferrer">이전 실행 세션 확인 ↗</a>`:''}<button class="delegation-open text-button" type="button" data-task="${esc(child.taskId)}">작업 기록 보기 ↗</button>${child.recovery.eligible&&client?.remote?`<button class="secondary-button delegation-recover" type="button" data-recover-child="${esc(child.taskId)}">${child.recovery.requiresConfirmation?'종료 확인 후 복구':'이 작업 다시 실행'}</button>`:''}</div></article>`;}).join('');
 $('delegation-list').insertAdjacentHTML('beforeend',reviewObservationSection(current(),{recovery:reviewObservationRecovery.control()}));
 if(client?.remote&&state().capabilities?.modelPolicyManagement===true){
  for(const card of $('delegation-list').querySelectorAll('.delegation-child')){
   const childId=card.querySelector('.delegation-open')?.dataset.task;
   if(!state().tasks.some(task=>task.id===childId&&task.assignment?.selection?.profile))continue;
   const button=document.createElement('button');button.type='button';button.className='secondary-button';button.dataset.modelPolicy=childId;button.textContent='다음 배정 모델 정책';card.querySelector('.delegation-card-actions')?.append(button);
  }
 }
 const waitingUnavailable=panel.children.filter(child=>child.status==='waiting_quota'||child.status==='waiting_connection');
 const failed=panel.children.filter(child=>child.status==='failed');
 $('delegation-note').textContent=waitingUnavailable.length?'구독 한도 또는 연결이 준비될 때까지 대기합니다. 자동으로 다시 실행하지 않습니다.':failed.length&&panel.retryCount>=1?'이 배정 묶음의 추가 재시도 1회를 사용했습니다. 결과와 오류를 확인해 주세요.':'';
 const controls=taskControlState(current(),state().tasks,busy),resume=$('delegation-resume');resume.hidden=!controls.resumeVisible;resume.disabled=controls.resumeDisabled;resume.textContent=controls.resumeLabel;
}
function renderPlan(){
 const t=current(),plan=t?.plan||[];
 $('agent-plan').innerHTML=plan.length?plan.map((p,i)=>`<div class="agent-item ${p.status==='running'?'running':''}"><span class="agent-number">${p.status==='completed'||p.status==='done'?'✓':String(i+1).padStart(2,'0')}</span><div><strong>${esc(p.label||p.role)}</strong><small>${esc(statusNames[p.status]||'제안')} ${p.role&&p.label&&p.role!==p.label?`· ${esc(p.role)}`:''}</small></div></div>`).join(''):'<div class="panel-empty"><div class="empty-orbit">◇</div><p>요청에 맞는 역할을<br>필요한 만큼 구성합니다.</p></div>';
 const checkpoint=typeof t?.checkpoint==='string'?t.checkpoint:t?.checkpoint?.content;
 $('checkpoint-card').innerHTML=checkpoint?`<span>↻</span><div><strong>저장된 재개 지점</strong><p>${esc(checkpoint)}</p></div>`:'<span>↻</span><div><strong>맥락은 계속 이어집니다</strong><p>작업 기록과 결정 사항을 저장합니다.<br>원본은 필요할 때 다시 연결하세요.</p></div>';
 const handoffs=t?.checkpoint?.handoffHistory||[];if(handoffs.length){const box=document.createElement('div');box.className='small-copy';const heading=document.createElement('strong');heading.textContent='제공자 인계 기록 ('+handoffs.length+'/2)';box.append(heading);for(const h of handoffs){const line=document.createElement('p');line.textContent=handoffLine(h);box.append(line);}if(t.status==='queued'){const pending=document.createElement('p');pending.textContent=queuedText(t.checkpoint.provider,state().capabilities);box.append(pending);}$('checkpoint-card').lastElementChild.append(box);}
 const delivery=contextDeliveryText(t?.checkpoint?.contextDelivery);if(delivery){const line=document.createElement('p');line.className='small-copy';line.textContent=delivery;$('checkpoint-card').lastElementChild.append(line);}
 const historyRows=contextHistoryRows(t);if(historyRows.length>1){const box=document.createElement('details');box.className='small-copy';box.open=contextHistoryOpen.has(t.id);box.addEventListener('toggle',()=>{if(box.open)contextHistoryOpen.add(t.id);else contextHistoryOpen.delete(t.id);});const summary=document.createElement('summary');summary.textContent=`실행별 문맥 전달 (최근 ${historyRows.length}회, 이 작업 안에서만 비교)`;box.append(summary);for(const row of historyRows){const line=document.createElement('p');line.textContent=row;box.append(line);}$('checkpoint-card').lastElementChild.append(box);}
 const pluginLine=pluginDeliveryText(t?.checkpoint?.pluginDelivery);if(pluginLine){const line=document.createElement('p');line.className='small-copy';line.textContent=pluginLine;$('checkpoint-card').lastElementChild.append(line);}
 const recovery=failureGuidance(t);if(recovery){$('checkpoint-card').lastElementChild.insertAdjacentHTML('beforeend',`<div role="status"><strong>${esc(recovery.title)}</strong><p>${esc(recovery.detail)}${recovery.retryNotBefore?' 서버 재시도 안내: '+esc(date(recovery.retryNotBefore))+' (구독 한도 초기화 시각은 아닙니다).':''} 자동 재실행은 하지 않습니다. 원본이 필요하면 다시 연결하세요.</p></div>`);}
 const quality=t?(literatureAudits.has(t)?literatureAudits.get(t):auditLiterature(t)):null;if(t)literatureAudits.set(t,quality);let qualityPanel=$('literature-quality');if(!qualityPanel){qualityPanel=document.createElement('div');qualityPanel.id='literature-quality';$('artifacts').before(qualityPanel);}qualityPanel.replaceChildren();if(quality){const heading=document.createElement('strong');heading.textContent=quality.status==='passed'?'문헌 결과 형식 점검 통과':'문헌 결과 확인 필요';qualityPanel.append(heading);const detail=document.createElement('p');detail.className='small-copy';detail.textContent='실행 완료와 별도인 형식 점검입니다. 주장·수치의 정확성과 독립 검토 여부는 검증하지 않습니다.';qualityPanel.append(detail);const reviewButton=document.createElement('button');reviewButton.className='text-button';reviewButton.textContent='별도 검토 작업 준비';reviewButton.onclick=()=>guarded(prepareSeparateReview);qualityPanel.append(reviewButton);for(const issue of quality.issues){const item=document.createElement('p');item.className='small-copy';item.textContent=issue;qualityPanel.append(item);}if(quality.issues.length){const button=document.createElement('button');button.className='text-button';button.textContent='수정 요청 준비';button.onclick=()=>{if($('prompt').value.trim()){toast('작성 중인 요청을 먼저 기록하거나 비워 주세요.');return;}$('prompt').value=repairLiteraturePrompt(quality);$('prompt').focus();toast('수정 요청을 준비했습니다. 자료 연결을 확인하고 작업 기록 후 실행하세요.');};qualityPanel.append(button);}}
 const artifacts=t?.artifacts||[];$('artifact-count').textContent=artifacts.length;
 $('artifacts').innerHTML=artifacts.length?artifacts.map(a=>`<div class="artifact-row" role="button" tabindex="0" data-artifact="${esc(a.id)}"><span>▤</span><div><strong>${esc(a.name)}</strong><small>${esc(a.mime||'text/plain')}</small><small>${esc(artifactCheckSummary(a))}</small></div><span>↓</span></div>${artifactCheckDetails(a)}`).join(''):'<p class="small-copy">생성된 결과물이 여기에 모입니다.</p>';
 renderDelegation();
}
function renderControls(){
 for(const option of providerOptions(state().capabilities)){const element=[...$('provider').options].find(item=>item.value===option.value);if(element){element.textContent=option.label;element.disabled=!!option.disabled;}}
 renderProviderManagement();
 $('storage-button').hidden=!state().capabilities?.runStorage;
 $('local-records-button').hidden=!state().capabilities?.localRecordImport;
 const t=current(),c=state().capabilities||{},provider=$('provider').value,controls=taskControlState(t,state().tasks,busy);
 const running=t?.status==='running'||t?.status==='claimed'||t?.status==='queued';const terminal=t?.status==='cancelled'||t?.status==='completed',child=Boolean(t?.parentTaskId),delegated=Boolean(t?.delegation)&&!['superseded','cancelled'].includes(t.delegation.state),confirmationRequired=Boolean(t?.checkpoint?.confirmationRequired),executionRecovery=executionRecoveryState(t);
 $('run-button').disabled=controls.runDisabled;
 const delegatedRunLabel=t?.status==='waiting_children'?'하위 작업 진행 중':t?.status==='queued_for_review'?'결과 검토 대기':t?.status==='running'?'결과 검토 중':t?.status==='paused'?'아래에서 재개':'병렬 작업 관리';
 $('run-button').innerHTML=`${child?'부모 작업에서 실행':delegated?delegatedRunLabel:confirmationRequired?'확인 후 조치 필요':t?.status==='queued'?'데스크톱 실행 대기':running?'실행 중':t?.status==='paused'?'이어서 실행':'작업 실행'} <span>↗</span>`;
 $('provider').disabled=busy||child||delegated;
 $('executor-status').textContent=child?'하위 작업의 실행 조건과 재개는 부모 작업에서 관리합니다.':client?.remote&&!state().capabilities?.desktopSources&&t?.attachments?.length&&!t.parentTaskId&&usesTransport(provider,'desktop_bridge')&&['ready','paused','failed','completed','waiting_user','waiting_quota','waiting_connection'].includes(t.status)?SOURCE_TASK_NEEDS_DESKTOP_PAGE:taskNearLimit(t)?'이 작업의 저장 기록이 상한(약 1MB)에 도달해 새 메시지와 실행을 받을 수 없습니다. 기존 기록은 그대로 있으니, 새 작업을 만들어 이어 가세요.':delegated?'요청 모델과 배정 상태는 아래 병렬 위임 기록에서 확인하세요.':confirmationRequired?'외부 호출 여부를 확인할 수 없어 자동으로 다시 실행하지 않습니다. 작업 기록을 확인해 주세요.':client?.remote?executorStatusText(provider,c,{desktopOnline:!!state().desktop?.online,desktopNotReady:state().desktop?.notReady}):'실행기를 연결하세요. 현재는 작업을 기록할 수 있습니다.';
 $('pause-button').disabled=!t||busy||terminal||child||t.status==='paused';$('cancel-button').disabled=!t||busy||terminal||child;
 $('edit-plan').disabled=controls.editPlanDisabled;
 $('prompt').placeholder=t?t.status==='waiting_user'?'선택 또는 수정 요청을 남겨주세요.':child?'하위 작업은 부모 작업에서 지시를 관리합니다.':delegated?'새 지시를 남기면 현재 배정 세대를 다시 계획합니다.':'추가 요청이나 방향을 남겨주세요.':'어떤 작업을 함께할까요?';
 $('composer').querySelector('[type=submit]').disabled=controls.composerDisabled;
 const resume=$('delegation-resume');if(resume){resume.hidden=!controls.resumeVisible;resume.disabled=controls.resumeDisabled;resume.textContent=controls.resumeLabel;}
 const recover=$('execution-recover');recover.hidden=!executionRecovery.eligible;recover.disabled=busy;
 const pluginButton=$('plugin-open');pluginButton.hidden=!(client?.remote&&c.pluginRegistry===true);pluginButton.disabled=busy;
 const policyButton=$('model-policy-open');policyButton.hidden=!(client?.remote&&c.modelPolicyManagement===true&&child&&t.assignment?.selection?.profile);policyButton.disabled=busy;
 const deliveryButton=$('delivery-recovery-open');deliveryButton.hidden=!(client?.remote&&c.desktopDeliveryRecovery===true&&t);deliveryButton.disabled=busy;deliveryRecoveryUI.sync();
}
function syncStatus(error=client?.syncError){const s=$('sync-status');s.className='sync-badge';if(error){s.textContent='연결 오류 · 최신 상태 확인 필요';s.classList.add('error');return;}if(client?.remote){s.textContent=`동기화 ${client.lastSync?formatClock(client.lastSync):''}`;s.classList.add('connected');$('connection-label').textContent=state().capabilities?.desktopSources?'클라우드 + 이 PC 자료':'서버 연결됨';}else{s.textContent='이 기기 보관';$('connection-label').textContent='이 기기 보관';}}
function sourceResultText(result){return ({storage_error:'원본 실행 기록 저장소를 사용할 수 없습니다. 브라우저 저장 공간과 탭 잠금을 확인하세요.',capacity:'원본 실행 보류 기록이 가득 찼습니다. 완료된 작업의 서버 상태를 확인하세요.',uncertain:'실행 시작 응답을 확인하지 못했습니다. 서버 실행 종료 확인 후 복구하세요.',source_error:'원본 읽기 또는 선택 범위 확인에 실패했습니다. 같은 원본을 다시 연결하세요.',sync_error:'최신 서버 상태를 확인하지 못해 원본 전달을 보류합니다.'})[result?.status]||'';}
async function tickSource(){if(sourceTickRunning||!client?.remote||state().capabilities?.sourceDelegationVersion!==1||busy)return;sourceTickRunning=true;try{const result=await sourceCoordinator.tick();sourceStatus=sourceResultText(result);renderSourceExecution();}catch{sourceStatus='원본 실행 상태를 확인하지 못했습니다. 다음 동기화에서 다시 확인합니다.';renderSourceExecution();}finally{sourceTickRunning=false;}}
// CR-008: projects in the sidebar, the composer's project, the task menu and the project dialog.
let activeProject=(()=>{try{return localStorage.getItem('inno-active-project')||null;}catch{return null;}})(),projectsRendered='',editingProject=null,projectDeleteArmed=false;
const projectFilter=()=>normalizeProjectFilter(activeProject,state());
function selectProject(key){activeProject=key;try{key?localStorage.setItem('inno-active-project',key):localStorage.removeItem('inno-active-project');}catch{}projectsRendered='';renderList();renderComposerProject();}
function renderProjects(){
 const enabled=!!state().capabilities?.projects;$('project-section').classList.toggle('hidden',!enabled);$('project-list').classList.toggle('hidden',!enabled);if(!enabled)return;
 const rows=projectListModel(state(),projectFilter()),key=JSON.stringify(rows.map(row=>[row.key,row.label,row.count,row.active,row.project?.version]));if(key===projectsRendered)return;projectsRendered=key;
 renderProjectList($('project-list'),rows,{onSelect:selectProject,onEdit:project=>openProjectDialog((state().projects??[]).find(item=>item.id===project.id)??project)});
}
function renderComposerProject(){
 const project=state().capabilities?.projects&&!current()?creationProject(state(),projectFilter()):null,chip=$('composer-project');
 chip.classList.toggle('hidden',!project);chip.textContent=project?`프로젝트 '${project.name}'에 만듭니다${project.instructions.trim()?' · 공통 지침 적용':''} · `:'';
}
function openProjectDialog(project){
 if(!client?.remote){toast('서버에 연결하면 프로젝트를 쓸 수 있습니다.');return;}
 editingProject=project;projectDeleteArmed=false;
 $('project-dialog-title').textContent=project?'프로젝트 설정':'새 프로젝트';$('project-name').value=project?.name??'';$('project-instructions').value=project?.instructions??'';
 $('project-delete').hidden=!project;$('project-delete').textContent='프로젝트 삭제';$('project-delete-note').classList.add('hidden');$('project-error').textContent='';
 $('project-dialog').showModal();
}
async function projectRequest(path,body){try{return await client.request(path,body);}catch(error){$('project-error').textContent=error.status===409?'다른 곳에서 바뀌었습니다. 닫았다가 다시 열어 주세요.':error.message;return null;}}
function openTaskMenu(){
 const t=current();if(!t)return;const child=!!t.parentTaskId,projects=state().projects??[];
 $('task-menu-note').textContent=child?'하위 작업은 부모 작업을 따릅니다. 이름과 프로젝트는 부모 작업에서 바꾸세요.':'';
 $('task-rename-input').value=t.title;$('task-rename-input').disabled=child;$('task-rename-save').disabled=child;
 $('task-move-row').classList.toggle('hidden',!state().capabilities?.projects);
 const select=$('task-move-select');select.replaceChildren(new Option('프로젝트 없음',''),...projects.map(project=>new Option(project.name,project.id)));
 select.value=projects.some(project=>project.id===t.projectId)?t.projectId:'';select.disabled=child;$('task-move-save').disabled=child;
 $('task-menu-dialog').showModal();
}
function render(){renderList();renderMessages();renderAttachments();renderSourceExecution();renderPlan();renderControls();renderComposerProject();if(view==='usage')renderUsage();}
// PRV-06: provider cards with the on/off switch, on the 연결 앱 page.
// An armed "turn off" lapses after 20 s, so a later single click never turns a provider off.
let providerArmed=null,providerRendered='',providerFocus=null;
const armedProvider=()=>providerArmed&&Date.now()-providerArmed.at<20_000?providerArmed.id:null;
function renderProviderManagement(){
 const root=$('provider-grid');if(!root)return;
 const capabilities=state().capabilities||{},cards=providerCards({tasks:state().tasks,capabilities,desktop:state().desktop});
 const canToggle=!!client?.remote&&Number.isSafeInteger(capabilities.providerSettingsVersion);
 // The 5-second refresh calls this; replace the buttons only when something shown changed.
 const key=JSON.stringify([cards,armedProvider(),busy,canToggle]);if(key===providerRendered)return;providerRendered=key;
 // The switch that was just used gets focus back once the request finishes (it is disabled meanwhile).
 const focusId=busy?null:providerFocus;if(!busy)providerFocus=null;
 renderProviderCards(root,cards,{busy,armed:armedProvider(),canToggle,focusId,onToggle:card=>guarded(async()=>{
  const latest=state().capabilities||{},off=latest.disabledProviders??[],disabled=card.enabled?[...off,card.id]:off.filter(id=>id!==card.id);
  // Turning off takes a second click after the card explains what it means.
  if(card.enabled&&armedProvider()!==card.id){providerArmed={id:card.id,at:Date.now()};return;}
  providerArmed=null;providerFocus=card.id;
  await client.request('/api/providers/settings',{disabled,expectedVersion:latest.providerSettingsVersion});
  await refresh();toast(card.enabled?`${card.label} 실행기를 사용 중지했습니다.`:`${card.label} 실행기를 다시 사용합니다.`);
 })});
}
async function refresh(){if(refreshing||!client)return;refreshing=true;const viewKey=()=>JSON.stringify([state().revision,state().capabilities,state().desktop?.online,state().desktop?.notReady,state().localDesktop]);const before=viewKey();try{await client.refresh();syncStatus();if(before!==viewKey())render();else {renderControls();renderSourceExecution();}if(!busy)void tickSource();}catch(e){syncStatus(e);}finally{refreshing=false;}}
async function act(action,extra={}){const t=current();if(!t)return;await client.action(t.id,{action,expectedVersion:t.version,...extra});syncStatus();render();}
async function resumeDelegation(){const t=current();if(!t?.delegation)return;await client.resumeDelegation(t.id,t.version);await refresh();toast(t.delegation.state==='reviewing'?'결과 검토를 다시 실행하도록 요청했습니다.':t.status==='paused'?'완료된 하위 결과를 유지하고 작업을 재개했습니다.':'실패한 하위 작업만 다시 실행하도록 요청했습니다.');}
function showRecoveryDialog(recovery){
 pendingRecovery=recovery;$('recovery-summary').textContent=recovery.summary;
 const sessionUrl=linkSafe(recovery.sessionUrl),sessionLink=$('recovery-session');sessionLink.hidden=!sessionUrl;if(sessionUrl)sessionLink.href=sessionUrl;else sessionLink.removeAttribute('href');
 $('recovery-warning').hidden=false;$('recovery-warning').textContent=`${recoveryReasonName(recovery.reason)} 이전 실행이 끝나기 전에 복구하면 같은 작업이 중복 실행될 수 있습니다.`;
 $('recovery-confirm-text').textContent=recoveryConfirmText(recovery.provider);
 $('recovery-confirm-label').hidden=false;$('recovery-confirm').checked=false;$('recovery-confirm').required=true;$('recovery-submit').disabled=true;openDialog('recovery-dialog');
}
async function performRecovery(recovery,confirmedStopped){
 if(recovery.mode==='child')await client.recoverDelegationChild(recovery.parentId,{expectedVersion:recovery.expectedVersion,childTaskId:recovery.childTaskId,expectedChildVersion:recovery.expectedChildVersion,confirmedStopped});
 else await client.recoverExecution(recovery.taskId,{expectedVersion:recovery.expectedVersion,executionId:recovery.executionId,generation:recovery.generation,confirmedStopped:true});
 if($('recovery-dialog').open)$('recovery-dialog').close();pendingRecovery=null;await refresh();toast(recovery.mode==='child'?'선택한 하위 작업만 복구 대기열에 넣었습니다.':'이전 실행 확인을 기록하고 작업을 복구했습니다.');
}
async function beginChildRecovery(childId){
 const parent=current(),child=state().tasks.find(task=>task.id===childId);if(!parent?.delegation||!child)return;
 const recovery=childRecoveryState(parent,child);if(!recovery.eligible)throw new Error('이 하위 작업은 현재 복구할 수 없습니다. 최신 상태를 확인하세요.');
 const request={mode:'child',parentId:parent.id,expectedVersion:parent.version,childTaskId:child.id,expectedChildVersion:child.version,provider:child.assignment?.provider,summary:`${child.assignment?.role||child.title||'하위 작업'}만 다시 실행합니다. 완료된 다른 결과는 유지됩니다.`,...recovery};
 if(recovery.requiresConfirmation)showRecoveryDialog(request);else await performRecovery(request,false);
}
function beginExecutionRecovery(){
 const task=current(),recovery=executionRecoveryState(task);if(!recovery.eligible)throw new Error('이 실행은 현재 복구할 수 없습니다. 최신 상태를 확인하세요.');
 showRecoveryDialog({mode:'execution',taskId:task.id,expectedVersion:task.version,provider:task.checkpoint?.provider,summary:'이전 원격 실행이 끝났는지 확인한 뒤 현재 작업을 복구합니다.',...recovery});
}
async function updateAttachments(next){if(current()){if(sourceReconnectLocked(current()))throw new Error('하위 작업과 진행 중인 위임의 자료 배정은 바꿀 수 없습니다. 같은 원본을 다시 연결하세요.');await act('attachments',{attachments:next});}else{draftAttachments=next;renderAttachments();}}
async function acceptSources(added,token){
 if(!sourcePickFence.isCurrent(token)){toast('작업 또는 서버가 바뀌어 선택한 자료를 적용하지 않았습니다.');return;}
 const task=current(),result=reconcileSourceSelection(task||{attachments:draftAttachments},added);
 if(!result.locked)await updateAttachments(result.attachments);
 else if(result.matched.length){const reconnected=await sourceCoordinator.reconnect();sourceStatus=sourceResultText(reconnected);renderAttachments();renderSourceExecution();}
 if(result.unmatched.length)toast(`${result.unmatched.length}개 파일은 저장된 원본과 일치하지 않아 배정하지 않았습니다. 이름, 경로, 크기와 수정 시각을 확인하세요.`);
 else toast(`${result.matched.length}개 파일을 ${result.locked?'기존 원본에 다시 연결':'연결'}했습니다. 원본은 업로드하지 않았습니다.`);
}
async function addFiles(files,token=sourcePickFence.capture()){if(!sourcePickFence.isCurrent(token))throw new Error('작업 또는 서버가 바뀌어 자료 선택을 취소했습니다.');const added=session.addFiles(files);await acceptSources(added,token);}
async function addFolder(){const token=sourcePickFence.capture();try{if('showDirectoryPicker'in window){const h=await window.showDirectoryPicker({mode:'read'});if(!sourcePickFence.isCurrent(token))return;const files=await collectDirectoryFiles(h,()=>sourcePickFence.isCurrent(token));if(files.length)await addFiles(files,token);}else{pendingFilePick=token;$('folder-input').click();}}catch(e){if(e.name!=='AbortError')throw e;}}
async function appendSourceViewEditor(attachment,file){
 const kind=sourceViewKind(file),openedTaskId=activeId;if(!kind)return;
 const section=document.createElement('section');section.className='source-view-editor';section.innerHTML=`<div class="source-view-heading"><strong>조회 범위 선택</strong><span class="count-label">${kind==='text'?'최대 200,000바이트':'최대 100쪽'}</span></div><p class="small-copy">선택한 부분만 실행에 전달합니다. 해시는 선택한 텍스트의 변경만 확인하며 전체 파일 무결성을 보장하지 않습니다.</p><div class="source-view-fields">${kind==='text'?'<label>시작 바이트<input data-view-start type="number" min="0" step="1"></label><label>조회 바이트<input data-view-amount type="number" min="1" max="200000" step="1"></label>':'<label>시작 페이지<input data-view-start type="number" min="1" step="1"></label><label>끝 페이지<input data-view-end type="number" min="1" step="1"></label>'}</div><div class="source-view-actions"><button type="button" class="secondary-button" data-view-preview>선택 범위 미리보기</button><button type="button" class="primary-button" data-view-save disabled>이 범위 저장</button><button type="button" class="text-button" data-view-reset ${attachment.view?'':'hidden'}>선택 초기화</button></div><p class="source-view-status" role="status"></p><pre class="source-view-excerpt" hidden></pre>`;
 $('preview-content').append(section);
 const start=section.querySelector('[data-view-start]'),amount=section.querySelector('[data-view-amount]'),end=section.querySelector('[data-view-end]'),previewButton=section.querySelector('[data-view-preview]'),saveButton=section.querySelector('[data-view-save]'),resetButton=section.querySelector('[data-view-reset]'),status=section.querySelector('.source-view-status'),excerpt=section.querySelector('.source-view-excerpt');
 if(kind==='text'){start.value=attachment.view?.kind==='text-byte-range'?attachment.view.start:0;amount.value=attachment.view?.kind==='text-byte-range'?attachment.view.end-attachment.view.start:Math.max(1,Math.min(file.size,200_000));}
 else{start.value=attachment.view?.kind==='pdf-pages'?attachment.view.startPage:1;end.value=attachment.view?.kind==='pdf-pages'?attachment.view.endPage:1;}
 const editable=canChangeSourceView(current(),false)&&activeId===openedTaskId;for(const input of [start,amount,end])if(input)input.disabled=!editable;previewButton.disabled=!editable;resetButton.disabled=!editable;
 let pending=null;const draftGuard=createSourceViewDraftGuard();
 const show=(result,token)=>{if(!draftGuard.isCurrent(token)||!section.isConnected)return false;pending=result.savedView;status.classList.remove('form-error');status.textContent=coverageDescription(result.coverage);excerpt.textContent=result.text;excerpt.hidden=false;saveButton.disabled=!(canChangeSourceView(current(),false)&&activeId===openedTaskId);return true;};
 const invalidate=()=>{draftGuard.invalidate();pending=null;saveButton.disabled=true;excerpt.hidden=true;status.classList.remove('form-error');status.textContent='입력값이 바뀌었습니다. 저장하기 전에 이 범위를 다시 미리보기 하세요.';};
 for(const input of [start,amount,end])if(input)input.addEventListener('input',invalidate);
 previewButton.onclick=()=>guarded(async()=>{if(activeId!==openedTaskId||!canChangeSourceView(current(),false))throw new Error('실행 중이거나 위임된 작업의 조회 범위는 바꿀 수 없습니다.');pending=null;saveButton.disabled=true;excerpt.hidden=true;status.textContent='선택 범위를 확인하는 중입니다.';const selection=selectionFromValues(kind,{start:start.value,amount:amount?.value,end:end?.value}),token=draftGuard.begin();try{const {extractSourceView}=await sourceViews();show(await prepareSourceViewPreview(file,selection,extractSourceView),token);}catch(error){if(draftGuard.isCurrent(token))throw error;}});
 saveButton.onclick=()=>guarded(async()=>{if(!pending)throw new Error('저장하기 전에 선택 범위를 미리보기 하세요.');if(activeId!==openedTaskId||!canChangeSourceView(current(),false))throw new Error('실행 중이거나 위임된 작업의 조회 범위는 바꿀 수 없습니다.');await updateAttachments(applyAttachmentView(attachments(),attachment.id,pending));draftGuard.invalidate();pending=null;resetButton.hidden=false;saveButton.disabled=true;toast('부분 조회 범위를 저장했습니다. 원본 내용은 기록에 저장하지 않았습니다.');});
 resetButton.onclick=()=>guarded(async()=>{if(activeId!==openedTaskId||!canChangeSourceView(current(),false))throw new Error('실행 중이거나 위임된 작업의 조회 범위는 바꿀 수 없습니다.');await updateAttachments(applyAttachmentView(attachments(),attachment.id,null));draftGuard.invalidate();pending=null;resetButton.hidden=true;saveButton.disabled=true;status.textContent='저장된 조회 범위를 초기화했습니다. 실행 시 기존 전체 추출 제한을 적용합니다.';toast('부분 조회 범위를 초기화했습니다.');});
 if(attachment.view){
  const token=draftGuard.begin();try{status.textContent='저장된 조회 범위를 다시 확인하는 중입니다.';const {verifySourceView}=await sourceViews();if(show(await prepareSourceViewPreview(file,attachment.view,verifySourceView),token))saveButton.disabled=true;}
  catch(error){if(draftGuard.isCurrent(token)){pending=null;saveButton.disabled=true;excerpt.hidden=true;status.textContent=`저장된 범위를 확인하지 못했습니다. ${error.message||''} 새 범위를 미리보기한 뒤 저장하세요.`;status.classList.add('form-error');}}
 }
}
async function preview(id){
 const a=attachments().find(x=>x.id===id)||session.list().find(x=>x.id===id);if(!a)return;
 $('preview-title').textContent=a.name;$('preview-content').replaceChildren();
 if(a.source==='url'){const p=document.createElement('p');p.textContent='연결된 링크입니다. 내용을 가져오거나 저장하지 않았습니다.';const link=document.createElement('a');link.textContent=a.url;link.href=linkSafe(a.url)||'#';link.target='_blank';link.rel='noopener noreferrer';$('preview-content').append(p,link);}
 else if(!connected(a)){$('preview-content').textContent='원본을 다시 연결해 주세요. 이름, 경로, 크기와 수정 시각이 같은 파일을 선택하면 기존 작업에 다시 연결됩니다.';}
 else{
 const file=await session.getFile(id);const info=document.createElement('p');info.className='small-copy';info.textContent=`${a.path} · ${bytes(a.size)} · 원본 영구 저장 없음`;$('preview-content').append(info);
  const editor=appendSourceViewEditor(a,file);
  if(file.type.startsWith('image/')||file.type==='application/pdf'){const url=URL.createObjectURL(file);previewUrls.push(url);const element=document.createElement(file.type==='application/pdf'?'iframe':'img');element.src=url;if(element.tagName==='IFRAME')element.setAttribute('sandbox','');else element.alt=a.name;$('preview-content').append(element);}
  else{const r=await extractConnectedText(file);const pre=document.createElement('pre');pre.textContent=r.status==='unavailable'?`이 파일에서 읽을 수 있는 텍스트를 찾지 못해 원본 참조로만 연결됩니다.\n${r.reason||''}`:r.text;$('preview-content').append(pre);if(r.status==='truncated'){const p=document.createElement('p');p.textContent=`미리보기는 앞부분 ${r.text.length.toLocaleString('ko-KR')}자만 표시합니다.`;$('preview-content').append(p);}}
  openDialog('preview-dialog');await editor;return;
 }
 openDialog('preview-dialog');
}
function download(name,content,mime='text/plain',encoding){let value=content;if(encoding==='base64'){const binary=atob(content);value=Uint8Array.from(binary,c=>c.charCodeAt(0));}const blob=value instanceof Blob?value:new Blob([value],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportRecords(all=false){const tasks=!all&&current()?[current()]:state().tasks;download(`INNO-${current()&&!all?'task':'workspace'}-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(exportBundle({tasks}),null,2),'application/json');toast('작업 기록을 내보냈습니다. 연결 원본 내용은 포함하지 않습니다.');}
async function run(){
 let t=current();if(!t)return;
 const runTaskId=t.id;
 const c=state().capabilities||{},provider=$('provider').value;
 if(!client.remote||!providerAvailable(provider,c)){showSettings();toast('선택한 AI 실행기가 연결된 서버를 설정하세요.');return;}
 if(usesTransport(provider,'desktop_bridge')&&c.cloudCodex&&!c.desktopSources&&t.attachments?.length)throw new Error(SOURCE_TASK_NEEDS_DESKTOP_PAGE);
 if(usesTransport(provider,'desktop_bridge')&&c.desktopSources&&t.attachments?.some(a=>a.source==='url'))throw new Error('링크만으로 원문을 읽을 수는 없습니다. 해당 문서 파일을 연결한 뒤 링크 참조를 해제하세요.');
 if(t.status==='paused'||t.status==='failed'||t.status==='waiting_connection'||t.status==='waiting_quota'){await act('resume');if(activeId!==runTaskId)throw new Error('실행할 작업이 바뀌었습니다. 다시 확인하세요.');t=current();}
 const executionClient=client;
 const materials=await prepareTaskMaterials(t,{
  connected,getFile:id=>session.getFile(id),extractText:extractConnectedText,allowImages:usesTransport(provider,'desktop_bridge'),
  verifyView:async(file,view)=>(await sourceViews()).verifySourceView(file,view),
  isCurrent:()=>client===executionClient&&activeId===runTaskId&&current()?.version===t.version,
 });
 await executionClient.run(t.id,{provider,materials,expectedVersion:t.version});await refresh();toast('실행 요청을 보냈습니다. 진행 상태와 결과를 기다리는 중입니다.');
}
function renderResearch(){
 $('literature-workflow').textContent=`선택 논문으로 비교 작업 준비 (${selectedPapers.size})`;
 const found=$('paper-search').value.trim()?searchPapers(papers,$('paper-search').value,80):papers.slice(0,80);
 if(!papers.length&&!prismReports.length)return;
 $('research-results').innerHTML=prismReports.map((r,i)=>`<article class="paper-card"><div class="paper-meta"><span>PRISM ANALYSIS</span><span>${esc(r.engine?.version||r.engine?.name||r.engine||'엔진 미기재')}</span></div><h3>${esc(r.name)}</h3><p>원본 출처와 분석 파라미터를 포함한 연결 결과</p><button data-prism="${i}">분석 JSON 보기 ↗</button></article>`).join('')+found.map(p=>`<article class="paper-card"><div class="paper-meta"><span>${esc(p.year||'연도 미기재')}</span><span>${esc(p.venue||'')}</span><span class="status">${({'metadata':'메타데이터만','abstract':'초록 포함','full-text':'전문 범위 표시'})[p.evidenceScope]||'범위 미확인'}</span></div><label class="paper-selection"><input type="checkbox" data-select-paper="${esc(p.id)}" ${selectedPapers.has(p.id)?'checked':''}> 비교할 논문 선택</label><h3>${esc(p.title)}</h3><p>${esc((p.abstract||'초록이 없습니다. 본문을 읽은 것으로 간주하지 않습니다.').slice(0,600))}</p><div class="paper-meta">${p.doi?`<a href="https://doi.org/${encodeURI(p.doi)}" target="_blank" rel="noopener noreferrer">${esc(p.doi)} ↗</a>`:''}<button data-paper="${esc(p.id)}">이 논문으로 질문하기</button></div></article>`).join('')+(!found.length&&papers.length?'<p class="small-copy">일치하는 논문이 없습니다.</p>':'');
}
const integrationDescriptions={Scheduler:'합성과 광학 측정 일정을 확인하고 계획을 이어갑니다.',NanoLab:'합성 계획, lot, ICP 조성과 수율을 관리합니다.',Ledger:'시료와 측정, 보정 및 채택 결과를 연결합니다.',Prism:'광학 측정 HDF5와 power scan, rise time을 분석합니다.',Analytics:'전자현미경 이미지와 EDS 자료를 분석합니다.',RefAtlas:'논문 수집, 근거 검색과 연구 문헌 탐색을 이어갑니다.'};
function renderIntegrations(){
 const list=Array.isArray(INTEGRATIONS)?INTEGRATIONS:Object.values(INTEGRATIONS);
 $('integration-grid').innerHTML=list.map((x,i)=>{const name=x.name||x.label||x.id;const key=Object.keys(integrationDescriptions).find(k=>String(name).toLowerCase().includes(k.toLowerCase()));const url=linkSafe(x.url||x.href||x.appUrl||x.repositoryUrl||'');return `<article class="integration-card"><div class="integration-mark">${['◷','⚗','▦','⌁','⊞','⌕'][i%6]}</div><h2>${esc(name)}</h2><p>${esc(x.description||integrationDescriptions[key]||'기존 연구 플랫폼 연결')}</p>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${x.linkKind==='app'?'앱 열기':'저장소 열기'} ↗</a>`:'<span class="small-copy">연결 주소 설정 필요</span>'}</article>`;}).join('');
}
function renderUsageObservationRow(r){
 return `<article class="usage-card"><strong>${esc(r.title)}</strong><p>${esc(r.provider)} · ${esc(date(r.completedAt))}</p><p>단계 ${esc(formatUsagePhase(r))} · 전환 ${esc(formatUsageTransition(r))}</p><p>서버 기준 경과 시간 (대기 포함) ${esc(formatWallElapsed(r))}</p><p>요청 모델 ${esc(formatRequestedModel(r))} · 실제 모델 버전 확인 불가</p><p>입력 ${r.inputTokens===null?'확인 불가':r.inputTokens.toLocaleString()} (캐시 보고 ${r.cachedInputTokens==null?'확인 불가':r.cachedInputTokens.toLocaleString()}) · 출력 ${r.outputTokens===null?'확인 불가':r.outputTokens.toLocaleString()} 토큰</p></article>`;
}
function renderUsage(){
 modelDiagnosticsUI.sync();
 let executionPanel=$('execution-usage');if(!executionPanel){executionPanel=document.createElement('section');executionPanel.id='execution-usage';$('usage-cards').after(executionPanel);}const rows=usageRows(state().tasks);const totals=usageSummary(state().tasks);executionPanel.innerHTML='<h2>작업별 최근 실행 보고</h2><p class="small-copy">실행기가 반환한 관측값입니다. 작업별 최근 100회 완료·전환·실패·결정 대기 기록을 보관하고 최근 50회를 표시합니다. 하위 작업도 포함합니다. 캐시 보고는 입력에 포함된 값으로 입력 합계에 더하지 않습니다. 캐시 누락은 0으로 추정하지 않습니다. 합계는 보관된 관측값이며 전체 사용량·구독 잔여량이 아닙니다. 실행 중·중단되었거나 실행기가 보고하지 않은 사용량은 포함되지 않을 수 있습니다.</p>'+Object.entries(totals).map(([provider,u])=>'<article class="usage-card"><strong>'+esc(provider)+' · 보관된 실행 보고 '+u.executions+'회</strong><p>관측 입력 '+(u.inputTokens===null?'확인 불가':u.inputTokens.toLocaleString())+' (캐시 보고 '+(u.cachedInputTokens==null?'확인 불가':u.cachedInputTokens.toLocaleString())+') · 관측 출력 '+(u.outputTokens===null?'확인 불가':u.outputTokens.toLocaleString())+'</p><p>보고 없는 기록: 입력 '+u.missingInput+'회 · 출력 '+u.missingOutput+'회 · 캐시 '+u.missingCachedInput+'회</p></article>').join('')+ (rows.length?rows.map(renderUsageObservationRow).join(''):'<p>관측된 작업별 토큰 기록이 아직 없습니다.</p>');

 let records=state().usage||[];if(!Array.isArray(records))records=Object.entries(records).map(([provider,u])=>({provider,...(u||{})}));
 $('usage-cards').innerHTML=usageCardModels(records).map(({vendor,label,usageUrl,record:u})=>{const percent=typeof u.usedPercent==='number'?Math.min(100,Math.max(0,u.usedPercent)):null;return `<article class="usage-card"><span class="eyebrow">${esc(vendor)}</span><h2>${esc(label)}</h2><div class="usage-value">${percent===null?'한도 확인 불가':`${percent.toFixed(0)}% 사용`}</div>${percent===null?'':`<progress value="${percent}" max="100" aria-label="구독 사용률"></progress>`}<p>${esc(u.source||'이 연결에서 구독 잔여량을 아직 받지 못했습니다.')}<br>${u.updatedAt?`갱신 ${esc(date(u.updatedAt))}`:'갱신 기록 없음'}</p><dl><dt>최근 제공자 보고 입력 토큰</dt><dd>${u.inputTokens==null?'확인 불가':Number(u.inputTokens).toLocaleString()}</dd><dt>최근 제공자 보고 출력 토큰</dt><dd>${u.outputTokens==null?'확인 불가':Number(u.outputTokens).toLocaleString()}</dd><dt>한도 초기화</dt><dd>${u.resetAt?esc(date(u.resetAt)):'확인 불가'}</dd></dl><a class="text-button" href="${esc(usageUrl)}" target="_blank" rel="noopener noreferrer">공식 사용량 확인 ↗</a></article>`;}).join('');
}
function showSettings(){$('server-url').value=client?.baseUrl||location.origin;$('server-token').value=client?.token||'';$('settings-error').textContent='';openDialog('settings-dialog');}
async function configure(e){e.preventDefault();const button=e.submitter;button.disabled=true;try{const baseUrl=validateEndpoint($('server-url').value),token=$('server-token').value.trim();const candidate=new WorkspaceClient({baseUrl,token,remote:true});await candidate.refresh();modelPolicyUI.close();deliveryRecoveryUI.close();selectionEpoch++;sourceCoordinator.resetSession();session.clear();draftAttachments=[];client=candidate;modelDiagnosticsUI.sync();const reconnect=await sourceCoordinator.reconnect();sourceStatus=sourceResultText(reconnect);sessionStorage.setItem('inno-token',token);localStorage.setItem('inno-server',baseUrl);sessionStorage.setItem('inno-remote','1');activeId=null;lastRendered='';syncStatus();render();void tickSource();$('settings-dialog').close();toast('서버에 연결했습니다. 이 탭이 열려 있는 동안 5초마다 상태를 확인합니다.');}catch(error){$('settings-error').textContent=error.message;}finally{button.disabled=false;}}

$('composer').addEventListener('submit',e=>{e.preventDefault();guarded(async()=>{const prompt=$('prompt').value.trim();if(!prompt)return;if(current()){await act(current().status==='waiting_user'?'decide':'message',{content:prompt});}else{const t=await client.create({prompt,type:$('task-type').value,attachments:draftAttachments,...(creationProject(state(),projectFilter())?{projectId:creationProject(state(),projectFilter()).id}:{})});activeId=t.id;localStorage.setItem('inno-active-task',t.id);draftAttachments=[];lastRendered='';} $('prompt').value='';syncStatus();render();requestAnimationFrame(()=>$('conversation-scroll').scrollTop=$('conversation-scroll').scrollHeight);toast(client.remote?'작업을 서버에 기록했습니다. 실행 버튼으로 시작하세요.':'작업을 이 기기에 기록했습니다. AI 실행은 서버 연결이 필요합니다.');});});
$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('composer').requestSubmit();}});
$('new-task').onclick=newTask;$('task-search').oninput=renderList;
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('prompt').value=b.dataset.prompt;$('task-type').value=b.dataset.type;$('prompt').focus();});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.addEventListener('click',e=>{if(e.target.closest('[data-source-pick-file]')){pendingFilePick=sourcePickFence.capture();$('file-input').click();}if(e.target.closest('[data-source-pick-folder]'))guarded(addFolder);const sourceRecover=e.target.closest('[data-source-recover]');if(sourceRecover)guarded(async()=>{const result=await sourceCoordinator.recover(sourceRecover.dataset.sourceRecover);sourceStatus=result.status==='recovered'?'복구된 작업을 확인했습니다. 원본 전달을 다시 확인합니다.':result.status==='recovery_required'?'먼저 이전 실행이 끝났는지 확인하고 작업을 복구하세요. 복구된 작업은 아래 버튼으로 다시 확인할 수 있습니다.':sourceResultText(result)||'최신 서버 상태를 확인한 뒤 다시 시도하세요.';renderSourceExecution();if(result.status==='recovered')void tickSource();});const recovery=e.target.closest('[data-recover-child]');if(recovery)guarded(()=>beginChildRecovery(recovery.dataset.recoverChild));const t=e.target.closest('[data-task]');if(t)selectTask(t.dataset.task);const p=e.target.closest('[data-preview]');if(p)guarded(()=>preview(p.dataset.preview));const r=e.target.closest('[data-remove]');if(r)guarded(async()=>{if(current()&&sourceReconnectLocked(current())){session.remove(r.dataset.remove);renderAttachments();renderSourceExecution();toast('이 기기의 원본 연결을 해제했습니다. 저장된 배정은 유지됩니다.');return;}await updateAttachments(attachments().filter(a=>a.id!==r.dataset.remove));session.remove(r.dataset.remove);renderAttachments();});const a=e.target.closest('[data-artifact]');if(a){const artifact=current()?.artifacts.find(x=>x.id===a.dataset.artifact);if(artifact)try{download(artifact.name,artifact.content,artifact.mime,artifact.encoding);}catch(err){toast(err.message);}}});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();newTask();}if(e.key==='Enter'&&e.target.matches('[data-preview],[data-artifact]'))e.target.click();});
document.addEventListener('click',e=>{const button=e.target.closest('[data-model-policy]');if(button)void modelPolicyUI.open(button.dataset.modelPolicy);});
document.addEventListener('click',e=>{if(e.target.closest('[data-review-observation-retry]'))void reviewObservationRecovery.retry();else if(e.target.closest('[data-review-observation-check]'))void reviewObservationRecovery.verify();});
$('attach-button').onclick=()=>{pendingFilePick=sourcePickFence.capture();$('file-input').click();};$('folder-button').onclick=()=>guarded(addFolder);
for(const id of ['file-input','folder-input'])$(id).onchange=e=>{const token=pendingFilePick;pendingFilePick=null;guarded(async()=>{try{if(token)await addFiles(e.target.files,token);}finally{e.target.value='';}});};
$('add-link').onclick=()=>{if(sourceReconnectLocked(current())){toast('이 작업은 저장된 원본만 다시 연결할 수 있습니다.');return;}openDialog('link-dialog');};$('link-form').onsubmit=e=>{e.preventDefault();guarded(async()=>{const a=session.addUrl($('link-url').value);await updateAttachments([...attachments().filter(x=>x.id!==a.id),a]);$('link-dialog').close();$('link-url').value='';});};
$('recovery-confirm').onchange=()=>{$('recovery-submit').disabled=!$('recovery-confirm').checked;};
$('recovery-form').onsubmit=e=>{e.preventDefault();if(!pendingRecovery||!$('recovery-confirm').checked)return;guarded(()=>performRecovery(pendingRecovery,true));};
 $('provider').replaceChildren(...providerOptions().map(option=>new Option(option.label,option.value)));$('provider').onchange=renderControls;$('run-button').onclick=()=>guarded(run);$('pause-button').onclick=()=>guarded(()=>act('pause'));$('cancel-button').onclick=()=>guarded(()=>act('cancel'));$('delegation-resume').onclick=()=>guarded(resumeDelegation);$('execution-recover').onclick=()=>guarded(beginExecutionRecovery);
$('model-policy-open').onclick=()=>{if(current()?.id)void modelPolicyUI.open(current().id);};
$('plugin-open').onclick=()=>void pluginUI.open();
$('delivery-recovery-open').onclick=()=>{if(current()?.id)void deliveryRecoveryUI.open();};
$('export-button').onclick=()=>exportRecords();$('settings-export').onclick=()=>exportRecords(true);
$('settings-button').onclick=showSettings;$('connect-executor').onclick=showSettings;$('settings-form').onsubmit=configure;
$('offline-button').onclick=()=>guarded(async()=>{const candidate=new WorkspaceClient();await candidate.refresh();modelPolicyUI.close();deliveryRecoveryUI.close();selectionEpoch++;sourceCoordinator.resetSession();session.clear();draftAttachments=[];client=candidate;modelDiagnosticsUI.sync();sourceStatus='';sessionStorage.removeItem('inno-token');sessionStorage.removeItem('inno-remote');activeId=null;lastRendered='';syncStatus();render();$('settings-dialog').close();toast('이 기기의 작업 보관함으로 전환했습니다. 서버 기록은 서버에 남아 있습니다.');});
$('storage-button').onclick=()=>guarded(()=>storageUI.open());
$('local-records-button').onclick=()=>guarded(()=>recordImports.fromLocal());
$('restore-button').onclick=()=>$('restore-input').click();$('restore-input').onchange=e=>guarded(async()=>{const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024)throw new Error('작업 기록 파일은 20 MB 이하여야 합니다.');const text=await file.text();if(client.remote){await recordImports.fromBundle(parseBundle(text));e.target.value='';return;}const count=await client.restore(text);render();toast(`${count}개 작업을 가져왔습니다. 원본은 다시 연결하세요.`);e.target.value='';});
$('edit-plan').onclick=()=>{$('plan-text').value=(current()?.plan||[]).map(x=>x.label||x.role).join('\n');openDialog('plan-dialog');};
$('plan-form').onsubmit=e=>{e.preventDefault();guarded(async()=>{const labels=$('plan-text').value.split('\n').map(s=>s.trim()).filter(Boolean);if(!labels.length||labels.length>6)throw new Error('역할은 1개에서 6개 사이로 구성하세요.');await act('plan',{plan:labels.map((label,i)=>({id:`role-${i+1}`,role:label,label,status:'pending',instructions:label}))});$('plan-dialog').close();});};
$('task-menu').onclick=openTaskMenu;
$('new-project').onclick=()=>openProjectDialog(null);
$('task-rename-save').onclick=()=>guarded(async()=>{await act('rename',{title:$('task-rename-input').value});$('task-menu-dialog').close();toast('작업 이름을 바꿨습니다.');});
$('task-move-save').onclick=()=>guarded(async()=>{const value=$('task-move-select').value;await act('move',{projectId:value||null});$('task-menu-dialog').close();toast(value?'프로젝트로 옮겼습니다.':'프로젝트에서 뺐습니다.');});
$('project-form').onsubmit=event=>{event.preventDefault();guarded(async()=>{
 const input={name:$('project-name').value,instructions:$('project-instructions').value};
 const result=editingProject?await projectRequest(`/api/projects/${encodeURIComponent(editingProject.id)}`,{action:'update',...input,expectedVersion:editingProject.version}):await projectRequest('/api/projects',input);
 if(!result)return;$('project-dialog').close();await refresh();
 if(!editingProject&&result.project)selectProject(result.project.id);
 toast(editingProject?'프로젝트를 저장했습니다.':'프로젝트를 만들었습니다. 새 작업은 이 프로젝트에 만들어집니다.');
});};
$('project-delete').onclick=()=>{
 if(!editingProject)return;
 if(!projectDeleteArmed){projectDeleteArmed=true;$('project-delete').textContent='삭제 확인';$('project-delete-note').classList.remove('hidden');return;}
 guarded(async()=>{const id=editingProject.id;const result=await projectRequest(`/api/projects/${encodeURIComponent(id)}`,{action:'delete',expectedVersion:editingProject.version});if(!result)return;$('project-dialog').close();if(activeProject===id)selectProject(null);await refresh();toast('프로젝트를 삭제했습니다. 작업은 프로젝트 없음으로 남습니다.');});
};
$('task-record-button').onclick=()=>{$('task-menu-dialog').close();if(!current())return;const t=current();$('preview-title').textContent='작업 기록';$('preview-content').innerHTML=`<pre>${esc(JSON.stringify(exportBundle({tasks:[t]}),null,2))}</pre>`;openDialog('preview-dialog');};
$('preview-dialog').addEventListener('close',()=>{previewUrls.forEach(u=>URL.revokeObjectURL(u));previewUrls=[];$('preview-content').replaceChildren();});
$('recovery-dialog').addEventListener('close',()=>{pendingRecovery=null;$('recovery-confirm').checked=false;});
$('mobile-menu').onclick=()=>{$('sidebar').classList.add('open');$('sidebar-scrim').classList.add('open');};$('sidebar-scrim').onclick=closeSidebar;
$('detail-toggle').onclick=()=>$('detail-panel').classList.toggle('open');$('detail-close').onclick=()=>$('detail-panel').classList.remove('open');
if(localStorage.getItem('inno-theme')==='dark')document.body.classList.add('dark');$('theme-button').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('inno-theme',document.body.classList.contains('dark')?'dark':'light');};
$('import-research').onclick=()=>$('research-input').click();$('paper-search').oninput=renderResearch;
$('research-input').onchange=e=>guarded(async()=>{let count=0;for(const file of e.target.files){if(file.size>30*1024*1024)throw new Error('문헌 색인 JSON은 30 MB 이하로 연결하세요.');const text=await file.text();const raw=JSON.parse(text);if(raw.analysis&&('paReport'in raw.analysis)){const r=parsePrismReport(text);prismReports.push({...r,name:file.name});}else{const incoming=parseRefAtlas(text);const map=new Map(papers.map(p=>[p.id,p]));incoming.forEach(p=>map.set(p.id,p));papers=[...map.values()];count+=incoming.length;}}renderResearch();toast(`${count}편의 문헌 · ${prismReports.length}개 분석 결과가 세션에 연결됐습니다.`);e.target.value='';});
$('research-results').onclick=e=>{const b=e.target.closest('[data-paper]');if(b){const p=papers.find(x=>x.id===b.dataset.paper);newTask();$('task-type').value='literature';$('prompt').value=`다음 자료에서 확인할 수 있는 주장과 추가 확인이 필요한 내용을 구분해줘.\n제목: ${p.title}\nDOI: ${p.doi||'없음'}\n읽기 범위: 서지정보만 연결됨 (내용 분석에는 원문이나 초록 파일을 연결하세요.)`;$('prompt').focus();}const q=e.target.closest('[data-prism]');if(q){$('preview-title').textContent=prismReports[+q.dataset.prism].name;$('preview-content').innerHTML=`<pre>${esc(JSON.stringify(prismReports[+q.dataset.prism],null,2))}</pre>`;openDialog('preview-dialog');}};

// A horizontal swipe closes mobile drawers while vertical scrolling remains native.
for(const [id,close] of [['sidebar',closeSidebar],['detail-panel',()=>$('detail-panel').classList.remove('open')]]){
 let touch=null;const panel=$(id);
 panel.addEventListener('touchstart',e=>{if(e.touches.length===1&&!e.target.closest('input,textarea,select'))touch={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
 panel.addEventListener('touchend',e=>{if(!touch||innerWidth>1020)return;const end=e.changedTouches[0],dx=end.clientX-touch.x,dy=end.clientY-touch.y;touch=null;if(Math.abs(dx)>75&&Math.abs(dx)>Math.abs(dy)*2&&((id==='sidebar'&&dx<0)||(id==='detail-panel'&&dx>0)))close();},{passive:true});
}

let dragCounter=0;document.addEventListener('dragenter',e=>{if([...e.dataTransfer.types].includes('Files')){dragCounter++;$('drop-overlay').classList.remove('hidden');}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(--dragCounter<=0){dragCounter=0;$('drop-overlay').classList.add('hidden');}});document.addEventListener('drop',e=>{e.preventDefault();dragCounter=0;$('drop-overlay').classList.add('hidden');const token=sourcePickFence.capture();guarded(async()=>{const items=[...e.dataTransfer.items];const handles=[];if(items.some(i=>typeof i.getAsFileSystemHandle==='function')){const pending=items.filter(i=>i.kind==='file').map(i=>i.getAsFileSystemHandle());for(const h of await Promise.all(pending)){if(h?.kind==='directory')handles.push(h);}}const files=[...e.dataTransfer.files].filter(f=>f.size||f.type);for(const h of handles){if(!sourcePickFence.isCurrent(token))return;files.push(...await collectDirectoryFiles(h,()=>sourcePickFence.isCurrent(token)));}if(files.length)await addFiles(files,token);else if(!handles.length)toast('이 브라우저에서는 폴더 연결 버튼을 사용하세요.');});});
document.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();const token=sourcePickFence.capture();guarded(()=>addFiles(files,token));}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('online',refresh);window.addEventListener('offline',()=>syncStatus(new Error('offline')));

async function init(){
 let token=sessionStorage.getItem('inno-token')||'',baseUrl=localStorage.getItem('inno-server')||'',remote=sessionStorage.getItem('inno-remote')==='1';
 const hash=new URLSearchParams(location.hash.slice(1));if(hash.has('token')){token=hash.get('token');baseUrl=location.origin;remote=true;sessionStorage.setItem('inno-token',token);sessionStorage.setItem('inno-remote','1');history.replaceState(null,'',location.pathname+location.search);}
 client=new WorkspaceClient({token,baseUrl:remote?baseUrl:'',remote});
 try{await client.refresh();syncStatus();if(remote){const result=await sourceCoordinator.reconnect();sourceStatus=sourceResultText(result);}}catch(e){syncStatus(e);if(remote)toast('서버 연결에 실패했습니다. 설정에서 주소와 토큰을 확인하세요.');else toast('브라우저 저장 공간을 사용할 수 없습니다. 서버 연결이 필요합니다.');}
 activeId=state().tasks.some(t=>t.id===localStorage.getItem('inno-active-task'))?localStorage.getItem('inno-active-task'):null;
 renderIntegrations();render();renderUsage();if(remote)void tickSource();
 setInterval(()=>{if(!document.hidden&&!busy)refresh();},5000);
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
init().catch(e=>toast(e.message));

$('research-results').addEventListener('change',e=>{const input=e.target.closest('[data-select-paper]');if(!input)return;if(input.checked)selectedPapers.add(input.dataset.selectPaper);else selectedPapers.delete(input.dataset.selectPaper);$('literature-workflow').textContent=`선택 논문으로 비교 작업 준비 (${selectedPapers.size})`;});
async function prepareLiterature(reconnect=false){const workflow=await buildLiteratureWorkflow(papers.filter(p=>selectedPapers.has(p.id)));const file=new File([workflow.text],workflow.name,{type:'text/plain',lastModified:0});if(reconnect){session.addFiles([file]);renderAttachments();toast('선택한 논문 자료를 다시 연결했습니다. 기존 작업을 열어 연결 상태를 확인하세요.');return;}newTask();$('task-type').value=workflow.type;$('prompt').value=workflow.prompt;await addFiles([file]);toast('문헌 비교 요청과 임시 자료를 준비했습니다. 연구 목적을 수정하고 작업 기록 후 AI 실행을 누르세요.');}
$('literature-workflow').onclick=()=>guarded(()=>prepareLiterature());
$('literature-reconnect').onclick=()=>guarded(()=>prepareLiterature(true));

async function prepareSeparateReview(){
 if($('prompt').value.trim())throw Error('작성 중인 요청을 먼저 기록하거나 비워 주세요.');
 const task=current();const sources=(task?.attachments||[]).filter(a=>/^refatlas-evidence-[a-f0-9]{64}\.txt$/.test(a.name));
 if(sources.length!==1)throw Error('원래 문헌 자료 하나를 다시 연결하세요.');
 if(!connected(sources[0]))throw Error('연구 자료에서 같은 문헌을 선택하고 선택 자료 다시 연결을 누르세요.');
 const source=await session.getFile(sources[0].id);if(!source)throw Error('연구 자료에서 같은 문헌을 선택해 자료를 다시 연결하세요.');
 const review=await buildLiteratureReview(task,await source.text());
 const file=new File([review.text],review.name,{type:'text/plain',lastModified:0});
 newTask();$('task-type').value=review.type;$('prompt').value=review.prompt;await addFiles([source,file]);
 toast('별도 검토 요청을 준비했습니다. 작업 기록 후 실행하세요.');
}

createExperimentLinks({root:$('experiment-links'),prepareTask:async result=>{if($('prompt').value.trim())throw Error('작성 중인 요청을 먼저 기록하거나 비워 주세요.');const packet=await experimentPacket(result);const file=new File([packet.text],packet.name,{type:'application/json',lastModified:0});newTask();$('task-type').value='analysis';$('prompt').value='연결된 실험 요약의 출처·불일치·추가 확인 사항을 정리해 주세요. 원시 측정 데이터나 합성 조건 전체를 읽은 것으로 표현하지 마세요. PA 하한 여부와 단위를 유지하고 인과관계는 단정하지 마세요.\n시료 ID: '+result.sampleId+'\n실험 ID: '+result.experimentId;await addFiles([file]);toast('연결 메타데이터로 작업을 준비했습니다. 원시 데이터 분석에는 해당 원본도 연결하세요.');}});

function artifactCheckDetails(artifact){let checks;try{checks=sanitizeArtifactChecks(artifact.checks);}catch{return ''; }if(!checks?.length)return '';return '<details><summary>AI 검사 보고 근거</summary><p class="small-copy">실행 AI가 보고한 내용이며 독립 인증이 아닙니다.</p>'+checks.map(c=>'<p class="small-copy"><strong>'+esc(c.check)+' · '+esc(({pass:'통과',fail:'실패',not_run:'미실시'})[c.status])+'</strong><br>'+esc(c.evidence)+'</p>').join('')+'</details>'; }
