import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import worker from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {createCodexRunner} from '../server/runners.mjs';
import {fireRoutine} from '../worker/claude-routine.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {projectInstructionsBlock} from '../public/core/projects.mjs';

// CR-008 Unit 2: a project's instructions reach every execution of its tasks, through the
// desktop claim (Codex on this PC) and the Routine prompt (Claude); a child uses its parent's
// project. A task without project instructions gets exactly the prompt it had before.
const token='test-project-instr-0123456789012345';
const project={id:'p1',name:'논문',instructions:'모든 결과는 한국어 보고서로 작성한다.',version:1};
function fakeSpawn(capture){
 return ()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.stdin.on('data',chunk=>{capture.text=(capture.text??'')+chunk;});
  child.stdin.on('finish',()=>{child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Done'}})+'\n');child.stdout.end();child.emit('close',0,null);});
  return child;
 };
}
const task={id:'t1',type:'general',title:'Prompt case',prompt:'Write the summary',messages:[],plan:[]};

test('the block appears only when the project has instructions',()=>{
 assert.equal(projectInstructionsBlock(null),'');
 assert.equal(projectInstructionsBlock({...project,instructions:'  '}),'');
 const block=projectInstructionsBlock(project);
 assert.match(block,/"논문"/);assert.match(block,/한국어 보고서/);assert.match(block,/takes precedence/);
});

test('the Codex prompt carries the project block, and is unchanged without one',async()=>{
 const run=async extra=>{const capture={};await createCodexRunner({spawnProcess:fakeSpawn(capture),ensureDirectory:()=>{},runDirectory:()=>process.cwd(),modelCatalog:async()=>[]}).run({task,...extra});return capture.text;};
 const plain=await run({}),withProject=await run({project});
 assert.doesNotMatch(plain,/Project "/);
 assert.match(withProject,/Project "논문" instructions/);
 assert.equal(withProject.replace(projectInstructionsBlock(project)+'\n',''),plain);
});

test('the Claude Routine prompt carries the project block before the request',async()=>{
 let text;
 const fetchFn=async(_url,options)=>{text=JSON.parse(options.body).text;return {ok:true,json:async()=>({claude_code_session_id:'s',claude_code_session_url:'https://claude.ai/code/s'}),headers:new Headers()};};
 const env={CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/claude_code/routines/r/fire',CLAUDE_ROUTINE_TOKEN:'x',ACCESS_TOKEN:token};
 await fireRoutine(fetchFn,env,task,[],{executionId:'e',generation:1},undefined,{models:[]},0,{offered:[],skipped:[]},[],project);
 assert.ok(text.indexOf('Project "논문" instructions')>=0&&text.indexOf('Project "논문" instructions')<text.indexOf('Request: '),text.slice(0,200));
 await fireRoutine(fetchFn,env,task,[],{executionId:'e',generation:1},undefined,{models:[]},0);
 assert.doesNotMatch(text,/Project "/);
});

test('the desktop claim carries the project, a child gets its parent project, and a deleted one gives none',async t=>{
 const db=new TestD1();t.after(()=>db.close());const env={DB:db,ACCESS_TOKEN:token},store=new D1TaskStore(db);
 const call=async(path,body)=>(await worker.fetch(new Request('https://inno.test'+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env)).json();
 const p=(await call('/api/projects',{name:'논문',instructions:'한국어로'})).project;
 const created=(await call('/api/tasks',{prompt:'Work',projectId:p.id})).task;
 await call(`/api/tasks/${created.id}/run`,{provider:'codex',expectedVersion:created.version});
 const {claim}=await call('/api/desktop/poll',{});
 assert.equal(claim.task.id,created.id);assert.deepEqual(claim.project,{id:p.id,name:'논문',instructions:'한국어로'});
 let child=await store.createTask({prompt:'child'});
 child=await store.replaceTask(child.id,child.version,current=>({...current,version:current.version+1,parentTaskId:created.id}));
 assert.equal((await store.projectForTask(child))?.id,p.id);
 await call(`/api/projects/${p.id}`,{action:'delete',expectedVersion:1});
 assert.equal(await store.projectForTask(await store.requireTask(created.id)),null);
});

test('the connector hands the claim project to the runner',async()=>{
 let seen;
 const request=async route=>route.endsWith('poll')?{claim:{task:{id:'t'},executionId:'e',generation:1,project}}:{task:{status:'completed'}};
 const bridge=createDesktopBridge({request,outbox:{read:()=>null,write:()=>{},clear:()=>{}},runner:{run:async input=>{seen=input;return {content:'ok'};}}});
 await bridge.tick();
 assert.deepEqual(seen.project,project);
});

test('the desktop page reaches project and provider settings routes through the connector',async t=>{
 const seen=[];
 const server=createDesktopServer({token,publicDir:new URL('../public',import.meta.url),request:async(path,body)=>{seen.push([path,body]);return {ok:true};},bridge:{status:()=>({})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 for(const path of ['/api/projects','/api/projects/p1','/api/providers/settings']){
  assert.equal((await fetch(base+path,{method:'POST',body:'{}'})).status,401,path);
  const response=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({name:'x'})});
  assert.equal(response.status,200,path);
 }
 assert.deepEqual(seen.map(([path])=>path),['/api/projects','/api/projects/p1','/api/providers/settings']);
});
