import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createCloudRequest} from '../server/delivery-binding.mjs';
import {ownerPermanentlyRefused} from '../worker/delivery-discharge.mjs';

const origin='https://inno.example',token='discharge-test-token-0123456789';
const tempRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.inno/tmp');
async function count(db,kind){return Number((await db.prepare('SELECT COUNT(*) AS n FROM metadata WHERE key GLOB ?1').bind(`desktop_${kind}:*`).first()).n);}
async function fixture(t){
 await mkdir(tempRoot,{recursive:true});const dir=await mkdtemp(path.join(tempRoot,'delivery-discharge-'));
 const db=new TestD1(),pendingPath=path.join(dir,'pending.json');
 t.after(async()=>{db.close();await rm(pendingPath,{force:true});await rm(pendingPath+'.tmp',{force:true});await rmdir(dir);});
 const store=new D1TaskStore(db),worker=createWorker({deliveryReceiptVersion:1,fetchFn:async()=>{throw Error('AI network forbidden');}});
 const routes=[],responses=[],errors=[],lose=new Set(),block=new Set();
 const request=createCloudRequest({endpoint:origin,token,fetchFn:async(url,options)=>{
  routes.push(url.pathname);
  const action=url.pathname.split('/').at(-1);
  if(block.has(action)){block.delete(action);throw Error(`${action} request blocked`);}
  const response=await worker.fetch(new Request(url.toString(),options),{DB:db,ACCESS_TOKEN:token});
  if(['complete','fail','ack'].includes(action))responses.push({action,status:response.status,body:await response.clone().json().catch(()=>null)});
  if(lose.has(action)&&response.ok){lose.delete(action);throw Error(`${action} response lost`);}
  return response;
 }});
 const readDeliveryBinding=async()=>({origin,workspaceId:(await request('/api/desktop/identity')).workspaceId});
 const makeBridge=runner=>createDesktopBridge({deliveryReceiptVersion:1,request,outbox:createFileOutbox(pendingPath),readDeliveryBinding,runner,heartbeatMs:5,onError:error=>errors.push(error)});
 const task=await store.createTask({prompt:'Complete the task'});
 return {db,store,task,pendingPath,routes,responses,errors,makeBridge,lose:action=>lose.add(action),block:action=>block.add(action),outbox:()=>createFileOutbox(pendingPath).read()};
}
// The runner waits until the desktop aborts it, then fails or returns a late result.
function stoppableRunner({late=false}={}){
 let enter;const entered=new Promise(resolve=>{enter=resolve;});
 return {entered,run:({signal})=>{enter();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>late?resolve({content:'late result'}):reject(Object.assign(Error('stopped'),{name:'AbortError'})),{once:true}));}};
}
async function pausedRun(f,options){
 const runner=stoppableRunner(options),bridge=f.makeBridge(runner);
 await bridge.startTask(f.task.id,{expectedVersion:f.task.version,materials:[]});
 await runner.entered;
 const running=await f.store.requireTask(f.task.id);
 const paused=await f.store.applyAction(f.task.id,{action:'pause',expectedVersion:running.version});
 await bridge.settled();
 return {bridge,paused,running};
}

test('a user pause discharges the stopped result and the desktop keeps working',async t=>{
 const f=await fixture(t),{bridge,paused}=await pausedRun(f);
 assert.deepEqual(await f.store.requireTask(f.task.id),paused);
 assert.equal(f.outbox(),null);assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),0);
 const discharge=f.responses.find(row=>row.action==='fail');
 assert.equal(discharge.status,200);assert.equal(discharge.body.discarded,true);assert.equal(discharge.body.deliveryReceipt.action,'fail');
 assert.equal(Object.hasOwn(discharge.body.deliveryReceipt,'disposition'),false);
 assert.equal(f.errors.length,0);assert.equal(bridge.status().deliveryUnsafe,false);assert.equal(bridge.status().recoveryPaused,false);
 // The same bridge object accepts new work: a second claim starts and is then stopped.
 const resumed=await f.store.applyAction(f.task.id,{action:'resume',expectedVersion:paused.version});
 const second=await bridge.startTask(f.task.id,{expectedVersion:resumed.version,materials:[]});
 assert.equal(second.status,'running');assert.ok(second.checkpoint.generation>paused.checkpoint.generation);
 bridge.stop();await bridge.settled();
});

test('a result finished after the user paused is discarded, never applied',async t=>{
 const f=await fixture(t),{paused}=await pausedRun(f,{late:true});
 const after=await f.store.requireTask(f.task.id);
 assert.equal(after.status,'paused');assert.equal(after.version,paused.version);
 assert.equal(JSON.stringify(after).includes('late result'),false);
 const discharge=f.responses.find(row=>row.action==='complete');
 assert.equal(discharge.body.discarded,true);assert.equal(f.outbox(),null);assert.equal(await count(f.db,'receipt'),0);
});

test('a lost discharge reply replays the stored discard receipt after restart',async t=>{
 const f=await fixture(t);f.lose('fail');
 const {bridge}=await pausedRun(f);
 assert.match(f.errors.at(-1)?.message??'',/fail response lost/);assert.equal(bridge.status().deliveryUnsafe,true);
 assert.equal(f.outbox().phase,'pending');assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),1);
 const restarted=f.makeBridge({run:()=>{throw Error('AI must not rerun');}});
 assert.equal(await restarted.tick(),true);
 const replay=f.responses.filter(row=>row.action==='fail').at(-1);
 assert.equal(replay.body.replayed,true);assert.equal(replay.body.discarded,true);
 assert.equal(f.outbox(),null);assert.equal(await count(f.db,'receipt'),0);
});

const noRerun={run:()=>{throw Error('AI must not rerun');}};
for(const [name,later] of [['resumed (ready)',async(f,paused)=>f.store.applyAction(f.task.id,{action:'resume',expectedVersion:paused.version})],['cancelled',async(f,paused)=>f.store.applyAction(f.task.id,{action:'cancel',expectedVersion:paused.version})]]){
 test(`a stopped result that reaches a ${name} task later is discharged without changing it`,async t=>{
  const f=await fixture(t);f.block('fail');
  const {bridge,paused}=await pausedRun(f);
  assert.equal(bridge.status().deliveryUnsafe,true);assert.equal(f.outbox().phase,'pending');assert.equal(await count(f.db,'reservation'),1);
  const changed=await later(f,paused);
  assert.equal(await f.makeBridge(noRerun).tick(),true);
  assert.deepEqual(await f.store.requireTask(f.task.id),changed);
  assert.equal(f.responses.at(-2).body.discarded,true);
  assert.equal(f.outbox(),null);assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),0);
 });
}

test('without its reservation a stopped result cannot be certified and stays pending',async t=>{
 const f=await fixture(t);f.block('fail');
 await pausedRun(f);
 await f.db.prepare("DELETE FROM metadata WHERE key GLOB 'desktop_reservation:*'").run();
 await assert.rejects(()=>f.makeBridge(noRerun).tick(),error=>error.status===409);
 assert.equal(f.outbox().phase,'pending');assert.equal(await count(f.db,'receipt'),0);
});

test('only owners that can never be accepted again are permanently refused',()=>{
 const owner={executionId:'e1',generation:2};
 const task=(status,checkpoint={})=>({status,version:7,checkpoint:{executionId:'e1',generation:2,...checkpoint}});
 assert.equal(ownerPermanentlyRefused(task('running'),owner),false);
 assert.equal(ownerPermanentlyRefused(task('paused',{interruptedBy:'lease_expiry',interruptedVersion:7}),owner),false);
 assert.equal(ownerPermanentlyRefused(task('paused',{interruptedBy:'lease_expiry',interruptedVersion:6}),owner),true);
 for(const status of ['paused','cancelled','ready','failed','waiting_children'])assert.equal(ownerPermanentlyRefused(task(status),owner),true,status);
 assert.equal(ownerPermanentlyRefused(task('running',{generation:3}),owner),true);
 assert.equal(ownerPermanentlyRefused(task('running',{executionId:undefined}),owner),true);
 assert.equal(ownerPermanentlyRefused(null,owner),false);
});
