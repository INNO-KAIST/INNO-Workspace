import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createOutboxRecovery} from '../server/outbox-recovery.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
const binding={origin:'https://inno.example',workspaceId:'11111111-1111-4111-8111-111111111111'};
const record=()=>({version:1,phase:'pending',binding,taskId:'task',action:'complete',input:{executionId:'exec',generation:1,content:'PRIVATE_OUTPUT'}});
function fixture(t){const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.inno/tmp');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'bridge-recovery-')),file=path.join(dir,'pending.json');t.after(()=>{for(const name of [file,file+'.tmp'])if(fs.existsSync(name))fs.unlinkSync(name);fs.rmdirSync(dir);});return file;}
function make({outbox={read:()=>null},request=async()=>({claim:null,workspaceId:binding.workspaceId,deliveryReceiptVersion:1}),...options}={}){return createDesktopBridge({deliveryReceiptVersion:1,outbox,request,readDeliveryBinding:async()=>binding,runner:{run:()=>{throw Error('AI must not run');}},...options});}
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};};
test('recovery inspection uses the same synchronous busy lock without latching unsafe',async()=>{
 const bridge=make(),gate=deferred();let entered=false;const inspection=bridge.recoveryInspect(async()=>{entered=true;await gate.promise;return 'metadata';});assert.equal(bridge.status().busy,true);assert.equal(bridge.status().deliveryUnsafe,false);assert.equal(await bridge.tick(),false);await assert.rejects(()=>bridge.startTask('task',{materials:[]}));await assert.rejects(()=>bridge.maintenance(()=>{}));await assert.rejects(()=>bridge.recoveryMaintenance(()=>{}));gate.resolve();assert.equal(await inspection,'metadata');assert.equal(entered,true);assert.equal(bridge.status().busy,false);assert.equal(bridge.status().deliveryUnsafe,false);
});
test('recovery mutation latches unsafe before work and retains it after success or failure',async()=>{
 for(const failed of [false,true]){const bridge=make();const operation=bridge.recoveryMaintenance(()=>{assert.equal(bridge.status().deliveryUnsafe,true);if(failed)throw Error('failure');return 'saved';});assert.equal(bridge.status().busy,true);assert.equal(bridge.status().deliveryUnsafe,true);if(failed)await assert.rejects(operation,/failure/);else assert.equal(await operation,'saved');assert.equal(bridge.status().busy,false);assert.equal(bridge.status().deliveryUnsafe,true);await assert.rejects(()=>bridge.tick());await assert.rejects(()=>bridge.startTask('task',{materials:[]}));}
});
test('recovery APIs reject legacy, busy and stopped instances before callbacks',async()=>{
 for(const mode of ['legacy','busy','stopped']){const bridge=make({deliveryReceiptVersion:mode==='legacy'?0:1});let called=0,hold,gate;if(mode==='busy'){gate=deferred();hold=bridge.maintenance(()=>gate.promise);}if(mode==='stopped')bridge.stop();for(const method of ['recoveryInspect','recoveryMaintenance'])await assert.rejects(()=>bridge[method](()=>{called++;}));assert.equal(called,0);if(gate){gate.resolve();await hold;}}
});
test('stop and settled wait for already-started recovery without turning promotion success into failure',async()=>{
 const bridge=make(),gate=deferred();const operation=bridge.recoveryMaintenance(async()=>{await gate.promise;return {promoted:true};});bridge.stop();let settled=false;const waiting=bridge.settled().then(()=>{settled=true;});await new Promise(setImmediate);assert.equal(settled,false);assert.equal(bridge.status().busy,true);gate.resolve();assert.deepEqual(await operation,{promoted:true});await waiting;assert.equal(settled,true);assert.equal(bridge.status().busy,false);assert.equal(bridge.status().stopped,true);
});
test('status read errors return safe pending metadata and latch v1 admission after external file deletion',async()=>{
 for(const source of ['status','tick','start','maintenance']){let broken=true,calls=0;const bridge=make({outbox:{read:()=>{if(broken)throw Error('PRIVATE_OUTPUT_TOKEN');return null;}},request:async()=>{calls++;}});
  if(source==='status'){const status=bridge.status();assert.equal(status.pending,true);assert.equal(status.recoveryRequired,true);assert.equal(JSON.stringify(status).includes('PRIVATE_OUTPUT_TOKEN'),false);}else if(source==='tick')await assert.rejects(()=>bridge.tick());else if(source==='start')await assert.rejects(()=>bridge.startTask('task',{materials:[]}));else await assert.rejects(()=>bridge.maintenance(()=>{}));
  broken=false;assert.equal(bridge.status().deliveryUnsafe,true);await assert.rejects(()=>bridge.tick());await assert.rejects(()=>bridge.startTask('task',{materials:[]}));assert.equal(calls,0);
 }
 const legacy=make({deliveryReceiptVersion:0,outbox:{read:()=>{throw Error('PRIVATE');}}});assert.deepEqual(legacy.status(),{busy:false,stopped:false,pending:true,recoveryRequired:true,sourceDelegationVersion:0});
});
test('real helper promotion shares bridge lock, permits saved delivery drain and never starts a fresh claim',async t=>{
 const file=fixture(t),p=record();fs.writeFileSync(file,JSON.stringify(p));fs.writeFileSync(file+'.tmp',JSON.stringify(p));const calls=[],outbox=createFileOutbox(file),bridge=make({outbox,request:async(route,input)=>{calls.push(route);if(route.endsWith('/complete'))return {deliveryReceipt:{...await createDeliveryReceipt({workspaceId:binding.workspaceId,taskId:'task',action:'complete',input}),acceptedAt:'2026-10-01T00:00:00.000Z'}};if(route.endsWith('/ack'))return {receipt:input.receipt,released:true};throw Error('new claim forbidden');}});
 const recovery=createOutboxRecovery(file,{withExclusive:work=>bridge.recoveryMaintenance(work)}),view=await bridge.recoveryInspect(()=>recovery.inspect());assert.equal(view.canPromote,true);assert.equal((await recovery.promote({pendingHash:view.pending.sha256,temporaryHash:view.temporary.sha256,confirm:true})).promoted,true);assert.equal(bridge.status().deliveryUnsafe,true);await bridge.tick();assert.equal(outbox.read(),null);await assert.rejects(()=>bridge.tick());assert.deepEqual(calls,['/api/desktop/task/complete','/api/desktop/task/ack']);
});
test('failed real promotion keeps files and sticky unsafe but permits another explicit recovery attempt',async t=>{
 const file=fixture(t),p=record();fs.writeFileSync(file+'.tmp',JSON.stringify(p));const bridge=make({outbox:createFileOutbox(file)}),recovery=createOutboxRecovery(file,{withExclusive:work=>bridge.recoveryMaintenance(work)}),view=await bridge.recoveryInspect(()=>recovery.inspect());await assert.rejects(()=>recovery.promote({pendingHash:null,temporaryHash:'0'.repeat(64),confirm:true}));assert.equal(fs.existsSync(file+'.tmp'),true);assert.equal(bridge.status().deliveryUnsafe,true);assert.equal((await recovery.promote({pendingHash:null,temporaryHash:view.temporary.sha256,confirm:true})).promoted,true);
});
test('inspection synchronous throw and asynchronous rejection release busy without latching unsafe',async()=>{
 for(const work of [()=>{throw Error('sync');},async()=>{throw Error('async');}]){const bridge=make();await assert.rejects(()=>bridge.recoveryInspect(work));await bridge.settled();assert.equal(bridge.status().busy,false);assert.equal(bridge.status().deliveryUnsafe,false);}
});
