import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMcp} from '../server/mcp.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {executionCapability} from '../worker/execution-scope.mjs';
import {TestD1} from './helpers/d1.mjs';

const message=(name,args,token)=>({jsonrpc:'2.0',id:1,method:'tools/call',executionCapability:token,params:{name,arguments:args}});
const page=result=>JSON.parse(result.result.content[0].text);
function fixture(t){
 const DB=new TestD1();t.after(()=>DB.close());
 const store=new D1TaskStore(DB),env={DB,ACCESS_TOKEN:'test-context-scope-01234567890123456789'};
 const worker=createWorker({fetchFn:async()=>{throw Error('No provider calls are permitted for context retrieval');}});
 const post=async input=>{
  const response=await worker.fetch(new Request('https://inno.test/mcp',{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify(input)}),env);
  return {status:response.status,...await response.json()};
 };
 const claim=async task=>{const c=await store.claimExecution(task.id,{provider:'claude',expectedVersion:task.version});return {...c,token:await executionCapability(env.ACCESS_TOKEN,c)};};
 const replace=async(task,patch)=>store.replaceTask(task.id,task.version,current=>({...current,...patch,version:current.version+1}));
 return {store,post,claim,replace};
}

test('MCP advertises bounded read-only context sections with strict paging arguments',async()=>{
 const response=await handleMcp({}, {jsonrpc:'2.0',id:1,method:'tools/list'});
 const tool=response.result.tools.find(item=>item.name==='read_task_context');
 assert.ok(tool);
 assert.equal(tool.annotations.readOnlyHint,true);
 assert.equal(tool.inputSchema.additionalProperties,false);
 assert.deepEqual(tool.inputSchema.required,['taskId','expectedVersion','section']);
 assert.deepEqual(tool.inputSchema.properties.section.enum,['request','checkpoint','message','manifest']);
 assert.equal(tool.inputSchema.properties.maxBytes.maximum,16000);
 assert.equal(tool.inputSchema.properties.executionId,undefined);
});

test('local MCP returns only the requested bounded text, then rejects stale versions and extra fields',async t=>{
 const f=fixture(t),created=await f.store.createTask({prompt:'ABCDPRIVATE_REQUEST_TAIL'});
 const task=await f.replace(created,{attachments:[{id:'source',name:'PRIVATE_ATTACHMENT'}],artifacts:[{id:'artifact',content:'PRIVATE_ARTIFACT'}],checkpoint:{content:'PRIVATE_CHECKPOINT'}});
 const args={taskId:task.id,expectedVersion:task.version,section:'request',maxBytes:4};
 const result=await handleMcp(f.store,message('read_task_context',args));
 assert.equal(result.result.isError,undefined);
 assert.match(JSON.stringify(page(result)),/ABCD/);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|attachments|artifacts/);
 for(const invalid of [{...args,expectedVersion:task.version-1},{...args,executionId:'not-a-read-argument'},{...args,offset:4},{...args,offset:4,expectedDigest:'0'.repeat(64)}]){
  const rejected=await handleMcp(f.store,message('read_task_context',invalid));
  assert.equal(rejected.result.isError,true);
  assert.doesNotMatch(JSON.stringify(rejected),/PRIVATE_/);
 }
 assert.equal((await f.store.requireTask(task.id)).version,task.version);
});

test('Worker MCP allows owned context reads without write-owner args and excludes sibling, parent and unrelated tasks',async t=>{
 const f=fixture(t),parent=await f.store.createTask({prompt:'PRIVATE_PARENT'}),sibling=await f.store.createTask({prompt:'PRIVATE_SIBLING'}),other=await f.store.createTask({prompt:'PRIVATE_OTHER'});
 await f.replace(parent,{status:'waiting_children',delegation:{state:'waiting_children',batchId:'batch',epoch:1}});
 const created=await f.store.createTask({prompt:'ABCDPRIVATE_CHILD_TAIL'});
 const child=await f.replace(created,{parentTaskId:parent.id,parentEpoch:1,batchId:'batch',status:'queued',assignment:{provider:'claude'}}),claim=await f.claim(child);
 const args={taskId:child.id,expectedVersion:claim.task.version,section:'request',maxBytes:4};
 const accepted=await f.post(message('read_task_context',args,claim.token));
 assert.equal(accepted.status,200);assert.equal(accepted.result.isError,undefined);
 assert.match(JSON.stringify(page(accepted)),/ABCD/);assert.doesNotMatch(JSON.stringify(accepted),/PRIVATE_/);
 for(const denied of [parent,sibling,other]){
  const result=await f.post(message('read_task_context',{...args,taskId:denied.id,expectedVersion:denied.version},claim.token));
  assert.equal(result.status,400);assert.match(result.error,/outside/);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
 }
 await f.replace(claim.task,{checkpoint:{...claim.task.checkpoint,executionId:'superseded-owner'}});
 const superseded=await f.post(message('read_task_context',args,claim.token));
 assert.equal(superseded.status,409);assert.match(superseded.error,/superseded/);assert.doesNotMatch(JSON.stringify(superseded),/PRIVATE_/);
});

test('Worker MCP review reads use scoped child filtering and reject changed child batches',async t=>{
 const f=fixture(t),parent=await f.store.createTask({prompt:'parent review'}),created=await f.store.createTask({prompt:'ABCDPRIVATE_REVIEW_TAIL'});
 const child=await f.replace(created,{parentTaskId:parent.id,batchId:'approved-batch',status:'completed',checkpoint:{content:'PRIVATE_CHILD_CHECKPOINT'},artifacts:[{id:'hidden',content:'PRIVATE_CHILD_ARTIFACT'}]});
 const reviewing=await f.replace(parent,{status:'queued_for_review',delegation:{state:'queued_for_review',masterProvider:'claude',batchId:'approved-batch',children:[{taskId:child.id}],review:{children:[{taskId:child.id,artifacts:[]}]}}});
 const claim=await f.claim(reviewing);
 const args={taskId:child.id,expectedVersion:child.version,section:'request',maxBytes:4};
 const accepted=await f.post(message('read_task_context',args,claim.token));
 assert.equal(accepted.status,200);assert.equal(accepted.result.isError,undefined);
 assert.match(JSON.stringify(page(accepted)),/ABCD/);assert.doesNotMatch(JSON.stringify(accepted),/PRIVATE_/);
 const checkpoint=await f.post(message('read_task_context',{...args,section:'checkpoint',maxBytes:16000},claim.token));
 assert.equal(checkpoint.result.isError,undefined);assert.doesNotMatch(JSON.stringify(checkpoint),/PRIVATE_CHILD_CHECKPOINT/);
 await f.replace(claim.task,{delegation:{...claim.task.delegation,batchId:'changed-batch'}});
 const denied=await f.post(message('read_task_context',args,claim.token));
 assert.equal(denied.result.isError,true);assert.match(denied.result.content[0].text,/Review child has changed/);assert.doesNotMatch(JSON.stringify(denied),/PRIVATE_/);
});
test('MCP context text continuation preserves UTF-8 and manifest pages expose only bounded metadata',async t=>{
 const f=fixture(t),created=await f.store.createTask({prompt:'A가BC'});
 const task=await f.replace(created,{messages:Array.from({length:21},(_,index)=>({id:`m-${index}`,role:'user',content:`PRIVATE_MESSAGE_BODY_${index}`}))});
 const claim=await f.claim(task);
 const args={taskId:task.id,expectedVersion:claim.task.version,section:'request',maxBytes:4};
 const first=page(await f.post(message('read_task_context',args,claim.token)));
 assert.equal(first.text,'A가');assert.equal(first.nextOffset,4);assert.equal(first.done,false);
 const second=page(await f.post(message('read_task_context',{...args,offset:first.nextOffset,expectedDigest:first.contentDigest},claim.token)));
 assert.equal(second.text,'BC');assert.equal(second.done,true);assert.equal(second.totalBytes,6);
 const manifestArgs={taskId:task.id,expectedVersion:claim.task.version,section:'manifest'};
 const firstManifest=page(await f.post(message('read_task_context',manifestArgs,claim.token)));
 assert.equal(firstManifest.messages.length,20);assert.equal(firstManifest.nextOffset,20);assert.equal(firstManifest.done,false);
 assert.doesNotMatch(JSON.stringify(firstManifest),/PRIVATE_MESSAGE_BODY/);
 const lastManifest=page(await f.post(message('read_task_context',{...manifestArgs,offset:20},claim.token)));
 assert.equal(lastManifest.messages.length,1);assert.equal(lastManifest.messages[0].messageIndex,20);assert.equal(lastManifest.done,true);
 assert.doesNotMatch(JSON.stringify(lastManifest),/PRIVATE_MESSAGE_BODY/);
 const picked=page(await f.post(message('read_task_context',{...manifestArgs,section:'message',messageIndex:20},claim.token)));
 assert.equal(picked.text,'PRIVATE_MESSAGE_BODY_20');assert.equal(picked.contentDigest,lastManifest.messages[0].digest);
 assert.equal((await f.store.requireTask(task.id)).version,claim.task.version);
});
test('Worker MCP discovers current context version through safe conflict metadata without rereading the full task',async t=>{
 const f=fixture(t),created=await f.store.createTask({prompt:'PRIVATE_DISCOVERY_REQUEST'}),claim=await f.claim(created);
 const args={taskId:created.id,expectedVersion:0,section:'manifest'};
 const stale=await f.post(message('read_task_context',args,claim.token));
 assert.equal(stale.status,200);assert.equal(stale.result.isError,true);
 assert.deepEqual(page(stale),{conflict:'context_version',taskId:created.id,currentVersion:claim.task.version});
 assert.doesNotMatch(JSON.stringify(stale),/PRIVATE_DISCOVERY_REQUEST|executionId|capability/i);
 const current=await f.post(message('read_task_context',{...args,expectedVersion:page(stale).currentVersion},claim.token));
 assert.equal(current.result.isError,undefined);assert.equal(page(current).taskVersion,claim.task.version);
 assert.doesNotMatch(JSON.stringify(current),/PRIVATE_DISCOVERY_REQUEST/);
});
