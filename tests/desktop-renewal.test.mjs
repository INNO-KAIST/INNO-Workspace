import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {runDesktopService} from '../server/desktop-service.mjs';
import {DESKTOP_EXECUTION_LEASE_MS} from '../public/core/tasks.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
function box(){let value=null;return {read:()=>value,write:v=>{value=v;},clear:()=>{value=null;}};}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const claim={claim:{task:{id:'t'},executionId:'e',generation:1}};

test('transient renewal failures inside the lease keep the run and deliver its result',async()=>{
 let renews=0,completes=0;
 const bridge=createDesktopBridge({outbox:box(),heartbeatMs:5,leaseMs:10_000,request:async route=>{if(route.endsWith('poll'))return claim;if(route.endsWith('renew')){renews++;throw Error('network');}if(route.endsWith('complete')){completes++;return {};}},runner:{run:async({signal})=>{await wait(60);assert.equal(signal.aborted,false);return {content:'ok'};}}});
 assert.equal(await bridge.tick(),true);
 assert.ok(renews>=1);assert.equal(completes,1);
});

test('retryable statuses are tolerated like transport errors',async()=>{
 let completes=0;const statuses=[503,429,408];
 const bridge=createDesktopBridge({outbox:box(),heartbeatMs:5,leaseMs:10_000,request:async route=>{if(route.endsWith('poll'))return claim;if(route.endsWith('renew'))throw Object.assign(Error('busy'),{status:statuses.shift()??500});if(route.endsWith('complete')){completes++;return {};}},runner:{run:async()=>{await wait(40);return {content:'ok'};}}});
 assert.equal(await bridge.tick(),true);assert.equal(completes,1);
});

test('a lease that stays unconfirmed aborts the run and never uploads its output',async()=>{
 let uploads=0;
 const bridge=createDesktopBridge({outbox:box(),heartbeatMs:5,leaseMs:30,request:async route=>{if(route.endsWith('poll'))return claim;if(route.endsWith('renew'))throw Error('network');uploads++;},runner:{run:({signal})=>new Promise((res,rej)=>signal.addEventListener('abort',()=>rej(Error('aborted'))))}});
 const error=await bridge.tick().catch(e=>e);
 assert.equal(error.code,'DESKTOP_LEASE_UNCONFIRMED');assert.equal(error.status,undefined);assert.equal(uploads,0);
});

test('a successful renewal extends the unconfirmed window',async()=>{
 let n=0,completes=0;
 const bridge=createDesktopBridge({outbox:box(),heartbeatMs:5,leaseMs:200,request:async route=>{if(route.endsWith('poll'))return claim;if(route.endsWith('renew')){if(++n%3)throw Error('network');return {};}if(route.endsWith('complete')){completes++;return {};}},runner:{run:async({signal})=>{await wait(400);assert.equal(signal.aborted,false);return {content:'ok'};}}});
 assert.equal(await bridge.tick(),true);assert.equal(completes,1);
});

test('definitive renewal rejection still aborts at once',async()=>{
 let uploads=0;const started=performance.now();
 const bridge=createDesktopBridge({outbox:box(),heartbeatMs:5,leaseMs:10_000,request:async route=>{if(route.endsWith('poll'))return claim;if(route.endsWith('renew'))throw Object.assign(Error('stale'),{status:409});uploads++;},runner:{run:({signal})=>new Promise((res,rej)=>signal.addEventListener('abort',()=>rej(Error('aborted'))))}});
 const error=await bridge.tick().catch(e=>e);
 assert.equal(error.status,409);assert.equal(uploads,0);assert.ok(performance.now()-started<5_000);
});

test('the desktop default lease matches the cloud desktop claim and renewal lease',async()=>{
 const leases=[];const now='2026-10-01T00:00:00.000Z';
 const store={now:()=>now,requireTask:async()=>({id:'t',version:3,status:'ready',attachments:[]}),assertExecution:()=>{},replaceTask:async(id,v,f)=>f({id,version:v,status:'running',checkpoint:{expiresAt:'2026-10-01T00:01:00.000Z'}}),claimExecution:async(id,input)=>{leases.push(input.leaseMs);return {task:{id}};},db:{prepare:()=>({bind:()=>({run:async()=>{}})})}};
 const cloud=new CloudBridge(store);
 await cloud.start('t',{expectedVersion:3,sourceNames:[]});
 const renewed=await cloud.renew('t',{executionId:'e',generation:1});
 assert.deepEqual(leases,[DESKTOP_EXECUTION_LEASE_MS]);
 assert.equal(Date.parse(renewed.checkpoint.expiresAt)-Date.parse(now),DESKTOP_EXECUTION_LEASE_MS);
});

test('outbox write failure delivers the in-memory result once and blocks new claims',async()=>{
 let polls=0,completes=0;
 const outbox={read:()=>null,write:()=>{throw Error('ENOSPC');},clear:()=>{}};
 const bridge=createDesktopBridge({outbox,request:async route=>{if(route.endsWith('poll')){polls++;return claim;}if(route.endsWith('complete')){completes++;return {};}},runner:{run:async()=>({content:'ok'})}});
 const error=await bridge.tick().catch(e=>e);
 assert.equal(error.code,'OUTBOX_WRITE_FAILED');assert.equal(error.delivered,true);assert.equal(error.status,409);
 assert.equal(completes,1);
 const again=await bridge.tick().catch(e=>e);
 assert.equal(again.code,'OUTBOX_WRITE_FAILED');assert.equal(polls,1);
 await assert.rejects(()=>bridge.startTask('t',{expectedVersion:1,materials:[]}),e=>e.code==='OUTBOX_WRITE_FAILED');
});

test('outbox write failure reports an undelivered result and the service stops polling',async()=>{
 let polls=0;const errors=[];const guard=new AbortController();
 const outbox={read:()=>null,write:()=>{throw Error('EPERM');},clear:()=>{}};
 const bridge=createDesktopBridge({outbox,request:async route=>{if(route.endsWith('poll')){if(++polls>3)guard.abort();return claim;}throw Error('network');},runner:{run:async()=>({content:'ok'})}});
 await runDesktopService({bridge,signal:guard.signal,onError:e=>errors.push(e),wait:async()=>{}});
 assert.equal(polls,1);assert.equal(errors.length,1);
 assert.equal(errors[0].code,'OUTBOX_WRITE_FAILED');assert.equal(errors[0].delivered,false);
});

test('renewals stop once the run is aborted even if the runner exits late',async()=>{
 let renews=0,atAbort=-1;
 const bridge=createDesktopBridge({outbox:box(),heartbeatMs:5,leaseMs:10_000,request:async route=>{if(route.endsWith('poll'))return claim;if(route.endsWith('renew')){renews++;throw Object.assign(Error('stale'),{status:409});}},runner:{run:({signal})=>new Promise((res,rej)=>signal.addEventListener('abort',()=>{atAbort=renews;setTimeout(()=>rej(Error('aborted')),80);}))}});
 await bridge.tick().catch(()=>{});
 assert.ok(atAbort>=0);assert.equal(renews,atAbort);
});

for(const status of [401,403,404])test(`renewal rejection ${status} aborts at once`,async()=>{
 const started=performance.now();
 const bridge=createDesktopBridge({outbox:box(),heartbeatMs:5,leaseMs:10_000,request:async route=>{if(route.endsWith('poll'))return claim;if(route.endsWith('renew'))throw Object.assign(Error('denied'),{status});},runner:{run:({signal})=>new Promise((res,rej)=>signal.addEventListener('abort',()=>rej(Error('aborted'))))}});
 const error=await bridge.tick().catch(e=>e);assert.equal(error.status,status);assert.ok(performance.now()-started<5_000);
});

test('a result that cannot be built is not reported as a disk failure and does not latch',async()=>{
 let polls=0;
 const bridge=createDesktopBridge({outbox:box(),request:async route=>{if(route.endsWith('poll')){polls++;return polls===1?claim:{claim:null};}return {};},runner:{run:async()=>undefined}});
 const error=await bridge.tick().catch(e=>e);
 assert.notEqual(error.code,'OUTBOX_WRITE_FAILED');
 assert.equal(await bridge.tick(),false);assert.equal(polls,2);
});

test('direct start latches after an outbox write failure and blocks maintenance',async()=>{
 let completes=0,polls=0;const errors=[];
 const outbox={read:()=>null,write:()=>{throw Error('ENOSPC');},clear:()=>{}};
 const bridge=createDesktopBridge({outbox,onError:e=>errors.push(e),request:async route=>{if(route.endsWith('/start'))return claim;if(route.endsWith('poll')){polls++;return claim;}if(route.endsWith('complete')){completes++;return {};}},runner:{run:async()=>({content:'ok'})}});
 await bridge.startTask('t',{expectedVersion:1,materials:[]});await bridge.settled();
 assert.equal(errors[0].code,'OUTBOX_WRITE_FAILED');assert.equal(completes,1);
 await assert.rejects(()=>bridge.tick(),e=>e.code==='OUTBOX_WRITE_FAILED');assert.equal(polls,0);
 await assert.rejects(()=>bridge.maintenance(async()=>{}),e=>e.code==='OUTBOX_WRITE_FAILED');
});

test('v0 tick clears the saved outbox only after delivery succeeds',async()=>{
 const outbox=box();let fail=true;
 const bridge=createDesktopBridge({outbox,request:async route=>{if(route.endsWith('poll'))return claim;if(route.endsWith('complete')){if(fail){fail=false;throw Error('network');}return {};}},runner:{run:async()=>({content:'ok'})}});
 await assert.rejects(()=>bridge.tick());assert.equal(outbox.read().action,'complete');
 assert.equal(await bridge.tick(),true);assert.equal(outbox.read(),null);
});
