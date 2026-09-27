import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
import {createTask} from '../public/core/tasks.mjs';

const key=id=>'desktop_receipt:'+id;
const read=(db,id)=>db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key(id)).first();
const revision=db=>db.prepare("SELECT value FROM metadata WHERE key='revision'").first();
async function fixture(t){
 const db=new TestD1();t.after(()=>db.close());
 const store=new D1TaskStore(db,{now:()=>new Date('2026-09-28T00:00:00.000Z').toISOString()});
 const workspaceId=await workspaceIdentity(db);
 const created=await store.createTask({prompt:'Check one result'});
 const queued=await store.replaceTask(created.id,created.version,c=>({...c,status:'queued',version:c.version+1,updatedAt:store.now(),checkpoint:{...c.checkpoint,provider:'codex',status:'queued'}}));
 const owner=await store.claimExecution(queued.id,{provider:'codex',expectedVersion:queued.version});
 const input={executionId:owner.executionId,generation:owner.generation,content:'saved'};
 const descriptor=await createDeliveryReceipt({workspaceId,taskId:queued.id,action:'complete',input});
 const complete=c=>({...c,status:'completed',version:c.version+1,updatedAt:store.now(),checkpoint:{...c.checkpoint,status:'completed'}});
 return {db,store,workspaceId,current:owner.task,descriptor,input,complete};
}

test('opt-in completion atomically stores only a validated descriptor alongside task and revision',async t=>{
 const f=await fixture(t),before=Number((await revision(f.db)).value);
 const next=await f.store.replaceTask(f.current.id,f.current.version,f.complete,undefined,{deliveryReceipt:f.descriptor});
 assert.equal(next.status,'completed');assert.equal(Number((await revision(f.db)).value),before+1);
 const stored=JSON.parse((await read(f.db,f.descriptor.id)).value);
 assert.deepEqual(stored,{...f.descriptor,acceptedAt:'2026-09-28T00:00:00.000Z'});
 assert.equal(JSON.stringify(stored).includes('saved'),false);
});

test('ordinary update stays receipt-free and receipt cannot attach to a renew-running transition',async t=>{
 const f=await fixture(t);
 await assert.rejects(()=>f.store.replaceTask(f.current.id,f.current.version,c=>({...c,version:c.version+1,updatedAt:f.store.now(),checkpoint:{...c.checkpoint,expiresAt:'2026-09-29T00:00:00.000Z'}}),undefined,{deliveryReceipt:f.descriptor}),e=>e?.statusCode===400);
 assert.equal((await f.store.requireTask(f.current.id)).version,f.current.version);
 assert.equal(await read(f.db,f.descriptor.id),null);
 await f.store.replaceTask(f.current.id,f.current.version,f.complete);
 assert.equal(await read(f.db,f.descriptor.id),null);
});

test('CAS loser and receipt insert error leave no receipt or half transition',async t=>{
 const f=await fixture(t),original=f.db.batch.bind(f.db),beforeRevision=Number((await revision(f.db)).value);
 f.db.batch=async statements=>{
  f.db.batch=original;
  const changed={...f.current,version:f.current.version+1,status:'paused'};
  f.db.db.prepare('UPDATE tasks SET version=?,body=? WHERE id=?').run(changed.version,JSON.stringify(changed),f.current.id);
  return original(statements);
 };
 await assert.rejects(()=>f.store.replaceTask(f.current.id,f.current.version,f.complete,undefined,{deliveryReceipt:f.descriptor}),e=>e?.statusCode===409);
 assert.equal(await read(f.db,f.descriptor.id),null);
 assert.equal(Number((await revision(f.db)).value),beforeRevision);
 const g=await fixture(t),secondRevision=Number((await revision(g.db)).value);
 g.db.db.exec("CREATE TRIGGER receipt_abort BEFORE INSERT ON metadata WHEN NEW.key GLOB 'desktop_receipt:*' BEGIN SELECT RAISE(ABORT, 'receipt disk failure'); END");
 await assert.rejects(()=>g.store.replaceTask(g.current.id,g.current.version,g.complete,undefined,{deliveryReceipt:g.descriptor}),/receipt disk failure/);
 assert.equal((await g.store.requireTask(g.current.id)).status,'running');
 assert.equal(Number((await revision(g.db)).value),secondRevision);
 assert.equal(await read(g.db,g.descriptor.id),null);
});

test('invalid descriptor, owner, workspace, and digest are rejected without writes',async t=>{
 const f=await fixture(t),before=Number((await revision(f.db)).value);
 for(const descriptor of [
  {...f.descriptor,taskId:'other'},
  {...f.descriptor,workspaceId:'d7daf2fb-ed34-4da0-bacc-24ac2dcb254b'},
  {...f.descriptor,executionId:'other'},
  {...f.descriptor,payloadDigest:'g'.repeat(64)},
  {...f.descriptor,id:'0'.repeat(64)},
  {...f.descriptor,unexpected:'raw'},
 ])await assert.rejects(()=>f.store.replaceTask(f.current.id,f.current.version,f.complete,undefined,{deliveryReceipt:descriptor}),e=>e?.statusCode===400||e?.statusCode===409);
 assert.equal((await f.store.requireTask(f.current.id)).version,f.current.version);
 assert.equal(Number((await revision(f.db)).value),before);
 assert.equal(await read(f.db,f.descriptor.id),null);
});

test('receipt cannot be attached to a Claude owner or a fail action without failure transition',async t=>{
 const f=await fixture(t),fail=await createDeliveryReceipt({workspaceId:f.workspaceId,taskId:f.current.id,action:'fail',input:f.input});
 await assert.rejects(()=>f.store.replaceTask(f.current.id,f.current.version,f.complete,undefined,{deliveryReceipt:fail}),e=>e?.statusCode===400);
 await assert.rejects(()=>f.store.replaceTask(f.current.id,f.current.version,c=>({...f.complete(c),checkpoint:{...c.checkpoint,provider:'claude',status:'completed'}}),undefined,{deliveryReceipt:f.descriptor}),e=>e?.statusCode===400);
 assert.equal(await read(f.db,fail.id),null);
});

test('descriptor is captured before the asynchronous digest and cannot be changed by its caller',async t=>{
 const f=await fixture(t),original=f.descriptor;
 let scheduled=false;
 const mutable=new Proxy({...original},{get(target,property){
  if(property==='id'&&!scheduled){scheduled=true;queueMicrotask(()=>{target.payloadDigest='0'.repeat(64);});}
  return target[property];
 }});
 await f.store.replaceTask(f.current.id,f.current.version,f.complete,undefined,{deliveryReceipt:mutable});
 assert.equal(JSON.parse((await read(f.db,original.id)).value).payloadDigest,original.payloadDigest);
});

test('a saved master review decision can carry the accepted completion receipt',async t=>{
 const f=await fixture(t);
 const current=await f.store.replaceTask(f.current.id,f.current.version,c=>({...c,version:c.version+1,delegation:{state:'reviewing',batchId:'batch',epoch:1}}));
 const next=c=>({...c,status:'waiting_user',version:c.version+1,updatedAt:f.store.now(),decision:{prompt:'Review needs input',options:[{label:'A',pros:'yes',cons:'no'},{label:'B',pros:'no',cons:'yes'}],createdAt:f.store.now()},checkpoint:{...c.checkpoint,status:'waiting_user'}});
 await f.store.replaceTask(current.id,current.version,next,undefined,{deliveryReceipt:f.descriptor});
 assert.ok(await read(f.db,f.descriptor.id));
});

test('incomplete review decision cannot be treated as accepted result',async t=>{
 const f=await fixture(t);
 const current=await f.store.replaceTask(f.current.id,f.current.version,c=>({...c,version:c.version+1,delegation:{state:'reviewing',batchId:'batch',epoch:1}}));
 await assert.rejects(()=>f.store.replaceTask(current.id,current.version,c=>({...c,status:'waiting_user',version:c.version+1,updatedAt:f.store.now(),decision:{prompt:'Missing options'},checkpoint:{...c.checkpoint,status:'waiting_user'}}),undefined,{deliveryReceipt:f.descriptor}),e=>e?.statusCode===400);
 assert.equal(await read(f.db,f.descriptor.id),null);
});

test('delegation receipt requires every child insert and rolls back a zero-write child',async t=>{
 const f=await fixture(t),parent=f.current,batchId='batch-1';
 const children=['a','b'].map(id=>({...createTask({prompt:id},{now:f.store.now,id:()=>id}),id,parentTaskId:parent.id,batchId,parentEpoch:1,status:'queued',checkpoint:{provider:'codex',status:'queued',generation:0}}));
 const next={...parent,status:'waiting_children',version:parent.version+1,updatedAt:f.store.now(),delegation:{state:'waiting_children',batchId,epoch:1,sourceExecutionId:parent.checkpoint.executionId,sourceGeneration:parent.checkpoint.generation,children:children.map(child=>({taskId:child.id}))},checkpoint:{...parent.checkpoint,status:'waiting_children',executionId:undefined}};
 f.db.db.exec("CREATE TRIGGER child_ignore BEFORE INSERT ON tasks WHEN NEW.id='b' BEGIN SELECT RAISE(IGNORE); END");
 const before=Number((await revision(f.db)).value);
 await assert.rejects(()=>f.store.replaceDelegation(parent,next,children.map(child=>({next:child})),[],{deliveryReceipt:f.descriptor}));
 assert.equal((await f.store.requireTask(parent.id)).status,'running');
 assert.equal((await f.store.listTasks()).length,1);
 assert.equal(Number((await revision(f.db)).value),before);
 assert.equal(await read(f.db,f.descriptor.id),null);
});

test('accepted fail and handoff transitions retain the original execution owner in the receipt',async t=>{
 const failure=await fixture(t);
 const failedReceipt=await createDeliveryReceipt({workspaceId:failure.workspaceId,taskId:failure.current.id,action:'fail',input:failure.input});
 const failed=await failure.store.replaceTask(failure.current.id,failure.current.version,c=>({...c,status:'waiting_quota',version:c.version+1,updatedAt:failure.store.now(),checkpoint:{...c.checkpoint,status:'waiting_quota',failure:{kind:'quota'}}}),undefined,{deliveryReceipt:failedReceipt});
 assert.equal(failed.status,'waiting_quota');assert.ok(await read(failure.db,failedReceipt.id));
 const handoff=await fixture(t);
 const queued=await handoff.store.replaceTask(handoff.current.id,handoff.current.version,c=>({...c,status:'queued',version:c.version+1,updatedAt:handoff.store.now(),checkpoint:{...c.checkpoint,status:'queued',provider:'claude',executionId:undefined,handoff:{executionId:handoff.input.executionId,generation:handoff.input.generation,from:'codex',to:'claude'}}}),undefined,{deliveryReceipt:handoff.descriptor});
 assert.equal(queued.checkpoint.executionId,undefined);assert.ok(await read(handoff.db,handoff.descriptor.id));
});

test('accepted delegation stores one receipt with parent, both children, and one revision',async t=>{
 const f=await fixture(t),batchId='accepted-batch',before=Number((await revision(f.db)).value);
 const children=['c','d'].map(id=>({...createTask({prompt:id},{now:f.store.now,id:()=>id}),id,parentTaskId:f.current.id,batchId,parentEpoch:1,status:'queued',checkpoint:{provider:'codex',status:'queued',generation:0}}));
 const next={...f.current,status:'waiting_children',version:f.current.version+1,updatedAt:f.store.now(),delegation:{state:'waiting_children',batchId,epoch:1,sourceExecutionId:f.input.executionId,sourceGeneration:f.input.generation,children:children.map(child=>({taskId:child.id}))},checkpoint:{...f.current.checkpoint,status:'waiting_children',executionId:undefined}};
 await f.store.replaceDelegation(f.current,next,children.map(child=>({next:child})),[],{deliveryReceipt:f.descriptor});
 assert.equal((await f.store.listTasks()).length,3);assert.ok(await read(f.db,f.descriptor.id));
 assert.equal(Number((await revision(f.db)).value),before+1);
});

test('workspace rotation between validation and batch prevents any accepted write',async t=>{
 const f=await fixture(t),before=Number((await revision(f.db)).value),original=f.db.batch.bind(f.db);
 f.db.batch=async statements=>{
  f.db.batch=original;
  f.db.db.prepare("UPDATE metadata SET value=? WHERE key='desktop_workspace_id'").run('4f97f3de-f454-4fd0-b125-d4033ff8a5c8');
  return original(statements);
 };
 await assert.rejects(()=>f.store.replaceTask(f.current.id,f.current.version,f.complete,undefined,{deliveryReceipt:f.descriptor}));
 assert.equal((await f.store.requireTask(f.current.id)).status,'running');
 assert.equal(Number((await revision(f.db)).value),before);
 assert.equal(await read(f.db,f.descriptor.id),null);
});

test('existing receipt key cannot be overwritten or leave a later transition committed',async t=>{
 const f=await fixture(t),before=Number((await revision(f.db)).value);
 await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(key(f.descriptor.id),'prior').run();
 await assert.rejects(()=>f.store.replaceTask(f.current.id,f.current.version,f.complete,undefined,{deliveryReceipt:f.descriptor}));
 assert.equal((await f.store.requireTask(f.current.id)).status,'running');
 assert.equal(Number((await revision(f.db)).value),before);
 assert.equal((await read(f.db,f.descriptor.id)).value,'prior');
});

test('delegation receipt rejects forged current ownership, wrong next version, or missing frozen children',async t=>{
 for(const fault of ['forged','version','child']){
  const f=await fixture(t),batchId='guarded-batch';
  const children=['one','two'].map(id=>({...createTask({prompt:id},{now:f.store.now,id:()=>id}),id,parentTaskId:f.current.id,batchId,parentEpoch:1,status:'queued',checkpoint:{provider:'codex',status:'queued',generation:0}}));
  const next={...f.current,status:'waiting_children',version:f.current.version+1,updatedAt:f.store.now(),delegation:{state:'waiting_children',batchId,epoch:1,sourceExecutionId:f.input.executionId,sourceGeneration:f.input.generation,children:children.map(child=>({taskId:child.id}))},checkpoint:{...f.current.checkpoint,status:'waiting_children',executionId:undefined}};
  if(fault==='forged'){
   const stored={...f.current,status:'paused',checkpoint:{...f.current.checkpoint,interruptedBy:undefined}};
   f.db.db.prepare('UPDATE tasks SET body=? WHERE id=?').run(JSON.stringify(stored),stored.id);
  }
  if(fault==='version')next.version=f.current.version;
  const records=(fault==='child'?children.slice(0,1):children).map(child=>({next:child}));
  const before=Number((await revision(f.db)).value);
  await assert.rejects(()=>f.store.replaceDelegation(f.current,next,records,[],{deliveryReceipt:f.descriptor}));
  assert.equal(Number((await revision(f.db)).value),before);
  assert.equal(await read(f.db,f.descriptor.id),null);
 }
});

test('a task-only waiting_children write cannot claim a delegated result receipt',async t=>{
 const f=await fixture(t),before=Number((await revision(f.db)).value);
 await assert.rejects(()=>f.store.replaceTask(f.current.id,f.current.version,c=>({...c,status:'waiting_children',version:c.version+1,updatedAt:f.store.now(),delegation:{state:'waiting_children',sourceExecutionId:f.input.executionId,sourceGeneration:f.input.generation},checkpoint:{...c.checkpoint,status:'waiting_children',executionId:undefined}}),undefined,{deliveryReceipt:f.descriptor}),e=>e?.statusCode===400);
 assert.equal((await f.store.requireTask(f.current.id)).status,'running');
 assert.equal(Number((await revision(f.db)).value),before);
 assert.equal(await read(f.db,f.descriptor.id),null);
});

test('an explicitly supplied empty receipt fails closed instead of becoming a legacy write',async t=>{
 for(const supplied of [null,false,0,'']){
  const f=await fixture(t),before=Number((await revision(f.db)).value);
  await assert.rejects(()=>f.store.replaceTask(f.current.id,f.current.version,f.complete,undefined,{deliveryReceipt:supplied}),e=>e?.statusCode===400);
  assert.equal((await f.store.requireTask(f.current.id)).status,'running');
  assert.equal(Number((await revision(f.db)).value),before);
 }
});

test('receipt-bound delegation rejects cross-child ID pairs and child version skips',async t=>{
 for(const fault of ['swapped','version']){
  const f=await fixture(t),batchId='existing-batch';
  const beforeChildren=['left','right'].map(id=>({...createTask({prompt:id},{now:f.store.now,id:()=>id}),id,parentTaskId:f.current.id,batchId,parentEpoch:1,status:'queued',checkpoint:{provider:'codex',status:'queued',generation:0}}));
  const parent=await f.store.replaceTask(f.current.id,f.current.version,c=>({...c,version:c.version+1,delegation:{state:'reviewing',batchId,epoch:1,children:beforeChildren.map(child=>({taskId:child.id}))}}));
  for(const child of beforeChildren)await f.db.prepare('INSERT INTO tasks(id,version,updated_at,body) VALUES(?1,?2,?3,?4)').bind(child.id,child.version,child.updatedAt,JSON.stringify(child)).run();
  const next={...parent,status:'waiting_children',version:parent.version+1,updatedAt:f.store.now(),delegation:{...parent.delegation,state:'waiting_children',epoch:2,lastReviewRetry:{executionId:f.input.executionId,generation:f.input.generation}},checkpoint:{...parent.checkpoint,status:'waiting_children',executionId:undefined}};
  const afterChildren=beforeChildren.map(child=>({...child,version:child.version+1,parentEpoch:2}));
  if(fault==='version')afterChildren[0].version=99;
  const records=beforeChildren.map((current,index)=>({current,next:afterChildren[fault==='swapped'?1-index:index]}));
  const before=Number((await revision(f.db)).value);
  await assert.rejects(()=>f.store.replaceDelegation(parent,next,records,[],{deliveryReceipt:f.descriptor}),e=>e?.statusCode===400);
  assert.equal((await f.store.requireTask(parent.id)).status,'running');
  assert.equal(Number((await revision(f.db)).value),before);
  assert.equal(await read(f.db,f.descriptor.id),null);
 }
});

test('review retry receipt keeps an unchanged completed child and updates only the selected sibling',async t=>{
 const f=await fixture(t),batchId='review-batch';
 const children=['kept','retry'].map(id=>({...createTask({prompt:id},{now:f.store.now,id:()=>id}),id,parentTaskId:f.current.id,batchId,parentEpoch:1,status:'completed',checkpoint:{provider:'codex',status:'completed',generation:1}}));
 const parent=await f.store.replaceTask(f.current.id,f.current.version,c=>({...c,version:c.version+1,delegation:{state:'reviewing',batchId,epoch:1,children:children.map(child=>({taskId:child.id}))}}));
 for(const child of children)await f.db.prepare('INSERT INTO tasks(id,version,updated_at,body) VALUES(?1,?2,?3,?4)').bind(child.id,child.version,child.updatedAt,JSON.stringify(child)).run();
 const next={...parent,status:'waiting_children',version:parent.version+1,updatedAt:f.store.now(),delegation:{...parent.delegation,state:'waiting_children',epoch:2,lastReviewRetry:{executionId:f.input.executionId,generation:f.input.generation}},checkpoint:{...parent.checkpoint,status:'waiting_children',executionId:undefined}};
 const queued={...children[1],status:'queued',version:children[1].version+1,parentEpoch:2,checkpoint:{...children[1].checkpoint,status:'queued'}};
 await f.store.replaceDelegation(parent,next,[{current:children[0]},{current:children[1],next:queued}],[],{deliveryReceipt:f.descriptor});
 assert.equal((await f.store.requireTask(children[0].id)).status,'completed');
 assert.equal((await f.store.requireTask(children[1].id)).status,'queued');
 assert.ok(await read(f.db,f.descriptor.id));
});
