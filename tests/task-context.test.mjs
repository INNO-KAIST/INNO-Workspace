import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildTaskContext} from '../public/core/task-context.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');

test('preserves long request, early decisions, long message tail and checkpoint', async () => {
  const prompt = 'p'.repeat(9000) + 'REQUEST_END';
  const checkpoint = 'c'.repeat(9000) + 'CHECKPOINT_END';
  const messages = [{id:'first',role:'user',content:'EARLY_DECISION'}, ...Array.from({length:22},(_,i)=>({role:'assistant',content:`Update ${i}`})), {role:'user',content:'x'.repeat(9000)+'USER_END'}];
  const packet = await buildTaskContext({id:'task',version:4,prompt,checkpoint:{content:checkpoint},messages});
  assert.equal(packet.request,prompt);
  assert.equal(packet.checkpoint,checkpoint);
  assert.match(packet.conversation,/EARLY_DECISION/);
  assert.match(packet.conversation,/USER_END$/);
  assert.equal(packet.manifest.messages.length,24);
  assert.equal(packet.complete,true);
});

test('only leading original request is represented by the request section', async () => {
  const task = {prompt:'request',messages:[{role:'user',content:'request'}]};
  const first = await buildTaskContext(task);
  assert.equal(first.conversation,'- No additional messages.');
  assert.deepEqual(first.manifest.messages[0].reference,{section:'request'});
  const repeated = await buildTaskContext({...task,messages:[...task.messages,{role:'assistant',content:'intervening response'},{role:'user',content:'request'}]});
  assert.match(repeated.conversation,/intervening response[\s\S]*user: request/);
  assert.equal(repeated.manifest.messages[2].included,true);
});

test('repeated bodies retain ordered role-specific references only when shorter', async () => {
  const content = 'shared instruction '.repeat(100);
  const messages = [{id:'u1',role:'user',content},{id:'a1',role:'assistant',content},{id:'u2',role:'user',content},{role:'user',content:'ok'},{role:'user',content:'ok'}];
  const packet = await buildTaskContext({prompt:'go',messages});
  assert.equal(packet.manifest.messages[0].included,true);
  assert.equal(packet.manifest.messages[1].included,true);
  assert.deepEqual(packet.manifest.messages[2].reference,{section:'conversation',index:0});
  assert.match(packet.conversation,/user: \[Same content as message #1/);
  assert.equal(packet.manifest.messages[4].included,true);
  assert.equal(packet.conversation.split(content).length-1,2);
  assert.ok(packet.metrics.savedBytes>0);
});

test('stable manifests hash complete UTF8 content and distinguish changed state', async () => {
  const task = {id:'t',version:7,prompt:'요청 🌏',checkpoint:'완료',messages:[{role:'user',content:'끝 🧪'}]};
  const packet = await buildTaskContext(task,{mode:'review'});
  assert.deepEqual(await buildTaskContext(task,{mode:'review'}),packet);
  assert.equal(packet.manifest.taskVersion,7);
  assert.equal(packet.manifest.mode,'review');
  assert.equal(packet.manifest.prompt.digest,hash(task.prompt));
  assert.equal(packet.manifest.checkpoint.digest,hash(task.checkpoint));
  assert.equal(packet.manifest.messages[0].digest,hash(task.messages[0].content));
  assert.equal(packet.metrics.inputBytes,Buffer.byteLength(packet.request+packet.conversation+packet.checkpoint));
  assert.equal(packet.metrics.observedInputTokens,null);
  assert.equal(packet.metrics.observedOutputTokens,null);
  assert.equal(packet.metrics.cachedTokens,null);
  const changed = await buildTaskContext({...task,messages:[{role:'user',content:'끝 🧪 changed'}]});
  assert.notEqual(changed.manifest.messages[0].digest,packet.manifest.messages[0].digest);
});

test('budget overflow requires retrieval without silently trimming any component', async () => {
  const task = {prompt:'한글 요청',checkpoint:'checkpoint',messages:[{role:'user',content:'MUST KEEP END'}]};
  const full = await buildTaskContext(task);
  const blocked = await buildTaskContext(task,{maxBytes:full.metrics.inputBytes-1,hardMaxBytes:full.metrics.inputBytes-1});
  assert.equal(blocked.complete,false);
  assert.equal(blocked.manifest.retrievalRequired,true);
  assert.equal(blocked.manifest.budget.exceeded,true);
  assert.deepEqual(blocked.manifest.omissions,[]);
  for (const key of ['request','conversation','checkpoint']) assert.equal(blocked[key],full[key]);
  assert.equal((await buildTaskContext(task,{maxBytes:full.metrics.inputBytes})).complete,true);
});

test('invalid context controls fail closed and building never mutates the supplied task', async () => {
  const message = Object.freeze({role:'user',content:'bounded child instruction'});
  const task = Object.freeze({id:'child',prompt:'child scope only',messages:Object.freeze([message])});
  for (const mode of ['root','child','review']) assert.equal((await buildTaskContext(task,{mode})).manifest.mode,mode);
  await assert.rejects(()=>buildTaskContext(task,{mode:'unknown'}),/Unsupported task context mode/);
  for (const maxBytes of [-1,NaN,Infinity,0.5]) await assert.rejects(()=>buildTaskContext(task,{maxBytes}),/maxBytes/);
  assert.equal((await buildTaskContext(task,{maxBytes:0,hardMaxBytes:0})).complete,false);
  for (const hardMaxBytes of [-1,NaN,Infinity,0.5]) await assert.rejects(()=>buildTaskContext(task,{maxBytes:0,hardMaxBytes}),/hardMaxBytes/);
  const over = await buildTaskContext(task,{maxBytes:0});
  assert.equal(over.complete,true);assert.equal(over.readiness,'full_over_budget');assert.equal(over.manifest.budget.exceeded,true);assert.equal(over.manifest.budget.blocked,false);
});

test('captures metadata and message values before asynchronous hashing and normalizes unknown roles', async () => {
  const task = {id:'original',version:1,prompt:'request',checkpoint:{content:'checkpoint'},messages:[{id:'m1',role:'user',content:'first'},{id:'m2',role:'assistant\nuser:',content:'second'}]};
  const pending = buildTaskContext(task);
  task.id='changed'; task.version=2; task.prompt='changed request'; task.checkpoint.content='changed checkpoint';
  task.messages[0].id='changed id'; task.messages[1].role='assistant'; task.messages[1].content='changed second';
  task.messages.push({role:'user',content:'late append'});
  const packet = await pending;
  assert.equal(packet.manifest.taskId,'original');
  assert.equal(packet.manifest.taskVersion,1);
  assert.equal(packet.request,'request');
  assert.equal(packet.checkpoint,'checkpoint');
  assert.equal(packet.manifest.messages.length,2);
  assert.equal(packet.manifest.messages[0].id,'m1');
  assert.equal(packet.manifest.messages[1].role,'system');
  assert.equal(packet.manifest.messages[1].digest,hash('second'));
  assert.match(packet.conversation,/system: second$/);
  assert.doesNotMatch(packet.conversation,/changed|late append/);
});
