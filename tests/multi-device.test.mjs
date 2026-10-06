import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {WorkspaceClient} from '../public/core/client.mjs';
import {TestD1} from './helpers/d1.mjs';

// H9-4: two devices (or tabs) use one cloud workspace through the real Worker routes and the
// real page client. Changes reach the other device through deltas, a concurrent edit of the
// same task has exactly one winner and the loser retries on fresh data without losing either
// edit, and a device that was offline catches up when it returns.
const token='test-multi-device-0123456789012345';
function workspace(t){
 const db=new TestD1();t.after(()=>db.close());
 // D1 runs each batch as its own transaction; the in-memory helper shares one connection, so
 // overlapping batches are queued here the way D1 serializes them.
 const batch=db.batch.bind(db);let tail=Promise.resolve();
 db.batch=statements=>{const run=tail.then(()=>batch(statements));tail=run.catch(()=>{});return run;};
 const env={DB:db,ACCESS_TOKEN:token},original=globalThis.fetch;let offline=false;const paths=[];
 globalThis.fetch=async(url,init)=>{if(offline)throw new TypeError('fetch failed');paths.push(new URL(url).pathname+new URL(url).search);return worker.fetch(new Request(url,init),env);};
 t.after(()=>{globalThis.fetch=original;});
 const device=()=>new WorkspaceClient({remote:true,baseUrl:'https://inno.test',token});
 return {device,paths,setOffline:value=>{offline=value;}};
}
const view=client=>client.state.tasks.map(task=>[task.id,task.version,task.messages.length]);

test('two devices stay in sync and a concurrent edit has exactly one winner',async t=>{
 const w=workspace(t),desk=w.device(),phone=w.device();
 await desk.refresh();await phone.refresh();
 const task=await desk.create({title:'Both devices',prompt:'Work'});
 await phone.refresh();
 assert.ok(w.paths.at(-1).includes('delta=1'),w.paths.at(-1));
 assert.deepEqual(view(phone),view(desk));
 const edits=await Promise.allSettled([
  desk.action(task.id,{action:'message',content:'from desk',expectedVersion:task.version}),
  phone.action(task.id,{action:'message',content:'from phone',expectedVersion:task.version}),
 ]);
 assert.deepEqual(edits.map(edit=>edit.status).sort(),['fulfilled','rejected']);
 const lost=edits.find(edit=>edit.status==='rejected').reason;assert.equal(lost.status,409);
 const loser=edits[0].status==='rejected'?desk:phone,content=loser===desk?'from desk':'from phone';
 await loser.refresh();
 const fresh=loser.state.tasks.find(item=>item.id===task.id);
 await loser.action(task.id,{action:'message',content,expectedVersion:fresh.version});
 await desk.refresh();await phone.refresh();
 const stored=desk.state.tasks.find(item=>item.id===task.id);
 assert.deepEqual(stored.messages.map(message=>message.content).slice(1).sort(),['from desk','from phone']);
 assert.deepEqual(view(phone),view(desk));
});

test('a device that was offline keeps its view, then catches up when it returns',async t=>{
 const w=workspace(t),desk=w.device(),phone=w.device();
 await desk.refresh();await phone.refresh();
 const first=await desk.create({title:'Before',prompt:'Work'});await phone.refresh();
 w.setOffline(true);
 await assert.rejects(phone.refresh(),/fetch failed/);
 assert.ok(phone.syncError);assert.equal(phone.state.tasks.length,1);
 w.setOffline(false);
 const second=await desk.create({title:'While offline',prompt:'Work'});
 await desk.action(first.id,{action:'message',content:'changed while offline',expectedVersion:first.version});
 await phone.refresh();
 assert.equal(phone.syncError,null);assert.ok(phone.lastSync);
 assert.deepEqual(view(phone),view(desk));
 assert.ok(phone.state.tasks.some(task=>task.id===second.id));
});
