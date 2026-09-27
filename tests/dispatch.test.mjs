import test from 'node:test';
import assert from 'node:assert/strict';
import {ConflictError} from '../public/core/tasks.mjs';
import {dispatchClaude} from '../worker/dispatch.mjs';
import {createWorker} from '../worker/index.mjs';
function fixture(){let task={id:'t',version:1,status:'queued',checkpoint:{provider:'claude'}};return {get task(){return task},requireTask:async()=>structuredClone(task),claimExecution:async(id,input)=>{if(input.expectedVersion!==task.version)throw new ConflictError('changed',task.version);if(task.status!=='queued'&&task.status!=='queued_for_review')throw new ConflictError('owned',task.version);task={...task,status:'running',version:task.version+1,checkpoint:{...task.checkpoint,executionId:'e',generation:1}};return {task:structuredClone(task),executionId:'e',generation:1}},markExecutionUncertain:async()=>task={...task,status:'waiting_connection',checkpoint:{...task.checkpoint,confirmationRequired:{reason:'uncertain_fire'}}},leaveExecutionRunning:async()=>task,markWaiting:async()=>task={...task,status:'waiting_connection'},failExecution:async(id,input)=>task={...task,status:input.status??'failed',failure:input.failure}};}
test('concurrent queued dispatch claims start only one Claude session',async()=>{const store=fixture(),pending=[];let starts=0;const args={store,taskId:'t',hasRoutine:true,fire:async()=>{starts++;return {claude_code_session_url:'https://claude.ai/code/s'}},waitUntil:p=>pending.push(p)};await Promise.all([dispatchClaude(args),dispatchClaude(args)]);await Promise.all(pending);assert.equal(starts,1);assert.equal(store.task.status,'running');});
test('missing connection does not start a session',async()=>{const store=fixture();await dispatchClaude({store,taskId:'t',hasRoutine:false,fire:()=>{throw Error('must not run')}});assert.equal(store.task.status,'waiting_connection');});
test('uncertain fire failures are recorded and never automatically dispatched twice',async()=>{const store=fixture();let starts=0;const args={store,taskId:'t',hasRoutine:true,fire:async()=>{starts++;throw Object.assign(Error('network'),{code:'CONNECTION_FAILED'});}};await dispatchClaude(args);await dispatchClaude(args);assert.equal(starts,1);assert.notEqual(store.task.status,'queued');});
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
async function realFixture(t){const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db);const created=await store.createTask({prompt:'Check a generated answer'});const task=await store.replaceTask(created.id,created.version,c=>({...c,status:'queued',version:c.version+1,checkpoint:{provider:'claude',status:'queued'}}));return {store,task};}
test('lost fire response requires confirmation and cannot resume through ordinary actions or claims',async t=>{const {store,task}=await realFixture(t);let fires=0;await dispatchClaude({store,taskId:task.id,hasRoutine:true,fire:async()=>{fires++;throw Object.assign(Error('response lost'),{code:'CONNECTION_FAILED'});}});const stopped=await store.requireTask(task.id);assert.equal(stopped.status,'waiting_connection');assert.equal(stopped.checkpoint.confirmationRequired.reason,'uncertain_fire');await assert.rejects(()=>store.applyAction(task.id,{expectedVersion:stopped.version,action:'resume'}),/confirm/i);await assert.rejects(()=>store.claimExecution(task.id,{provider:'claude',expectedVersion:stopped.version}),/confirm/i);await dispatchClaude({store,taskId:task.id,hasRoutine:true,fire:async()=>{fires++;}});assert.equal(fires,1);});
test('accepted fire survives metadata CAS conflicts and retries only metadata persistence',async t=>{const {store,task}=await realFixture(t);const leave=store.leaveExecutionRunning.bind(store);let writes=0,fires=0;store.leaveExecutionRunning=async(...args)=>{if(++writes===1)throw new ConflictError('concurrent checkpoint',3);return leave(...args);};await dispatchClaude({store,taskId:task.id,hasRoutine:true,fire:async()=>{fires++;return {claude_code_session_url:'https://claude.ai/code/accepted'};}});const current=await store.requireTask(task.id);assert.equal(current.status,'running');assert.equal(current.checkpoint.sessionUrl,'https://claude.ai/code/accepted');assert.equal(fires,1);assert.equal(writes,2);});
test('accepted fire preserves execution ownership even if metadata persistence stays unavailable',async t=>{const {store,task}=await realFixture(t);let writes=0;store.leaveExecutionRunning=async()=>{writes++;throw new Error('D1 temporarily unavailable');};await dispatchClaude({store,taskId:task.id,hasRoutine:true,fire:async()=>({claude_code_session_url:'https://claude.ai/code/accepted'})});const current=await store.requireTask(task.id);assert.equal(current.status,'running');assert.equal(current.checkpoint.confirmationRequired,undefined);assert.ok(writes<=3);});
test('definitive provider authentication rejection retains its distinct failure category',async t=>{const {store,task}=await realFixture(t);await dispatchClaude({store,taskId:task.id,hasRoutine:true,fire:async()=>{throw Object.assign(Error('rejected'),{code:'AUTH_REQUIRED'});}});const current=await store.requireTask(task.id);assert.equal(current.status,'waiting_connection');assert.equal(current.checkpoint.failure.kind,'authentication');assert.equal(current.checkpoint.confirmationRequired,undefined);});

function routinePromptHarness(t){
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db);
 const env={DB:db,ACCESS_TOKEN:'test-secret-01234567890123456789',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'mock'};
 let sent='';const worker=createWorker({fetchFn:async(_url,options)=>{sent=JSON.parse(options.body).text;return Response.json({claude_code_session_id:'fake',claude_code_session_url:'https://example.test/session'});}});
 return async(prompt,messages)=>{
  let task=await store.createTask({prompt});
  if(messages)task=await store.replaceTask(task.id,task.version,current=>({...current,version:current.version+1,messages:messages.map((message,index)=>({id:`message-${index}`,createdAt:'2026-09-28T00:00:00.000Z',...message}))}));
  const pending=[];const response=await worker.fetch(new Request(`https://inno.test/api/tasks/${task.id}/run`,{method:'POST',headers:{authorization:`Bearer ${env.ACCESS_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({provider:'claude',expectedVersion:task.version})}),env,{waitUntil:promise=>pending.push(promise)});
  await Promise.all(pending);assert.equal(response.status,202);
  return sent;
 };
}
const routineRequest=text=>text.split('Request: ')[1]?.split('\nRecent durable conversation')[0];
const routineConversation=text=>text.split('Recent durable conversation (newer messages can revise the original request):\n')[1]?.split('\nLast durable checkpoint:')[0];

test('Worker Routine HTTP keeps a long sole original request in full and omits its duplicate message',async t=>{
 const promptFor=routinePromptHarness(t),request='original-start '+ 'x'.repeat(8_500)+' original-end';
 const sent=await promptFor(request);
 assert.equal(routineRequest(sent),request);
 assert.equal(routineConversation(sent),'- No additional messages.');
 assert.equal((sent.match(/original-start/g)||[]).length,1);
 assert.equal((sent.match(/original-end/g)||[]).length,1);
});

test('Worker Routine HTTP preserves changed, non-user, repeated, short and bounded history',async t=>{
 const promptFor=routinePromptHarness(t),request='Original request with detail worth preserving.';
 for(const [messages,expected] of [
  [[{role:'user',content:request},{role:'user',content:request}],`user: ${request}\n\nuser: ${request}`],
  [[{role:'user',content:'Different content.'}],'user: Different content.'],
  [[{role:'assistant',content:request}],`assistant: ${request}`],
 ]){
  const sent=await promptFor(request,messages);assert.equal(routineRequest(sent),request);assert.equal(routineConversation(sent),expected);
 }
 for(const short of ['Hi','안녕'])assert.equal(routineConversation(await promptFor(short)),`user: ${short}`);
 const changed='changed-start '+ 'y'.repeat(8_500)+' changed-end';
 assert.equal(routineConversation(await promptFor(request,[{role:'user',content:changed}])),`user: ${changed.slice(0,8_000)}`);
 const history=Array.from({length:21},(_,index)=>({role:'user',content:`message-${String(index).padStart(2,'0')}:`+'z'.repeat(4_500)}));
 const bounded=routineConversation(await promptFor(request,history));
 assert.equal(bounded.length,80_000);assert.doesNotMatch(bounded,/message-00:/);assert.match(bounded,/message-20:/);
});
