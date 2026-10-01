import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {TestD1} from './helpers/d1.mjs';
import exportedWorker,{createWorker} from '../worker/index.mjs';
const workspace='11111111-1111-4111-8111-111111111111',token='local-recovery-test-token-0123456789';
const binding={origin:'https://inno.example',workspaceId:workspace},reservation={version:1,workspaceId:workspace,taskId:'task',executionId:'exec',generation:1,claimedAt:'2026-10-01T00:00:00.000Z'};
async function fixture(t,{bindingReader=async()=>binding,bridge,cloudCapability=true,requestHook}={}){
 const calls=[];bridge??={status:()=>({}),maintenance:async work=>work()};const request=async(...args)=>{calls.push(args);if(requestHook)return requestHook(...args);return args[0]==='/api/state'?{capabilities:{desktopDeliveryRecovery:cloudCapability}}:{reservations:[],workspaceId:workspace};};
 const server=createDesktopServer({token,publicDir:new URL('../public',import.meta.url),request,bridge,readDeliveryBinding:bindingReader});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=async(path,input,{auth=true,version='1',workspaceId=workspace}={})=>{const response=await fetch('http://127.0.0.1:'+server.address().port+path,{method:input===undefined?'GET':'POST',headers:{connection:'close',...(auth?{authorization:'Bearer '+token}:{}),'content-type':'application/json',...(version!==null?{'x-inno-delivery-receipt-version':version}:{}),...(workspaceId!==null?{'x-inno-workspace-id':workspaceId}:{})},body:input===undefined?undefined:JSON.stringify(input)});return {status:response.status,...await response.json()};};return {calls,call};
}
test('local recovery explicit allowlist authenticates identity and forwards only bound options',async t=>{
 const f=await fixture(t);assert.equal((await f.call('/api/desktop/identity',undefined,{auth:false})).status,401);assert.equal((await f.call('/api/desktop/identity')).workspaceId,workspace);assert.equal((await f.call('/api/desktop/task/reservations',{expectedVersion:4})).status,200);assert.deepEqual(f.calls.at(-1),['/api/desktop/task/reservations',{expectedVersion:4},{workspaceId:workspace,deliveryReceiptVersion:1}]);assert.equal((await f.call('/api/desktop/task/discard',{reservation,expectedVersion:4,confirmDiscard:true})).status,200);assert.equal((await f.call('/api/desktop/task/unknown',{})).status,404);
});
test('local recovery refuses missing binding, protocol, workspace or body binding before forwarding',async t=>{
 const noBinding=await fixture(t,{bindingReader:null});assert.ok([400,404,409].includes((await noBinding.call('/api/desktop/identity')).status));assert.ok([400,404,409].includes((await noBinding.call('/api/desktop/task/reservations',{})).status));assert.equal(noBinding.calls.length,0);
 const f=await fixture(t);for(const opts of [{version:null},{version:'2'},{workspaceId:null},{workspaceId:'22222222-2222-4222-8222-222222222222'}])assert.ok([400,409].includes((await f.call('/api/desktop/task/reservations',{expectedVersion:4},opts)).status));assert.equal((await f.call('/api/desktop/task/discard',{reservation:{...reservation,workspaceId:'22222222-2222-4222-8222-222222222222'},expectedVersion:4,confirmDiscard:true})).status,409);assert.equal(f.calls.length,0);
});
test('discard rechecks binding inside maintenance; listing remains available without maintenance',async t=>{
 let reads=0,maintenance=0;const f=await fixture(t,{bindingReader:async()=>++reads===1?binding:{...binding,workspaceId:'22222222-2222-4222-8222-222222222222'},bridge:{status:()=>({}),maintenance:async work=>{maintenance++;return work();}}});assert.equal((await f.call('/api/desktop/task/discard',{reservation,expectedVersion:4,confirmDiscard:true})).status,409);assert.equal(f.calls.length,0);assert.equal(maintenance,1);
 const list=await fixture(t,{bridge:{status:()=>({}),maintenance:()=>{throw Error('must not lock listing');}}});assert.equal((await list.call('/api/desktop/task/reservations',{expectedVersion:4})).status,200);
});
test('actual bridge maintenance blocks local discard during pending, busy and unsafe delivery',async t=>{
 for(const mode of ['pending','busy','unsafe']){
  const outbox={read:()=>mode==='pending'?{phase:'pending'}:null},bridge=createDesktopBridge({deliveryReceiptVersion:1,readDeliveryBinding:async()=>binding,outbox,runner:{},request:async()=>null});let release,held;
  if(mode==='busy'){held=bridge.maintenance(()=>new Promise(resolve=>{release=resolve;}));t.after(()=>release());}if(mode==='unsafe')await assert.rejects(()=>bridge.tick());
  const f=await fixture(t,{bridge});assert.equal((await f.call('/api/desktop/task/discard',{reservation,expectedVersion:4,confirmDiscard:true})).status,409);assert.equal(f.calls.length,0);if(release){release();await held;}
 }
});
test('local capability requires both cloud support and binding; cloud errors retain status',async t=>{
 for(const [cloudCapability,bindingReader,expected] of [[true,async()=>binding,true],[false,async()=>binding,false],[true,null,false]]){const f=await fixture(t,{cloudCapability,bindingReader});assert.equal((await f.call('/api/state')).capabilities.desktopDeliveryRecovery,expected);}
 const f=await fixture(t,{requestHook:()=>{throw Object.assign(Error('capacity conflict'),{status:409});}});assert.equal((await f.call('/api/desktop/task/reservations',{expectedVersion:4})).status,409);
});
test('Worker recovery capability is advertised only by internal version1',async t=>{
 const db=new TestD1();t.after(()=>db.close());for(const [worker,expected] of [[exportedWorker,false],[createWorker({deliveryReceiptVersion:1}),true]]){const response=await worker.fetch(new Request('https://inno.example/api/state',{headers:{authorization:'Bearer '+token}}),{DB:db,ACCESS_TOKEN:token});assert.equal((await response.json()).capabilities.desktopDeliveryRecovery===true,expected);}
});
test('proxy refuses a changed cloud origin even when workspace UUID remains the same',async t=>{
 let reads=0;const f=await fixture(t,{bindingReader:async()=>++reads===1?binding:{...binding,origin:'https://other.example'}});assert.equal((await f.call('/api/desktop/task/discard',{reservation,expectedVersion:4,confirmDiscard:true})).status,409);assert.equal(f.calls.length,0);
});
test('unauthorized recovery POST and unsupported identity methods never reach cloud or maintenance',async t=>{
 const f=await fixture(t,{bridge:{status:()=>({}),maintenance:()=>{throw Error('unexpected maintenance');}}});assert.equal((await f.call('/api/desktop/task/discard',{reservation,expectedVersion:4,confirmDiscard:true},{auth:false})).status,401);assert.equal((await f.call('/api/desktop/identity',{})).status,404);assert.equal(f.calls.length,0);
});
