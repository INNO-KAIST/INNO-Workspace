import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTaskContext,FULL_CONTEXT_HARD_MAX_BYTES} from '../public/core/task-context.mjs';
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

test('the blocked-context notice states the same hard cap the assembler enforces',async()=>{
 const {ContextRetrievalRequiredError}=await import('../public/core/context-errors.mjs');
 const {failureInput,failureRecord,failureGuidance}=await import('../public/core/failures.mjs');
 const input=failureInput(new ContextRetrievalRequiredError());
 const record=failureGuidance({status:input.status,checkpoint:{failure:failureRecord(input,'2026-10-01T00:00:00.000Z')}});
 assert.ok(record.detail.includes(`${FULL_CONTEXT_HARD_MAX_BYTES/1000}KB`));
 assert.doesNotMatch(record.detail,/문맥 조회 또는 분할/);
});
