import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {SqliteTaskStore} from '../server/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {countContextRead,takeContextReads,sweepContextReads} from '../worker/context-reads.mjs';

// A fired Claude execution reads its own context through the Worker; the Worker counts
// those reads per execution and merges them into the delivery record on completion.
async function fired(t){
 const DB=new TestD1();t.after(()=>DB.close());const store=new D1TaskStore(DB);
 const env={DB,ACCESS_TOKEN:'test-cloud-reads-0123456789012345678901',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'fake'};
 let prompt=null,id=0;
 const worker=createWorker({fetchFn:async(_url,input)=>{if(input?.body)prompt=JSON.parse(input.body).text;return Response.json({claude_code_session_id:'fake',claude_code_session_url:'https://example.test/session'});}});
 const created=await store.createTask({prompt:'Prepare a report.'});
 const response=await worker.fetch(new Request(`https://inno.test/api/tasks/${created.id}/run`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({provider:'claude',expectedVersion:created.version})}),env);
 assert.equal(response.status,202);
 const executionCapability=prompt.match(/Capability: ([^\n]+)/)[1];
 const mcp=async(name,args)=>(await (await worker.fetch(new Request('https://inno.test/mcp',{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',executionCapability,params:{name,arguments:args}})}),env)).json()).result;
 const task=await store.requireTask(created.id);
 return {DB,env,worker,store,task,mcp,scope:{taskId:task.id,executionId:task.checkpoint.executionId,generation:task.checkpoint.generation}};
}

test('cloud scoped re-reads are counted per execution and merged into the delivery at completion',async t=>{
 const {DB,store,task,mcp,scope}=await fired(t);
 assert.equal(task.checkpoint.contextDelivery.reader,true);assert.equal(Object.hasOwn(task.checkpoint.contextDelivery,'retrievalRequests'),false);
 assert.deepEqual(await takeContextReads(DB,scope),{requests:0,bytes:0});
 const ok=await mcp('read_task_context',{taskId:task.id,expectedVersion:task.version,section:'request'});
 assert.notEqual(ok.isError,true);
 const bad=await mcp('read_task_context',{taskId:task.id,expectedVersion:task.version,section:'message',messageIndex:99});
 assert.equal(bad.isError,true);
 assert.deepEqual(await takeContextReads(DB,scope),{requests:2,bytes:Buffer.byteLength(ok.content[0].text)});
 const done=await mcp('checkpoint_task',{taskId:task.id,executionId:scope.executionId,generation:scope.generation,status:'completed',content:'Done'});
 assert.notEqual(done.isError,true,JSON.stringify(done));
 const finished=await store.requireTask(task.id);
 assert.equal(finished.status,'completed');
 assert.equal(finished.checkpoint.contextDelivery.retrievalRequests,2);
 assert.equal(finished.checkpoint.contextDelivery.retrievalBytes,Buffer.byteLength(ok.content[0].text));
 assert.equal(finished.checkpoint.usageHistory.at(-1).contextDelivery.retrievalRequests,2);
 assert.equal(await takeContextReads(DB,scope),null);
});

test('a fired run that never re-reads records zero rather than unmeasured',async t=>{
 const {store,task,mcp,scope}=await fired(t);
 await mcp('checkpoint_task',{taskId:task.id,executionId:scope.executionId,generation:scope.generation,status:'completed',content:'Done'});
 const finished=await store.requireTask(task.id);
 assert.equal(finished.checkpoint.contextDelivery.retrievalRequests,0);assert.equal(finished.checkpoint.contextDelivery.retrievalBytes,0);
});

test('a rejected completion keeps the counter for the completion that follows',async t=>{
 const {DB,store,task,mcp,scope}=await fired(t);
 await mcp('read_task_context',{taskId:task.id,expectedVersion:task.version,section:'request'});
 const rejected=await mcp('checkpoint_task',{taskId:task.id,executionId:scope.executionId,generation:scope.generation,status:'completed',content:'   '});
 assert.equal(rejected.isError,true);assert.equal((await takeContextReads(DB,scope)).requests,1);
 await mcp('checkpoint_task',{taskId:task.id,executionId:scope.executionId,generation:scope.generation,status:'completed',content:'Done'});
 assert.equal((await store.requireTask(task.id)).checkpoint.contextDelivery.retrievalRequests,1);
});

test('completion input cannot supply counts directly',async t=>{
 const {store,task,scope}=await fired(t);
 const finished=await store.finishExecution(task.id,{executionId:scope.executionId,generation:scope.generation,content:'Done',contextReads:{requests:99,bytes:99}});
 assert.equal(finished.status,'completed');assert.equal(Object.hasOwn(finished.checkpoint.contextDelivery,'retrievalRequests'),false);
});

for(const kind of ['local','worker']){
 test(`${kind} store drops a supplied re-read pair for a cloud provider's execution`,async t=>{
  const db=kind==='worker'?new TestD1():null,store=db?new D1TaskStore(db):new SqliteTaskStore(':memory:');
  t.after(()=>db?db.close():store.close());
  const created=await store.createTask({prompt:'Report'});
  const claim=await store.claimExecution(created.id,{provider:'claude',expectedVersion:created.version});
  const supplied={version:1,provider:'claude',unit:'utf8_bytes',readiness:'full_ready',contextBytes:100,originalBytes:100,selectionSavedBytes:0,omittedMessages:0,maxBytes:96000,hardMaxBytes:384000,reader:true,promptBytes:500,materialBytes:0,inputTokens:null,cachedTokens:null,retrievalRequests:999,retrievalBytes:999};
  const done=await store.finishExecution(created.id,{executionId:claim.executionId,generation:claim.generation,content:'Done',contextDelivery:supplied});
  assert.equal(done.checkpoint.contextDelivery.readiness,'full_ready');assert.equal(Object.hasOwn(done.checkpoint.contextDelivery,'retrievalRequests'),false);
 });
}

test('reads do not sweep; the bounded sweep runs separately and from the scheduled handler',async t=>{
 const DB=new TestD1();t.after(()=>DB.close());
 const stale=i=>({taskId:'old'+i,executionId:'e'+i,generation:1}),fresh={taskId:'cur',executionId:'e-cur',generation:2};
 for(let i=0;i<40;i++)await countContextRead(DB,stale(i),10,'2026-10-01T00:00:00.000Z');
 await countContextRead(DB,fresh,7,'2026-10-03T00:00:00.000Z');await countContextRead(DB,fresh,7,'2026-10-03T00:00:00.000Z');
 assert.deepEqual(await takeContextReads(DB,stale(0)),{requests:1,bytes:10});
 assert.deepEqual(await takeContextReads(DB,fresh),{requests:2,bytes:14});
 await sweepContextReads(DB,'2026-10-03T00:00:00.000Z');
 const left=async()=>(await DB.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key GLOB 'context_read:*'").first()).n;
 assert.equal(await left(),9);
 // The scheduled handler sweeps with the real clock: everything above is stale by then.
 const live={taskId:'live',executionId:'e-live',generation:1};
 await countContextRead(DB,live,3,new Date().toISOString());
 const env={DB,ACCESS_TOKEN:'test-cloud-reads-0123456789012345678901'};
 const worker=createWorker({fetchFn:async()=>new Response('unavailable',{status:503})});
 await worker.scheduled({},env);
 assert.equal(await left(),1);assert.deepEqual(await takeContextReads(DB,live),{requests:1,bytes:3});
});
