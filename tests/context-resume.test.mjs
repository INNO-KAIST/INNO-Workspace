import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sanitizeResumeState,createContextBasis,verifyResumeState} from '../public/core/context-resume.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
const task = () => ({id:'t',version:1,prompt:'Original goal',messages:[{id:'u1',role:'user',content:'Keep this constraint'},{id:'a1',role:'assistant',content:'Completed evidence'}],attachments:[{id:'f1',name:'source.txt',path:'source.txt',size:10,lastModified:1,type:'text/plain',source:'file',view:{kind:'text-byte-range',start:0,end:10,sha256:'a'.repeat(64)}}]});
async function stateFor(current) {return {version:1,...await createContextBasis(current),items:[{kind:'constraint',text:'Keep constraint',references:[{section:'message',messageIndex:0,digest:hash(current.messages[0].content)}]}]};}

test('basis binds raw history and request while lease and task version changes remain valid', async () => {
  const current=task(), state=await stateFor(current);
  assert.equal(state.basis.requestDigest,hash('Original goal'));
  assert.equal(state.basis.historyDigest,hash('[{"content":"Keep this constraint","id":"u1","index":0,"role":"user"},{"content":"Completed evidence","id":"a1","index":1,"role":"assistant"}]'));
  current.version=12; current.execution={generation:9}; current.checkpoint={content:'untrusted summary',resumeState:state};
  const verified=await verifyResumeState(current);
  assert.equal(verified.status,'source_matched');
  assert.deepEqual(verified.pendingMessageIndexes,[]);
  current.messages.push({role:'user',content:'New direction'});
  const appended=await verifyResumeState(current,state);
  assert.equal(appended.status,'source_matched');
  assert.deepEqual(appended.pendingMessageIndexes,[2]);
});

test('edited requests, prefix history, task identity and scope metadata become stale', async () => {
  const original=task(), state=await stateFor(original);
  const changes=[t=>t.prompt+='changed',t=>t.messages[0].content+='changed',t=>t.id='other',t=>t.parentTaskId='parent',t=>t.batchId='new-batch',t=>t.attachments[0].view.sha256='b'.repeat(64),t=>t.attachments[0].lastModified=2];
  for (const change of changes) {
    const changed=structuredClone(original); change(changed);
    const result=await verifyResumeState(changed,state);
    assert.equal(result.status,'stale'); assert.equal(result.state,null);
  }
  const changed=structuredClone(original); changed.attachments[0].content='PRIVATE RAW'; changed.attachments[0].view.text='PRIVATE EXCERPT';
  assert.equal((await verifyResumeState(changed,state)).status,'source_matched');
});

test('references require exact original source hashes and decisions reject assistant authority', async () => {
  const current=task(), state=await stateFor(current);
  const incorrect=structuredClone(state); incorrect.items[0].references[0].digest='0'.repeat(64);
  assert.equal((await verifyResumeState(current,incorrect)).status,'stale');
  const decision=structuredClone(state); decision.items[0]={kind:'decision',text:'Approved',references:[{section:'message',messageIndex:1,digest:hash(current.messages[1].content)}]};
  assert.equal((await verifyResumeState(current,decision)).status,'invalid');
  decision.items[0].references=[{section:'request',digest:hash(current.prompt)}];
  assert.equal((await verifyResumeState(current,decision)).status,'source_matched');
  const beyond=structuredClone(state); beyond.items[0].references[0].messageIndex=2;
  assert.equal((await verifyResumeState(current,beyond)).status,'invalid');
});

test('strict bounded state rejects extra fields, checkpoint sources and oversized UTF8 payloads', async () => {
  const state=await stateFor(task());
  const bad=[s=>s.extra='raw',s=>s.items=[],s=>s.items[0].text='x'.repeat(2001),s=>s.items[0].references=[],s=>s.items[0].references[0].section='checkpoint',s=>s.basis.extra='raw',s=>s.taskId='bad\nid',s=>s.items=Array.from({length:49},()=>s.items[0]),s=>s.items[0].references=Array.from({length:9},()=>s.items[0].references[0]),s=>s.items=Array.from({length:8},()=>({...s.items[0],text:'가'.repeat(1800)}))];
  for(const change of bad) {const changed=structuredClone(state); change(changed); assert.throws(()=>sanitizeResumeState(changed),e=>e.statusCode===400);}
  const normalized=sanitizeResumeState(state); normalized.items[0].text='changed';
  assert.equal(state.items[0].text,'Keep constraint');
  assert.equal((await verifyResumeState(task())).status,'missing');
  assert.equal((await verifyResumeState(task(),null)).status,'invalid');
});

test('basis and verifier snapshot all source and state values before awaiting hashes', async () => {
  const current=task(), before=structuredClone(current), state=await stateFor(current);
  const pendingBasis=createContextBasis(current);
  const pendingVerify=verifyResumeState(current,state);
  current.prompt='changed'; current.id='changed'; current.messages[0].content='changed'; current.attachments[0].view.sha256='c'.repeat(64); state.items[0].text='changed';
  assert.deepEqual(await pendingBasis,await createContextBasis(before));
  const result=await pendingVerify;
  assert.equal(result.status,'source_matched'); assert.equal(result.state.items[0].text,'Keep constraint');
  const child={...before,parentTaskId:'p',assignment:{instructions:'work',role:'writer'}};
  const reordered={...child,assignment:{role:'writer',instructions:'work'}};
  assert.deepEqual(await createContextBasis(child),await createContextBasis(reordered));
  assert.equal((await createContextBasis(child)).mode,'child');
  assert.equal((await createContextBasis({...child,delegation:{state:'reviewing',review:{batch:'b'}}})).mode,'review');
});

test('an explicit shorter basis keeps newer messages pending and rejects invalid prefix lengths', async () => {
  const current=task();
  const state={version:1,...await createContextBasis(current,{messageCount:1}),items:[{kind:'goal',text:'Original goal',references:[{section:'request',digest:hash(current.prompt)}]}]};
  const result=await verifyResumeState(current,state);
  assert.equal(result.status,'source_matched'); assert.deepEqual(result.pendingMessageIndexes,[1]);
  const zero=await createContextBasis(current,{messageCount:0});
  assert.equal(zero.basis.historyDigest,hash('[]'));
  for(const messageCount of [-1,0.5,3]) await assert.rejects(()=>createContextBasis(current,{messageCount}),e=>e.statusCode===400);
  const child={...current,parentTaskId:'parent',assignment:{role:'writer',instructions:'initial'}};
  const childState={...state,...await createContextBasis(child,{messageCount:1})};
  child.assignment.instructions='changed';
  assert.equal((await verifyResumeState(child,childState)).status,'stale');
});

test('pending history metadata stays bounded and distinguishes an unknown source count', async () => {
  const current=task(); current.messages=Array.from({length:100},(_,i)=>({role:'user',content:`message ${i}`}));
  const state={version:1,...await createContextBasis(current,{messageCount:1}),items:[{kind:'goal',text:'goal',references:[{section:'request',digest:hash(current.prompt)}]}]};
  const matched=await verifyResumeState(current,state);
  assert.equal(matched.pendingMessageCount,99);
  assert.equal(matched.pendingMessageIndexes.length,20);
  assert.equal(matched.pendingMessageIndexes[0],1);
  assert.equal(matched.pendingMessageIndexes.at(-1),20);
  assert.equal(matched.nextPendingMessageIndex,21);
  const stale=structuredClone(state); stale.basis.requestDigest='0'.repeat(64);
  for(const value of [undefined,null,stale]) {
    const result=await verifyResumeState(current,value);
    assert.equal(result.pendingMessageCount,100); assert.equal(result.pendingMessageIndexes.length,20);
    assert.equal(result.pendingMessageIndexes[0],0); assert.equal(result.nextPendingMessageIndex,20);
  }
  const invalid=await verifyResumeState({},state);
  assert.equal(invalid.pendingMessageCount,null); assert.deepEqual(invalid.pendingMessageIndexes,[]); assert.equal(invalid.nextPendingMessageIndex,null);
  const doneState={...state,...await createContextBasis(current)};
  const done=await verifyResumeState(current,doneState);
  assert.equal(done.pendingMessageCount,0); assert.equal(done.nextPendingMessageIndex,null);
});
