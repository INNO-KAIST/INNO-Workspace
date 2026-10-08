import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {dispatchRemote} from '../worker/dispatch.mjs';
import {TestD1} from './helpers/d1.mjs';
import {ConflictError} from '../public/core/tasks.mjs';
import {normalizeProviderSettings,nextProviderSettings,providerEnabled} from '../public/core/provider-settings.mjs';
import {providerCards} from '../public/provider-management-ui.mjs';
import {executorStatusText,providerOptions,queuedText} from '../public/provider-ui.mjs';

// PRV-06: a person sees each provider's connection, capabilities and conformance, and can turn a
// provider off. Off blocks only new executions: a direct run is refused with guidance, queued,
// delegated or handed-off work waits, running work finishes, and turning it on resumes. At least
// one provider stays on. PRV-02: a provider whose sign-in failed shows "연결 필요" while the
// other provider keeps working.
const token='test-provider-mgmt-0123456789012345';
const CODEX='codex',CLAUDE='claude';
function api(db,extra={}){
 const env={DB:db,ACCESS_TOKEN:token,...extra};
 return async(path,body)=>{const response=await worker.fetch(new Request('https://inno.test'+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:response.status,body:await response.json()};};
}

test('provider settings keep at least one provider on and change only from the version read',()=>{
 const empty=normalizeProviderSettings(null);
 assert.deepEqual(empty,{version:0,disabled:[]});
 const off=nextProviderSettings(empty,{disabled:[CLAUDE,CLAUDE],expectedVersion:0});
 assert.deepEqual(off,{version:1,disabled:[CLAUDE]});
 assert.equal(providerEnabled(off,CLAUDE),false);assert.equal(providerEnabled(off,CODEX),true);
 assert.throws(()=>nextProviderSettings(off,{disabled:[CODEX,CLAUDE],expectedVersion:1}),/At least one/,'a top-level-only runner cannot be the only one left on');
 assert.throws(()=>nextProviderSettings(off,{disabled:['other'],expectedVersion:1}),/Unknown provider/);
 assert.throws(()=>nextProviderSettings(off,{disabled:[],expectedVersion:0}),error=>error instanceof ConflictError);
 assert.deepEqual(normalizeProviderSettings({version:3,disabled:['other',CLAUDE]}),{version:3,disabled:[CLAUDE]});
});

test('turning a provider off refuses a direct run, holds queued work, and turning it on resumes',async t=>{
 const db=new TestD1();t.after(()=>db.close());const call=api(db),store=new D1TaskStore(db),bridge=new CloudBridge(store);
 const queued=(await call('/api/tasks',{prompt:'queued before'})).body.task;
 assert.equal((await call(`/api/tasks/${queued.id}/run`,{provider:CODEX,expectedVersion:queued.version})).status,202);
 const off=await call('/api/providers/settings',{disabled:[CODEX],expectedVersion:0});
 assert.equal(off.status,200);assert.deepEqual(off.body.settings,{version:1,disabled:[CODEX]});
 const state=(await call('/api/state')).body;
 assert.deepEqual(state.capabilities.disabledProviders,[CODEX]);assert.equal(state.capabilities.providerSettingsVersion,1);
 // A queued task waits; nothing is claimed while Codex is off.
 assert.equal(await bridge.claim(),null);
 assert.equal((await store.requireTask(queued.id)).status,'queued');
 const fresh=(await call('/api/tasks',{prompt:'new'})).body.task;
 const refused=await call(`/api/tasks/${fresh.id}/run`,{provider:CODEX,expectedVersion:fresh.version});
 assert.equal(refused.status,409);assert.equal(refused.body.code,'PROVIDER_DISABLED');assert.match(refused.body.error,/사용 중지/);
 await assert.rejects(store.claimExecution(queued.id,{provider:CODEX,expectedVersion:(await store.requireTask(queued.id)).version}),error=>error.code==='PROVIDER_DISABLED');
 assert.equal((await call('/api/providers/settings',{disabled:[],expectedVersion:0})).status,409,'stale version');
 assert.equal((await call('/api/providers/settings',{disabled:[CODEX,CLAUDE],expectedVersion:1})).status,400,'one must stay on');
 assert.equal((await call('/api/providers/settings',{disabled:[],expectedVersion:1})).status,200);
 const claim=await bridge.claim();assert.equal(claim.task.id,queued.id);
});

test('a turned-off Routine provider leaves its queued task waiting instead of firing',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db);
 const settings=await store.updateProviderSettings({disabled:[CLAUDE],expectedVersion:0});
 assert.equal(settings.version,1);
 let task=await store.createTask({prompt:'routine work'});
 task=await store.replaceTask(task.id,task.version,current=>({...current,version:current.version+1,status:'queued',checkpoint:{provider:CLAUDE,status:'queued'}}));
 let launched=0;
 const result=await dispatchRemote({store,taskId:task.id,adapterFor:()=>({configured:true,launch:async()=>{launched++;}})});
 assert.equal(result.status,'queued');assert.equal(launched,0);
});

test('a sign-in failure marks only that provider as needing connection, and the other keeps working',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),bridge=new CloudBridge(store);
 const routine=await store.createTask({prompt:'routine'});
 const claimed=await store.claimExecution(routine.id,{provider:CLAUDE,expectedVersion:routine.version});
 await store.failExecution(routine.id,{executionId:claimed.executionId,generation:claimed.generation,error:'401 unauthorized',status:'waiting_connection',failure:{kind:'authentication'}});
 const desktop=await store.createTask({prompt:'desktop'});await bridge.enqueue(desktop.id,{expectedVersion:desktop.version});
 assert.equal((await bridge.claim()).task.id,desktop.id);
 const tasks=await store.listTasks();
 const cards=providerCards({tasks,capabilities:{cloudCodex:true,claudeRoutine:true,disabledProviders:[]},desktop:{online:true}});
 const codex=cards.find(card=>card.id===CODEX),claude=cards.find(card=>card.id===CLAUDE);
 assert.equal(claude.needsConnection,1);assert.match(claude.status,/연결 필요/);
 assert.equal(codex.needsConnection,0);assert.match(codex.status,/연결됨/);
});

test('the screen shows each provider and marks a turned-off one everywhere it can be chosen',()=>{
 const capabilities={cloudCodex:true,claudeRoutine:true,disabledProviders:[CLAUDE]};
 const cards=providerCards({tasks:[],capabilities,desktop:{online:false,lastSeen:null}});
 assert.deepEqual(cards.map(card=>card.id),[CODEX,CLAUDE,'claude-code']);
 // Claude Code passed its conformance suite (2026-10-08) and can be chosen.
 assert.match(cards[2].conformance,/통과/);assert.doesNotMatch(cards[2].conformance,/미통과/);assert.equal(providerOptions(capabilities).find(option=>option.value==='claude-code').disabled,undefined);
 const codex=cards[0],claude=cards[1];
 assert.equal(codex.location,'이 PC');assert.equal(claude.location,'클라우드');
 assert.match(codex.status,/오프라인/);assert.equal(claude.enabled,false);assert.match(claude.status,/사용 중지/);
 assert.ok(codex.capabilities.length>=3);assert.match(codex.conformance,/통과/);
 assert.equal(providerOptions(capabilities).find(option=>option.value===CLAUDE).disabled,true);
 assert.match(executorStatusText(CLAUDE,capabilities),/사용 중지/);
 assert.match(queuedText(CLAUDE,capabilities),/사용 중지/);
 assert.doesNotMatch(queuedText(CODEX,capabilities),/사용 중지/);
});

test('settings saved over a stored value of the wrong shape, and a null body is refused, not a 500',async t=>{
 const db=new TestD1();t.after(()=>db.close());const call=api(db),store=new D1TaskStore(db);
 await db.prepare("INSERT INTO metadata (key,value) VALUES ('provider_settings',?1)").bind(JSON.stringify({version:3,disabled:'x'})).run();
 assert.deepEqual(await store.providerSettings(),{version:0,disabled:[]});
 assert.deepEqual(await store.updateProviderSettings({disabled:[CLAUDE],expectedVersion:0}),{version:1,disabled:[CLAUDE]});
 assert.equal((await call('/api/providers/settings',null)).status,400);
});

test('a sign-in failure stops showing "연결 필요" once the provider completes later work',()=>{
 const failed={id:'f',status:'waiting_connection',checkpoint:{provider:CLAUDE,failure:{kind:'authentication',occurredAt:'2026-10-06T01:00:00.000Z'}}};
 const later={id:'s',status:'completed',checkpoint:{provider:CLAUDE,completedAt:'2026-10-06T02:00:00.000Z'}};
 const earlier={...later,id:'e',checkpoint:{provider:CLAUDE,completedAt:'2026-10-06T00:30:00.000Z'}};
 const capabilities={claudeRoutine:true,cloudCodex:true};
 assert.equal(providerCards({tasks:[failed,earlier],capabilities}).find(card=>card.id===CLAUDE).needsConnection,1);
 assert.equal(providerCards({tasks:[failed,later],capabilities}).find(card=>card.id===CLAUDE).needsConnection,0);
});
