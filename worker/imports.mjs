import {prepareImport,importCopyId} from '../public/core/imports.mjs';
import {ValidationError} from '../public/core/tasks.mjs';
import {serializeTaskBody} from '../public/core/task-size.mjs';
export class RecordImporter {
 constructor(store){this.store=store;}
 async import(raw,{copy=false}={}){
  if(typeof copy!=='boolean')throw new ValidationError('copy must be a boolean');
  const prepared=await prepareImport(raw);const {hash}=prepared;let targetId=raw.id;
  const original=await this.store.getTask(targetId);
  if(original){
   if(await this.same(original,hash))return {status:'skipped',id:targetId};
   if(!copy)return {status:'conflict',id:targetId};
   targetId=await importCopyId(raw.id,hash);
  }
  const existing=await this.store.getTask(targetId);
  if(existing)return {status:await this.same(existing,hash)?'skipped':'conflict',id:targetId};
  const task={...prepared.task,id:targetId,version:1,provenance:{sourceId:raw.id,sourceHash:hash,sourceVersion:raw.version,importedAt:this.store.now()}};
  const results=await this.store.db.batch([
   this.store.db.prepare("INSERT OR IGNORE INTO tasks (id,version,updated_at,body,rev) VALUES (?1,?2,?3,?4,(SELECT value+1 FROM metadata WHERE key='revision'))").bind(task.id,task.version,task.updatedAt,serializeTaskBody(task,{growth:'grow'})),
   this.store.db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision' AND changes()=1"),
  ]);
  if(Number(results[0]?.meta?.changes)===1)return {status:'created',id:task.id};
  const raced=await this.store.requireTask(targetId);return {status:await this.same(raced,hash)?'skipped':'conflict',id:targetId};
 }
 async same(task,hash){if(task.provenance?.sourceHash===hash)return true;try{return (await prepareImport(task)).hash===hash;}catch{return false;}}
}
