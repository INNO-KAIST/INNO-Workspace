import {ValidationError} from '../public/core/tasks.mjs';
const efforts=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
export class ModelCatalog {
 constructor(store){this.store=store;}
 async report(rows){
  if(!Array.isArray(rows)||rows.length>100)throw new ValidationError('Invalid desktop model catalog');
  const models=rows.map(row=>{if(!row||typeof row.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(row.model)||!Array.isArray(row.efforts)||row.efforts.length>8||row.efforts.some(e=>!efforts.has(e)))throw new ValidationError('Invalid desktop model entry');return {model:row.model,efforts:[...new Set(row.efforts)],isDefault:row.isDefault===true};});
  if(new Set(models.map(m=>m.model)).size!==models.length)throw new ValidationError('Duplicate desktop model');
  const previous=await this.stored(),now=Date.parse(this.store.now());
  if(previous&&JSON.stringify(previous.models)===JSON.stringify(models)&&now-previous.reportedAt<3600000)return;
  await this.store.db.prepare("INSERT INTO metadata(key,value) VALUES('desktop_models',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({models,reportedAt:now})).run();
 }
 async stored(){const row=await this.store.db.prepare("SELECT value FROM metadata WHERE key='desktop_models'").first();if(!row)return null;try{return JSON.parse(row.value)}catch{return null}}
 async read(){const value=await this.stored();return {codex:value&&Date.parse(this.store.now())-value.reportedAt<7200000?value.models:[],reportedAt:value?.reportedAt??null,claude:['haiku','sonnet','opus'],source:'desktop_account_catalog',observedExecutionModels:false};}
 async validate(children){const catalog=await this.read();for(const child of children??[]){if(child.provider==='claude'&&!catalog.claude.includes(child.requestedModel))throw new ValidationError('Unsupported Claude role model');if(child.provider==='codex'&&!catalog.codex.some(m=>m.model===child.requestedModel&&m.efforts.includes(child.effort)))throw new ValidationError('Reconnect desktop to confirm the selected Codex model and effort before delegation');}}
}
