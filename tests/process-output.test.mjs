import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEventCollector,createTailCollector} from '../server/process-output.mjs';
test('long event streams retain final answer usage and failure without keeping tool logs',()=>{
 const c=createEventCollector();c.write('{"type":"thread.started","thread_id":"t"}\n');
 for(let i=0;i<10000;i++)c.write(JSON.stringify({type:'item.completed',item:{type:'command_execution',aggregated_output:'private tool log '.repeat(20)}})+'\n');
 for(let i=0;i<100;i++)c.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'answer '+i}})+'\n');
 c.write('{"type":"turn.completed","usage":{"input_tokens":17,"output_tokens":5}}');
 const output=c.finish();assert.ok(output.length<500);assert.ok(output.includes('answer 99'));assert.ok(output.includes('input_tokens'));assert.equal(output.includes('private tool log'),false);assert.equal(output.includes('answer 98'),false);
});
test('chunk boundaries preserve Korean text and terminal failures',()=>{
 const c=createEventCollector();const data=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'검증 완료'}})+'\r\n'+JSON.stringify({type:'turn.failed',error:{message:'usage limit'}});
 for(let i=0;i<data.length;i+=3)c.write(data.slice(i,i+3));const events=c.finish().split('\n').map(JSON.parse);assert.equal(events[0].item.text,'검증 완료');assert.equal(events[1].type,'turn.failed');
});
test('oversized individual records fail explicitly instead of truncating results',()=>{const c=createEventCollector({maxLineChars:128});c.write('x'.repeat(100));assert.throws(()=>c.write('x'.repeat(29)),{code:'OUTPUT_LIMIT'});});
test('diagnostic tail retains only its bounded suffix',()=>{const c=createTailCollector(128);for(let i=0;i<1000;i++)c.write('x'.repeat(100));c.write('tail');assert.equal(c.finish().length,128);assert.ok(c.finish().endsWith('tail'));});

test('earlier actionable diagnostics and first terminal failure survive later generic errors',()=>{const c=createEventCollector();for(const event of [{type:'error',message:'quota exceeded'},{type:'error',message:'stream ended'},{type:'turn.failed',error:{message:'first failure'}},{type:'turn.failed',error:{message:'later failure'}}])c.write(JSON.stringify(event)+'\n');const events=c.finish().split('\n').map(JSON.parse);assert.equal(events.find(e=>e.type==='error').message,'quota exceeded');assert.equal(events.find(e=>e.type==='turn.failed').error.message,'first failure');});
test('cached counts survive bounded event collection',()=>{const c=createEventCollector();c.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:80,output_tokens:3}}));assert.equal(JSON.parse(c.finish()).usage.cached_input_tokens,80);});
