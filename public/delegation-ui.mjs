const ACTIVE_PARENT_STATUSES=new Set(['queued','claimed','running','waiting_children','queued_for_review']);
const TERMINAL_STATUSES=new Set(['cancelled','completed']);

function searchable(task){return `${task?.title||''} ${task?.prompt||''}`.toLocaleLowerCase();}
function confirmationReason(task){
  const marker=task?.checkpoint?.confirmationRequired;
  if(!marker)return '';
  return typeof marker==='object'&&typeof marker.reason==='string'&&marker.reason.trim()?marker.reason.trim():'외부 실행 상태 확인 필요';
}
function activeDelegation(task){return Boolean(task?.delegation)&&!['superseded','cancelled'].includes(task.delegation.state);}

export function childRecoveryState(parent,child){
  const parentEligible=activeDelegation(parent)&&['waiting_children','paused'].includes(parent?.status);
  const pausedLease=child?.status==='paused'&&child?.checkpoint?.interruptedBy==='lease_expiry';
  const blocked=['waiting_quota','waiting_connection'].includes(child?.status)||pausedLease;
  const kind=child?.checkpoint?.failure?.kind||'';
  const marker=confirmationReason(child);
  const ambiguousConnection=child?.status==='waiting_connection'&&!['authentication','unavailable'].includes(kind);
  const requiresConfirmation=Boolean(marker)||['connection','unknown','interrupted'].includes(kind)||pausedLease||ambiguousConnection;
  return {
    eligible:Boolean(parentEligible&&blocked),
    requiresConfirmation,
    reason:requiresConfirmation?(marker||kind||(pausedLease?'lease_expiry':'외부 실행 상태 확인 필요')):'',
    sessionUrl:child?.sessionUrl||child?.checkpoint?.sessionUrl||'',
  };
}

export function executionRecoveryState(task){
  const marker=task?.checkpoint?.confirmationRequired;
  const owned=marker&&typeof marker==='object'&&typeof marker.executionId==='string'&&Number.isInteger(marker.generation);
  return {
    eligible:Boolean(!task?.parentTaskId&&owned&&['waiting_connection','paused'].includes(task?.status)),
    reason:owned&&typeof marker.reason==='string'?marker.reason:'',
    sessionUrl:task?.sessionUrl||task?.checkpoint?.sessionUrl||'',
    executionId:owned?marker.executionId:undefined,
    generation:owned?marker.generation:undefined,
  };
}

export function taskDisplayStatus(task){
  return task?.status==='running'&&task?.delegation?.state==='reviewing'?'reviewing':task?.status;
}

export function delegationStateLabel(state){
  return ({waiting:'하위 작업 대기',waiting_children:'하위 작업 대기',queued_for_review:'검토 대기',reviewing:'결과 검토',completed:'통합 완료',paused:'일시정지',failed:'확인 필요',superseded:'이전 배정 종료',cancelled:'배정 취소'})[state]||state||'배정됨';
}

export function taskListGroups(tasks,query=''){
  const all=Array.isArray(tasks)?tasks:[];
  const byId=new Map(all.map(task=>[task.id,task]));
  const needle=String(query).trim().toLocaleLowerCase();
  const childrenByParent=new Map();
  for(const task of all){
    if(!task?.parentTaskId||!byId.has(task.parentTaskId))continue;
    const grouped=childrenByParent.get(task.parentTaskId)||[];
    grouped.push(task);childrenByParent.set(task.parentTaskId,grouped);
  }
  const roots=all.filter(task=>!task?.parentTaskId||!byId.has(task.parentTaskId));
  return roots.flatMap(task=>{
    const grouped=childrenByParent.get(task.id)||[];
    const childOrder=new Map((task.delegation?.children||[]).map((child,index)=>[child.taskId,index]));
    grouped.sort((a,b)=>(childOrder.get(a.id)??Number.MAX_SAFE_INTEGER)-(childOrder.get(b.id)??Number.MAX_SAFE_INTEGER));
    if(!needle)return [{task,children:grouped}];
    const parentMatches=searchable(task).includes(needle);
    const matchingChildren=grouped.filter(child=>searchable(child).includes(needle));
    return parentMatches||matchingChildren.length?[{task,children:parentMatches?grouped:matchingChildren}]:[];
  });
}

export function delegationPanel(task,tasks=[]){
  if(!task?.delegation)return null;
  const records=new Map((Array.isArray(tasks)?tasks:[]).map(record=>[record.id,record]));
  const reviews=new Map((task.delegation.review?.children||[]).map(review=>[review.taskId,review]));
  return {
    batchId:task.delegation.batchId,
    state:task.delegation.state,
    masterProvider:task.delegation.masterProvider,
    retryCount:Number(task.delegation.retryCount)||0,
    children:(task.delegation.children||[]).map(assignment=>{
      const record=records.get(assignment.taskId)||{};
      const review=reviews.get(assignment.taskId)||{};
      return {
        taskId:assignment.taskId,
        role:assignment.role||record.assignment?.role||'하위 작업',
        provider:assignment.provider||record.assignment?.provider||'',
        requestedModel:assignment.requestedModel||record.assignment?.requestedModel||'',
        effort:assignment.effort||record.assignment?.effort||'',
        sufficientReason:assignment.sufficientReason||record.assignment?.sufficientReason||'',
        acceptanceCriteria:Array.isArray(assignment.acceptanceCriteria)?assignment.acceptanceCriteria:[],
        status:record.status||'queued',
        summary:review.summary||'',
        artifacts:Array.isArray(review.artifacts)?review.artifacts:[],
        confirmationReason:confirmationReason(record),
        version:record.version,
        recovery:childRecoveryState(task,record),
      };
    }),
  };
}

export function taskControlState(task,tasks=[],busy=false){
  const child=Boolean(task?.parentTaskId);
  const active=ACTIVE_PARENT_STATUSES.has(task?.status);
  const terminal=TERMINAL_STATUSES.has(task?.status);
  const confirmationRequired=Boolean(task?.checkpoint?.confirmationRequired);
  const delegated=activeDelegation(task);
  const retryCount=Number(task?.delegation?.retryCount)||0;
  const records=new Map((Array.isArray(tasks)?tasks:[]).map(record=>[record.id,record]));
  const hasFailedChild=Boolean(task?.delegation?.children?.some(childAssignment=>records.get(childAssignment.taskId)?.status==='failed'));
  const hasConfirmationChild=Boolean(task?.delegation?.children?.some(childAssignment=>records.get(childAssignment.taskId)?.checkpoint?.confirmationRequired));
  const paused=delegated&&task?.status==='paused'&&!confirmationRequired;
  const failedRetry=delegated&&!terminal&&hasFailedChild&&retryCount<1;
  const failedReview=delegated&&task?.delegation?.state==='reviewing'&&['failed','waiting_quota','waiting_connection'].includes(task?.status)&&!confirmationRequired;
  return {
    runDisabled:!task||busy||child||(active&&!(task.status==='queued'&&task.attachments?.length))||terminal||delegated||confirmationRequired,
    editPlanDisabled:!task||busy||child||active||terminal||delegated,
    composerDisabled:busy||child||task?.status==='cancelled'||(!delegated&&active),
    resumeVisible:paused||failedRetry||failedReview,
    resumeLabel:failedReview?'결과 검토 다시 실행':paused?'완료 결과 유지하고 재개':failedRetry?'실패 작업만 다시 실행':'',
    resumeDisabled:Boolean(busy)||hasConfirmationChild,
  };
}
