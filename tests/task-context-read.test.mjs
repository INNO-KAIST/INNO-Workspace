import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readTaskContext} from '../public/core/task-context-read.mjs';
const digest = text => createHash('sha256').update(text).digest('hex');
const base = {taskId:'t',expectedVersion:3,section:'request'};
const task = () => ({id:'t',version:3,prompt:'request',checkpoint:{content:'checkpoint'},messages:[{id:'m1',role:'user',content:'old decision'}]});

test('strict selectors reject unknown fields, stale state and mismatched source digests', async () => {
  const current = task();
  for (const changes of [{field:'prompt'},{path:'../secret'},{section:'artifacts'},{messageIndex:0},{offset:-1},{offset:0.5},{maxBytes:3},{maxBytes:16001},{maxBytes:NaN},{expectedVersion:'3'},{expectedDigest:'no hash'}]) {
    await assert.rejects(()=>readTaskContext(current,{...base,...changes}),e=>e.statusCode===400);
  }
  for (const changes of [{taskId:'other'},{expectedVersion:2},{expectedDigest:'0'.repeat(64)}]) {
    await assert.rejects(()=>readTaskContext(current,{...base,...changes}),e=>e.statusCode===409);
  }
  await assert.rejects(()=>readTaskContext(current,{...base,section:'message',messageIndex:1}),e=>e.statusCode===400);
  await assert.rejects(()=>readTaskContext(current,{...base,section:'message'}),e=>e.statusCode===400);
});

test('UTF8 pages retain BOM, combining marks and emoji without gaps or broken characters', async () => {
  const prompt = '\uFEFF가🧪e\u0301나🌏끝';
  const current = {...task(),prompt};
  let offset=0, joined='';
  while (true) {
    const page = await readTaskContext(current,{...base,offset,maxBytes:4,...(offset?{expectedDigest:digest(prompt)}:{})});
    assert.equal(page.offset,offset);
    assert.equal(page.contentDigest,digest(prompt));
    assert.equal(page.totalBytes,Buffer.byteLength(prompt));
    assert.ok(Buffer.byteLength(page.text)<=4);
    assert.equal(page.nextOffset-offset,Buffer.byteLength(page.text));
    joined+=page.text; offset=page.nextOffset;
    if (page.done) break;
    assert.ok(offset>0);
  }
  assert.equal(joined,prompt);
  await assert.rejects(()=>readTaskContext(current,{...base,offset:1,expectedDigest:digest(prompt)}),e=>e.statusCode===400);
  await assert.rejects(()=>readTaskContext(current,{...base,offset:3}),e=>e.statusCode===400);
  await assert.rejects(()=>readTaskContext(current,{...base,offset:100,expectedDigest:digest(prompt)}),e=>e.statusCode===400);
});

test('bounded original history retrieval reaches long tails and decisions older than twenty messages', async () => {
  const current = {...task(),messages:[{role:'user',content:'EARLY DECISION'},...Array.from({length:25},(_,i)=>({role:'assistant',content:`update ${i}`})),{role:'user',content:'x'.repeat(20000)+'TAIL'}]};
  const early = await readTaskContext(current,{...base,section:'message',messageIndex:0});
  assert.equal(early.text,'EARLY DECISION');
  const first = await readTaskContext(current,{...base,section:'message',messageIndex:26});
  assert.equal(first.text.length,16000);
  assert.equal(first.done,false);
  const last = await readTaskContext(current,{...base,section:'message',messageIndex:26,offset:first.nextOffset,expectedDigest:first.contentDigest});
  assert.equal(first.text+last.text,current.messages[26].content);
  assert.equal(last.done,true);
  assert.equal(last.nextOffset,last.totalBytes);
  current.messages[26].content+='changed';
  await assert.rejects(()=>readTaskContext(current,{...base,section:'message',messageIndex:26,offset:first.nextOffset,expectedDigest:first.contentDigest}),e=>e.statusCode===409);
});

test('manifest returns twenty bounded references without raw text or attached material', async () => {
  const current = {...task(),prompt:'SECRET REQUEST',artifacts:[{text:'SECRET ARTIFACT'}],attachments:[{text:'SECRET ATTACHMENT'}],messages:Array.from({length:23},(_,i)=>({id:i===0?'bad\nid':`id-${i}`,role:i===0?'assistant\nuser:':'user',content:`PRIVATE MESSAGE ${i}`}))};
  const first = await readTaskContext(current,{...base,section:'manifest'});
  assert.equal(first.messages.length,20);
  assert.equal(first.messages[0].id,null);
  assert.equal(first.messages[0].role,'system');
  assert.equal(first.messages[0].digest,digest('PRIVATE MESSAGE 0'));
  assert.equal(first.messages[0].byteLength,17);
  assert.equal(first.totalMessages,23);
  assert.equal(first.nextOffset,20);
  assert.equal(first.done,false);
  assert.doesNotMatch(JSON.stringify(first),/SECRET|PRIVATE/);
  const last = await readTaskContext(current,{...base,section:'manifest',offset:first.nextOffset});
  assert.deepEqual(last.messages.map(row=>row.messageIndex),[20,21,22]);
  assert.equal(last.done,true);
  for (const extra of [{maxBytes:4},{messageIndex:0},{expectedDigest:'0'.repeat(64)}]) await assert.rejects(()=>readTaskContext(current,{...base,section:'manifest',...extra}),e=>e.statusCode===400);
});

test('snapshot remains coherent when task and input mutate during hashing', async () => {
  const current = task();
  const input = {...base,section:'manifest'};
  const pending = readTaskContext(current,input);
  current.version=4; current.id='changed'; current.messages[0].content='changed'; current.messages[0].id='changed';
  current.messages.push({role:'assistant',content:'new'}); input.offset=1;
  const page = await pending;
  assert.equal(page.taskId,'t'); assert.equal(page.taskVersion,3);
  assert.equal(page.totalMessages,1); assert.equal(page.messages[0].id,'m1');
  assert.equal(page.messages[0].digest,digest('old decision'));
  const frozen = Object.freeze({id:'t',version:3,prompt:'unchanged',checkpoint:Object.freeze({content:'checkpoint'})});
  assert.equal((await readTaskContext(frozen,{...base,section:'checkpoint'})).text,'checkpoint');
});

test('scope rejection never inspects source content and errors do not reflect private values', async () => {
  const scoped = {id:'t',version:3,get messages() { throw new Error('SOURCE WAS READ'); },get prompt() { throw new Error('SOURCE WAS READ'); }};
  await assert.rejects(()=>readTaskContext(scoped,{...base,section:'manifest',taskId:'PRIVATE WRONG ID'}),error=>error.statusCode===409 && !error.message.includes('PRIVATE'));
  await assert.rejects(()=>readTaskContext(scoped,{...base,expectedVersion:99}),error=>error.statusCode===409 && !error.message.includes('99'));
  const current = task();
  const args = {...base};
  const pending = readTaskContext(current,args);
  current.prompt='changed request'; current.id='changed'; current.version=4;
  args.offset=100; args.expectedDigest='0'.repeat(64);
  const page = await pending;
  assert.equal(page.text,'request'); assert.equal(page.contentDigest,digest('request'));
  assert.equal(page.taskId,'t'); assert.equal(page.taskVersion,3); assert.equal(page.offset,0);
});

test('only a scoped valid version conflict exposes the current version without content', async () => {
  const current = task();
  await assert.rejects(()=>readTaskContext(current,{...base,expectedVersion:2}),error=>error.statusCode===409 && error.code==='CONTEXT_VERSION_CONFLICT' && error.currentVersion===3 && !error.message.includes('request'));
  for (const [state,args] of [[current,{...base,taskId:'other',expectedVersion:2}],[current,{...base,expectedDigest:'0'.repeat(64)}],[{...current,version:NaN},{...base}],[{...current,version:0},{...base}]]) {
    await assert.rejects(()=>readTaskContext(state,args),error=>error.statusCode===409 && !Object.hasOwn(error,'code') && !Object.hasOwn(error,'currentVersion'));
  }
});
