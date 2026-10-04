import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {createCodexRunner,ROUTE_CONDITIONS_CONTRACT} from '../server/runners.mjs';
import {SqliteTaskStore} from '../server/store.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {boundedExecutionEvidence} from '../public/core/execution-evidence.mjs';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {delegationProfile} from '../worker/allocation-policy.mjs';
import {verifyReviewObservation} from '../worker/review-observation.mjs';
import {D1ModelPolicies} from '../worker/model-policies.mjs';
import {createSelectionState,registerCandidate,recordObservation} from '../public/core/model-selection.mjs';

const HEX=/^[0-9a-f]{64}$/;
const catalog=[{model:'gpt-5.6-terra',efforts:['high','low']},{model:'gpt-5.6-luna',efforts:['low']}];
function spawnResult(capture){
 return (_command,args)=>{
  capture.push(args);
  const child=new EventEmitter();
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.stdin.on('finish',()=>{
   child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'done'})}})+'\n');
   child.stdout.end();child.emit('close',0,null);
  });
  return child;
 };
}
const runner=(capture,options={})=>createCodexRunner({spawnProcess:spawnResult(capture),ensureDirectory:()=>{},runDirectory:()=>process.cwd(),modelCatalog:async()=>catalog,now:()=>1000,...options});
const childTask=(model,effort)=>({id:'child',parentTaskId:'parent',batchId:'batch',parentEpoch:1,prompt:'Work',assignment:{provider:'codex',requestedModel:model,effort,role:'worker',acceptanceCriteria:['Check result'],instructions:'Work'}});
const plugin=hash=>({id:'anthropics/brand-guidelines',name:'brand-guidelines',source:{repository:'anthropics/skills',path:'skills/brand-guidelines',commit:'a'.repeat(40)},contentHash:hash,reason:'Matches the brand acceptance criterion',text:'Use the brand colours.'});

test('route conditions fingerprint the run without the applied model and effort',async()=>{
 const capture=[];
 const a=await runner(capture).run({task:childTask('gpt-5.6-terra','high')});
 const b=await runner(capture).run({task:childTask('gpt-5.6-luna','low')});
 assert.match(a.executionEvidence.routeConditions,HEX);
 assert.equal(a.executionEvidence.cliAppliedModel,'gpt-5.6-terra');assert.equal(b.executionEvidence.cliAppliedModel,'gpt-5.6-luna');
 assert.equal(a.executionEvidence.routeConditions,b.executionEvidence.routeConditions);
 const root=await runner(capture).run({task:{id:'root',prompt:'Work'}});
 assert.match(root.executionEvidence.routeConditions,HEX);
 assert.notEqual(root.executionEvidence.routeConditions,a.executionEvidence.routeConditions);
});

test('a per-start MCP address does not change route conditions, but attaching MCP does',async()=>{
 const capture=[];
 const run=url=>runner(capture,url?{mcpUrl:url,mcpToken:'token-value-for-route-test'}:{}).run({task:{id:'root',prompt:'Work'}});
 const first=await run('http://127.0.0.1:4101/mcp'),second=await run('http://127.0.0.1:4202/mcp'),none=await run();
 assert.ok(capture[0].some(arg=>String(arg).includes('4101')));
 assert.equal(first.executionEvidence.routeConditions,second.executionEvidence.routeConditions);
 assert.notEqual(first.executionEvidence.routeConditions,none.executionEvidence.routeConditions);
});

test('delivered plugins and their content hashes enter the route conditions',async()=>{
 const capture=[],task=childTask('gpt-5.6-terra','high');
 const plain=await runner(capture).run({task});
 const one=await runner(capture).run({task,plugins:[plugin('b'.repeat(64))]});
 const changed=await runner(capture).run({task,plugins:[plugin('c'.repeat(64))]});
 assert.equal(one.pluginDelivery.applied.length,1);
 assert.notEqual(plain.executionEvidence.routeConditions,one.executionEvidence.routeConditions);
 assert.notEqual(one.executionEvidence.routeConditions,changed.executionEvidence.routeConditions);
});

test('bounded evidence keeps valid route conditions and leaves older evidence unchanged',()=>{
 const base={provider:'codex',source:'cli_arguments',requestedModel:null,requestedEffort:null,cliAppliedModel:null,cliAppliedEffort:null,actualModelVersion:null,processElapsedMs:1};
 assert.deepEqual(boundedExecutionEvidence(base),base);
 assert.deepEqual(boundedExecutionEvidence({...base,routeConditions:null}),base);
 assert.equal(boundedExecutionEvidence({...base,routeConditions:'a'.repeat(64)}).routeConditions,'a'.repeat(64));
 for(const bad of ['A'.repeat(64),'a'.repeat(63),'g'.repeat(64),64,{}])assert.throws(()=>boundedExecutionEvidence({...base,routeConditions:bad}),/route conditions/);
});

test('the owning completion stores route conditions with the execution evidence',async t=>{
 const db=new TestD1(),store=new D1TaskStore(db);t.after(()=>db.close());
 store.now=()=>'2026-10-05T00:00:00.000Z';
 const task=await store.createTask({prompt:'Work'});
 const owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 store.now=()=>'2026-10-05T00:00:02.000Z';
 const evidence={provider:'codex',source:'cli_arguments',requestedModel:null,requestedEffort:null,cliAppliedModel:null,cliAppliedEffort:null,actualModelVersion:null,processElapsedMs:5,routeConditions:'d'.repeat(64)};
 const done=await new CloudBridge(store).complete(task.id,{...owner,content:'Done',executionEvidence:evidence});
 assert.equal(done.checkpoint.executionEvidence.routeConditions,'d'.repeat(64));
 assert.equal((await store.requireTask(task.id)).checkpoint.executionEvidence.routeConditions,'d'.repeat(64));
});

const assignment={provider:'codex',requestedModel:'gpt-test',effort:'high',role:'analyst',instructions:'Check the bounded input',acceptanceCriteria:['Correct calculation'],sourceIds:['source-1']};
async function reviewFixture(evidence){
 const profile=await delegationProfile(assignment);
 const selected={...assignment,selection:{status:'fallback',profile,modelVersion:null}};
 const peer={...assignment,provider:'claude',requestedModel:'sonnet',role:'reviewer',acceptanceCriteria:['Check answer'],selection:{status:'fallback',profile:{...profile,family:'delegation_claude'},modelVersion:null}};
 const report=[{childTaskId:'child',criteria:[{criterion:'Correct calculation',status:'pass',evidence:'Recomputed'}]},{childTaskId:'peer',criteria:[{criterion:'Check answer',status:'pass',evidence:'Checked'}]}];
 const attachment={id:'source-1',name:'input.txt',path:'input.txt',size:3,lastModified:1,source:'file',view:{kind:'text-byte-range',start:0,end:3,sha256:'a'.repeat(64)}};
 const parent={id:'parent',status:'completed',attachments:[structuredClone(attachment)],checkpoint:{provider:'claude',executionId:'review-execution',generation:3,claimedAt:'2026-10-05T00:00:02.000Z',completedAt:'2026-10-05T00:00:04.000Z'},delegation:{state:'completed',batchId:'batch-1',epoch:2,masterProvider:'claude',children:[{taskId:'child',...selected},{taskId:'peer',...peer}],review:{children:[{taskId:'child',summary:'Result',artifacts:[]},{taskId:'peer',summary:'Peer',artifacts:[]}]},reviewReport:report}};
 const child={id:'child',status:'completed',parentTaskId:'parent',batchId:'batch-1',parentEpoch:2,prompt:assignment.instructions,assignment:selected,attachments:[structuredClone(attachment)],checkpoint:{provider:'codex',executionId:'child-execution',generation:1,claimedAt:'2026-10-05T00:00:00.000Z',completedAt:'2026-10-05T00:00:02.000Z',executionEvidence:{source:'cli_arguments',provider:'codex',requestedModel:'gpt-test',requestedEffort:'high',actualModelVersion:null,...evidence}}};
 const state={profile,candidates:[{id:'route',provider:'codex',model:'gpt-test',effort:'high',modelVersion:null}]};
 const ref={parentTaskId:'parent',childTaskId:'child',reviewExecutionId:'review-execution',reviewGeneration:3,childExecutionId:'child-execution',childGeneration:1};
 const tasks={parent,child};
 return {state,ref,store:{requireTask:async id=>tasks[id]}};
}

test('a review observation carries the CLI-applied route only with matching evidence and conditions',async()=>{
 const conditions='c'.repeat(64);
 const f=await reviewFixture({cliAppliedModel:'gpt-test',cliAppliedEffort:'high',routeConditions:conditions});
 const result=await verifyReviewObservation(f.store,f.ref,f.state);
 assert.equal(result.status,'verified');
 assert.deepEqual(result.observation.route,{basis:'cli_arguments',model:'gpt-test',effort:'high',conditions});
 assert.equal(result.observation.modelVersion,null);
 const legacy=await reviewFixture({cliAppliedModel:'gpt-test',cliAppliedEffort:'high'});
 const old=await verifyReviewObservation(legacy.store,legacy.ref,legacy.state);
 assert.equal(old.status,'verified');assert.equal(Object.hasOwn(old.observation,'route'),false);
 for(const evidence of [{cliAppliedModel:'gpt-other',cliAppliedEffort:'high',routeConditions:conditions},{cliAppliedModel:'gpt-test',cliAppliedEffort:'low',routeConditions:conditions}]){
  const mismatch=await reviewFixture(evidence);
  assert.deepEqual(await verifyReviewObservation(mismatch.store,mismatch.ref,mismatch.state),{status:'not_attributable',reason:'execution_evidence_mismatch'});
 }
});

const now=1_800_000_000_000;
const profile={family:'analysis',requirementsVersion:'r1',evaluationVersion:'e1',criteria:['correct'],requiredCapabilities:['text'],contextClass:'large'};
const routeState=()=>registerCandidate(createSelectionState({profile,baseline:{id:'base',provider:'codex',model:'gpt-5.6-terra',modelVersion:null,effort:'high'}}),{id:'next',provider:'codex',model:'gpt-5.6-luna',modelVersion:null,effort:'low'});
const routeOf=(model,effort,conditions='e'.repeat(64))=>({basis:'cli_arguments',model,effort,conditions});
const row=(id,candidateId,extra={})=>({id,provider:'codex',executionId:`execution-${id}`,generation:1,candidateId,modelVersion:null,comparisonId:`pair-${id}`,profile,observedAt:now,source:'normal_execution',quality:{source:'independent_review',critical:false,criteria:[{id:'correct',status:'pass'}]},usage:{source:'executor_report',inputTokens:10,outputTokens:5,latencyMs:100},...extra});

test('policy observations keep a valid execution route and reject a route that is not the candidate',()=>{
 const withRoute=recordObservation(routeState(),row('a','next',{route:routeOf('gpt-5.6-luna','low')}),{now}).state;
 assert.deepEqual(withRoute.observations.at(-1).route,routeOf('gpt-5.6-luna','low'));
 const without=recordObservation(routeState(),row('b','next'),{now}).state;
 assert.equal(Object.hasOwn(without.observations.at(-1),'route'),false);
 for(const route of [routeOf('gpt-5.6-terra','low'),routeOf('gpt-5.6-luna','high'),{...routeOf('gpt-5.6-luna','low'),basis:'model_self_report'},routeOf('gpt-5.6-luna','low','x'),{...routeOf('gpt-5.6-luna','low'),extra:true},'route'])
  assert.throws(()=>recordObservation(routeState(),row('c','next',{route}),{now}),/route/);
 const versioned=createSelectionState({profile,baseline:{id:'base',provider:'codex',model:'gpt-5.6-terra',modelVersion:'v1',effort:'high'}});
 assert.throws(()=>recordObservation(versioned,row('d','base',{modelVersion:'v1',route:routeOf('gpt-5.6-terra','high')}),{now}),/route/);
});

test('managed delivery and negotiated source delegation each change the route conditions',async()=>{
 const capture=[],task=childTask('gpt-5.6-terra','high');
 const plain=await runner(capture).run({task});
 const managed=await runner(capture,{managedDelivery:true}).run({task});
 const sourced=await runner(capture,{sourceDelegationVersion:1}).run({task,sourceDelegationVersion:1});
 assert.notEqual(plain.executionEvidence.routeConditions,managed.executionEvidence.routeConditions);
 assert.notEqual(plain.executionEvidence.routeConditions,sourced.executionEvidence.routeConditions);
});

// The run-condition fingerprint cannot see prompt wording. A canonical child prompt is pinned
// to the contract version so a prompt edit fails here until ROUTE_CONDITIONS_CONTRACT is raised
// and a new entry is added. Never edit an existing entry.
const CANONICAL_CHILD_PROMPTS={1:{plain:'bc1a0c5ae5c281c874045a65217eaa1141ab57e6728e127e325a88a04a3cd8c6',plugin:'6e3b2cf3d20c65c04af527f961c9567d87c93113f12d30ba17002c8c33b8b8fb'}};
function capturingSpawn(inputs){
 return (_command,args)=>{
  const child=new EventEmitter(),chunks=[];
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.stdin.on('data',chunk=>chunks.push(chunk));
  child.stdin.on('finish',()=>{
   inputs.push(Buffer.concat(chunks).toString('utf8'));
   child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'done'})}})+'\n');
   child.stdout.end();child.emit('close',0,null);
  });
  return child;
 };
}
test('a child prompt change requires a new route-conditions contract version',async()=>{
 const inputs=[],run=options=>createCodexRunner({spawnProcess:capturingSpawn(inputs),ensureDirectory:()=>{},runDirectory:()=>process.cwd(),modelCatalog:async()=>catalog,now:()=>1000}).run({task:childTask('gpt-5.6-terra','high'),...options});
 await run({});await run({plugins:[plugin('b'.repeat(64))]});
 // The local helper path differs per machine and is not part of the prompt contract.
 const hash=text=>createHash('sha256').update(text.replace(/"[^"]*verify-deliverable\.py"/g,'"<helper>"')).digest('hex');
 assert.deepEqual({contract:ROUTE_CONDITIONS_CONTRACT,plain:hash(inputs[0]),plugin:hash(inputs[1])},{contract:ROUTE_CONDITIONS_CONTRACT,...CANONICAL_CHILD_PROMPTS[ROUTE_CONDITIONS_CONTRACT]});
});

test('the local desktop store and outbox keep route conditions',async t=>{
 const store=new SqliteTaskStore(':memory:');t.after(()=>store.close());
 const task=await store.createTask({prompt:'Work'});
 const owner=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 const evidence={provider:'codex',source:'cli_arguments',requestedModel:null,requestedEffort:null,cliAppliedModel:null,cliAppliedEffort:null,actualModelVersion:null,processElapsedMs:5,routeConditions:'d'.repeat(64)};
 const done=await store.finishExecution(task.id,{...owner,content:'Done',executionEvidence:evidence},{allowDesktopEvidence:true});
 assert.equal(done.checkpoint.executionEvidence.routeConditions,'d'.repeat(64));
 let value=null;const outbox={read:()=>value,write:v=>{value=v;},clear:()=>{value=null;}};
 const bridge=createDesktopBridge({outbox,request:async path=>{if(path.endsWith('/poll'))return {claim:{task:{id:'t'},executionId:'e',generation:1}};throw Error('lost response');},runner:{run:async()=>({content:'ok',executionEvidence:evidence})}});
 await assert.rejects(()=>bridge.tick(),/lost response/);
 assert.equal(outbox.read().input.executionEvidence.routeConditions,'d'.repeat(64));
});

test('corrupt stored route conditions make the observation unattributable instead of failing',async()=>{
 const f=await reviewFixture({cliAppliedModel:'gpt-test',cliAppliedEffort:'high',routeConditions:'not-a-fingerprint'});
 assert.deepEqual(await verifyReviewObservation(f.store,f.ref,f.state),{status:'not_attributable',reason:'execution_evidence_mismatch'});
});

test('a replay with a route for an observation stored before routes existed stays a duplicate',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const policies=new D1ModelPolicies(db,{now:()=>now,verifyObservation:ref=>ref});
 let state=await policies.create({profile,baseline:{id:'base',provider:'codex',model:'gpt-5.6-terra',modelVersion:null,effort:'high'},expectedStateVersion:0});
 const legacy=row('a','base');
 state=(await policies.observe({profile,evidenceRef:legacy,expectedStateVersion:state.stateVersion})).state;
 const replay=await policies.observe({profile,evidenceRef:{...legacy,route:routeOf('gpt-5.6-terra','high')},expectedStateVersion:state.stateVersion});
 assert.equal(replay.reason,'duplicate_execution');
 assert.equal(Object.hasOwn((await policies.read(profile)).observations[0],'route'),false);
});

test('a replayed policy observation must carry the same execution route',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const policies=new D1ModelPolicies(db,{now:()=>now,verifyObservation:ref=>ref});
 let state=await policies.create({profile,baseline:{id:'base',provider:'codex',model:'gpt-5.6-terra',modelVersion:null,effort:'high'},expectedStateVersion:0});
 const observed=row('a','base',{route:routeOf('gpt-5.6-terra','high')});
 state=(await policies.observe({profile,evidenceRef:observed,expectedStateVersion:state.stateVersion})).state;
 assert.equal((await policies.observe({profile,evidenceRef:observed,expectedStateVersion:state.stateVersion})).reason,'duplicate_execution');
 await assert.rejects(policies.observe({profile,evidenceRef:{...observed,route:routeOf('gpt-5.6-terra','high','f'.repeat(64))},expectedStateVersion:state.stateVersion}),/version conflict/);
});
