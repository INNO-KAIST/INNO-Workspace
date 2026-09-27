import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.mjs';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';

const token='workspace-identity-test-token-0123456789';
const key='desktop_workspace_id';
const url='https://inno.test/api/desktop/identity';
const worker=createWorker({fetchFn:async()=>{throw Error('external fetch must not run');}});
const request=(db,authorization=`Bearer ${token}`,method='GET')=>worker.fetch(new Request(url,{method,headers:authorization?{authorization}:{}}),{DB:db,ACCESS_TOKEN:token});
const stored=db=>db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first();
const desktopPost=(db,path,body,workspaceHeader,authorization=`Bearer ${token}`)=>{
 const headers={'content-type':'application/json',...(authorization?{authorization}:{}),...(workspaceHeader!==undefined?{'x-inno-workspace-id':workspaceHeader}:{})};
 return worker.fetch(new Request('https://inno.test'+path,{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)}),{DB:db,ACCESS_TOKEN:token});
};

test('identity GET authenticates before touching storage and only supports GET',async t=>{
 const inaccessible={prepare(){throw Error('storage must not be read');}};
 const denied=await request(inaccessible,'');assert.equal(denied.status,401);
 const db=new TestD1();t.after(()=>db.close());
 assert.equal((await request(db,undefined,'POST')).status,404);
 assert.equal(await stored(db),null);
});

test('identity is a stable UUID in one metadata row without revision churn',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const first=await request(db);assert.equal(first.status,200);
 const {workspaceId}=await first.json();
 assert.match(workspaceId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.deepEqual(await (await request(db)).json(),{workspaceId});
 assert.equal((await stored(db)).value,workspaceId);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM metadata WHERE key=?1').bind(key).first()).n,1);
 assert.equal((await stored(db)).value,workspaceId);
 assert.equal((await db.prepare("SELECT value FROM metadata WHERE key='revision'").first()).value,0);
});

test('existing identity is read without writes and parallel initializers converge on one value',async t=>{
 const db=new TestD1();t.after(()=>db.close());
 const existing='123e4567-e89b-42d3-a456-426614174000';
 await db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(key,existing).run();
 const originalPrepare=db.prepare.bind(db);
 db.prepare=sql=>{if(/INSERT|UPDATE|DELETE/i.test(sql))throw Error('existing identity must be read only');return originalPrepare(sql);};
 assert.deepEqual(await (await request(db)).json(),{workspaceId:existing});

 const fresh=new TestD1();t.after(()=>fresh.close());
 const responses=await Promise.all(Array.from({length:12},()=>request(fresh)));
 assert.ok(responses.every(response=>response.status===200));
 const ids=await Promise.all(responses.map(response=>response.json()));
 assert.equal(new Set(ids.map(value=>value.workspaceId)).size,1);
 assert.equal((await fresh.prepare('SELECT COUNT(*) AS n FROM metadata WHERE key=?1').bind(key).first()).n,1);
 assert.equal((await stored(fresh)).value,ids[0].workspaceId);
});

test('separate databases receive different IDs and malformed stored values fail closed',async t=>{
 const first=new TestD1(),second=new TestD1();t.after(()=>{first.close();second.close();});
 const a=(await (await request(first)).json()).workspaceId,b=(await (await request(second)).json()).workspaceId;
 assert.notEqual(a,b);
 for(const malformed of ['not-a-uuid','',42,'"123e4567-e89b-42d3-a456-426614174000"']){
  const db=new TestD1();t.after(()=>db.close());
  await db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(key,malformed).run();
  const response=await request(db),body=await response.json();
  assert.equal(response.status,500);assert.deepEqual(body,{error:'internal server error'});
  assert.equal((await stored(db)).value,malformed);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM metadata WHERE key=?1').bind(key).first()).n,1);
 }
});

test('workspace mismatch is checked before body parsing or any desktop mutation',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),task=await store.createTask({prompt:'Safe task'});
 const wrong='00000000-0000-4000-8000-000000000000';
 for(const path of ['/api/desktop/poll',...['start','renew','complete','fail'].map(action=>`/api/desktop/${task.id}/${action}`)]){
  const response=await desktopPost(db,path,'{',wrong);
  assert.equal(response.status,409,path);assert.deepEqual(await response.json(),{error:'Workspace identity mismatch'});
 }
 const attempted=await desktopPost(db,`/api/desktop/${task.id}/start`,{expectedVersion:task.version,sourceNames:[],models:[{model:'forged',efforts:['high']}]},wrong);
 assert.equal(attempted.status,409);assert.deepEqual(await store.requireTask(task.id),task);
 assert.equal(await db.prepare("SELECT value FROM metadata WHERE key='desktop_models'").first(),null);
 assert.equal(await db.prepare("SELECT value FROM metadata WHERE key='desktop_seen'").first(),null);
 const noAuth=await desktopPost({prepare(){throw Error('unauthorized request touched storage');}},'/api/desktop/poll','{',wrong,'');
 assert.equal(noAuth.status,401);
});

test('matching workspace ID permits claims and completion; absent header keeps legacy clients working',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),{workspaceId}=await (await request(db)).json();
 const poll=await desktopPost(db,'/api/desktop/poll',{},workspaceId);
 assert.equal(poll.status,200);assert.deepEqual(await poll.json(),{claim:null,workspaceId});
 const task=await store.createTask({prompt:'Complete safely'});
 const started=await desktopPost(db,`/api/desktop/${task.id}/start`,{expectedVersion:task.version,sourceNames:[]},workspaceId);
 assert.equal(started.status,200);const startBody=await started.json();assert.equal(startBody.workspaceId,workspaceId);assert.equal(startBody.claim.task.id,task.id);
 const owner={executionId:startBody.claim.executionId,generation:startBody.claim.generation};
 assert.equal((await desktopPost(db,`/api/desktop/${task.id}/renew`,owner,workspaceId)).status,200);
 assert.equal((await desktopPost(db,`/api/desktop/${task.id}/complete`,{...owner,content:'Done'},workspaceId)).status,200);
 assert.equal((await store.requireTask(task.id)).status,'completed');
 const legacy=await store.createTask({prompt:'Legacy client'});
 const legacyStart=await desktopPost(db,`/api/desktop/${legacy.id}/start`,{expectedVersion:legacy.version,sourceNames:[]});
 assert.equal(legacyStart.status,200);assert.equal((await legacyStart.json()).workspaceId,workspaceId);
});

test('present empty or malformed header conflicts and invalid identity fails before body mutation',async t=>{
 const db=new TestD1();t.after(()=>db.close());const store=new D1TaskStore(db),task=await store.createTask({prompt:'Keep unchanged'});
 for(const header of ['', 'not-a-uuid'])assert.equal((await desktopPost(db,`/api/desktop/${task.id}/start`,'{',header)).status,409);
 assert.deepEqual(await store.requireTask(task.id),task);
 await db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?1,?2)').bind(key,'corrupted').run();
 for(const path of ['/api/desktop/poll',`/api/desktop/${task.id}/start`,`/api/desktop/${task.id}/complete`]){
  const response=await desktopPost(db,path,'{');assert.equal(response.status,500,path);
  assert.deepEqual(await response.json(),{error:'internal server error'});
 }
 assert.deepEqual(await store.requireTask(task.id),task);
});
