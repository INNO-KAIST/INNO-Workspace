import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createCodexRunner,createClaudeRoutineRunner} from '../server/runners.mjs';
import {createContextAccess} from '../server/context-access.mjs';
import {createContextBasis} from '../public/core/context-resume.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {callTool} from '../scripts/inno-mcp.mjs';

const oldText='OMIT_OLD_ASSISTANT_BEGIN '+'x'.repeat(12000)+' OMIT_OLD_ASSISTANT_END';
async function sourceTask(old=oldText){
 const task={id:'selection-case',version:3,type:'general',title:'Selection case',prompt:'KEEP_REQUEST',plan:[],attachments:[],messages:[
  {id:'m0',role:'user',content:'KEEP_REQUEST'},
  {id:'m1',role:'assistant',content:old},
  {id:'m2',role:'assistant',content:'KEEP_ASSISTANT_BEFORE_USER'},
  {id:'m3',role:'system',content:'KEEP_SYSTEM'},
  {id:'m4',role:'user',content:'KEEP_USER_CHANGE'},
  {id:'m5',role:'user',content:'KEEP_PENDING_USER'},
  {id:'m6',role:'assistant',content:'KEEP_PENDING_ASSISTANT'},
 ],checkpoint:{content:'KEEP_CHECKPOINT'}};
 const context=await createContextBasis(task,{messageCount:5});
 task.checkpoint.resumeState={version:1,...context,items:[{kind:'completed',text:'Earlier draft prepared.',references:[{section:'message',messageIndex:1,digest:createHash('sha256').update(old).digest('hex')}]}]};
 return task;
}
async function codex(task,{configured=true,failOpen=false,evaluation=false,snapshotLimit,failExit=false,noUsage=false}={}){
 if(evaluation){const binding={jobId:'selection-evaluation',phase:'candidate',maxDurationMs:100,provider:'codex'};task={...task,status:'running',evaluationBudget:binding,checkpoint:{...task.checkpoint,provider:'codex',executionId:'execution',generation:1,claimedAt:new Date(1000).toISOString(),evaluationBudget:{...binding,deadlineAtMs:1100}}};}
 const registry=createContextAccess(snapshotLimit?{maxSnapshotBytes:snapshotLimit}:{}),capture={spawns:0,opens:0};
 const access={open(...args){capture.opens++;if(failOpen)throw Error('reader unavailable');const lease=registry.open(...args);return noUsage?{token:lease.token,revoke:lease.revoke}:lease;}};
 const runner=createCodexRunner({managedDelivery:true,...(evaluation?{now:()=>1010,monotonicNow:()=>0}:{}),...(configured?{contextAccess:access,contextUrl:'http://127.0.0.1:4175/api/desktop/context'}:{}),ensureDirectory:()=>{},runDirectory:()=>process.cwd(),spawnProcess:(_command,_args,options)=>{
  capture.spawns++;const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin.on('data',chunk=>capture.prompt=(capture.prompt??'')+chunk);
  child.stdin.on('finish',()=>{void(async()=>{
   if(options.env.INNO_CONTEXT_TOKEN){
    const markerDigest=capture.prompt.match(/messageIndex=1; SHA-256=([a-f0-9]{64})/)?.[1];
    const query={taskId:task.id,expectedVersion:task.version,section:'message',messageIndex:1,...(markerDigest?{expectedDigest:markerDigest}:{})};
    if(markerDigest){await assert.rejects(()=>registry.read(options.env.INNO_CONTEXT_TOKEN,{...query,expectedDigest:'0'.repeat(64)}),error=>error.statusCode===409);capture.digestMismatchRejected=true;}
    capture.recovered=await registry.read(options.env.INNO_CONTEXT_TOKEN,query);
    if(markerDigest)assert.equal(capture.recovered.contentDigest,markerDigest);
   }
   if(failExit){child.stdout.end();child.emit('close',1,null);return;}
   child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Done'}})+'\n');child.stdout.end();child.emit('close',0,null);
  })().catch(error=>child.emit('error',error));});return child;
 }});
 try{capture.result=await runner.run({task,executionId:'execution',generation:1,...(evaluation?{executionBudgetVersion:1}:{})});return capture;}catch(error){error.capture=capture;throw error;}finally{registry.close();}
}
async function cloud(t,task){
 const DB=new TestD1();t.after(()=>DB.close());const store=new D1TaskStore(DB,{id:()=>task.id});
 // Seed with a small request, then store the case as-is: oversized cases stand for
 // tasks stored before creation-time limits or grown past the cap.
 let stored=await store.createTask({prompt:'seed'});stored=await store.replaceTask(stored.id,stored.version,current=>({...current,...task,version:current.version+1}));
 const env={DB,ACCESS_TOKEN:'test-selection-context-01234567890123456789',CLAUDE_ROUTINE_TOKEN:'fake',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire'},capture={fires:0};
 const worker=createWorker({fetchFn:async(_url,input)=>{
  capture.fires++;capture.prompt=JSON.parse(input.body).text;
  const capability=capture.prompt.match(/Capability: ([^\n]+)/)[1],current=await store.requireTask(stored.id);
  const markerDigest=capture.prompt.match(/messageIndex=1; SHA-256=([a-f0-9]{64})/)?.[1];
  const query={taskId:stored.id,expectedVersion:current.version,section:'message',messageIndex:1,executionCapability:capability,...(markerDigest?{expectedDigest:markerDigest}:{})};
  const transport=async request=>{
   const response=await worker.fetch(new Request('https://inno.test/mcp',{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:request.input}),env);
   return {code:response.ok?0:22,stdout:await response.text(),stderr:''};
  };
  if(markerDigest){await assert.rejects(()=>callTool('read_task_context',{...query,expectedDigest:'0'.repeat(64)},{transport}),/digest mismatch/);capture.digestMismatchRejected=true;}
  const result=await callTool('read_task_context',query,{transport});
  capture.recovered=JSON.parse(result.content[0].text);
  if(markerDigest){
   assert.equal(capture.recovered.contentDigest,markerDigest);
   const changed={...current,messages:current.messages.map((message,index)=>index===1?{...message,content:message.content+' changed-without-version'}:message)};
   await DB.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify(changed),current.id).run();
   try{await assert.rejects(()=>callTool('read_task_context',query,{transport}),/digest mismatch/);capture.changedSourceRejected=true;}
   finally{await DB.prepare('UPDATE tasks SET body=?1 WHERE id=?2').bind(JSON.stringify(current),current.id).run();}
  }
  return Response.json({claude_code_session_id:'fake',claude_code_session_url:'https://example.test/session'});
 }});
 const response=await worker.fetch(new Request(`https://inno.test/api/tasks/${stored.id}/run`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({provider:'claude',expectedVersion:stored.version})}),env);
 assert.equal(response.status,202);return capture;
}
function selected(capture){
 assert.ok(capture.prompt.includes('Selected durable conversation'));
 assert.ok(!capture.prompt.includes(oldText));
 for(const retained of ['KEEP_REQUEST','KEEP_SYSTEM','KEEP_USER_CHANGE','KEEP_ASSISTANT_BEFORE_USER','KEEP_PENDING_USER','KEEP_PENDING_ASSISTANT','KEEP_CHECKPOINT'])assert.ok(capture.prompt.includes(retained),retained);
 assert.ok(capture.prompt.includes('Earlier draft prepared.'));
 assert.equal(capture.recovered.text,oldText);assert.equal(capture.digestMismatchRejected,true);
}

test('configured Codex and cloud Routine select the same referenced source while scoped reads recover its full original',async t=>{
 const task=await sourceTask(),local=await codex(task),remote=await cloud(t,task);selected(local);selected(remote);
 assert.equal(local.spawns,1);assert.equal(local.opens,1);assert.equal(remote.fires,1);assert.equal(remote.changedSourceRejected,true);
});

test('missing, stale and wrong-mode resume state retain full history on both configured adapters',async t=>{
 for(const variant of ['missing','stale','mode']){
  const task=await sourceTask();
  if(variant==='missing')delete task.checkpoint.resumeState;
  if(variant==='stale')task.checkpoint.resumeState.basis.requestDigest='0'.repeat(64);
  if(variant==='mode')task.checkpoint.resumeState.mode='child';
  for(const capture of [await codex(task),await cloud(t,task)]){assert.ok(capture.prompt.includes(oldText));assert.ok(!capture.prompt.includes('Selected durable conversation'));}
 }
});

test('unconfigured and evaluation Codex plus standalone Claude retain full history despite a matched state',async()=>{
 const task=await sourceTask();assert.ok((await codex(task,{configured:false})).prompt.includes(oldText));
 const evaluated=await codex(task,{evaluation:true});assert.ok(evaluated.prompt.includes(oldText));assert.equal(evaluated.opens,0);
 let prompt;await createClaudeRoutineRunner({url:'https://api.anthropic.com/v1/fire',token:'fake',fetchFn:async(_url,input)=>{prompt=JSON.parse(input.body).text;return Response.json({claude_code_session_id:'fake',claude_code_session_url:'https://example.test/session'});}}).run({task});
 assert.ok(prompt.includes(oldText));assert.ok(!prompt.includes('Selected durable conversation'));
});

test('selected execution cannot spawn if its actual snapshot reader fails to open',async()=>{
 await assert.rejects(()=>sourceTask().then(task=>codex(task,{failOpen:true})),error=>error.message==='reader unavailable'&&error.capture.spawns===0);
});

test('oversized required original instructions remain blocked rather than bootstrapped through readers',async t=>{
 const task=await sourceTask();task.prompt='가'.repeat(150000);
 task.checkpoint.resumeState.basis=(await createContextBasis(task,{messageCount:5})).basis;
 await assert.rejects(()=>codex(task),error=>error.code==='CONTEXT_RETRIEVAL_REQUIRED'&&error.capture.opens===0&&error.capture.spawns===0);
 const remote=await cloud(t,task);assert.equal(remote.fires,0);
});

test('local Codex reader guidance does not stop a selected run on a version-only conflict',async()=>{
 const capture=await codex(await sourceTask());selected(capture);
 assert.doesNotMatch(capture.prompt,/A version or digest mismatch invalidates selected context/);
 assert.match(capture.prompt,/digest mismatch invalidates selected context/);
});

test('an unavailable local snapshot falls back to complete full text without reader access',async()=>{
 const capture=await codex(await sourceTask(),{snapshotLimit:1000});
 assert.equal(capture.spawns,1);assert.equal(capture.recovered,undefined);
 assert.ok(capture.prompt.includes(oldText));assert.ok(!capture.prompt.includes('Selected durable conversation'));
 assert.doesNotMatch(capture.prompt,/read-local-context\.mjs/);
});

test('an unavailable local snapshot never spawns when full text exceeds the budget',async()=>{
 const big='BIG_OLD_ASSISTANT '+'z'.repeat(400000);
 const reader=await codex(await sourceTask(big));
 assert.equal(reader.spawns,1);assert.ok(reader.prompt.includes('Selected durable conversation'));assert.ok(!reader.prompt.includes(big));
 await assert.rejects(()=>sourceTask(big).then(task=>codex(task,{snapshotLimit:1000})),error=>error.code==='CONTEXT_RETRIEVAL_REQUIRED'&&error.capture.spawns===0);
});

test('required context over the soft budget but within the hard cap runs with complete text on both adapters',async t=>{
 const task=await sourceTask();task.prompt='OVER_BEGIN '+'y'.repeat(150000)+' OVER_END';
 task.checkpoint.resumeState.basis=(await createContextBasis(task,{messageCount:5})).basis;
 const local=await codex(task);assert.equal(local.spawns,1);assert.ok(local.prompt.includes(task.prompt));assert.ok(local.prompt.includes(oldText));
 const remote=await cloud(t,task);assert.equal(remote.fires,1);assert.ok(remote.prompt.includes('OVER_END'));assert.ok(remote.prompt.includes(oldText));
});

test('full history over the hard cap runs selected on both adapters when the selection fits the cap',async t=>{
 const big='BIG_OLD_BEGIN '+'w'.repeat(400000)+' BIG_OLD_END';
 const make=async()=>{
  const task=await sourceTask(big);
  task.messages[4]={...task.messages[4],content:'KEEP_USER_CHANGE '+'u'.repeat(150000)+' USER_TAIL_END'};
  task.checkpoint.resumeState.basis=(await createContextBasis(task,{messageCount:5})).basis;
  return task;
 };
 const local=await codex(await make());
 assert.equal(local.spawns,1);assert.ok(local.prompt.includes('USER_TAIL_END'));assert.ok(!local.prompt.includes('BIG_OLD_END'));
 assert.ok(local.recovered.text.startsWith('BIG_OLD_BEGIN'));
 const delivery=local.result.contextDelivery;
 assert.equal(delivery.readiness,'selected_ready');assert.ok(delivery.contextBytes>delivery.maxBytes&&delivery.contextBytes<=delivery.hardMaxBytes);
 const remote=await cloud(t,await make());
 assert.equal(remote.fires,1);assert.ok(remote.prompt.includes('USER_TAIL_END'));assert.ok(!remote.prompt.includes('BIG_OLD_END'));
 assert.ok(remote.recovered.text.startsWith('BIG_OLD_BEGIN'));
});

test('Codex results and failures carry the scoped re-reads the execution actually made',async()=>{
 const done=await codex(await sourceTask());
 // The fake process makes one rejected digest probe and one successful read.
 assert.equal(done.result.contextDelivery.retrievalRequests,2);
 assert.equal(done.result.contextDelivery.retrievalBytes,Buffer.byteLength(JSON.stringify(done.recovered)));
 await assert.rejects(()=>sourceTask().then(task=>codex(task,{failExit:true})),error=>error.contextDelivery?.retrievalRequests===2&&error.contextDelivery.retrievalBytes>0);
 const noReader=await codex(await sourceTask(),{configured:false});
 assert.equal(Object.hasOwn(noReader.result.contextDelivery,'retrievalRequests'),false);
 // A reader that cannot report usage leaves the result intact and the re-reads unmeasured.
 const unmeasured=await codex(await sourceTask(),{noUsage:true});
 assert.equal(unmeasured.result.content,'Done');assert.equal(Object.hasOwn(unmeasured.result.contextDelivery,'retrievalRequests'),false);
 await assert.rejects(()=>sourceTask().then(task=>codex(task,{failExit:true,noUsage:true})),error=>!/usage/.test(error.message)&&error.contextDelivery?.readiness==='selected_ready');
});

test('Codex results and context refusals carry the delivered context outcome in bytes',async()=>{
 const sel=await codex(await sourceTask());const d=sel.result.contextDelivery;
 assert.equal(d.provider,'codex');assert.equal(d.readiness,'selected_ready');assert.equal(d.reader,true);assert.ok(d.omittedMessages>=1);
 assert.equal(d.promptBytes,Buffer.byteLength(sel.prompt));assert.equal(d.materialBytes,0);assert.equal(d.inputTokens,null);
 const fallback=await codex(await sourceTask(),{snapshotLimit:1000});
 assert.equal(fallback.result.contextDelivery.readiness,'full_ready');assert.equal(fallback.result.contextDelivery.reader,false);
 const over=await sourceTask();over.prompt='y'.repeat(150000);over.checkpoint.resumeState.basis=(await createContextBasis(over,{messageCount:5})).basis;
 assert.equal((await codex(over)).result.contextDelivery.readiness,'full_over_budget');
 const big=await sourceTask();big.prompt='가'.repeat(150000);big.checkpoint.resumeState.basis=(await createContextBasis(big,{messageCount:5})).basis;
 await assert.rejects(()=>codex(big),error=>error.code==='CONTEXT_RETRIEVAL_REQUIRED'&&error.contextDelivery?.readiness==='blocked'&&error.contextDelivery.promptBytes===null);
});
