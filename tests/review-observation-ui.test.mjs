import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewObservationSection} from '../public/review-observation-ui.mjs';

const parent=()=>({
 id:'parent',status:'completed',checkpoint:{status:'completed',executionId:'review-current',generation:2},
 delegation:{state:'completed',batchId:'batch-current',epoch:3,children:[
  {taskId:'child-a',role:'첫 검토',provider:'codex'},
  {taskId:'child-b',role:'둘째 검토',provider:'claude'},
 ]},
 reviewObservation:{reviewExecutionId:'review-current',reviewGeneration:2,batchId:'batch-current',epoch:3,children:[
  {childTaskId:'child-a',status:'recorded',reason:'profile_scoped_observation',attempts:0,nextAt:null},
  {childTaskId:'child-b',status:'duplicate',reason:'duplicate_execution',attempts:0,nextAt:null},
 ]},
});

test('completed parent snapshot shows recorded and duplicate storage states without claiming quality',()=>{
 const html=reviewObservationSection(parent());
 assert.match(html,/첫 검토.*정책 관측 저장됨/s);
 assert.match(html,/둘째 검토.*기존 정책 관측 기록 확인됨/s);
 assert.match(html,/품질 통과나 자동 승격을 뜻하지 않습니다/);
 assert.match(html,/작업 결과와 별도/);
 assert.doesNotMatch(html,/<button|data-retry|정책 품질 통과/);
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
