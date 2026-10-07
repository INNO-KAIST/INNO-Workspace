import {sanitizeResumeState} from '../public/core/context-resume.mjs';
import {failureRecord} from '../public/core/failures.mjs';
import {ConflictError,ValidationError,DESKTOP_EXECUTION_LEASE_MS} from '../public/core/tasks.mjs';
import {providerHas,providersByTransport} from '../public/core/providers.mjs';
import {AUTO_ROUTING} from './store.mjs';

const DESKTOP_PROVIDERS=providersByTransport('desktop_bridge'),DESKTOP_PROVIDER_LIST=JSON.stringify(DESKTOP_PROVIDERS);
// Why a running connector, or one of its runners, is not taking work (H9-1, CR-006 S2a).
const NOT_READY_REASONS=['codex_login','claude_login','claude_cli','run_storage'];
const PROVIDER_REPORT_MAX=8;
// CR-006 S2a: the desktop providers a connector can run now. Ids this cloud does not know
// (a newer connector) are ignored; a connector that says nothing runs the first one.
function announcedProviders(value){
  if(value===undefined)return [DESKTOP_PROVIDERS[0]];
  if(!Array.isArray(value)||value.length>PROVIDER_REPORT_MAX||value.some(id=>typeof id!=='string'||!id||id.length>40))throw new ValidationError('Invalid desktop providers');
  return DESKTOP_PROVIDERS.filter(id=>value.includes(id));
}
// The connector's runners that cannot take work, each with its reason. A provider or reason
// this cloud does not know (a newer connector) is skipped, so the poll still runs.
function notReadyProviders(value){
  if(value===undefined)return {};
  if(!Array.isArray(value)||value.length>PROVIDER_REPORT_MAX)throw new ValidationError('Invalid desktop provider readiness');
  const notReady={};
  for(const item of value){
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join()!=='provider,reason'||typeof item.provider!=='string'||item.provider.length>40||typeof item.reason!=='string'||item.reason.length>40)throw new ValidationError('Invalid desktop provider readiness');
    if(DESKTOP_PROVIDERS.includes(item.provider)&&NOT_READY_REASONS.includes(item.reason))notReady[item.provider]=item.reason;
  }
  return notReady;
}
// Desktops that predate provider selection omit it and run the first desktop provider.
function desktopProvider(value){
  if(value===undefined)return DESKTOP_PROVIDERS[0];
  if(!DESKTOP_PROVIDERS.includes(value))throw new ValidationError('provider does not run on the desktop bridge');
  return value;
}

// Retry only a concurrent task write (a newer version than the one read).
// Owner, lease and receipt conflicts report the read version and stay definitive.
async function concurrentRetry(store,id,write){
  for(let attempt=0;;attempt++){
    const t=await store.requireTask(id);
    try{return await write(t);}
    catch(e){if(!(e instanceof ConflictError)||e.currentVersion===t.version||attempt===2)throw e;}
  }
}

export class CloudBridge {
  constructor(store,{sourceDelegationVersion=0}={}){this.store=store;this.sourceDelegationVersion=sourceDelegationVersion;}
  async start(id,input,claimOptions){
    const t=await this.store.requireTask(id);
    const sourceVersion=this.sourceDelegationVersion===1&&input.sourceDelegationVersion===1?1:0;
    if(t.attachments.length&&(t.parentTaskId||t.delegation?.state==='queued_for_review')&&sourceVersion!==1)throw new ValidationError('A compatible updated desktop is required for source delegation');
    const rootSource=t.attachments.length>0&&t.status==='queued'&&!t.parentTaskId&&(!t.delegation||t.delegation.state==='superseded');
    const sourcePhase=rootSource||(this.sourceDelegationVersion===1&&t.attachments.length>0&&((t.parentTaskId&&t.status==='queued')||(t.status==='queued_for_review'&&t.delegation?.state==='queued_for_review')));
    if(!sourcePhase&&!['ready','failed','waiting_connection','waiting_quota'].includes(t.status))throw new ConflictError('Task must be ready before direct execution.',t.version);
    if(t.attachments.some(a=>a.source==='url'))throw new ValidationError('URL references are not source content. Connect the required document before direct execution.');
    const names=t.attachments.filter(a=>a.source!=='url').map(a=>a.path||a.name).sort();
    if(!Array.isArray(input.sourceNames)||input.sourceNames.length>20||input.sourceNames.some(n=>typeof n!=='string')||JSON.stringify([...input.sourceNames].sort())!==JSON.stringify(names))throw new ValidationError('Reconnect every required source on this desktop.');
    // A direct start is a person's explicit choice: any earlier auto-routing record is cleared (CR-010).
    const claim=await this.store.claimExecution(id,{provider:desktopProvider(input.provider),expectedVersion:input.expectedVersion,leaseMs:DESKTOP_EXECUTION_LEASE_MS,sourceBound:input.sourceNames.length>0,[AUTO_ROUTING]:null},claimOptions);
    await this.seen();return {...claim,sourceDelegationVersion:sourceVersion};
  }
  // CR-010: `routing` is the server-built auto record; an explicit choice (null) clears an earlier one.
  async enqueue(id,input,{routing=null}={}){
    const provider=desktopProvider(input.provider);
    if(input.materials?.length)throw new ValidationError('Desktop source transfer is not connected. Reconnect sources on the desktop; source content is never queued.');
    return this.store.replaceTask(id,input.expectedVersion,t=>{
      if(!['ready','failed','waiting_connection','waiting_quota'].includes(t.status))throw new ConflictError('Task must be ready before queueing.',t.version);
      if(t.attachments.length)throw new ValidationError('This task needs source reconnection before desktop execution.');
      const now=this.store.now();return {...t,status:'queued',version:t.version+1,updatedAt:now,checkpoint:{...t.checkpoint,provider,status:'queued',updatedAt:now,routing:routing??undefined}};
    });
  }
  // Bounded (evaluation) tasks need a budget-capable desktop path; the generic queue never
  // claims them, so one cannot stall every poll with a budget validation error.
  async claim(claimOptions,input={}){
    const announced=announcedProviders(input.providers);
    await this.seen();
    const expired=await this.store.db.prepare("SELECT body FROM tasks WHERE json_extract(body,'$.status')='running' AND json_extract(body,'$.checkpoint.provider') IN (SELECT value FROM json_each(?2)) AND json_extract(body,'$.checkpoint.expiresAt') < ?1 ORDER BY updated_at ASC LIMIT 1").bind(this.store.now(),DESKTOP_PROVIDER_LIST).first();
    if(expired){const t=JSON.parse(expired.body);try{await this.store.replaceTask(t.id,t.version,current=>({...current,status:'paused',version:current.version+1,updatedAt:this.store.now(),checkpoint:{...current.checkpoint,status:'paused',interruptedBy:'lease_expiry',interruptedVersion:current.version+1,failure:failureRecord({failure:{kind:'interrupted'}},this.store.now())}}));}catch(e){if(!(e instanceof ConflictError))throw e;}}
    // PRV-06: only providers that are on are queried, so a turned-off one never holds up the queue.
    // CR-006 S2a: only providers this connector runs now, and with delivery receipts only those that support them.
    const off=typeof this.store.providerSettings==='function'?(await this.store.providerSettings()).disabled:[];
    const enabled=DESKTOP_PROVIDERS.filter(id=>!off.includes(id)&&announced.includes(id)&&(claimOptions?.deliveryReceiptVersion!==1||providerHas(id,'deliveryReceipts',1)));
    if(!enabled.length)return null;
    const row=await this.store.db.prepare("SELECT q.body FROM tasks q WHERE json_extract(q.body,'$.status') IN ('queued','queued_for_review') AND json_extract(q.body,'$.checkpoint.provider') IN (SELECT value FROM json_each(?1)) AND COALESCE(json_array_length(q.body,'$.attachments'),0)=0 AND json_type(q.body,'$.evaluationBudget') IS NULL AND (json_extract(q.body,'$.parentTaskId') IS NULL OR EXISTS (SELECT 1 FROM tasks p WHERE p.id=json_extract(q.body,'$.parentTaskId') AND json_extract(p.body,'$.status')='waiting_children' AND json_extract(p.body,'$.delegation.state')='waiting_children' AND json_extract(p.body,'$.delegation.batchId')=json_extract(q.body,'$.batchId') AND json_extract(p.body,'$.delegation.epoch')=json_extract(q.body,'$.parentEpoch'))) ORDER BY q.updated_at ASC LIMIT 1").bind(JSON.stringify(enabled)).first();
    if(!row)return null;
    const t=JSON.parse(row.body);
    if(!DESKTOP_PROVIDERS.includes(t.checkpoint?.provider))return null;
    if(t.attachments.length)return null;
    try{return await this.store.claimExecution(t.id,{provider:t.checkpoint.provider,expectedVersion:t.version,leaseMs:DESKTOP_EXECUTION_LEASE_MS},claimOptions);}catch(e){if(e instanceof ConflictError&&e.code!=='DESKTOP_DELIVERY_CAPACITY'&&e.code!=='DESKTOP_CLAIM_NONCE_USED')return null;throw e;}
  }
  async seen(){
    const now=Date.parse(this.store.now());
    await this.store.db.prepare("INSERT INTO metadata (key,value) VALUES ('desktop_seen',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE metadata.value < ?2").bind(now,now-60000).run();
  }
  // H9-1: a running connector that cannot take work reports why. The first report time is
  // kept while the reason stays the same and the desktop stayed online; the next poll clears
  // the report. One workspace has one desktop: a second, ready desktop's poll would clear it.
  async reportNotReady(input){
    const keys=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input).sort().join():'';
    if(!['reason,state','notReadyProviders,reason,state'].includes(keys)||input.state!=='not_ready'||!NOT_READY_REASONS.includes(input.reason))
      throw new ValidationError('Invalid desktop presence report');
    if(input.notReadyProviders!==undefined)await this.writeProviders({ready:[],notReady:notReadyProviders(input.notReadyProviders)});
    const continued=(await this.presence()).online;
    await this.store.db.prepare(`INSERT INTO metadata (key,value) VALUES ('desktop_readiness',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value${continued?" WHERE json_valid(metadata.value)=0 OR json_extract(metadata.value,'$.reason') IS NOT json_extract(excluded.value,'$.reason')":''}`)
      .bind(JSON.stringify({reason:input.reason,since:Date.parse(this.store.now())})).run();
    await this.seen();
    return this.presence();
  }
  async markReady(){await this.store.db.prepare("DELETE FROM metadata WHERE key='desktop_readiness'").run();}
  // CR-006 S2a: a poll says which runners are ready and why the others are not. The report is
  // checked before anything is written; a poll that says nothing (an older connector) clears it.
  async reportProviders(input){
    if(input?.providers===undefined&&input?.notReadyProviders!==undefined)throw new ValidationError('A desktop readiness report must name its ready providers');
    const report=input?.providers===undefined?null:{ready:announcedProviders(input.providers),notReady:notReadyProviders(input.notReadyProviders)};
    try{await this.markReady();}catch{}
    try{if(report)await this.writeProviders(report);else await this.store.db.prepare("DELETE FROM metadata WHERE key='desktop_providers'").run();}catch{}
  }
  async writeProviders(report){
    await this.store.db.prepare("INSERT INTO metadata (key,value) VALUES ('desktop_providers',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE metadata.value IS NOT excluded.value").bind(JSON.stringify(report)).run();
  }
  async presence(){
    const rows=(await this.store.db.prepare("SELECT key,value FROM metadata WHERE key IN ('desktop_seen','desktop_readiness','desktop_providers')").all()).results??[];
    const seen=rows.find(row=>row.key==='desktop_seen'),online=!!seen&&Date.parse(this.store.now())-seen.value<180000;
    let readiness=null,providers=null;
    try{readiness=JSON.parse(rows.find(row=>row.key==='desktop_readiness')?.value??'null');}catch{}
    try{providers=JSON.parse(rows.find(row=>row.key==='desktop_providers')?.value??'null');}catch{}
    const notReady=online&&NOT_READY_REASONS.includes(readiness?.reason)&&Number.isSafeInteger(readiness.since);
    const reported=online&&Array.isArray(providers?.ready)&&providers.notReady&&typeof providers.notReady==='object'
      ?{ready:DESKTOP_PROVIDERS.filter(id=>providers.ready.includes(id)),notReady:Object.fromEntries(DESKTOP_PROVIDERS.filter(id=>NOT_READY_REASONS.includes(providers.notReady[id])).map(id=>[id,providers.notReady[id]]))}:null;
    return {lastSeen:seen?.value??null,online,...(notReady?{notReady:readiness.reason,notReadySince:readiness.since}:{}),...(reported?{providers:reported}:{})};
  }
  async renew(id,input){
    await this.seen();
    return concurrentRetry(this.store,id,t=>this.store.replaceTask(id,t.version,current=>{
      this.store.assertExecution(current,input);
      if(Date.parse(current.checkpoint.expiresAt)<=Date.parse(this.store.now()))throw new ConflictError('Execution lease expired',current.version);
      const now=this.store.now();return {...current,version:current.version+1,updatedAt:now,checkpoint:{...current.checkpoint,updatedAt:now,expiresAt:new Date(Date.parse(now)+DESKTOP_EXECUTION_LEASE_MS).toISOString()}};
    }));
  }
  async fail(id,input,{deliveryReceipt}={}){
    if(deliveryReceipt===null)throw new ValidationError('Invalid desktop delivery receipt');
    return concurrentRetry(this.store,id,t=>{
      if(['failed','waiting_quota','waiting_connection'].includes(t.status)&&t.checkpoint?.executionId===input.executionId&&t.checkpoint?.generation===input.generation){
        if(deliveryReceipt!==undefined||t.checkpoint?.deliveryReceiptVersion===1)throw new ConflictError('Delivery receipt replay requires stored verification',t.version);
        return t;
      }
      return this.store.failExecution(id,input,{deliveryReceipt,recoverInterrupted:true,allowDesktopEvidence:true});
    });
  }
  async complete(id,input,{deliveryReceipt}={}){
    if(deliveryReceipt===null)throw new ValidationError('Invalid desktop delivery receipt');
    for(let attempt=0;attempt<3;attempt++){
      const t=await this.store.requireTask(id);
      if(t.status==='completed'&&t.checkpoint?.executionId===input.executionId&&t.checkpoint?.generation===input.generation){
        if(deliveryReceipt!==undefined||t.checkpoint?.deliveryReceiptVersion===1)throw new ConflictError('Delivery receipt replay requires stored verification',t.version);
        if(input.resumeState!==undefined){
          const supplied=input.resumeState===null?null:sanitizeResumeState(input.resumeState);
          let stored;
          try{stored=t.checkpoint.resumeState===undefined?null:sanitizeResumeState(t.checkpoint.resumeState);}
          catch{throw new ConflictError('Completed resume state cannot change',t.version);}
          if((supplied&&supplied.taskId!==t.id)||JSON.stringify(supplied)!==JSON.stringify(stored))
            throw new ConflictError('Completed resume state cannot change',t.version);
        }
        return t;
      }
      if(input.executionEvidence&&!providerHas(t.checkpoint?.provider,'executionEvidence','cli_arguments'))throw new ValidationError('execution evidence provider does not match owner');
      try{return await this.store.finishExecution(id,input,{recoverInterrupted:true,allowDesktopEvidence:true,deliveryReceipt});}
      catch(e){if(!(e instanceof ConflictError)||attempt===2)throw e;}
    }
  }
}
