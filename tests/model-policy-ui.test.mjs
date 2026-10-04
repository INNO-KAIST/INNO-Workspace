import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceClient} from '../public/core/client.mjs';
import {createModelPolicyUI,modelPolicyChoices,modelPolicyOutcome} from '../public/model-policy-ui.mjs';
import {createSelectionState,recordObservation,selectAssignment} from '../public/core/model-selection.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fakeDialog(){
 const listeners={},content={innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';this.textContent='';},querySelectorAll(){return [];},querySelector(){return {value:'0'};}},error={textContent:''},notice={textContent:''};
 const dialog={open:false,querySelector(selector){return ({'[data-policy-content]':content,'[data-policy-error]':error,'[data-policy-notice]':notice})[selector];},addEventListener(name,fn){listeners[name]=fn;},showModal(){this.open=true;},close(){this.open=false;listeners.close?.();},click(action,candidate='next'){return listeners.click({target:{closest:()=>({dataset:{policyAction:action,candidate}})}});}};
 return {dialog,content,error,notice};
}
const policyResponse=(version=1)=>({assignment:{provider:'codex',model:'gpt-old',effort:'low',selection:{reason:'existing_route_pending_evidence',policyVersion:1}},accountAvailability:{source:'desktop_account_catalog',status:'fresh',observedAt:1,expiresAt:10000,models:[{model:'gpt-old',efforts:['low']},{model:'gpt-next',efforts:['low']}]},policy:{stateVersion:version,policyVersion:1,baselineId:'baseline',activeId:'baseline',minSamples:3,observationCount:0,candidates:[{id:'baseline',model:'gpt-old',effort:'low',status:'active'},{id:'next',model:'gpt-next',effort:'low',status:'candidate'}]},route:{status:'fallback',candidateId:'baseline',model:'gpt-old',effort:'low',reason:'existing_route_pending_evidence'}});
const policyContext=client=>({client,activeTaskId:'parent',epoch:1,capabilities:{modelPolicyManagement:true},tasks:[{id:'child',parentTaskId:'parent',assignment:{selection:{profile:{}}}}]});

test('policy client uses authenticated task route without altering the task snapshot',async()=>{
 const client=new WorkspaceClient({remote:true,baseUrl:'https://example.test'});
 client.state.tasks=[{id:'child',version:7,assignment:{requestedModel:'old'}}];
 const calls=[];client.request=async(path,body)=>{calls.push({path,body});return {policy:{stateVersion:2}};};
 assert.equal((await client.readModelPolicy('child/one')).policy.stateVersion,2);
 assert.equal((await client.changeModelPolicy('child/one',{operation:'initialize',expectedStateVersion:0})).policy.stateVersion,2);
 assert.deepEqual(calls,[{path:'/api/tasks/child%2Fone/model-policy',body:undefined},{path:'/api/tasks/child%2Fone/model-policy',body:{operation:'initialize',expectedStateVersion:0}}]);
 assert.equal(client.state.tasks[0].version,7);
 await assert.rejects(()=>new WorkspaceClient().readModelPolicy('child'),/서버 연결/);
});

test('candidate choices come only from server account rows and claimed efforts',()=>{
 assert.deepEqual(modelPolicyChoices({models:[{model:'gpt-test',efforts:['low','high']},{model:'claude-alias',efforts:['medium']}]}),[
  {model:'gpt-test',effort:'low'},{model:'gpt-test',effort:'high'},{model:'claude-alias',effort:'medium'},
 ]);
 assert.deepEqual(modelPolicyChoices({status:'expired'}),[]);
});

test('promotion hold and success, withdrawal fallback are described without quality claims',()=>{
 assert.match(modelPolicyOutcome('promote',{reason:'unobserved_model_version'}),/승격 보류/);
 assert.match(modelPolicyOutcome('promote',{reason:'profile_scoped_evidence'}),/승격했습니다/);
 assert.match(modelPolicyOutcome('withdraw',{reason:'restored_previous'}),/이전 경로로 복구/);
 assert.match(modelPolicyOutcome('withdraw',{reason:'safe_fallback_required'}),/확인을 기다립니다/);
 assert.doesNotMatch(modelPolicyOutcome('register_candidate',{}),/검증됐|동일 품질/);
});

test('baseline critical hold is explained in Korean without changing the policy dialog flow',async()=>{
 assert.match(modelPolicyOutcome('promote',{reason:'baseline_critical_regression'}),/기준 모델의 중대한 품질 문제/);
 const profile={family:'dialog',requirementsVersion:'r1',evaluationVersion:'e1',criteria:['correct'],requiredCapabilities:['text'],contextClass:'general'};
 const baseline={id:'baseline',provider:'codex',model:'gpt-old',modelVersion:'v1',effort:'low'};
 const initial=createSelectionState({profile,baseline});
 const critical={id:'review-critical',provider:'codex',executionId:'execution-critical',generation:1,candidateId:'baseline',modelVersion:'v1',comparisonId:'comparison-critical',profile,observedAt:1000,source:'normal_execution',quality:{source:'independent_review',critical:true,criteria:[{id:'correct',status:'fail'}]}};
 const state=recordObservation(initial,critical,{now:1000}).state;
 const route=selectAssignment(state,{profile,now:1000});
 assert.equal(route.reason,'baseline_critical_regression');
 const response=policyResponse();response.policy.activeId=state.activeId;response.policy.candidates=state.candidates;response.route=route;
 const client={remote:true,readModelPolicy:async()=>response};const view=fakeDialog();
 const ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>policyContext(client)});await ui.open('child');
 assert.match(view.content.innerHTML,/기준 모델의 중대한 품질 문제/);
 assert.match(view.content.innerHTML,/다음 배정 대기/);
 assert.match(view.content.innerHTML,/철회/);
 ui.close();
});

test('policy capacity fallback explains the frozen assignment in Korean',async()=>{
 const response=policyResponse();response.policy=null;response.route=null;
 response.assignment.selection={reason:'policy_capacity_unavailable',policyVersion:null};
 const client={remote:true,readModelPolicy:async()=>response},view=fakeDialog();
 const ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>policyContext(client)});
 await ui.open('child');
 assert.match(view.content.innerHTML,/정책 저장 한도/);
 assert.doesNotMatch(view.content.innerHTML,/policy_capacity_unavailable/);
 ui.close();
});

test('failed first read can be retried and older overlapping read cannot replace the latest response',async()=>{
 const pending=[];const client={remote:true,readModelPolicy:()=>{const next=deferred();pending.push(next);return next.promise;}};
 const view=fakeDialog(),ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>policyContext(client)});
 const first=ui.open('child');pending[0].reject(Error('offline'));await first;
 assert.match(view.error.textContent,/offline/);
 const retry=view.dialog.click('refresh');pending[1].resolve(policyResponse(2));await retry;
 assert.match(view.content.innerHTML,/정책 버전 1/);
 const older=view.dialog.click('refresh');const newer=view.dialog.click('refresh');
 // Busy prevents the second manual refresh; closing and reopening creates a new generation.
 ui.close();const reopened=ui.open('child');pending[3].resolve(policyResponse(4));await reopened;
 pending[2].resolve(policyResponse(3));await older;await newer;
 assert.match(view.content.innerHTML,/관측 기록 0건/);
 ui.close();
});

test('old mutation cannot unlock or alter a reopened dialog after the account changes',async()=>{
 const writes=[];const client={remote:true,readModelPolicy:async()=>policyResponse(),changeModelPolicy:()=>{const next=deferred();writes.push(next);return next.promise;}};
 let context=policyContext(client);const view=fakeDialog(),ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>context});
 await ui.open('child');const oldWrite=view.dialog.click('promote');ui.close();
 context={...context,epoch:2};await ui.open('child');const newWrite=view.dialog.click('promote');
 writes[0].resolve({...policyResponse(2),reason:'unobserved_model_version'});await oldWrite;
 await view.dialog.click('promote');assert.equal(writes.length,2);
 writes[1].resolve({...policyResponse(2),reason:'profile_scoped_evidence'});await newWrite;
 assert.match(view.notice.textContent,/승격했습니다/);
});

test('Claude candidate label identifies built-in aliases and unverified account access',async()=>{
 const response=policyResponse();response.assignment.provider='claude';response.accountAvailability={provider:'claude',source:'built_in_catalog',status:'static_supported_models_unverified',observedAt:null,expiresAt:null,models:[{model:'sonnet',efforts:['low']}]};
 const client={remote:true,readModelPolicy:async()=>response};const view=fakeDialog();
 const ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>policyContext(client)});await ui.open('child');
 assert.match(view.content.innerHTML,/역할 별칭과 계획의 검토 강도 \(계정 사용 가능성 미확인\)/);
 assert.doesNotMatch(view.content.innerHTML,/계정 목록의 모델과 검토 강도/);
 ui.close();
});

test('pinning the effective active policy sends its state version and renders the pinned route',async()=>{
 const writes=[];const response=policyResponse(7);
 const client={remote:true,readModelPolicy:async()=>response,changeModelPolicy:async(_id,input)=>{
  writes.push(input);return {...policyResponse(8),policy:{...policyResponse(8).policy,pin:{candidateId:'baseline'}},route:{status:'selected',candidateId:'baseline',model:'gpt-old',effort:'low',reason:'manual_pin_selected'},reason:'manual_pin_set'};
 }};
 const view=fakeDialog(),ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>policyContext(client)});
 await ui.open('child');
 assert.match(view.content.innerHTML,/data-policy-action="pin"/);
 await view.dialog.click('pin');
 assert.deepEqual(writes,[{operation:'pin',candidateId:'baseline',expectedStateVersion:7}]);
 assert.match(view.notice.textContent,/고정/);
 assert.match(view.content.innerHTML,/고정 중/);
 assert.match(view.content.innerHTML,/gpt-old/);
 assert.match(view.content.innerHTML,/실제 모델 버전 미확인/);
 assert.match(view.content.innerHTML,/동일 품질을 보장하지 않습니다/);
 assert.doesNotMatch(view.content.innerHTML,/data-policy-action="promote"/);
 assert.match(view.content.innerHTML,/data-policy-action="withdraw"/);
 ui.close();
});

test('pin action is absent when active route is missing or points elsewhere',async()=>{
 for(const alter of [response=>{response.policy.activeId=null;},response=>{response.route.candidateId='next';},response=>{response.route.status='wait';}]){
  const response=policyResponse();alter(response);const writes=[];
  const client={remote:true,readModelPolicy:async()=>response,changeModelPolicy:async(_id,input)=>{writes.push(input);return response;}};
  const view=fakeDialog(),ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>policyContext(client)});
  await ui.open('child');assert.doesNotMatch(view.content.innerHTML,/data-policy-action="pin"/);
  await view.dialog.click('pin');assert.equal(writes.length,0);ui.close();
 }
});

test('pinned unavailable route offers unpin and active withdrawal without claiming a valid route',async()=>{
 const response=policyResponse(4);response.policy.activeId='next';response.policy.pin={candidateId:'next'};response.policy.candidates[0].status='candidate';response.policy.candidates[1].status='active';response.route={status:'wait',reason:'pinned_route_unavailable'};
 const writes=[];const client={remote:true,readModelPolicy:async()=>response,changeModelPolicy:async(_id,input)=>{writes.push(input);return {...policyResponse(5),reason:'manual_pin_cleared'};}};
 const view=fakeDialog(),ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>policyContext(client)});
 await ui.open('child');
 assert.match(view.content.innerHTML,/고정 중/);
 assert.match(view.content.innerHTML,/가용성/);
 assert.match(view.content.innerHTML,/data-policy-action="unpin"/);
 assert.match(view.content.innerHTML,/data-policy-action="withdraw"/);
 assert.doesNotMatch(view.content.innerHTML,/data-policy-action="promote"/);
 await view.dialog.click('promote');assert.equal(writes.length,0);
 await view.dialog.click('unpin');
 assert.deepEqual(writes,[{operation:'unpin',expectedStateVersion:4}]);
 assert.match(view.notice.textContent,/자동.*승격|승격.*자동/);
 ui.close();
});

test('pin conflict refreshes the projection and stale pin completion cannot alter a reopened dialog',async()=>{
 const pending=deferred();let reads=0,writes=0;
 const client={remote:true,readModelPolicy:async()=>{reads++;return policyResponse(reads);},changeModelPolicy:()=>{writes++;return writes===1?Promise.reject(Object.assign(Error('conflict'),{status:409})):pending.promise;}};
 let context=policyContext(client);const view=fakeDialog(),ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>context});
 await ui.open('child');await view.dialog.click('pin');
 assert.equal(reads,2);assert.match(view.error.textContent,/최신 내용을 다시 확인/);
 const stale=view.dialog.click('pin');ui.close();context={...context,epoch:2};await ui.open('child');
 pending.resolve({...policyResponse(10),reason:'manual_pin_set'});await stale;
 assert.equal(view.notice.textContent,'');assert.equal(writes,2);
 ui.close();
});

test('unversioned routes are described as execution-route observations with their limits',async()=>{
 assert.match(modelPolicyOutcome('promote',{reason:'insufficient_current_route_evidence'}),/현재 사용 중인 경로와의 직접 비교 근거 부족/);
 assert.match(modelPolicyOutcome('promote',{reason:'unobserved_model_version'}),/실제 적용 실행 경로 관측 없음/);
 const response=policyResponse();response.policy.activeId='next';response.policy.candidates[0].status='testing';response.policy.candidates[1].status='active';
 response.route={status:'selected',candidateId:'next',model:'gpt-next',effort:'low',modelVersion:null,reason:'matched_quality_and_measured_efficiency'};
 const client={remote:true,readModelPolicy:async()=>response},view=fakeDialog(),ui=createModelPolicyUI({dialog:view.dialog,getContext:()=>policyContext(client)});
 await ui.open('child');
 assert.match(view.content.innerHTML,/이 실행 경로의 관측 결과/);
 assert.match(view.content.innerHTML,/추가 비교 예산이 0/);
 assert.doesNotMatch(view.content.innerHTML,/자동 승격/);
 assert.match(modelPolicyOutcome('withdraw',{reason:'safe_fallback_required'}),/기준 경로를 계정 목록에서 다시 확인/);
 assert.doesNotMatch(view.content.innerHTML,/실제 모델 버전과 동일 조건의 비교 근거를 더 연결해야/);
 ui.close();
 const claude=policyResponse();claude.assignment.provider='claude';claude.route={status:'selected',candidateId:'next',model:'haiku',effort:'low',modelVersion:null,reason:'matched_quality_and_measured_efficiency'};
 claude.accountAvailability={source:'built_in_catalog',status:'static_supported_models_unverified',observedAt:null,expiresAt:null,models:[{model:'haiku',efforts:['low']}]};
 const claudeClient={remote:true,readModelPolicy:async()=>claude},claudeView=fakeDialog(),claudeUI=createModelPolicyUI({dialog:claudeView.dialog,getContext:()=>policyContext(claudeClient)});
 await claudeUI.open('child');
 assert.match(claudeView.content.innerHTML,/실행 경로 근거가 없어 승격 대상이 아닙니다/);
 assert.doesNotMatch(claudeView.content.innerHTML,/이 실행 경로의 관측 결과/);
 claudeUI.close();
 const lapsed=policyResponse();lapsed.policy.activeId='next';lapsed.policy.candidates[1].status='active';
 lapsed.route={status:'fallback',candidateId:'baseline',model:'gpt-old',effort:'low',modelVersion:null,reason:'active_route_not_current'};
 const lapsedClient={remote:true,readModelPolicy:async()=>lapsed},lapsedView=fakeDialog(),lapsedUI=createModelPolicyUI({dialog:lapsedView.dialog,getContext:()=>policyContext(lapsedClient)});
 await lapsedUI.open('child');
 assert.match(lapsedView.content.innerHTML,/사용 중 경로의 근거가 만료됐거나 계정 목록에 없어 기준 경로로 배정/);
 lapsedUI.close();
});
