import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMcp} from '../server/mcp.mjs';

test('MCP completion replay returns the existing task without a second finish write',async()=>{
 const task={id:'t',status:'completed',checkpoint:{executionId:'execution',generation:2}};let writes=0;
 const store={requireTask:async()=>task,finishExecution:async()=>{writes++;throw Error('must not write');}};
 const response=await handleMcp(store,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'checkpoint_task',arguments:{taskId:'t',executionId:'execution',generation:2,content:'done',status:'completed'}}});
 assert.equal(response.result.isError,undefined);assert.deepEqual(JSON.parse(response.result.content[0].text).task,task);assert.equal(writes,0);
});
