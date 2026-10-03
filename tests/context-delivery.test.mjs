import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildTaskContext} from '../public/core/task-context.mjs';
import {createContextBasis} from '../public/core/context-resume.mjs';
import {contextDelivery,boundedContextDelivery,contextDeliveryText} from '../public/core/context-delivery.mjs';
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

test('the delivery notice states bytes, budget and outcome without claiming token savings',async()=>{
 const base={version:1,provider:'codex',unit:'utf8_bytes',contextBytes:120500,originalBytes:130000,selectionSavedBytes:0,omittedMessages:0,maxBytes:96000,hardMaxBytes:384000,reader:false,promptBytes:150000,materialBytes:0,inputTokens:null,cachedTokens:null};
 assert.match(contextDeliveryText({...base,readiness:'full_over_budget'}),/120\.5KB.*96KB 초과.*384KB 이내.*잘라내지 않고/);
 assert.match(contextDeliveryText({...base,readiness:'full_ready',contextBytes:5000}),/전문 5KB/);
 assert.match(contextDeliveryText({...base,readiness:'selected_ready',contextBytes:40000,selectionSavedBytes:20000,omittedMessages:2,reader:true}),/선택 40KB.*2건.*20KB/);
 assert.match(contextDeliveryText({...base,readiness:'blocked',contextBytes:400000,promptBytes:null}),/차단.*400KB.*384KB/);
 assert.match(contextDeliveryText({...base,readiness:'full_ready'}),/전체 프롬프트 150KB/);
 assert.doesNotMatch(contextDeliveryText({...base,readiness:'full_ready'}),/토큰 절감|tokens saved/);
 assert.equal(contextDeliveryText(null),null);assert.equal(contextDeliveryText({bad:true}),null);
});
