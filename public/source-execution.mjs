import {prepareTaskMaterials} from './core/source-materials.mjs';
import {isImageAttachment} from './core/image-materials.mjs';
import {usesTransport} from './core/providers.mjs';
import {providerAvailable} from './provider-ui.mjs';

export function sourceExecutionReadiness(task,state,connected){
 const no=reason=>({ready:false,reason});
 if(!task?.attachments?.length||task.attachments.some(a=>a.source==='url')||task.checkpoint?.confirmationRequired)return no('ineligible');
 let provider,parent;
 if(task.parentTaskId){
  parent=state.tasks.find(t=>t.id===task.parentTaskId);
  const d=parent?.delegation,assignment=d?.children?.find(c=>c.taskId===task.id);
  if(task.status!=='queued'||parent?.status!=='waiting_children'||d?.state!=='waiting_children'||d.batchId!==task.batchId||d.epoch!==task.parentEpoch||parent.checkpoint?.confirmationRequired||!assignment||assignment.provider!==task.assignment?.provider)return no('parent_changed');
  provider=assignment.provider;
 }else{
  if(task.status!=='queued_for_review'||task.delegation?.state!=='queued_for_review')return no('ineligible');
  provider=task.delegation.masterProvider;parent=task;
 }
 const c=state.capabilities||{};
 if(c.sourceDelegationVersion!==1)return no('unsupported');
 // PRV-06: a provider the person turned off starts nothing; the task waits until it is on.
 if((c.disabledProviders??[]).includes(provider))return no('provider_disabled');
 // CR-009: images reach only Codex on this PC; a source task assigned to Claude with images waits.
 if(!usesTransport(provider,'desktop_bridge')&&task.attachments.some(isImageAttachment))return no('images_need_codex');
 if(usesTransport(provider,'routine_fire')){
  if(!providerAvailable(provider,c))return no('provider_unavailable');
  // Claude children of one batch run one at a time (H7); the server enforces the same rule.
  if(task.parentTaskId&&state.tasks.some(s=>s.id!==task.id&&s.parentTaskId===task.parentTaskId&&s.batchId===task.batchId&&usesTransport(s.checkpoint?.provider,'routine_fire')&&(s.status==='running'||s.checkpoint?.confirmationRequired)))return no('claude_sibling_running');
 }
 else if(usesTransport(provider,'desktop_bridge')){
  if(!c.desktopSources||c.desktopSourceDelegationVersion!==1)return no('provider_unavailable');
  const desktop=state.localDesktop;
  if(!desktop||desktop.busy||desktop.stopped||desktop.pending)return no('desktop_waiting');
 }else return no('provider_unavailable');
 const missing=task.attachments.filter(a=>!connected(a)).map(a=>a.id);
 if(missing.length)return {...no('missing_sources'),missing,provider};
 return {ready:true,provider,parentId:parent.id,parentVersion:parent.version,batchId:parent.delegation.batchId,epoch:parent.delegation.epoch};
}

// Durable metadata only. Short Web Locks protect the journal across tabs; the
// server's version CAS remains the authority for every execution side effect.
export class SourceExecutionCoordinator{
 #services;#busy=false;#attempts=new Map();#session=0;
 constructor(services){this.#services=services;}
 entries(){return [...this.#attempts.values()].map(x=>({...x}));}
 resetSession(){this.#session++;this.#attempts=new Map();}
 #identity(client){return JSON.stringify([client.baseUrl||'',client.token||'',!!client.remote]);}
 async #journal(client,update=()=>{}){
  const session=this.#session,identity=this.#identity(client);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
  const key='inno-source-attempts-v1:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const locks=this.#services.attemptLocks??globalThis.navigator?.locks;
  if(!locks)throw Error('journal locks unavailable');
  return locks.request(key,()=>{
   if(session!==this.#session||this.#services.getClient()!==client||identity!==this.#identity(client))throw Object.assign(Error('stale session'),{code:'STALE_SOURCE_TASK'});
   const storage=this.#services.attemptStorage??globalThis.localStorage;
   if(!storage)throw Error('storage unavailable');
   const raw=storage.getItem(key);if(raw&&raw.length>100000)throw Error('invalid journal');
   const rows=raw?JSON.parse(raw):[];
   if(!Array.isArray(rows)||rows.length>100||rows.some(a=>!a||typeof a.taskId!=='string'||a.taskId.length>500||!Number.isSafeInteger(a.version)||a.version<1||!['uncertain','submitted','source_error'].includes(a.status)||Object.keys(a).some(k=>!['taskId','version','status'].includes(k))))throw Error('invalid journal');
   if(new Set(rows.map(a=>a.taskId)).size!==rows.length)throw Error('invalid journal');
   const entries=new Map(rows.map(a=>[a.taskId,a]));
   const result=update(entries);
   if(entries.size>100)throw Error('journal capacity');
   storage.setItem(key,JSON.stringify([...entries.values()]));
   this.#attempts=entries;
   return result;
  });
 }
 async reconnect(){
  this.#session++;
  const client=this.#services.getClient();if(!client)return {status:'waiting'};
  try{await this.#journal(client,entries=>{for(const [id,a] of entries)if(a.status==='source_error')entries.delete(id);});return {status:'reconnected'};}
  catch{return {status:'storage_error'};}
 }
 async recover(taskId){
  if(this.#busy)return {status:'busy'};
  this.#busy=true;
  const client=this.#services.getClient(),session=this.#session;
  if(!client){this.#busy=false;return {status:'waiting'};}
  const identity=this.#identity(client);
  try{
   await client.refresh();
   if(session!==this.#session||this.#services.getClient()!==client||identity!==this.#identity(client)||client.syncError)return {status:'stale'};
   try{return await this.#journal(client,entries=>{
    const attempt=entries.get(taskId),task=client.state.tasks.find(t=>t.id===taskId);
    // Existing server pause/resume or ownership recovery must fence old POSTs
    // and clear ownership first. An unchanged queued version proves nothing.
    if(!attempt||!task||task.version<=attempt.version||task.checkpoint?.executionId||task.checkpoint?.confirmationRequired||!sourceExecutionReadiness(task,client.state,this.#services.connected).ready)return {status:'recovery_required',taskId};
    entries.delete(taskId);return {status:'recovered',taskId};
   });}catch{return {status:'storage_error',taskId};}
  }catch{return {status:'sync_error',taskId};}finally{this.#busy=false;}
 }
 async tick(){
  if(this.#busy)return {status:'busy'};
  const s=this.#services,client=s.getClient();if(!client)return {status:'waiting'};
  this.#busy=true;
  const session=this.#session,identity=this.#identity(client);
  let snapshot,dispatched=false;
  const sameSession=()=>session===this.#session&&s.getClient()===client&&identity===this.#identity(client);
  try{
   try{await this.#journal(client);}catch{return {status:'storage_error'};}
   try{await client.refresh();}catch{return {status:'sync_error'};}
   if(!sameSession()||client.syncError)return {status:'stale'};
   try{await this.#journal(client,entries=>{
    for(const [id,a] of entries){const t=client.state.tasks.find(t=>t.id===id);if(t&&t.version>a.version&&['completed','cancelled'].includes(t.status))entries.delete(id);}
   });}catch{return {status:'storage_error'};}
   if(this.#attempts.size>=100)return {status:'capacity'};
   const task=client.state.tasks.find(t=>!this.#attempts.has(t.id)&&sourceExecutionReadiness(t,client.state,s.connected).ready);
   if(!task)return {status:'waiting'};
   snapshot=structuredClone(task);
   const ready=sourceExecutionReadiness(snapshot,client.state,s.connected);
   const current=()=>{
    if(!sameSession()||client.syncError)return false;
    const latest=client.state.tasks.find(t=>t.id===snapshot.id);
    return latest?.version===snapshot.version&&JSON.stringify(sourceExecutionReadiness(latest,client.state,s.connected))===JSON.stringify(ready);
   };
   const materials=await prepareTaskMaterials(snapshot,{...s,isCurrent:current,allowImages:usesTransport(ready.provider,'desktop_bridge')});
   await client.refresh();
   if(!current())return {status:'stale',taskId:snapshot.id};
   let reserved;
   try{reserved=await this.#journal(client,entries=>{
    if(!current())return 'stale';
    if(entries.has(snapshot.id))return 'waiting';
    if(entries.size>=100)return 'capacity';
    entries.set(snapshot.id,{taskId:snapshot.id,version:snapshot.version,status:'uncertain'});return 'reserved';
   });}catch{return {status:'storage_error',taskId:snapshot.id};}
   if(reserved!=='reserved')return {status:reserved,taskId:snapshot.id};
   if(!current())return {status:'stale',taskId:snapshot.id};
   dispatched=true;
   await client.run(snapshot.id,{provider:ready.provider,materials,expectedVersion:snapshot.version});
   if(!sameSession())return {status:'stale',taskId:snapshot.id};
   try{await this.#journal(client,entries=>{const a=entries.get(snapshot.id);if(a?.version===snapshot.version)entries.set(snapshot.id,{...a,status:'submitted'});});}
   catch{return {status:'uncertain',taskId:snapshot.id};}
   return {status:'submitted',taskId:snapshot.id};
  }catch(error){
   // The server refused the claim because a Claude sibling holds the batch slot (H7) or the
   // provider was turned off (PRV-06): nothing started, so drop the hold and wait.
   if(dispatched&&sameSession()&&error?.status===409&&['ROUTINE_SIBLING_BUSY','PROVIDER_DISABLED'].includes(error.code)){
    try{await this.#journal(client,entries=>{const a=entries.get(snapshot.id);if(a?.version===snapshot.version&&a.status==='uncertain')entries.delete(snapshot.id);});}
    catch{return {status:'uncertain',taskId:snapshot.id};}
    return {status:'waiting',taskId:snapshot.id};
   }
   const status=!sameSession()?'stale':dispatched?'uncertain':error.code==='STALE_SOURCE_TASK'?'stale':'source_error';
   if(snapshot&&status==='source_error'){
    try{await this.#journal(client,entries=>{if(!entries.has(snapshot.id)&&entries.size<100)entries.set(snapshot.id,{taskId:snapshot.id,version:snapshot.version,status});});}
    catch{return {status:'storage_error',taskId:snapshot.id};}
   }
   return {status,taskId:snapshot?.id};
  }finally{this.#busy=false;}
 }
}
