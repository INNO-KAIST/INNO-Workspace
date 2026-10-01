import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';
import {reservationKey,prepareReceiptReservation} from '../worker/delivery-reservations.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
import {releaseDeliveryReservation} from '../worker/delivery-recovery.mjs';
async function fixture(t,state='paused'){
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),workspaceId=await workspaceIdentity(db);
 const task=await store.createTask({prompt:'Check one result'}),owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version},{deliveryReceiptVersion:1,workspaceId});
 const current=state==='running'?owner.task:await store.applyAction(task.id,{action:state==='cancelled'?'cancel':'pause',expectedVersion:owner.task.version});
 const key=await reservationKey({workspaceId,taskId:task.id,...owner}),row=await db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first(),reservation=JSON.parse(row.value);
 const input={reservation,expectedVersion:current.version,confirmDiscard:true};
 const read=()=>db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first();
 const taskRow=()=>db.prepare('SELECT id,version,body FROM tasks WHERE id=?1').bind(task.id).first();
 const revision=()=>db.prepare("SELECT value FROM metadata WHERE key='revision'").first();
 const receiptKey=async action=>'desktop_receipt:'+(await createDeliveryReceipt({workspaceId,taskId:task.id,action,input:{executionId:owner.executionId,generation:owner.generation}})).id;
 return {db,store,workspaceId,task,owner,current,key,reservation,input,read,taskRow,revision,receiptKey,release:()=>releaseDeliveryReservation(db,input)};
}
const conflict=error=>error.statusCode===409;
const invalid=error=>[400,409].includes(error.statusCode);
function beforeDelete(f,action){const original=f.db.prepare.bind(f.db);let done=false;f.db.prepare=sql=>{const statement=original(sql);if(!/^DELETE FROM metadata/.test(sql))return statement;return {bind:(...values)=>{const bound=statement.bind(...values);return {run:async()=>{if(!done){done=true;await action(original);}return bound.run();}};}};};}
test('explicit discard releases paused or cancelled reservation without task/revision mutation',async t=>{
 for(const state of ['paused','cancelled']){const f=await fixture(t,state),before=await f.taskRow(),revision=await f.revision();assert.deepEqual(await f.release(),{reservation:f.reservation,released:true});assert.equal(await f.read(),null);assert.deepEqual(await f.taskRow(),before);assert.deepEqual(await f.revision(),revision);}
});
test('input requires exact fields, canonical identifiers and explicit discard confirmation before database work',async t=>{
 const f=await fixture(t);const bad=[null,{}, {...f.input,confirmDiscard:false},{...f.input,confirmDiscard:1},{...f.input,extra:true},{...f.input,expectedVersion:0},{...f.input,expectedVersion:1.5},{...f.input,reservation:{...f.reservation,extra:true}},{...f.input,reservation:{...f.reservation,version:2}},{...f.input,reservation:{...f.reservation,workspaceId:'bad'}},{...f.input,reservation:{...f.reservation,taskId:' '}},{...f.input,reservation:{...f.reservation,executionId:'a'.repeat(201)}},{...f.input,reservation:{...f.reservation,generation:0}},{...f.input,reservation:{...f.reservation,claimedAt:'2026-01-01'}}];
 let reads=0;const original=f.db.prepare.bind(f.db);f.db.prepare=sql=>{reads++;return original(sql);};for(const input of bad)await assert.rejects(()=>releaseDeliveryReservation(f.db,input),invalid);assert.equal(reads,0);
});
test('running owner remains protected even after its lease expires',async t=>{
 const f=await fixture(t,'running'),task={...f.owner.task,checkpoint:{...f.owner.task.checkpoint,expiresAt:'2000-01-01T00:00:00.000Z'}};await f.db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify(task),task.id).run();await assert.rejects(f.release,conflict);assert.ok(await f.read());
});
test('release frees a capacity slot and preserves reservations for other generations',async t=>{
 const f=await fixture(t),other={...f.reservation,generation:f.reservation.generation+1},otherKey=await reservationKey(other);await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(otherKey,JSON.stringify(other)).run();
 for(let i=0;i<1022;i++)await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind('desktop_receipt:held'+i,'held').run();
 const next=await f.store.createTask({prompt:'New claim'}),claim=()=>f.store.claimExecution(next.id,{provider:'codex',expectedVersion:next.version},{deliveryReceiptVersion:1,workspaceId:f.workspaceId});await assert.rejects(claim,error=>error.code==='DESKTOP_DELIVERY_CAPACITY');await f.release();assert.ok(await f.db.prepare('SELECT value FROM metadata WHERE key=?1').bind(otherKey).first());assert.equal((await claim()).task.checkpoint.deliveryReceiptVersion,1);
});
for(const action of ['complete','fail'])test(`${action} receipt existence blocks discard even when receipt data is corrupt`,async t=>{
 for(const raw of ['{broken','null','{"acceptedAt":"known"}']){const f=await fixture(t),key=await f.receiptKey(action);await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(key,raw).run();await assert.rejects(f.release,conflict);assert.ok(await f.read());assert.equal((await f.db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first()).value,raw);}
});
test('wrong workspace, expected version, missing or inconsistent task and mismatched stored reservation are preserved',async t=>{
 for(const kind of ['workspace','version','missing_task','task_id','body_version','reservation','broken_reservation']){
  const f=await fixture(t);if(kind==='workspace')await f.db.prepare("UPDATE metadata SET value='22222222-2222-4222-8222-222222222222' WHERE key='desktop_workspace_id'").run();
  if(kind==='version')f.input.expectedVersion++;
  if(kind==='missing_task')await f.db.prepare('DELETE FROM tasks WHERE id=?1').bind(f.task.id).run();
  if(['task_id','body_version'].includes(kind)){const body={...f.current,...(kind==='task_id'?{id:'wrong'}:{version:f.current.version+1})};await f.db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify(body),f.task.id).run();}
  if(['reservation','broken_reservation'].includes(kind))await f.db.prepare('UPDATE metadata SET value=?1 WHERE key=?2').bind(kind==='reservation'?JSON.stringify({...f.reservation,claimedAt:'2000-01-01T00:00:00.000Z'}):'{broken',f.key).run();
  await assert.rejects(f.release,conflict);assert.ok(await f.read());
 }
});
for(const kind of ['workspace','task_body','task_version','reservation','receipt_complete','receipt_fail'])test(`DELETE race with ${kind} change preserves reservation and conflicts`,async t=>{
 const f=await fixture(t),receiptKey=kind.startsWith('receipt_')?await f.receiptKey(kind.slice(8)):null;
 beforeDelete(f,async prepare=>{
  if(kind==='workspace')await prepare("UPDATE metadata SET value='22222222-2222-4222-8222-222222222222' WHERE key='desktop_workspace_id'").run();
  if(kind==='task_body')await prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify({...f.current,title:'changed without version'}),f.task.id).run();
  if(kind==='task_version')await prepare('UPDATE tasks SET version=version+1 WHERE id=?1').bind(f.task.id).run();
  if(kind==='reservation')await prepare('UPDATE metadata SET value=?1 WHERE key=?2').bind(JSON.stringify({...f.reservation,claimedAt:'2000-01-01T00:00:00.000Z'}),f.key).run();
  if(receiptKey)await prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(receiptKey,'broken receipt still blocks').run();
 });await assert.rejects(f.release,conflict);assert.ok(await f.read());
});
test('concurrent identical release is idempotent but missing never asserts accepted or discarded result',async t=>{
 const f=await fixture(t),results=await Promise.all([f.release(),f.release()]);assert.equal(results.filter(r=>r.released).length,1);assert.deepEqual(results.find(r=>!r.released),{reservation:f.reservation,released:false,reason:'reservation_not_found'});assert.deepEqual(await f.release(),{reservation:f.reservation,released:false,reason:'reservation_not_found'});
});
test('zero DELETE with identical row still present is conflict rather than success',async t=>{
 const f=await fixture(t);f.db.db.exec("CREATE TRIGGER ignore_discard BEFORE DELETE ON metadata WHEN OLD.key GLOB 'desktop_reservation:*' BEGIN SELECT RAISE(IGNORE); END");await assert.rejects(f.release,conflict);assert.ok(await f.read());
});
test('caller mutation after invocation cannot redirect reservation or change expected version',async t=>{
 const f=await fixture(t),expected=structuredClone(f.reservation),operation=f.release();f.input.expectedVersion++;f.input.confirmDiscard=false;f.reservation.executionId='mutated';const released=await operation;assert.deepEqual(released,{reservation:expected,released:true});
});
test('late completion cannot be accepted after explicit reservation release',async t=>{
 const f=await fixture(t),input={executionId:f.owner.executionId,generation:f.owner.generation,content:'late'},receipt=await createDeliveryReceipt({workspaceId:f.workspaceId,taskId:f.task.id,action:'complete',input});
 const recoverable={...f.current,checkpoint:{...f.current.checkpoint,interruptedBy:'lease_expiry',interruptedVersion:f.current.version}};await f.db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify(recoverable),f.task.id).run();await f.release();
 await assert.rejects(()=>prepareReceiptReservation(f.db,receipt,f.owner.task),/reservation is missing/);
 const before=await f.taskRow(),revision=await f.revision();await assert.rejects(()=>f.store.finishExecution(f.task.id,input,{deliveryReceipt:receipt,recoverInterrupted:true}),/reservation is missing/);assert.deepEqual(await f.taskRow(),before);assert.deepEqual(await f.revision(),revision);assert.equal(await f.db.prepare('SELECT value FROM metadata WHERE key=?1').bind('desktop_receipt:'+receipt.id).first(),null);
});
test('unknown, absent, scalar and malformed task status/body cannot authorize discard',async t=>{
 for(const body of ['null','[]','{broken',JSON.stringify({status:'unknown'}),JSON.stringify({})]){const f=await fixture(t);await f.db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(body,f.task.id).run();await assert.rejects(f.release,conflict);assert.ok(await f.read());}
 const f=await fixture(t);await f.db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify({...f.current,status:'unknown'}),f.task.id).run();await assert.rejects(f.release,conflict);
});
test('raw-only reservation change is a CAS conflict and is never normalized away',async t=>{
 const f=await fixture(t),changed=JSON.stringify(f.reservation,null,2);beforeDelete(f,prepare=>prepare('UPDATE metadata SET value=?1 WHERE key=?2').bind(changed,f.key).run());await assert.rejects(f.release,conflict);assert.equal((await f.read()).value,changed);
});
test('zero DELETE with missing reservation still conflicts if the task changed during discard',async t=>{
 const f=await fixture(t);beforeDelete(f,async prepare=>{await prepare('DELETE FROM metadata WHERE key=?1').bind(f.key).run();await prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify({...f.current,title:'concurrently changed'}),f.task.id).run();});await assert.rejects(f.release,conflict);
});
test('concurrent actual late acceptance wins atomically and its receipt is never discarded',async t=>{
 const f=await fixture(t),recoverable={...f.current,checkpoint:{...f.current.checkpoint,interruptedBy:'lease_expiry',interruptedVersion:f.current.version}};await f.db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify(recoverable),f.task.id).run();
 const input={executionId:f.owner.executionId,generation:f.owner.generation,content:'late accepted'},receipt=await createDeliveryReceipt({workspaceId:f.workspaceId,taskId:f.task.id,action:'complete',input});
 beforeDelete(f,()=>f.store.finishExecution(f.task.id,input,{deliveryReceipt:receipt,recoverInterrupted:true}));await assert.rejects(f.release,conflict);assert.equal((await f.store.requireTask(f.task.id)).status,'completed');assert.equal(await f.read(),null);assert.ok(await f.db.prepare('SELECT value FROM metadata WHERE key=?1').bind('desktop_receipt:'+receipt.id).first());
});
test('discard after acceptance preflight fences its atomic batch without creating a receipt',async t=>{
 const f=await fixture(t),recoverable={...f.current,checkpoint:{...f.current.checkpoint,interruptedBy:'lease_expiry',interruptedVersion:f.current.version}};await f.db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify(recoverable),f.task.id).run();
 const input={executionId:f.owner.executionId,generation:f.owner.generation,content:'too late'},receipt=await createDeliveryReceipt({workspaceId:f.workspaceId,taskId:f.task.id,action:'complete',input}),before=await f.taskRow(),revision=await f.revision(),original=f.db.batch.bind(f.db);let discarded=false;
 f.db.batch=async statements=>{if(!discarded){discarded=true;assert.equal((await f.release()).released,true);}return original(statements);};
 await assert.rejects(()=>f.store.finishExecution(f.task.id,input,{deliveryReceipt:receipt,recoverInterrupted:true}));assert.equal(discarded,true);assert.deepEqual(await f.taskRow(),before);assert.deepEqual(await f.revision(),revision);assert.equal(await f.read(),null);assert.equal(await f.db.prepare('SELECT value FROM metadata WHERE key=?1').bind('desktop_receipt:'+receipt.id).first(),null);
});
