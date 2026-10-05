const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{24,512}$/;
const fail=()=>Error('로컬 복구 요청을 확인할 수 없습니다. 상태를 새로 확인해 주세요.');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const boolean=value=>{if(typeof value!=='boolean')throw fail();return value;};
const id=value=>{if(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u001f\u007f]/.test(value))throw fail();return value;};
const clone=value=>JSON.parse(JSON.stringify(value));
function originValue(value,localOnly=false){
 if(typeof value!=='string')throw fail();
 let url;try{url=new URL(value);}catch{throw fail();}
 const loopback=['localhost','127.0.0.1'].includes(url.hostname);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||value!==url.origin&&value!==url.origin+'/'||localOnly&&(url.protocol!=='http:'||!loopback)||!localOnly&&url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw fail();
 return url.origin;
}
const routes={status:'/api/desktop/status',inspect:'/api/desktop/recovery',promote:'/api/desktop/recovery/promote',drain:'/api/desktop/recovery/drain',legacyStatus:'/api/desktop/recovery/legacy-status',legacyDeliver:'/api/desktop/recovery/legacy-deliver',legacyArchive:'/api/desktop/recovery/legacy-archive'};
const LEGACY_STATES=['deliverable','already_applied','owner_replaced','not_running','receipt_required','task_missing','binding_unverified'];
export function createLocalRecoveryRequest({origin,token,fetchImpl=fetch,timeoutMs=20000}){
 const base=originValue(origin,true);
 if(typeof token!=='string'||!TOKEN.test(token)||typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw fail();
 return async(action,input)=>{
  if(typeof action!=='string'||!Object.hasOwn(routes,action)||['status','inspect'].includes(action)&&input!==undefined)throw fail();
  const controller=new AbortController();let timer;
  try{
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail());},timeoutMs);});
   const work=(async()=>{
    const read=action==='status'||action==='inspect';
    const response=await fetchImpl(base+routes[action],{method:read?'GET':'POST',headers:{Authorization:'Bearer '+token,...(!read?{'Content-Type':'application/json'}:{})},body:read?undefined:JSON.stringify(input),signal:controller.signal,cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',credentials:'omit'});
    if(!response.ok)throw fail();
    return await response.json();
   })();
   return await Promise.race([work,timeout]);
  }catch{throw fail();}finally{clearTimeout(timer);}
 };
}
export function consumeLocalRecoveryToken({location,history}){
 const fragment=location.hash;
 try{history.replaceState(null,'',location.pathname+location.search);}catch{return '';}
 try{const params=new URLSearchParams(fragment.startsWith('#')?fragment.slice(1):fragment),values=params.getAll('token');return values.length===1&&TOKEN.test(values[0])?values[0]:'';}catch{return '';}
}
function runtime(value){
 if(!object(value)||![0,1].includes(value.sourceDelegationVersion))throw fail();
 return {busy:boolean(value.busy),stopped:boolean(value.stopped),...(value.deliveryUnsafe!==undefined?{deliveryUnsafe:boolean(value.deliveryUnsafe)}:{}),...(value.recoveryPaused!==undefined?{recoveryPaused:boolean(value.recoveryPaused)}:{}),sourceDelegationVersion:value.sourceDelegationVersion};
}
function checkedStatus(value){
 if(!object(value)||value.outboxStatus!=='not_inspected'||!object(value.capabilities))throw fail();
 return {localDesktop:runtime(value.localDesktop),outboxStatus:'not_inspected',capabilities:{desktopOutboxRecovery:boolean(value.capabilities.desktopOutboxRecovery),desktopOutboxDrain:boolean(value.capabilities.desktopOutboxDrain),desktopLegacyRecovery:value.capabilities.desktopLegacyRecovery===undefined?false:boolean(value.capabilities.desktopLegacyRecovery)}};
}
function checkedBinding(value){
 if(!object(value)||typeof value.workspaceId!=='string'||!UUID.test(value.workspaceId))throw fail();
 return {origin:originValue(value.origin),workspaceId:value.workspaceId};
}
function checkedOwner(value){
 if(!object(value)||!Number.isSafeInteger(value.generation)||value.generation<1||!['complete','fail'].includes(value.action))throw fail();
 return {taskId:id(value.taskId),executionId:id(value.executionId),generation:value.generation,action:value.action};
}
function metadata(value){
 if(!object(value)||!Number.isSafeInteger(value.bytes)||value.bytes<0||!['missing','pending','ack_pending','legacy','invalid','oversize','unsafe_file'].includes(value.phase))throw fail();
 const result={exists:boolean(value.exists),bytes:value.bytes,sha256:value.sha256,phase:value.phase};
 if(value.phase==='missing'){
  if(value.exists||value.bytes!==0||value.sha256!==null||value.binding!==undefined||value.owner!==undefined)throw fail();return result;
 }
 if(!value.exists)throw fail();
 if(['unsafe_file','oversize'].includes(value.phase)){
  if(value.sha256!==null||value.binding!==undefined||value.owner!==undefined)throw fail();return result;
 }
 if(value.bytes>1024*1024||typeof value.sha256!=='string'||!HEX.test(value.sha256))throw fail();
 if(value.phase==='invalid'){
  if(value.binding!==undefined||value.owner!==undefined)throw fail();return result;
 }
 result.owner=checkedOwner(value.owner);
 if(value.phase!=='legacy'||value.binding!==undefined)result.binding=checkedBinding(value.binding);
 return result;
}
function checkedSnapshot(value){
 if(!object(value))throw fail();
 return {pending:metadata(value.pending),temporary:metadata(value.temporary),canPromote:boolean(value.canPromote)};
}
const valid=meta=>['pending','ack_pending'].includes(meta?.phase);
export function createLocalRecovery({request,onChange=()=>{}}){
 if(typeof request!=='function'||typeof onChange!=='function')throw fail();
 let disposed=false,generation=0;
 const state={busy:false,status:null,snapshot:null,notice:'',error:'',confirmPromote:false,confirmDrain:false,canPromote:false,canDrain:false,legacy:null,confirmLegacyDeliver:false,confirmLegacyArchive:false,canCheckLegacy:false,canDeliverLegacy:false,canArchiveLegacy:false};
 function derive(){
  const ready=!disposed&&!state.busy&&state.status&&!state.status.localDesktop.busy&&!state.status.localDesktop.stopped&&state.snapshot,p=state.snapshot?.pending,t=state.snapshot?.temporary;
  const compatible=valid(t)&&(p.phase==='missing'?t.phase==='pending':valid(p)&&p.binding.origin===t.binding.origin&&p.binding.workspaceId===t.binding.workspaceId&&!(p.phase==='ack_pending'&&t.phase==='pending'));
  state.canPromote=!!(ready&&state.status.capabilities.desktopOutboxRecovery&&state.snapshot.canPromote&&compatible&&state.confirmPromote);
  state.canDrain=!!(ready&&state.status.capabilities.desktopOutboxDrain&&t.phase==='missing'&&valid(p)&&state.confirmDrain);
  // A legacy (receipt-less) result is only delivered or archived after a fresh Worker check.
  const legacyReady=!!(ready&&state.status.capabilities.desktopLegacyRecovery&&t?.phase==='missing'&&p?.phase==='legacy');
  state.canCheckLegacy=legacyReady;
  state.canDeliverLegacy=!!(legacyReady&&['deliverable','already_applied'].includes(state.legacy?.state)&&state.confirmLegacyDeliver);
  state.canArchiveLegacy=!!(legacyReady&&state.legacy&&(state.legacy.state!=='deliverable'||state.legacy.refused)&&state.confirmLegacyArchive);
 }
 const getState=()=>{derive();return clone(state);};
 function emit(){derive();if(disposed)return;try{const result=onChange(getState());result?.catch?.(()=>{});}catch{}}
 function invalidate(){state.snapshot=null;state.confirmPromote=false;state.confirmDrain=false;state.legacy=null;state.confirmLegacyDeliver=false;state.confirmLegacyArchive=false;state.notice='';state.error='';}
 async function operation(work){
  if(disposed||state.busy)return false;
  const current=++generation;invalidate();state.busy=true;emit();
  const active=()=>!disposed&&current===generation;
  try{if(!active())return false;await work(active);return active();}
  catch{if(active()){invalidate();state.error='로컬 복구 요청을 확인할 수 없습니다. 상태를 새로 확인해 주세요.';}return false;}
  finally{if(active()){state.busy=false;emit();}}
 }
 return {
  getState,
  async refresh(){
   return operation(async active=>{
    state.status=null;
    const response=await request('status');if(!active())return;
    state.status=checkedStatus(response);
    if(!state.status.capabilities.desktopOutboxRecovery){state.notice='이 연결에서는 로컬 복구 기능이 활성화되어 있지 않습니다.';return;}
    if(state.status.localDesktop.busy||state.status.localDesktop.stopped){state.notice=state.status.localDesktop.stopped?'로컬 실행기가 종료되었습니다. 상태를 다시 확인해 주세요.':'로컬 작업이 실행 중입니다. 작업이 끝난 뒤 상태를 다시 확인해 주세요.';return;}
    const result=await request('inspect');if(!active())return;
    const inspected=runtime(result?.localDesktop),previous=state.status.localDesktop;
    state.status.localDesktop={...inspected,busy:previous.busy||inspected.busy,stopped:previous.stopped||inspected.stopped};
    state.snapshot=checkedSnapshot(result?.recovery);
   });
  },
  setConfirmation(action,value){
   const field={promote:'confirmPromote',drain:'confirmDrain',legacyDeliver:'confirmLegacyDeliver',legacyArchive:'confirmLegacyArchive'}[action];
   if(disposed||state.busy||!field||typeof value!=='boolean')return false;
   state[field]=value;emit();return true;
  },
  async checkLegacy(){
   derive();if(!state.canCheckLegacy)return false;
   const pendingHash=state.snapshot.pending.sha256;
   return operation(async active=>{
    state.status=checkedStatus(await request('status'));if(!active())return;
    const result=await request('inspect');if(!active())return;
    const snapshot=checkedSnapshot(result?.recovery);
    if(snapshot.pending.phase!=='legacy'||snapshot.pending.sha256!==pendingHash||snapshot.temporary.phase!=='missing')throw fail();
    state.status.localDesktop=runtime(result?.localDesktop);
    const reply=await request('legacyStatus',{pendingHash});if(!active())return;
    if(!object(reply)||!LEGACY_STATES.includes(reply.state)||Object.keys(reply).some(key=>!['state','refused'].includes(key))||reply.refused!==undefined&&reply.refused!==true)throw fail();
    state.snapshot=snapshot;state.legacy={state:reply.state,...(reply.refused?{refused:true}:{})};
   });
  },
  async deliverLegacy(){
   derive();if(!state.canDeliverLegacy)return false;
   const input={pendingHash:state.snapshot.pending.sha256,confirm:true};
   return operation(async active=>{
    const result=await request('legacyDeliver',input);if(!active())return;
    if(object(result)&&Object.keys(result).length===2&&result.delivered===false&&result.refused===true){
     state.notice='클라우드가 이 이전 형식 결과를 거절했습니다. 파일은 그대로 있습니다. 적용하지 않고 보관하려면 상태와 클라우드 상태를 다시 확인한 뒤 보관을 선택하세요. 자동 실행은 재개되지 않습니다.';return;
    }
    if(!object(result)||Object.keys(result).length!==2||result.delivered!==true||!['deliverable','already_applied'].includes(result.state))throw fail();
    state.notice='이전 형식 결과를 전달했습니다. 자동 실행은 재개되지 않습니다.';
   });
  },
  async archiveLegacy(){
   derive();if(!state.canArchiveLegacy)return false;
   const input={pendingHash:state.snapshot.pending.sha256,confirm:true,...(state.legacy.state==='deliverable'&&state.legacy.refused?{afterRefusal:true}:{})};
   return operation(async active=>{
    const result=await request('legacyArchive',input);if(!active())return;
    if(!object(result)||result.archived!==true||typeof result.archive!=='string'||!/^[A-Za-z0-9._-]{1,200}$/.test(result.archive)||result.recoveryLockUncertain!==undefined&&typeof result.recoveryLockUncertain!=='boolean'||Object.keys(result).some(key=>!['archived','archive','recoveryLockUncertain'].includes(key)))throw fail();
    state.notice=`이전 형식 결과를 같은 폴더의 ${result.archive} 파일로 보관했습니다.${result.recoveryLockUncertain?' 복구 잠금 상태를 확인할 수 없습니다.':''} 자동 실행은 재개되지 않습니다.`;
   });
  },
  async promote(){
   derive();if(!state.canPromote)return false;
   const temporary=state.snapshot.temporary,input={pendingHash:state.snapshot.pending.sha256,temporaryHash:temporary.sha256,confirm:true},expected={phase:temporary.phase,sha256:temporary.sha256};
   return operation(async active=>{
    const result=await request('promote',input);if(!active())return;
    if(!object(result)||result.promoted!==true||result.phase!==expected.phase||result.sha256!==expected.sha256||result.recoveryLockUncertain!==undefined&&typeof result.recoveryLockUncertain!=='boolean')throw fail();
    state.notice=result.recoveryLockUncertain?'임시 파일은 반영되었지만 복구 잠금 상태를 확인할 수 없습니다. 자동 실행은 재개되지 않습니다.':'임시 파일을 반영했습니다. 다음 작업 전에 상태를 다시 확인하세요. 자동 실행은 재개되지 않습니다.';
   });
  },
  async drain(){
   derive();if(!state.canDrain)return false;
   const input={pendingHash:state.snapshot.pending.sha256,confirm:true};
   return operation(async active=>{
    const result=await request('drain',input);if(!active())return;
    if(!object(result)||result.drained!==true)throw fail();
    state.notice='저장 결과를 전달했습니다. 자동 실행은 재개되지 않습니다.';
   });
  },
  dispose(){disposed=true;generation++;invalidate();state.busy=false;state.status=null;derive();}
 };
}
