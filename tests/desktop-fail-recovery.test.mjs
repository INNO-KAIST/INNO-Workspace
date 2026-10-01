import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {D1_SCHEMA,D1TaskStore} from '../worker/store.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
class Statement{
 constructor(db,sql,values=[]){this.db=db;this.sql=sql;this.values=values;}
 bind(...values){return new Statement(this.db,this.sql,values);}
 async first(){return this.db.prepare(this.sql).get(...this.values)??null;}
 async all(){return {success:true,results:this.db.prepare(this.sql).all(...this.values)};}
 async run(){const r=this.db.prepare(this.sql).run(...this.values);return {success:true,meta:{changes:Number(r.changes)}};}
}
class Database{
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(D1_SCHEMA);}
 prepare(sql){return new Statement(this.db,sql);}
 async batch(statements){this.db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
async function running(){
 const store=new D1TaskStore(new Database()),bridge=new CloudBridge(store),task=await store.createTask({prompt:'work'});
 await bridge.enqueue(task.id,{expectedVersion:task.version});const c=await bridge.claim();
 return {store,bridge,id:task.id,owner:{executionId:c.executionId,generation:c.generation}};
}
const failure={failure:{kind:'connection'}};
async function leaseExpire(store,id){
 const t=await store.requireTask(id);
 return store.replaceTask(id,t.version,current=>({...current,status:'paused',version:current.version+1,updatedAt:store.now(),checkpoint:{...current.checkpoint,status:'paused',interruptedBy:'lease_expiry',interruptedVersion:current.version+1}}));
}

test('a failure from the same owner is recorded after an automatic lease-expiry pause',async()=>{
 const {store,bridge,id,owner}=await running();await leaseExpire(store,id);
 const t=await bridge.fail(id,{...owner,...failure});
 assert.equal(t.status,'failed');assert.equal(t.checkpoint.failure.kind,'connection');
 const replay=await bridge.fail(id,{...owner,...failure});assert.equal(replay.version,t.version);
});

test('a manual pause still fences a late failure from the old owner',async()=>{
 const {store,bridge,id,owner}=await running();const t=await store.requireTask(id);
 await store.applyAction(id,{action:'pause',expectedVersion:t.version});
 await assert.rejects(()=>bridge.fail(id,{...owner,...failure}),{name:'ConflictError'});
 assert.equal((await store.requireTask(id)).status,'paused');
});

test('a lease-expiry pause changed afterwards no longer accepts the late failure',async()=>{
 const {store,bridge,id,owner}=await running();const paused=await leaseExpire(store,id);
 await store.replaceTask(id,paused.version,current=>({...current,version:current.version+1,updatedAt:store.now()}));
 await assert.rejects(()=>bridge.fail(id,{...owner,...failure}),{name:'ConflictError'});
});

test('a different owner cannot use the lease-expiry recovery',async()=>{
 const {store,bridge,id,owner}=await running();await leaseExpire(store,id);
 await assert.rejects(()=>bridge.fail(id,{...owner,generation:owner.generation+1,...failure}),{name:'ConflictError'});
});

test('failure delivery retries a concurrent version change instead of rejecting it',async()=>{
 const {store,bridge,id,owner}=await running();const replace=store.replaceTask.bind(store);let inject=true;
 store.replaceTask=async(taskId,version,update,...rest)=>{if(inject){inject=false;await replace(taskId,version,t=>({...t,version:t.version+1,updatedAt:store.now()}));}return replace(taskId,version,update,...rest);};
 const t=await bridge.fail(id,{...owner,...failure});assert.equal(t.status,'failed');
});

test('renewal retries a concurrent version change instead of ending ownership',async()=>{
 const {store,bridge,id,owner}=await running();const replace=store.replaceTask.bind(store);let inject=true;
 store.replaceTask=async(taskId,version,update,...rest)=>{if(inject){inject=false;await replace(taskId,version,t=>({...t,version:t.version+1,updatedAt:store.now()}));}return replace(taskId,version,update,...rest);};
 const t=await bridge.renew(id,owner);assert.equal(t.status,'running');
});

test('renewal still rejects a stale owner after bounded retries',async()=>{
 const {bridge,id,owner}=await running();
 await assert.rejects(()=>bridge.renew(id,{...owner,generation:owner.generation+1}),{name:'ConflictError'});
});
