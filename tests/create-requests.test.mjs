import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteTaskStore} from '../server/store.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {WorkspaceClient} from '../public/core/client.mjs';
const requestId='f228787c-4210-4816-8112-9d058b7a1176';
for(const backend of ['sqlite','d1'])test(`${backend} create replay preserves current task and revision and rejects changed payload`,async t=>{
 const db=backend==='d1'?new TestD1():null,store=db?new D1TaskStore(db):new SqliteTaskStore();t.after(()=>db?db.close():store.close());const input={requestId,prompt:'initial request'};
 const first=await store.createTask(input);await store.applyAction(first.id,{action:'message',content:'later direction',expectedVersion:first.version});const before=await store.getState();const replay=await store.createTask(input);
 assert.equal(replay.id,first.id);assert.equal(replay.version,2);assert.equal((await store.listTasks()).length,1);assert.equal((await store.getState()).revision,before.revision);
 await assert.rejects(async()=>store.createTask({...input,prompt:'different request'}),e=>e.statusCode===409);assert.equal((await store.listTasks()).length,1);
 await assert.rejects(async()=>store.createTask({requestId:'../../bad',prompt:'request'}),e=>e.statusCode===400);
});
test('browser retries a lost create response with the same ID after client reconstruction without storing source text',async()=>{
 const values=new Map(),retryStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};const options={remote:true,baseUrl:'https://inno.test',token:'PRIVATE_TOKEN',retryStorage};
 const first=new WorkspaceClient(options);let sent;first.request=async(p,b)=>{sent=b;throw Error('response lost');};await assert.rejects(()=>first.create({prompt:'PRIVATE_PROMPT'}));assert.match(sent.requestId,/^[0-9a-f-]{36}$/);assert.equal(savedContainsPrivate(),false);function savedContainsPrivate(){return JSON.stringify([...values]).includes('PRIVATE');}
 const second=new WorkspaceClient(options);let retried;second.request=async(p,b)=>{if(b){retried=b;return {task:{id:'saved',version:1}};}return {revision:1,tasks:[{id:'saved',version:1}]};};await second.create({prompt:'PRIVATE_PROMPT'});assert.equal(retried.requestId,sent.requestId);assert.equal(JSON.stringify([...values]).includes('PRIVATE'),false);
 let next;second.request=async(p,b)=>{if(b){next=b;return {task:{id:'next',version:1}};}return {revision:2,tasks:[{id:'next',version:1}]};};await second.create({prompt:'PRIVATE_PROMPT'});assert.notEqual(next.requestId,sent.requestId);
});

test('concurrent D1 creates share one atomic winner and one revision',async t=>{
 const db=new TestD1();t.after(()=>db.close());const batch=db.batch.bind(db);let queue=Promise.resolve();db.batch=statements=>{const pending=queue.then(()=>batch(statements));queue=pending.catch(()=>{});return pending;};
 const first=new D1TaskStore(db),second=new D1TaskStore(db);const results=await Promise.all([first.createTask({requestId,prompt:'race'}),second.createTask({requestId,prompt:'race'})]);assert.equal(results[0].id,results[1].id);assert.equal((await first.listTasks()).length,1);assert.equal((await first.getState()).revision,1);
});
test('retry ledger bounds unresolved metadata without dropping earlier identities',async()=>{
 const {CreationRetries}=await import('../public/core/create-requests.mjs');const ledger=new CreationRetries('scope',null);const first=await ledger.begin({prompt:'p0'});for(let i=1;i<16;i++)await ledger.begin({prompt:'p'+i});await assert.rejects(()=>ledger.begin({prompt:'overflow'}),/16/);assert.equal((await ledger.begin({prompt:'p0'})).id,first.id);ledger.finish(first);await ledger.begin({prompt:'overflow'});assert.equal(ledger.rows.length,16);
});

test('malformed acknowledgment retains the retry identity',async()=>{const c=new WorkspaceClient({remote:true,retryStorage:null});const ids=[];c.request=async(p,b)=>{ids.push(b.requestId);return {task:null};};await assert.rejects(()=>c.create({prompt:'retry me'}),/저장 확인/);await assert.rejects(()=>c.create({prompt:'retry me'}),/저장 확인/);assert.equal(ids[0],ids[1]);});
test('request identity is isolated by server credentials',async()=>{const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};const first=new WorkspaceClient({remote:true,token:'first',retryStorage:storage}),second=new WorkspaceClient({remote:true,token:'second',retryStorage:storage});const ids=[];for(const c of [first,second]){c.request=async(p,b)=>{ids.push(b.requestId);throw Error('lost');};await assert.rejects(()=>c.create({prompt:'same'}));}assert.notEqual(ids[0],ids[1]);});
