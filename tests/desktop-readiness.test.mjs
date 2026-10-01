import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
import {createDesktopReadiness} from '../server/desktop-readiness.mjs';

const binding={origin:'https://inno.example',workspaceId:'11111111-1111-4111-8111-111111111111'};
function box(saved=null){let value=saved;return {read:()=>value,write:v=>{value=v;},clear:()=>{value=null;}};}
function readiness(events,{available=false,storage=async()=>{events.push('storage');}}={}){
 const runner={available:async()=>{events.push('available');if(available instanceof Error)throw available;return available;}};
 return createDesktopReadiness({runner,runRoot:'unused',checkStorage:storage});
}

test('readiness checks storage before subscription availability and rejects unavailable Codex',async()=>{
 const events=[];await assert.rejects(readiness(events)(),/Sign in to Codex/);assert.deepEqual(events,['storage','available']);
 const failed=[];await assert.rejects(readiness(failed,{storage:async()=>{failed.push('storage');throw Error('storage full');}})(),/storage full/);assert.deepEqual(failed,['storage']);
});

test('saved legacy result drains while Codex is unavailable, without a new claim',async()=>{
 const events=[],outbox=box({taskId:'t',action:'complete',input:{executionId:'e',generation:1,content:'saved'}});
 const bridge=createDesktopBridge({outbox,beforeClaim:readiness(events),runner:{models:()=>{events.push('models');}},request:async route=>{events.push(route);}});
 assert.equal(await bridge.tick(),true);assert.deepEqual(events,['/api/desktop/t/complete']);assert.equal(outbox.read(),null);
 await assert.rejects(()=>bridge.tick(),/Sign in to Codex/);assert.deepEqual(events.slice(1),['storage','available']);
});

test('saved receipt pending and ACK both drain while Codex is unavailable',async()=>{
 const pending={version:1,phase:'pending',binding,taskId:'t',action:'complete',input:{executionId:'e',generation:1,content:'saved'}};
 const receipt={...await createDeliveryReceipt({workspaceId:binding.workspaceId,taskId:'t',action:'complete',input:pending.input}),acceptedAt:'2026-10-01T00:00:00.000Z'};
 for(const saved of [pending,{version:1,phase:'ack_pending',binding,receipt}]){
  const events=[],outbox=box(saved),bridge=createDesktopBridge({deliveryReceiptVersion:1,outbox,beforeClaim:readiness(events),readDeliveryBinding:async()=>binding,runner:{models:()=>{events.push('models');}},request:async route=>{events.push(route);return route.endsWith('/ack')?{receipt,released:true}:{deliveryReceipt:receipt};}});
  assert.equal(await bridge.tick(),true);assert.deepEqual(events,saved.phase==='pending'?['/api/desktop/t/complete','/api/desktop/t/ack']:['/api/desktop/t/ack']);assert.equal(outbox.read(),null);
 }
});

test('unavailable Codex blocks poll and direct start before remote ownership',async()=>{
 const events=[],bridge=createDesktopBridge({outbox:box(),beforeClaim:readiness(events),runner:{models:()=>{events.push('models');}},request:async route=>{events.push(route);}});
 await assert.rejects(()=>bridge.tick(),/Sign in to Codex/);
 await assert.rejects(()=>bridge.startTask('t',{expectedVersion:1,materials:[]}),/Sign in to Codex/);
 assert.deepEqual(events,['storage','available','storage','available']);
 const thrown=[];const failedBridge=createDesktopBridge({outbox:box(),beforeClaim:readiness(thrown,{available:Error('login probe failed')}),runner:{},request:async()=>{throw Error('remote request forbidden');}});
 await assert.rejects(()=>failedBridge.tick(),/login probe failed/);assert.deepEqual(thrown,['storage','available']);
});

test('available Codex proceeds to polling only after readiness checks',async()=>{
 const events=[],bridge=createDesktopBridge({outbox:box(),beforeClaim:readiness(events,{available:true}),runner:{models:async()=>{events.push('models');return [];},run:async()=>{throw Error('unexpected run');}},request:async route=>{events.push(route);return {claim:null};}});
 assert.equal(await bridge.tick(),false);assert.deepEqual(events,['storage','available','models','/api/desktop/poll']);
});
