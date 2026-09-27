import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceClient, validateEndpoint, exportBundle, parseBundle } from '../public/core/client.mjs';

test('remote credentials cannot be configured over insecure HTTP', () => {
  assert.equal(validateEndpoint('https://research.example/'), 'https://research.example');
  assert.equal(validateEndpoint('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.throws(() => validateEndpoint('http://research.example'), /HTTPS/);
  assert.throws(() => validateEndpoint('https://user:secret@example.com'), /인증/);
});

test('checkpoint export retains work but cannot copy connected source bytes or access tokens', () => {
  const bundle = exportBundle({revision:1, token:'credential',tasks:[{
    id:'task-1',title:'Research',prompt:'Compare',version:1,status:'queued',
    messages:[{role:'user',content:'Compare'}],plan:[],artifacts:[],
    attachments:[{id:'a',name:'paper.txt',path:'folder/paper.txt',size:9,content:'SOURCE_SECRET',data:'RAW_SECRET'}]
  }]});
  assert.equal(JSON.stringify(bundle).includes('SOURCE_SECRET'),false);
  assert.equal(JSON.stringify(bundle).includes('RAW_SECRET'),false);
  assert.equal(JSON.stringify(bundle).includes('credential'),false);
  assert.equal(parseBundle(JSON.stringify(bundle)).tasks[0].attachments[0].name,'paper.txt');
});

test('malformed restore cannot create a misleading successful task', () => {
  assert.throws(()=>parseBundle('{"format":"other","tasks":[]}'),/형식/);
  assert.throws(()=>parseBundle(JSON.stringify({format:'inno-workspace-v1',tasks:[{title:'missing id'}]})),/작업/);
});

// A small transaction-aware fake: transactions on one store run in order,
// request callbacks may enqueue more requests, and abort rolls back writes.
function transactionalIndexedDB() {
  let persisted;
  let queue = Promise.resolve();
  const db = {
    close() {},
    transaction() {
      const operations = [];
      let aborted = false;
      const transaction = {
        abort() { aborted = true; },
        objectStore() {
          return {
            get() {
              const request = {};
              operations.push({kind: 'get', request});
              return request;
            },
            put(value) { operations.push({kind: 'put', value: structuredClone(value)}); },
          };
        },
      };
      queue = queue.then(() => {
        let working = structuredClone(persisted);
        while (operations.length && !aborted) {
          const operation = operations.shift();
          if (operation.kind === 'get') {
            operation.request.result = structuredClone(working);
            operation.request.onsuccess?.();
          } else working = operation.value;
        }
        if (aborted) transaction.onabort?.();
        else {
          persisted = working;
          transaction.oncomplete?.();
        }
      });
      return transaction;
    },
  };
  return {
    open() {
      const request = {};
      queueMicrotask(() => { request.result = db; request.onsuccess?.(); });
      return request;
    },
  };
}

test('offline clients preserve concurrent creates and reject stale task writes', async t => {
  const original = globalThis.indexedDB;
  globalThis.indexedDB = transactionalIndexedDB();
  t.after(() => {
    if (original === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = original;
  });
  const first = new WorkspaceClient();
  const second = new WorkspaceClient();
  await Promise.all([first.refresh(), second.refresh()]);
  const [a, b] = await Promise.all([
    first.create({prompt: 'First tab task'}),
    second.create({prompt: 'Second tab task'}),
  ]);
  await Promise.all([first.refresh(), second.refresh()]);
  assert.deepEqual(new Set(first.state.tasks.map(task => task.id)), new Set([a.id, b.id]));
  const oldVersion = second.state.tasks.find(task => task.id === a.id).version;
  await first.action(a.id, {action: 'message', expectedVersion: oldVersion, content: 'New direction'});
  await assert.rejects(
    second.action(a.id, {action: 'message', expectedVersion: oldVersion, content: 'Stale direction'}),
    error => error.statusCode === 409,
  );
  await second.refresh();
  const stored = second.state.tasks.find(task => task.id === a.id);
  assert.equal(stored.messages.at(-1).content, 'New direction');
  assert.equal(stored.messages.some(message => message.content === 'Stale direction'), false);
  assert.equal(second.state.tasks.length, 2);
});

test('unchanged refresh retains records while updating connection metadata',async()=>{const client=new WorkspaceClient({remote:true,baseUrl:'https://example.test'});let calls=0;client.request=async p=>{if(++calls===1){assert.equal(p,'/api/state');return {revision:7,tasks:[{id:'t'}],usage:[{provider:'codex'}],desktop:{online:true},capabilities:{cloud:true}};}assert.equal(p,'/api/state?since=7');return {revision:7,unchanged:true,desktop:{online:false},capabilities:{cloud:true}};};await client.refresh();const tasks=client.state.tasks;await client.refresh();assert.equal(client.state.tasks,tasks);assert.equal(client.state.usage.length,1);assert.equal(client.state.desktop.online,false);});
test('late refresh cannot replace a newer accepted response',async()=>{const c=new WorkspaceClient({remote:true,baseUrl:'https://example.test'});const pending=[];c.request=()=>new Promise(r=>pending.push(r));const a=c.refresh(),b=c.refresh();pending[1]({revision:2,tasks:[{id:'new'}]});await b;pending[0]({revision:1,tasks:[{id:'old'}]});await a;assert.equal(c.state.tasks[0].id,'new');});

test('overlapping conditional responses cannot regress an advanced revision',async()=>{const c=new WorkspaceClient({remote:true,baseUrl:'https://example.test'});c.request=async()=>({revision:7,tasks:[{id:'old'}]});await c.refresh();const pending=[];c.request=()=>new Promise(r=>pending.push(r));const a=c.refresh(),b=c.refresh();pending[0]({revision:8,tasks:[{id:'new'}]});await a;pending[1]({revision:7,unchanged:true});await b;assert.equal(c.state.revision,8);});

test('acknowledged create survives subsequent refresh failure without requesting a second create',async()=>{const c=new WorkspaceClient({remote:true});let posts=0;c.request=async(path,body)=>{if(body){posts++;return {task:{id:'saved',version:1,prompt:'request'}};}throw Error('network after commit');};const task=await c.create({prompt:'request'});assert.equal(task.id,'saved');assert.equal(c.state.tasks[0].id,'saved');assert.equal(posts,1);assert.match(c.syncError.message,/network/);assert.equal(c.lastSync,null);});
test('acknowledged action preserves new version during offline refresh and clears warning on reconnect',async()=>{const c=new WorkspaceClient({remote:true});c.state.tasks=[{id:'t',version:1}];c.request=async(path,body)=>{if(body)return {task:{id:'t',version:2,messages:[{content:'accepted'}]}};throw Error('offline');};await c.action('t',{action:'message',expectedVersion:1,content:'accepted'});assert.equal(c.state.tasks[0].version,2);assert.ok(c.syncError);c.request=async()=>({revision:3,tasks:[{id:'t',version:2}]});await c.refresh();assert.equal(c.syncError,null);assert.ok(c.lastSync);});
test('refresh begun before acknowledged write cannot overwrite accepted task',async()=>{const c=new WorkspaceClient({remote:true});let release;c.request=()=>new Promise(r=>{release=r;});const old=c.refresh();c.request=async(path,body)=>{if(body)return {task:{id:'new',version:1}};throw Error('offline');};await c.create({prompt:'new'});release({revision:0,tasks:[]});await old;assert.equal(c.state.tasks[0].id,'new');});
test('unacknowledged writes still fail and never invent a stored task',async()=>{const c=new WorkspaceClient({remote:true});c.request=async()=>{throw Error('unknown commit state');};await assert.rejects(()=>c.create({prompt:'new'}),/unknown/);assert.equal(c.state.tasks.length,0);});
