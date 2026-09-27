import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {Delegations} from '../worker/delegations.mjs';
import {createWorker} from '../worker/index.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';

const secret='test-secret-01234567890123456789';
const sources=[{id:'alpha',name:'alpha.txt',source:'file'},{id:'beta',name:'beta.txt',source:'file'}];
const assignments=[
  {role:'alpha',provider:'codex',requestedModel:'gpt-5.6-luna',effort:'low',sufficientReason:'bounded check',acceptanceCriteria:['alpha checked'],instructions:'Analyze alpha',sourceIds:['alpha']},
  {role:'beta',provider:'claude',requestedModel:'haiku',effort:'low',sufficientReason:'bounded check',acceptanceCriteria:['beta checked'],instructions:'Analyze beta',sourceIds:['beta']},
];
const owner=c=>({executionId:c.executionId,generation:c.generation});
const box=()=>{let record=null;return {read:()=>record,write:next=>{record=next;},clear:()=>{record=null;}};};

async function fixture(t){
  const db=new TestD1(),store=new D1TaskStore(db),worker=createWorker({sourceDelegationVersion:1});
  const env={DB:db,ACCESS_TOKEN:secret};
  const server=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const result=await worker.fetch(new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),env);
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
    }catch(error){res.writeHead(500);res.end(String(error));}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const raw=async(route,input)=>{const response=await fetch(base+route,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(input)});return {status:response.status,...await response.json()};};
  const request=async(route,input)=>{const response=await raw(route,input);if(response.status>=400)throw Object.assign(Error(response.error),{status:response.status});return response;};
  const parent=await store.createTask({prompt:'Review independent source findings',attachments:sources});
  const master=await store.claimExecution(parent.id,{provider:'codex',expectedVersion:parent.version,sourceBound:true});
  const batch=await new Delegations(store,{sourceDelegationVersion:1}).allocate(parent.id,{...owner(master),independent:true,children:assignments});
  const [child,sibling]=batch.children;
  const siblingClaim=await store.claimExecution(sibling.id,{provider:'claude',expectedVersion:sibling.version,sourceBound:true});
  await store.finishExecution(sibling.id,{...owner(siblingClaim),content:'Completed beta'});
  const completedSibling=await store.requireTask(sibling.id);
  return {store,raw,request,parent:batch.parent,child,completedSibling};
}

test('accepted source child completion survives lost HTTP reply and retained outbox replay without rerunning',async t=>{
  const f=await fixture(t),outbox=box(),requests=[];let runs=0,loseReply=true;
  const request=async(route,input)=>{requests.push({route,input});const response=await f.request(route,input);if(route.endsWith('/complete')&&loseReply){loseReply=false;throw Error('completion reply lost');}return response;};
  const runner={sourceDelegationVersion:1,run:async({materials,sourceDelegationVersion})=>{
    runs++;assert.equal(sourceDelegationVersion,1);
    assert.deepEqual(materials,[{name:'alpha.txt',text:'PRIVATE_ALPHA_ORIGINAL'}]);
    return {content:'Generated alpha result',artifacts:[{name:'alpha-result.txt',mime:'text/plain',content:'Generated alpha result'}]};
  }};
  const errors=[];
  const bridge=createDesktopBridge({request,runner,outbox,onError:error=>errors.push(error)});
  await bridge.startTask(f.child.id,{expectedVersion:f.child.version,materials:[{name:'alpha.txt',text:'PRIVATE_ALPHA_ORIGINAL'}]});
  await bridge.settled();
  assert.equal(errors.length,1);
  assert.equal((await f.store.requireTask(f.child.id)).status,'completed');
  assert.equal(outbox.read().action,'complete');
  assert.equal(JSON.stringify(outbox.read()).includes('PRIVATE_ALPHA_ORIGINAL'),false);
  assert.equal(JSON.stringify(requests).includes('PRIVATE_ALPHA_ORIGINAL'),false);
  const restarted=createDesktopBridge({request,runner,outbox});
  assert.equal(await restarted.tick(),true);
  assert.equal(outbox.read(),null);
  assert.equal(runs,1);
  assert.equal((await f.store.requireTask(f.child.id)).status,'completed');
  assert.deepEqual(await f.store.requireTask(f.completedSibling.id),f.completedSibling);
});

test('parent pause makes source child renew fail, aborts runner, and requires explicit recovery',async t=>{
  const f=await fixture(t),outbox=box(),requests=[],errors=[];
  let started;const entered=new Promise(resolve=>{started=resolve;});let aborted=false;
  const runner={sourceDelegationVersion:1,run:({materials,signal})=>{
    assert.deepEqual(materials,[{name:'alpha.txt',text:'PRIVATE_ALPHA_ORIGINAL'}]);
    started();
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));
  }};
  const request=async(route,input)=>{requests.push(route);return f.request(route,input);};
  const bridge=createDesktopBridge({request,runner,outbox,heartbeatMs:5,onError:error=>errors.push(error)});
  await bridge.startTask(f.child.id,{expectedVersion:f.child.version,materials:[{name:'alpha.txt',text:'PRIVATE_ALPHA_ORIGINAL'}]});
  await entered;
  const paused=await f.request(`/api/tasks/${f.parent.id}/actions`,{action:'pause',expectedVersion:f.parent.version});
  assert.equal(paused.task.status,'paused');
  await bridge.settled();
  assert.equal(aborted,true);
  assert.equal(errors[0].status,409);
  assert.equal(requests.some(route=>route.endsWith('/renew')),true);
  assert.equal(requests.some(route=>route.endsWith('/complete')),false);
  assert.equal(outbox.read(),null);
  const resumed=await f.request(`/api/tasks/${f.parent.id}/delegation/resume`,{expectedVersion:paused.task.version});
  assert.equal(resumed.task.status,'waiting_children');
  const blocked=await f.store.requireTask(f.child.id);
  assert.equal(blocked.checkpoint.confirmationRequired.reason,'parent_pause');
  const recovery={expectedVersion:resumed.task.version,childTaskId:f.child.id,expectedChildVersion:blocked.version};
  assert.equal((await f.raw(`/api/tasks/${f.parent.id}/delegation/recover`,recovery)).status,400);
  const recovered=await f.request(`/api/tasks/${f.parent.id}/delegation/recover`,{...recovery,confirmedStopped:true});
  assert.equal(recovered.task.delegation.epoch,resumed.task.delegation.epoch+1);
  assert.equal((await f.store.requireTask(f.child.id)).status,'queued');
  assert.deepEqual(await f.store.requireTask(f.completedSibling.id),f.completedSibling);
});


test('expired source child waits for explicit recovery and rejects its old owner after recovery',async t=>{
  const f=await fixture(t);
  const started=await f.request(`/api/desktop/${f.child.id}/start`,{expectedVersion:f.child.version,sourceDelegationVersion:1,sourceNames:['alpha.txt']});
  const running=await f.store.requireTask(f.child.id);
  // Seed an already-expired lease; exercise the real HTTP recovery path without sleeping.
  await f.store.replaceTask(running.id,running.version,current=>({...current,version:current.version+1,checkpoint:{...current.checkpoint,expiresAt:'2000-01-01T00:00:00.000Z'}}));
  const poll=await f.request('/api/desktop/poll',{});
  assert.equal(poll.claim,null);
  const expired=await f.store.requireTask(f.child.id);
  assert.equal(expired.status,'paused');
  assert.equal(expired.checkpoint.interruptedBy,'lease_expiry');
  const parent=await f.store.requireTask(f.parent.id);
  const input={expectedVersion:parent.version,childTaskId:expired.id,expectedChildVersion:expired.version};
  assert.equal((await f.raw(`/api/tasks/${parent.id}/delegation/recover`,input)).status,400);
  assert.equal((await f.raw(`/api/tasks/${parent.id}/delegation/recover`,{...input,confirmedStopped:true})).status,200);
  assert.equal((await f.store.requireTask(expired.id)).status,'queued');
  assert.equal((await f.request('/api/desktop/poll',{})).claim,null);
  assert.equal((await f.raw(`/api/desktop/${expired.id}/complete`,{...owner(started.claim),content:'Late result from expired execution'})).status,409);
  assert.deepEqual(await f.store.requireTask(f.completedSibling.id),f.completedSibling);
});
