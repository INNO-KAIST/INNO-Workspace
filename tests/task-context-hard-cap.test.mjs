import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildTaskContext,FULL_CONTEXT_HARD_MAX_BYTES} from '../public/core/task-context.mjs';
import {createContextBasis} from '../public/core/context-resume.mjs';
const task=size=>({id:'long',version:2,prompt:'REQUEST',messages:[
 {role:'user',content:'REQUEST'},
 {role:'assistant',content:'LONG_BEGIN '+'x'.repeat(size)+' LONG_END'},
 {role:'user',content:'continue'},
]});

test('the hard cap is a fixed bound above the soft budget',()=>{
 assert.equal(FULL_CONTEXT_HARD_MAX_BYTES,384_000);
});

test('required context above the soft budget but within the hard cap is delivered complete',async()=>{
 const packet=await buildTaskContext(task(150_000));
 assert.equal(packet.complete,true);assert.equal(packet.readiness,'full_over_budget');
 assert.ok(packet.conversation.includes('LONG_END'));assert.ok(packet.conversation.includes('LONG_BEGIN'));
 assert.equal(packet.manifest.retrievalRequired,false);assert.deepEqual(packet.manifest.omissions,[]);
 assert.equal(packet.manifest.budget.exceeded,true);assert.equal(packet.manifest.budget.blocked,false);
 assert.equal(packet.manifest.budget.maxBytes,96_000);assert.equal(packet.manifest.budget.hardMaxBytes,FULL_CONTEXT_HARD_MAX_BYTES);
 assert.ok(packet.manifest.budget.requiredBytes>96_000);
});

test('required context beyond the hard cap stays blocked and incomplete',async()=>{
 const packet=await buildTaskContext(task(FULL_CONTEXT_HARD_MAX_BYTES));
 assert.equal(packet.complete,false);assert.equal(packet.readiness,'blocked');
 assert.equal(packet.manifest.budget.blocked,true);assert.equal(packet.manifest.retrievalRequired,true);
});

test('within the soft budget nothing is marked over budget',async()=>{
 const packet=await buildTaskContext(task(1000));
 assert.equal(packet.readiness,'full_ready');assert.equal(packet.manifest.budget.exceeded,false);assert.equal(packet.manifest.budget.blocked,false);
});

test('a hard cap below the soft budget is rejected',async()=>{
 await assert.rejects(()=>buildTaskContext(task(10),{maxBytes:1000,hardMaxBytes:999}),TypeError);
});

// A verified resume state references one old assistant draft; the nearest proposal,
// the user turn and the pending reply must always stay inline.
const sha=text=>createHash('sha256').update(text).digest('hex');
async function stated(oldBytes,userBytes){
 const old='OLD_BEGIN '+'x'.repeat(oldBytes)+' OLD_END';
 const t={id:'fit',version:3,type:'general',title:'fit',prompt:'REQUEST',plan:[],attachments:[],messages:[
  {id:'m0',role:'user',content:'REQUEST'},
  {id:'m1',role:'assistant',content:old},
  {id:'m2',role:'assistant',content:'NEAREST_PROPOSAL'},
  {id:'m3',role:'user',content:'USER_BEGIN '+'u'.repeat(userBytes)+' USER_END'},
  {id:'m4',role:'assistant',content:'PENDING_ASSISTANT'},
 ],checkpoint:{content:'CHECKPOINT'}};
 t.checkpoint.resumeState={version:1,...await createContextBasis(t,{messageCount:5}),items:[{kind:'completed',text:'Old draft.',references:[{section:'message',messageIndex:1,digest:sha(old)}]}]};
 return t;
}
const resume={selection:'resume',readerAvailable:true};

test('full history over the hard cap runs selected when the verified selection fits the cap',async()=>{
 const packet=await buildTaskContext(await stated(400_000,150_000),resume);
 assert.equal(packet.readiness,'selected_ready');assert.equal(packet.complete,false);
 assert.equal(packet.manifest.selection.applied,'resume');assert.equal(packet.manifest.selection.reason,'selected_over_budget');
 assert.deepEqual(packet.manifest.selection.omittedMessageIndexes,[1]);assert.equal(packet.manifest.retrievalRequired,true);
 const budget=packet.manifest.budget;
 assert.equal(budget.exceeded,true);assert.equal(budget.blocked,false);
 assert.ok(budget.requiredBytes>budget.maxBytes&&budget.requiredBytes<=FULL_CONTEXT_HARD_MAX_BYTES);
 for(const kept of ['NEAREST_PROPOSAL','USER_BEGIN','USER_END','PENDING_ASSISTANT'])assert.ok(packet.conversation.includes(kept),kept);
 assert.equal(packet.request,'REQUEST');assert.equal(packet.checkpoint,'CHECKPOINT');
 assert.ok(!packet.conversation.includes('OLD_END'));
});

test('a selection that still exceeds the hard cap stays blocked',async()=>{
 const packet=await buildTaskContext(await stated(400_000,390_000),resume);
 assert.equal(packet.readiness,'blocked');assert.equal(packet.manifest.selection.applied,'full');
 assert.equal(packet.manifest.selection.reason,'budget_exceeded');assert.equal(packet.manifest.budget.blocked,true);
});

test('full history within the hard cap is still preferred over an over-budget selection',async()=>{
 const packet=await buildTaskContext(await stated(100_000,150_000),resume);
 assert.equal(packet.readiness,'full_over_budget');assert.equal(packet.manifest.selection.applied,'full');
 assert.equal(packet.manifest.selection.reason,'budget_exceeded');assert.ok(packet.conversation.includes('OLD_END'));
});

test('without a working reader full history over the hard cap stays blocked',async()=>{
 const packet=await buildTaskContext(await stated(400_000,150_000),{selection:'resume',readerAvailable:false});
 assert.equal(packet.readiness,'blocked');assert.equal(packet.manifest.selection.reason,'reader_unavailable');
});

test('the blocked-context notice states the same hard cap the assembler enforces',async()=>{
 const {ContextRetrievalRequiredError}=await import('../public/core/context-errors.mjs');
 const {failureInput,failureRecord,failureGuidance}=await import('../public/core/failures.mjs');
 const input=failureInput(new ContextRetrievalRequiredError());
 const record=failureGuidance({status:input.status,checkpoint:{failure:failureRecord(input,'2026-10-01T00:00:00.000Z')}});
 assert.ok(record.detail.includes(`${FULL_CONTEXT_HARD_MAX_BYTES/1000}KB`));
 assert.doesNotMatch(record.detail,/문맥 조회 또는 분할/);
});
