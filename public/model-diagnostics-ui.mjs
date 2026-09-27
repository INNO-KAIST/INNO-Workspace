const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const officialUrls={openai:'https://developers.openai.com/api/docs/models.md',claude:'https://code.claude.com/docs/en/model-config.md'};
const providerName={openai:'OpenAI',claude:'Claude'};
const sourceStatus={fresh:'최근 확인',stale:'재확인 필요',unavailable:'아직 확인되지 않음'};
const retentionStatus={never_run:'아직 실행되지 않음',running:'정리 진행 중',complete:'완료',deferred:'지연',failed:'실패'};
const kindName={documentation_slug:'모델 문서 항목',alias:'역할 별칭'};
const errorName={network_error:'네트워크 조회 실패',format_changed:'공식 문서 형식 변경',redirect_rejected:'허용되지 않은 주소 이동',body_too_large:'문서 크기 제한 초과',http_error:'공식 문서 HTTP 오류',content_type_changed:'문서 형식 확인 실패',timeout:'조회 시간 초과',profile_scan_failed:'정책 기록 조회 실패',policy_cleanup_failed:'정책 근거 정리 실패',pin_scan_deferred:'작업 근거 확인 지연'};
const sourceDescription={openai:'API 모델 문서 목록 · 계정 사용 가능성과 별도',claude:'Claude Code 역할 별칭 · 실제 모델 및 계정 사용 가능성과 별도'};
const explainError=value=>errorName[value]||value;
const time=value=>{if(value==null)return '기록 없음';const date=new Date(value);return Number.isNaN(+date)?'확인 불가':escape(date.toLocaleString('ko-KR'));};
const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('ko-KR'):'확인 불가';

export function renderDiscovery(data){
 const sources=Array.isArray(data?.sources)?data.sources:[];
 const candidates=(Array.isArray(data?.candidates)?data.candidates:[]).slice(0,100);
 const sourceHtml=sources.map(source=>{
  const url=officialUrls[source?.provider]===source?.url?source.url:null;
  return `<article class="model-diagnostic-source"><strong>${escape(providerName[source?.provider]||source?.provider||'제공자 미확인')} · ${escape(sourceStatus[source?.status]||source?.status||'상태 미확인')}</strong>${sourceDescription[source?.provider]?`<p>${escape(sourceDescription[source.provider])}</p>`:''}<p>출처 ${url?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(url)} ↗</a>`:'URL 확인 불가'}</p><p>확인 ${time(source?.verifiedAt)} · 만료 ${time(source?.expiresAt)} · 다음 시도 ${time(source?.nextAttemptAt)}</p>${source?.lastError?`<p>최근 오류 ${escape(explainError(source.lastError))}</p>`:''}</article>`;
 }).join('');
 const candidateHtml=candidates.map(candidate=>`<li class="model-diagnostic-candidate"><strong>${escape(providerName[candidate?.provider]||candidate?.provider||'제공자 미확인')} · ${escape(candidate?.id||'이름 미확인')}</strong> · ${escape(kindName[candidate?.kind]||candidate?.kind||'종류 미확인')}${candidate?.documentedTarget?` · 문서상 대상 ${escape(candidate.documentedTarget)}`:''}</li>`).join('');
 const more=Array.isArray(data?.candidates)&&data.candidates.length>100?`<p>화면에는 처음 100개 후보만 표시합니다. API 목록 ${count(data.candidates.length)}건.</p>`:'';
 return `<h3>공식 문서 발견 상태</h3><p class="small-copy">공식 문서 후보입니다. 계정 사용 가능성 및 품질 미확인. 자동 배정이나 승격의 근거가 아닙니다.</p>${sourceHtml||'<p>확인된 공식 출처 기록이 없습니다.</p>'}<h4>공식 문서 후보 (${count(candidates.length)}건 표시)</h4>${candidateHtml?`<ul class="model-diagnostic-candidates">${candidateHtml}</ul>`:'<p>기록된 후보가 없습니다.</p>'}${more}`;
}

export function renderRetention(data){
 const status=retentionStatus[data?.status]||escape(data?.status||'상태 미확인');
 return `<h3>모델 정책 근거 정리</h3><p class="small-copy">정리 기록 건수입니다. AI 실행 횟수를 뜻하지 않습니다.</p><p><strong>${escape(status)}</strong> · 정리 ${count(data?.removed)}건 · 보존 예외 ${count(data?.retainedExceptions)}건 · 지연 ${count(data?.deferredCount)}건 · 실패 ${count(data?.failedCount)}건</p><p>마지막 시도 ${time(data?.lastAttemptAt)} · 마지막 정리 ${time(data?.lastCleanupAt)} · 다음 점검 ${time(data?.nextAt)}</p>${data?.lastError?`<p>최근 오류 ${escape(explainError(data.lastError))}</p>`:''}`;
}

export function createModelDiagnosticsUI({root,getContext}){
 const details=root.querySelector('details'),content=root.querySelector('[data-diagnostic-content]'),button=root.querySelector('[data-diagnostic-refresh]');
 let client=null,enabled=false,generation=0,loading=null,discovery=null,retention=null,discoveryError=null,retentionError=null,loaded=false;
 const current=(captured,version)=>enabled&&details.open&&client===captured&&generation===version&&getContext().client===captured&&getContext().capabilities?.modelDiagnostics===true;
 const render=()=>{
  content.innerHTML=`<section class="model-diagnostic-block">${discovery?renderDiscovery(discovery):'<h3>공식 문서 발견 상태</h3>'}${discoveryError?`<p role="alert">조회 실패 · ${escape(discoveryError)}${discovery?' · 마지막 정상 기록을 표시합니다.':''}</p>`:discovery?'':'<p>조회 중…</p>'}</section><section class="model-diagnostic-block">${retention?renderRetention(retention):'<h3>모델 정책 근거 정리</h3>'}${retentionError?`<p role="alert">조회 실패 · ${escape(retentionError)}${retention?' · 마지막 정상 기록을 표시합니다.':''}</p>`:retention?'':'<p>조회 중…</p>'}</section>`;
 };
 const reset=()=>{generation++;loading=null;loaded=false;discovery=null;retention=null;discoveryError=null;retentionError=null;details.open=false;content.innerHTML='';button.disabled=false;};
 const load=()=>{
  if(!enabled||!details.open||loading)return loading;
  if(loaded)return Promise.resolve();
  const captured=client,version=generation;
  button.disabled=true;
  render();
  const read=(method,onSuccess,onFailure)=>Promise.resolve().then(()=>captured[method]()).then(value=>{if(current(captured,version)){onSuccess(value);render();}},error=>{if(current(captured,version)){onFailure(error?.message||'서버 상태를 확인하세요.');render();}});
  loading=Promise.all([read('readModelDiscovery',value=>{discovery=value;discoveryError=null;},error=>discoveryError=error),read('readModelPolicyRetention',value=>{retention=value;retentionError=null;},error=>retentionError=error)]).finally(()=>{if(current(captured,version)){loaded=true;loading=null;button.disabled=false;}});
  return loading;
 };
 details.addEventListener('toggle',()=>{if(details.open)void load();else if(loading){generation++;loading=null;loaded=false;button.disabled=false;}});
 button.addEventListener('click',()=>{if(!enabled||loading)return;loaded=false;discoveryError=null;retentionError=null;void load();});
 return {sync(){const context=getContext(),available=!!(context.client?.remote&&context.capabilities?.modelDiagnostics===true);if(context.client!==client||available!==enabled){reset();client=context.client;enabled=available;}root.hidden=!available;},close:reset};
}
