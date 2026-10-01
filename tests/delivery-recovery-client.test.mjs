import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceClient} from '../public/core/client.mjs';
import {createWorker} from '../worker/index.mjs';
const workspace='11111111-1111-4111-8111-111111111111';
function client(){const c=new WorkspaceClient({baseUrl:'https://inno.example',token:'test-token',remote:true});c.state.capabilities={connected:true,desktopDeliveryRecovery:true};return c;}
const reservation={version:1,workspaceId:workspace,taskId:'task',executionId:'exec',generation:1,claimedAt:'2026-10-01T00:00:00.000Z'};
test('client fresh identity precedes every recovery request with bound protocol options',async()=>{
 const c=client(),calls=[],result={reservations:[reservation],nextAfterKey:null,taskVersion:4,workspaceId:workspace};c.request=async(...args)=>{calls.push(args);return args[0].endsWith('/identity')?{workspaceId:workspace}:result;};
 assert.deepEqual(await c.readDeliveryReservations('task',{expectedVersion:4}),result);assert.deepEqual(await c.readDeliveryReservations('task',{expectedVersion:4,afterKey:'desktop_reservation:'+'a'.repeat(64)},workspace),result);await c.discardDeliveryReservation('task',{reservation,expectedVersion:4,confirmDiscard:true});
 assert.equal(calls.length,6);for(let i=0;i<6;i+=2){assert.equal(calls[i][0],'/api/desktop/identity');assert.deepEqual(calls[i+1][2],{workspaceId:workspace,deliveryReceiptVersion:1});}assert.equal(calls[5][0],'/api/desktop/task/discard');
});
test('client rejects local, disconnected and unsupported recovery before identity lookup',async()=>{
 for(const mode of ['local','offline','unsupported']){const c=client();if(mode==='local')c.remote=false;if(mode==='offline')c.state.capabilities.connected=false;if(mode==='unsupported')c.state.capabilities.desktopDeliveryRecovery=false;let calls=0;c.request=async()=>{calls++;};await assert.rejects(()=>c.readDeliveryReservations('task',{expectedVersion:4}));assert.equal(calls,0);}
});
test('client rejects changed connection, task binding and missing identity before mutation',async()=>{
 for(const mode of ['baseUrl','token','remote','missing','workspace']){const c=client();let calls=0;c.request=async()=>{calls++;if(mode==='baseUrl')c.baseUrl='https://other.example';if(mode==='token')c.token='other';if(mode==='remote')c.remote=false;return mode==='missing'?{}:{workspaceId:mode==='workspace'?'22222222-2222-4222-8222-222222222222':workspace};};await assert.rejects(()=>c.discardDeliveryReservation('task',{reservation,expectedVersion:4,confirmDiscard:true}));assert.equal(calls,1);}
 const c=client();let calls=0;c.request=async()=>{calls++;return {workspaceId:workspace};};await assert.rejects(()=>c.readDeliveryReservations('task',{expectedVersion:4},'22222222-2222-4222-8222-222222222222'));assert.equal(calls,1);
});
test('client preserves acknowledged discard success after account change and snapshots caller input',async()=>{
 const c=client(),input={reservation:{...reservation},expectedVersion:4,confirmDiscard:true};let sent;c.request=async(path,body)=>{if(path.endsWith('/identity')){input.reservation.workspaceId='changed';return {workspaceId:workspace};}sent=body;c.token='new-token';return {released:true};};assert.deepEqual(await c.discardDeliveryReservation('task',input),{released:true});assert.equal(sent.reservation.workspaceId,workspace);
});
test('request accepts only protocol option keys, keeps authentication and refuses redirects',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});const calls=[];globalThis.fetch=async(url,options)=>{calls.push(options);return new Response('{}');};const c=client();await c.request('/api/desktop/task/reservations',{expectedVersion:4},{workspaceId:workspace,deliveryReceiptVersion:1});assert.equal(calls[0].headers.Authorization,'Bearer test-token');assert.equal(calls[0].headers['x-inno-workspace-id'],workspace);assert.equal(calls[0].headers['x-inno-delivery-receipt-version'],'1');assert.equal(calls[0].redirect,'error');
 for(const options of [{headers:{Authorization:'wrong'}},{workspaceId:workspace,deliveryReceiptVersion:2},{deliveryReceiptVersion:1},{workspaceId:'bad',deliveryReceiptVersion:1}])await assert.rejects(()=>c.request('/api/desktop/task/discard',{},options));assert.equal(calls.length,1);
});
test('Worker CORS allows recovery headers only on approved origins',async()=>{
 const worker=createWorker();for(const [origin,status] of [['https://app.example',204],['https://other.example',403]]){const response=await worker.fetch(new Request('https://inno.example/api/desktop/task/reservations',{method:'OPTIONS',headers:{origin,'access-control-request-headers':'x-inno-workspace-id, x-inno-delivery-receipt-version'}}),{CORS_ORIGINS:'https://app.example'});assert.equal(response.status,status);if(status===204){assert.match(response.headers.get('access-control-allow-headers'),/x-inno-workspace-id/);assert.match(response.headers.get('access-control-allow-headers'),/x-inno-delivery-receipt-version/);}}
});
test('UI instance guard prevents a POST when the selected client changes during fresh identity lookup',async()=>{
 for(const action of ['list','discard']){
  const c=client();let current=true,resolveIdentity,calls=0;const identity=new Promise(resolve=>{resolveIdentity=resolve;});c.request=async()=>{calls++;return identity;};
  const operation=action==='discard'?c.discardDeliveryReservation('task',{reservation,expectedVersion:4,confirmDiscard:true},{isCurrent:()=>current}):c.readDeliveryReservations('task',{expectedVersion:4},workspace,{isCurrent:()=>current});current=false;resolveIdentity({workspaceId:workspace});await assert.rejects(operation);assert.equal(calls,1);
 }
});
test('already stale UI guard blocks identity lookup, while completed discard remains acknowledged',async()=>{
 const c=client();let calls=0;c.request=async()=>{calls++;return {workspaceId:workspace};};await assert.rejects(()=>c.discardDeliveryReservation('task',{reservation,expectedVersion:4,confirmDiscard:true},{isCurrent:()=>false}));assert.equal(calls,0);
 let current=true;c.request=async path=>{if(path.endsWith('/identity'))return {workspaceId:workspace};current=false;return {released:true,reservation};};assert.deepEqual(await c.discardDeliveryReservation('task',{reservation,expectedVersion:4,confirmDiscard:true},{isCurrent:()=>current}),{released:true,reservation});
});
