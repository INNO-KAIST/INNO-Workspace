import {ValidationError} from '../public/core/tasks.mjs';
const efforts=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
export class ModelCatalog {
 constructor(store){this.store=store;}
 async report(input){
  const verified=!Array.isArray(input),rows=verified?input?.models:input;
  if(verified&&(!input||!['fresh','unavailable'].includes(input.status)||!Number.isFinite(input.observedAt)&&input.observedAt!==null))throw new ValidationError('Invalid desktop model observation');
  if(verified&&input.status==='unavailable'&&(!Array.isArray(rows)||rows.length))throw new ValidationError('Invalid unavailable desktop model catalog');
  if(!Array.isArray(rows)||rows.length>100)throw new ValidationError('Invalid desktop model catalog');
  const models=rows.map(row=>{if(!row||typeof row.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(row.model)||!Array.isArray(row.efforts)||row.efforts.length>8||row.efforts.some(e=>!efforts.has(e)))throw new ValidationError('Invalid desktop model entry');return {model:row.model,efforts:[...new Set(row.efforts)],isDefault:row.isDefault===true};});
  if(new Set(models.map(m=>m.model)).size!==models.length)throw new ValidationError('Duplicate desktop model');
  const now=Date.parse(this.store.now());
  if(!verified){
   // Old desktop clients provide no actual model/list observation time.
   await this.store.db.prepare("INSERT INTO metadata(key,value) VALUES('desktop_models',?1) ON CONFLICT(key) DO NOTHING").bind(JSON.stringify({models,reportedAt:null,refreshStatus:'legacy_unverified'})).run();
   return;
  }
  if(input.status==='unavailable'){
   // A failed older refresh must not change a newer successful observation.
   await this.store.db.prepare("UPDATE metadata SET value=json_set(value,'$.refreshStatus','unavailable') WHERE key='desktop_models' AND ((?1 IS NOT NULL AND json_extract(value,'$.reportedAt')=?1) OR (?1 IS NULL AND json_extract(value,'$.reportedAt') IS NULL))").bind(input.observedAt).run();
   await this.store.db.prepare("INSERT INTO metadata(key,value) VALUES('desktop_models',?1) ON CONFLICT(key) DO NOTHING").bind(JSON.stringify({models:[],reportedAt:null,refreshStatus:'unavailable'})).run();
   return;
  }
  const observedAt=input.observedAt;
  if(!Number.isFinite(observedAt)||observedAt<0||observedAt>now+300000)throw new ValidationError('Invalid desktop model observation time');
  await this.store.db.prepare("INSERT INTO metadata(key,value) VALUES('desktop_models',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE COALESCE(CAST(json_extract(metadata.value,'$.reportedAt') AS INTEGER),-1)<?2").bind(JSON.stringify({models,reportedAt:observedAt,refreshStatus:'fresh'}),observedAt).run();
 }
 async stored(){const row=await this.store.db.prepare("SELECT value FROM metadata WHERE key='desktop_models'").first();if(!row)return null;try{return JSON.parse(row.value)}catch{return null}}
 async read(){const value=await this.stored(),age=value?.reportedAt==null?Infinity:Date.parse(this.store.now())-value.reportedAt,fresh=age>=0&&age<7200000;return {codex:fresh?value.models:[],lastGoodCodex:value?.reportedAt!=null?value.models:[],availability:value?.refreshStatus==='legacy_unverified'?'legacy_unverified':value?.reportedAt==null?'unavailable':!fresh?'expired':value.refreshStatus==='unavailable'?'refresh_failed':'fresh',reportedAt:value?.reportedAt??null,claude:['haiku','sonnet','opus'],source:'desktop_account_catalog',observedExecutionModels:false};}
 async validate(children){const catalog=await this.read();for(const child of children??[]){if(child.provider==='claude'&&!catalog.claude.includes(child.requestedModel))throw new ValidationError('Unsupported Claude role model');if(child.provider==='codex'&&!catalog.codex.some(m=>m.model===child.requestedModel&&m.efforts.includes(child.effort)))throw new ValidationError('Reconnect desktop to confirm the selected Codex model and effort before delegation');}}
}
