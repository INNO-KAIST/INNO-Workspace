import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewObservationSection,createReviewObservationRecovery} from '../public/review-observation-ui.mjs';
import {WorkspaceClient} from '../public/core/client.mjs';

const parent=()=>({
 id:'parent',version:7,status:'completed',checkpoint:{status:'completed',executionId:'review-current',generation:2},
 delegation:{state:'completed',batchId:'batch-current',epoch:3,children:[
  {taskId:'child-a',role:'첫 검토',provider:'codex'},
  {taskId:'child-b',role:'둘째 검토',provider:'claude'},
 ]},
 reviewObservation:{reviewExecutionId:'review-current',reviewGeneration:2,batchId:'batch-current',epoch:3,children:[
  {childTaskId:'child-a',status:'recorded',reason:'profile_scoped_observation',attempts:0,nextAt:null},
  {childTaskId:'child-b',status:'duplicate',reason:'duplicate_execution',attempts:0,nextAt:null},
 ]},
});
const failedParent=()=>{const task=parent();task.reviewObservation.children[0]={childTaskId:'child-a',status:'failed',reason:'storage_error',attempts:3,nextAt:null};return task;};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function recoveryFixture(){
 const context={client:{remote:true},task:failedParent(),epoch:1,capabilities:{reviewObservationRecovery:true}},notices=[],changes=[];
 const recovery=createReviewObservationRecovery({getContext:()=>context,onChange:()=>changes.push(context.task?.id),onNotice:message=>notices.push(message)});
 return {context,notices,changes,recovery};
}

test('completed parent snapshot shows recorded and duplicate storage states without claiming quality',()=>{
 const html=reviewObservationSection(parent());
 assert.match(html,/첫 검토.*정책 관측 저장됨/s);
 assert.match(html,/둘째 검토.*기존 정책 관측 기록 확인됨/s);
 assert.match(html,/품질 통과나 자동 승격을 뜻하지 않습니다/);
 assert.match(html,/작업 결과와 별도/);
 assert.doesNotMatch(html,/<button|data-retry|정책 품질 통과/);
});

test('actual saved observation reason keys have clear labels',()=>{
 const task=parent();task.reviewObservation.children[0].reason='recorded';
 assert.match(reviewObservationSection(task),/정책 관측이 기록됐습니다/);
 task.reviewObservation.children[0].reason='critical_regression';
 assert.match(reviewObservationSection(task),/중대한 품질 문제의 관측이 기록됐습니다/);
});

test('current completed parent identity gates all stored success labels',()=>{
 for(const change of [
  task=>{task.reviewObservation.reviewExecutionId='review-old';},
  task=>{task.reviewObservation.reviewGeneration=1;},
  task=>{task.reviewObservation.batchId='batch-old';},
  task=>{task.reviewObservation.epoch=2;},
  task=>{delete task.reviewObservation;},
  task=>{task.reviewObservation.children[1].childTaskId='old-child';},
  task=>{task.reviewObservation.children[1].childTaskId='child-a';},
  task=>{task.reviewObservation.children.push({childTaskId:'old-child',status:'recorded'});},
  task=>{task.delegation.children[1].taskId='child-a';},
  task=>{delete task.checkpoint.executionId;delete task.reviewObservation.reviewExecutionId;},
  task=>{delete task.delegation.batchId;delete task.reviewObservation.batchId;},
  task=>{task.checkpoint.executionId=123;task.reviewObservation.reviewExecutionId=123;},
  task=>{task.delegation.batchId=123;task.reviewObservation.batchId=123;},
  task=>{task.checkpoint.generation=0;task.reviewObservation.reviewGeneration=0;},
 ]){
  const task=parent();change(task);
  const html=reviewObservationSection(task);
  assert.match(html,/관측 상태 미확인/);
  assert.doesNotMatch(html,/정책 관측 저장됨|기존 정책 관측 기록 확인됨/);
 }
 for(const change of [task=>{task.status='running';},task=>{task.delegation.state='reviewing';},task=>{task.parentTaskId='other';}]){
  const task=parent();change(task);
  assert.equal(reviewObservationSection(task),'');
 }
});

test('pending, retry, failed, missing policy and unattributable states describe storage separately from work result',()=>{
 const cases=[
  [{status:'pending',attempts:0},/정책 관측 저장 대기/],
  [{status:'retry',reason:'storage_error',attempts:1,nextAt:'2026-09-28T10:00:00.000Z'},/다음 저장 재시도 시각.*2026/s],
  [{status:'failed',reason:'storage_error',attempts:3,nextAt:null},/자동 재시도 종료.*작업 결과는 유지.*AI를 다시 실행하지 않습니다/s],
  [{status:'policy_missing',reason:'policy_missing',attempts:0},/모델 정책이 없어 관측을 저장하지 못했습니다/],
  [{status:'not_attributable',reason:'saved_profile_missing',attempts:0},/현재 배정 정책에 연결할 수 없습니다.*저장된 작업군 정보가 없습니다/s],
 ];
 for(const [row,expected] of cases){
  const task=parent();task.reviewObservation.children[0]={childTaskId:'child-a',...row};
  const html=reviewObservationSection(task);
  assert.match(html,expected);
  assert.equal(task.status,'completed');
  assert.doesNotMatch(html,/<button|data-retry/);
 }
});

test('unknown values are bounded and escaped; malformed rows never expose raw status or reason',()=>{
 const task=parent();task.delegation.children[0].role='<script>alert(1)</script>'+'x'.repeat(300);
 task.reviewObservation.children[0]={childTaskId:'child-a',status:'<img src=x onerror=alert(1)>',reason:'<svg onload=alert(1)>'};
 const html=reviewObservationSection(task);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script|<img|<svg|onerror|onload|x{100}/);
 assert.match(html,/관측 상태 미확인/);
 assert.ok(html.length<1800);
 task.reviewObservation.children[0]={childTaskId:'child-a',status:'not_attributable',reason:'constructor',attempts:0};
 const unknownReason=reviewObservationSection(task);
 assert.match(unknownReason,/원인 미확인/);
 assert.doesNotMatch(unknownReason,/function Object|constructor/);
});

test('existing task snapshot supplies diagnostics without a new request or action',()=>{
 const state={tasks:[parent()]};
 const selected=state.tasks.find(task=>task.id==='parent');
 const html=reviewObservationSection(selected);
 assert.match(html,/정책 관측 기록/);
 assert.equal((html.match(/class="review-observation-row(?:\s|")/g)||[]).length,2);
 assert.doesNotMatch(html,/href=|<button|data-action/);
});

test('remote client sends only explicit saved-observation recovery POST',async()=>{
 const client=new WorkspaceClient({remote:true,baseUrl:'https://example.test'}),calls=[];
 client.request=async(path,body)=>{calls.push({path,body});return {task:failedParent(),requeued:1};};
 const input={operation:'retry_failed',expectedVersion:7,reviewExecutionId:'review-current',reviewGeneration:2,batchId:'batch-current',epoch:3};
 assert.equal((await client.retryReviewObservations('parent/one',input)).requeued,1);
 assert.deepEqual(calls,[{path:'/api/tasks/parent%2Fone/review-observations',body:input}]);
 await assert.rejects(new WorkspaceClient().retryReviewObservations('parent',input),/서버 연결/);
});

test('failed completed review shows one saved-results recovery action only when supported',()=>{
 const f=recoveryFixture();
 assert.match(reviewObservationSection(f.context.task,{recovery:f.recovery.control()}),/관측 기록 다시 수집/);
 assert.match(reviewObservationSection(f.context.task,{recovery:f.recovery.control()}),/저장된 검토 결과.*AI를 다시 실행하지 않습니다.*다음 정기 처리/s);
 f.context.capabilities.reviewObservationRecovery=false;
 assert.doesNotMatch(reviewObservationSection(f.context.task,{recovery:f.recovery.control()}),/<button/);
 f.context.capabilities.reviewObservationRecovery=true;f.context.client.remote=false;
 assert.doesNotMatch(reviewObservationSection(f.context.task,{recovery:f.recovery.control()}),/<button/);
 f.context.client.remote=true;f.context.task.reviewObservation.reviewGeneration=1;
 assert.doesNotMatch(reviewObservationSection(f.context.task,{recovery:f.recovery.control()}),/<button/);
 f.context.task=failedParent();f.context.task.reviewObservation.children[1].status='unknown';
 assert.doesNotMatch(reviewObservationSection(f.context.task,{recovery:f.recovery.control()}),/<button/);
});

test('duplicate click stays disabled through rerenders and refreshes once after an acknowledged POST',async()=>{
 const f=recoveryFixture(),pending=deferred(),calls=[];let reads=0;
 f.context.client.retryReviewObservations=(id,input)=>{calls.push({id,input});return pending.promise;};
 f.context.client.refresh=async()=>{reads++;f.context.task={...f.context.task,version:8,reviewObservation:{...f.context.task.reviewObservation,children:f.context.task.reviewObservation.children.map((row,i)=>i?row:{...row,status:'pending',attempts:0,nextAt:null})}};};
 const first=f.recovery.retry();const second=f.recovery.retry();
 assert.equal(calls.length,1);assert.equal(f.recovery.control().disabled,true);
 assert.match(reviewObservationSection(f.context.task,{recovery:f.recovery.control()}),/disabled/);
 pending.resolve({task:{...f.context.task,version:8},requeued:1});await Promise.all([first,second]);
 assert.equal(reads,1);assert.equal(f.changes.length,2);assert.equal(f.recovery.control(),null);
 assert.doesNotMatch(reviewObservationSection(f.context.task,{recovery:f.recovery.control()}),/<button/);
 assert.deepEqual(calls[0],{id:'parent',input:{operation:'retry_failed',expectedVersion:7,reviewExecutionId:'review-current',reviewGeneration:2,batchId:'batch-current',epoch:3}});
});

test('task switch or client replacement drops delayed response without refresh, render or old notice',async()=>{
 for(const switchContext of [context=>{context.task={...failedParent(),id:'other'};context.epoch++;},context=>{context.client={remote:true,refresh:async()=>{throw Error('wrong account')}};context.epoch++;}]){
  const f=recoveryFixture(),pending=deferred();let reads=0;
  f.context.client.retryReviewObservations=()=>pending.promise;f.context.client.refresh=async()=>{reads++;};
  const running=f.recovery.retry();switchContext(f.context);pending.resolve({task:{...failedParent(),version:8},requeued:1});await running;
  assert.equal(reads,0);assert.deepEqual(f.notices,[]);assert.deepEqual(f.changes,['parent']);
 }
});

test('uncertain POST and failed refresh lock mutation until explicit read-only confirmation',async()=>{
 const f=recoveryFixture();let posts=0,reads=0,failRead=true;
 f.context.client.retryReviewObservations=async()=>{posts++;throw Error('connection lost');};
 f.context.client.refresh=async()=>{reads++;if(failRead)throw Error('offline');};
 await f.recovery.retry();assert.equal(posts,1);assert.equal(reads,1);
 assert.equal(f.recovery.control().mode,'verify');
 assert.match(reviewObservationSection(f.context.task,{recovery:f.recovery.control()}),/상태 다시 확인/);
 await f.recovery.retry();assert.equal(posts,1);
 await f.recovery.verify();assert.equal(reads,2);assert.equal(posts,1);assert.equal(f.recovery.control().mode,'verify');
 failRead=false;await f.recovery.verify();assert.equal(reads,3);assert.equal(f.recovery.control().mode,'retry');
 await f.recovery.retry();assert.equal(posts,2);assert.equal(reads,4);
});

test('a 409 refreshes once and a still-failed row needs another explicit click',async()=>{
 const f=recoveryFixture();let posts=0,reads=0;
 f.context.client.retryReviewObservations=async()=>{posts++;throw Object.assign(Error('version conflict'),{status:409});};
 f.context.client.refresh=async()=>{reads++;};
 await f.recovery.retry();assert.equal(posts,1);assert.equal(reads,1);
 assert.equal(f.recovery.control().mode,'retry');assert.match(f.notices.at(-1),/최신 상태/);
 assert.equal(posts,1);
 await f.recovery.retry();assert.equal(posts,2);
});

test('uncertain POST with successful confirmation GET permits only a new explicit click',async()=>{
 const f=recoveryFixture();let posts=0,reads=0;
 f.context.client.retryReviewObservations=async()=>{posts++;throw Error('connection lost');};
 f.context.client.refresh=async()=>{reads++;};
 await f.recovery.retry();
 assert.equal(posts,1);assert.equal(reads,1);assert.equal(f.recovery.control().mode,'retry');
 await Promise.resolve();assert.equal(posts,1);
 await f.recovery.retry();assert.equal(posts,2);
});

test('same selected task with a new review identity redraws fresh state without old notice',async()=>{
 const f=recoveryFixture();let reads=0;
 f.context.client.retryReviewObservations=async()=>({requeued:1});
 f.context.client.refresh=async()=>{reads++;f.context.task={...failedParent(),version:8,checkpoint:{...f.context.task.checkpoint,executionId:'review-next'},reviewObservation:{...f.context.task.reviewObservation,reviewExecutionId:'review-next'}};};
 await f.recovery.retry();
 assert.equal(reads,1);assert.deepEqual(f.changes,['parent','parent']);assert.deepEqual(f.notices,[]);
});

test('late confirmation for an old review cannot unlock a newer uncertain review',async()=>{
 const f=recoveryFixture(),oldRead=deferred();let reads=0;
 f.context.client.retryReviewObservations=async()=>{throw Error('connection lost');};
 f.context.client.refresh=()=>++reads===1?oldRead.promise:Promise.reject(Error('offline'));
 const old=f.recovery.retry();await Promise.resolve();
 f.context.task={...failedParent(),version:8,checkpoint:{...f.context.task.checkpoint,executionId:'review-next'},reviewObservation:{...f.context.task.reviewObservation,reviewExecutionId:'review-next'}};
 await f.recovery.retry();assert.equal(f.recovery.control().mode,'verify');
 oldRead.resolve();await old;
 assert.equal(f.recovery.control().mode,'verify');
});

test('old review read failure cannot re-enable a newer in-flight recovery',async()=>{
 const f=recoveryFixture(),oldRead=deferred(),newPost=deferred();let posts=0;
 f.context.client.retryReviewObservations=()=>++posts===1?Promise.reject(Error('old connection lost')):newPost.promise;
 f.context.client.refresh=()=>oldRead.promise;
 const old=f.recovery.retry();await Promise.resolve();
 f.context.task={...failedParent(),version:8,checkpoint:{...f.context.task.checkpoint,executionId:'review-next'},reviewObservation:{...f.context.task.reviewObservation,reviewExecutionId:'review-next'}};
 const next=f.recovery.retry();assert.equal(f.recovery.control().disabled,true);
 oldRead.reject(Error('old read failed'));await old;
 assert.equal(f.recovery.control().disabled,true);
 newPost.resolve({requeued:1});await next;
});
