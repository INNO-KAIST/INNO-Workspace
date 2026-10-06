import {PROVIDER_IDS,isProviderId,providerHas,providerLabel,providerManifest,usesTransport} from './core/providers.mjs';

// Provider copy for the screen, derived from the registry (CR-006 S1). The
// wording depends on the transport: a desktop provider needs the PC, a cloud
// provider runs through its Routine.
const lower=value=>String(value||'').toLowerCase();

export function providerName(value){return providerLabel(lower(value))??(value||'제공자 미기재');}

// PRV-06: a provider the person turned off stays listed but cannot be chosen.
const turnedOff=(provider,capabilities)=>(capabilities?.disabledProviders??[]).includes(lower(provider));
export function providerOptions(capabilities){return PROVIDER_IDS.map(id=>({value:id,label:providerManifest(id).ui.option+(turnedOff(id,capabilities)?' (사용 중지)':''),...(turnedOff(id,capabilities)?{disabled:true}:{})}));}

// Availability is any of the server state flags the manifest declares.
export function providerAvailable(provider,capabilities){
 if(!isProviderId(provider))return false;
 const c=capabilities||{};return providerManifest(provider).ui.availability.some(flag=>!!c[flag]);
}

// desktopNotReady: why a running desktop connector is not taking work (H9-1).
const NOT_READY_TEXT={
 codex_login:label=>`데스크톱 연결됨 · 이 PC의 ${label} 로그인이 확인되지 않아 실행을 시작하지 않습니다. 로그인하면 대기 중인 실행이 자동으로 이어지고, 로그인한 뒤에도 계속되면 데스크톱 연결기를 다시 시작하세요.`,
 run_storage:()=>'데스크톱 연결됨 · 이 PC의 실행 저장 공간 점검에 실패해 실행을 시작하지 않습니다. 데스크톱 작업 화면에서 실행 저장 공간을 정리하세요.',
};
export function executorStatusText(provider,capabilities,{desktopOnline=false,desktopNotReady}={}){
 const c=capabilities||{},id=lower(provider),label=providerName(provider);
 if(usesTransport(id,'desktop_bridge')){
  if(!providerAvailable(id,c))return `이 서버에 ${label} 실행기가 연결되지 않았습니다.`;
  if(turnedOff(id,c))return `${label} 실행기는 사용 중지 상태입니다. 연결 앱의 AI 실행기에서 다시 켤 수 있습니다.`;
  if(desktopOnline&&Object.hasOwn(NOT_READY_TEXT,desktopNotReady??''))return NOT_READY_TEXT[desktopNotReady](label);
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

export function usageCardModels(records){
 return PROVIDER_IDS.map(provider=>{
  const manifest=providerManifest(provider);
  return {provider,vendor:manifest.vendor,label:manifest.label,usageUrl:manifest.ui.usageUrl,record:(records||[]).find(row=>lower(row?.provider)===provider)||{}};
 });
}
