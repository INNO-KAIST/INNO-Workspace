import {formatDateTime} from './core/time-format.mjs';
const reservationFields=['version','workspaceId','taskId','executionId','generation','claimedAt'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validReservation=(value,workspaceId,taskId)=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==reservationFields.length||reservationFields.some(field=>!Object.hasOwn(value,field)))return false;
 const claimed=Date.parse(value.claimedAt);
 return value.version===1&&value.workspaceId===workspaceId&&uuid.test(value.workspaceId)&&value.taskId===taskId&&typeof value.executionId==='string'&&!!value.executionId.trim()&&value.executionId.length<=200&&Number.isSafeInteger(value.generation)&&value.generation>0&&Number.isFinite(claimed)&&new Date(claimed).toISOString()===value.claimedAt;
};
const sameReservation=(a,b)=>a&&b&&reservationFields.every(field=>a[field]===b[field])&&Object.keys(b).length===reservationFields.length;
const statusNames={ready:'대기',queued:'대기',claimed:'실행 준비',running:'진행 중',paused:'일시정지',waiting_user:'결정 대기',waiting_quota:'한도 대기',waiting_connection:'연결 대기',failed:'실패',cancelled:'취소',completed:'완료'};
export function deliveryDiscardBlocker(task,localDesktop){
 if(!task)return '작업을 확인할 수 없습니다.';
 if(task.status==='running')return '진행 중인 작업의 예약은 폐기할 수 없습니다.';
 if(localDesktop?.pending)return '이 PC에 미전달 결과가 남아 있습니다. 먼저 기존 결과를 전달하거나 복구하세요.';
 if(localDesktop?.busy)return '이 PC에서 실행 또는 정리가 진행 중입니다.';
 if(localDesktop?.stopped)return '이 PC의 데스크톱 연결이 중지됐습니다.';
 if(localDesktop?.deliveryUnsafe)return '이 PC의 결과 전달 상태를 확인할 수 없습니다.';
 return '';
}

export function createDeliveryRecoveryUI({dialog,getClient,getState,getTask,getEpoch=()=>0,onChange=()=>{}}){
 const fields=Object.fromEntries(['list','status','selected','error','notice','next','refresh','discard','stopped','no-results'].map(name=>[name,dialog.querySelector(`[data-recovery-${name}]`)]));
 let generation=0,opened=null,busy=false,reservations=[],nextAfterKey=null,workspaceId=null,selectedIndex=null,renderedRows=[],buttons=[];
 const task=()=>getTask();
 const same=(captured)=>{
  const selected=task(),state=getState(),client=getClient();
  return Boolean(dialog.open&&opened&&captured.generation===generation&&captured.client===client&&captured.taskId===selected?.id&&captured.epoch===getEpoch()&&client?.remote&&state?.capabilities?.desktopDeliveryRecovery===true);
 };
 const current=captured=>same(captured)&&task()?.version===captured.version;
 const token=()=>opened&&{...opened,generation};
 const resetChecks=()=>{fields.stopped.checked=false;fields['no-results'].checked=false;};
 const resetSelection=()=>{selectedIndex=null;resetChecks();};
 const setError=value=>{fields.error.textContent=value||'';};
 const setNotice=value=>{fields.notice.textContent=value||'';};
 const blocked=()=>deliveryDiscardBlocker(task(),getState()?.localDesktop);
 const render=()=>{
  if(!dialog.open)return;
  const selected=task(),block=blocked();
  fields.status.textContent=`현재 작업: ${statusNames[selected?.status]||selected?.status||'상태 미확인'} · 버전 ${selected?.version??'미확인'}${block?' · '+block:''}`;
  if(renderedRows.length!==reservations.length||renderedRows.some((item,index)=>item!==reservations[index])){
   const doc=dialog.ownerDocument;buttons=reservations.map((reservation,index)=>{
    const button=doc.createElement('button');button.type='button';button.className='secondary-button';button.dataset.recoveryAction='select';button.dataset.recoveryIndex=String(index);
    button.textContent=`실행 ${reservation.executionId} · 세대 ${reservation.generation} · 시작 ${formatDateTime(reservation.claimedAt)}`;button.title=reservation.claimedAt;return button;
   });
   fields.list.replaceChildren(...buttons);renderedRows=reservations.slice();
  }
  buttons.forEach((button,index)=>{button.disabled=busy;button.setAttribute?.('aria-pressed',index===selectedIndex?'true':'false');});
  fields.selected.textContent=selectedIndex===null?'폐기할 예약을 선택하세요.':`선택한 실행: ${reservations[selectedIndex].executionId} · 세대 ${reservations[selectedIndex].generation}`;
  fields.next.hidden=!nextAfterKey;fields.next.disabled=busy;
  fields.refresh.disabled=busy;
  fields.stopped.disabled=busy||selectedIndex===null;fields['no-results'].disabled=busy||selectedIndex===null;
  fields.discard.disabled=busy||selectedIndex===null||!fields.stopped.checked||!fields['no-results'].checked||Boolean(block);
 };
 const clearList=()=>{reservations=[];nextAfterKey=null;workspaceId=null;resetSelection();renderedRows=[];buttons=[];fields.list.replaceChildren();};
 const invalidateVersion=()=>{generation++;busy=false;opened={...opened,version:task().version};clearList();setError('');setNotice('작업 버전이 바뀌었습니다. 최신 예약을 다시 조회하고 확인해 주세요.');render();};
 const close=()=>{generation++;opened=null;busy=false;clearList();setError('');setNotice('');if(dialog.open)dialog.close();};
 const sync=()=>{
  if(!opened)return;
  const captured=token();
  if(!same(captured)){close();return;}
  if(task().version!==opened.version){invalidateVersion();return;}
  render();
 };
 const readPage=async(afterKey=null)=>{
  const captured=token();if(!captured||!current(captured)||busy)return;
  busy=true;setError('');setNotice('');resetSelection();render();
  try{
   const response=await captured.client.readDeliveryReservations(captured.taskId,{expectedVersion:captured.version,...(afterKey?{afterKey}:{})},workspaceId??undefined,{isCurrent:()=>current(captured)});
   if(!current(captured)){sync();return;}
   if(response?.taskVersion!==captured.version||typeof response.workspaceId!=='string'||workspaceId&&response.workspaceId!==workspaceId||!Array.isArray(response.reservations)||response.reservations.length>50||response.reservations.some(row=>!validReservation(row,response.workspaceId,captured.taskId))){
    clearList();setError('예약 목록이 현재 작업 또는 작업공간과 일치하지 않습니다. 최신 상태를 다시 확인해 주세요.');return;
   }
   if(!afterKey)reservations=[];
   reservations.push(...response.reservations);nextAfterKey=typeof response.nextAfterKey==='string'&&response.nextAfterKey?response.nextAfterKey:null;workspaceId=response.workspaceId;
   if(!reservations.length)setNotice('남은 예약이 없습니다. 다른 기기의 미전달 결과가 없다는 증거는 아닙니다.');
  }catch(error){if(current(captured))setError(error.message||'예약 목록 조회에 실패했습니다.');else sync();}
  finally{if(current(captured)){busy=false;render();}}
 };
 const discard=async()=>{
  const captured=token(),reservation=reservations[selectedIndex];
  if(!captured||!current(captured)||busy||!reservation||blocked()||!fields.stopped.checked||!fields['no-results'].checked)return;
  busy=true;render();setError('');setNotice('');
  const isCurrent=()=>current(captured)&&!blocked()&&reservations[selectedIndex]===reservation&&fields.stopped.checked&&fields['no-results'].checked;
  try{
   const result=await captured.client.discardDeliveryReservation(captured.taskId,{reservation,expectedVersion:captured.version,confirmDiscard:true},{isCurrent});
   if(!current(captured)){sync();return;}
   resetSelection();
   if(!sameReservation(reservation,result?.reservation))throw Error('폐기 응답의 예약이 선택한 실행과 일치하지 않습니다. 최신 상태를 다시 조회하세요.');
   if(result.released===true){reservations=reservations.filter(item=>item!==reservation);setNotice('선택한 예약을 폐기했습니다. 이후 도착하는 해당 실행의 결과는 서버에서 수락할 수 없습니다.');try{await onChange();}catch{/* confirmed release remains confirmed; app refresh can be retried separately. */}}
   else if(result.released===false&&result.reason==='reservation_not_found'){clearList();setNotice('예약을 찾지 못했습니다. 수락 여부나 폐기 완료를 뜻하지 않습니다. 최신 예약을 다시 조회하세요.');}
   else throw Error('폐기 응답을 확인하지 못했습니다. 자동 재시도하지 않고 최신 상태를 다시 조회하세요.');
  }catch(error){if(current(captured)){resetSelection();setError(error.status===409?'예약 또는 작업이 바뀌었습니다. 최신 상태를 다시 조회하고 확인해 주세요.':error.message||'폐기 응답을 확인하지 못했습니다. 자동 재시도하지 않고 최신 상태를 다시 조회하세요.');}else sync();}
  finally{if(current(captured)){busy=false;render();}}
 };
 dialog.addEventListener('close',()=>{if(!dialog.open)close();});
 dialog.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-recovery-action]');if(!button||busy)return;
  const action=button.dataset.recoveryAction;
  if(action==='refresh')return readPage();
  if(action==='next')return nextAfterKey?readPage(nextAfterKey):undefined;
  if(action==='discard')return discard();
  if(action==='select'){
   const index=Number(button.dataset.recoveryIndex);if(!Number.isSafeInteger(index)||index<0||index>=reservations.length)return;
   selectedIndex=index;resetChecks();setError('');setNotice('');render();
  }
 });
 fields.stopped.addEventListener('change',render);fields['no-results'].addEventListener('change',render);
 return {close,sync,async open(){
  close();const client=getClient(),selected=task(),state=getState();
  if(!client?.remote||state?.capabilities?.desktopDeliveryRecovery!==true||!selected)return;
  opened={client,taskId:selected.id,version:selected.version,epoch:getEpoch()};
  dialog.showModal();fields.status.textContent='예약을 확인하는 중입니다.';setError('');setNotice('');
  await readPage();
 }};
}
