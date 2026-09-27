import {createModelPolicyMethods} from '../worker/model-policies.mjs';
import {TASK_PINS_SQL,parseTaskEvidencePins} from '../worker/policy-retention.mjs';

// Async facade matches D1; each SQLite mutation is a single immediate transaction.
export class SqliteModelPolicies{
 constructor(db,options={}){
  if(!db)throw new TypeError('SQLite database is required');
  db.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL); INSERT OR IGNORE INTO metadata(key,value) VALUES ('revision',0);");
  const transaction=operation=>{
   db.exec('BEGIN IMMEDIATE');
   try{const result=operation();db.exec('COMMIT');return result;}
   catch(error){db.exec('ROLLBACK');throw error;}
  };
  const adapter={
   read:async key=>db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value??null,
   list:async(after,limit)=>db.prepare("SELECT key,value FROM metadata WHERE key LIKE 'model_policy:%' AND key>? ORDER BY key LIMIT ?").all(after,limit),
   taskPins:async()=>({revision:Number(db.prepare("SELECT value FROM metadata WHERE key='revision'").get()?.value??0),ids:parseTaskEvidencePins(db.prepare(TASK_PINS_SQL).all())}),
   writeStatus:async(text,priorRaw)=>transaction(()=>db.prepare("INSERT INTO metadata(key,value) SELECT 'model_policy_retention_status',? WHERE (? IS NULL AND NOT EXISTS(SELECT 1 FROM metadata WHERE key='model_policy_retention_status')) OR (SELECT value FROM metadata WHERE key='model_policy_retention_status')=? ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE metadata.value=?").run(text,priorRaw,priorRaw,priorRaw).changes===1),
   create:async(key,text,limit)=>transaction(()=>{
    const result=db.prepare("INSERT INTO metadata(key,value) SELECT ?,? WHERE (SELECT COUNT(*) FROM metadata WHERE key LIKE 'model_policy:%') < ? ON CONFLICT(key) DO NOTHING").run(key,text,limit);
    if(result.changes)db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision'").run();
    return result.changes===1;
   }),
   compareAndSwap:async(key,version,text,revision)=>transaction(()=>{
    const result=db.prepare("UPDATE metadata SET value=? WHERE key=? AND json_extract(value,'$.stateVersion')=? AND (? IS NULL OR (SELECT value FROM metadata WHERE key='revision')=?)").run(text,key,version,revision??null,revision??null);
    if(result.changes)db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision'").run();
    return result.changes===1;
   }),
  };
  Object.assign(this,createModelPolicyMethods(adapter,options));
 }
}
