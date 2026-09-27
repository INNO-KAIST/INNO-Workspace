import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {SourceExecutionCoordinator} from '../public/source-execution.mjs';
import {executionCapability} from '../worker/execution-scope.mjs';

const secret='test-secret-01234567890123456789';
const originals=[
  {id:'alpha',name:'alpha.txt',source:'file'},
  {id:'beta',name:'beta.txt',source:'file'},
];
const assignments=[
  {role:'alpha analyst',provider:'codex',requestedModel:'gpt-5.6-luna',effort:'low',sufficientReason:'bounded source check',acceptanceCriteria:['alpha checked'],instructions:'Analyze alpha only',sourceIds:['alpha']},
  {role:'beta analyst',provider:'claude',requestedModel:'haiku',effort:'low',sufficientReason:'bounded source check',acceptanceCriteria:['beta checked'],instructions:'Analyze beta only',sourceIds:['beta']},
];
const models=[{model:'gpt-5.6-luna',efforts:['low'],isDefault:false}];
const owner=claim=>({executionId:claim.executionId,generation:claim.generation});

async function fixture(t){
  const db=new TestD1();
  // TestD1 is synchronous SQLite behind async methods. Serialize its batches so
  // concurrent requests exercise the same atomic CAS contract as D1.
  const batch=db.batch.bind(db);let tail=Promise.resolve();
  db.batch=statements=>{const current=tail.then(()=>batch(statements));tail=current.catch(()=>{});return current;};
  const calls=[];
  const worker=createWorker({sourceDelegationVersion:1,fetchFn:async(_url,options)=>{
    calls.push(JSON.parse(options.body).text);
    return Response.json({claude_code_session_id:'session',claude_code_session_url:'https://claude.ai/code/session'});
  }});
  const env={DB:db,ACCESS_TOKEN:secret,CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'mock'};
  const server=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const request=new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
      const response=await worker.fetch(request,env);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){res.writeHead(500);res.end(String(error));}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,input)=>{const response=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(input)});return {status:response.status,...await response.json()};};
  const get=async path=>{const response=await fetch(base+path,{headers:{authorization:`Bearer ${secret}`}});assert.equal(response.status,200);return response.json();};
  const mcp=async(name,args)=>post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',executionCapability:await executionCapability(secret,{task:{id:args.taskId},...owner(args)}),params:{name,arguments:args}});
  return {db,store:new D1TaskStore(db),worker,env,post,get,mcp,calls};
}

async function allocated(f){
  const created=await f.post('/api/tasks',{prompt:'Compare the original alpha and beta evidence',attachments:originals});
  assert.equal(created.status,201);
  const parent=created.task;
  const start=await f.post(`/api/desktop/${parent.id}/start`,{expectedVersion:parent.version,sourceNames:['alpha.txt','beta.txt'],models});
  assert.equal(start.status,200);
  const result=await f.post(`/api/desktop/${parent.id}/complete`,{...owner(start.claim),content:'Two independent source checks',delegation:{independent:true,children:assignments}});
  assert.equal(result.status,200);
  return {parent,result,children:await Promise.all(result.task.delegation.children.map(c=>f.store.requireTask(c.taskId)))};
}

test('loopback HTTP runs disjoint source children and requires both originals for generated-artifact review',async t=>{
  const f=await fixture(t),batch=await allocated(f);
  const [codex,claude]=batch.children;
  assert.deepEqual(codex.attachments.map(a=>a.id),['alpha']);
  assert.deepEqual(claude.attachments.map(a=>a.id),['beta']);
  const codexClaim=await f.post(`/api/desktop/${codex.id}/start`,{expectedVersion:codex.version,sourceDelegationVersion:1,sourceNames:['alpha.txt']});
  assert.equal(codexClaim.status,200);
  const codexDone=await f.post(`/api/desktop/${codex.id}/complete`,{...owner(codexClaim.claim),content:'Alpha finding',artifacts:[{name:'alpha-result.txt',mime:'text/plain',encoding:'utf-8',content:'Generated alpha finding'}]});
  assert.equal(codexDone.status,200);
  const claudeStart=await f.post(`/api/tasks/${claude.id}/run`,{provider:'claude',expectedVersion:claude.version,materials:[{name:'beta.txt',text:'PRIVATE_BETA_ORIGINAL'}]});
  assert.equal(claudeStart.status,202);
  assert.equal(f.calls.length,1);
  assert.match(f.calls[0],/PRIVATE_BETA_ORIGINAL/);
  assert.doesNotMatch(f.calls[0],/PRIVATE_ALPHA_ORIGINAL/);
  const remote=await f.store.requireTask(claude.id);
  const completedChild=await f.mcp('checkpoint_task',{taskId:claude.id,...owner(remote.checkpoint),content:'Generated beta finding',status:'completed'});
  assert.equal(completedChild.result.isError,undefined);
  const parent=await f.store.requireTask(batch.parent.id);
  assert.equal(parent.status,'queued_for_review');
  const missing=await f.post(`/api/desktop/${parent.id}/start`,{expectedVersion:parent.version,sourceDelegationVersion:1,sourceNames:['alpha.txt']});
  assert.equal(missing.status,400);
  const review=await f.post(`/api/desktop/${parent.id}/start`,{expectedVersion:parent.version,sourceDelegationVersion:1,sourceNames:['alpha.txt','beta.txt']});
  assert.equal(review.status,200);
  assert.deepEqual(review.claim.reviewInputs.map(c=>c.artifacts[0].content),['Generated alpha finding','Generated beta finding']);
  const report=parent.delegation.children.map((c,i)=>({childTaskId:c.taskId,criteria:[{criterion:i?'beta checked':'alpha checked',status:'pass',evidence:'Checked against original'}]}));
  const completed=await f.post(`/api/desktop/${parent.id}/complete`,{...owner(review.claim),content:'Both source findings verified',reviewReport:report});
  assert.equal(completed.status,200);
  assert.equal(completed.task.status,'completed');
  assert.equal(JSON.stringify(await f.store.getState()).includes('PRIVATE_BETA_ORIGINAL'),false);
});

test('Claude MCP artifact registration reaches parent review and completion replay keeps one copy',async t=>{
  const f=await fixture(t),batch=await allocated(f);
  const [codex,claude]=batch.children;
  const codexClaim=await f.store.claimExecution(codex.id,{provider:'codex',expectedVersion:codex.version});
  await f.store.finishExecution(codex.id,{...owner(codexClaim),content:'Alpha result'});
  const claudeClaim=await f.store.claimExecution(claude.id,{provider:'claude',expectedVersion:claude.version,sourceBound:true});
  const file={taskId:claude.id,...owner(claudeClaim),artifact:{name:'beta-result.txt',mime:'text/plain',content:'Beta lifetime: 8.4 ms'}};
  const registered=await f.mcp('artifact_task',file);
  assert.equal(registered.result.isError,undefined);
  const registrationReplay=await f.mcp('artifact_task',file);
  assert.equal(registrationReplay.result.isError,undefined);
  const completion={taskId:claude.id,...owner(claudeClaim),content:'Beta lifetime: 8.4 ms',status:'completed'};
  const first=await f.mcp('checkpoint_task',completion);
  assert.equal(first.result.isError,undefined);
  const repeated=await f.mcp('checkpoint_task',completion);
  assert.equal(repeated.result.isError,undefined);
  const child=await f.store.requireTask(claude.id);
  assert.deepEqual(child.artifacts.map(a=>a.name),['beta-result.txt','final.md']);
  assert.deepEqual(child.checkpoint.resultArtifactIds,child.artifacts.map(a=>a.id));
  const parent=await f.store.requireTask(batch.parent.id);
  assert.equal(parent.status,'queued_for_review');
  assert.deepEqual(parent.delegation.review.children.find(c=>c.taskId===claude.id).artifacts.map(a=>a.name),['beta-result.txt','final.md']);
  const review=await f.post(`/api/desktop/${parent.id}/start`,{expectedVersion:parent.version,sourceDelegationVersion:1,sourceNames:['alpha.txt','beta.txt']});
  assert.equal(review.status,200);
  assert.deepEqual(review.claim.reviewInputs.find(c=>c.taskId===claude.id).artifacts.map(a=>a.name),['beta-result.txt','final.md']);
});

test('MCP completion excludes artifacts registered by an earlier execution owner',async t=>{
  const f=await fixture(t),task=await f.store.createTask({prompt:'Generate a current result'});
  const old=await f.store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
  assert.equal((await f.mcp('artifact_task',{taskId:task.id,...owner(old),artifact:{name:'stale.txt',mime:'text/plain',content:'old result'}})).result.isError,undefined);
  const failed=await f.store.failExecution(task.id,{...owner(old),failure:{kind:'unknown'}});
  const current=await f.store.claimExecution(task.id,{provider:'codex',expectedVersion:failed.version});
  assert.equal((await f.mcp('artifact_task',{taskId:task.id,...owner(old),artifact:{name:'late.txt',mime:'text/plain',content:'stale callback'}})).status,409);
  assert.equal((await f.mcp('artifact_task',{taskId:task.id,...owner(current),artifact:{name:'current.txt',mime:'text/plain',content:'new result'}})).result.isError,undefined);
  assert.equal((await f.mcp('checkpoint_task',{taskId:task.id,...owner(current),content:'current complete',status:'completed'})).result.isError,undefined);
  const done=await f.store.requireTask(task.id);
  assert.deepEqual(done.artifacts.map(a=>a.name),['stale.txt','current.txt','final.md']);
  assert.deepEqual(done.checkpoint.resultArtifactIds,done.artifacts.slice(1).map(a=>a.id));
});

test('concurrent same-version source claims fire Claude once and stale request replay cannot refire',async t=>{
  const f=await fixture(t),{children}=await allocated(f),claude=children[1];
  const batch=f.db.batch.bind(f.db);let arrivals=0;const versions=[];let release;
  const bothReady=new Promise(resolve=>{release=resolve;});
  const timeout=setTimeout(release,2000);t.after(()=>clearTimeout(timeout));
  f.db.batch=async statements=>{
    const first=statements[0];
    if(first.sql.startsWith('UPDATE tasks SET version')&&first.values[3]===claude.id&&arrivals<2){
      arrivals++;versions.push(first.values[4]);
      if(arrivals===2)release();
      await bothReady;
    }
    return batch(statements);
  };
  const input={provider:'claude',expectedVersion:claude.version,materials:[{name:'beta.txt',text:'PRIVATE_BETA_ORIGINAL'}]};
  const responses=await Promise.all([f.post(`/api/tasks/${claude.id}/run`,input),f.post(`/api/tasks/${claude.id}/run`,input)]);
  assert.equal(arrivals,2);
  assert.deepEqual(versions,[claude.version,claude.version]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[202,409]);
  assert.equal((await f.post(`/api/tasks/${claude.id}/run`,input)).status,409);
  assert.equal(f.calls.length,1);
  assert.equal((await f.store.requireTask(claude.id)).checkpoint.generation,1);
});

test('parent pause fences an active source child and recovery preserves a completed sibling',async t=>{
  const f=await fixture(t),batch=await allocated(f),[codex,claude]=batch.children;
  const first=await f.post(`/api/desktop/${codex.id}/start`,{expectedVersion:codex.version,sourceDelegationVersion:1,sourceNames:['alpha.txt']});
  assert.equal(first.status,200);
  const sibling=await f.store.claimExecution(claude.id,{provider:'claude',expectedVersion:claude.version,sourceBound:true});
  await f.store.finishExecution(claude.id,{...owner(sibling),content:'Completed beta'});
  let parent=await f.store.requireTask(batch.parent.id);
  const paused=await f.post(`/api/tasks/${parent.id}/actions`,{action:'pause',expectedVersion:parent.version});
  assert.equal(paused.status,200);
  assert.equal((await f.post(`/api/desktop/${codex.id}/complete`,{...owner(first.claim),content:'Late alpha'})).status,409);
  assert.equal((await f.store.requireTask(claude.id)).status,'completed');
  const resumed=await f.post(`/api/tasks/${parent.id}/delegation/resume`,{expectedVersion:paused.task.version});
  assert.equal(resumed.status,200);
  parent=await f.store.requireTask(parent.id);
  assert.ok(parent.delegation.epoch>batch.result.task.delegation.epoch);
  assert.equal((await f.store.requireTask(claude.id)).status,'completed');
  assert.equal((await f.store.requireTask(codex.id)).checkpoint.confirmationRequired.reason,'parent_pause');
});

test('lost source start response survives coordinator recreation until explicit recovery',async t=>{
  const f=await fixture(t),batch=await allocated(f),[codex,claude]=batch.children;
  const codexClaim=await f.post(`/api/desktop/${codex.id}/start`,{expectedVersion:codex.version,sourceDelegationVersion:1,sourceNames:['alpha.txt']});
  assert.equal((await f.post(`/api/desktop/${codex.id}/complete`,{...owner(codexClaim.claim),content:'Completed alpha'})).status,200);
  const completedSibling=await f.store.requireTask(codex.id);
  const saved=new Map(),storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  const client={baseUrl:'loopback-test',token:secret,state:null,refresh:async()=>{client.state=await f.get('/api/state');},run:async(id,input)=>{
    const started=await f.post(`/api/tasks/${id}/run`,input);
    assert.equal(started.status,202);
    throw Error('start acknowledgment lost');
  }};
  const services={getClient:()=>client,attemptStorage:storage,attemptLocks:{request:async(_key,fn)=>fn()},connected:()=>true,getFile:async()=>({}),extractText:async()=>({status:'available',text:'PRIVATE_BETA_ORIGINAL'})};
  assert.equal((await new SourceExecutionCoordinator(services).tick()).status,'uncertain');
  assert.equal(f.calls.length,1);
  const restarted=new SourceExecutionCoordinator(services);
  assert.equal((await restarted.tick()).status,'waiting');
  assert.equal(f.calls.length,1);
  assert.equal(JSON.stringify([...saved.values()]).includes('PRIVATE_BETA_ORIGINAL'),false);
  const active=await f.store.requireTask(claude.id);
  await f.store.markExecutionUncertain(claude.id,{...owner(active.checkpoint),reason:'uncertain_fire'});
  const blocked=await f.store.requireTask(claude.id);
  const recovery={expectedVersion:batch.result.task.version,childTaskId:claude.id,expectedChildVersion:blocked.version};
  assert.equal((await f.post(`/api/tasks/${batch.parent.id}/delegation/recover`,recovery)).status,400);
  const recovered=await f.post(`/api/tasks/${batch.parent.id}/delegation/recover`,{...recovery,confirmedStopped:true});
  assert.equal(recovered.status,200);
  assert.deepEqual(await f.store.requireTask(codex.id),completedSibling);
  assert.equal((await restarted.recover(claude.id)).status,'recovered');
  assert.equal((await restarted.tick()).status,'uncertain');
  assert.equal(f.calls.length,2);
  assert.equal((await f.store.requireTask(claude.id)).parentEpoch,recovered.task.delegation.epoch);
});
