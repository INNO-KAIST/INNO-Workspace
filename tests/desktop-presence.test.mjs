import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {TestD1} from './helpers/d1.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createDesktopReadiness} from '../server/desktop-readiness.mjs';
import {runDesktopService} from '../server/desktop-service.mjs';
import {deliveryStopMessage} from '../server/bridge-runtime.mjs';
import {executorStatusText} from '../public/provider-ui.mjs';

// H9-1: a connector that is running but cannot take work (Codex sign-in missing, run storage
// full) says so to the cloud instead of looking offline, keeps re-checking, and announces
// when it can take work again. A not-ready report never claims or owns a task.
const binding={origin:'https://inno.example',workspaceId:'11111111-1111-4111-8111-111111111111'};
const box=()=>{let value=null;return {read:()=>value,write:v=>{value=v;},clear:()=>{value=null;}};};
const notReady=reason=>Object.assign(Error('not ready'),{code:'DESKTOP_NOT_READY',reason});

test('the Worker shows a reported not-ready desktop as online with its reason until the next poll',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const token='test-presence-0123456789012345678',env={DB:db,ACCESS_TOKEN:token};
 const call=(path,body,auth=true)=>worker.fetch(new Request('https://inno.test'+path,{method:body?'POST':'GET',headers:{...(auth?{authorization:`Bearer ${token}`}:{}),'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
 const desktop=async()=>(await (await call('/api/state')).json()).desktop;
 assert.deepEqual(await desktop(),{lastSeen:null,online:false});
 assert.equal((await call('/api/desktop/presence',{state:'not_ready',reason:'codex_login'})).status,200);
 const first=await desktop();
 assert.equal(first.online,true);assert.equal(first.notReady,'codex_login');assert.ok(Number.isSafeInteger(first.notReadySince));
 assert.equal((await call('/api/desktop/presence',{state:'not_ready',reason:'codex_login'})).status,200);
 assert.equal((await desktop()).notReadySince,first.notReadySince,'a repeated report keeps the first time');
 for(const body of [{state:'not_ready',reason:'other'},{state:'ready'},{state:'not_ready',reason:'codex_login',detail:'x'}])
  assert.equal((await call('/api/desktop/presence',body)).status,400,JSON.stringify(body));
 assert.equal((await call('/api/desktop/presence',{state:'not_ready',reason:'codex_login'},false)).status,401);
 assert.equal((await call('/api/desktop/poll',{})).status,200);
 const after=await desktop();
 assert.equal(after.online,true);assert.equal(Object.hasOwn(after,'notReady'),false);assert.equal(Object.hasOwn(after,'notReadySince'),false);
});

test('readiness failures carry a reason, and storage keeps its own message',async()=>{
 const login=createDesktopReadiness({runner:{available:async()=>false},runRoot:'unused',checkStorage:async()=>{}});
 await assert.rejects(login(),error=>error.code==='DESKTOP_NOT_READY'&&error.reason==='codex_login'&&/Sign in to Codex/.test(error.message));
 const storage=createDesktopReadiness({runner:{available:async()=>true},runRoot:'unused',checkStorage:async()=>{throw Error('Desktop run storage limit reached (256 MiB). Review saved outputs.');}});
 await assert.rejects(storage(),error=>error.code==='DESKTOP_NOT_READY'&&error.reason==='run_storage'&&/256 MiB/.test(error.message));
});

test('a not-ready tick reports its reason without polling, and a failed report changes nothing',async()=>{
 for(const deliveryReceiptVersion of [0,1]){
  const sent=[];
  const bridge=createDesktopBridge({deliveryReceiptVersion,outbox:box(),readDeliveryBinding:async()=>binding,beforeClaim:async()=>{throw notReady('codex_login');},runner:{},request:async(route,body,options)=>{sent.push([route,body,options]);return {};}});
  await assert.rejects(()=>bridge.tick(),/not ready/);
  assert.deepEqual(sent,[['/api/desktop/presence',{state:'not_ready',reason:'codex_login'},undefined]]);
  const failing=createDesktopBridge({deliveryReceiptVersion,outbox:box(),readDeliveryBinding:async()=>binding,beforeClaim:async()=>{throw notReady('run_storage');},runner:{},request:async()=>{throw Object.assign(Error('not found'),{status:404});}});
  await assert.rejects(()=>failing.tick(),/not ready/);
  if(deliveryReceiptVersion===1)assert.deepEqual([failing.runtimeStatus().deliveryUnsafe,failing.runtimeStatus().recoveryPaused],[false,false]);
 }
 // A direct start shows the error to the person who asked; it does not report presence.
 const sent=[];
 const bridge=createDesktopBridge({outbox:box(),beforeClaim:async()=>{throw notReady('codex_login');},runner:{},request:async route=>{sent.push(route);return {};}});
 await assert.rejects(()=>bridge.startTask('t',{expectedVersion:1,materials:[]}),/not ready/);
 assert.deepEqual(sent,[]);
});

test('the service keeps re-checking a not-ready desktop, notifies once per reason and announces recovery',async()=>{
 const controller=new AbortController(),outcomes=[notReady('codex_login'),notReady('codex_login'),notReady('run_storage'),false,false];
 const notices=[],delays=[];
 await runDesktopService({deliveryReceiptVersion:1,signal:controller.signal,
  bridge:{runtimeStatus:()=>({deliveryUnsafe:false}),pauseForRecovery:()=>assert.fail('not-ready must not pause'),tick:async()=>{const next=outcomes.shift();if(next instanceof Error)throw next;return next;}},
  onError:error=>notices.push(error.reason),onRecovered:()=>notices.push('recovered'),
  wait:async ms=>{delays.push(ms);if(!outcomes.length)controller.abort();}});
 assert.deepEqual(notices,['codex_login','run_storage','recovered']);
 assert.ok(delays.every(ms=>ms<=60000));
});

test('console and screen texts say what to do while the desktop is not ready',()=>{
 const login=deliveryStopMessage(notReady('codex_login'));
 assert.match(login,/Codex 로그인/);assert.match(login,/자동으로/);assert.match(login,/Start INNO Cloud Bridge\.cmd/);assert.doesNotMatch(login,/delivery interrupted/i);
 const storage=deliveryStopMessage(Object.assign(notReady('run_storage'),{message:'Desktop run storage limit reached (256 MiB). Review saved outputs.'}));
 assert.match(storage,/저장 공간/);assert.match(storage,/256 MiB/);
 const capabilities={cloudCodex:true};
 assert.match(executorStatusText('codex',capabilities,{desktopOnline:true,desktopNotReady:'codex_login'}),/Codex 로그인/);
 assert.match(executorStatusText('codex',{...capabilities,desktopSources:true},{desktopOnline:true,desktopNotReady:'codex_login'}),/Codex 로그인/);
 assert.match(executorStatusText('codex',capabilities,{desktopOnline:true,desktopNotReady:'run_storage'}),/저장 공간/);
 assert.equal(executorStatusText('codex',capabilities,{desktopOnline:true}),'데스크톱 연결됨 · 같은 클라우드 작업에 결과를 저장합니다.');
 assert.equal(executorStatusText('codex',capabilities,{desktopOnline:false,desktopNotReady:'codex_login'}),'데스크톱 오프라인 · 실행 요청을 대기열에 보관합니다.');
});

test('a stale or changed report starts a new since, a malformed one is ignored, and receipt headers are refused',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const token='test-presence-0123456789012345678',env={DB:db,ACCESS_TOKEN:token};
 const call=(path,body,headers={})=>worker.fetch(new Request('https://inno.test'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined}),env);
 const desktop=async()=>(await (await call('/api/state')).json()).desktop;
 const setMeta=(key,value)=>db.prepare("INSERT INTO metadata (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,value).run();
 // A report left from days ago, while the desktop was off, is not continued.
 const old=Date.now()-3*86_400_000;
 await setMeta('desktop_seen',old);await setMeta('desktop_readiness',JSON.stringify({reason:'codex_login',since:old}));
 assert.deepEqual(await desktop(),{lastSeen:old,online:false});
 await call('/api/desktop/presence',{state:'not_ready',reason:'codex_login'});
 const fresh=await desktop();
 assert.equal(fresh.notReady,'codex_login');assert.ok(fresh.notReadySince>old+86_400_000,String(fresh.notReadySince));
 await setMeta('desktop_readiness',JSON.stringify({reason:'codex_login',since:1}));
 await call('/api/desktop/presence',{state:'not_ready',reason:'run_storage'});
 const changed=await desktop();assert.equal(changed.notReady,'run_storage');assert.ok(changed.notReadySince>1);
 await setMeta('desktop_readiness','{broken');
 const tolerated=await desktop();assert.equal(tolerated.online,true);assert.equal(Object.hasOwn(tolerated,'notReady'),false);
 assert.equal((await call('/api/desktop/presence',{state:'not_ready',reason:'codex_login'})).status,200);
 assert.equal((await desktop()).notReady,'codex_login','a broken stored report is replaced');
 const env1={...env,INNO_DESKTOP_RECEIPT_VERSION:'1'};
 const receipt=await worker.fetch(new Request('https://inno.test/api/desktop/presence',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-inno-delivery-receipt-version':'1','x-inno-workspace-id':'11111111-1111-4111-8111-111111111111'},body:JSON.stringify({state:'not_ready',reason:'codex_login'})}),env1);
 assert.equal(receipt.status,400);
});

test('a connector stopping during its readiness check does not report',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const sent=[];
 const bridge=createDesktopBridge({deliveryReceiptVersion:1,outbox:box(),readDeliveryBinding:async()=>binding,beforeClaim:async()=>{await gate;throw notReady('codex_login');},runner:{},request:async route=>{sent.push(route);return {};}});
 const work=bridge.tick().catch(()=>false);
 bridge.stop();release();await work;
 assert.deepEqual(sent,[]);
});

test('the not-ready web text also says to restart the connector if signing in does not help',()=>{
 assert.match(executorStatusText('codex',{cloudCodex:true},{desktopOnline:true,desktopNotReady:'codex_login'}),/다시 시작/);
});
