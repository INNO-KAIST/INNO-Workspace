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

const origin='https://inno.example',token='lifecycle-test-token-0123456789';
const tempRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.inno/tmp');
async function count(db,kind){return Number((await db.prepare('SELECT COUNT(*) AS n FROM metadata WHERE key GLOB ?1').bind(`desktop_${kind}:*`).first()).n);}
async function fixture(t){
 await mkdir(tempRoot,{recursive:true});const dir=await mkdtemp(path.join(tempRoot,'delivery-lifecycle-'));
 const db=new TestD1(),replacementDb=new TestD1(),pendingPath=path.join(dir,'pending.json');
 t.after(async()=>{db.close();replacementDb.close();await rm(pendingPath,{force:true});await rm(pendingPath+'.tmp',{force:true});await rmdir(dir);});
 const store=new D1TaskStore(db),worker=createWorker({deliveryReceiptVersion:1,fetchFn:async()=>{throw Error('AI network forbidden');}});
 const routes=[],errors=[];
 let activeDb=db,loseComplete=false,loseAck=false,switchOnComplete=false,runs=0;
 const request=createCloudRequest({endpoint:origin,token,fetchFn:async(url,options)=>{
  routes.push(url.pathname);
  if(switchOnComplete&&url.pathname.endsWith('/complete')){activeDb=replacementDb;switchOnComplete=false;}
  const response=await worker.fetch(new Request(url.toString(),options),{DB:activeDb,ACCESS_TOKEN:token});
  if(loseComplete&&url.pathname.endsWith('/complete')&&response.ok){loseComplete=false;throw Error('result response lost');}
  if(loseAck&&url.pathname.endsWith('/ack')&&response.ok){loseAck=false;throw Error('ACK response lost');}
  return response;
 }});
 const readDeliveryBinding=async()=>({origin,workspaceId:(await request('/api/desktop/identity')).workspaceId});
 const runner={run:async()=>{runs++;return {content:'verified result'};}};
 const makeBridge=(selectedRunner=runner)=>createDesktopBridge({deliveryReceiptVersion:1,request,outbox:createFileOutbox(pendingPath),readDeliveryBinding,runner:selectedRunner,onError:error=>errors.push(error)});
 const task=await store.createTask({prompt:'Complete the task'});
 return {db,replacementDb,store,task,pendingPath,routes,errors,makeBridge,runs:()=>runs,
  loseResult:()=>{loseComplete=true;},loseAck:()=>{loseAck=true;},switchOnResult:()=>{switchOnComplete=true;},useOriginal:()=>{activeDb=db;}};
}
async function startAndSettle(f){const bridge=f.makeBridge();await bridge.startTask(f.task.id,{expectedVersion:f.task.version,materials:[]});await bridge.settled();}
const outbox=f=>createFileOutbox(f.pendingPath).read();
const forbiddenRunner={run:()=>{throw Error('AI must not rerun');},models:()=>{throw Error('model snapshot must not run');}};

test('Worker accepts completion, ACK releases receipt, and real outbox clears',async t=>{
 const f=await fixture(t);await startAndSettle(f);
 assert.equal((await f.store.requireTask(f.task.id)).status,'completed');
 assert.equal(outbox(f),null);assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),0);
 assert.equal(f.runs(),1);assert.equal(f.errors.length,0);
 assert.equal(f.routes.filter(route=>route.endsWith('/complete')).length,1);
 assert.equal(f.routes.filter(route=>route.endsWith('/ack')).length,1);
});

test('accepted result reply loss survives follow-up and replays without changing newer task state',async t=>{
 const f=await fixture(t);f.loseResult();await startAndSettle(f);
 assert.match(f.errors.at(-1)?.message??'',/result response lost/);assert.equal(outbox(f).phase,'pending');
 assert.equal((await f.store.requireTask(f.task.id)).status,'completed');
 assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),1);
 const accepted=await f.store.requireTask(f.task.id);
 await f.store.applyAction(f.task.id,{action:'message',expectedVersion:accepted.version,content:'Continue with a revised request'});
 const newer=await f.store.requireTask(f.task.id),beforeRoutes=f.routes.length;
 assert.equal(await f.makeBridge(forbiddenRunner).tick(),true);
 assert.deepEqual(await f.store.requireTask(f.task.id),newer);assert.equal(outbox(f),null);
 assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),0);
 assert.deepEqual(f.routes.slice(beforeRoutes).filter(route=>!route.endsWith('/identity')),[`/api/desktop/${f.task.id}/complete`,`/api/desktop/${f.task.id}/ack`]);
 assert.equal(f.runs(),1);
});

test('ACK reply loss restarts from ack_pending without result POST, claim, or runner',async t=>{
 const f=await fixture(t);f.loseAck();await startAndSettle(f);
 assert.match(f.errors.at(-1)?.message??'',/ACK response lost/);assert.equal(outbox(f).phase,'ack_pending');
 assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),0);
 const beforeRoutes=f.routes.length,beforeTask=await f.store.requireTask(f.task.id);
 assert.equal(await f.makeBridge(forbiddenRunner).tick(),true);
 assert.deepEqual(await f.store.requireTask(f.task.id),beforeTask);assert.equal(outbox(f),null);
 assert.deepEqual(f.routes.slice(beforeRoutes).filter(route=>!route.endsWith('/identity')),[`/api/desktop/${f.task.id}/ack`]);
 assert.equal(f.runs(),1);
});

test('workspace replacement preserves pending result until original workspace reconnects',async t=>{
 const f=await fixture(t);f.switchOnResult();await startAndSettle(f);
 assert.equal(outbox(f).phase,'pending');assert.equal(f.errors.at(-1)?.status,409);
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');
 assert.equal(await count(f.db,'reservation'),1);assert.equal(await count(f.db,'receipt'),0);
 const beforeRoutes=f.routes.length;
 await assert.rejects(()=>f.makeBridge(forbiddenRunner).tick(),{status:409});
 assert.equal(outbox(f).phase,'pending');
 assert.equal(f.routes.slice(beforeRoutes).some(route=>route.endsWith('/complete')),false);
 f.useOriginal();assert.equal(await f.makeBridge(forbiddenRunner).tick(),true);
 assert.equal((await f.store.requireTask(f.task.id)).status,'completed');assert.equal(outbox(f),null);
 assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),0);assert.equal(f.runs(),1);
});
