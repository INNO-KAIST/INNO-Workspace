// Persist only bounded categories and server timing hints, never raw provider diagnostics.
const descriptions = Object.freeze({
 context: ['작업 이력 전달 상한 초과', '필수 작업 이력(요청·사용자 지시·체크포인트 포함)이 한 번에 전달할 수 있는 상한(384KB)을 넘어 실행을 시작하지 않았습니다. 내용을 잘라 보내지 않았습니다. 필요한 요청과 자료만 담아 새 작업으로 나누어 진행하세요.'],
 resource: ['실행 출력 처리 상한 도달', '저장된 결과 파일을 확인하고 출력 범위를 줄인 뒤 이어서 실행하세요.'],
 unavailable: ['실행기 또는 원본 연결 필요', '실행기 설정과 필요한 원본 연결을 확인한 뒤 이어서 실행하세요.'],
 quota: ['사용 또는 요청 한도 대기', '공식 사용량 화면에서 한도를 확인한 뒤 이어서 실행하세요.'],
 authentication: ['인증 연결 확인 필요', '해당 실행기의 구독 로그인을 확인한 뒤 이어서 실행하세요.'],
 connection: ['통신 중단', '연결을 확인하고 기존 실행이 종료되었는지 확인한 뒤 이어서 실행하세요.'],
 interrupted: ['실행 연결 중단', '데스크톱을 다시 연결하면 보관된 결과부터 전달합니다. 새 실행 전 기존 작업 상태를 확인하세요.'],
 unknown: ['실행 중단', '기존 실행과 생성된 결과를 확인한 뒤 이어서 실행하세요.'],
});
const codes = {CONTEXT_RETRIEVAL_REQUIRED:'context',OUTPUT_LIMIT:'resource',QUOTA_EXCEEDED:'quota',AUTH_REQUIRED:'authentication',CONNECTION_FAILED:'connection'};
export function retryHint(value, now=Date.now()) {
 if(typeof value!=='string'||!value.trim())return null;
 const n=/^\d+(?:\.\d+)?$/.test(value.trim())?now+Number(value)*1000:Date.parse(value);
 return Number.isFinite(n)&&n>now&&n<=now+7*86400000?new Date(n).toISOString():null;
}
export function runnerError(error, {status,retryAfter,now=Date.now()}={}) {
 const message=typeof error?.message==='string'?error.message:'';
 let kind=codes[error?.code];
 if(!kind){
  if(status===401||status===403||/unauthorized|authentication (?:failed|required)|not logged in|token (?:expired|invalid)/i.test(message))kind='authentication';
  else if(status===429||/usage limit|quota exceeded|rate limit|usage_limit_reached/i.test(message))kind='quota';
  else if(status>=500||['ECONNRESET','ETIMEDOUT','ENOTFOUND','ECONNREFUSED'].includes(error?.code)||/fetch failed|network error|connection (?:reset|closed)|timed out/i.test(message))kind='connection';
  else kind='unknown';
 }
 const result=new Error(descriptions[kind][0]);
 result.code=Object.keys(codes).find(key=>codes[key]===kind)||'EXECUTION_FAILED';
 result.retryNotBefore=kind==='quota'?retryHint(retryAfter,now):null;
 return result;
}
export function failureInput(error) {
 const kind=codes[error?.code]||codes[runnerError(error).code]||'unknown';
 return {status:kind==='quota'?'waiting_quota':kind==='authentication'?'waiting_connection':'failed',failure:{kind,retryNotBefore:error?.retryNotBefore??null}};
}
export function failureRecord(input,now) {
 const kind=Object.hasOwn(descriptions,input?.failure?.kind)?input.failure.kind:input?.status==='waiting_quota'?'quota':'unknown';
 return {kind,occurredAt:now,retryNotBefore:kind==='quota'?retryHint(input?.failure?.retryNotBefore,Date.parse(now)):null,automaticRetry:false};
}
export function failureGuidance(task) {
 if(!['failed','waiting_quota','waiting_connection','paused'].includes(task?.status))return null;
 const failure=task.checkpoint?.failure;if(!failure||!Object.hasOwn(descriptions,failure.kind))return null;
 return {title:descriptions[failure.kind][0],detail:descriptions[failure.kind][1],retryNotBefore:failure.retryNotBefore??null};
}
