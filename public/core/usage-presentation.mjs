const unknown='확인 불가';
const phases={master:'마스터',child:'하위 작업',review:'검토'};
const transitions={delegation:'위임',handoff:'인계',retry:'재시도',decision:'결정 대기',failure:'실패',completion:'완료'};
const verified=row=>row?.phaseSource==='server_state';

export const formatUsagePhase=row=>verified(row)&&Object.hasOwn(phases,row.phase)?phases[row.phase]:unknown;
export const formatUsageTransition=row=>verified(row)&&Object.hasOwn(transitions,row.transition)?transitions[row.transition]:unknown;
export const formatRequestedModel=row=>verified(row)&&typeof row.requestedModel==='string'&&row.requestedModel?row.requestedModel:unknown;

export function formatWallElapsed(row){
 const value=row?.wallElapsedMs;
 if(!verified(row)||!Number.isSafeInteger(value)||value<0)return unknown;
 if(value===0)return '0밀리초';
 let remaining=value;
 const parts=[];
 for(const [unit,size] of [['일',86400000],['시간',3600000],['분',60000],['초',1000],['밀리초',1]]){
  const amount=Math.floor(remaining/size);
  remaining%=size;
  if(amount)parts.push(`${amount}${unit}`);
 }
 return parts.join(' ');
}
