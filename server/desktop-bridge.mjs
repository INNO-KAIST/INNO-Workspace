import {usageCounts} from '../public/core/execution-usage.mjs';
import {failureInput,runnerError} from '../public/core/failures.mjs';
import {sanitizeMaterials,DESKTOP_EXECUTION_LEASE_MS} from '../public/core/tasks.mjs';
import {boundedExecutionEvidence} from '../public/core/execution-evidence.mjs';
import {checkedDeliveryBinding,deliveryBindingConflict} from './delivery-binding.mjs';
import {protocolBinding,checkedRecord,checkedReceipt,checkedClaim,checkedAck,protocolError} from './delivery-protocol.mjs';
import {retryableStatus} from './bridge-runtime.mjs';
import {boundedContextDelivery} from '../public/core/context-delivery.mjs';
import {boundedPluginDelivery} from '../public/core/plugins.mjs';
import {boundedLocalExecution} from '../public/core/local-execution.mjs';
import {randomBytes} from 'node:crypto';
// Delivery evidence is optional: invalid evidence is dropped, never the result.
const deliveryOf=value=>{try{const delivery=boundedContextDelivery(value);return delivery?{contextDelivery:delivery}:{};}catch{return {};}};
const pluginsOf=value=>{try{const delivery=boundedPluginDelivery(value);return delivery?{pluginDelivery:delivery}:{};}catch{return {};}};
const localOf=value=>{const observed=boundedLocalExecution(value);return observed?{localExecution:observed}:{};};
const leaseUnconfirmed=()=>Object.assign(Error('Execution lease renewal was not confirmed before the lease ended. The run was stopped and its output was not uploaded.'),{code:'DESKTOP_LEASE_UNCONFIRMED'});
const resultNotSaved=(cause,delivered)=>Object.assign(Error(delivered?'The result reached the cloud but could not be saved locally. New executions are stopped; check disk space and permissions, then restart the desktop bridge.':'The result could not be saved locally or sent to the cloud. New executions are stopped; check disk space, permissions and the desktop run folder, then restart the desktop bridge.'),{status:409,code:'OUTBOX_WRITE_FAILED',delivered,cause});
export function createDesktopBridge({request,runner,outbox,journal,heartbeatMs=15000,leaseMs=DESKTOP_EXECUTION_LEASE_MS,beforeClaim=async()=>{},readDeliveryBinding,onError=()=>{},onDiscarded=()=>{},deliveryReceiptVersion=0}){
 let busy=false,stopped=false,deliveryUnsafe=false,recoveryPaused=false,outboxFailure=null,controller,background=Promise.resolve(),recoveryBackground=Promise.resolve();
 const bindingEnabled=typeof readDeliveryBinding==='function';
 const versioned=deliveryReceiptVersion===1;
 const journaled=versioned&&!!journal;
 if(![0,1].includes(deliveryReceiptVersion)||versioned&&!bindingEnabled)throw protocolError();
 function pauseForRecovery(){
  if(!versioned)throw protocolError();
  recoveryPaused=true;deliveryUnsafe=true;
 }
 // With a claim journal the saved intent replaces the process-local latch: the next tick
 // resolves it from the Worker's record of the nonce.
 async function claimRequest(...args){
  try{return await request(...args);}catch(error){if(versioned&&!journaled)deliveryUnsafe=true;throw error;}
 }
 // A connector that is up but cannot take work says why instead of looking offline. The
 // report owns nothing; an older Worker without the route (or any failure) is ignored.
 async function reportNotReady(reason){
  try{await request('/api/desktop/presence',{state:'not_ready',reason});}catch{}
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
 // Receipt-protocol claims are journaled (H4-2). The intent and a fresh nonce are saved
 // before the request leaves and the owner after a verified response, so a lost response
 // or a process death is resolved from the Worker's record of that nonce, never by guessing.
 const ownerId=value=>typeof value==='string'&&!!value.trim()&&value.length<=200;
 const readJournal=()=>{try{return journal.read();}catch(error){deliveryUnsafe=true;throw error;}};
 function intendClaim(binding,taskId){
  if(!journaled)return undefined;
  const nonce=randomBytes(32).toString('hex');
  journal.write({version:1,phase:'requested',binding,nonce,taskId:taskId??null});
  return nonce;
 }
 function recordClaim(response,nonce,binding,claim){
  if(!journaled)return;
  if(response?.claimNonce!==nonce){deliveryUnsafe=true;throw protocolError();}
  if(!claim){journal.clear();return;}
  journal.write({version:1,phase:'owned',binding,nonce,taskId:claim.task.id,executionId:claim.executionId,generation:claim.generation});
 }
 function checkedJournal(value){
  const keys=value?.phase==='owned'?['version','phase','binding','nonce','taskId','executionId','generation']:['version','phase','binding','nonce','taskId'];
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||!['requested','owned'].includes(value.phase)
   ||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||typeof value.nonce!=='string'||!/^[0-9a-f]{64}$/.test(value.nonce)
   ||(value.phase==='requested'?value.taskId!==null&&!ownerId(value.taskId):!ownerId(value.taskId)||!ownerId(value.executionId)||!Number.isSafeInteger(value.generation)||value.generation<1))throw protocolError();
  return {...value,binding:protocolBinding(value.binding)};
 }
 const sameJournalOwner=(entry,record)=>{
  const owner=record?.phase==='ack_pending'?record.receipt:{taskId:record?.taskId,...record?.input};
  return entry?.phase==='owned'&&entry.taskId===owner?.taskId&&entry.executionId===owner.executionId&&entry.generation===owner.generation;
 };
 const restarted=()=>Object.assign(Error('The desktop did not keep the result of this execution.'),{code:'DESKTOP_RESTARTED'});
 async function reconcileJournal(){
  const saved=readJournal();if(!saved)return false;
  let entry;try{entry=checkedJournal(saved);}catch(error){deliveryUnsafe=true;throw error;}
  const current=await readBinding();
  if(stopped)throw protocolError();
  if(current.origin!==entry.binding.origin||current.workspaceId!==entry.binding.workspaceId){deliveryUnsafe=true;throw deliveryBindingConflict();}
  // The Worker's record of the nonce decides: never claimed (none), already settled (its
  // reservation is gone), or claimed and still waiting for a result from this desktop.
  const status=await request('/api/desktop/claim-status',{nonce:entry.nonce},protocolOptions(entry.binding));
  if((status?.state==='none'||status?.state==='settled')&&Object.keys(status).length===1){
   // An owned journal's marker can only read "none" after it was swept, once settled.
   journal.clear();return false;
  }
  if(status?.state!=='claimed'||!ownerId(status.taskId)||!ownerId(status.executionId)||!Number.isSafeInteger(status.generation)||status.generation<1
   ||entry.taskId!==null&&status.taskId!==entry.taskId
   ||entry.phase==='owned'&&(status.taskId!==entry.taskId||status.executionId!==entry.executionId||status.generation!==entry.generation)){deliveryUnsafe=true;throw protocolError();}
  // The claimed execution left no saved result in this process: report it as interrupted.
  // The owner is journaled first, so a crash before the journal is cleared is resolved by
  // delivering the saved report, never by reporting it twice.
  const record={version:1,phase:'pending',binding:entry.binding,taskId:status.taskId,action:'fail',input:{executionId:status.executionId,generation:status.generation,...failureInput(restarted())}};
  try{
   await checkedRecord(record);
   if(entry.phase==='requested')journal.write({version:1,phase:'owned',binding:entry.binding,nonce:entry.nonce,taskId:status.taskId,executionId:status.executionId,generation:status.generation});
   await outbox.write(record);journal.clear();
  }catch(error){deliveryUnsafe=true;throw error;}
  await deliver(record);return true;
 }
 // A legacy (protocol 0) saved result is never treated as accepted. The Worker classifies
 // its owner read-only; a bound legacy record must match the current workspace (H4-3).
 const LEGACY_STATES=['deliverable','already_applied','owner_replaced','not_running','receipt_required','task_missing'];
 async function legacyStatusOf(record){
  if(!versioned)throw protocolError();
  // Only the saved record's own binding can make it unverifiable; a problem with the
  // current binding is an error, never a reason to archive.
  let saved;
  if(record?.binding!==undefined){try{saved=checkedDeliveryBinding(record.binding);}catch{return {state:'binding_unverified',binding:null};}}
  const binding=await readBinding();
  if(saved&&(saved.origin!==binding.origin||saved.workspaceId!==binding.workspaceId))throw deliveryBindingConflict();
  const response=await request(`/api/desktop/${encodeURIComponent(record.taskId)}/legacy-status`,{executionId:record.input.executionId,generation:record.input.generation,action:record.action},protocolOptions(binding));
  if(!response||typeof response!=='object'||Object.keys(response).length!==1||!LEGACY_STATES.includes(response.state))throw protocolError();
  return {state:response.state,binding};
 }
 async function send(record){
  if(versioned){
   const {binding,descriptor}=await checkedRecord(record),current=await readBinding();
   if(stopped||current.origin!==binding.origin||current.workspaceId!==binding.workspaceId)throw deliveryBindingConflict();
   if(record.phase==='pending'){
    const response=await request(`/api/desktop/${encodeURIComponent(record.taskId)}/${record.action}`,record.input,protocolOptions(binding));
    const receipt=await checkedReceipt(response?.deliveryReceipt,binding,descriptor);
    // The Worker settled a result its task can never accept (for example after a user
    // pause) without applying it; the receipt is acknowledged like any other.
    if(response.discarded===true){try{onDiscarded({taskId:record.taskId,action:record.action});}catch{}}
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
  try{result=await runner.run({task,...owner,materials,reviewInputs:claim.reviewInputs,...(claim.project?{project:claim.project}:{}),...(claim.plugins?{plugins:claim.plugins,pluginsSkipped:claim.pluginsSkipped??[]}:{}),...(claim.pluginCatalog?{pluginCatalog:claim.pluginCatalog}:{}),sourceDelegationVersion:runner.sourceDelegationVersion===1&&claim.sourceDelegationVersion===1?1:0,signal:controller.signal});}catch(e){runError=e;}
  finally{clearInterval(timer);if(renewal)await renewal;}
  if(!versioned&&monitorError)throw monitorError;
  if(!versioned&&controller.signal.aborted)throw Error('Desktop execution stopped');
  let record,built=false;
  try{
   record={taskId:task.id,action:runError?'fail':'complete',...(binding?{binding}:{}),input:runError?{...owner,usage:usageCounts(runError.usage),...failureInput(runError.code?runError:runnerError(runError)),...deliveryOf(runError.contextDelivery),...pluginsOf(runError.pluginDelivery),...localOf(runError.localExecution)}:{...owner,content:result.content,checkpoint:result.checkpoint,artifacts:result.artifacts,usage:usageCounts(result.usage),...deliveryOf(result.contextDelivery),...pluginsOf(result.pluginDelivery),...localOf(result.localExecution),...(result.executionEvidence?{executionEvidence:boundedExecutionEvidence(result.executionEvidence)}:{}),...(result.handoff?{handoff:result.handoff}:{}),...(result.delegation?{delegation:result.delegation,...(models!==undefined?{models}:{})}:{}),...(result.reviewReport?{reviewReport:result.reviewReport}:{}),...(Object.hasOwn(result,'resumeState')?{resumeState:result.resumeState}:{})}};
   if(versioned){record=JSON.parse(JSON.stringify({...record,version:1,phase:'pending'}));await checkedRecord(record);}
   built=true;await outbox.write(record);
   // The saved result now owns recovery; the claim journal is no longer needed.
   if(journaled)journal.clear();
  }catch(error){if(versioned){deliveryUnsafe=true;throw error;}throw built?await unsavedResult(record,error):error;}
  if(versioned&&(monitorError||controller.signal.aborted)){
   // A definitive refusal (for example the user paused the task) is settled by the Worker:
   // the saved result is offered once, and only a verified receipt and ACK avoid the latch.
   if(monitorError?.status===409&&!stopped){try{await deliver(record);return true;}catch(error){deliveryUnsafe=true;throw error;}}
   deliveryUnsafe=true;throw monitorError??Error('Desktop execution stopped');
  }
  await deliver(record);return true;
 }
 return {
  stop(){stopped=true;controller?.abort();},
  pauseForRecovery,
  async legacyStatus(record){return {state:(await legacyStatusOf(record)).state};},
  // Explicit recovery only: delivers a legacy result the protocol 0 way after the Worker
  // reports it deliverable (or already applied, which the old route replays idempotently).
  async deliverLegacy({readLegacy}={}){
   if(!versioned||busy||stopped||typeof readLegacy!=='function')throw protocolError();
   return recover(async()=>{
    const record=await readLegacy();if(stopped)throw protocolError();
    const {state,binding}=await legacyStatusOf(record);
    if(!['deliverable','already_applied'].includes(state))throw Object.assign(Error('This saved result can no longer be delivered.'),{status:409});
    // A Worker refusal of the old-route delivery is marked so the caller can offer archiving.
    try{await request(`/api/desktop/${encodeURIComponent(record.taskId)}/${record.action}`,record.input,options(binding));}
    catch(error){if(error?.fromResponse===true&&[400,409,410,422].includes(error.status))error.legacyRefused=true;throw error;}
    await outbox.clear();
    return {delivered:true,state};
   },true);
  },
  async drainPending({readPending=readOutbox}={}){
   if(!versioned||busy||stopped||typeof readPending!=='function')throw protocolError();
   pauseForRecovery();
   return recover(async()=>{
    const pending=await readPending();if(stopped)throw protocolError();if(!pending)return false;
    await deliver(pending);
    if(journaled&&sameJournalOwner(readJournal(),pending))journal.clear();
    return true;
   },true);
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
   if(busy||stopped||deliveryUnsafe||readOutbox()||journaled&&readJournal())throw Object.assign(Error('실행 중이거나 미전달 결과가 있어 정리할 수 없습니다.'),{status:409});
   busy=true;try{return await work();}finally{busy=false;}
  },
  async startTask(taskId,input){
   if(outboxFailure)throw outboxFailure;
   if(busy||stopped||deliveryUnsafe||readOutbox()||journaled&&readJournal())throw Object.assign(Error('Desktop is busy or has a pending result. Wait before starting another task.'),{status:409});
   const materials=sanitizeMaterials(input.materials,{images:true});busy=true;
   try{
    await beforeClaim();if(stopped||recoveryPaused||deliveryUnsafe)throw Object.assign(Error('Desktop is stopping'),{status:409});
    const models=await modelSnapshot();if(stopped||recoveryPaused||deliveryUnsafe)throw Object.assign(Error('Desktop is stopping'),{status:409});
    const binding=await readBinding();if(stopped||recoveryPaused||deliveryUnsafe)throw Object.assign(Error('Desktop is stopping'),{status:409});
    const nonce=intendClaim(binding,taskId),claimSentAt=performance.now();
    const response=await claimRequest(`/api/desktop/${encodeURIComponent(taskId)}/start`,{expectedVersion:input.expectedVersion,sourceDelegationVersion:runner.sourceDelegationVersion===1?1:0,sourceNames:materials.map(m=>m.name),...(models!==undefined?{models}:{}),...(nonce?{claimNonce:nonce}:{})},versioned?protocolOptions(binding):options(binding));
    if(stopped||recoveryPaused||deliveryUnsafe)throw Object.assign(Error('Desktop is stopping'),{status:409});
    const claim=versioned?verifyClaim(response,binding,taskId):response.claim,workspaceId=response.workspaceId;
    recordClaim(response,nonce,binding,claim);
    if(bindingEnabled&&workspaceId!==binding.workspaceId)throw deliveryBindingConflict();
    background=execute(claim,materials,models,binding,claimSentAt).catch(async error=>{if(versioned)pauseForRecovery();try{await onError(error);}catch{}}).finally(()=>{busy=false;controller=null;});
    return claim.task;
   }catch(e){busy=false;throw e;}
  },
  async tick(){
   if(busy||stopped||recoveryPaused)return false;busy=true;
   try{
    if(outboxFailure)throw outboxFailure;
    const pending=readOutbox();
    if(pending){
     await deliver(pending);
     // A process that died between saving its result and clearing its journal left both.
     if(journaled&&sameJournalOwner(readJournal(),pending))journal.clear();
     return true;
    }
    if(journaled&&await reconcileJournal())return true;
    if(deliveryUnsafe)throw protocolError();
    try{await beforeClaim();}catch(error){if(error?.code==='DESKTOP_NOT_READY'&&!stopped)await reportNotReady(error.reason);throw error;}
    if(stopped||recoveryPaused||deliveryUnsafe)return false;
    const models=await modelSnapshot();if(stopped||recoveryPaused||deliveryUnsafe)return false;
    const binding=await readBinding();if(stopped||recoveryPaused||deliveryUnsafe)return false;
    const nonce=intendClaim(binding),claimSentAt=performance.now();
    const response=await claimRequest('/api/desktop/poll',{...(models===undefined?{}:{models}),...(nonce?{claimNonce:nonce}:{})},versioned?protocolOptions(binding):options(binding));if(stopped||recoveryPaused||deliveryUnsafe)return false;
    const claim=versioned?verifyClaim(response,binding):response.claim,workspaceId=response.workspaceId;
    recordClaim(response,nonce,binding,claim);
    if(bindingEnabled&&workspaceId!==binding.workspaceId)throw deliveryBindingConflict();
    if(!claim)return false;
    return await execute(claim,[],models,binding,claimSentAt);
   }finally{busy=false;controller=null;}
  }
 };
}
