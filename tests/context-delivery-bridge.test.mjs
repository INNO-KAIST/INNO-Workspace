import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
const claim={claim:{task:{id:'t'},executionId:'e',generation:1}};
const delivery={version:1,provider:'codex',unit:'utf8_bytes',readiness:'full_over_budget',contextBytes:120000,originalBytes:121000,selectionSavedBytes:0,omittedMessages:0,maxBytes:96000,hardMaxBytes:384000,reader:false,promptBytes:150000,materialBytes:0,inputTokens:null,cachedTokens:null};
function harness(run){
 const sent=[];let saved=null;
 const bridge=createDesktopBridge({outbox:{read:()=>saved,write:v=>{saved=v;},clear:()=>{saved=null;}},runner:{run},request:async(route,input)=>{if(route.endsWith('poll'))return claim;sent.push({route,input});return {};}});
 return {bridge,sent};
}

test('completion records carry the runner context delivery',async()=>{
 const h=harness(async()=>({content:'ok',contextDelivery:delivery}));
 await h.bridge.tick();
 assert.equal(h.sent[0].route,'/api/desktop/t/complete');assert.deepEqual(h.sent[0].input.contextDelivery,delivery);
});

test('failure records carry the context delivery attached to the runner error',async()=>{
 const h=harness(async()=>{throw Object.assign(Error('blocked'),{code:'CONTEXT_RETRIEVAL_REQUIRED',contextDelivery:{...delivery,readiness:'blocked',promptBytes:null}});});
 await h.bridge.tick();
 assert.equal(h.sent[0].route,'/api/desktop/t/fail');assert.equal(h.sent[0].input.contextDelivery.readiness,'blocked');
});

test('invalid delivery evidence is dropped without losing the result',async()=>{
 const h=harness(async()=>({content:'kept',contextDelivery:{...delivery,inputTokens:9}}));
 await h.bridge.tick();
 assert.equal(h.sent[0].input.content,'kept');assert.equal(Object.hasOwn(h.sent[0].input,'contextDelivery'),false);
});
