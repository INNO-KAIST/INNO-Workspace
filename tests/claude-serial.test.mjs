import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {executionCapability} from '../worker/execution-scope.mjs';
import {TestD1} from './helpers/d1.mjs';

// H7-3 (user decision 2026-10-06): Claude (routine_fire) children of one batch run one at
// a time. A child that is running or awaits stop confirmation holds the slot.
const models=[{model:'gpt-5.6-luna',efforts:['low'],isDefault:false}];
const assign=(provider,role)=>({role,provider,requestedModel:provider==='codex'?'gpt-5.6-luna':'haiku',effort:'low',sufficientReason:'bounded exact arithmetic',acceptanceCriteria:['equals 4'],instructions:'Return 2+2'});
const owner=c=>({executionId:c.executionId,generation:c.generation});
async function fixture(t,respond=()=>Response.json({claude_code_session_id:'s',claude_code_session_url:'https://claude.ai/code/s'})){
 const db=new TestD1();t.after(()=>db.close());let fires=0;
 const worker=createWorker({fetchFn:async(url,init)=>{if(!String(url).includes('anthropic'))return new Response('unavailable',{status:503});fires++;return respond(fires);}});
 const env={DB:db,ACCESS_TOKEN:'test-claude-serial-01234567890123456789',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'mock'};
 const post=async(p,input)=>{const r=await worker.fetch(new Request('https://inno.example'+p,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify(input)}),env);return {status:r.status,...await r.json()};};
 const mcp=async(name,args)=>post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',executionCapability:await executionCapability(env.ACCESS_TOKEN,{task:{id:args.taskId},executionId:args.executionId,generation:args.generation}),params:{name,arguments:args}});
 const store=new D1TaskStore(db);
 await post('/api/desktop/poll',{models:{models,observedAt:Date.now(),status:'fresh'}});
 const {task}=await post('/api/tasks',{prompt:'Independent checks'});
 await post(`/api/tasks/${task.id}/run`,{provider:'codex',expectedVersion:1});
 const {claim:master}=await post('/api/desktop/poll',{});
 const children=[assign('claude','first claude'),assign('claude','second claude'),assign('codex','codex check')];
 const allocated=await post(`/api/desktop/${task.id}/complete`,{...owner(master),content:'plan',delegation:{independent:true,children}});
 assert.equal(allocated.status,200,JSON.stringify(allocated).slice(0,300));
 const parent=await store.requireTask(task.id);
 const claude=await Promise.all(parent.delegation.children.filter(c=>c.provider==='claude').map(c=>store.requireTask(c.taskId)));
 return {db,env,worker,store,post,mcp,parent,claude,fires:()=>fires};
}
const statuses=async f=>Promise.all(f.claude.map(async c=>(await f.store.requireTask(c.id)).status));

test('allocation fires one Claude child and its completion starts the next',async t=>{
 const f=await fixture(t);
 assert.equal(f.fires(),1);assert.deepEqual((await statuses(f)).sort(),['queued','running']);
 const running=(await Promise.all(f.claude.map(c=>f.store.requireTask(c.id)))).find(c=>c.status==='running');
 assert.notEqual((await f.mcp('checkpoint_task',{taskId:running.id,...owner(running.checkpoint),content:'4',status:'completed'})).result.isError,true);
 assert.equal(f.fires(),2);assert.deepEqual((await statuses(f)).sort(),['completed','running']);
});

test('a definitive fire failure frees the slot and starts the next Claude child',async t=>{
 const f=await fixture(t,n=>n===1?Response.json({error:'unauthorized'},{status:401}):Response.json({claude_code_session_id:'s',claude_code_session_url:'https://claude.ai/code/s'}));
 assert.equal(f.fires(),2);assert.deepEqual((await statuses(f)).sort(),['running','waiting_connection']);
});

test('an uncertain fire holds the slot; cron drain and direct runs do not start a second Claude child',async t=>{
 const f=await fixture(t,()=>{throw new TypeError('fetch failed');});
 assert.equal(f.fires(),1);
 const tasks=await Promise.all(f.claude.map(c=>f.store.requireTask(c.id)));
 const held=tasks.find(c=>c.status==='waiting_connection'),waiting=tasks.find(c=>c.status==='queued');
 assert.equal(held.checkpoint.confirmationRequired.reason,'uncertain_fire');assert.ok(waiting);
 await f.worker.scheduled({},f.env);
 assert.equal(f.fires(),1);assert.equal((await f.store.requireTask(waiting.id)).status,'queued');
 const direct=await f.post(`/api/tasks/${waiting.id}/run`,{provider:'claude',expectedVersion:(await f.store.requireTask(waiting.id)).version});
 assert.equal(direct.status,409);assert.equal(direct.code,'ROUTINE_SIBLING_BUSY');assert.equal(f.fires(),1);
});

test('the claim gate blocks a Claude sibling even when the precheck loses a race',async t=>{
 const f=await fixture(t);
 const waiting=(await Promise.all(f.claude.map(c=>f.store.requireTask(c.id)))).find(c=>c.status==='queued');
 await assert.rejects(()=>f.store.claimExecution(waiting.id,{provider:'claude',expectedVersion:waiting.version}),error=>error.code==='ROUTINE_SIBLING_BUSY');
 // Simulate the window between the precheck and the write: the SQL guard still refuses.
 const precheck=f.store.routineSiblingBusy;f.store.routineSiblingBusy=async()=>false;
 try{await assert.rejects(()=>f.store.claimExecution(waiting.id,{provider:'claude',expectedVersion:waiting.version}),error=>error.code==='ROUTINE_SIBLING_BUSY');}
 finally{f.store.routineSiblingBusy=precheck;}
 assert.equal((await f.store.requireTask(waiting.id)).status,'queued');
});

test('a Claude child that stops for a user decision frees the slot for the next one',async t=>{
 const f=await fixture(t);
 const running=(await Promise.all(f.claude.map(c=>f.store.requireTask(c.id)))).find(c=>c.status==='running');
 const asked=await f.mcp('request_decision',{taskId:running.id,...owner(running.checkpoint),prompt:'Which variant?',options:[{label:'A',pros:'fast',cons:'rough'},{label:'B',pros:'careful',cons:'slow'}]});
 assert.notEqual(asked.result.isError,true,JSON.stringify(asked).slice(0,300));
 assert.equal(f.fires(),2);assert.deepEqual((await statuses(f)).sort(),['running','waiting_user']);
});

test('explicit recovery of an uncertain Claude child keeps the slot while it is uncertain again',async t=>{
 const f=await fixture(t,()=>{throw new TypeError('fetch failed');});
 const tasks=await Promise.all(f.claude.map(c=>f.store.requireTask(c.id)));
 const held=tasks.find(c=>c.status==='waiting_connection'),waiting=tasks.find(c=>c.status==='queued');
 // Release the held slot through explicit recovery, then let the recovered run fail definitively.
 let p=await f.store.requireTask(f.parent.id);
 const recovered=await f.post(`/api/tasks/${p.id}/delegation/recover`,{expectedVersion:p.version,childTaskId:held.id,expectedChildVersion:held.version,confirmedStopped:true});
 assert.equal(recovered.status,200,JSON.stringify(recovered).slice(0,300));
 // The recovered child fired again (uncertain again) and still holds the slot; the waiting sibling stays queued.
 assert.equal((await f.store.requireTask(waiting.id)).status,'queued');
});

test('Codex children are not limited by the Claude gate',async t=>{
 const f=await fixture(t);
 const codex=(await f.store.requireTask(f.parent.delegation.children.find(c=>c.provider==='codex').taskId));
 assert.equal((await f.store.claimExecution(codex.id,{provider:'codex',expectedVersion:codex.version})).task.status,'running');
});
