import test from 'node:test';
import assert from 'node:assert/strict';
import {formatUsagePhase, formatUsageTransition, formatWallElapsed, formatRequestedModel} from '../public/core/usage-presentation.mjs';

test('verified stages and transitions are labelled without claiming unverified metadata',()=>{
 assert.equal(formatUsagePhase({phaseSource:'server_state',phase:'master'}),'마스터');
 assert.equal(formatUsagePhase({phaseSource:'server_state',phase:'child'}),'하위 작업');
 assert.equal(formatUsagePhase({phaseSource:'server_state',phase:'review'}),'검토');
 for(const [transition,label] of Object.entries({delegation:'위임',handoff:'인계',retry:'재시도',decision:'결정 대기',failure:'실패',completion:'완료'}))assert.equal(formatUsageTransition({phaseSource:'server_state',transition}),label);
 for(const row of [{phase:'review',transition:'completion'},{phaseSource:'server_state',phase:'unknown',transition:'unknown'},{phaseSource:'server_state',phase:'constructor',transition:'toString'},{phaseSource:'imported',phase:'child',transition:'failure'}]){
  assert.equal(formatUsagePhase(row),'확인 불가');
  assert.equal(formatUsageTransition(row),'확인 불가');
 }
});

test('server wall clock duration keeps milliseconds and long waits without rounding or fabricating zero',()=>{
 assert.equal(formatWallElapsed({phaseSource:'server_state',wallElapsedMs:0}),'0밀리초');
 assert.equal(formatWallElapsed({phaseSource:'server_state',wallElapsedMs:999}),'999밀리초');
 assert.equal(formatWallElapsed({phaseSource:'server_state',wallElapsedMs:1001}),'1초 1밀리초');
 assert.equal(formatWallElapsed({phaseSource:'server_state',wallElapsedMs:90061001}),'1일 1시간 1분 1초 1밀리초');
 assert.equal(formatWallElapsed({phaseSource:'server_state',wallElapsedMs:Number.MAX_SAFE_INTEGER}),'104249991일 8시간 59분 991밀리초');
 for(const row of [{},{wallElapsedMs:0},{phaseSource:'server_state',wallElapsedMs:null},{phaseSource:'server_state',wallElapsedMs:-1},{phaseSource:'server_state',wallElapsedMs:1.5}])assert.equal(formatWallElapsed(row),'확인 불가');
});

test('requested model is separate from unknown actual version and unavailable for old records',()=>{
 assert.equal(formatRequestedModel({phaseSource:'server_state',requestedModel:'gpt-test'}),'gpt-test');
 assert.equal(formatRequestedModel({phaseSource:'server_state',requestedModel:null}),'확인 불가');
 assert.equal(formatRequestedModel({requestedModel:'forged'}),'확인 불가');
});
