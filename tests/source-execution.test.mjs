import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceExecutionReadiness,SourceExecutionCoordinator} from '../public/source-execution.mjs';
function fixture(){
 const parent={id:'p',version:2,status:'waiting_children',delegation:{batchId:'b',epoch:1,state:'waiting_children',children:[{taskId:'c',provider:'claude'}]}};
 const child={id:'c',version:1,status:'queued',parentTaskId:'p',batchId:'b',parentEpoch:1,assignment:{provider:'claude'},attachments:[{id:'a',name:'a.txt',source:'file'}]};
 return {tasks:[parent,child],capabilities:{sourceDelegationVersion:1,claudeRoutine:true}};
}
function setup(){const state=fixture();let sends=0,reads=0;const client={state,refresh:async()=>{},run:async()=>{sends++;}};const services={attemptLocks:{request:async(key,fn)=>fn()},attemptStorage:storage(),getClient:()=>client,connected:()=>true,getFile:async()=>{reads++;return {};},extractText:async()=>({status:'available',text:'PRIVATE_SOURCE'})};return {state,client,services,counts:()=>({sends,reads})};}
test('a Claude source child waits while a Claude sibling of its batch is running or awaits confirmation (H7)',()=>{
 const s=fixture(),t=s.tasks[1];
 const sibling=(status,extra={})=>({id:'c2',version:3,status,parentTaskId:'p',batchId:'b',parentEpoch:1,assignment:{provider:'claude'},checkpoint:{provider:'claude',...extra}});
 for(const busy of [sibling('running'),sibling('waiting_connection',{confirmationRequired:{reason:'uncertain_fire'}})]){
  const state={...s,tasks:[...s.tasks,busy]};
  assert.equal(sourceExecutionReadiness(t,state,()=>true).reason,'claude_sibling_running');
 }
 assert.equal(sourceExecutionReadiness(t,{...s,tasks:[...s.tasks,sibling('completed')]},()=>true).ready,true);
 assert.equal(sourceExecutionReadiness(t,{...s,tasks:[...s.tasks,{...sibling('running'),batchId:'other'}]},()=>true).ready,true);
});

test('missing originals and provider capability block reads; reconnect becomes ready',()=>{const s=fixture(),t=s.tasks[1];assert.equal(sourceExecutionReadiness(t,s,()=>false).reason,'missing_sources');assert.equal(sourceExecutionReadiness(t,s,()=>true).ready,true);s.capabilities.sourceDelegationVersion=0;assert.equal(sourceExecutionReadiness(t,s,()=>true).ready,false);});
test('duplicate refresh does not duplicate extraction or dispatch',async()=>{const x=setup();let release;x.services.getFile=()=>new Promise(r=>{release=r;});const coordinator=new SourceExecutionCoordinator(x.services);const first=coordinator.tick();assert.equal((await coordinator.tick()).status,'busy');while(!release)await new Promise(r=>setTimeout(r,1));release({});await first;await coordinator.tick();assert.equal(x.counts().sends,1);});
for(const change of ['pause','epoch','client'])test(`fences ${change} during extraction`,async()=>{const x=setup();x.services.getFile=async()=>{if(change==='pause')x.state.tasks[0].status='paused';if(change==='epoch')x.state.tasks[0].delegation.epoch++;if(change==='client')x.services.getClient=()=>({state:x.state});return {};};const c=new SourceExecutionCoordinator({...x.services,getClient:()=>x.services.getClient()});assert.equal((await c.tick()).status,'stale');assert.equal(x.counts().sends,0);});
test('a Claude sibling refusal is definitive: no uncertain hold, and the next tick may try again (H7)',async()=>{
 const x=setup();let runs=0;
 x.client.run=async()=>{runs++;if(runs===1)throw Object.assign(new Error('Another Claude child of this batch is running or awaits stop confirmation'),{status:409,code:'ROUTINE_SIBLING_BUSY'});};
 const c=new SourceExecutionCoordinator(x.services);
 assert.equal((await c.tick()).status,'waiting');assert.equal(c.entries().length,0);
 assert.equal((await c.tick()).status,'submitted');assert.equal(runs,2);
});

test('the client keeps a server error code on the thrown error',async()=>{
 const {WorkspaceClient}=await import('../public/core/client.mjs');
 const realFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'Another Claude child of this batch is running or awaits stop confirmation',code:'ROUTINE_SIBLING_BUSY'}),{status:409,headers:{'content-type':'application/json'}});
 try{await assert.rejects(()=>new WorkspaceClient({remote:true,baseUrl:'https://example.test'}).request('/api/tasks/x/run',{}),error=>error.status===409&&error.code==='ROUTINE_SIBLING_BUSY');}
 finally{globalThis.fetch=realFetch;}
});

test('lost acknowledgment is held without automatic retry or storing source text',async()=>{const x=setup();x.client.run=async()=>{throw Error('PRIVATE_SOURCE network failure');};const c=new SourceExecutionCoordinator(x.services);assert.equal((await c.tick()).status,'uncertain');assert.equal((await c.tick()).status,'waiting');assert.equal(c.entries().length,1);assert.equal(JSON.stringify(c.entries()).includes('PRIVATE_SOURCE'),false);});
test('fresh state before POST fences a pause on the server',async()=>{const x=setup();let refreshes=0;x.client.refresh=async()=>{if(++refreshes===2)x.state.tasks[0].status='paused';};assert.equal((await new SourceExecutionCoordinator(x.services).tick()).status,'stale');assert.equal(x.counts().sends,0);});
test('review uses master provider and terminal state clears retained attempt',async()=>{const x=setup(),p=x.state.tasks[0];p.status='queued_for_review';p.delegation.state='queued_for_review';p.delegation.masterProvider='claude';p.attachments=x.state.tasks[1].attachments;x.state.tasks.splice(1);let provider;x.client.run=async(id,input)=>{provider=input.provider;};const c=new SourceExecutionCoordinator(x.services);assert.equal((await c.tick()).status,'submitted');assert.equal(provider,'claude');p.status='completed';p.version++;await c.tick();assert.equal(c.entries().length,0);});
test('extraction failure is held to avoid repeating expensive failed reads',async()=>{const x=setup();x.services.extractText=async()=>({status:'unavailable'});const c=new SourceExecutionCoordinator(x.services);assert.equal((await c.tick()).status,'source_error');await c.tick();assert.equal(x.counts().reads,1);assert.equal(x.counts().sends,0);});

function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
test('uncertain dispatch survives recreation and persists metadata only',async()=>{const x=setup();x.services.attemptStorage=storage();x.client.run=async()=>{throw Error('PRIVATE_SOURCE');};assert.equal((await new SourceExecutionCoordinator(x.services).tick()).status,'uncertain');assert.equal((await new SourceExecutionCoordinator(x.services).tick()).status,'waiting');assert.equal(x.counts().reads,1);assert.equal(JSON.stringify([...x.services.attemptStorage.values]).includes('PRIVATE_SOURCE'),false);});
test('storage failures block dispatch and extraction',async()=>{const x=setup();x.services.attemptStorage={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}};assert.equal((await new SourceExecutionCoordinator(x.services).tick()).status,'storage_error');assert.equal(x.counts().reads,0);assert.equal(x.counts().sends,0);});
test('explicit recovery needs fresh version and cleared ownership',async()=>{const x=setup();const c=new SourceExecutionCoordinator(x.services);await c.tick();assert.equal((await c.recover('c')).status,'recovery_required');x.state.tasks[1].version++;x.state.tasks[1].checkpoint={executionId:'active'};assert.equal((await c.recover('c')).status,'recovery_required');delete x.state.tasks[1].checkpoint;assert.equal((await c.recover('c')).status,'recovered');assert.equal((await c.tick()).status,'submitted');});
test('running state retains hold and expired leases never permit retry',async()=>{const x=setup();const c=new SourceExecutionCoordinator(x.services);await c.tick();x.state.tasks[1].status='running';x.state.tasks[1].version++;await c.tick();assert.equal(c.entries().length,1);x.state.tasks[1].status='queued';assert.equal((await c.tick()).status,'waiting');assert.equal(x.counts().sends,1);});
test('session reset invalidates pending extraction and new client can proceed',async()=>{const x=setup();let release;x.services.getFile=()=>new Promise(r=>release=r);let client=x.client;x.services.getClient=()=>client;const c=new SourceExecutionCoordinator(x.services);const first=c.tick();await new Promise(r=>setTimeout(r,20));c.resetSession();release({});assert.equal((await first).status,'stale');client={...x.client,baseUrl:'https://other.example',token:'other'};x.services.getFile=async()=>({});assert.equal((await c.tick()).status,'submitted');});

test('same task id is isolated per account including same-object credential change',async()=>{const x=setup();x.client.token='FIRST_SECRET';const c=new SourceExecutionCoordinator(x.services);await c.tick();x.client.token='SECOND_SECRET';c.resetSession();assert.equal((await c.tick()).status,'submitted');x.client.token='FIRST_SECRET';c.resetSession();assert.equal((await c.tick()).status,'waiting');assert.equal(x.counts().sends,2);const serialized=JSON.stringify([...x.services.attemptStorage.values]);assert.equal(serialized.includes('FIRST_SECRET'),false);assert.equal(serialized.includes('SECOND_SECRET'),false);});
test('corrupt journal fails closed without source reads',async()=>{const x=setup();await new SourceExecutionCoordinator(x.services).tick();for(const key of x.services.attemptStorage.values.keys())x.services.attemptStorage.setItem(key,'broken');assert.equal((await new SourceExecutionCoordinator(x.services).tick()).status,'storage_error');assert.equal(x.counts().reads,1);});
test('bounded holds never evict unresolved attempts',async()=>{const x=setup();const c=new SourceExecutionCoordinator(x.services);await c.tick();const key=[...x.services.attemptStorage.values.keys()][0];x.services.attemptStorage.setItem(key,JSON.stringify(Array.from({length:100},(_,i)=>({taskId:'hold-'+i,version:1,status:'uncertain'}))));assert.equal((await c.tick()).status,'capacity');assert.equal(c.entries().length,100);assert.equal(x.counts().reads,1);});
test('credential mutation during extraction blocks old source and reconnect invalidates pending reads',async()=>{for(const mode of ['credential','reconnect']){const x=setup();const c=new SourceExecutionCoordinator(x.services);x.services.getFile=async()=>{if(mode==='credential')x.client.token='changed';else c.reconnect();return {};};assert.equal((await c.tick()).status,'stale');assert.equal(x.counts().sends,0);}});
test('two coordinators preserve distinct holds while acknowledgment is pending',async()=>{const x=setup();let acknowledge;x.client.run=()=>new Promise(r=>acknowledge=r);const first=new SourceExecutionCoordinator(x.services);const pending=first.tick();while(!acknowledge)await new Promise(r=>setTimeout(r,1));const other={...x.client,state:structuredClone(x.state),run:async()=>{}};other.state.tasks[0].delegation.children[0].taskId='d';other.state.tasks[1].id='d';const second=new SourceExecutionCoordinator({...x.services,getClient:()=>other});assert.equal((await second.tick()).status,'submitted');acknowledge();await pending;const reloaded=new SourceExecutionCoordinator(x.services);await reloaded.tick();assert.deepEqual(reloaded.entries().map(a=>a.taskId).sort(),['c','d']);});
test('write failure and unavailable locks fail closed before extraction',async()=>{for(const mode of ['write','locks']){const x=setup();if(mode==='write')x.services.attemptStorage.setItem=()=>{throw Error('quota');};else x.services.attemptLocks={request:async()=>{throw Error('unavailable');}};assert.equal((await new SourceExecutionCoordinator(x.services).tick()).status,'storage_error');assert.deepEqual(x.counts(),{sends:0,reads:0});}});
test('reconnect clears source failure only and keeps uncertain hold',async()=>{const x=setup();x.services.extractText=async()=>({status:'unavailable'});const c=new SourceExecutionCoordinator(x.services);await c.tick();assert.equal((await c.reconnect()).status,'reconnected');x.services.extractText=async()=>({status:'available',text:'PRIVATE_SOURCE'});x.client.run=async()=>{throw Error('lost response');};assert.equal((await c.tick()).status,'uncertain');await c.reconnect();assert.equal((await c.tick()).status,'waiting');assert.equal(c.entries()[0].status,'uncertain');});
test('source extraction and provider request hold no journal lock',async()=>{const x=setup();let locked=false;x.services.attemptLocks={request:async(key,fn)=>{assert.equal(locked,false);locked=true;try{return fn();}finally{locked=false;}}};x.services.getFile=async()=>{assert.equal(locked,false);return {};};x.client.run=async()=>{assert.equal(locked,false);};assert.equal((await new SourceExecutionCoordinator(x.services).tick()).status,'submitted');});
test('duplicate journal task IDs fail closed across reconnect and recreation',async()=>{
 const x=setup(),c=new SourceExecutionCoordinator(x.services);
 await c.tick();
 const key=[...x.services.attemptStorage.values.keys()][0];
 const damaged=JSON.stringify([{taskId:'c',version:1,status:'uncertain'},{taskId:'c',version:1,status:'source_error'}]);
 x.services.attemptStorage.setItem(key,damaged);
 assert.equal((await c.reconnect()).status,'storage_error');
 assert.equal((await c.tick()).status,'storage_error');
 assert.equal((await c.recover('c')).status,'storage_error');
 assert.equal((await new SourceExecutionCoordinator(x.services).tick()).status,'storage_error');
 assert.equal(x.services.attemptStorage.getItem(key),damaged);
 assert.deepEqual(x.counts(),{sends:1,reads:1});
});
