import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMcp} from '../server/mcp.mjs';
import {SqliteTaskStore} from '../server/store.mjs';

test('MCP completion replay returns the existing task without a second finish write',async()=>{
 const task={id:'t',status:'completed',checkpoint:{executionId:'execution',generation:2}};let writes=0;
 const store={requireTask:async()=>task,finishExecution:async()=>{writes++;throw Error('must not write');}};
 const response=await handleMcp(store,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'checkpoint_task',arguments:{taskId:'t',executionId:'execution',generation:2,content:'done',status:'completed'}}});
 assert.equal(response.result.isError,undefined);assert.deepEqual(JSON.parse(response.result.content[0].text).task,task);assert.equal(writes,0);
});

test('MCP completion advertises bounded observed usage',async()=>{
 const response=await handleMcp({}, {jsonrpc:'2.0',id:1,method:'tools/list'});
 const schema=response.result.tools.find(tool=>tool.name==='checkpoint_task').inputSchema;
 assert.equal(schema.required.includes('usage'),false);
 assert.deepEqual(schema.properties.usage.properties.inputTokens,{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER});
 assert.equal(schema.properties.usage.additionalProperties,false);
});

test('MCP completion preserves only current owner reported usage and replay cannot overwrite it',async()=>{
 const store=new SqliteTaskStore();
 try{
  const call=args=>handleMcp(store,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'checkpoint_task',arguments:args}});
  let task=store.createTask({prompt:'Usage reporting'});
  const stale=store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
  task=store.failExecution(task.id,{...stale,failure:{kind:'unknown'}});
  const current=store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
  const base={taskId:task.id,executionId:current.executionId,generation:current.generation,content:'done',status:'completed'};
  assert.equal((await call({...base,executionId:stale.executionId,generation:stale.generation,usage:{inputTokens:999}})).result.isError,true);
  assert.equal((await call({...base,usage:{inputTokens:12,outputTokens:3,cachedInputTokens:5}})).result.isError,undefined);
  let done=store.requireTask(task.id);
  assert.equal(done.checkpoint.usage.inputTokens,12);
  assert.equal(done.checkpoint.usage.cachedInputTokens,5);
  assert.equal(done.checkpoint.usage.source,'executor_report');
  assert.equal(done.checkpoint.usage.executionId,current.executionId);
  assert.equal((await call({...base,usage:{inputTokens:777}})).result.isError,undefined);
  assert.equal(store.requireTask(task.id).checkpoint.usage.inputTokens,12);
  task=store.applyAction(task.id,{action:'message',expectedVersion:done.version,content:'continue'});
  const next=store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
  const nextBase={...base,executionId:next.executionId,generation:next.generation};
  assert.equal((await call({...nextBase,usage:{inputTokens:-1,outputTokens:NaN}})).result.isError,undefined);
  done=store.requireTask(task.id);
  assert.equal(done.checkpoint.usage,null);
  assert.equal(done.checkpoint.usageHistory.at(-1).inputTokens,null);
  assert.equal(done.checkpoint.usageHistory.find(u=>u.executionId===current.executionId).inputTokens,12);
  task=store.applyAction(task.id,{action:'message',expectedVersion:done.version,content:'one more'});
  const finalOwner=store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
  assert.equal((await call({...base,executionId:finalOwner.executionId,generation:finalOwner.generation})).result.isError,undefined);
  done=store.requireTask(task.id);
  assert.equal(done.checkpoint.usage,null);
  assert.equal(done.checkpoint.usageHistory.at(-1).inputTokens,null);
  assert.equal(done.checkpoint.usageHistory.find(u=>u.executionId===current.executionId).inputTokens,12);
 }finally{store.close();}
});

test('SQLite MCP completion selects only files registered by the current owner',async()=>{
 const store=new SqliteTaskStore();
 try{
  const call=async(name,args)=>handleMcp(store,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
  const task=store.createTask({prompt:'Generate result'});
  const old=store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
  await call('artifact_task',{taskId:task.id,executionId:old.executionId,generation:old.generation,artifact:{name:'old.txt',mime:'text/plain',content:'old'}});
  const failed=store.failExecution(task.id,{executionId:old.executionId,generation:old.generation,failure:{kind:'unknown'}});
  const current=store.claimExecution(task.id,{provider:'codex',expectedVersion:failed.version});
  const file={taskId:task.id,executionId:current.executionId,generation:current.generation,artifact:{name:'current.txt',mime:'text/plain',content:'current'}};
  assert.equal((await call('artifact_task',file)).result.isError,undefined);
  assert.equal((await call('artifact_task',file)).result.isError,undefined);
  const complete={taskId:task.id,executionId:current.executionId,generation:current.generation,content:'done',status:'completed'};
  assert.equal((await call('checkpoint_task',complete)).result.isError,undefined);
  assert.equal((await call('checkpoint_task',complete)).result.isError,undefined);
  const done=store.requireTask(task.id);
  assert.deepEqual(done.artifacts.map(a=>a.name),['old.txt','current.txt','final.md']);
  assert.deepEqual(done.checkpoint.resultArtifactIds,done.artifacts.slice(1).map(a=>a.id));
 }finally{store.close();}
});
