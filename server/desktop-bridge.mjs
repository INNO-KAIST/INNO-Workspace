import {usageCounts} from '../public/core/execution-usage.mjs';
import {failureInput,runnerError} from '../public/core/failures.mjs';
import {sanitizeMaterials} from '../public/core/tasks.mjs';
export function createDesktopBridge({request,runner,outbox,heartbeatMs=15000,beforeClaim=async()=>{},onError=()=>{}}){
 let busy=false,stopped=false,controller,background=Promise.resolve();
 async function deliver(record){await request(`/api/desktop/${encodeURIComponent(record.taskId)}/${record.action}`,record.input);outbox.clear();}
 async function modelSnapshot(){return typeof runner.models==='function'?await runner.models():undefined;}
 async function execute(claim,materials=[],models){
  const {task,executionId,generation}=claim,owner={executionId,generation};controller=new AbortController();
  let monitorError,renewal=null;
  const timer=setInterval(()=>{if(renewal)return;renewal=request(`/api/desktop/${encodeURIComponent(task.id)}/renew`,owner).catch(e=>{monitorError=e;controller.abort();}).finally(()=>{renewal=null;});},heartbeatMs);
  let result,runError;
  try{result=await runner.run({task,...owner,materials,reviewInputs:claim.reviewInputs,sourceDelegationVersion:runner.sourceDelegationVersion===1&&claim.sourceDelegationVersion===1?1:0,signal:controller.signal});}catch(e){runError=e;}
  finally{clearInterval(timer);if(renewal)await renewal;}
  if(monitorError)throw monitorError;
  if(controller.signal.aborted)throw Error('Desktop execution stopped');
  const record={taskId:task.id,action:runError?'fail':'complete',input:runError?{...owner,usage:usageCounts(runError.usage),...failureInput(runError.code?runError:runnerError(runError))}:{...owner,content:result.content,checkpoint:result.checkpoint,artifacts:result.artifacts,usage:usageCounts(result.usage),...(result.handoff?{handoff:result.handoff}:{}),...(result.delegation?{delegation:result.delegation,...(models!==undefined?{models}:{})}:{}),...(result.reviewReport?{reviewReport:result.reviewReport}:{})}};
  outbox.write(record);await deliver(record);return true;
 }
 return {
  stop(){stopped=true;controller?.abort();},
  settled:()=>background,
  status:()=>({busy,stopped,pending:!!outbox.read(),sourceDelegationVersion:runner.sourceDelegationVersion===1?1:0}),
  async maintenance(work){
   if(busy||stopped||outbox.read())throw Object.assign(Error('실행 중이거나 미전달 결과가 있어 정리할 수 없습니다.'),{status:409});
   busy=true;try{return await work();}finally{busy=false;}
  },
  async startTask(taskId,input){
   if(busy||stopped||outbox.read())throw Object.assign(Error('Desktop is busy or has a pending result. Wait before starting another task.'),{status:409});
   const materials=sanitizeMaterials(input.materials);busy=true;
   try{
    await beforeClaim();if(stopped)throw Object.assign(Error('Desktop is stopping'),{status:409});
    const models=await modelSnapshot();
    const {claim}=await request(`/api/desktop/${encodeURIComponent(taskId)}/start`,{expectedVersion:input.expectedVersion,sourceDelegationVersion:runner.sourceDelegationVersion===1?1:0,sourceNames:materials.map(m=>m.name),...(models!==undefined?{models}:{})});
    if(stopped)throw Object.assign(Error('Desktop is stopping'),{status:409});
    background=execute(claim,materials,models).catch(onError).finally(()=>{busy=false;controller=null;});
    return claim.task;
   }catch(e){busy=false;throw e;}
  },
  async tick(){
   if(busy||stopped)return false;busy=true;
   try{
    const pending=outbox.read();if(pending){await deliver(pending);return true;}
    await beforeClaim();if(stopped)return false;
    const models=await modelSnapshot();const {claim}=await request('/api/desktop/poll',models===undefined?{}:{models});if(!claim||stopped)return false;
    return await execute(claim,[],models);
   }finally{busy=false;controller=null;}
  }
 };
}
