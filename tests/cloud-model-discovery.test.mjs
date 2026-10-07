import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {OfficialModelDiscovery} from '../worker/model-discovery.mjs';
import {createWorker} from '../worker/index.mjs';

const openai = '# Models\n\n## Featured models\n\n- [GPT-6 Astra](/api/docs/models/gpt-6-astra.md): Start here.\n\n## Browse our full catalog of models\n\n- [GPT-6 Astra](/api/docs/models/gpt-6-astra.md): Start here.\n- [GPT-6 Sol](/api/docs/models/gpt-6-sol.md): Coding.\n';
const claude = '# Model configuration\n\n### Model aliases\n\n| Model alias      | Behavior |\n| ---------------- | -------- |\n| **`sonnet`**     | Uses the latest Sonnet model |\n| **`opus`**       | Uses the latest Opus model |\n| **`haiku`**      | Uses the fast Haiku model |\n\n| Provider      | `opus`   | `sonnet` |\n| :------------ | :------- | :------- |\n| Anthropic API | Opus 5.5 | Sonnet 5 |\n';
const url = {openai:'https://developers.openai.com/api/docs/models.md',claude:'https://code.claude.com/docs/en/model-config.md'};
function fixture(fetchFn){const db=new TestD1(),store=new D1TaskStore(db);let now=Date.parse('2026-09-27T00:00:00Z');store.now=()=>new Date(now).toISOString();return {db,store,discovery:new OfficialModelDiscovery(store,{fetchFn}),advance:ms=>now+=ms};}
function response(text,headers={}){return new Response(text,{status:200,headers:{'content-type':'text/markdown',...headers}})}

test('explicit official fields produce bounded, unverified candidates and a daily conditional refresh',async t=>{
 const calls=[];const f=fixture(async(input,init)=>{calls.push({input,init});return calls.length<=2?response(input===url.openai?openai:claude,{'etag':'"v1"'}):new Response(null,{status:304});});t.after(()=>f.db.close());
 await f.discovery.refresh();const initial=await f.discovery.read();
 assert.deepEqual(initial.sources.map(s=>s.status),['fresh','fresh']);
 assert.deepEqual(initial.candidates.filter(c=>c.provider==='openai').map(c=>c.id),['gpt-6-astra','gpt-6-sol']);
 assert.deepEqual(initial.candidates.filter(c=>c.provider==='claude').map(c=>[c.id,c.documentedTarget]),[['sonnet','Sonnet 5'],['opus','Opus 5.5'],['haiku',null]]);
 assert.ok(initial.candidates.every(c=>c.accountAvailability==='unknown'&&c.promotionStatus==='candidate'));
 assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.input),[url.openai,url.claude]);
 await f.discovery.refresh();assert.equal(calls.length,2);
 f.advance(86400000);await f.discovery.refresh();assert.equal(calls.length,4);
 assert.ok(calls.every(c=>c.init.credentials==='omit'&&c.init.redirect==='manual'&&!('authorization' in c.init.headers)));
 assert.equal(calls[2].init.headers['if-none-match'],'"v1"');
 assert.equal((await f.discovery.read()).candidates.length,5);
 assert.equal((await f.discovery.read()).sources[0].status,'fresh');
});

test('format drift and network failure retain last good candidates, expose stale status, and back off',async t=>{
 const calls=[];let bad=false;const f=fixture(async input=>{calls.push(input);if(bad){if(input===url.openai)return response('# Models\n\nRandom gpt-9 text');throw Error('offline');}return response(input===url.openai?openai:claude);});t.after(()=>f.db.close());
 await f.discovery.refresh();bad=true;f.advance(86400000);await f.discovery.refresh();
 const after=await f.discovery.read();assert.equal(after.candidates.length,5);assert.deepEqual(after.sources.map(s=>s.status),['stale','stale']);assert.deepEqual(after.sources.map(s=>s.lastError),['format_changed','network_error']);
 await f.discovery.refresh();assert.equal(calls.length,4);
 f.advance(900000);await f.discovery.refresh();assert.equal(calls.length,6);
});

test('redirect and oversize responses never replace last good evidence',async t=>{
 let mode='good';const f=fixture(async input=>mode==='good'?response(input===url.openai?openai:claude):mode==='redirect'?new Response(null,{status:302,headers:{location:'https://evil.test'}}):response('x'.repeat(200001),{'content-length':'200001'}));t.after(()=>f.db.close());
 await f.discovery.refresh();mode='redirect';f.advance(86400000);await f.discovery.refresh();assert.equal((await f.discovery.read()).candidates.length,5);assert.deepEqual((await f.discovery.read()).sources.map(s=>s.lastError),['redirect_rejected','redirect_rejected']);
 mode='large';f.advance(86400000);await f.discovery.refresh();assert.deepEqual((await f.discovery.read()).sources.map(s=>s.lastError),['body_too_large','body_too_large']);
});

test('D1 claim allows only one concurrent refresh owner',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);let calls=0;const f=fixture(async input=>{calls++;if(calls===1)await gate;return response(input===url.openai?openai:claude);});t.after(()=>f.db.close());
 const first=f.discovery.refresh();await new Promise(resolve=>setTimeout(resolve,0));await f.discovery.refresh();assert.equal(calls,1);release();await first;assert.equal(calls,2);
});

test('scheduled refresh stays in background and its authenticated endpoint exposes only candidate evidence',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),pending=[];const db=new TestD1();t.after(()=>db.close());
 const worker=createWorker({fetchFn:async input=>{await gate;return response(input===url.openai?openai:claude);}});
 const env={DB:db,ACCESS_TOKEN:'model-discovery-test-token-1234567890'};
 assert.equal((await worker.fetch(new Request('https://inno.test/api/model-discovery'),env)).status,401);
 const scheduled=worker.scheduled({},env,{waitUntil:promise=>pending.push(promise)});
 await Promise.race([scheduled,new Promise((_,reject)=>setTimeout(()=>reject(Error('orchestration delayed')),200))]);
 // Background work: discovery refresh, review observations, policy retention, context-read sweep, bounded settlements,
 // and moving auto tasks that waited too long on the PC to the cloud (CR-010).
 assert.equal(pending.length,6);release();await Promise.all(pending);
 const result=await worker.fetch(new Request('https://inno.test/api/model-discovery',{headers:{authorization:'Bearer '+env.ACCESS_TOKEN}}),env);
 assert.equal(result.status,200);const body=await result.json();assert.equal(body.candidates.length,5);assert.ok(body.candidates.every(c=>c.accountAvailability==='unknown'));
});

test('scheduled without waitUntil waits for refresh while preserving drain result',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);const db=new TestD1();t.after(()=>db.close());
 const worker=createWorker({fetchFn:async input=>{await gate;return response(input===url.openai?openai:claude);}});
 const env={DB:db};let settled=false;
 const scheduled=worker.scheduled({},env).then(value=>{settled=true;return value;});
 await new Promise(resolve=>setTimeout(resolve,0));const settledBeforeRelease=settled;
 release();assert.deepEqual(await scheduled,{checked:0,failed:0});assert.equal(settledBeforeRelease,false);
 const discovery=new OfficialModelDiscovery(new D1TaskStore(db));assert.equal((await discovery.read()).candidates.length,5);
});

test('refresh failure cannot suppress scheduled drain result or rejection',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const worker=createWorker({fetchFn:async()=>{throw Error('offline');}});
 assert.deepEqual(await worker.scheduled({},{DB:db}),{checked:0,failed:0});
 const discovery=new OfficialModelDiscovery(new D1TaskStore(db));assert.deepEqual((await discovery.read()).sources.map(s=>s.lastError),['network_error','network_error']);
 const brokenDb={prepare(sql){if(sql.includes('orchestration_cursor'))throw Error('drain unavailable');return db.prepare(sql);}};
 await assert.rejects(()=>worker.scheduled({},{DB:brokenDb}),/drain unavailable/);
});

test('new documented Claude alias is a candidate while special selectors are excluded',async t=>{
 const updated=claude.replace('| **`haiku`**', '| **`sage`**      | Uses a new model |\n| **`best`**      | Special router |\n| **`default`**   | Clears override |\n| **`opusplan`**  | Plan mode selector |\n| **`sonnet[1m]`** | Context selector |\n| **`haiku`**');
 const f=fixture(async input=>response(input===url.openai?openai:updated));t.after(()=>f.db.close());await f.discovery.refresh();
 const ids=(await f.discovery.read()).candidates.filter(c=>c.provider==='claude').map(c=>c.id);
 assert.deepEqual(ids,['sonnet','opus','sage','haiku']);
});

test('body read deadline records timeout even when a stream ignores abort',async t=>{
 const f=fixture(async input=>input===url.openai?new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'text/markdown'}}):response(claude));t.after(()=>f.db.close());
 f.discovery.timeoutMs=20;await f.discovery.refresh();const state=await f.discovery.read();assert.equal(state.sources[0].lastError,'timeout');assert.equal(state.sources[1].status,'fresh');
});

test('expired lease owner cannot overwrite evidence written by a new owner',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);let calls=0;
 const f=fixture(async input=>{if(input===url.openai&&++calls===1)await gate;return response(input===url.openai?openai.replace('gpt-6-sol','gpt-6-luna'):claude);});t.after(()=>f.db.close());
 const old=f.discovery.refresh();await new Promise(resolve=>setTimeout(resolve,0));f.advance(61000);
 await f.discovery.refresh();release();await old;
 assert.deepEqual((await f.discovery.read()).candidates.filter(c=>c.provider==='openai').map(c=>c.id),['gpt-6-astra','gpt-6-luna']);
});
