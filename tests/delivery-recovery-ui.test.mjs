import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryRecoveryUI,deliveryDiscardBlocker} from '../public/delivery-recovery-ui.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const row=(n=1)=>({version:1,workspaceId:'11111111-1111-4111-8111-111111111111',taskId:'task',executionId:`execution-${n}`,generation:n,claimedAt:'2026-10-01T00:00:00.000Z'});
function element(){const listeners={};return {hidden:false,disabled:false,checked:false,textContent:'',children:[],replaceCount:0,dataset:{},ownerDocument:{createElement:()=>element()},addEventListener(name,fn){listeners[name]=fn;},fire(name,event={}){return listeners[name]?.(event);},replaceChildren(...items){this.children=items;this.replaceCount++;},append(...items){this.children.push(...items);}};}
function fixture(){
 const fields=Object.fromEntries(['list','status','selected','error','notice','next','refresh','discard','stopped','no-results'].map(name=>[name,element()]));
 const handlers={},dialog={open:false,ownerDocument:{createElement:()=>element()},querySelector(selector){return fields[selector.slice(15,-1)];},addEventListener(name,fn){handlers[name]=fn;},showModal(){this.open=true;},close(){this.open=false;handlers.close?.();},click(action,index){return handlers.click({target:{closest:()=>({dataset:{recoveryAction:action,recoveryIndex:String(index??0)}})}});}};
 let epoch=1,task={id:'task',version:7,status:'paused'},state={capabilities:{desktopDeliveryRecovery:true},localDesktop:null};
 const calls=[];const client={remote:true,readDeliveryReservations:async(...args)=>{calls.push(['read',...args]);return {reservations:[row()],nextAfterKey:null,taskVersion:7,workspaceId:row().workspaceId};},discardDeliveryReservation:async(...args)=>{calls.push(['discard',...args]);return {reservation:row(),released:true};}};
 const ui=createDeliveryRecoveryUI({dialog,getClient:()=>client,getState:()=>state,getTask:()=>task,getEpoch:()=>epoch});
 return {dialog,fields,ui,client,calls,get task(){return task;},set task(value){task=value;},get state(){return state;},set state(value){state=value;},set epoch(value){epoch=value;}};
}
async function selected(f){await f.ui.open();await f.dialog.click('select',0);f.fields.stopped.checked=true;f.fields['no-results'].checked=true;f.fields.stopped.fire('change');}

test('recovery is gated by capability and never opens in local-only mode',async()=>{
 const f=fixture();f.state={capabilities:{desktopDeliveryRecovery:false}};await f.ui.open();assert.equal(f.dialog.open,false);assert.equal(f.calls.length,0);
 f.state={capabilities:{desktopDeliveryRecovery:true}};f.client.remote=false;await f.ui.open();assert.equal(f.dialog.open,false);
});

test('listing shows reservation identity and next page while checks reset on new selection',async()=>{
 const f=fixture();f.client.readDeliveryReservations=async(...args)=>{f.calls.push(['read',...args]);return {reservations:args[1].afterKey?[row(2)]:[row()],nextAfterKey:args[1].afterKey?null:'cursor-1',taskVersion:7,workspaceId:row().workspaceId};};
 await f.ui.open();assert.equal(f.fields.list.children.length,1);assert.match(f.fields.list.children[0].textContent,/execution-1.*1.*2026/s);assert.equal(f.fields.next.hidden,false);
 await f.dialog.click('select',0);f.fields.stopped.checked=true;f.fields['no-results'].checked=true;f.fields.stopped.fire('change');assert.equal(f.fields.discard.disabled,false);
 await f.dialog.click('next');assert.equal(f.fields.list.children.length,2);assert.equal(f.calls[1][2].afterKey,'cursor-1');assert.equal(f.calls[1][3],row().workspaceId);
 await f.dialog.click('select',1);assert.equal(f.fields.stopped.checked,false);assert.equal(f.fields['no-results'].checked,false);assert.equal(f.fields.discard.disabled,true);
});

test('running or known local unsafe state blocks discard, but listing stays available',async()=>{
 const f=fixture();await selected(f);f.task={...f.task,status:'running'};f.ui.sync();assert.equal(f.fields.discard.disabled,true);assert.match(f.fields.status.textContent,/진행 중/);
 f.task={...f.task,status:'paused'};for(const flag of ['busy','pending','stopped','deliveryUnsafe']){f.state={...f.state,localDesktop:{[flag]:true}};f.ui.sync();assert.equal(f.fields.discard.disabled,true);assert.ok(deliveryDiscardBlocker(f.task,f.state.localDesktop));}
 assert.equal(f.calls.filter(call=>call[0]==='read').length,1);
});

test('discard requires both confirmations; missing is not reported as success',async()=>{
 const f=fixture();await f.ui.open();await f.dialog.click('select',0);f.fields.stopped.checked=true;f.fields.stopped.fire('change');await f.dialog.click('discard');assert.equal(f.calls.filter(call=>call[0]==='discard').length,0);
 f.fields['no-results'].checked=true;f.fields['no-results'].fire('change');f.client.discardDeliveryReservation=async(...args)=>{f.calls.push(['discard',...args]);return {reservation:row(),released:false,reason:'reservation_not_found'};};
 await f.dialog.click('discard');const call=f.calls.find(c=>c[0]==='discard');assert.deepEqual(call[2],{reservation:row(),expectedVersion:7,confirmDiscard:true});assert.equal(typeof call[3].isCurrent,'function');assert.match(f.fields.notice.textContent,/찾지 못|다시 조회/);assert.doesNotMatch(f.fields.notice.textContent,/폐기했습니다/);assert.equal(f.fields.stopped.checked,false);
});

test('selection, connection, and version changes invalidate late reads and confirmations',async()=>{
 const f=fixture(),waiting=deferred();f.client.readDeliveryReservations=()=>waiting.promise;const opened=f.ui.open();f.task={id:'other',version:1,status:'paused'};f.epoch=2;f.ui.close();waiting.resolve({reservations:[row()],taskVersion:7,workspaceId:row().workspaceId});await opened;assert.equal(f.dialog.open,false);assert.equal(f.fields.list.children.length,0);
 f.task={id:'task',version:7,status:'paused'};f.epoch=3;f.client.readDeliveryReservations=async()=>({reservations:[row()],taskVersion:7,workspaceId:row().workspaceId});await selected(f);
 f.task={...f.task,version:8};f.ui.sync();assert.equal(f.fields.stopped.checked,false);assert.equal(f.fields.discard.disabled,true);assert.match(f.fields.notice.textContent,/다시 조회/);
 f.client.remote=false;f.ui.sync();assert.equal(f.dialog.open,false);
});

test('duplicate discard click is suppressed and stale identity-await guard becomes false',async()=>{
 const f=fixture(),waiting=deferred();await selected(f);f.client.discardDeliveryReservation=(...args)=>{f.calls.push(['discard',...args]);return waiting.promise;};
 const first=f.dialog.click('discard'),second=f.dialog.click('discard');assert.equal(f.calls.filter(c=>c[0]==='discard').length,1);
 const guard=f.calls.find(c=>c[0]==='discard')[3].isCurrent;assert.equal(guard(),true);f.epoch=2;assert.equal(guard(),false);
 waiting.resolve({reservation:row(),released:true});await Promise.all([first,second]);assert.doesNotMatch(f.fields.notice.textContent,/폐기했습니다/);
});
test('version change during a pending read releases the new generation to refresh',async()=>{
 const f=fixture(),pending=deferred();await f.ui.open();
 f.client.readDeliveryReservations=()=>pending.promise;const old=f.dialog.click('refresh');
 f.task={...f.task,version:8};f.ui.sync();assert.equal(f.fields.refresh.disabled,false);
 f.client.readDeliveryReservations=async()=>({reservations:[row(2)],nextAfterKey:null,taskVersion:8,workspaceId:row().workspaceId});
 await f.dialog.click('refresh');assert.match(f.fields.list.children[0].textContent,/execution-2/);
 pending.resolve({reservations:[row()],nextAfterKey:null,taskVersion:7,workspaceId:row().workspaceId});await old;
 assert.match(f.fields.list.children[0].textContent,/execution-2/);
});

test('oversized or cross-task reservation pages are rejected without hiding bad rows',async()=>{
 for(const reservations of [Array.from({length:51},(_,i)=>row(i+1)),[{...row(),taskId:'other'}],[{...row(),workspaceId:'22222222-2222-4222-8222-222222222222'}],[{...row(),version:2}]]){
  const f=fixture();f.client.readDeliveryReservations=async()=>({reservations,nextAfterKey:null,taskVersion:7,workspaceId:row().workspaceId});
  await f.ui.open();assert.equal(f.fields.list.children.length,0);assert.match(f.fields.error.textContent,/일치하지 않|유효하지 않|확인/);
 }
});

test('checkbox and status sync do not replace focused reservation buttons',async()=>{
 const f=fixture();await selected(f);const before=f.fields.list.replaceCount,focused=f.fields.list.children[0];
 f.fields.stopped.fire('change');f.ui.sync();assert.equal(f.fields.list.replaceCount,before);assert.equal(f.fields.list.children[0],focused);
});

test('discard success requires the exact selected descriptor, and malformed missing reply stays uncertain',async()=>{
 for(const result of [{reservation:row(2),released:true},{reservation:row(),released:false,reason:'wrong_reason'}]){
  const f=fixture();await selected(f);f.client.discardDeliveryReservation=async()=>result;
  await f.dialog.click('discard');assert.doesNotMatch(f.fields.notice.textContent,/폐기했습니다|예약을 찾지 못했습니다/);assert.match(f.fields.error.textContent,/확인|일치|다시 조회/);
 }
});
