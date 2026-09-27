import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceClient} from '../public/core/client.mjs';
import {createModelPolicyUI,modelPolicyChoices,modelPolicyOutcome} from '../public/model-policy-ui.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fakeDialog(){
 const listeners={},content={innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';this.textContent='';},querySelectorAll(){return [];},querySelector(){return {value:'0'};}},error={textContent:''},notice={textContent:''};
 const dialog={open:false,querySelector(selector){return ({'[data-policy-content]':content,'[data-policy-error]':error,'[data-policy-notice]':notice})[selector];},addEventListener(name,fn){listeners[name]=fn;},showModal(){this.open=true;},close(){this.open=false;listeners.close?.();},click(action,candidate='next'){return listeners.click({target:{closest:()=>({dataset:{policyAction:action,candidate}})}});}};
 return {dialog,content,error,notice};
}
const policyResponse=(version=1)=>({assignment:{provider:'codex',model:'gpt-old',effort:'low',selection:{reason:'existing_route_pending_evidence',policyVersion:1}},accountAvailability:{source:'desktop_account_catalog',status:'fresh',observedAt:1,expiresAt:10000,models:[{model:'gpt-old',efforts:['low']},{model:'gpt-next',efforts:['low']}]},policy:{stateVersion:version,policyVersion:1,baselineId:'baseline',activeId:'baseline',minSamples:3,observationCount:0,candidates:[{id:'baseline',model:'gpt-old',effort:'low',status:'active'},{id:'next',model:'gpt-next',effort:'low',status:'candidate'}]},route:{status:'fallback',model:'gpt-old',effort:'low',reason:'existing_route_pending_evidence'}});
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
