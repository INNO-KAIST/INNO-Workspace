import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
function box(){let value=null;return {read:()=>value,write:v=>{value=v;},clear:()=>{value=null;}};}
test('lost completion response retries saved output without executing AI twice',async()=>{
 const outbox=box();let runs=0,completes=0;const request=async(route)=>{if(route.endsWith('poll'))return {claim:{task:{id:'t'},executionId:'e',generation:1}};if(route.endsWith('complete')){if(++completes===1)throw Error('network');return {task:{status:'completed'}};}};
 const bridge=createDesktopBridge({request,outbox,runner:{run:async()=>{runs++;return {content:'ok'};}}});await assert.rejects(()=>bridge.tick());assert.ok(outbox.read());await bridge.tick();assert.equal(runs,1);assert.equal(completes,2);assert.equal(outbox.read(),null);
});
test('concurrent ticks never run two jobs on one desktop',async()=>{let resolve;let polls=0;const gate=new Promise(r=>resolve=r);const bridge=createDesktopBridge({outbox:box(),request:async()=>{polls++;await gate;return {claim:null};},runner:{}});const a=bridge.tick();await bridge.tick();resolve();await a;assert.equal(polls,1);});
test('lost ownership aborts the local process and never uploads its output',async()=>{let uploaded=false;const bridge=createDesktopBridge({outbox:box(),heartbeatMs:5,request:async p=>{if(p.endsWith('poll'))return {claim:{task:{id:'t'},executionId:'e',generation:1}};if(p.endsWith('renew'))throw Object.assign(Error('stale'),{status:409});uploaded=true;},runner:{run:({signal})=>new Promise((res,rej)=>signal.addEventListener('abort',()=>rej(Error('aborted'))))}});await assert.rejects(()=>bridge.tick());assert.equal(uploaded,false);});

import {acquireBridgeLock,retryableStatus,checkRunStorage} from '../server/bridge-runtime.mjs';
test('exclusive process lock prevents multiple local consumers and releases cleanly',async()=>{const lock=await acquireBridgeLock(0);try{await assert.rejects(()=>acquireBridgeLock(lock.port),{code:'EADDRINUSE'});}finally{await lock.close();}const reopened=await acquireBridgeLock(lock.port);await reopened.close();});
test('transient HTTP errors remain retryable while permanent errors stop',()=>{for(const s of [undefined,408,429,500,502,503])assert.equal(retryableStatus(s),true);for(const s of [400,401,403,409,413])assert.equal(retryableStatus(s),false);});

test('stop during poll never launches the arriving claim',async()=>{let release,runs=0;const bridge=createDesktopBridge({outbox:box(),request:()=>new Promise(r=>release=r),runner:{run:()=>{runs++;}}});const tick=bridge.tick();await new Promise(setImmediate);bridge.stop();release({claim:{task:{id:'t'},executionId:'e',generation:1}});await tick;assert.equal(runs,0);});

// Direct execution must pass sources only to the local runner, never the cloud API or outbox.
test('direct material execution keeps source bytes off cloud requests and durable outbox',async()=>{const requests=[],writes=[];let supplied;const task={id:'t',attachments:[{name:'paper.txt',source:'file'}]};const bridge=createDesktopBridge({outbox:{read:()=>null,write:r=>writes.push(r),clear:()=>{}},request:async(p,b)=>{requests.push({p,b});return p.endsWith('start')?{claim:{task,executionId:'e',generation:1}}:{task:{status:'completed'}};},runner:{run:async input=>{supplied=input.materials;return {content:'Summary only'};}}});await bridge.startTask('t',{expectedVersion:1,materials:[{name:'paper.txt',text:'PRIVATE_SOURCE_BYTES'}]});await bridge.settled();assert.equal(supplied[0].text,'PRIVATE_SOURCE_BYTES');assert.equal(JSON.stringify(requests).includes('PRIVATE_SOURCE_BYTES'),false);assert.equal(JSON.stringify(writes).includes('PRIVATE_SOURCE_BYTES'),false);});
test('direct start refuses while another local task or pending result exists',async()=>{const pending=box();pending.write({taskId:'old'});const bridge=createDesktopBridge({outbox:pending,request:async()=>{throw Error('must not request');},runner:{}});await assert.rejects(()=>bridge.startTask('t',{expectedVersion:1,materials:[]}),{status:409});});


test('desktop failure outbox preserves safe quota reason across delivery retry without rerunning AI',async()=>{
 let runs=0,deliveries=0;const outbox=box();const bridge=createDesktopBridge({outbox,request:async p=>{if(p.endsWith('poll'))return {claim:{task:{id:'t'},executionId:'e',generation:1}};if(++deliveries===1)throw Error('network');},runner:{run:async()=>{runs++;throw Object.assign(Error('PRIVATE_DIAGNOSTIC'),{code:'QUOTA_EXCEEDED',usage:{inputTokens:9,secret:'PRIVATE_USAGE'}});}}});await assert.rejects(()=>bridge.tick());assert.equal(outbox.read().input.usage.inputTokens,9);assert.equal(JSON.stringify(outbox.read()).includes('PRIVATE_USAGE'),false);assert.equal(outbox.read().input.failure.kind,'quota');assert.equal(JSON.stringify(outbox.read()).includes('PRIVATE_DIAGNOSTIC'),false);await bridge.tick();assert.equal(runs,1);assert.equal(outbox.read(),null);
});

test('occupied startup port becomes an actionable error without hiding other failures',async()=>{const {startupPortMessage}=await import('../server/bridge-runtime.mjs');assert.match(startupPortMessage({code:'EADDRINUSE',port:4174}),/4174/);assert.match(startupPortMessage({code:'EADDRINUSE',port:4175}),/4175/);assert.match(startupPortMessage({code:'EADDRINUSE',port:4174}),/DESKTOP-ACCESS/);assert.equal(startupPortMessage({code:'EACCES',port:4174}),null);});

test('maintenance blocks execution and refuses pending results',async()=>{const outbox=box();let polls=0,release;const bridge=createDesktopBridge({outbox,request:async()=>{polls++;return {claim:null};},runner:{}});const work=bridge.maintenance(()=>new Promise(r=>release=r));await bridge.tick();assert.equal(polls,0);await assert.rejects(()=>bridge.startTask('t',{materials:[]}),{status:409});release();await work;assert.equal(bridge.status().busy,false);outbox.write({taskId:'pending'});await assert.rejects(()=>bridge.maintenance(()=>{}),{status:409});});

test('usage survives outbox retry without copying arbitrary runner fields',async()=>{const outbox=box();let calls=0;const bridge=createDesktopBridge({outbox,request:async p=>{if(p.endsWith('poll'))return {claim:{task:{id:'t'},executionId:'e',generation:1}};if(++calls===1)throw Error('lost response');},runner:{run:async()=>({content:'ok',usage:{inputTokens:12,outputTokens:3,secret:'PRIVATE'}})}});await assert.rejects(()=>bridge.tick());assert.equal(outbox.read().input.usage.inputTokens,12);assert.equal(JSON.stringify(outbox.read()).includes('PRIVATE'),false);await bridge.tick();assert.equal(outbox.read(),null);});

test('direct master sends one verified model snapshot on start and delegation completion',async()=>{
 const models=[{model:'gpt-5.6-terra',efforts:['high'],isDefault:true}],requests=[];let modelReads=0;
 const task={id:'master',attachments:[]};
 const bridge=createDesktopBridge({outbox:box(),request:async(path,input)=>{requests.push({path,input});return path.endsWith('start')?{claim:{task,executionId:'e',generation:1}}:{task:{status:'waiting_children'}};},runner:{models:async()=>{modelReads++;return models;},run:async()=>({content:'plan',delegation:{independent:true,children:[]}})}});
 await bridge.startTask(task.id,{expectedVersion:1,materials:[]});await bridge.settled();
 assert.equal(modelReads,1);assert.deepEqual(requests.find(r=>r.path.endsWith('start')).input.models,models);assert.deepEqual(requests.find(r=>r.path.endsWith('complete')).input.models,models);
});

import {createCodexRunner} from '../server/runners.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
test('lost lease keeps desktop busy until Codex process closes',async()=>{
 let closeChild,abortSeen,polls=0,uploads=0;const aborted=new Promise(r=>{abortSeen=r;});
 const runner=createCodexRunner({ensureDirectory:()=>{},spawnProcess:()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{abortSeen();return true;};closeChild=()=>child.emit('close',null,'SIGTERM');return child;}});
 const bridge=createDesktopBridge({outbox:box(),runner,heartbeatMs:5,request:async route=>{if(route.endsWith('/poll')){polls++;return {claim:{task:{id:'lease',prompt:'work'},executionId:'e',generation:1}};}if(route.endsWith('/renew'))throw Object.assign(Error('lease lost'),{status:409});uploads++;}});
 const running=bridge.tick();const result=running.catch(e=>e);await aborted;await new Promise(setImmediate);
 const busyBeforeClose=bridge.status().busy;const second=await bridge.tick();closeChild();const error=await result;
 assert.equal(busyBeforeClose,true);assert.equal(second,false);assert.equal(polls,1);assert.equal(uploads,0);assert.equal(error.status,409);assert.equal(bridge.status().busy,false);
});

for(const localVersion of [0,1])for(const serverVersion of [0,1])test(`desktop negotiates source capability local=${localVersion} server=${serverVersion}`,async()=>{let sent,applied;const bridge=createDesktopBridge({outbox:box(),runner:{sourceDelegationVersion:localVersion,run:async input=>{applied=input.sourceDelegationVersion;return {content:'done'};}},request:async(route,input)=>{if(route.endsWith('/start')){sent=input;return {claim:{task:{id:'t'},executionId:'e',generation:1,sourceDelegationVersion:serverVersion}};}return {};}});await bridge.startTask('t',{expectedVersion:1,sourceDelegationVersion:1,materials:[]});await bridge.settled();assert.equal(sent.sourceDelegationVersion,localVersion);assert.equal(applied,localVersion===1&&serverVersion===1?1:0);assert.equal(bridge.status().sourceDelegationVersion,localVersion);});
