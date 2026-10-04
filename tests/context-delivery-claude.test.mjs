import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';

async function fire(t,content){
 const DB=new TestD1();t.after(()=>DB.close());const store=new D1TaskStore(DB);
 const env={DB,ACCESS_TOKEN:'test-cloud-context-01234567890123456789',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'fake'};
 let prompt=null;
 const worker=createWorker({fetchFn:async(_url,input)=>{prompt=JSON.parse(input.body).text;return Response.json({claude_code_session_id:'fake',claude_code_session_url:'https://example.test/session'});}});
 let task=await store.createTask({prompt:'Prepare a report.'});
 if(content)task=await store.replaceTask(task.id,task.version,current=>({...current,version:current.version+1,messages:[...current.messages,{id:'big',role:'user',content}]}));
 const response=await worker.fetch(new Request(`https://inno.test/api/tasks/${task.id}/run`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({provider:'claude',expectedVersion:task.version})}),env);
 assert.equal(response.status,202);
 return {prompt,task:await store.requireTask(task.id)};
}

test('a fired Claude execution records its context delivery at dispatch',async t=>{
 const {prompt,task}=await fire(t);
 const d=task.checkpoint.contextDelivery;
 assert.equal(task.status,'running');assert.equal(d.provider,'claude');assert.equal(d.readiness,'full_ready');assert.equal(d.reader,true);
 assert.equal(d.promptBytes,Buffer.byteLength(prompt));assert.equal(d.inputTokens,null);
});

test('a Claude execution blocked above the cap records why it never fired',async t=>{
 const {prompt,task}=await fire(t,'z'.repeat(190000)+'가'.repeat(70000));
 assert.equal(prompt,null);assert.equal(task.status,'failed');
 assert.equal(task.checkpoint.contextDelivery.readiness,'blocked');assert.equal(task.checkpoint.contextDelivery.promptBytes,null);
});

async function fireWith(t,respond){
 const DB=new TestD1();t.after(()=>DB.close());const store=new D1TaskStore(DB);
 const env={DB,ACCESS_TOKEN:'test-cloud-context-01234567890123456789',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'fake'};
 let prompt=null,fires=0;
 const worker=createWorker({fetchFn:async(_url,input)=>{fires++;prompt=JSON.parse(input.body).text;return respond();}});
 const task=await store.createTask({prompt:'Prepare a report.'});
 const response=await worker.fetch(new Request(`https://inno.test/api/tasks/${task.id}/run`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({provider:'claude',expectedVersion:task.version})}),env);
 assert.equal(response.status,202);
 return {prompt,fires,task:await store.requireTask(task.id)};
}

test('a Claude fire rejected for authentication records the context it sent',async t=>{
 for(const status of [401,403]){
 const {prompt,task}=await fireWith(t,()=>Response.json({error:'unauthorized'},{status}));
 assert.equal(task.status,'waiting_connection');assert.equal(task.checkpoint.failure.kind,'authentication');
 const d=task.checkpoint.contextDelivery;
 assert.equal(d?.provider,'claude');assert.equal(d.readiness,'full_ready');
 assert.equal(d.promptBytes,Buffer.byteLength(prompt));assert.equal(d.inputTokens,null);
 }
});

test('a quota-limited Claude fire records the context it sent',async t=>{
 const {prompt,task}=await fireWith(t,()=>Response.json({error:'rate limited'},{status:429,headers:{'retry-after':'60'}}));
 assert.equal(task.status,'waiting_quota');
 assert.equal(task.checkpoint.contextDelivery?.provider,'claude');
 assert.equal(task.checkpoint.contextDelivery.promptBytes,Buffer.byteLength(prompt));
});

test('an uncertain Claude fire awaits confirmation without claiming a delivery record',async t=>{
 const {prompt,fires,task}=await fireWith(t,()=>Response.json({error:'unavailable'},{status:503}));
 assert.ok(prompt);assert.equal(fires,1);assert.equal(task.status,'waiting_connection');
 assert.equal(task.checkpoint.confirmationRequired.reason,'uncertain_fire');
 assert.equal(task.checkpoint.contextDelivery,undefined);
});

test('a Claude fire whose outcome is unknown records no delivery',async t=>{
 const outcomes=[()=>{throw new TypeError('fetch failed');},()=>Response.json({claude_code_session_id:'only-id'})];
 for(const respond of outcomes){
  const {fires,task}=await fireWith(t,respond);
  assert.equal(fires,1);assert.equal(task.status,'waiting_connection');
  assert.equal(task.checkpoint.confirmationRequired.reason,'uncertain_fire');
  assert.equal(task.checkpoint.contextDelivery,undefined);
 }
});
