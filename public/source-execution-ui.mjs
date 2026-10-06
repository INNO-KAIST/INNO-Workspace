import {sourceExecutionReadiness} from './source-execution.mjs';
import {mergeConnectedAttachments} from './source-views-ui.mjs';

export function matchesStoredSource(stored,connected){
 return Boolean(stored&&connected&&['id','name','path','size','lastModified','type','source'].every(key=>stored[key]===connected[key]));
}

export function sourceReconnectLocked(task){
 return Boolean(task?.parentTaskId||(task?.delegation&&!['superseded','cancelled'].includes(task.delegation.state)));
}

export function reconcileSourceSelection(task,incoming){
 const existing=task?.attachments||[];
 if(!sourceReconnectLocked(task))return {locked:false,attachments:mergeConnectedAttachments(existing,incoming),matched:incoming||[],unmatched:[]};
 const byId=new Map(existing.map(a=>[a.id,a]));
 const matched=(incoming||[]).filter(a=>matchesStoredSource(byId.get(a.id),a));
 const unmatched=(incoming||[]).filter(a=>!matchesStoredSource(byId.get(a.id),a));
 return {locked:true,attachments:existing,matched,unmatched};
}

export function createSourcePickFence(getContext){
 return {capture:()=>({...getContext()}),isCurrent:token=>{
  const now=getContext();return Boolean(token)&&token.taskId===now.taskId&&token.client===now.client&&token.epoch===now.epoch;
 }};
}

export async function collectDirectoryFiles(handle,isCurrent){
 if(!handle||handle.kind!=='directory'||typeof handle.values!=='function')throw new Error('폴더를 읽을 수 없습니다.');
 const files=[];
 async function visit(directory,path){
  for await(const entry of directory.values()){
   if(!isCurrent())return;
   if(entry?.kind==='directory'){await visit(entry,`${path}/${entry.name}`);continue;}
   if(entry?.kind!=='file'||typeof entry.getFile!=='function')continue;
   const file=await entry.getFile();
   if(!isCurrent())return;
   Object.defineProperty(file,'webkitRelativePath',{value:`${path}/${entry.name}`,configurable:true});
   files.push(file);
  }
 }
 await visit(handle,handle.name);
 return isCurrent()?files:[];
}

export function sourceExecutionRows(selected,state,connected,attempts=[]){
 if(!selected)return [];
 const tasks=state?.tasks||[];
 const relevant=selected.parentTaskId?[selected]:[
  ...tasks.filter(t=>selected.status==='waiting_children'&&t.parentTaskId===selected.id&&t.status==='queued'&&t.attachments?.some(a=>a.source!=='url')),
  ...(selected.status==='queued_for_review'&&selected.attachments?.some(a=>a.source!=='url')?[selected]:[]),
 ];
 return relevant.filter(t=>t.attachments?.some(a=>a.source!=='url')&&(t.parentTaskId?t.status==='queued':t.status==='queued_for_review')).map(task=>{
  const assignment=task.parentTaskId?selected.parentTaskId?tasks.find(t=>t.id===task.parentTaskId)?.delegation?.children?.find(a=>a.taskId===task.id):selected.delegation?.children?.find(a=>a.taskId===task.id):null;
  const provider=assignment?.provider||task.assignment?.provider||task.delegation?.masterProvider||'';
  const model=assignment?.requestedModel||task.assignment?.requestedModel||'서버에서 선택';
  const missing=task.attachments.filter(a=>a.source!=='url'&&!connected(a));
  const attempt=attempts.find(a=>a.taskId===task.id);
  return {taskId:task.id,role:assignment?.role||task.assignment?.role||(task.parentTaskId?'하위 작업':'마스터 검토'),provider,model,status:task.status,attachments:task.attachments,missing,attempt,readiness:sourceExecutionReadiness(task,state,connected),recoverable:['uncertain','submitted'].includes(attempt?.status)};
 });
}

export function sourceExecutionMessage(row){
 if(row.attempt?.status==='uncertain')return '실행 시작 여부를 확인할 수 없습니다. 이전 실행이 끝났는지 확인한 뒤 작업을 복구하고, 아래 버튼으로 다시 확인하세요.';
 if(row.attempt?.status==='submitted')return '실행 요청을 보냈습니다. 서버의 진행 상태를 확인하세요. 다시 시도해야 한다면 이전 실행 종료를 확인하고 작업을 복구한 뒤 아래 버튼으로 다시 확인하세요.';
 if(row.attempt?.status==='source_error')return '원본 읽기 또는 저장된 부분 조회 해시 확인에 실패했습니다. 같은 파일을 다시 연결하세요. 선택 범위의 내용이 달라졌다면 원래 파일을 찾거나 부모 작업을 다시 계획해야 합니다.';
 if(row.missing.length)return `${row.missing.length}개 원본을 다시 연결하세요. 저장된 배정과 조회 범위는 유지됩니다.`;
 return ({unsupported:'서버가 원본 기반 위임을 지원하지 않습니다. 기능을 활성화할 때까지 실행하지 않습니다.',provider_unavailable:'배정된 제공자 또는 데스크톱 연결을 사용할 수 없습니다.',provider_disabled:'배정된 실행기가 사용 중지 상태입니다. 연결 앱의 AI 실행기에서 다시 켜면 이어서 실행합니다.',desktop_waiting:'데스크톱 실행기가 다른 작업을 처리 중입니다.',claude_sibling_running:'같은 작업의 다른 Claude 하위 작업이 끝나면 이어서 실행합니다(Claude 하위 작업은 한 번에 하나씩 실행).',parent_changed:'부모 작업의 배정 또는 상태가 바뀌어 실행하지 않습니다.',ineligible:'현재 실행 대기 상태가 아닙니다.'})[row.readiness.reason]||'연결된 원본으로 실행 대기 중입니다.';
}
