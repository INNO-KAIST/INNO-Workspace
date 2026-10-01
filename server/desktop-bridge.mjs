import {usageCounts} from '../public/core/execution-usage.mjs';
import {failureInput,runnerError} from '../public/core/failures.mjs';
import {sanitizeMaterials,DESKTOP_EXECUTION_LEASE_MS} from '../public/core/tasks.mjs';
import {boundedExecutionEvidence} from '../public/core/execution-evidence.mjs';
import {checkedDeliveryBinding,deliveryBindingConflict} from './delivery-binding.mjs';
import {protocolBinding,checkedRecord,checkedReceipt,checkedClaim,checkedAck,protocolError} from './delivery-protocol.mjs';
import {retryableStatus} from './bridge-runtime.mjs';
const leaseUnconfirmed=()=>Object.assign(Error('Execution lease renewal was not confirmed before the lease ended. The run was stopped and its output was not uploaded.'),{code:'DESKTOP_LEASE_UNCONFIRMED'});
const resultNotSaved=(cause,delivered)=>Object.assign(Error(delivered?'The result reached the cloud but could not be saved locally. New executions are stopped; check disk space and permissions, then restart the desktop bridge.':'The result could not be saved locally or sent to the cloud. New executions are stopped; check disk space, permissions and the desktop run folder, then restart the desktop bridge.'),{status:409,code:'OUTBOX_WRITE_FAILED',delivered,cause});
export function createDesktopBridge({request,runner,outbox,heartbeatMs=15000,leaseMs=DESKTOP_EXECUTION_LEASE_MS,beforeClaim=async()=>{},readDeliveryBinding,onError=()=>{},deliveryReceiptVersion=0}){
 let busy=false,stopped=false,deliveryUnsafe=false,recoveryPaused=false,outboxFailure=null,controller,background=Promise.resolve(),recoveryBackground=Promise.resolve();
 const bindingEnabled=typeof readDeliveryBinding==='function';
 const versioned=deliveryReceiptVersion===1;
 if(![0,1].includes(deliveryReceiptVersion)||versioned&&!bindingEnabled)throw protocolError();
 function pauseForRecovery(){
  if(!versioned)throw protocolError();
  recoveryPaused=true;deliveryUnsafe=true;
 }
 async function claimRequest(...args){
  try{return await request(...args);}catch(error){if(versioned)deliveryUnsafe=true;throw error;}
 }
 const readOutbox=()=>{
  try{return outbox.read();}catch(error){if(versioned)deliveryUnsafe=true;throw error;}
 };
 function recover(work,mutating){
  if(!versioned||busy||stopped||typeof work!=='function')throw protocolError();
  busy=true;
  // This latch is process-local. Explicit recovery never automatically resets it.
  if(mutating)deliveryUnsafe=true;
  const operation=Promise.resolve().then(work).finally(()=>{busy=false;});
  recoveryBackground=operation.catch(()=>{});
  return operation;
 }
 const readBinding=async()=>bindingEnabled?(versioned?protocolBinding:checkedDeliveryBinding)(await readDeliveryBinding()):undefined;
 const options=binding=>binding?{workspaceId:binding.workspaceId}:undefined;
 const protocolOptions=binding=>({...options(binding),deliveryReceiptVersion:1});
 const verifyClaim=(response,binding,taskId)=>{try{return checkedClaim(response,binding,taskId);}catch(error){deliveryUnsafe=true;throw error;}};
 async function send(record){
  if(versioned){
   const {binding,descriptor}=await checkedRecord(record),current=await readBinding();
   if(stopped||current.origin!==binding.origin||current.workspaceId!==binding.workspaceId)throw deliveryBindingConflict();
   if(record.phase==='pending'){
    const response=await request(`/api/desktop/${encodeURIComponent(record.taskId)}/${record.action}`,record.input,protocolOptions(binding));
    const receipt=await checkedReceipt(response?.deliveryReceipt,binding,descriptor);
    record={version:1,phase:'ack_pending',binding,receipt};
    await outbox.write(record);
   }
   const ackBinding=await readBinding();
   if(stopped||ackBinding.origin!==binding.origin||ackBinding.workspaceId!==binding.workspaceId)throw deliveryBindingConflict();
   const response=await request(`/api/desktop/${encodeURIComponent(record.receipt.taskId)}/ack`,{receipt:record.receipt},protocolOptions(binding));
   await checkedAck(response,record);await outbox.clear();return;
  }
  if(record?.version!==undefined||record?.phase!==undefined)throw protocolError();
  let saved;
  if(bindingEnabled){
   saved=checkedDeliveryBinding(record.binding);
   const current=await readBinding();
   if(stopped||current.origin!==saved.origin||current.workspaceId!==saved.workspaceId)throw deliveryBindingConflict();
  }
  await request(`/api/desktop/${encodeURIComponent(record.taskId)}/${record.action}`,record.input,options(saved));
 }
 async function deliver(record){await send(record);if(!versioned)await outbox.clear();}
 // Legacy (v0) only: one in-memory delivery attempt when the local save failed,
 // then latch so no new execution is claimed until the desktop is restarted.
 async function unsavedResult(record,cause){
  let delivered=false;
  try{await send(record);delivered=true;}catch{}
  return outboxFailure=resultNotSaved(cause,delivered);
 }
 async function modelSnapshot(){return typeof runner.models==='function'?await runner.models():undefined;}
 async function execute(claim,materials=[],models,binding,claimSentAt=performance.now()){
  const {task,executionId,generation}=claim,owner={executionId,generation};controller=new AbortController();
  let monitorError,renewal=null,confirmedAt=claimSentAt;
  // Only a definitive rejection ends ownership at once. Transient failures are
  // retried while the last confirmed lease (measured from request send) remains.
  const timer=setInterval(()=>{
   if(controller.signal.aborted)return;
   if(performance.now()-confirmedAt+heartbeatMs>=leaseMs){monitorError??=leaseUnconfirmed();controller.abort();return;}
   if(renewal)return;
   const sentAt=performance.now();
   renewal=request(`/api/desktop/${encodeURIComponent(task.id)}/renew`,owner,options(binding)).then(()=>{confirmedAt=Math.max(confirmedAt,sentAt);},e=>{if(!retryableStatus(e?.status)){monitorError??=e;controller.abort();}}).finally(()=>{renewal=null;});
  },heartbeatMs);
  let result,runError;
  try{result=await runner.run({task,...owner,materials,reviewInputs:claim.reviewInputs,sourceDelegationVersion:runner.sourceDelegationVersion===1&&claim.sourceDelegationVersion===1?1:0,signal:controller.signal});}catch(e){runError=e;}
  finally{clearInterval(timer);if(renewal)await renewal;}
  if(!versioned&&monitorError)throw monitorError;
  if(!versioned&&controller.signal.aborted)throw Error('Desktop execution stopped');
  let record,built=false;
  try{
   record={taskId:task.id,action:runError?'fail':'complete',...(binding?{binding}:{}),input:runError?{...owner,usage:usageCounts(runError.usage),...failureInput(runError.code?runError:runnerError(runError))}:{...owner,content:result.content,checkpoint:result.checkpoint,artifacts:result.artifacts,usage:usageCounts(result.usage),...(result.executionEvidence?{executionEvidence:boundedExecutionEvidence(result.executionEvidence)}:{}),...(result.handoff?{handoff:result.handoff}:{}),...(result.delegation?{delegation:result.delegation,...(models!==undefined?{models}:{})}:{}),...(result.reviewReport?{reviewReport:result.reviewReport}:{}),...(Object.hasOwn(result,'resumeState')?{resumeState:result.resumeState}:{})}};
   if(versioned){record=JSON.parse(JSON.stringify({...record,version:1,phase:'pending'}));await checkedRecord(record);}
   built=true;await outbox.write(record);
  }catch(error){if(versioned){deliveryUnsafe=true;throw error;}throw built?await unsavedResult(record,error):error;}
  if(versioned&&(monitorError||controller.signal.aborted)){deliveryUnsafe=true;throw monitorError??Error('Desktop execution stopped');}
  await deliver(record);return true;
 }
 return {
  stop(){stopped=true;controller?.abort();},
  pauseForRecovery,
  async drainPending({readPending=readOutbox}={}){
   if(!versioned||busy||stopped||typeof readPending!=='function')throw protocolError();
   pauseForRecovery();
   return recover(async()=>{const pending=await readPending();if(stopped)throw protocolError();if(!pending)return false;await deliver(pending);return true;},true);
  },
  settled:()=>Promise.all([background,recoveryBackground]).then(()=>undefined),
  runtimeStatus:()=>({busy,stopped,...(versioned?{deliveryUnsafe,recoveryPaused}:{}),sourceDelegationVersion:runner.sourceDelegationVersion===1?1:0}),
  status(){
   let pending,recoveryRequired=false;
   try{pending=!!readOutbox();}catch{pending=true;recoveryRequired=true;}
   return {busy,stopped,...(versioned?{deliveryUnsafe,recoveryPaused}:{}),pending,...(recoveryRequired?{recoveryRequired:true}:{}),sourceDelegationVersion:runner.sourceDelegationVersion===1?1:0};
  },
  async recoveryInspect(work){return recover(work,false);},
  async recoveryMaintenance(work){return recover(work,true);},
  async maintenance(work){
   if(outboxFailure)throw outboxFailure;
   if(busy||stopped||deliveryUnsafe||readOutbox())throw Object.assign(Error('실행 중이거나 미전달 결과가 있어 정리할 수 없습니다.'),{status:409});
   busy=true;try{return await work();}finally{busy=false;}
  },
  async startTask(taskId,input){
   if(outboxFailure)throw outboxFailure;
   if(busy||stopped||deliveryUnsafe||readOutbox())throw Object.assign(Error('Desktop is busy or has a pending result. Wait before starting another task.'),{status:409});
   const materials=sanitizeMaterials(input.materials);busy=true;
   try{
    await beforeClaim();if(stopped||recoveryPaused||deliveryUnsafe)throw Object.assign(Error('Desktop is stopping'),{status:409});
    const models=await modelSnapshot();if(stopped||recoveryPaused||deliveryUnsafe)throw Object.assign(Error('Desktop is stopping'),{status:409});
    const binding=await readBinding();if(stopped||recoveryPaused||deliveryUnsafe)throw Object.assign(Error('Desktop is stopping'),{status:409});
    const claimSentAt=performance.now();
    const response=await claimRequest(`/api/desktop/${encodeURIComponent(taskId)}/start`,{expectedVersion:input.expectedVersion,sourceDelegationVersion:runner.sourceDelegationVersion===1?1:0,sourceNames:materials.map(m=>m.name),...(models!==undefined?{models}:{})},versioned?protocolOptions(binding):options(binding));
    if(stopped||recoveryPaused||deliveryUnsafe)throw Object.assign(Error('Desktop is stopping'),{status:409});
    const claim=versioned?verifyClaim(response,binding,taskId):response.claim,workspaceId=response.workspaceId;
    if(bindingEnabled&&workspaceId!==binding.workspaceId)throw deliveryBindingConflict();
    background=execute(claim,materials,models,binding,claimSentAt).catch(async error=>{if(versioned)pauseForRecovery();try{await onError(error);}catch{}}).finally(()=>{busy=false;controller=null;});
    return claim.task;
   }catch(e){busy=false;throw e;}
  },
  async tick(){
   if(busy||stopped||recoveryPaused)return false;busy=true;
   try{
    if(outboxFailure)throw outboxFailure;
    const pending=readOutbox();if(pending){await deliver(pending);return true;}
    if(deliveryUnsafe)throw protocolError();
    await beforeClaim();if(stopped||recoveryPaused||deliveryUnsafe)return false;
    const models=await modelSnapshot();if(stopped||recoveryPaused||deliveryUnsafe)return false;
    const binding=await readBinding();if(stopped||recoveryPaused||deliveryUnsafe)return false;
    const claimSentAt=performance.now();
    const response=await claimRequest('/api/desktop/poll',models===undefined?{}:{models},versioned?protocolOptions(binding):options(binding));if(stopped||recoveryPaused||deliveryUnsafe)return false;
    const claim=versioned?verifyClaim(response,binding):response.claim,workspaceId=response.workspaceId;
    if(bindingEnabled&&workspaceId!==binding.workspaceId)throw deliveryBindingConflict();
    if(!claim)return false;
    return await execute(claim,[],models,binding,claimSentAt);
   }finally{busy=false;controller=null;}
  }
 };
}
