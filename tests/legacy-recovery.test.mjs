import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {request as httpRequest} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createFileJournal} from '../server/claim-journal-file.mjs';
import {createOutboxRecovery} from '../server/outbox-recovery.mjs';
import {createCloudRequest} from '../server/delivery-binding.mjs';

const origin='https://inno.example',cloudToken='legacy-recovery-cloud-token-0123',localToken='legacy-recovery-local-token-0123456789';
const tempRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.inno/tmp');
async function fixture(t,{legacy:make=owner=>({taskId:owner.taskId,action:'complete',input:{executionId:owner.executionId,generation:owner.generation,content:'legacy result'}}),afterStatus,sendFailure,identity}={}){
 fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'legacy-recovery-')),file=path.join(dir,'pending.json');
 const db=new TestD1(),store=new D1TaskStore(db),worker=createWorker({deliveryReceiptVersion:1,fetchFn:async()=>{throw Error('AI must not run');}});
 let statusHook=afterStatus,failSend=sendFailure;
 const request=createCloudRequest({endpoint:origin,token:cloudToken,fetchFn:async(url,options)=>{
  if(failSend&&/\/(complete|fail)$/.test(url.pathname)){const failure=failSend;failSend=undefined;if(failure==='network')throw Error('network down');return new Response('{}',{status:failure});}
  const response=await worker.fetch(new Request(url.toString(),options),{DB:db,ACCESS_TOKEN:cloudToken});
  if(statusHook&&url.pathname.endsWith('/legacy-status')){const hook=statusHook;statusHook=undefined;await hook(store,task);}
  return response;
 }});
 const readDeliveryBinding=async()=>({origin,workspaceId:identity??(await request('/api/desktop/identity')).workspaceId});
 const task=await store.createTask({prompt:'Check 2+2'});
 const claimed=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 const record=make({taskId:task.id,executionId:claimed.executionId,generation:claimed.generation},await readDeliveryBinding());
 fs.writeFileSync(file,JSON.stringify(record));
 const bridge=createDesktopBridge({deliveryReceiptVersion:1,request,outbox:createFileOutbox(file),journal:createFileJournal(path.join(dir,'claim.json')),readDeliveryBinding,runner:{run:()=>{throw Error('AI must not run');}}});
 const recovery=createOutboxRecovery(file,{withExclusive:work=>bridge.recoveryMaintenance(work)});
 const server=createDesktopServer({token:localToken,publicDir:new URL('../public',import.meta.url),request,bridge,readDeliveryBinding,deliveryReceiptVersion:1,outboxRecovery:recovery});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);});
 const base='http://127.0.0.1:'+server.address().port;
 const call=(route,input)=>new Promise((resolve,reject)=>{
  const raw=input===undefined?undefined:JSON.stringify(input);
  const req=httpRequest(base+route,{method:input===undefined?'GET':'POST',headers:{connection:'close','content-type':'application/json',authorization:'Bearer '+localToken}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,...JSON.parse(text||'{}')}));});
  req.on('error',reject);if(raw)req.write(raw);req.end();
 });
 const hash=async()=>(await call('/api/desktop/recovery')).recovery.pending.sha256;
 return {db,store,task,claimed,file,dir,call,hash,bytes:()=>fs.readFileSync(file)};
}

test('a deliverable legacy result is delivered the old way only after an explicit confirmation',async t=>{
 const f=await fixture(t),status=await f.call('/api/desktop/status');
 assert.equal(status.capabilities.desktopLegacyRecovery,true);
 const inspected=await f.call('/api/desktop/recovery');assert.equal(inspected.recovery.pending.phase,'legacy');
 const pendingHash=inspected.recovery.pending.sha256;
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-status',{pendingHash}),{status:200,state:'deliverable'});
 assert.equal((await f.call('/api/desktop/recovery/legacy-deliver',{pendingHash,confirm:false})).status,400);
 assert.equal((await f.call('/api/desktop/recovery/legacy-deliver',{pendingHash:'0'.repeat(64),confirm:true})).status,409);
 assert.ok(fs.existsSync(f.file));
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-deliver',{pendingHash,confirm:true}),{status:200,delivered:true,state:'deliverable'});
 assert.equal(fs.existsSync(f.file),false);
 const done=await f.store.requireTask(f.task.id);assert.equal(done.status,'completed');assert.equal(done.checkpoint.executionId,f.claimed.executionId);
});

test('a legacy result that can no longer be applied is archived with its exact bytes, and a deliverable one cannot be',async t=>{
 const f=await fixture(t),pendingHash=await f.hash(),original=f.bytes();
 assert.equal((await f.call('/api/desktop/recovery/legacy-archive',{pendingHash,confirm:true})).status,409);
 assert.deepEqual(f.bytes(),original);
 const running=await f.store.requireTask(f.task.id);
 await f.store.applyAction(f.task.id,{action:'pause',expectedVersion:running.version});
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-status',{pendingHash}),{status:200,state:'not_running'});
 assert.equal((await f.call('/api/desktop/recovery/legacy-deliver',{pendingHash,confirm:true})).status,409);
 assert.equal((await f.call('/api/desktop/recovery/legacy-archive',{pendingHash,confirm:false})).status,400);
 const archived=await f.call('/api/desktop/recovery/legacy-archive',{pendingHash,confirm:true});
 assert.equal(archived.status,200);assert.equal(archived.archived,true);assert.match(archived.archive,/^pending\.json\.legacy-[0-9a-f]{16}\.json$/);
 assert.equal(fs.existsSync(f.file),false);
 assert.deepEqual(fs.readFileSync(path.join(f.dir,archived.archive)),original);
 assert.equal((await f.store.requireTask(f.task.id)).status,'paused');
});

test('a legacy result bound to another workspace is never sent or archived',async t=>{
 const f=await fixture(t,{legacy:(owner,binding)=>({taskId:owner.taskId,action:'complete',binding:{...binding,workspaceId:'22222222-2222-4222-8222-222222222222'},input:{executionId:owner.executionId,generation:owner.generation,content:'other'}})});
 const pendingHash=await f.hash(),original=f.bytes();
 for(const route of ['legacy-status','legacy-deliver','legacy-archive'])assert.equal((await f.call('/api/desktop/recovery/'+route,{pendingHash,confirm:true,...(route==='legacy-status'?{confirm:undefined}:{})})).status,409,route);
 assert.deepEqual(f.bytes(),original);assert.equal((await f.store.requireTask(f.task.id)).status,'running');
});

const failRecord=owner=>({taskId:owner.taskId,action:'fail',input:{executionId:owner.executionId,generation:owner.generation,status:'failed',failure:{kind:'unknown',retryNotBefore:null}}});
test('an already recorded fail result is confirmed without change by the old route',async t=>{
 const f=await fixture(t,{legacy:failRecord});
 await f.store.failExecution(f.task.id,{executionId:f.claimed.executionId,generation:f.claimed.generation,status:'failed',failure:{kind:'unknown',retryNotBefore:null}});
 const before=await f.store.requireTask(f.task.id),pendingHash=await f.hash();
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-status',{pendingHash}),{status:200,state:'already_applied'});
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-deliver',{pendingHash,confirm:true}),{status:200,delivered:true,state:'already_applied'});
 assert.deepEqual(await f.store.requireTask(f.task.id),before);assert.equal(fs.existsSync(f.file),false);
});

test('a task stopped between the check and the send refuses the result and keeps the file',async t=>{
 // The deliver route checks the Worker again; the task is paused right after that check.
 const pausedAfterCheck=async(store,task)=>{const current=await store.requireTask(task.id);await store.applyAction(task.id,{action:'pause',expectedVersion:current.version});};
 const f=await fixture(t,{afterStatus:pausedAfterCheck}),pendingHash=await f.hash(),original=f.bytes();
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-deliver',{pendingHash,confirm:true}),{status:200,delivered:false,refused:true});
 assert.deepEqual(f.bytes(),original);assert.equal((await f.store.requireTask(f.task.id)).status,'paused');
});

test('a deliverable result the Worker keeps refusing can be archived only after an explicit refusal confirmation',async t=>{
 const f=await fixture(t,{legacy:owner=>({taskId:owner.taskId,action:'complete',input:{executionId:owner.executionId,generation:owner.generation,content:''}})});
 const pendingHash=await f.hash(),original=f.bytes();
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-status',{pendingHash}),{status:200,state:'deliverable'});
 assert.equal((await f.call('/api/desktop/recovery/legacy-archive',{pendingHash,confirm:true,afterRefusal:true})).status,409);
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-deliver',{pendingHash,confirm:true}),{status:200,delivered:false,refused:true});
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-status',{pendingHash}),{status:200,state:'deliverable',refused:true});
 assert.equal((await f.call('/api/desktop/recovery/legacy-archive',{pendingHash,confirm:true})).status,409);
 const archived=await f.call('/api/desktop/recovery/legacy-archive',{pendingHash,confirm:true,afterRefusal:true});
 assert.equal(archived.status,200);assert.deepEqual(fs.readFileSync(path.join(f.dir,archived.archive)),original);
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');
});

test('a temporary file or a stale hash refuses every legacy action and keeps the files',async t=>{
 const f=await fixture(t),pendingHash=await f.hash(),original=f.bytes();
 for(const route of ['legacy-deliver','legacy-archive'])assert.equal((await f.call('/api/desktop/recovery/'+route,{pendingHash:'0'.repeat(64),confirm:true})).status,409,route);
 fs.writeFileSync(f.file+'.tmp','{}');
 assert.equal((await f.call('/api/desktop/recovery/legacy-status',{pendingHash})).status,409);
 for(const route of ['legacy-deliver','legacy-archive'])assert.equal((await f.call('/api/desktop/recovery/'+route,{pendingHash,confirm:true})).status,409,route);
 assert.deepEqual(f.bytes(),original);assert.equal(fs.readFileSync(f.file+'.tmp','utf8'),'{}');
});

test('a legacy record with an unverifiable binding can be archived but is never sent',async t=>{
 const f=await fixture(t,{legacy:owner=>({taskId:owner.taskId,action:'complete',binding:{origin:'not a url',workspaceId:'bad'},input:{executionId:owner.executionId,generation:owner.generation,content:'x'}})});
 const pendingHash=await f.hash(),original=f.bytes();
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-status',{pendingHash}),{status:200,state:'binding_unverified'});
 assert.equal((await f.call('/api/desktop/recovery/legacy-deliver',{pendingHash,confirm:true})).status,409);
 const archived=await f.call('/api/desktop/recovery/legacy-archive',{pendingHash,confirm:true});
 assert.equal(archived.status,200);assert.deepEqual(fs.readFileSync(path.join(f.dir,archived.archive)),original);
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');
});

for(const failure of ['network',429,401])test(`a ${failure} delivery failure is not recorded as a Worker refusal`,async t=>{
 const f=await fixture(t,{sendFailure:failure}),pendingHash=await f.hash(),original=f.bytes();
 const response=await f.call('/api/desktop/recovery/legacy-deliver',{pendingHash,confirm:true});
 assert.notEqual(response.status,200);assert.equal(response.refused,undefined);
 assert.deepEqual(await f.call('/api/desktop/recovery/legacy-status',{pendingHash}),{status:200,state:'deliverable'});
 assert.equal((await f.call('/api/desktop/recovery/legacy-archive',{pendingHash,confirm:true,afterRefusal:true})).status,409);
 assert.deepEqual(f.bytes(),original);
});

test('an invalid current workspace identity never turns an unbound legacy record into an archivable one',async t=>{
 const f=await fixture(t,{identity:'not-a-workspace'});
 const pendingHash=(await f.call('/api/desktop/recovery')).recovery.pending.sha256,original=f.bytes();
 assert.equal((await f.call('/api/desktop/recovery/legacy-status',{pendingHash})).status,409);
 assert.equal((await f.call('/api/desktop/recovery/legacy-archive',{pendingHash,confirm:true})).status,409);
 assert.deepEqual(f.bytes(),original);
});
