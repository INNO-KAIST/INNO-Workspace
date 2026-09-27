import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {ModelCatalog} from '../worker/model-catalog.mjs';
test('catalog accepts only supported assignments, throttles identical writes, expires old account capabilities',async t=>{const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db);let clock=Date.now();store.now=()=>new Date(clock).toISOString();const catalog=new ModelCatalog(store);const models=[{model:'gpt-5.6-luna',efforts:['low'],isDefault:false}];await catalog.report({models,observedAt:clock,status:'fresh'});const first=await catalog.stored();clock+=60000;await catalog.report({models,observedAt:first.reportedAt,status:'fresh'});assert.equal((await catalog.stored()).reportedAt,first.reportedAt);await catalog.validate([{provider:'codex',requestedModel:'gpt-5.6-luna',effort:'low'}]);await assert.rejects(()=>catalog.validate([{provider:'codex',requestedModel:'gpt-5.6-luna',effort:'high'}]));await assert.rejects(()=>catalog.report([...models,...models]));clock+=7200000;assert.deepEqual((await catalog.read()).codex,[]);await assert.rejects(()=>catalog.validate([{provider:'codex',requestedModel:'gpt-5.6-luna',effort:'low'}]));await catalog.report({models,observedAt:clock,status:'fresh'});assert.equal((await catalog.read()).codex.length,1);});
test('replayed desktop observation and failed refresh never renew account evidence',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db);let clock=Date.now();store.now=()=>new Date(clock).toISOString();const catalog=new ModelCatalog(store);
 const models=[{model:'gpt-5.6-luna',efforts:['low'],isDefault:false}];
 await catalog.report({models,observedAt:clock,status:'fresh'});const first=await catalog.stored();
 clock+=3600000;await new ModelCatalog(store).report({models,observedAt:first.reportedAt,status:'fresh'});assert.equal((await catalog.stored()).reportedAt,first.reportedAt);
 await catalog.report({models:[],observedAt:first.reportedAt,status:'unavailable'});assert.equal((await catalog.stored()).reportedAt,first.reportedAt);
 assert.equal((await catalog.read()).availability,'refresh_failed');assert.deepEqual((await catalog.read()).codex,models);
 clock+=3600001;const expired=await catalog.read();assert.deepEqual(expired.codex,[]);assert.deepEqual(expired.lastGoodCodex,models);assert.equal(expired.availability,'expired');
 await assert.rejects(()=>catalog.validate([{provider:'codex',requestedModel:'gpt-5.6-luna',effort:'low'}]));
});
test('legacy arrays are diagnostic only and cannot replace a verified observation',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db);let clock=Date.now();store.now=()=>new Date(clock).toISOString();const catalog=new ModelCatalog(store);
 const old=[{model:'old',efforts:['low']}],current=[{model:'current',efforts:['high']}];
 await catalog.report(old);assert.deepEqual((await catalog.read()).codex,[]);assert.equal((await catalog.read()).availability,'legacy_unverified');
 await assert.rejects(()=>catalog.validate([{provider:'codex',requestedModel:'old',effort:'low'}]));
 clock+=1000;await catalog.report({models:current,observedAt:clock,status:'fresh'});const verified=await catalog.stored();
 clock+=3600000;await catalog.report(old);await catalog.report([{model:'changed',efforts:['medium']}]);
 assert.deepEqual(await catalog.stored(),verified);assert.deepEqual((await catalog.read()).codex,[{model:'current',efforts:['high'],isDefault:false}]);
});
test('older concurrent success and failure reports cannot overwrite newer account evidence',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db);let clock=Date.now();store.now=()=>new Date(clock).toISOString();
 const old=[{model:'old',efforts:['low']}],newer=[{model:'newer',efforts:['high']}];
 const current=new ModelCatalog(store);await current.report({models:old,observedAt:clock,status:'fresh'});
 async function delayedReport(input,whileDelayed){
  let entered;const reachedWrite=new Promise(resolve=>{entered=resolve;});let release;const wait=new Promise(resolve=>{release=resolve;});
  const delayedDb={prepare(sql){return {bind(...args){
   const statement=db.prepare(sql).bind(...args);
   return {async run(){entered();await wait;return statement.run();}};
  }};}};
  const delayed=new ModelCatalog({now:store.now,db:delayedDb});
  const pending=delayed.report(input);await reachedWrite;await whileDelayed();release();await pending;
 }
 const newerAt=clock+2000;
  await delayedReport({models:old,observedAt:clock+1000,status:'fresh'},async()=>{clock=newerAt;await current.report({models:newer,observedAt:newerAt,status:'fresh'});});
 assert.equal((await current.read()).codex[0].model,'newer');
  await delayedReport({models:[],observedAt:newerAt,status:'unavailable'},async()=>{clock=newerAt+1000;await current.report({models:newer,observedAt:clock,status:'fresh'});});
 assert.equal((await current.read()).availability,'fresh');assert.equal((await current.read()).codex[0].model,'newer');
});
test('future and older desktop timestamps cannot extend or replace the latest account observation',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db);let clock=Date.now();store.now=()=>new Date(clock).toISOString();const catalog=new ModelCatalog(store);
 const models=[{model:'current',efforts:['high']}],older=[{model:'old',efforts:['low']}];
 await catalog.report({models,observedAt:clock,status:'fresh'});
 await assert.rejects(()=>catalog.report({models:older,observedAt:clock+3600000,status:'fresh'}),/observation time/i);
 await catalog.report({models:older,observedAt:clock-1000,status:'fresh'});
 assert.deepEqual((await catalog.read()).codex,[{model:'current',efforts:['high'],isDefault:false}]);
});
