import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';

const workspaceId='e0cbb8a7-2f31-4c3a-91e9-6cce02637d24';
const otherWorkspace='acfaf031-9e23-4d92-b7e7-cf3bca73c8e2';
const base={workspaceId,taskId:'task-1',action:'complete',input:{executionId:'exec-1',generation:2,result:'saved'}};
const sha=text=>createHash('sha256').update(text).digest('hex');
const receipt=overrides=>createDeliveryReceipt({...base,...overrides});
const invalid=async args=>assert.rejects(()=>createDeliveryReceipt(args),e=>e?.name==='ValidationError'&&e?.statusCode===400);

test('receipt hashes the canonical ownership tuple and complete wire payload without leaking it',async()=>{
 const actual=await receipt();
 assert.deepEqual(actual,{
  version:1,
  id:sha(JSON.stringify([1,workspaceId,'task-1','exec-1',2,'complete'])),
  workspaceId,taskId:'task-1',executionId:'exec-1',generation:2,action:'complete',
  payloadDigest:sha('{"executionId":"exec-1","generation":2,"result":"saved"}'),
 });
 assert.equal(JSON.stringify(actual).includes('saved'),false);
});

test('object key order is irrelevant but string whitespace, array order, and unknown fields affect payload digest',async()=>{
 const first=await receipt({input:{executionId:'exec-1',generation:2,nested:{b:2,a:1},items:['a','b']}});
 const reordered=await receipt({input:{items:['a','b'],nested:{a:1,b:2},generation:2,executionId:'exec-1'}});
 assert.equal(first.id,reordered.id);assert.equal(first.payloadDigest,reordered.payloadDigest);
 for(const input of [
  {executionId:'exec-1',generation:2,nested:{a:1,b:2},items:['b','a']},
  {executionId:'exec-1',generation:2,nested:{a:1,b:2},items:['a','b'],extra:'unknown'},
  {executionId:'exec-1',generation:2,nested:{a:1,b:2},items:['a ','b']},
 ]){const changed=await receipt({input});assert.equal(changed.id,first.id);assert.notEqual(changed.payloadDigest,first.payloadDigest);}
});

test('owner, execution identity, generation and action each change receipt ID',async()=>{
 const original=await receipt();
 for(const change of [
  {workspaceId:otherWorkspace},
  {taskId:'task-2'},
  {action:'fail'},
  {input:{executionId:'exec-2',generation:2,result:'saved'}},
  {input:{executionId:'exec-1',generation:3,result:'saved'}},
 ])assert.notEqual((await receipt(change)).id,original.id);
});

test('JSON wire normalization omits object undefined and converts array holes and nonfinite numbers to null',async()=>{
 const source={executionId:'exec-1',generation:2,keep:undefined,items:[undefined,NaN,Infinity]};
 const actual=await receipt({input:source});
 assert.equal(actual.payloadDigest,sha('{"executionId":"exec-1","generation":2,"items":[null,null,null]}'));
 assert.equal(source.keep,undefined);
 const unicode=await receipt({input:{executionId:'exec-1',generation:2,text:'한글 😀'}});
 assert.equal(unicode.payloadDigest,sha('{"executionId":"exec-1","generation":2,"text":"한글 😀"}'));
});

test('canonical keys are safe for prototype-shaped field names',async()=>{
 const first=JSON.parse('{"__proto__":{"z":1},"constructor":2,"executionId":"exec-1","generation":2}');
 const second=JSON.parse('{"generation":2,"executionId":"exec-1","constructor":2,"__proto__":{"z":1}}');
 assert.equal((await receipt({input:first})).payloadDigest,(await receipt({input:second})).payloadDigest);
 assert.equal({}.z,undefined);
});

test('invalid identifiers, action, and wire inputs fail closed with ValidationError',async()=>{
 for(const args of [
  {...base,workspaceId:'not-uuid'}, {...base,workspaceId:'e0cbb8a7-2f31-1c3a-91e9-6cce02637d24'},
  {...base,taskId:''}, {...base,taskId:'x'.repeat(201)}, {...base,action:'retry'},
  {...base,input:null}, {...base,input:[]}, {...base,input:'text'},
  {...base,input:{executionId:'',generation:2}},
  {...base,input:{executionId:'exec-1',generation:0}},
  {...base,input:{executionId:'exec-1',generation:Number.MAX_SAFE_INTEGER+1}},
  {...base,input:{executionId:'exec-1',generation:2,large:1n}},
 ])await invalid(args);
 const cyclic={executionId:'exec-1',generation:2};cyclic.self=cyclic;
 await invalid({...base,input:cyclic});
});

test('wire byte and nesting limits use UTF-8 bytes and reject before hashing',async()=>{
 await invalid({...base,input:{executionId:'exec-1',generation:2,text:'가'.repeat(240000)}});
 const tooDeep={executionId:'exec-1',generation:2};let cursor=tooDeep;
 for(let i=0;i<65;i++){cursor.child={};cursor=cursor.child;}
 await invalid({...base,input:tooDeep});
 const below=await receipt({input:{executionId:'exec-1',generation:2,text:'a'.repeat(699000)}});
 assert.match(below.payloadDigest,/^[a-f0-9]{64}$/);
});

test('receipt identity and payload both use the same normalized JSON wire input',async()=>{
 const transformed={executionId:'unsubmitted',generation:99,toJSON(){return {executionId:'sent-exec',generation:4,actual:'sent'};}};
 const result=await receipt({input:transformed});
 assert.equal(result.executionId,'sent-exec');assert.equal(result.generation,4);
 assert.equal(result.id,sha(JSON.stringify([1,workspaceId,'task-1','sent-exec',4,'complete'])));
 assert.equal(result.payloadDigest,sha('{"actual":"sent","executionId":"sent-exec","generation":4}'));
 assert.equal(JSON.stringify(result).includes('unsubmitted'),false);
});
