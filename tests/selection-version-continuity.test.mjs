import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildTaskContext} from '../public/core/task-context.mjs';
import {createContextBasis} from '../public/core/context-resume.mjs';
import {readTaskContext} from '../public/core/task-context-read.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const options={selection:'resume',readerAvailable:true};
async function selected(){
 const task={id:'continuity',version:4,prompt:'REQUEST',attachments:[],messages:[
  {role:'user',content:'REQUEST'},
  {role:'assistant',content:'OLD '+'a'.repeat(30000)},
  {role:'assistant',content:'LATER '+'b'.repeat(30000)},
 ]};
 const basis=await createContextBasis(task);
 task.checkpoint={content:'CHECKPOINT',resumeState:{version:1,...basis,items:[{kind:'completed',text:'Earlier work verified',references:[1,2].map(messageIndex=>({section:'message',messageIndex,digest:hash(task.messages[messageIndex].content)}))}]}};
 task.messages.push({role:'user',content:'continue'});
 const packet=await buildTaskContext(task,options);
 assert.equal(packet.manifest.selection.applied,'resume');
 return {task,packet};
}

test('selection guidance treats a version-only change as a digest-bound retry, not a stop',async()=>{
 const {packet}=await selected();const text=JSON.stringify(packet);
 assert.match(text,/currentVersion/);assert.match(text,/same expectedDigest/);
 assert.doesNotMatch(text,/changed task version, stop/);
});

test('an omitted original stays readable after renewal-only version changes under its listed digest',async()=>{
 const {task,packet}=await selected(),source=packet.manifest.omissions[0];
 const query={taskId:task.id,expectedVersion:packet.manifest.taskVersion,section:'message',messageIndex:source.messageIndex,offset:0,expectedDigest:source.digest};
 task.version+=2;
 let conflict;await assert.rejects(()=>readTaskContext(task,query),e=>{conflict=e;return e.code==='CONTEXT_VERSION_CONFLICT';});
 const page=await readTaskContext(task,{...query,expectedVersion:conflict.currentVersion});
 assert.equal(page.contentDigest,source.digest);assert.equal(page.text,task.messages[source.messageIndex].content.slice(0,16000));
 const next=await readTaskContext(task,{...query,expectedVersion:conflict.currentVersion,offset:page.nextOffset});
 assert.equal(next.contentDigest,source.digest);
 task.messages[source.messageIndex].content='changed';task.version++;
 await assert.rejects(()=>readTaskContext(task,{...query,expectedVersion:task.version}),e=>e.statusCode===409&&/digest/.test(e.message));
});

test('Claude cloud reader guidance does not invalidate selection on a version-only conflict',async t=>{
 const DB=new TestD1();t.after(()=>DB.close());const store=new D1TaskStore(DB);
 const env={DB,ACCESS_TOKEN:'test-cloud-context-01234567890123456789',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'fake'};
 let prompt='';
 const worker=createWorker({fetchFn:async(_url,input)=>{prompt=JSON.parse(input.body).text;return Response.json({claude_code_session_id:'fake',claude_code_session_url:'https://example.test/session'});}});
 const task=await store.createTask({prompt:'Prepare a report.'});
 const response=await worker.fetch(new Request(`https://inno.test/api/tasks/${task.id}/run`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({provider:'claude',expectedVersion:task.version})}),env);
 assert.equal(response.status,202);
 assert.doesNotMatch(prompt,/a version or digest mismatch invalidates that selection/);
 assert.match(prompt,/version-only conflict does not invalidate/);
 assert.match(prompt,/same contentDigest/);
 assert.doesNotMatch(prompt,/Refresh source references\/basis if the task changes\./);
});
