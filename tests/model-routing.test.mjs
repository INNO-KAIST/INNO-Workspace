import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createModelCatalog, routingPolicy, routingReport} from '../server/model-routing.mjs';
const models=[{model:'gpt-6-astra',supportedReasoningEfforts:[{reasoningEffort:'high'}],isDefault:true},{model:'gpt-5.6-luna',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}];
function modelServer(reply){
 const requests=[];
 const spawnProcess=()=>{const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.kill=()=>{};p.stdin.on('data',chunk=>{const request=JSON.parse(String(chunk));requests.push(request);if(request.id===undefined)return;queueMicrotask(()=>p.stdout.write(JSON.stringify(request.id===1?{id:1,result:{}}:reply(request))+'\n'));});return p;};
 return {spawnProcess,requests};
}
test('model catalog collects every page and keeps the actual observation time across cached reports',async()=>{
 let now=1000;const {spawnProcess,requests}=modelServer(request=>request.params.cursor?{id:request.id,result:{data:[models[1]],nextCursor:null}}:{id:request.id,result:{data:[models[0]],nextCursor:'next'}});
 const get=createModelCatalog({spawnProcess,now:()=>now,ttlMs:3600000});
 assert.deepEqual((await get()).map(item=>item.model),['gpt-6-astra','gpt-5.6-luna']);
 assert.deepEqual(requests.filter(item=>item.method==='model/list').map(item=>item.params.cursor??null),[null,'next']);
 now+=60000;assert.deepEqual(await get.snapshot(),{models:[{model:'gpt-6-astra',efforts:['high'],isDefault:true},{model:'gpt-5.6-luna',efforts:['medium'],isDefault:false}],observedAt:1000,status:'fresh'});
});
test('model catalog fails closed on malformed pages, duplicate models and cursor loops',async()=>{
 for(const reply of [
  request=>({id:request.id,result:{data:[models[0]],nextCursor:'again'}}),
  request=>({id:request.id,result:{data:[models[0],models[0]],nextCursor:null}}),
  request=>({id:request.id,result:{data:'changed shape',nextCursor:null}}),
  request=>({id:request.id,result:{data:[models[0]],nextCursor:42}}),
  request=>({id:request.id,result:{data:[models[0],{model:'bad model',supportedReasoningEfforts:[]}],nextCursor:null}}),
  request=>({id:request.id,result:{data:[{model:'valid',supportedReasoningEfforts:'changed shape'}],nextCursor:null}}),
 ]){
  const {spawnProcess}=modelServer(reply);const get=createModelCatalog({spawnProcess,now:()=>1000});
  assert.deepEqual(await get(),[]);assert.equal((await get.snapshot()).status,'unavailable');
 }
});
test('model catalog fetches once, sanitizes fields, and expires without stale fallback',async()=>{
 let calls=0,now=0,fail=false;
 const spawnProcess=()=>{calls++;const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.kill=()=>{};p.stdin.on('data',chunk=>{const e=JSON.parse(String(chunk));if(e.id===1)queueMicrotask(()=>p.stdout.write(JSON.stringify({id:1,result:{}})+'\n'));if(e.id===2)queueMicrotask(()=>{p.stdout.write(JSON.stringify(fail?{id:2,error:{message:'unavailable'}}:{id:2,result:{data:models,nextCursor:null}})+'\n');});});return p;};
 const get=createModelCatalog({spawnProcess,now:()=>now,ttlMs:100});
 const [a,b]=await Promise.all([get(),get()]);assert.equal(calls,1);assert.deepEqual(a,b);assert.deepEqual(a.map(m=>m.model),['gpt-6-astra','gpt-5.6-luna']);assert.equal(a[0].description,undefined);
 fail=true;now=101;assert.deepEqual(await get(),[]);assert.equal(calls,2);
});
test('routing permits only discovered models and requires pre-delegation review and escalation',()=>{
 const p=routingPolicy(models);assert.match(p,/BEFORE spawning/);assert.match(p,/acceptance/);assert.match(p,/gpt-5.6-luna/);assert.doesNotMatch(p,/gpt-5.6-terra/);assert.match(p,/no-subagent/);assert.match(p,/at most one/);
 assert.match(routingPolicy([]),/Do not spawn/);
});
test('routing report labels self-report, limits fields, and flags unlisted models',()=>{
 const report=routingReport({understanding:'goal',assignments:[{role:'extract',model:'invented',effort:'medium',reason:'easy',acceptance:'compare',outcome:'passed',secret:'omit'}]},models);
 assert.equal(report.source,'executor_self_report');assert.equal(report.assignments[0].catalogMatch,false);assert.equal(report.assignments[0].secret,undefined);assert.equal(report.runtimeVerified,false);
 assert.equal(routingReport(null,models).status,'not_reported');
 assert.equal(routingReport({assignments:Array(100).fill({role:'x'})},models).assignments.length,6);
});
import {withRoutingArtifact} from '../server/model-routing.mjs';
test('routing metadata preserves final answer and cannot push artifacts over existing limits',()=>{
 const report={status:'not_reported'};
 assert.equal(withRoutingArtifact([],'answer',report)[0].name,'final.md');
 const full=[{name:'large.txt',content:'x'.repeat(10000000)}];assert.equal(withRoutingArtifact(full,'answer',report).length,1);
 const ten=Array.from({length:10},(_,i)=>({name:String(i),content:'x'}));assert.equal(withRoutingArtifact(ten,'answer',report).length,10);
 assert.equal(withRoutingArtifact([{name:'large.txt',content:'x'.repeat(600000)}],'answer',report,true).length,1);
});
