import {PROVIDER_IDS,isAssignableProvider,isProviderId,providerHas,providerLabel,providerManifest,usesTransport} from './core/providers.mjs';
import {AUTO_PROVIDER,autoRoutingBlocker,routingText} from './core/cloud-routing.mjs';
import {crossCheckVerdict,crossCheckVerifier} from './core/cross-check.mjs';

// Differentiation ①: one line per verification of this result (newest first), with the verifier,
// its state and the verdict read from its answer.
const VERDICT_TEXT={pass:'통과',partial:'부분 통과',fail:'실패',unverifiable:'확인 불가'};
export function crossCheckLines(task,tasks=[]){
 return (task?.crossChecks??[]).map(item=>{
  const check=tasks.find(other=>other?.id===item.taskId),verdict=check?crossCheckVerdict(check):null;
  const state=!check?'찾을 수 없음':verdict?VERDICT_TEXT[verdict]:check.status==='completed'?'판정 없음':check.status==='ready'?'시작 안 됨 (열어서 실행)':['queued','running'].includes(check.status)?'검증 중':check.status==='waiting_quota'?'한도 대기':check.status==='waiting_connection'?'연결 대기':'검증 중단';
  // A verification of an earlier run of this task is marked as such.
  const earlier=Boolean(check?.crossCheckOf?.executionId&&task.checkpoint?.executionId&&check.crossCheckOf.executionId!==task.checkpoint.executionId);
  return {taskId:item.taskId,verdict,text:`교차 검증 · ${providerName(item.provider)} · ${state}${earlier?' (이전 결과)':''}`};
 });
}

// When "auto" cannot be used, the PC runner is chosen before the cloud.
export function fallbackProvider(options){
 const usable=options.filter(option=>!option.disabled&&option.value!==AUTO_PROVIDER);
 return (usable.find(option=>usesTransport(option.value,'desktop_bridge'))??usable[0])?.value;
}
// With auto selected, a task that waits or runs is described by its own runner.
export function statusProvider(selected,task){
 return selected===AUTO_PROVIDER&&['queued','running'].includes(task?.status)&&isProviderId(task.checkpoint?.provider)?task.checkpoint.provider:selected;
}
// The picker's value: until the person chooses a runner it follows auto (back to auto as soon
// as auto can be used); a chosen runner stays unless it is auto and cannot be used.
export function pickProvider(options,current,chosen){
 const autoUsable=options.some(option=>option.value===AUTO_PROVIDER&&!option.disabled);
 if(!chosen)return autoUsable?AUTO_PROVIDER:fallbackProvider(options)??current;
 return current===AUTO_PROVIDER&&!autoUsable?fallbackProvider(options)??current:current;
}

// Provider copy for the screen, derived from the registry (CR-006 S1). The
// wording depends on the transport: a desktop provider needs the PC, a cloud
// provider runs through its Routine.
const lower=value=>String(value||'').toLowerCase();

export function providerName(value){return providerLabel(lower(value))??(value||'제공자 미기재');}

// A task with connected originals runs on this PC's Codex only from the desktop connection page,
// which reads the originals locally; the web page (on any device) cannot pass them to Codex.
export const SOURCE_TASK_NEEDS_DESKTOP_PAGE='원본 파일이 연결된 작업은 이 PC의 데스크톱 연결 화면에서 실행합니다. 지금 보는 웹 화면은 PC의 원본을 Codex에 전달할 수 없습니다. PC의 .inno/DESKTOP-ACCESS.md에 있는 링크로 데스크톱 연결 화면을 열고, 같은 작업에서 원본을 다시 연결한 뒤 실행하세요.';

// PRV-06: a provider the person turned off stays listed but cannot be chosen.
const turnedOff=(provider,capabilities)=>(capabilities?.disabledProviders??[]).includes(lower(provider));
// CR-006 S2: a provider still in its conformance trial is listed but cannot be chosen.
// CR-010: "auto" comes first in the cloud workspace, for source-free top-level tasks only.
export function providerOptions(capabilities,{task}={}){
 const auto=!capabilities?.cloud||Boolean(autoRoutingBlocker(task));
 return [{value:AUTO_PROVIDER,label:'자동 · PC 우선, 꺼져 있으면 클라우드 Claude',...(auto?{disabled:true}:{})},...PROVIDER_IDS.map(id=>{
  const trial=!isAssignableProvider(id),off=turnedOff(id,capabilities);
  return {value:id,label:providerManifest(id).ui.option+(trial?' (준비 중)':off?' (사용 중지)':''),...(trial||off?{disabled:true}:{})};
 })];
}

// The executor line for auto: the recorded decision while the task waits or runs, otherwise
// what auto will do. Empty for other choices.
export function autoExecutorText(task,provider){
 const routing=task?.checkpoint?.routing;
 if(routing?.mode==='auto'&&task.status==='running')return `자동 배정: ${usesTransport(routing.provider,'desktop_bridge')?'이 PC':'클라우드'} ${providerName(routing.provider)}에서 실행 중입니다.`;
 if(routing?.mode==='auto'&&task.status==='queued')return autoRoutingBlocker(task)?`자동 배정: 이 PC(${providerName(routing.provider)}) — 원본이 연결돼 클라우드로 옮기지 않습니다.`:routingText(routing);
 // A task already waiting or running without an auto record keeps its own state line.
 if(['queued','running'].includes(task?.status))return '';
 return provider===AUTO_PROVIDER?'자동: PC 실행기가 준비돼 있으면 이 PC로, 아니면 클라우드 Claude로 보냅니다. PC로 보낸 작업이 10분 안에 시작되지 않으면 클라우드로 한 번 옮깁니다.':'';
}

// Availability is any of the server state flags the manifest declares.
export function providerAvailable(provider,capabilities){
 if(!isProviderId(provider))return false;
 const c=capabilities||{};return providerManifest(provider).ui.availability.some(flag=>!!c[flag]);
}

// desktopNotReady: why a running desktop connector is not taking work (H9-1); desktopProviders:
// each runner's own state when the connector reports it (CR-006 S2), which then decides.
const NOT_READY_TEXT={
 codex_login:label=>`데스크톱 연결됨 · 이 PC의 ${label} 로그인이 확인되지 않아 실행을 시작하지 않습니다. 로그인하면 대기 중인 실행이 자동으로 이어지고, 로그인한 뒤에도 계속되면 데스크톱 연결기를 다시 시작하세요.`,
 claude_login:()=>'데스크톱 연결됨 · 이 PC의 Claude Code 로그인이 확인되지 않아 실행을 시작하지 않습니다. PC의 명령 창에서 claude auth login으로 Claude 구독에 로그인하세요.',
 claude_cli:()=>'데스크톱 연결됨 · 이 PC에서 Claude Code CLI를 찾지 못했습니다. Claude 데스크톱 앱을 설치하거나 INNO_CLAUDE_CLI에 claude.exe 경로를 지정하세요.',
 run_storage:()=>'데스크톱 연결됨 · 이 PC의 실행 저장 공간 점검에 실패해 실행을 시작하지 않습니다. 데스크톱 작업 화면에서 실행 저장 공간을 정리하세요.',
};
export function executorStatusText(provider,capabilities,{desktopOnline=false,desktopNotReady,desktopProviders}={}){
 const c=capabilities||{},id=lower(provider),label=providerName(provider);
 if(usesTransport(id,'desktop_bridge')){
  if(!providerAvailable(id,c))return `이 서버에 ${label} 실행기가 연결되지 않았습니다.`;
  if(turnedOff(id,c))return `${label} 실행기는 사용 중지 상태입니다. 연결 앱의 AI 실행기에서 다시 켤 수 있습니다.`;
  const reason=desktopProviders&&desktopNotReady!=='run_storage'?desktopProviders.notReady?.[id]:desktopNotReady;
  if(desktopOnline&&Object.hasOwn(NOT_READY_TEXT,reason??''))return NOT_READY_TEXT[reason](label);
  if(c.desktopSources)return `같은 클라우드 작업 · 선택한 원본은 이 PC에서만 ${label}에 전달합니다.`;
  if(c.cloudCodex)return desktopOnline?'데스크톱 연결됨 · 같은 클라우드 작업에 결과를 저장합니다.':'데스크톱 오프라인 · 실행 요청을 대기열에 보관합니다.';
  return `이 서버의 ${label} 구독으로 실행합니다.`;
 }
 if(providerAvailable(id,c)&&turnedOff(id,c))return `${label} 실행기는 사용 중지 상태입니다. 연결 앱의 AI 실행기에서 다시 켤 수 있습니다.`;
 return providerAvailable(id,c)?'연결된 클라우드 Routine으로 실행합니다.':`서버에 ${label} Routine 설정이 필요합니다.`;
}

export function queuedText(provider,capabilities){
 if(turnedOff(provider,capabilities))return `${providerName(provider)} 사용 중지로 대기 중 · 다시 켜면 이어집니다.`;
 return usesTransport(lower(provider),'desktop_bridge')?`${providerName(provider)} 실행 대기 중 · 연결된 데스크톱이 켜져 있어야 이어집니다.`:`${providerName(provider)} 실행 연결 대기 중`;
}

export function handoffLine(handoff){return `${providerName(handoff.from)} → ${providerName(handoff.to)} · ${handoff.reason}`;}

// Only providers whose stop needs confirmation name themselves in the recovery copy.
export function recoveryConfirmText(provider){
 const id=lower(provider);
 return providerHas(id,'cancellation','confirmation_required')?`이전 ${providerName(id)} 실행이 종료되었음을 확인했습니다.`:'이전 실행이 종료되었음을 확인했습니다.';
}

// A provider in its conformance trial gets a card only once it has recorded usage.
export function usageCardModels(records){
 const recorded=provider=>(records||[]).some(row=>lower(row?.provider)===provider);
 return PROVIDER_IDS.filter(provider=>isAssignableProvider(provider)||recorded(provider)).map(provider=>{
  const manifest=providerManifest(provider);
  return {provider,vendor:manifest.vendor,label:manifest.label,usageUrl:manifest.ui.usageUrl,record:(records||[]).find(row=>lower(row?.provider)===provider)||{}};
 });
}

// Differentiation ①: the cross-check button for a completed result in the cloud workspace.
export function crossCheckButton(task,capabilities){
 const c=capabilities||{};
 if(!c.cloud||!task||task.status!=='completed'||task.crossCheckOf)return {hidden:true,disabled:true,label:'',title:''};
 const choice=crossCheckVerifier(task,{available:id=>providerAvailable(id,c),disabled:c.disabledProviders??[]});
 if(choice.blocked)return {hidden:false,disabled:true,label:'교차 검증',title:choice.blocked,reason:choice.blocked};
 const name=providerName(choice.provider);
 return {hidden:false,disabled:false,label:`${name}로 교차 검증`,title:`다른 회사 모델(${name})이 이 결과를 검증합니다. 구독 사용량을 씁니다.`};
}
