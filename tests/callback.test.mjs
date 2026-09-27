import {Readable} from 'node:stream';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callTool,prepareRequest,readArguments} from '../scripts/inno-mcp.mjs';

test('cloud callback sends JSON via stdin with no embedded credential or shell',async()=>{
 let seen;const result=await callTool('checkpoint_task',{taskId:'task',executionId:'run',generation:1,content:'검증 완료'}, {transport:async request=>{seen=request;return {code:0,stdout:JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'saved'}]}}),stderr:''};}});
 assert.equal(result.content[0].text,'saved');assert.equal(seen.url,'https://inno-workspace-api.innokaist.workers.dev/mcp');assert.equal(JSON.parse(seen.input).params.arguments.content,'검증 완료');assert.ok(!seen.args.some(s=>/authorization|bearer/i.test(s)));assert.ok(seen.args.includes('@-'));assert.ok(!seen.args.includes('--retry'));
});
test('callback rejects unsafe endpoints, unknown tools and oversized inputs before transport',()=>{
 assert.throws(()=>prepareRequest('read_task',{},'http://example.com/mcp'),/HTTPS/);
 assert.throws(()=>prepareRequest('read_task',{},'https://example.com/mcp?token=x'),/credentials|query/);
 assert.throws(()=>prepareRequest('delete_everything',{}),/Unsupported/);
 assert.throws(()=>prepareRequest('artifact_task',{content:'가'.repeat(260000)}),/750000/);
});
test('callback fails closed on HTTP, RPC and tool errors and never retries writes',async()=>{
 for(const response of [{code:22,stdout:'',stderr:'HTTP 401'}, {code:0,stdout:'not json',stderr:''}, {code:0,stdout:JSON.stringify({error:{message:'bad RPC'}})}, {code:0,stdout:JSON.stringify({result:{isError:true,content:[{text:'stale owner'}]}})}]){
  let calls=0;await assert.rejects(()=>callTool('checkpoint_task',{}, {transport:async()=>{calls++;return response;}}));assert.equal(calls,1);
 }
});

test('callback stdin preserves Korean split across arbitrary pipe chunks',async()=>{
 const data=Buffer.from(JSON.stringify({content:'검증 완료'}));const start=data.indexOf(Buffer.from('검'));
 const value=await readArguments(Readable.from([data.subarray(0,start+1),data.subarray(start+1,start+2),data.subarray(start+2)]));
 assert.equal(value.content,'검증 완료');
 await assert.rejects(()=>readArguments(Readable.from([Buffer.alloc(750001,65)])),/750000/);
});test('cloud callback exposes the authenticated sequential handoff tool',()=>{assert.equal(JSON.parse(prepareRequest('handoff_task',{taskId:'t'}).input).params.name,'handoff_task');});

test('callback moves the scoped execution capability to the JSON-RPC envelope only',()=>{
 const request=prepareRequest('checkpoint_task',{taskId:'t',executionId:'e',generation:1,content:'done',executionCapability:'signed.scope.value'});
 const payload=JSON.parse(request.input);
 assert.equal(payload.executionCapability,'signed.scope.value');assert.equal(payload.params.arguments.executionCapability,undefined);
 assert.equal(request.args.some(value=>value.includes('signed.scope.value')),false);
});

test('callback surfaces bounded JSON errors from HTTP conflict responses',async()=>{
 await assert.rejects(()=>callTool('checkpoint_task',{}, {transport:async()=>({code:22,stdout:JSON.stringify({error:'stale execution owner cannot write this task',currentVersion:7}),stderr:'curl: (22)'})}),/stale execution owner/);
});
