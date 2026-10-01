import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import exportedWorker,{createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {workspaceIdentity} from '../worker/workspace-identity.mjs';
import {reservationKey} from '../worker/delivery-reservations.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
const token='recovery-http-token-012345678901234';
async function fixture(t,{running=false}={}){
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),workspaceId=await workspaceIdentity(db),task=await store.createTask({prompt:'Recover delivery'});
 const owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version},{deliveryReceiptVersion:1,workspaceId});
 const current=running?owner.task:await store.applyAction(task.id,{action:'pause',expectedVersion:owner.task.version});
 const row=await db.prepare("SELECT key,value FROM metadata WHERE key GLOB 'desktop_reservation:*'").first(),reservation=JSON.parse(row.value);
 let external=0;const worker=createWorker({deliveryReceiptVersion:1,fetchFn:async()=>{external++;throw Error('no external requests');}}),env={DB:db,ACCESS_TOKEN:token};
 const post=async(action,input,{id=task.id,version='1',workspace=workspaceId,auth=true,target=worker}={})=>{
  const response=await target.fetch(new Request('https://inno.example/api/desktop/'+encodeURIComponent(id)+'/'+action,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{}),...(version!==null?{'x-inno-delivery-receipt-version':version}:{}),...(workspace!==null?{'x-inno-workspace-id':workspace}:{})},body:typeof input==='string'?input:JSON.stringify(input)}),env);return {status:response.status,...await response.json()};
 };
 const listing=extra=>({expectedVersion:current.version,...extra}),discard=()=>({reservation,expectedVersion:current.version,confirmDiscard:true});
 const snapshot=async()=>({tasks:(await db.prepare('SELECT * FROM tasks ORDER BY id').all()).results,metadata:(await db.prepare('SELECT key,value FROM metadata ORDER BY key').all()).results});
 return {db,store,workspaceId,task,owner,current,row,reservation,post,listing,discard,snapshot,external:()=>external};
}
async function seed(f,count){
 await f.db.prepare("DELETE FROM metadata WHERE key GLOB 'desktop_reservation:*'").run();const rows=[];
 for(let generation=1;generation<=count;generation++){const reservation={...f.reservation,generation},key=await reservationKey(reservation);await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(key,JSON.stringify(reservation)).run();rows.push({key,reservation});}
 return rows.sort((a,b)=>a.key.localeCompare(b.key));
}
test('recovery routes require auth, internal gate, version and workspace before body or writes',async t=>{
 const f=await fixture(t),before=await f.snapshot();
 for(const action of ['reservations','discard'])for(const options of [{auth:false},{version:null},{version:'2'},{workspace:null},{workspace:'22222222-2222-4222-8222-222222222222'},{target:exportedWorker}]){
  const response=await f.post(action,'{broken',options);assert.ok([400,401,409].includes(response.status),JSON.stringify(response));assert.notEqual(response.error,'request body must be valid JSON');
 }
 assert.deepEqual(await f.snapshot(),before);assert.equal(f.external(),0);
});
test('missing workspace identity is never initialized by either recovery route',async t=>{
 const f=await fixture(t);await f.db.prepare("DELETE FROM metadata WHERE key='desktop_workspace_id'").run();const before=await f.snapshot();
 for(const action of ['reservations','discard']){const response=await f.post(action,'{broken');assert.equal(response.status,409,JSON.stringify(response));assert.notEqual(response.error,'request body must be valid JSON');}
 assert.deepEqual(await f.snapshot(),before);
});
test('list is read-only, permits running tasks and returns explicit task version and workspace',async t=>{
 const f=await fixture(t,{running:true}),before=await f.snapshot(),response=await f.post('reservations',f.listing());assert.equal(response.status,200,JSON.stringify(response));assert.deepEqual(response.reservations,[f.reservation]);assert.equal(response.nextAfterKey,null);assert.equal(response.taskVersion,f.current.version);assert.equal(response.workspaceId,f.workspaceId);assert.deepEqual(await f.snapshot(),before);
});
test('strict listing body, cursor and expected task version reject without side effects',async t=>{
 const f=await fixture(t),before=await f.snapshot();
 for(const input of [null,[],{},f.listing({extra:true}),f.listing({expectedVersion:0}),f.listing({expectedVersion:f.current.version+1}),f.listing({afterKey:null}),f.listing({afterKey:'desktop_reservation:bad'}),f.listing({afterKey:'desktop_receipt:'+'a'.repeat(64)})]){const response=await f.post('reservations',input);assert.ok([400,409].includes(response.status),JSON.stringify(response));}
 assert.deepEqual(await f.snapshot(),before);
});
test('discard matches URL task and exact confirmed input, releases one reservation and reports missing idempotently',async t=>{
 const f=await fixture(t),before=await f.snapshot();for(const [input,options] of [[f.discard(),{id:'wrong'}],[{...f.discard(),confirmDiscard:false},{}],[{...f.discard(),models:{bad:true}},{}]])assert.ok([400,409].includes((await f.post('discard',input,options)).status));assert.deepEqual(await f.snapshot(),before);
 const first=await f.post('discard',f.discard());assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.released,true);assert.deepEqual(first.reservation,f.reservation);const duplicate=await f.post('discard',f.discard());assert.equal(duplicate.status,200);assert.equal(duplicate.released,false);assert.equal(duplicate.reason,'reservation_not_found');assert.deepEqual((await f.snapshot()).tasks,before.tasks);
});
test('HTTP discard preserves running reservations and any accepted complete or fail receipt',async t=>{
 const running=await fixture(t,{running:true});assert.equal((await running.post('discard',running.discard())).status,409);
 for(const action of ['complete','fail']){const f=await fixture(t),receipt=await createDeliveryReceipt({workspaceId:f.workspaceId,taskId:f.task.id,action,input:{executionId:f.owner.executionId,generation:f.owner.generation}});await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind('desktop_receipt:'+receipt.id,'malformed').run();const before=await f.snapshot();assert.equal((await f.post('discard',f.discard())).status,409);assert.deepEqual(await f.snapshot(),before);}
});
test('list rejects corrupt reservation values, mismatching keys or workspace, including unrelated task rows',async t=>{
 for(const kind of ['json','fields','key','workspace','other_task']){
  const f=await fixture(t),value=kind==='json'?'{broken':JSON.stringify({...f.reservation,...(kind==='fields'?{extra:1}:{}),...(kind==='workspace'?{workspaceId:'22222222-2222-4222-8222-222222222222'}:{}),...(kind==='other_task'?{taskId:'other'}:{})});
  await f.db.prepare('UPDATE metadata SET key=?1,value=?2 WHERE key=?3').bind(kind==='key'?'desktop_reservation:'+'0'.repeat(64):f.row.key,value,f.row.key).run();const before=await f.snapshot();assert.equal((await f.post('reservations',f.listing())).status,409,kind);assert.deepEqual(await f.snapshot(),before);
 }
});
for(const count of [0,50,51,1024,1025,1026])test(`listing bounds ${count} reservations with a fixed 50 row page and 1025 read ceiling`,async t=>{
 const f=await fixture(t),rows=await seed(f,count);let scanned=0,query='';const original=f.db.prepare.bind(f.db);f.db.prepare=sql=>{const statement=original(sql);if(!sql.includes("GLOB 'desktop_reservation:*'"))return statement;query=sql;return {...statement,all:async()=>{const result=await statement.all();scanned=result.results.length;return result;}};};
 const before=performance.now(),response=await f.post('reservations',f.listing()),elapsed=performance.now()-before;assert.equal(scanned,Math.min(count,1025));assert.match(query,/ORDER BY key\s+LIMIT 1025/i);
 if(count>1024){assert.equal(response.status,409);return;}assert.equal(response.status,200,JSON.stringify(response));assert.deepEqual(response.reservations,rows.slice(0,50).map(row=>row.reservation));assert.equal(response.nextAfterKey,count>50?rows[49].key:null);
 if(count===1024)t.diagnostic('1024-row read and validation: '+elapsed.toFixed(2)+' ms (local test, not a performance guarantee)');
});
test('key pagination survives deletion of the prior page boundary and filters by task',async t=>{
 const f=await fixture(t),rows=await seed(f,51),other={...f.reservation,taskId:'another-task'},key=await reservationKey(other);await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(key,JSON.stringify(other)).run();
 const first=await f.post('reservations',f.listing());assert.equal(first.reservations.length,50);await f.db.prepare('DELETE FROM metadata WHERE key=?1').bind(first.nextAfterKey).run();const second=await f.post('reservations',f.listing({afterKey:first.nextAfterKey}));assert.equal(second.status,200);assert.deepEqual(second.reservations,[rows[50].reservation]);assert.equal(second.nextAfterKey,null);
});
test('recovery routes never report models, update presence, dispatch, or create receipts',async t=>{
 const f=await fixture(t);let modelReads=0,sideEffects=0;const original=f.db.prepare.bind(f.db);f.db.prepare=sql=>{if(/desktop_models/.test(sql))modelReads++;if(/desktop_seen|INSERT INTO metadata.*desktop_receipt/i.test(sql))sideEffects++;return original(sql);};
 assert.equal((await f.post('reservations',f.listing())).status,200);assert.equal((await f.post('discard',f.discard())).status,200);assert.equal(modelReads,0);assert.equal(sideEffects,0);assert.equal(f.external(),0);
});
test('listing rejects missing or malformed task identity, version and status without writes',async t=>{
 for(const change of ['missing','id','version','status']){
  const f=await fixture(t);
  if(change==='missing')await f.db.prepare('DELETE FROM tasks WHERE id=?1').bind(f.task.id).run();
  else await f.db.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify({...f.current,...(change==='id'?{id:'other'}:change==='version'?{version:999}:{status:'unknown'})}),f.task.id).run();
  const before=await f.snapshot();assert.equal((await f.post('reservations',f.listing())).status,409);assert.deepEqual(await f.snapshot(),before);
 }
});
test('discard binds body workspace to the verified header even if identity switches during body read',async t=>{
 const f=await fixture(t),workspaceB='22222222-2222-4222-8222-222222222222',reservationB={...f.reservation,workspaceId:workspaceB},keyB=await reservationKey(reservationB),body={...f.discard(),reservation:reservationB};
 const request=new Request('https://inno.example/api/desktop/'+encodeURIComponent(f.task.id)+'/discard',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-inno-delivery-receipt-version':'1','x-inno-workspace-id':f.workspaceId},body:JSON.stringify(body)}),readBody=request.text.bind(request);
 request.text=async()=>{await f.db.prepare("UPDATE metadata SET value=?1 WHERE key='desktop_workspace_id'").bind(workspaceB).run();await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(keyB,JSON.stringify(reservationB)).run();return readBody();};
 const worker=createWorker({deliveryReceiptVersion:1}),response=await worker.fetch(request,{DB:f.db,ACCESS_TOKEN:token});assert.equal(response.status,409,JSON.stringify(await response.json()));assert.equal((await f.db.prepare('SELECT value FROM metadata WHERE key=?1').bind(keyB).first()).value,JSON.stringify(reservationB));assert.equal((await f.db.prepare('SELECT value FROM metadata WHERE key=?1').bind(f.row.key).first()).value,f.row.value);
});
test('ACK cannot release a body-workspace receipt after the verified header workspace changes during body read',async t=>{
 const f=await fixture(t),workspaceB='22222222-2222-4222-8222-222222222222',receipt={...await createDeliveryReceipt({workspaceId:workspaceB,taskId:f.task.id,action:'complete',input:{executionId:f.owner.executionId,generation:f.owner.generation,content:'accepted'}}),acceptedAt:'2026-10-01T00:00:00.000Z'},key='desktop_receipt:'+receipt.id;
 const request=new Request('https://inno.example/api/desktop/'+encodeURIComponent(f.task.id)+'/ack',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-inno-delivery-receipt-version':'1','x-inno-workspace-id':f.workspaceId},body:JSON.stringify({receipt})}),readBody=request.text.bind(request);
 request.text=async()=>{await f.db.prepare("UPDATE metadata SET value=?1 WHERE key='desktop_workspace_id'").bind(workspaceB).run();await f.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(key,JSON.stringify(receipt)).run();return readBody();};
 const response=await createWorker({deliveryReceiptVersion:1}).fetch(request,{DB:f.db,ACCESS_TOKEN:token});assert.equal(response.status,409,JSON.stringify(await response.json()));assert.equal((await f.db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first()).value,JSON.stringify(receipt));
});
test('malformed existing recovery workspace identity is rejected before reading request body',async t=>{
 const f=await fixture(t);await f.db.prepare("UPDATE metadata SET value='broken' WHERE key='desktop_workspace_id'").run();const before=await f.snapshot();
 for(const action of ['reservations','discard']){const response=await f.post(action,'{broken',{workspace:'broken'});assert.equal(response.status,409);assert.notEqual(response.error,'request body must be valid JSON');}
 assert.deepEqual(await f.snapshot(),before);
});
