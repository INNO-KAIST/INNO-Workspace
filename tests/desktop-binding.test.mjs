import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {checkedDeliveryBinding,createCloudRequest,normalizedCloudOrigin} from '../server/delivery-binding.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const ID='123e4567-e89b-42d3-a456-426614174000';
const OTHER_ID='123e4567-e89b-42d3-a456-426614174001';
const ORIGIN='https://workspace.example';
const binding=()=>({origin:ORIGIN,workspaceId:ID});
const claim=(id='task')=>({task:{id},executionId:'execution',generation:1});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function box(initial=null){let value=initial;const writes=[];return {read:()=>value,write:record=>{value=structuredClone(record);writes.push(structuredClone(record));},clear:()=>{value=null;},writes};}

test('direct start binds a copied workspace identity to claim, renewal and completed result',async()=>{
 const outbox=box(),calls=[],errors=[];let current={...binding(),ignoredSecret:'never-save'},finish;
 const renewed=deferred();
 const bridge=createDesktopBridge({outbox,heartbeatMs:5,readDeliveryBinding:async()=>current,onError:error=>errors.push(error),request:async(path,body,options)=>{
  calls.push({path,body,options});
  if(path.endsWith('/start'))return {claim:claim(),workspaceId:ID};
  if(path.endsWith('/renew')){renewed.resolve();return {task:{}};}
  return {task:{status:'completed'}};
 },runner:{run:()=>new Promise(resolve=>{finish=resolve;})}});
 await bridge.startTask('task',{expectedVersion:1,materials:[]});
 try{
  await renewed.promise;
  assert.deepEqual(calls.find(call=>call.path.endsWith('/start')).options,{workspaceId:ID});
  assert.deepEqual(calls.find(call=>call.path.endsWith('/renew')).options,{workspaceId:ID});
 }finally{finish({content:'saved result'});await bridge.settled();}
 assert.deepEqual(errors,[]);assert.equal(outbox.read(),null);
 assert.deepEqual(outbox.writes[0].binding,binding());
 assert.equal(JSON.stringify(outbox.writes[0]).includes('never-save'),false);
 assert.deepEqual(calls.find(call=>call.path.endsWith('/complete')).options,{workspaceId:ID});
});

test('poll failure result survives lost delivery and replays after restart with the same identity',async()=>{
 const outbox=box();let runs=0,firstPosts=0;
 const firstRequest=createCloudRequest({endpoint:ORIGIN,token:'old-credential',fetchFn:async(url,options)=>{
  assert.equal(options.headers.authorization,'Bearer old-credential');assert.equal(options.headers['x-inno-workspace-id'],ID);
  if(url.pathname.endsWith('/poll'))return Response.json({claim:claim(),workspaceId:ID});
  firstPosts++;throw Error('response lost');
 }});
 const first=createDesktopBridge({outbox,readDeliveryBinding:async()=>binding(),request:firstRequest,runner:{run:async()=>{runs++;throw Object.assign(Error('fake failure'),{code:'QUOTA_EXCEEDED'});}}});
 await assert.rejects(()=>first.tick(),/response lost/);
 assert.equal(firstPosts,1);assert.equal(outbox.read().action,'fail');assert.deepEqual(outbox.read().binding,binding());
 let replayPosts=0;const rotatedRequest=createCloudRequest({endpoint:ORIGIN,token:'new-credential',fetchFn:async(url,options)=>{
  assert.match(url.pathname,/\/fail$/);assert.equal(options.headers.authorization,'Bearer new-credential');
  assert.equal(options.headers['x-inno-workspace-id'],ID);replayPosts++;return Response.json({task:{status:'failed'}});
 }});
 const restarted=createDesktopBridge({outbox,readDeliveryBinding:async()=>binding(),request:rotatedRequest,runner:{run:()=>{throw Error('AI must not rerun');}}});
 assert.equal(await restarted.tick(),true);assert.equal(runs,1);assert.equal(replayPosts,1);assert.equal(outbox.read(),null);
});

test('saved result never posts to a different origin, database identity, or unbound legacy record',async()=>{
 for(const saved of [undefined,{origin:'https://other.example',workspaceId:ID},{origin:ORIGIN,workspaceId:OTHER_ID},{origin:'http://workspace.example',workspaceId:ID},{origin:ORIGIN,workspaceId:'broken'}]){
  const record={taskId:'task',action:'complete',input:{executionId:'execution',generation:1,content:'retained'},...(saved?{binding:saved}:{})};
  const outbox=box(record);let posts=0;
  const bridge=createDesktopBridge({outbox,readDeliveryBinding:async()=>binding(),request:async()=>{posts++;},runner:{run:()=>{throw Error('AI must not run');}}});
  await assert.rejects(()=>bridge.tick(),{status:409});
  assert.equal(posts,0);assert.deepEqual(outbox.read(),record);assert.equal(bridge.status().pending,true);
 }
});

test('identity fetch failure preserves retained result and sends no mutation',async()=>{
 const record={taskId:'task',action:'complete',input:{executionId:'execution',generation:1,content:'retained'},binding:binding()};
 const outbox=box(record);let posts=0;
 const bridge=createDesktopBridge({outbox,readDeliveryBinding:async()=>{throw Error('identity endpoint offline');},request:async()=>{posts++;},runner:{run:()=>{throw Error('AI must not run');}}});
 await assert.rejects(()=>bridge.tick(),/identity endpoint offline/);
 assert.equal(posts,0);assert.deepEqual(outbox.read(),record);
});

test('identity change during execution keeps the exact saved binding and never delivers result',async()=>{
 const outbox=box(),gate=deferred(),errors=[];let current=binding(),posts=0;
 const bridge=createDesktopBridge({outbox,readDeliveryBinding:async()=>current,onError:error=>errors.push(error),request:async path=>{
  if(path.endsWith('/start'))return {claim:claim(),workspaceId:ID};
  posts++;return {task:{status:'completed'}};
 },runner:{run:()=>gate.promise}});
 await bridge.startTask('task',{expectedVersion:1,materials:[]});
 current={origin:ORIGIN,workspaceId:OTHER_ID};gate.resolve({content:'retained'});await bridge.settled();
 assert.equal(posts,0);assert.deepEqual(outbox.read().binding,binding());assert.equal(outbox.read().input.content,'retained');
 assert.equal(errors[0]?.status,409);
});

for(const mode of ['direct','poll'])test(`${mode} refuses a different identity in claim response before runner execution`,async()=>{
 let runs=0;const outbox=box();const bridge=createDesktopBridge({outbox,readDeliveryBinding:async()=>binding(),request:async()=>({claim:claim(),workspaceId:OTHER_ID}),runner:{run:async()=>{runs++;return {content:'no'};}}});
 if(mode==='direct')await assert.rejects(()=>bridge.startTask('task',{expectedVersion:1,materials:[]}),{status:409});
 else await assert.rejects(()=>bridge.tick(),{status:409});
 assert.equal(runs,0);assert.equal(outbox.read(),null);
});

for(const mode of ['direct','poll'])test(`${mode} stop during identity read never claims or executes`,async()=>{
 const identity=deferred();let claims=0,runs=0,reads=0;
 const bridge=createDesktopBridge({outbox:box(),readDeliveryBinding:()=>{reads++;return identity.promise;},request:async()=>{claims++;return {claim:claim(),workspaceId:ID};},runner:{run:async()=>{runs++;return {content:'no'};}}});
 const waiting=mode==='direct'?bridge.startTask('task',{expectedVersion:1,materials:[]}):bridge.tick();
 await new Promise(setImmediate);assert.equal(bridge.status().busy,true);
 bridge.stop();identity.resolve(binding());
 if(mode==='direct')await assert.rejects(waiting,{status:409});else assert.equal(await waiting,false);
 assert.equal(reads,1);assert.equal(claims,0);assert.equal(runs,0);assert.deepEqual(bridge.status(),{busy:false,stopped:true,pending:false,sourceDelegationVersion:0});
});

test('binding validation keeps only a normalized HTTPS origin and UUID',()=>{
 const input={origin:'https://WORKSPACE.example:443/',workspaceId:ID,credential:'do-not-copy'};
 const checked=checkedDeliveryBinding(input);input.workspaceId=OTHER_ID;
 assert.deepEqual(checked,binding());
 for(const origin of ['http://workspace.example','https://user:pass@workspace.example','https://workspace.example/path','https://workspace.example/?q=1','https://workspace.example/#fragment'])
  assert.throws(()=>normalizedCloudOrigin(origin),{status:409});
 for(const invalid of [null,{},[],{origin:ORIGIN,workspaceId:'bad'},{origin:'http://workspace.example',workspaceId:ID}])
  assert.throws(()=>checkedDeliveryBinding(invalid),{status:409});
});

test('production request sends workspace header only when supplied and rejects redirects or cross-origin routes',async()=>{
 const calls=[];const request=createCloudRequest({endpoint:ORIGIN,token:'fake-token',fetchFn:async(url,options)=>{calls.push({url:url.toString(),options});return Response.json({ok:true});}});
 assert.deepEqual(await request('/api/desktop/identity'),{ok:true});
 assert.deepEqual(await request('/api/desktop/task/complete',{content:'saved'},{workspaceId:ID}),{ok:true});
 assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.headers['x-inno-workspace-id'],undefined);
 assert.equal(calls[1].options.method,'POST');assert.equal(calls[1].options.headers['x-inno-workspace-id'],ID);
 assert.equal(calls[1].options.redirect,'error');assert.equal(calls[1].url,ORIGIN+'/api/desktop/task/complete');
 assert.deepEqual(JSON.parse(calls[1].options.body),{content:'saved'});
 const count=calls.length;
 for(const route of ['https://other.example/collect','//other.example/collect'])await assert.rejects(()=>request(route,{content:'saved'},{workspaceId:ID}),{status:409});
 assert.equal(calls.length,count);
 const redirecting=createCloudRequest({endpoint:ORIGIN,token:'fake-token',fetchFn:async(_url,options)=>{assert.equal(options.redirect,'error');return Response.redirect('https://other.example/collect');}});
 await assert.rejects(()=>redirecting('/api/desktop/task/complete',{content:'saved'},{workspaceId:ID}),{status:302});
});

test('fake Worker HTTP and file outbox keep a result across DB replacement and replay to original DB',async t=>{
 const firstDb=new TestD1(),replacementDb=new TestD1(),directory=await mkdtemp(path.join(tmpdir(),'inno-workspace-binding-'));
 t.after(async()=>{firstDb.close();replacementDb.close();await rm(directory,{recursive:true,force:true});});
 const store=new D1TaskStore(firstDb),worker=createWorker({fetchFn:async()=>{throw Error('AI network must not run');}});
 const outboxPath=path.join(directory,'pending.json'),outbox=createFileOutbox(outboxPath),errors=[];
 const accessToken='binding-test-token-01234567890123456789';
 let activeDb=firstDb,switchBeforeComplete=false,runs=0;
 const request=createCloudRequest({endpoint:ORIGIN,token:accessToken,fetchFn:async(url,options)=>{
  if(switchBeforeComplete&&url.pathname.endsWith('/complete')){activeDb=replacementDb;switchBeforeComplete=false;}
  return worker.fetch(new Request(url.toString(),options),{DB:activeDb,ACCESS_TOKEN:accessToken});
 }});
 const readDeliveryBinding=async()=>({origin:ORIGIN,workspaceId:(await request('/api/desktop/identity')).workspaceId});
 const makeBridge=runner=>createDesktopBridge({request,readDeliveryBinding,outbox:createFileOutbox(outboxPath),runner,onError:error=>errors.push(error)});
 const runner={run:async()=>{runs++;return {content:'fake verified result'};}};
 const first=await store.createTask({prompt:'Normal result'}),normal=makeBridge(runner);
 await normal.startTask(first.id,{expectedVersion:first.version,materials:[]});await normal.settled();
 assert.equal((await store.requireTask(first.id)).status,'completed');assert.equal(outbox.read(),null);
 const second=await store.createTask({prompt:'Retained result'});switchBeforeComplete=true;
 await normal.startTask(second.id,{expectedVersion:second.version,materials:[]});await normal.settled();
 const saved=outbox.read();assert.equal(saved.action,'complete');assert.deepEqual(saved.binding,checkedDeliveryBinding(saved.binding));
 assert.equal(saved.input.content,'fake verified result');assert.equal(errors.at(-1)?.status,409);
 assert.equal((await replacementDb.prepare('SELECT COUNT(*) AS n FROM tasks').first()).n,0);
 assert.equal((await replacementDb.prepare("SELECT value FROM metadata WHERE key='revision'").first()).value,0);
 assert.equal((await store.requireTask(second.id)).status,'running');
 activeDb=firstDb;
 const restarted=makeBridge({run:()=>{throw Error('AI must not rerun');}});
 assert.equal(await restarted.tick(),true);assert.equal((await store.requireTask(second.id)).status,'completed');
 assert.equal(createFileOutbox(outboxPath).read(),null);assert.equal(runs,2);
});
