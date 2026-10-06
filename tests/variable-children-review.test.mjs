import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCodexRunner} from '../server/runners.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {executionCapability} from '../worker/execution-scope.mjs';
import {TestD1} from './helpers/d1.mjs';

// H7-2: review, recovery and initial policies follow the frozen child count (2 to 4).
const models=[{model:'gpt-5.6-luna',efforts:['low'],isDefault:false}];
const observed=()=>({models,observedAt:Date.now(),status:'fresh'});
const assign=(provider,role)=>({role,provider,requestedModel:provider==='codex'?'gpt-5.6-luna':'haiku',effort:'low',sufficientReason:'bounded exact arithmetic',acceptanceCriteria:['equals 4'],instructions:'Return 2+2'});
const owner=c=>({executionId:c.executionId,generation:c.generation});
async function http(t){
 const db=new TestD1();t.after(()=>db.close());let fires=0;
 const worker=createWorker({fetchFn:async()=>{fires++;return Response.json({claude_code_session_id:'s'+fires,claude_code_session_url:'https://claude.ai/code/s'+fires});}});
 const env={DB:db,ACCESS_TOKEN:'test-variable-children-0123456789012345',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'mock'};
 const post=async(p,input)=>{const r=await worker.fetch(new Request('https://inno.example'+p,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify(input)}),env);return {status:r.status,...await r.json()};};
 const mcp=async(name,args)=>post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',executionCapability:await executionCapability(env.ACCESS_TOKEN,{task:{id:args.taskId},executionId:args.executionId,generation:args.generation}),params:{name,arguments:args}});
 return {db,store:new D1TaskStore(db),post,mcp,fires:()=>fires};
}
const passing=parent=>parent.delegation.children.map(c=>({childTaskId:c.taskId,criteria:[{criterion:'equals 4',status:'pass',evidence:'Recomputed 2+2=4'}]}));
async function codexMaster(f,prompt){
 await f.post('/api/desktop/poll',{models:observed()});
 const {task}=await f.post('/api/tasks',{prompt});
 await f.post(`/api/tasks/${task.id}/run`,{provider:'codex',expectedVersion:1});
 return {task,master:(await f.post('/api/desktop/poll',{})).claim};
}

test('a Codex master with three children reviews all three inputs once',async t=>{
 const f=await http(t),{task,master}=await codexMaster(f,'Three independent calculations');
 const children=[assign('codex','first check'),assign('codex','second check'),assign('claude','third check')];
 assert.equal((await f.post(`/api/desktop/${task.id}/complete`,{...owner(master),content:'Three roles',delegation:{independent:true,children}})).status,200);
 const parent=await f.store.requireTask(task.id);
 assert.equal(parent.delegation.children.length,3);assert.equal(f.fires(),1);
 const claude=await f.store.requireTask(parent.delegation.children.find(c=>c.provider==='claude').taskId);
 assert.notEqual((await f.mcp('checkpoint_task',{taskId:claude.id,...owner(claude.checkpoint),content:'4',status:'completed'})).result.isError,true);
 for(let i=0;i<2;i++){const {claim}=await f.post('/api/desktop/poll',{});assert.equal(claim.task.parentTaskId,task.id);assert.equal((await f.post(`/api/desktop/${claim.task.id}/complete`,{...owner(claim),content:'4',artifacts:[{name:'answer.txt',mime:'text/plain',encoding:'utf-8',content:'4'}]})).status,200);}
 const {claim:review}=await f.post('/api/desktop/poll',{});
 assert.equal(review?.task?.id,task.id);assert.equal(review.reviewInputs.length,3);
 assert.equal((await f.post(`/api/desktop/${task.id}/complete`,{...owner(review),content:'All equal 4',reviewReport:passing(parent)})).status,200);
 const finished=await f.store.requireTask(task.id);
 assert.equal(finished.status,'completed');assert.equal(finished.reviewObservation.children.length,3);
 // H7-4: every child of the completed review is recorded as an observation.
 assert.deepEqual(finished.reviewObservation.children.map(x=>x.status),['recorded','recorded','recorded']);
});

test('policy retention reads pins from up to four children and still fails closed beyond that',async t=>{
 const {TASK_PINS_SQL,parseTaskEvidencePins}=await import('../worker/policy-retention.mjs');
 const db=new TestD1();t.after(()=>db.close());
 const insert=(id,count)=>db.prepare('INSERT INTO tasks (id,version,updated_at,body) VALUES (?1,1,?2,?3)').bind(id,'2026-10-06T00:00:00.000Z',JSON.stringify({id,status:'waiting_children',delegation:{children:Array.from({length:count},(_,i)=>({taskId:`${id}-c${i}`,selection:{evidenceIds:[`${id}-e${i}`]}}))}})).run();
 await insert('three',3);await insert('four',4);
 const pins=new Set(parseTaskEvidencePins((await db.prepare(TASK_PINS_SQL).all()).results));
 for(const id of ['three-e0','three-e1','three-e2','four-e0','four-e1','four-e2','four-e3'])assert.ok(pins.has(id),id);
 await insert('five',5);
 assert.throws(()=>parseTaskEvidencePins(db.db.prepare(TASK_PINS_SQL).all()),/unsupported task selection shape/);
});

test('the desktop review runner accepts one isolated input per child for three children',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'inno-review3-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const children=['a','b','c'].map((id,i)=>({taskId:'child-'+id,...assign(i===2?'claude':'codex','role '+id)}));
 const reviewInputs=children.map(c=>({taskId:c.taskId,role:c.role,summary:'done',artifacts:[{id:c.taskId+'-1',name:'r.txt',mime:'text/plain',encoding:'utf-8',content:'evidence '+c.taskId}]}));
 const reviewReport=children.map(c=>({childTaskId:c.taskId,criteria:[{criterion:'equals 4',status:'pass',evidence:'ok'}]}));
 let input='';
 const spawnProcess=()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>true;c.stdin.on('data',chunk=>{input+=chunk;});c.stdin.on('finish',()=>{c.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'integrated',reviewReport})}})+'\n');c.stdout.end();c.emit('close',0,null);});return c;};
 const runner=createCodexRunner({spawnProcess,runDirectory:()=>directory,ensureDirectory:()=>{},modelCatalog:async()=>models,managedDelivery:true});
 const result=await runner.run({task:{id:'parent',title:'Review',prompt:'Integrate.',type:'analysis',plan:[],delegation:{state:'reviewing',children}},reviewInputs});
 assert.equal(result.reviewReport.length,3);assert.match(input,/inno-review-003-child-c-001\.txt/);
});

test('a Claude review of three children recovers after stop confirmation with every child kept',async t=>{
 const f=await http(t);await f.post('/api/desktop/poll',{models:observed()});
 const parent=await f.store.createTask({prompt:'Three independent checks'}),master=await f.store.claimExecution(parent.id,{provider:'claude',expectedVersion:1});
 const children=[assign('codex','first check'),assign('codex','second check'),assign('codex','third check')];
 assert.notEqual((await f.mcp('delegate_task',{taskId:parent.id,...owner(master),independent:true,children})).result.isError,true);
 for(let i=0;i<3;i++){const {claim}=await f.post('/api/desktop/poll',{});await f.post(`/api/desktop/${claim.task.id}/complete`,{...owner(claim),content:'4'});}
 let p=await f.store.requireTask(parent.id);
 assert.equal(p.delegation.review.children.length,3);assert.equal(p.status,'running');
 await f.store.markExecutionUncertain(p.id,{...owner(p.checkpoint),reason:'uncertain_fire'});
 p=await f.store.requireTask(parent.id);
 const recovered=await f.post(`/api/tasks/${p.id}/execution/recover`,{expectedVersion:p.version,...owner(p.checkpoint),confirmedStopped:true});
 assert.equal(recovered.status,200,JSON.stringify(recovered).slice(0,300));
 for(const c of p.delegation.children)assert.equal((await f.store.requireTask(c.taskId)).status,'completed');
});

test('a first allocation of four new profiles is accepted with initial policies',async t=>{
 const f=await http(t),{task,master}=await codexMaster(f,'Four independent calculations');
 const children=['one','two','three','four'].map((role,i)=>assign(i<2?'codex':'claude',role+' check'));
 const done=await f.post(`/api/desktop/${task.id}/complete`,{...owner(master),content:'Four roles',delegation:{independent:true,children}});
 assert.equal(done.status,200,JSON.stringify(done).slice(0,300));
 const parent=await f.store.requireTask(task.id);
 assert.equal(parent.delegation.children.length,4);
 const frozen=await Promise.all(parent.delegation.children.map(c=>f.store.requireTask(c.taskId)));
 assert.ok(frozen.every(c=>c.assignment&&c.parentTaskId===task.id));
});
