import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildTaskContext} from '../public/core/task-context.mjs';
import {createContextBasis} from '../public/core/context-resume.mjs';
import {readTaskContext} from '../public/core/task-context-read.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const options={selection:'resume',readerAvailable:true};
async function fixture(){
  const task={id:'selected-task',version:4,prompt:'ORIGINAL REQUEST',attachments:[{id:'f',name:'file',path:'file',size:1,lastModified:1,source:'file'}],messages:[
    {role:'user',content:'ORIGINAL REQUEST'},
    {role:'assistant',content:'OLD_A '+ 'a'.repeat(18000)},
    {role:'assistant',content:'PROPOSAL BEFORE USER '+ 'p'.repeat(2000)},
    {role:'user',content:'yes, proceed with the proposal'},
    {role:'system',content:'SYSTEM CONSTRAINT'},
    {role:'assistant',content:'UNREFERENCED '+ 'u'.repeat(2000)},
    {role:'assistant',content:'OLD_B '+ 'b'.repeat(18000)},
  ]};
  const basis=await createContextBasis(task);
  task.checkpoint={content:'CHECKPOINT ORIGINAL',resumeState:{version:1,...basis,items:[{kind:'completed',text:'Verified earlier progress',references:[1,2,6].map(messageIndex=>({section:'message',messageIndex,digest:hash(task.messages[messageIndex].content)}))}]}};
  task.messages.push(...Array.from({length:31},(_,index)=>({role:index%2?'user':'assistant',content:`PENDING ${index} ORIGINAL`})));return task;
}

test('selection removes only referenced covered assistants and preserves every required original',async()=>{
  const task=await fixture(),full=await buildTaskContext(task),selected=await buildTaskContext(task,options);
  assert.equal(selected.readiness,'selected_ready');assert.equal(selected.complete,false);
  assert.equal(selected.manifest.selection.applied,'resume');assert.deepEqual(selected.manifest.selection.omittedMessageIndexes,[1,6]);
  assert.equal(selected.request,task.prompt);assert.equal(selected.checkpoint,task.checkpoint.content);
  for(const index of [2,3,4,5,...Array.from({length:31},(_,i)=>i+7)])assert.ok(selected.conversation.includes(task.messages[index].content));
  for(const index of [1,6]){assert.ok(!selected.conversation.includes(task.messages[index].content));assert.ok(selected.conversation.includes(hash(task.messages[index].content)));assert.equal(selected.manifest.messages[index].reference.section,'retrieval');}
  assert.match(selected.conversation,/not.*approval/i);assert.match(selected.conversation,/proposal.*original|original.*proposal/i);
  assert.ok(selected.metrics.inputBytes<full.metrics.inputBytes);assert.equal(selected.metrics.selectionSavedBytes,full.metrics.inputBytes-selected.metrics.inputBytes);
  assert.equal(selected.metrics.inputBytes,Buffer.byteLength(selected.request+selected.conversation+selected.checkpoint));
  assert.equal(selected.manifest.omissions.length,2);assert.equal(selected.manifest.retrievalRequired,true);
});

test('no reader, stale state, invalid state and mismatched execution mode preserve full context',async()=>{
  const original=await fixture(),full=await buildTaskContext(original);
  for(const [change,extra] of [[()=>{},{readerAvailable:false}],[t=>delete t.checkpoint.resumeState,{}],[t=>t.checkpoint.resumeState=null,{}],[t=>t.messages[1].content+='CHANGED',{}],[()=>{},{mode:'review'}]]){
    const task=structuredClone(original);change(task);const packet=await buildTaskContext(task,{...options,...extra}),expected=await buildTaskContext(task,{mode:extra.mode??'root'});
    assert.equal(packet.manifest.selection.applied,'full');assert.equal(packet.conversation,expected.conversation);assert.equal(packet.complete,true);
  }
  assert.equal((await buildTaskContext(original,{readerAvailable:true})).conversation,full.conversation);
});

test('strictly smaller candidate must fit including derived state and lookup guidance',async()=>{
  const task=await fixture(),selected=await buildTaskContext(task,options);
  assert.equal((await buildTaskContext(task,{...options,maxBytes:selected.metrics.inputBytes})).readiness,'selected_ready');
  const over=await buildTaskContext(task,{...options,maxBytes:selected.metrics.inputBytes-1});
  assert.equal(over.readiness,'full_over_budget');assert.equal(over.manifest.selection.applied,'full');assert.equal(over.manifest.selection.reason,'budget_exceeded');assert.equal(over.complete,true);
  const blocked=await buildTaskContext(task,{...options,maxBytes:selected.metrics.inputBytes-1,hardMaxBytes:selected.metrics.inputBytes-1});
  assert.equal(blocked.readiness,'blocked');assert.equal(blocked.manifest.selection.applied,'full');assert.equal(blocked.complete,false);
  const short={id:'short',version:1,prompt:'goal',messages:[{role:'assistant',content:'x'.repeat(500)}]};
  const basis=await createContextBasis(short);short.checkpoint={resumeState:{version:1,...basis,items:[{kind:'evidence',text:'derived',references:[{section:'message',messageIndex:0,digest:hash(short.messages[0].content)}]}]}};
  assert.equal((await buildTaskContext(short,options)).manifest.selection.applied,'full');
  const long=await fixture();long.messages[1].content='a'.repeat(100000);
  Object.assign(long.checkpoint.resumeState,await createContextBasis(long,{messageCount:7}));
  long.checkpoint.resumeState.items[0].references[0].digest=hash(long.messages[1].content);
  const unselected=await buildTaskContext(long);assert.equal(unselected.readiness,'full_over_budget');assert.equal(unselected.complete,true);
  const rescued=await buildTaskContext(long,options);assert.ok(rescued.metrics.inputBytes<unselected.metrics.inputBytes);assert.equal(rescued.readiness,'selected_ready');assert.ok(rescued.metrics.inputBytes<=96000);assert.equal(rescued.complete,false);
});

test('dedup references never point to a selected-out original',async()=>{
  const task=await fixture();task.messages[7].content=task.messages[1].content;
  const selected=await buildTaskContext(task,options);assert.equal(selected.readiness,'selected_ready');
  assert.equal(selected.manifest.messages[1].reference.section,'retrieval');assert.equal(selected.manifest.messages[7].included,true);
  assert.ok(selected.conversation.includes(task.messages[7].content));
  for(const entry of selected.manifest.messages)if(entry.reference?.section==='conversation')assert.equal(selected.manifest.messages[entry.reference.index].included,true);
});

test('selection snapshots sources and state before await without reading raw attachment bodies',async()=>{
  const task=await fixture(),before=structuredClone(task);let rawReads=0;
  Object.defineProperty(task.attachments[0],'text',{get(){rawReads++;throw Error('raw access forbidden');}});
  const pending=buildTaskContext(task,options);
  task.id='changed';task.version=99;task.prompt='changed';task.messages[1].content='changed';task.checkpoint.resumeState.items[0].text='changed';
  const selected=await pending;assert.deepEqual(selected,await buildTaskContext(before,options));assert.equal(rawReads,0);
});

test('reader availability alone never bootstraps oversized history',async()=>{
  const task={id:'large',version:1,prompt:'ORIGINAL',messages:[{role:'assistant',content:'x'.repeat(400000)}]};
  const packet=await buildTaskContext(task,options);assert.equal(packet.readiness,'blocked');assert.equal(packet.complete,false);assert.ok(packet.conversation.includes(task.messages[0].content));
  await assert.rejects(()=>buildTaskContext(task,{selection:'other'}),/selection/i);
  await assert.rejects(()=>buildTaskContext(task,{readerAvailable:'yes'}),/reader/i);
});

test('selected original lookup binds even the first page to its manifest source digest',async()=>{
  const task=await fixture(),packet=await buildTaskContext(task,options),source=packet.manifest.omissions[0];
  const query={taskId:packet.manifest.taskId,expectedVersion:packet.manifest.taskVersion,section:'message',messageIndex:source.messageIndex,offset:0,expectedDigest:source.digest};
  const page=await readTaskContext(task,query);
  assert.equal(page.contentDigest,source.digest);assert.equal(page.text,task.messages[source.messageIndex].content.slice(0,16000));
  task.messages[source.messageIndex].content='Changed original under the same task version';
  await assert.rejects(()=>readTaskContext(task,query),error=>error.statusCode===409&&/digest/.test(error.message));
  task.version++;
  await assert.rejects(()=>readTaskContext(task,query),error=>error.code==='CONTEXT_VERSION_CONFLICT');
});
