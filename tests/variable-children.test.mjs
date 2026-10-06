import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {validateDelegationResult,delegationRoutingPolicy} from '../server/model-routing.mjs';
import {validateAssignments,DELEGATION_MIN_CHILDREN,DELEGATION_MAX_CHILDREN} from '../public/core/delegation.mjs';
import {handleMcp} from '../server/mcp.mjs';
import {createTask} from '../public/core/tasks.mjs';
import {createCodexRunner} from '../server/runners.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';

// H7 (user decision 2026-10-06): a master may split work into 2 to 4 independent
// children in any provider mix with distinct roles; Claude children run one at a time.
const rows=[{model:'gpt-5.4',efforts:['high','medium'],isDefault:true}];
const child=(provider,role)=>({role,provider,requestedModel:provider==='codex'?'gpt-5.4':'sonnet',effort:'high',sufficientReason:'Enough for the bounded work',acceptanceCriteria:['Evidence is cited'],instructions:'Do the bounded work.'});
const delegation=(...children)=>({independent:true,children});

test('the child count bound is 2 to 4',()=>{
 assert.equal(DELEGATION_MIN_CHILDREN,2);assert.equal(DELEGATION_MAX_CHILDREN,4);
});

test('runner validation accepts 2 to 4 children in any provider mix with distinct roles',()=>{
 assert.deepEqual(validateDelegationResult(delegation(child('codex','A'),child('codex','B'),child('claude','C')),rows).children.map(c=>c.provider),['codex','codex','claude']);
 assert.equal(validateDelegationResult(delegation(child('claude','A'),child('claude','B'),child('codex','C'),child('codex','D')),rows).children.length,4);
 assert.equal(validateDelegationResult(delegation(child('claude','A'),child('claude','B')),rows).children.length,2);
 for(const bad of [delegation(child('codex','A')),delegation(...['A','B','C','D','E'].map(role=>child('codex',role))),delegation(child('codex','A'),child('claude','A'))])
  assert.throws(()=>validateDelegationResult(bad,rows),/Invalid delegation/);
});

test('allocation validation accepts 2 to 4 children and rejects other counts and repeated roles',()=>{
 const parent={...createTask({prompt:'Compare approaches'},{now:()=>'2026-10-06T00:00:00.000Z',id:()=>'p'}),status:'running',checkpoint:{provider:'codex',executionId:'e',generation:1}};
 const input=children=>({executionId:'e',generation:1,independent:true,children});
 assert.equal(validateAssignments(parent,input([child('codex','A'),child('codex','B'),child('claude','C')])).length,3);
 assert.equal(validateAssignments(parent,input([child('claude','A'),child('claude','B'),child('claude','C'),child('codex','D')])).length,4);
 assert.throws(()=>validateAssignments(parent,input([child('codex','A')])),/2 to 4/);
 assert.throws(()=>validateAssignments(parent,input(['A','B','C','D','E'].map(role=>child('codex',role)))),/2 to 4/);
 assert.throws(()=>validateAssignments(parent,input([child('codex','A'),child('claude','A')])),/distinct roles/i);
});

test('the MCP delegation tool advertises 2 to 4 children and review reports to match',async()=>{
 const tools=async options=>(await handleMcp({},{jsonrpc:'2.0',id:1,method:'tools/list'},{delegate:()=>{},retryReview:()=>{},...options})).result.tools;
 const plain=await tools(),sourced=await tools({sourceDelegationVersion:1});
 for(const list of [plain,sourced]){
  const delegate=list.find(t=>t.name==='delegate_task');
  assert.equal(delegate.inputSchema.properties.children.minItems,2);assert.equal(delegate.inputSchema.properties.children.maxItems,4);
  assert.doesNotMatch(delegate.description,/exactly two|one Codex and one Claude|two independent/i);
 }
 assert.equal(plain.find(t=>t.name==='checkpoint_task').inputSchema.properties.reviewReport.maxItems,4);
 assert.equal(plain.find(t=>t.name==='retry_delegation').inputSchema.properties.reviewReport.maxItems,4);
});

test('the Codex master policy describes 2 to 4 children and one Claude child at a time',async()=>{
 for(const policy of [delegationRoutingPolicy(rows),delegationRoutingPolicy(rows,{sourceDelegationVersion:1})]){
  assert.match(policy,/2 to 4/);assert.match(policy,/one at a time/);assert.doesNotMatch(policy,/exactly one codex and one claude|exactly two/i);
 }
 let input='';
 const spawnProcess=()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>true;c.stdin.on('data',chunk=>{input+=chunk;});c.stdin.on('finish',()=>{c.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'done'})}})+'\n');c.stdout.end();c.emit('close',0,null);});return c;};
 await createCodexRunner({spawnProcess,ensureDirectory:()=>{},runDirectory:()=>process.cwd(),modelCatalog:async()=>rows,managedDelivery:true}).run({task:{id:'root',title:'Compare',prompt:'Compare approaches.',type:'analysis',plan:[]}});
 assert.match(input,/2 to 4/);assert.doesNotMatch(input,/Exactly one child must use each provider/);
});

test('the Claude master prompt describes 2 to 4 children in any provider mix',async t=>{
 const DB=new TestD1();t.after(()=>DB.close());const store=new D1TaskStore(DB);
 const env={DB,ACCESS_TOKEN:'test-variable-children-0123456789012345',CLAUDE_ROUTINE_URL:'https://api.anthropic.com/v1/fire',CLAUDE_ROUTINE_TOKEN:'fake'};
 let prompt='';
 const worker=createWorker({fetchFn:async(_url,input)=>{if(input?.body)prompt=JSON.parse(input.body).text;return Response.json({claude_code_session_id:'s',claude_code_session_url:'https://example.test/s'});}});
 const task=await store.createTask({prompt:'Compare approaches'});
 assert.equal((await worker.fetch(new Request(`https://inno.test/api/tasks/${task.id}/run`,{method:'POST',headers:{authorization:'Bearer '+env.ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({provider:'claude',expectedVersion:task.version})}),env)).status,202);
 assert.match(prompt,/2 to 4/);assert.doesNotMatch(prompt,/one Codex and one Claude child|two assignments/);
});
