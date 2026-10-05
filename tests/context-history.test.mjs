import test from 'node:test';
import assert from 'node:assert/strict';
import {usageHistory,sanitizeUsageHistory} from '../public/core/execution-usage.mjs';
import {contextHistoryRows} from '../public/core/context-delivery.mjs';
import {SqliteTaskStore} from '../server/store.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';

// Each execution keeps its own delivery record in the bounded usage history so one task
// can be compared across its executions. Nothing is compared across tasks.
const delivery=(over={})=>({version:1,provider:'codex',unit:'utf8_bytes',readiness:'full_over_budget',contextBytes:120000,originalBytes:121000,selectionSavedBytes:0,omittedMessages:0,maxBytes:96000,hardMaxBytes:384000,reader:false,promptBytes:150000,materialBytes:1000,inputTokens:null,cachedTokens:null,...over});
const owner={provider:'codex',executionId:'e1',generation:1};

test('a history entry carries a valid delivery record and drops an invalid one',()=>{
 const task={id:'t'};
 const kept=usageHistory(owner,{inputTokens:10},'2026-10-06T01:00:00.000Z',{task,transition:'completion',contextDelivery:delivery()});
 assert.deepEqual(kept.at(-1).contextDelivery,delivery());
 const dropped=usageHistory(owner,{inputTokens:10},'2026-10-06T01:00:00.000Z',{task,transition:'completion',contextDelivery:{...delivery(),readiness:'partial'}});
 assert.equal(Object.hasOwn(dropped.at(-1),'contextDelivery'),false);
 const later=usageHistory({...owner,executionId:'e2',generation:2,usageHistory:kept},{inputTokens:20},'2026-10-06T02:00:00.000Z',{task,transition:'completion'});
 assert.deepEqual(later[0].contextDelivery,delivery());assert.equal(Object.hasOwn(later[1],'contextDelivery'),false);
 assert.equal(Object.hasOwn(sanitizeUsageHistory(kept)[0],'contextDelivery'),false);
});

for(const kind of ['local','worker']){
 test(`${kind} completion and failure record the execution's delivery in its history entry`,async t=>{
  const db=kind==='worker'?new TestD1():null,store=db?new D1TaskStore(db):new SqliteTaskStore(':memory:');
  t.after(()=>db?db.close():store.close());
  const task=await store.createTask({prompt:'Report'});
  const first=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
  const failed=await store.failExecution(task.id,{executionId:first.executionId,generation:first.generation,failure:{kind:'context'},contextDelivery:delivery({readiness:'blocked',promptBytes:null})});
  assert.equal(failed.checkpoint.usageHistory.at(-1).contextDelivery.readiness,'blocked');
  const second=await store.claimExecution(task.id,{provider:'codex',expectedVersion:failed.version});
  const done=await store.finishExecution(task.id,{executionId:second.executionId,generation:second.generation,content:'done',contextDelivery:delivery({readiness:'selected_ready',reader:true,retrievalRequests:2,retrievalBytes:3000})});
  const history=done.checkpoint.usageHistory;
  assert.equal(history.length,2);assert.equal(history[0].contextDelivery.readiness,'blocked');assert.equal(history[1].contextDelivery.retrievalRequests,2);
 });
}

test('only the latest ten history entries keep their delivery record',()=>{
 let history=[];
 for(let i=0;i<15;i++)history=usageHistory({provider:'codex',executionId:'e'+i,generation:i+1,usageHistory:history},{inputTokens:1},`2026-10-06T01:${String(i).padStart(2,'0')}:00.000Z`,{task:{id:'t'},transition:'completion',contextDelivery:delivery()});
 assert.equal(history.length,15);
 assert.deepEqual(history.map(u=>Object.hasOwn(u,'contextDelivery')),[...Array(5).fill(false),...Array(10).fill(true)]);
});

test('comparison rows label failures and review runs',()=>{
 const rows=contextHistoryRows({checkpoint:{usageHistory:[
  {provider:'codex',executionId:'f',generation:1,completedAt:'2026-10-06T01:00:00.000Z',inputTokens:null,transition:'failure',phase:'master',contextDelivery:delivery({readiness:'blocked',promptBytes:null})},
  {provider:'claude',executionId:'r',generation:2,completedAt:'2026-10-06T02:00:00.000Z',inputTokens:5,transition:'completion',phase:'review',contextDelivery:delivery({provider:'claude'})},
 ]}});
 assert.match(rows[0],/claude 검토/);assert.match(rows[1],/· 실패/);
});

test('the comparison rows list this task\'s executions newest first with bytes, re-reads and reported tokens',()=>{
 const history=[
  {provider:'codex',executionId:'a',generation:1,completedAt:'2026-10-06T01:00:00.000Z',inputTokens:30000,outputTokens:500,cachedInputTokens:20000,transition:'completion',contextDelivery:delivery()},
  {provider:'claude',executionId:'b',generation:2,completedAt:'2026-10-06T02:00:00.000Z',inputTokens:null,outputTokens:null,transition:'failure'},
  {provider:'codex',executionId:'c',generation:3,completedAt:'2026-10-06T03:00:00.000Z',inputTokens:12000,outputTokens:400,transition:'completion',contextDelivery:delivery({readiness:'selected_ready',reader:true,contextBytes:40000,selectionSavedBytes:80000,omittedMessages:2,retrievalRequests:3,retrievalBytes:15000})},
 ];
 const rows=contextHistoryRows({checkpoint:{usageHistory:history}});
 assert.equal(rows.length,2);
 assert.match(rows[0],/codex.*선택 40KB.*재조회 3회 15KB.*프롬프트 150KB.*입력 토큰 12000/);
 assert.match(rows[1],/codex.*전문 120KB.*프롬프트 150KB.*입력 토큰 30000 \(캐시 20000\)/);
 assert.doesNotMatch(rows.join('\n'),/절감|saved/);
 assert.match(contextHistoryRows({checkpoint:{usageHistory:[{...history[0],inputTokens:null}]}})[0],/입력 토큰 미보고/);
 assert.deepEqual(contextHistoryRows({}),[]);
 const many=Array.from({length:15},(_,i)=>({...history[0],executionId:'x'+i,generation:i+1,completedAt:`2026-10-06T0${Math.floor(i/10)}:${String(i%60).padStart(2,'0')}:00.000Z`}));
 assert.equal(contextHistoryRows({checkpoint:{usageHistory:many}}).length,10);
});
