import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildTaskContext} from '../public/core/task-context.mjs';
import {createContextBasis} from '../public/core/context-resume.mjs';
import {contextDelivery,boundedContextDelivery,contextDeliveryText,withRetrieval} from '../public/core/context-delivery.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const task=size=>({id:'t',version:2,prompt:'REQUEST',messages:[{role:'user',content:'REQUEST'},{role:'assistant',content:'x'.repeat(size)},{role:'user',content:'continue'}]});

test('a full packet is summarized in UTF-8 bytes with unreported tokens left null',async()=>{
 const packet=await buildTaskContext(task(1000));
 const d=contextDelivery(packet,{provider:'codex',promptBytes:5000,materialBytes:0,reader:false});
 assert.deepEqual(d,{version:1,provider:'codex',unit:'utf8_bytes',readiness:'full_ready',contextBytes:packet.metrics.inputBytes,originalBytes:packet.metrics.uncompressedBytes,selectionSavedBytes:0,omittedMessages:0,maxBytes:96000,hardMaxBytes:384000,reader:false,promptBytes:5000,materialBytes:0,inputTokens:null,cachedTokens:null});
 assert.deepEqual(boundedContextDelivery(d),d);
});

test('selected, over-budget and blocked packets keep their distinct outcomes',async()=>{
 const t=task(30000);t.messages.splice(2,0,{role:'assistant',content:'y'.repeat(30000)});
 const basis=await createContextBasis(t);
 t.checkpoint={content:'CP',resumeState:{version:1,...basis,items:[{kind:'completed',text:'done',references:[1,2].map(messageIndex=>({section:'message',messageIndex,digest:hash(t.messages[messageIndex].content)}))}]}};
 t.messages.push({role:'user',content:'next'});
 const selected=contextDelivery(await buildTaskContext(t,{selection:'resume',readerAvailable:true}),{provider:'claude',promptBytes:null,materialBytes:null,reader:true});
 assert.equal(selected.readiness,'selected_ready');assert.ok(selected.selectionSavedBytes>0);assert.ok(selected.omittedMessages>=1);assert.equal(selected.reader,true);
 // CTX-02 fixture measurement, pinned: the omitted 30 000-byte reply is replaced by the verified resume summary and its
 // references, so the sent history is 32 148 of 60 141 bytes and the selection saves 27 965 bytes (UTF-8 bytes, no tokenizer).
 assert.deepEqual([selected.originalBytes,selected.contextBytes,selected.selectionSavedBytes],[60141,32148,27965]);
 const over=contextDelivery(await buildTaskContext(task(150000)),{provider:'codex',promptBytes:200000,materialBytes:10,reader:false});
 assert.equal(over.readiness,'full_over_budget');assert.ok(over.contextBytes>96000);
 const blocked=contextDelivery(await buildTaskContext(task(400000)),{provider:'codex',promptBytes:null,materialBytes:null,reader:false});
 assert.equal(blocked.readiness,'blocked');assert.equal(blocked.promptBytes,null);
 for(const d of [selected,over,blocked])assert.deepEqual(boundedContextDelivery(d),d);
});

test('stored delivery evidence is strictly bounded and never invents token counts',async()=>{
 const d=contextDelivery(await buildTaskContext(task(10)),{provider:'codex',promptBytes:1,materialBytes:0,reader:false});
 assert.equal(boundedContextDelivery(null),null);assert.equal(boundedContextDelivery(undefined),null);
 for(const bad of [{...d,extra:1},{...d,readiness:'partial'},{...d,provider:'api'},{...d,contextBytes:-1},{...d,originalBytes:1.5},{...d,inputTokens:12},{...d,cachedTokens:0},{...d,unit:'tokens'},{...d,reader:'yes'},{...d,promptBytes:'1'},[],'x'])
  assert.throws(()=>boundedContextDelivery(bad),{name:'ValidationError'});
});

test('measured scoped re-reads travel with the delivery record only as a complete pair',async()=>{
 const packet=await buildTaskContext(task(1000));
 const measured=contextDelivery(packet,{provider:'codex',promptBytes:5000,materialBytes:1000,reader:true,retrieval:{requests:3,bytes:2048}});
 assert.equal(measured.retrievalRequests,3);assert.equal(measured.retrievalBytes,2048);
 assert.deepEqual(boundedContextDelivery(measured),measured);
 const unmeasured=contextDelivery(packet,{provider:'codex',promptBytes:5000,materialBytes:0,reader:true});
 assert.equal(Object.hasOwn(unmeasured,'retrievalRequests'),false);assert.deepEqual(boundedContextDelivery(unmeasured),unmeasured);
 const {retrievalBytes,...half}=measured;
 for(const bad of [half,{...measured,retrievalRequests:-1},{...measured,retrievalBytes:1.5},{...measured,retrievalRequests:'3'},{...measured,retrievalBytes:null}])
  assert.throws(()=>boundedContextDelivery(bad),{name:'ValidationError'});
 assert.deepEqual(withRetrieval(unmeasured,{requests:2,bytes:10}),{...unmeasured,retrievalRequests:2,retrievalBytes:10});
 assert.equal(withRetrieval(unmeasured,{requests:-1,bytes:10}),unmeasured);assert.equal(withRetrieval(null,{requests:1,bytes:1}),null);
});

test('the notice splits the prompt and reports re-reads only where a reader existed',()=>{
 const base={version:1,provider:'codex',unit:'utf8_bytes',readiness:'selected_ready',contextBytes:40000,originalBytes:90000,selectionSavedBytes:50000,omittedMessages:2,maxBytes:96000,hardMaxBytes:384000,reader:true,promptBytes:60000,materialBytes:5000,inputTokens:null,cachedTokens:null};
 assert.match(contextDeliveryText({...base,retrievalRequests:3,retrievalBytes:12500}),/원문 재조회 3회, 응답 12\.5KB/);
 assert.match(contextDeliveryText(base),/원문 재조회 미측정/);
 assert.doesNotMatch(contextDeliveryText({...base,readiness:'full_ready',reader:false,selectionSavedBytes:0,omittedMessages:0}),/재조회/);
 assert.match(contextDeliveryText(base),/전체 프롬프트 60KB \(작업 이력 40KB, 첨부 발췌 5KB, 지침·형식 15KB\)/);
 assert.match(contextDeliveryText({...base,materialBytes:null}),/전체 프롬프트 60KB\./);
});

test('the delivery notice states bytes, budget and outcome without claiming token savings',async()=>{
 const base={version:1,provider:'codex',unit:'utf8_bytes',contextBytes:120500,originalBytes:130000,selectionSavedBytes:0,omittedMessages:0,maxBytes:96000,hardMaxBytes:384000,reader:false,promptBytes:150000,materialBytes:0,inputTokens:null,cachedTokens:null};
 assert.match(contextDeliveryText({...base,readiness:'full_over_budget'}),/120\.5KB.*96KB 초과.*384KB 이내.*잘라내지 않고/);
 assert.match(contextDeliveryText({...base,readiness:'full_ready',contextBytes:5000}),/전문 5KB/);
 assert.match(contextDeliveryText({...base,readiness:'selected_ready',contextBytes:40000,selectionSavedBytes:20000,omittedMessages:2,reader:true}),/선택 40KB.*2건.*20KB/);
 assert.doesNotMatch(contextDeliveryText({...base,readiness:'selected_ready',contextBytes:40000,selectionSavedBytes:20000,omittedMessages:2,reader:true}),/예산.*초과/);
 assert.match(contextDeliveryText({...base,readiness:'selected_ready',contextBytes:150000,selectionSavedBytes:400000,omittedMessages:1,reader:true}),/선택 150KB.*1건.*400KB.*예산 96KB 초과.*상한 384KB 이내/);
 assert.match(contextDeliveryText({...base,readiness:'blocked',contextBytes:400000,promptBytes:null}),/차단.*400KB.*384KB/);
 assert.match(contextDeliveryText({...base,readiness:'full_ready'}),/전체 프롬프트 150KB/);
 assert.doesNotMatch(contextDeliveryText({...base,readiness:'full_ready'}),/토큰 절감|tokens saved/);
 assert.equal(contextDeliveryText(null),null);assert.equal(contextDeliveryText({bad:true}),null);
});
