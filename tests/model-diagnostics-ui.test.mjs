import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDiscovery,renderRetention,createModelDiagnosticsUI} from '../public/model-diagnostics-ui.mjs';
import {WorkspaceClient} from '../public/core/client.mjs';

test('official discovery stays candidate evidence, bounds rows, escapes text and allowlists links',()=>{
 const candidates=Array.from({length:120},(_,i)=>({provider:'openai',id:i===0?'<script>':'model-'+i,sourceUrl:'https://evil.example/x',accountAvailability:'fresh',promotionStatus:'active'}));
 const html=renderDiscovery({sources:[{provider:'openai',url:'https://evil.example/x',status:'stale',verifiedAt:1,expiresAt:2,nextAttemptAt:3,lastError:'<bad>'}],candidates});
 assert.match(html,/공식 문서 후보/);
 assert.match(html,/계정 사용 가능성 및 품질 미확인/);
 assert.doesNotMatch(html,/<script>|https:\/\/evil\.example/);
 assert.match(html,/&lt;script&gt;/);
 assert.equal((html.match(/class="model-diagnostic-candidate"/g)||[]).length,100);
});

test('known source kinds and errors explain what the official evidence means',()=>{
 const html=renderDiscovery({sources:[
  {provider:'openai',url:'https://developers.openai.com/api/docs/models.md',status:'stale',lastError:'network_error'},
  {provider:'claude',url:'https://code.claude.com/docs/en/model-config.md',status:'fresh'},
 ],candidates:[{provider:'openai',id:'gpt-example',kind:'documentation_slug'},{provider:'claude',id:'sonnet',kind:'alias'}]});
 assert.match(html,/재확인 필요/);assert.match(html,/네트워크 조회 실패/);
 assert.match(html,/API 모델 문서 목록/);assert.match(html,/Claude Code 역할 별칭/);
 assert.match(html,/모델 문서 항목/);assert.match(html,/역할 별칭/);
 assert.doesNotMatch(html,/network_error|documentation_slug/);
 assert.match(renderRetention({status:'deferred',lastError:'pin_scan_deferred'}),/작업 근거 확인 지연/);
});

test('retention shows status, counts, exceptions, and timestamps without cost claims',()=>{
 const html=renderRetention({status:'deferred',removed:4,retainedExceptions:2,deferredCount:3,failedCount:1,lastAttemptAt:1,lastCleanupAt:2,nextAt:3,lastError:'<bad>'});
 assert.match(html,/지연/);assert.match(html,/정리 4건/);assert.match(html,/보존 예외 2건/);
 assert.match(html,/&lt;bad&gt;/);assert.doesNotMatch(html,/비용|가격/);
 for(const status of ['never_run','running','complete','failed'])assert.ok(renderRetention({status}).length>0);
});

test('client exposes read-only diagnostics requests only on remote',async()=>{
 const local=new WorkspaceClient();await assert.rejects(local.readModelDiscovery(),/서버 연결/);
 await assert.rejects(local.readModelPolicyRetention(),/서버 연결/);
 const remote=new WorkspaceClient({remote:true});const paths=[];remote.request=async path=>{paths.push(path);return {}};
 await remote.readModelDiscovery();await remote.readModelPolicyRetention();
 assert.deepEqual(paths,['/api/model-discovery','/api/model-policy-retention']);
});

test('open coalesces requests and drops old connection responses',async()=>{
 const handlers={};const details={open:false,addEventListener:(name,fn)=>handlers[name]=fn};
 const content={innerHTML:''},button={addEventListener:(name,fn)=>handlers['button:'+name]=fn};
 const root={hidden:false,querySelector:selector=>({'details':details,'[data-diagnostic-content]':content,'[data-diagnostic-refresh]':button})[selector]};
 let resolveOld;const old={remote:true,readModelDiscovery:()=>new Promise(resolve=>resolveOld=resolve),readModelPolicyRetention:async()=>({status:'never_run'})};
 const next={remote:true,readModelDiscovery:async()=>({sources:[],candidates:[]}),readModelPolicyRetention:async()=>({status:'complete'})};
 let client=old,capabilities={modelDiagnostics:true};
 const ui=createModelDiagnosticsUI({root,getContext:()=>({client,capabilities})});
 ui.sync();details.open=true;handlers.toggle();handlers['button:click']();
 await Promise.resolve();
 client=next;ui.sync();assert.equal(details.open,false);assert.equal(content.innerHTML,'');
 resolveOld({sources:[{provider:'openai',status:'fresh'}],candidates:[]});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(content.innerHTML,'');
 details.open=true;handlers.toggle();await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(content.innerHTML,/완료/);
 capabilities={};ui.sync();assert.equal(root.hidden,true);assert.equal(content.innerHTML,'');
});

test('closing during an in-flight read allows a new read on reopen',async()=>{
 const handlers={};const details={open:false,addEventListener:(name,fn)=>handlers[name]=fn};
 const content={innerHTML:''},button={addEventListener:()=>{}};
 const root={hidden:false,querySelector:selector=>({'details':details,'[data-diagnostic-content]':content,'[data-diagnostic-refresh]':button})[selector]};
 let resolveFirst,calls=0;const client={remote:true,readModelDiscovery:()=>{calls++;return calls===1?new Promise(resolve=>resolveFirst=resolve):Promise.resolve({sources:[],candidates:[]});},readModelPolicyRetention:async()=>({status:'complete'})};
 const ui=createModelDiagnosticsUI({root,getContext:()=>({client,capabilities:{modelDiagnostics:true}})});ui.sync();
 details.open=true;handlers.toggle();await Promise.resolve();
 details.open=false;handlers.toggle();resolveFirst({sources:[{provider:'openai',status:'fresh'}],candidates:[]});await new Promise(resolve=>setTimeout(resolve,0));
 details.open=true;handlers.toggle();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(calls,2);assert.match(content.innerHTML,/완료/);
});

test('a failed manual refresh reports error alongside the last good result',async()=>{
 const handlers={};const details={open:false,addEventListener:(name,fn)=>handlers[name]=fn};
 const content={innerHTML:''},button={addEventListener:(name,fn)=>handlers['button:'+name]=fn};
 const root={hidden:false,querySelector:selector=>({'details':details,'[data-diagnostic-content]':content,'[data-diagnostic-refresh]':button})[selector]};
 let fail=false;const client={remote:true,readModelDiscovery:async()=>{if(fail)throw Error('offline');return {sources:[{provider:'openai',status:'fresh'}],candidates:[]};},readModelPolicyRetention:async()=>({status:'complete'})};
 const ui=createModelDiagnosticsUI({root,getContext:()=>({client,capabilities:{modelDiagnostics:true}})});ui.sync();
 details.open=true;handlers.toggle();await new Promise(resolve=>setTimeout(resolve,0));
 fail=true;handlers['button:click']();await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(content.innerHTML,/최근 확인/);assert.match(content.innerHTML,/조회 실패/);assert.match(content.innerHTML,/offline/);assert.match(content.innerHTML,/완료/);
});
