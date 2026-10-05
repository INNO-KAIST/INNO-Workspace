import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createContextAccess,checkedContextUrl} from '../server/context-access.mjs';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {createCodexRunner} from '../server/runners.mjs';
import {createContextBasis,verifyResumeState} from '../public/core/context-resume.mjs';
const adminToken='admin-token-01234567890123456789';
const task=()=>({id:'task',version:4,prompt:'Complete the task',messages:[{role:'user',content:'Keep old decision'}],attachments:[{id:'file',name:'paper.txt',path:'paper.txt',size:1,lastModified:1,source:'file',text:'PRIVATE_ATTACHMENT'}],artifacts:[{content:'PRIVATE_ARTIFACT'}],materials:[{text:'PRIVATE_MATERIAL'}]});
const input={taskId:'task',expectedVersion:4,section:'manifest'};
async function serverFor(t,registry){let cloudCalls=0;const server=createDesktopServer({token:adminToken,contextAccess:registry,publicDir:new URL('../public',import.meta.url),request:async()=>{cloudCalls++;return {};},bridge:{status:()=>({busy:false})}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{registry.close();await new Promise(r=>server.close(r));});return {url:`http://127.0.0.1:${server.address().port}/api/desktop/context`,cloudCalls:()=>cloudCalls};}
async function helper(url,token,payload){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/read-local-context.mjs',import.meta.url))],{env:{...process.env,INNO_CONTEXT_URL:url,INNO_CONTEXT_TOKEN:token},stdio:['pipe','pipe','pipe'],windowsHide:true});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));child.stdin.end(typeof payload==='string'?payload:JSON.stringify(payload));});}
const post=(token,data)=>({method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)});

test('real helper subprocess reads scoped history and basis from the existing loopback server',async t=>{
  const registry=createContextAccess(),current=task(),access=registry.open(current),f=await serverFor(t,registry);
  const actual=await helper(f.url,access.token,{...input,section:'message',messageIndex:0});
  assert.equal(actual.code,0);assert.equal(JSON.parse(actual.stdout).text,'Keep old decision');assert.equal(actual.stderr,'');
  const basis=await helper(f.url,access.token,{...input,section:'basis'});
  assert.deepEqual(JSON.parse(basis.stdout).basis,(await createContextBasis(current)).basis);
  current.messages[0].content='changed';current.attachments[0].text='OTHER_PRIVATE';
  assert.equal((await registry.read(access.token,{...input,section:'message',messageIndex:0})).text,'Keep old decision');
  const resumed=await helper(f.url,access.token,{...input,section:'resume'});assert.equal(JSON.parse(resumed.stdout).status,'missing');
  assert.doesNotMatch(actual.stdout+basis.stdout+resumed.stdout,/PRIVATE_ATTACHMENT|PRIVATE_ARTIFACT|PRIVATE_MATERIAL/);assert.equal(f.cloudCalls(),0);
});

test('context capability cannot reach admin routes, other tasks, queries or extra selectors',async t=>{
  const registry=createContextAccess(),access=registry.open(task()),f=await serverFor(t,registry);
  assert.equal((await fetch(f.url,post(adminToken,input))).status,401);
  assert.equal((await fetch(f.url.replace('/desktop/context','/state'),{headers:{authorization:'Bearer '+access.token}})).status,401);
  assert.equal((await fetch(f.url,post(access.token,{...input,taskId:'other'}))).status,409);
  assert.equal((await fetch(f.url+'?path=secret',post(access.token,input))).status,400);
  assert.equal((await fetch(f.url,post(access.token,{...input,path:'../secret'}))).status,400);
  assert.equal((await fetch(f.url,{...post(access.token,input),headers:{...post(access.token,input).headers,origin:'https://evil.test'}})).status,403);
  assert.equal((await fetch(f.url,post(access.token,{...input,extra:'x'.repeat(4096)}))).status,413);
  assert.equal(f.cloudCalls(),0);
});

test('single active snapshot, inflight reads, budgets and late revocation fail explicitly',async()=>{
  const registry=createContextAccess({maxTotalBytes:1000,maxRequests:2}),controller=new AbortController(),access=registry.open(task(),controller.signal);
  assert.throws(()=>registry.open(task()),e=>e.statusCode===409);
  const pending=registry.read(access.token,{...input,section:'request'});
  await assert.rejects(()=>registry.read(access.token,input),e=>e.statusCode===429);
  controller.abort();await assert.rejects(()=>pending,e=>e.statusCode===401);
  await assert.rejects(()=>registry.read(access.token,input),e=>e.statusCode===401);
  const second=registry.open(task());await registry.read(second.token,{...input,section:'request'});await registry.read(second.token,{...input,section:'request'});
  await assert.rejects(()=>registry.read(second.token,input),e=>e.statusCode===429);registry.close();
  const small=createContextAccess({maxTotalBytes:10}),cap=small.open(task());await assert.rejects(()=>small.read(cap.token,input),e=>e.statusCode===429);small.close();
  assert.throws(()=>createContextAccess({maxSnapshotBytes:10}).open(task()),e=>e.statusCode===413);
  const responseLimited=createContextAccess({maxResponseBytes:10}),limited=responseLimited.open(task());await assert.rejects(()=>responseLimited.read(limited.token,input),e=>e.statusCode===413);responseLimited.close();
  const aborted=new AbortController(),lateRegistry=createContextAccess(),lateCap=lateRegistry.open(task(),aborted.signal),late=lateRegistry.read(lateCap.token,{...input,expectedVersion:0});aborted.abort();await assert.rejects(()=>late,e=>e.statusCode===401);lateRegistry.close();
  assert.equal(checkedContextUrl('http://127.0.0.1:80/api/desktop/context'),'http://127.0.0.1:80/api/desktop/context');
  assert.throws(()=>checkedContextUrl('http://127.0.0.1:65536/api/desktop/context')); 
});

test('a lease reports read attempts and returned bytes, and keeps them after revocation',async()=>{
  const registry=createContextAccess(),access=registry.open(task());
  assert.deepEqual(access.usage(),{requests:0,bytes:0});
  const first=await registry.read(access.token,{...input,section:'request'});
  await assert.rejects(()=>registry.read(access.token,{...input,expectedVersion:3}));
  const usage=access.usage();
  assert.deepEqual(usage,{requests:2,bytes:Buffer.byteLength(JSON.stringify(first))});
  access.revoke();assert.deepEqual(access.usage(),usage);registry.close();
});

test('helper rejects foreign URL, credentials and query without exposing token',async()=>{
  const secret='NEVER_PRINT_THIS_TOKEN';
  for(const url of ['https://example.com/api/desktop/context','http://user:pass@127.0.0.1:4175/api/desktop/context','http://127.0.0.1:4175/api/desktop/context?q=x','http://127.0.0.1:4175/api/desktop/context#x','http://127.0.0.1:4175/other']) {
    const result=await helper(url,secret,input);assert.notEqual(result.code,0);assert.ok(result.stdout);assert.equal(result.stderr,'');assert.ok(!result.stdout.includes(secret));
  }
});

function fakeChild(capture,value={summary:'done'}){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;child.stdin.on('data',b=>capture.prompt=(capture.prompt??'')+b);child.stdin.on('finish',()=>{child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}})+'\n');child.stdout.end();child.emit('close',0,null);});return child;}
test('runner exposes helper only when configured, strips inherited credentials and revokes even on thrown spawn',async t=>{
  const registry=createContextAccess(),f=await serverFor(t,registry),current={...task(),attachments:[]},tokens=[];
  const access={open:(...args)=>{const cap=registry.open(...args);tokens.push(cap.token);return cap;}};
  const common={ensureDirectory:()=>{},runDirectory:()=>process.cwd(),managedDelivery:true,processEnv:{...process.env,INNO_CONTEXT_TOKEN:'INHERITED',INNO_CONTEXT_URL:'http://127.0.0.1:9999/api/desktop/context'}};
  const capture={};const runner=createCodexRunner({...common,contextAccess:access,contextUrl:f.url,spawnProcess:(_cmd,args,options)=>{capture.env=options.env;capture.args=args;return fakeChild(capture);}});
  await runner.run({task:current,executionId:'exec',generation:1});assert.match(capture.prompt,/read-local-context\.mjs/);assert.doesNotMatch(capture.prompt,/INHERITED/);assert.equal(capture.env.INNO_CONTEXT_TOKEN,tokens[0]);assert.ok(!JSON.stringify(capture.args).includes(tokens[0]));
  await assert.rejects(()=>registry.read(tokens[0],input),e=>e.statusCode===401);
  const failed=createCodexRunner({...common,contextAccess:access,contextUrl:f.url,spawnProcess:()=>{throw Error('spawn unavailable');}});
  await assert.rejects(()=>failed.run({task:current,executionId:'exec',generation:1}),/spawn unavailable/);await assert.rejects(()=>registry.read(tokens[1],input),e=>e.statusCode===401);
  const plain={};await createCodexRunner({...common,spawnProcess:(_cmd,_args,options)=>{plain.env=options.env;return fakeChild(plain);}}).run({task:current});
  assert.equal(plain.env.INNO_CONTEXT_TOKEN,undefined);assert.equal(plain.env.INNO_CONTEXT_URL,undefined);assert.doesNotMatch(plain.prompt,/read-local-context\.mjs/);
});

test('actual helper refuses redirects and oversized requests or responses',async t=>{
  let count=0,mode='redirect';const secret='a'.repeat(43);
  const server=createServer((req,res)=>{count++;if(mode==='redirect'){res.writeHead(302,{location:'/forbidden'});res.end();}else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({text:'x'.repeat(128*1024)}));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}/api/desktop/context`;
  const redirected=await helper(url,secret,input);assert.notEqual(redirected.code,0);assert.equal(count,1);assert.ok(!redirected.stdout.includes(secret));
  const oversized=await helper(url,secret,'x'.repeat(4097));assert.notEqual(oversized.code,0);assert.equal(count,1);
  mode='oversize';const response=await helper(url,secret,input);assert.notEqual(response.code,0);assert.ok(response.stdout.length<200);assert.equal(count,2);
});

test('configured runner environment reaches helper and returns source-matched state in the normal result',async t=>{
  const registry=createContextAccess(),f=await serverFor(t,registry),current={...task(),attachments:[]};let helpers=0;
  const runner=createCodexRunner({managedDelivery:true,contextAccess:registry,contextUrl:f.url,ensureDirectory:()=>{},runDirectory:()=>process.cwd(),spawnProcess:(_command,_args,options)=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;child.stdin.resume();
    child.stdin.on('finish',()=>{(async()=>{
      const answer=await helper(options.env.INNO_CONTEXT_URL,options.env.INNO_CONTEXT_TOKEN,{...input,section:'basis'});helpers++;assert.equal(answer.code,0);
      const basis=JSON.parse(answer.stdout),resumeState={version:1,taskId:basis.taskId,mode:basis.mode,basis:basis.basis,items:[{kind:'goal',text:'Complete the task',references:[{section:'request',digest:basis.basis.requestDigest}]}]};
      child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'done',resumeState})}})+'\n');child.stdout.end();child.emit('close',0,null);
    })().catch(()=>{child.stderr.write('local helper failed');child.emit('close',1,null);});});return child;
  }});
  const result=await runner.run({task:current,executionId:'exec',generation:1});assert.equal(helpers,1);assert.equal((await verifyResumeState(current,result.resumeState)).status,'source_matched');
});

test('evaluation and oversized context never allocate local access or bypass the context guard',async t=>{
  const capture={},binding={jobId:'job',phase:'candidate',maxDurationMs:100,provider:'codex'},current={...task(),attachments:[],status:'running',evaluationBudget:binding,checkpoint:{provider:'codex',executionId:'exec',generation:1,claimedAt:new Date(1000).toISOString(),evaluationBudget:{...binding,deadlineAtMs:1100}}};
  const runner=createCodexRunner({managedDelivery:true,contextAccess:{open:()=>assert.fail('evaluation context forbidden')},contextUrl:'http://127.0.0.1:4175/api/desktop/context',ensureDirectory:()=>{},runDirectory:()=>process.cwd(),now:()=>1010,monotonicNow:()=>0,processEnv:{...process.env,INNO_CONTEXT_TOKEN:'OLD',INNO_CONTEXT_URL:'OLD',INNO_CONTEXT_OTHER:'OLD'},spawnProcess:(_c,_a,options)=>{capture.env=options.env;return fakeChild(capture);}});
  await runner.run({task:current,executionId:'exec',generation:1,executionBudgetVersion:1});assert.ok(Object.keys(capture.env).every(key=>!key.toUpperCase().startsWith('INNO_CONTEXT_')));assert.doesNotMatch(capture.prompt,/read-local-context\.mjs/);
  const registry=createContextAccess(),f=await serverFor(t,registry);let opens=0;
  const oversized=createCodexRunner({managedDelivery:true,contextAccess:{open:(...args)=>{opens++;return registry.open(...args);}},contextUrl:f.url,ensureDirectory:()=>{},runDirectory:()=>process.cwd(),spawnProcess:()=>assert.fail('oversized AI spawn forbidden')});
  for(const tooLarge of [{...task(),attachments:[],prompt:'x'.repeat(400000)},{...task(),attachments:[],messages:Array.from({length:42},(_,index)=>({role:'user',content:index+':'+ 'x'.repeat(100000)}))}])
    await assert.rejects(()=>oversized.run({task:tooLarge,executionId:'exec',generation:1}),e=>e.code==='CONTEXT_RETRIEVAL_REQUIRED');
  assert.equal(opens,0);
});
