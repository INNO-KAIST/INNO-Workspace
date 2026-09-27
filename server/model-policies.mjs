import {createModelPolicyMethods} from '../worker/model-policies.mjs';

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
   create:async(key,text,limit)=>transaction(()=>{
    const result=db.prepare("INSERT INTO metadata(key,value) SELECT ?,? WHERE (SELECT COUNT(*) FROM metadata WHERE key LIKE 'model_policy:%') < ? ON CONFLICT(key) DO NOTHING").run(key,text,limit);
    if(result.changes)db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision'").run();
    return result.changes===1;
   }),
   compareAndSwap:async(key,version,text)=>transaction(()=>{
    const result=db.prepare("UPDATE metadata SET value=? WHERE key=? AND json_extract(value,'$.stateVersion')=?").run(text,key,version);
    if(result.changes)db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision'").run();
    return result.changes===1;
   }),
  };
  Object.assign(this,createModelPolicyMethods(adapter,options));
 }
}
