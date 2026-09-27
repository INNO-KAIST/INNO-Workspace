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
