import {consumeLocalRecoveryToken,createLocalRecoveryRequest,createLocalRecovery} from './core/local-recovery.mjs';

const phaseNames={
  missing:'파일 없음',pending:'전달 대기',ack_pending:'전달 확인 대기',
  legacy:'이전 형식 · 자동 처리 불가',invalid:'파일 확인 불가',
  oversize:'허용 크기 초과',unsafe_file:'안전하게 읽을 수 없음'
};
const yesNo=value=>value?'예':'아니요';
const el=(document,id)=>document.getElementById(id);
function facts(document,node,rows){
  node.replaceChildren();
  for(const [label,value] of rows){
    const dt=document.createElement('dt'),dd=document.createElement('dd');
    dt.textContent=label;dd.textContent=String(value);
    node.append(dt,dd);
  }
}
function fileRows(meta){
  if(!meta)return [['상태','상태 확인 전']];
  const rows=[['상태',phaseNames[meta.phase]],['크기',meta.exists?meta.bytes.toLocaleString('ko-KR')+' 바이트':'—']];
  if(meta.sha256)rows.push(['SHA-256',meta.sha256]);
  if(meta.binding)rows.push(['연결 주소',meta.binding.origin],['작업실 ID',meta.binding.workspaceId]);
  if(meta.owner)rows.push(['작업 ID',meta.owner.taskId],['실행 ID',meta.owner.executionId],['세대',meta.owner.generation],['작업',meta.owner.action==='complete'?'완료':'실패']);
  return rows;
}
export function mountLocalRecoveryPage({document,location,history,requestFactory=createLocalRecoveryRequest}){
  const token=consumeLocalRecoveryToken({location,history});
  const refresh=el(document,'refresh'),message=el(document,'message'),error=el(document,'error');
  const runtime=el(document,'runtime'),pending=el(document,'pending'),temporary=el(document,'temporary');
  const promoteConfirm=el(document,'confirm-promote'),drainConfirm=el(document,'confirm-drain');
  const promote=el(document,'promote'),drain=el(document,'drain');
  let controller;
  function staticNotice(value){
    message.textContent=value;
    facts(document,runtime,[['연결','요청하지 않음']]);
    facts(document,pending,fileRows(null));facts(document,temporary,fileRows(null));
    refresh.disabled=true;
  }
  const origin=location.origin;
  let safeOrigin=false;
  try{const url=new URL(origin);safeOrigin=url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);}catch{}
  if(!safeOrigin||!token){
    staticNotice(!safeOrigin?'이 페이지는 이 기기의 로컬 주소에서만 사용할 수 있습니다.':'접속 정보가 없습니다. 개인용 데스크톱 링크를 다시 여세요.');
    return {dispose(){}};
  }
  function render(state){
    const local=state.status?.localDesktop;
    const ready=!!(state.snapshot&&!state.busy&&!local?.busy&&!local?.stopped);
    const enabled=ready&&state.status.capabilities.desktopOutboxRecovery;
    const temp=state.snapshot?.temporary,pendingMeta=state.snapshot?.pending;
    const canConfirmPromote=!!(enabled&&state.status.capabilities.desktopOutboxRecovery&&state.snapshot.canPromote&&['pending','ack_pending'].includes(temp?.phase));
    const canConfirmDrain=!!(enabled&&state.status.capabilities.desktopOutboxDrain&&temp?.phase==='missing'&&['pending','ack_pending'].includes(pendingMeta?.phase));
    refresh.disabled=state.busy;
    promoteConfirm.disabled=!canConfirmPromote;
    drainConfirm.disabled=!canConfirmDrain;
    promoteConfirm.checked=!!state.confirmPromote&&canConfirmPromote;
    drainConfirm.checked=!!state.confirmDrain&&canConfirmDrain;
    promote.disabled=!state.canPromote;
    drain.disabled=!state.canDrain;
    message.textContent=state.busy?'상태를 확인하거나 요청을 처리하고 있습니다…':state.notice||(!state.status?'상태를 확인하려면 버튼을 누르세요.':!state.status.capabilities.desktopOutboxRecovery?'이 연결에서는 로컬 복구를 사용할 수 없습니다.':local.stopped?'로컬 실행기가 종료되었습니다. 상태를 다시 확인해 주세요.':local.busy?'로컬 작업이 실행 중입니다. 작업이 끝난 뒤 다시 확인해 주세요.':state.snapshot?'현재 저장 상태를 확인했습니다. 필요한 작업을 직접 선택하세요.':'저장 상태를 확인하지 않았습니다.');
    error.textContent=state.error;
    facts(document,runtime,local?[
      ['로컬 실행기',local.stopped?'종료됨':local.busy?'작업 중':local.recoveryPaused?'일시 중지됨':'연결됨'],
      ['복구 사용',state.status.capabilities.desktopOutboxRecovery?'사용 가능':'사용 불가'],
      ['저장 결과',state.snapshot?'검사 완료':'아직 검사하지 않음'],
      ['복구 일시 중지',local.recoveryPaused===undefined?'표시되지 않음':yesNo(local.recoveryPaused)],
      ['전달 안전 상태',local.deliveryUnsafe===undefined?'표시되지 않음':local.deliveryUnsafe?'확인 필요':'정상']
    ]:[['연결','상태 확인 전']]);
    facts(document,pending,fileRows(state.snapshot?.pending));
    facts(document,temporary,fileRows(state.snapshot?.temporary));
  }
  try{
    controller=createLocalRecovery({request:requestFactory({origin,token}),onChange:render});
  }catch{
    staticNotice('접속 정보를 확인할 수 없습니다. 개인용 데스크톱 링크를 다시 여세요.');
    return {dispose(){}};
  }
  render(controller.getState());
  refresh.addEventListener('click',()=>{void controller.refresh();});
  promoteConfirm.addEventListener('change',()=>controller.setConfirmation('promote',promoteConfirm.checked));
  drainConfirm.addEventListener('change',()=>controller.setConfirmation('drain',drainConfirm.checked));
  promote.addEventListener('click',async()=>{await controller.promote();refresh.focus();});
  drain.addEventListener('click',async()=>{await controller.drain();refresh.focus();});
  return controller;
}
if(typeof document!=='undefined')mountLocalRecoveryPage({document,location,history});
