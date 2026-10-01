import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {callTool} from '../scripts/inno-mcp.mjs';
import {verifyResumeState} from '../public/core/context-resume.mjs';

const decode=result=>JSON.parse(result.content[0].text);
async function fixture(t,{oversized=false}={}){
 const DB=new TestD1();t.after(()=>DB.close());const store=new D1TaskStore(DB);
 const env={DB,ACCESS_TOKEN:'test-cloud-context-01234567890123456789',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'fake'};
 let prompt='',fires=0;
 const worker=createWorker({fetchFn:async(_url,input)=>{fires++;prompt=JSON.parse(input.body).text;return Response.json({claude_code_session_id:'fake',claude_code_session_url:'https://example.test/session'});}});
 let task=await store.createTask({prompt:'Prepare a report without publishing it.'});
 task=await store.replaceTask(task.id,task.version,current=>({...current,version:current.version+1,messages:[...current.messages,{id:'early',role:'user',content:'ORIGINAL_DECISION: do not publish'},...Array.from({length:21},(_,i)=>({id:`progress-${i}`,role:'assistant',content:`Progress ${i}`})),{id:'tail',role:'user',content:'long-start '+'x'.repeat(oversized?400000:8500)+' long-end'}]}));
 const response=await worker.fetch(new Request(`https://inno.test/api/tasks/${task.id}/run`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({provider:'claude',expectedVersion:task.version})}),env);
 assert.equal(response.status,202);
 const transport=async request=>{
  const payload=JSON.parse(request.input);
  assert.equal(payload.params.arguments.executionCapability,undefined);
  assert.equal(request.args.some(arg=>arg.includes(payload.executionCapability)),false);
  const reply=await worker.fetch(new Request('https://inno.test/mcp',{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:request.input}),env);
  return {code:reply.ok?0:22,stdout:await reply.text(),stderr:''};
 };
 return {store,id:task.id,prompt,transport,fires};
}

test('Claude cloud callback prompt supplies executable scoped context reads and source-backed optional completion state',async t=>{
 const f=await fixture(t);
 assert.equal(f.fires,1);
 assert.match(f.prompt,/node scripts\/inno-mcp\.mjs read_task_context/);
 const args=JSON.parse(f.prompt.match(/^Context read arguments: (.+)$/m)?.[1]??'null');
 assert.equal(args.taskId,f.id);assert.equal(args.section,'manifest');assert.ok(Number.isSafeInteger(args.expectedVersion));
 assert.equal(args.expectedVersion,Number(f.prompt.match(/^Task version at dispatch: (\d+)$/m)?.[1]));
 const capability=f.prompt.match(/Capability: ([^\n]+)/)?.[1];assert.ok(capability);
 assert.notEqual(args.executionCapability,capability);
 args.executionCapability=capability;
 assert.ok(f.prompt.includes('ORIGINAL_DECISION: do not publish'));assert.ok(f.prompt.includes('long-end'));
 assert.match(f.prompt,/source_matched/);assert.match(f.prompt,/32768/);
 let conflict;
 await assert.rejects(()=>callTool('read_task_context',args,{transport:f.transport}),error=>{conflict=JSON.parse(error.message);return conflict.conflict==='context_version';});
 const current=await f.store.requireTask(f.id);assert.equal(conflict.currentVersion,current.version);
 const read=async(section,extra={})=>decode(await callTool('read_task_context',{...args,expectedVersion:current.version,section,...extra},{transport:f.transport}));
 const manifest=await read('manifest');assert.equal(manifest.messages.length,20);
 const original=await read('message',{messageIndex:1});assert.equal(original.text,'ORIGINAL_DECISION: do not publish');assert.equal(original.contentDigest,manifest.messages[1].digest);
 const basis=await read('basis',{messageCount:2});
 const resumeState={version:1,taskId:basis.taskId,mode:basis.mode,basis:basis.basis,items:[{kind:'decision',text:'Do not publish the report.',references:[{section:'message',messageIndex:1,digest:original.contentDigest}]}]};
 const result=decode(await callTool('checkpoint_task',{taskId:f.id,executionId:current.checkpoint.executionId,generation:current.checkpoint.generation,executionCapability:capability,status:'completed',content:'Report prepared.',resumeState},{transport:f.transport}));
 assert.equal(result.resumeStateSaved,true);assert.equal(result.task.status,'completed');
 const saved=await f.store.requireTask(f.id);assert.equal((await verifyResumeState(saved)).status,'source_matched');assert.deepEqual(saved.checkpoint.resumeState,resumeState);
 assert.equal(JSON.stringify(saved).includes(capability),false);
 assert.equal(JSON.stringify(resumeState).includes('executionCapability'),false);
 await assert.rejects(()=>callTool('read_task_context',{...args,expectedVersion:saved.version},{transport:f.transport}),/superseded/);
});

test('cloud callback context reader retains assignment scope and refuses another task',async t=>{
 const f=await fixture(t),other=await f.store.createTask({prompt:'PRIVATE_OTHER_TASK'});
 const capability=f.prompt.match(/Capability: ([^\n]+)/)?.[1];
 await assert.rejects(()=>callTool('read_task_context',{taskId:other.id,expectedVersion:other.version,section:'request',executionCapability:capability},{transport:f.transport}),error=>/outside/.test(error.message)&&!error.message.includes('PRIVATE_OTHER_TASK'));
});

test('cloud context guidance does not bypass oversized required context or create another AI call',async t=>{
 const f=await fixture(t,{oversized:true});assert.equal(f.fires,0);assert.equal(f.prompt,'');
 assert.notEqual((await f.store.requireTask(f.id)).status,'running');
});
