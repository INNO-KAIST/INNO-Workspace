import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createFileJournal} from '../server/claim-journal-file.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createCloudRequest} from '../server/delivery-binding.mjs';

const origin='https://inno.example',token='journal-test-token-0123456789';
const tempRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.inno/tmp');
const NONCE=/^[0-9a-f]{64}$/;
async function count(db,kind){return Number((await db.prepare('SELECT COUNT(*) AS n FROM metadata WHERE key GLOB ?1').bind(`desktop_${kind}:*`).first()).n);}
async function marker(db,nonce){const row=await db.prepare('SELECT value FROM metadata WHERE key=?1').bind('desktop_claim:'+nonce).first();return row?JSON.parse(row.value):null;}
async function fixture(t){
 await mkdir(tempRoot,{recursive:true});const dir=await mkdtemp(path.join(tempRoot,'claim-journal-'));
 const db=new TestD1(),pendingPath=path.join(dir,'pending.json'),journalPath=path.join(dir,'claim.json');
 t.after(async()=>{db.close();for(const file of [pendingPath,journalPath])for(const suffix of ['','.tmp'])await rm(file+suffix,{force:true});await rmdir(dir);});
 const store=new D1TaskStore(db),worker=createWorker({deliveryReceiptVersion:1,fetchFn:async()=>{throw Error('AI network forbidden');}});
 const calls=[],lose=new Set(),block=new Set(),journalWrites=[];
 const send=async(url,options)=>worker.fetch(new Request(url.toString(),options),{DB:db,ACCESS_TOKEN:token});
 const request=createCloudRequest({endpoint:origin,token,fetchFn:async(url,options)=>{
  const action=url.pathname.split('/').at(-1);
  calls.push({action,body:options?.body?JSON.parse(options.body):undefined});
  if(block.has(action)){block.delete(action);throw Error(`${action} request blocked`);}
  const response=await send(url,options);
  if(lose.has(action)&&response.ok){lose.delete(action);throw Error(`${action} response lost`);}
  return response;
 }});
 const readDeliveryBinding=async()=>({origin,workspaceId:(await request('/api/desktop/identity')).workspaceId});
 const journalFile=createFileJournal(journalPath);
 let failClears=0;
 const journal={read:()=>journalFile.read(),write:record=>{journalWrites.push(structuredClone(record));journalFile.write(record);},clear:()=>{if(failClears>0){failClears--;throw Object.assign(Error('journal clear failed'),{code:'EBUSY'});}journalFile.clear();}};
 const makeBridge=(runner,extra={})=>createDesktopBridge({deliveryReceiptVersion:1,request,outbox:createFileOutbox(pendingPath),journal,readDeliveryBinding,runner,...extra});
 const task=await store.createTask({prompt:'Complete the task'});
 return {db,store,task,calls,journalWrites,makeBridge,request,lose:a=>lose.add(a),block:a=>block.add(a),failClear:()=>{failClears++;},journal,outbox:()=>createFileOutbox(pendingPath).read()};
}
const done={run:async()=>({content:'verified result'})};
const forbidden={run:()=>{throw Error('AI must not rerun');}};
const start=(f,bridge)=>bridge.startTask(f.task.id,{expectedVersion:f.task.version,materials:[]});

test('every v1 claim is preceded by a durable intent and recorded with its owner',async t=>{
 const f=await fixture(t),bridge=f.makeBridge(done);
 await start(f,bridge);await bridge.settled();
 const [requested,owned]=f.journalWrites;
 assert.equal(requested.phase,'requested');assert.match(requested.nonce,NONCE);
 assert.equal(f.calls.find(c=>c.action==='start').body.claimNonce,requested.nonce);
 assert.equal(owned.phase,'owned');assert.equal(owned.nonce,requested.nonce);assert.equal(owned.taskId,f.task.id);
 const stored=await marker(f.db,requested.nonce);
 assert.equal(stored.state,'claimed');assert.equal(stored.executionId,owned.executionId);assert.equal(stored.generation,owned.generation);
 assert.equal(f.journal.read(),null);assert.equal(f.outbox(),null);
 assert.equal((await f.store.requireTask(f.task.id)).status,'completed');
});

test('an empty poll clears its intent',async t=>{
 const f=await fixture(t);
 assert.equal(await f.makeBridge(forbidden).tick(),false);
 assert.equal(f.calls.find(c=>c.action==='poll').body.claimNonce,f.journalWrites[0].nonce);
 assert.equal(f.journalWrites.length,1);assert.equal(f.journal.read(),null);
});

test('a lost claim response is resolved by its nonce, and the unrun owner is failed as restarted',async t=>{
 const f=await fixture(t);f.lose('start');
 await assert.rejects(()=>start(f,f.makeBridge(forbidden)),/start response lost/);
 assert.equal(f.journal.read().phase,'requested');
 const claimed=await f.store.requireTask(f.task.id);assert.equal(claimed.status,'running');
 assert.equal(await f.makeBridge(forbidden).tick(),true);
 const failed=await f.store.requireTask(f.task.id);
 assert.equal(failed.checkpoint.executionId,claimed.checkpoint.executionId);assert.equal(failed.checkpoint.failure.kind,'restarted');
 assert.notEqual(failed.status,'running');
 assert.equal(f.journal.read(),null);assert.equal(f.outbox(),null);assert.equal(await count(f.db,'reservation'),0);
});

test('a claim that never reached the Worker closes its nonce so a late arrival cannot claim',async t=>{
 const f=await fixture(t);f.block('start');
 await assert.rejects(()=>start(f,f.makeBridge(forbidden)),/start request blocked/);
 const {nonce}=f.journal.read();
 assert.equal(await f.makeBridge(forbidden,{beforeClaim:async()=>{throw Error('no new claim in this check');}}).tick().catch(error=>error.message),'no new claim in this check');
 assert.equal(f.journal.read(),null);assert.equal((await marker(f.db,nonce)).state,'closed');
 const binding={workspaceId:(await f.request('/api/desktop/identity')).workspaceId};
 await assert.rejects(()=>f.request(`/api/desktop/${f.task.id}/start`,{expectedVersion:f.task.version,sourceDelegationVersion:0,sourceNames:[],claimNonce:nonce},{...binding,deliveryReceiptVersion:1}),error=>error.status===409);
 assert.equal((await f.store.requireTask(f.task.id)).status,f.task.status);
});

test('a bridge that died while running reports its owner as restarted on the next start',async t=>{
 const f=await fixture(t);
 let enter;const entered=new Promise(resolve=>{enter=resolve;});
 const hung={run:({signal})=>{enter();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));}};
 const dead=f.makeBridge(hung,{heartbeatMs:3_600_000});
 await dead.startTask(f.task.id,{expectedVersion:f.task.version,materials:[]});await entered;
 const owned=f.journal.read();assert.equal(owned.phase,'owned');
 // A new process starts with the same files; the old one never wrote a result.
 assert.equal(await f.makeBridge(forbidden).tick(),true);
 const failed=await f.store.requireTask(f.task.id);
 assert.equal(failed.checkpoint.executionId,owned.executionId);assert.equal(failed.checkpoint.failure.kind,'restarted');
 assert.equal(f.journal.read(),null);assert.equal(f.outbox(),null);assert.equal(await count(f.db,'reservation'),0);
 dead.stop();await dead.settled();
});

test('a journal for another workspace is never resolved automatically',async t=>{
 const f=await fixture(t);
 f.journal.write({version:1,phase:'requested',binding:{origin,workspaceId:'22222222-2222-4222-8222-222222222222'},nonce:'a'.repeat(64),taskId:null});
 const bridge=f.makeBridge(forbidden);
 await assert.rejects(()=>bridge.tick(),error=>error.code==='WORKSPACE_MISMATCH');
 assert.equal(f.journal.read().nonce,'a'.repeat(64));assert.equal(f.calls.some(c=>c.action==='claim-status'),false);
});

test('claim status needs the receipt protocol and leaves claimed markers while their reservation lives',async t=>{
 const f=await fixture(t);
 const binding={workspaceId:(await f.request('/api/desktop/identity')).workspaceId};
 await assert.rejects(()=>f.request('/api/desktop/claim-status',{nonce:'b'.repeat(64)}),error=>error.status>=400);
 await assert.rejects(()=>f.request('/api/desktop/claim-status',{nonce:'not-hex'},{...binding,deliveryReceiptVersion:1}),error=>error.status===400);
 assert.deepEqual(await f.request('/api/desktop/claim-status',{nonce:'b'.repeat(64)},{...binding,deliveryReceiptVersion:1}),{state:'none'});
 assert.deepEqual(await f.request('/api/desktop/claim-status',{nonce:'b'.repeat(64)},{...binding,deliveryReceiptVersion:1}),{state:'none'});
 const old=new Date(Date.parse(f.store.now())-2*86_400_000).toISOString();
 await f.db.prepare('UPDATE metadata SET value=json_set(value,\'$.at\',?1) WHERE key=?2').bind(old,'desktop_claim:'+'b'.repeat(64)).run();
 f.lose('start');await assert.rejects(()=>start(f,f.makeBridge(forbidden)));
 const {nonce}=f.journal.read();
 await f.db.prepare('UPDATE metadata SET value=json_set(value,\'$.at\',?1) WHERE key=?2').bind(old,'desktop_claim:'+nonce).run();
 assert.deepEqual(await f.request('/api/desktop/claim-status',{nonce:'c'.repeat(64)},{...binding,deliveryReceiptVersion:1}),{state:'none'});
 assert.equal(await marker(f.db,'b'.repeat(64)),null,'an old closed marker is swept');
 assert.equal((await marker(f.db,nonce)).state,'claimed','a claimed marker stays while its reservation exists');
});

test('a crash between saving the restarted result and clearing the journal resolves without a second report',async t=>{
 const f=await fixture(t);f.lose('start');
 await assert.rejects(()=>start(f,f.makeBridge(forbidden)),/start response lost/);
 f.failClear();
 await assert.rejects(()=>f.makeBridge(forbidden).tick(),/journal clear failed/);
 assert.equal(f.journal.read().phase,'owned');assert.equal(f.outbox().phase,'pending');
 const restarted=f.makeBridge(forbidden);
 assert.equal(await restarted.tick(),true);
 assert.equal(f.journal.read(),null);assert.equal(f.outbox(),null);
 assert.equal(await restarted.tick(),false);
 assert.equal(f.calls.filter(c=>c.action==='fail').length,1);
 assert.equal((await f.store.requireTask(f.task.id)).checkpoint.failure.kind,'restarted');
});

test('a journal whose owner is already settled is cleared without reporting a failure',async t=>{
 const f=await fixture(t),bridge=f.makeBridge(done);
 await start(f,bridge);await bridge.settled();
 const owned=f.journalWrites.find(row=>row.phase==='owned');
 f.journal.write(owned);
 assert.equal(await f.makeBridge(forbidden).tick(),false);
 assert.equal(f.journal.read(),null);assert.equal(f.calls.some(c=>c.action==='fail'),false);
 assert.equal((await f.store.requireTask(f.task.id)).status,'completed');
});

test('an explicit drain clears the journal of the owner it delivered',async t=>{
 const f=await fixture(t),bridge=f.makeBridge(done);f.failClear();
 await start(f,bridge);await bridge.settled();
 assert.equal(f.outbox().phase,'pending');assert.equal(f.journal.read().phase,'owned');
 assert.equal(await bridge.drainPending({readPending:()=>f.outbox()}),true);
 assert.equal(f.outbox(),null);assert.equal(f.journal.read(),null);
 assert.equal((await f.store.requireTask(f.task.id)).status,'completed');
});

test('a journal blocks direct starts and maintenance until it is resolved',async t=>{
 const f=await fixture(t);f.block('start');
 const bridge=f.makeBridge(forbidden);
 await assert.rejects(()=>start(f,bridge),/start request blocked/);
 await assert.rejects(()=>start(f,bridge),error=>error.status===409);
 await assert.rejects(()=>bridge.maintenance(async()=>{}),error=>error.status===409);
});

test('a poll that reuses the nonce of a committed claim fails instead of reporting no claim',async t=>{
 const f=await fixture(t),{workspaceId}=await f.request('/api/desktop/identity'),nonce='9'.repeat(64);
 await f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:f.task.version},{deliveryReceiptVersion:1,workspaceId,claimNonce:nonce});
 const other=await f.store.createTask({prompt:'Another task'});
 await f.store.applyAction(other.id,{action:'pause',expectedVersion:other.version}).catch(()=>{});
 await f.db.prepare("UPDATE tasks SET body=json_set(body,'$.status','queued','$.checkpoint',json('{\"provider\":\"codex\",\"status\":\"queued\"}')) WHERE id=?1").bind(other.id).run();
 await assert.rejects(()=>f.request('/api/desktop/poll',{claimNonce:nonce},{workspaceId,deliveryReceiptVersion:1}),error=>error.status===409);
});

test('a claim nonce is refused without the receipt protocol',async t=>{
 const f=await fixture(t);
 await assert.rejects(()=>f.request('/api/desktop/poll',{claimNonce:'d'.repeat(64)}),error=>error.status===400);
});

test('a claim batch that committed but reported an error is recognised by its own marker',async t=>{
 const f=await fixture(t),{workspaceId}=await f.request('/api/desktop/identity'),original=f.db.batch.bind(f.db);
 let once=true;f.db.batch=async statements=>{const result=await original(statements);if(once&&statements.length>3){once=false;throw Error('connection lost after commit');}return result;};
 const nonce='e'.repeat(64);
 const claim=await f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:f.task.version},{deliveryReceiptVersion:1,workspaceId,claimNonce:nonce});
 assert.equal(claim.task.status,'running');assert.equal((await marker(f.db,nonce)).executionId,claim.executionId);
});

test('a nonce closed between the check and the claim batch rolls the claim back',async t=>{
 const f=await fixture(t),{workspaceId}=await f.request('/api/desktop/identity'),original=f.db.batch.bind(f.db),nonce='f'.repeat(64);
 let once=true;f.db.batch=async statements=>{if(once&&statements.length>3){once=false;await f.request('/api/desktop/claim-status',{nonce},{workspaceId,deliveryReceiptVersion:1});}return original(statements);};
 await assert.rejects(()=>f.store.claimExecution(f.task.id,{provider:'codex',expectedVersion:f.task.version},{deliveryReceiptVersion:1,workspaceId,claimNonce:nonce}),/nonce was already used/);
 const after=await f.store.requireTask(f.task.id);assert.equal(after.version,f.task.version);assert.equal(after.status,f.task.status);
 assert.equal((await marker(f.db,nonce)).state,'closed');assert.equal(await count(f.db,'reservation'),0);
});
