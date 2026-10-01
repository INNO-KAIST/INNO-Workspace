import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createCloudRequest} from '../server/delivery-binding.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
const binding={origin:'https://inno.example',workspaceId:'11111111-1111-4111-8111-111111111111'};
const claim={task:{id:'task',status:'running',checkpoint:{provider:'codex',status:'running',executionId:'exec',generation:1,deliveryReceiptVersion:1}},executionId:'exec',generation:1};
const acceptedAt='2026-10-01T00:00:00.000Z';
function setup({saved=null,hook=()=>{},writeHook=()=>{},clearHook=()=>{},readBinding=()=>binding,run=async()=>({content:'ok'})}={}){
 let value=saved,runs=0;const calls=[],writes=[];
 const outbox={read:()=>structuredClone(value),write:record=>{writeHook(record);writes.push(structuredClone(record));value=structuredClone(record);},clear:()=>{clearHook();value=null;}};
 const request=async(path,input,options)=>{
  calls.push({path,input:structuredClone(input),options});const intercepted=await hook(path,input,options);if(intercepted!==undefined)return intercepted;
  if(/\/(poll|start)$/.test(path))return {claim:structuredClone(claim),workspaceId:binding.workspaceId,deliveryReceiptVersion:1};
  if(/\/(complete|fail)$/.test(path))return {deliveryReceipt:{...await createDeliveryReceipt({workspaceId:binding.workspaceId,taskId:'task',action:path.split('/').at(-1),input}),acceptedAt}};
  if(path.endsWith('/ack'))return {receipt:input.receipt,released:true};
  return {task:{}};
 };
 const make=(extra={})=>createDesktopBridge({deliveryReceiptVersion:1,request,outbox,runner:{run:async args=>{runs++;return run(args);}},readDeliveryBinding:readBinding,...extra});
 return {make,outbox,calls,writes,runs:()=>runs};
}
const pending=()=>({version:1,phase:'pending',binding,taskId:'task',action:'complete',input:{executionId:'exec',generation:1,content:'saved'}});
async function ackPending(){const p=pending();return {version:1,phase:'ack_pending',binding,receipt:{...await createDeliveryReceipt({workspaceId:binding.workspaceId,taskId:p.taskId,action:p.action,input:p.input}),acceptedAt}};}
test('versioned execution saves exact wire pending then payload-free ACK phase before releasing and clearing',async()=>{
 const f=setup(),bridge=f.make();assert.equal(await bridge.tick(),true);assert.equal(f.runs(),1);assert.deepEqual(f.calls.map(c=>c.path),['/api/desktop/poll','/api/desktop/task/complete','/api/desktop/task/ack']);
 assert.equal(f.writes[0].version,1);assert.equal(f.writes[0].phase,'pending');assert.deepEqual(f.writes[0].input,f.calls[1].input);assert.equal(Object.hasOwn(f.writes[0].input,'checkpoint'),false);
 assert.deepEqual(Object.keys(f.writes[1]).sort(),['binding','phase','receipt','version']);assert.equal(f.writes[1].phase,'ack_pending');assert.equal(f.outbox.read(),null);
 for(const call of f.calls)assert.deepEqual(call.options,{workspaceId:binding.workspaceId,deliveryReceiptVersion:1});
});
test('lost result response retains pending and replays result once without another claim or run',async()=>{
 let count=0;const f=setup({hook:path=>{if(path.endsWith('/complete')&&++count===1)throw Error('response lost');}}),bridge=f.make();await assert.rejects(()=>bridge.tick(),/response lost/);assert.equal(f.outbox.read().phase,'pending');await bridge.tick();assert.equal(f.runs(),1);assert.equal(f.calls.filter(c=>c.path.endsWith('/poll')).length,1);assert.equal(count,2);assert.equal(f.outbox.read(),null);
});
test('ACK loss and clear failure restart only ACK, never poll, runner, or original result',async()=>{
 for(const kind of ['ack','clear']){
  let fail=true;const f=setup({saved:await ackPending(),hook:path=>{if(kind==='ack'&&fail&&path.endsWith('/ack'))throw Error('ack lost');},clearHook:()=>{if(kind==='clear'&&fail)throw Error('clear failed');}});
  await assert.rejects(()=>f.make().tick());assert.equal(f.outbox.read().phase,'ack_pending');fail=false;await f.make().tick();assert.equal(f.runs(),0);assert.ok(f.calls.every(c=>c.path.endsWith('/ack')));assert.equal(f.outbox.read(),null);
 }
});
test('pending write failure latches unsafe delivery and blocks all future claim/start admission',async()=>{
 const f=setup({writeHook:()=>{throw Error('disk full');}}),bridge=f.make();await assert.rejects(()=>bridge.tick(),/disk full/);assert.equal(f.outbox.read(),null);assert.equal(bridge.status().deliveryUnsafe,true);
 await assert.rejects(()=>bridge.tick());await assert.rejects(()=>bridge.startTask('task',{expectedVersion:1,materials:[]}));assert.equal(f.runs(),1);assert.equal(f.calls.length,1);
});
test('ACK phase replacement failure preserves pending and sends no ACK',async()=>{
 const f=setup({saved:pending(),writeHook:record=>{if(record.phase==='ack_pending')throw Error('rename failed');}});await assert.rejects(()=>f.make().tick(),/rename failed/);assert.equal(f.outbox.read().phase,'pending');assert.equal(f.calls.length,1);assert.ok(f.calls[0].path.endsWith('/complete'));assert.equal(f.runs(),0);
});
test('forged or incomplete server receipt never replaces pending or sends ACK',async()=>{
 for(const mutation of [r=>({...r,payloadDigest:'0'.repeat(64)}),r=>({...r,id:'0'.repeat(64)}),r=>({...r,acceptedAt:'bad'}),r=>({...r,extra:true}),r=>{const {acceptedAt,...rest}=r;return rest;}]){
  const p=pending(),receipt={...await createDeliveryReceipt({workspaceId:binding.workspaceId,taskId:p.taskId,action:p.action,input:p.input}),acceptedAt};
  const f=setup({saved:p,hook:path=>path.endsWith('/complete')?{deliveryReceipt:mutation(receipt)}:undefined});await assert.rejects(()=>f.make().tick());assert.deepEqual(f.outbox.read(),p);assert.equal(f.calls.length,1);
 }
});
test('invalid saved phases, binding, receipts, and legacy records fail closed before any request',async()=>{
 const ack=await ackPending();for(const saved of [{...pending(),phase:'other'},{...pending(),version:2},{...pending(),binding:null},{...pending(),binding:{...binding,workspaceId:'22222222-2222-4222-8222-222222222222'}},{...ack,receipt:{...ack.receipt,id:'0'.repeat(64)}},{taskId:'task',action:'complete',input:pending().input,binding}]){
  const f=setup({saved});await assert.rejects(()=>f.make().tick());assert.equal(f.calls.length,0);assert.deepEqual(f.outbox.read(),saved);
 }
 const f=setup({saved:pending()});await assert.rejects(()=>f.make({deliveryReceiptVersion:0}).tick());assert.equal(f.calls.length,0);
});
test('missing negotiation, workspace, owner or checkpoint confirmation blocks runner for poll and direct start',async()=>{
 const valid={claim,workspaceId:binding.workspaceId,deliveryReceiptVersion:1};
 const invalid=[{...valid,deliveryReceiptVersion:undefined},{...valid,workspaceId:'other'},{...valid,claim:{...claim,executionId:'other'}},{...valid,claim:{...claim,generation:2}},{...valid,claim:{...claim,task:{...claim.task,checkpoint:{...claim.task.checkpoint,deliveryReceiptVersion:undefined}}}},{...valid,claim:{...claim,task:{...claim.task,id:'wrong'}}}];
 for(const response of invalid)for(const mode of ['poll','start']){
  if(mode==='poll'&&response.claim.task.id==='wrong')continue;
  const f=setup({hook:path=>/\/(poll|start)$/.test(path)?response:undefined}),bridge=f.make();await assert.rejects(()=>mode==='poll'?bridge.tick():bridge.startTask('task',{expectedVersion:1,materials:[]}));assert.equal(f.runs(),0);assert.equal(f.writes.length,0);
 }
 assert.throws(()=>setup().make({readDeliveryBinding:undefined}));
});
test('ACK reply must echo exact receipt and a boolean release result before clear',async()=>{
 for(const reply of [{released:true},{receipt:{},released:true},{receipt:(await ackPending()).receipt,released:'true'}]){
  const saved=await ackPending(),f=setup({saved,hook:()=>reply});await assert.rejects(()=>f.make().tick());assert.deepEqual(f.outbox.read(),saved);
 }
});
test('renewals send workspace binding without receipt header',async()=>{
 const f=setup({run:async()=>{await new Promise(r=>setTimeout(r,15));return {content:'ok'};}});await f.make({heartbeatMs:2}).tick();const renewals=f.calls.filter(c=>c.path.endsWith('/renew'));assert.ok(renewals.length>0);for(const call of renewals)assert.deepEqual(call.options,{workspaceId:binding.workspaceId});
});
test('cloud request sends only validated receipt version options and rejects bad versions before fetch',async()=>{
 const calls=[],request=createCloudRequest({endpoint:binding.origin,token:'token',fetchFn:async(url,options)=>{calls.push({url,options});return new Response('{}');}});
 await request('/api/desktop/poll',{}, {workspaceId:binding.workspaceId,deliveryReceiptVersion:1});assert.equal(calls[0].options.headers['x-inno-delivery-receipt-version'],'1');
 for(const version of [0,2,'1',null])await assert.rejects(()=>request('/api/desktop/poll',{}, {workspaceId:binding.workspaceId,deliveryReceiptVersion:version}));
 assert.equal(calls.length,1);await request('/api/desktop/task/renew',{}, {workspaceId:binding.workspaceId});assert.equal(calls[1].options.headers['x-inno-delivery-receipt-version'],undefined);
});
test('async outbox writes and clear are awaited, and async rejection retains the safe phase',async()=>{
 for(const phase of ['pending','ack_pending','clear']){
  const f=setup(),base=f.outbox;let release,entered;
  const blocked=new Promise(resolve=>{entered=resolve;});
  const outbox={...base,write:async record=>{if(record.phase===phase){entered();await new Promise((resolve,reject)=>{release=reject;});}base.write(record);},clear:async()=>{if(phase==='clear'){entered();await new Promise((resolve,reject)=>{release=reject;});}base.clear();}};
  const bridge=f.make({outbox}),running=bridge.tick();await blocked;
  assert.equal(f.calls.filter(c=>c.path.endsWith('/ack')).length,phase==='clear'?1:0);release(Error('async disk failure'));await assert.rejects(running,/async disk failure/);
  if(phase==='pending'){assert.equal(bridge.status().deliveryUnsafe,true);assert.equal(base.read(),null);}else assert.equal(base.read().phase,phase==='clear'?'ack_pending':'pending');
 }
});
test('renew failure persists runner output before error and blocks new AI while allowing pending drain',async()=>{
 const f=setup({hook:path=>{if(path.endsWith('/renew'))throw Object.assign(Error('renew failed'),{status:409});},run:({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({content:'finished before stop'})))}),bridge=f.make({heartbeatMs:2});
 await assert.rejects(()=>bridge.tick(),/renew failed/);assert.equal(f.outbox.read().phase,'pending');assert.equal(f.outbox.read().input.content,'finished before stop');assert.equal(bridge.status().deliveryUnsafe,true);assert.equal(f.calls.filter(c=>c.path.endsWith('/complete')).length,0);
 await bridge.tick();await assert.rejects(()=>bridge.tick());assert.equal(f.runs(),1);assert.equal(f.calls.filter(c=>c.path.endsWith('/poll')).length,1);
});
test('unconfirmed lease after transient renew failures persists runner output and blocks new AI',async()=>{
 const f=setup({hook:path=>{if(path.endsWith('/renew'))throw Error('network');},run:({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({content:'finished before stop'})))}),bridge=f.make({heartbeatMs:2,leaseMs:20});
 await assert.rejects(()=>bridge.tick(),e=>e.code==='DESKTOP_LEASE_UNCONFIRMED');assert.equal(f.outbox.read().phase,'pending');assert.equal(f.outbox.read().input.content,'finished before stop');assert.equal(bridge.status().deliveryUnsafe,true);assert.equal(f.calls.filter(c=>c.path.endsWith('/complete')).length,0);
 assert.equal(f.runs(),1);assert.equal(f.calls.filter(c=>c.path.endsWith('/poll')).length,1);
});
test('explicit stop preserves failed result, prohibits delivery in stopped instance and permits restart drain',async()=>{
 let started;const entered=new Promise(resolve=>{started=resolve;}),f=setup({run:({signal})=>{started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped runner'))));}}),bridge=f.make();
 const running=bridge.tick();await entered;bridge.stop();await assert.rejects(running,/Desktop execution stopped/);assert.equal(f.outbox.read().action,'fail');assert.equal(f.outbox.read().phase,'pending');assert.equal(await bridge.tick(),false);assert.equal(f.calls.length,1);
 await f.make().tick();assert.equal(f.runs(),1);assert.equal(f.outbox.read(),null);
});
test('direct versioned start executes only the verified owner and sends a receipt-aware result',async()=>{
 const f=setup(),bridge=f.make();assert.equal((await bridge.startTask('task',{expectedVersion:1,materials:[]})).id,'task');await bridge.settled();assert.equal(f.runs(),1);assert.equal(f.calls[0].options.deliveryReceiptVersion,1);assert.equal(f.writes[1].phase,'ack_pending');assert.equal(f.outbox.read(),null);
});
test('stop during result response preserves ACK phase without issuing ACK until restart',async()=>{
 let bridge;const f=setup({saved:pending(),hook:path=>{if(path.endsWith('/complete'))bridge.stop();}});bridge=f.make();await assert.rejects(()=>bridge.tick());assert.equal(f.outbox.read().phase,'ack_pending');assert.equal(f.calls.length,1);await f.make().tick();assert.equal(f.calls[1].path,'/api/desktop/task/ack');assert.equal(f.runs(),0);
});
test('invalid runner result latches unsafe before any next AI claim',async()=>{
 const f=setup({run:async()=>null}),bridge=f.make();await assert.rejects(()=>bridge.tick());assert.equal(bridge.status().deliveryUnsafe,true);await assert.rejects(()=>bridge.tick());assert.equal(f.runs(),1);
});
test('workspace change while result is in flight retains ACK phase without sending release',async()=>{
 let current=binding;const f=setup({saved:pending(),readBinding:()=>current,hook:path=>{if(path.endsWith('/complete'))current={...binding,workspaceId:'22222222-2222-4222-8222-222222222222'};}});await assert.rejects(()=>f.make().tick());assert.equal(f.outbox.read().phase,'ack_pending');assert.equal(f.calls.length,1);
});
test('null claim response latches unsafe for both poll and start before subsequent admission',async()=>{
 for(const mode of ['poll','start']){
  const f=setup({hook:()=>null}),bridge=f.make();await assert.rejects(()=>mode==='poll'?bridge.tick():bridge.startTask('task',{expectedVersion:1,materials:[]}));assert.equal(bridge.status().deliveryUnsafe,true);await assert.rejects(()=>bridge.tick());assert.equal(f.calls.length,1);assert.equal(f.runs(),0);
 }
});
