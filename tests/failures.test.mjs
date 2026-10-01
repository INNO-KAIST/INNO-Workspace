import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runnerError,failureInput,failureRecord,failureGuidance,retryHint} from '../public/core/failures.mjs';
test('retry hints reject invalid past and extreme times without promising reset',()=>{const now=Date.parse('2026-09-14T00:00:00Z');for(const value of [null,'','garbage','-1','0','999999999999','2020-01-01'])assert.equal(retryHint(value,now),null);assert.equal(retryHint('60',now),'2026-09-14T00:01:00.000Z');assert.equal(retryHint('Mon, 14 Sep 2026 00:02:00 GMT',now),'2026-09-14T00:02:00.000Z');});
test('unknown diagnostics remain private and no category automatically replays execution',()=>{for(const [error,kind] of [[Error('PRIVATE'),'unknown'],[Object.assign(Error('PRIVATE'),{code:'ECONNRESET'}),'connection'],[Error('not logged in PRIVATE'),'authentication']]){const input=failureInput(runnerError(error));const failure=failureRecord(input,new Date().toISOString());assert.equal(failure.kind,kind);assert.equal(failure.automaticRetry,false);assert.equal(JSON.stringify(failure).includes('PRIVATE'),false);const task={status:input.status,checkpoint:{failure}};assert.ok(failureGuidance(task));assert.equal(failureGuidance({...task,status:'running'}),null);}});

test('native network error codes remain connection failures at delivery boundary',()=>{assert.equal(failureInput(Object.assign(Error('PRIVATE'),{code:'ECONNRESET'})).failure.kind,'connection');});

test('output limit has actionable resource guidance without storing diagnostics',()=>{const input=failureInput(Object.assign(Error('PRIVATE'),{code:'OUTPUT_LIMIT'}));assert.equal(input.failure.kind,'resource');const failure=failureRecord(input,new Date().toISOString());const guide=failureGuidance({status:input.status,checkpoint:{failure}});assert.ok(guide.detail.includes('출력'));assert.equal(JSON.stringify(failure).includes('PRIVATE'),false);});

test('context preflight failure is fixed, actionable and never automatically retried',async()=>{
 const {ContextRetrievalRequiredError}=await import('../public/core/context-errors.mjs');
 const error=new ContextRetrievalRequiredError('PRIVATE context',{diagnostics:'PRIVATE diagnostics'});
 assert.ok(error instanceof Error);
 assert.equal(error.code,'CONTEXT_RETRIEVAL_REQUIRED');
 assert.equal(JSON.stringify(error).includes('PRIVATE'),false);
 assert.equal(error.message.includes('PRIVATE'),false);
 for(const candidate of [error,runnerError(error)]){
  const input=failureInput(candidate);
  assert.equal(input.status,'failed');assert.equal(input.failure.kind,'context');
  const failure=failureRecord(input,'2026-10-01T00:00:00.000Z');
  assert.equal(failure.automaticRetry,false);assert.equal(failure.retryNotBefore,null);
  assert.deepEqual(failureGuidance({status:input.status,checkpoint:{failure}}),{
   title:'작업 이력 전달 상한 초과',detail:'필수 작업 이력(요청·사용자 지시·체크포인트 포함)이 한 번에 전달할 수 있는 상한(384KB)을 넘어 실행을 시작하지 않았습니다. 내용을 잘라 보내지 않았습니다. 필요한 요청과 자료만 담아 새 작업으로 나누어 진행하세요.',retryNotBefore:null,
  });
  assert.equal(JSON.stringify({input,failure}).includes('PRIVATE'),false);
 }
});