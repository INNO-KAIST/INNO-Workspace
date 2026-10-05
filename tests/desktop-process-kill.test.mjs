import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';

// Real process restarts: the desktop bridge runs in a child Node process and is killed
// with TerminateProcess/SIGKILL at a chosen point, then a fresh process resumes from the
// files it left. Only processes this test spawned are killed; ports are ephemeral.
const here=path.dirname(fileURLToPath(import.meta.url)),child=path.join(here,'helpers','desktop-kill-child.mjs');
const tempRoot=path.resolve(here,'../.inno/tmp'),token='process-kill-token-0123456789abcdef';
const LIMIT={timeout:30_000};
async function count(db,kind){return Number((await db.prepare('SELECT COUNT(*) AS n FROM metadata WHERE key GLOB ?1').bind(`desktop_${kind}:*`).first()).n);}
async function fixture(t){
 fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'process-kill-'));
 const pendingPath=path.join(dir,'pending.json'),journalPath=path.join(dir,'claim.json');
 const db=new TestD1(),store=new D1TaskStore(db),worker=createWorker({deliveryReceiptVersion:1,fetchFn:async()=>{throw Error('AI must not run');}});
 const log=[],holds=new Map(),held=[],live=new Set();
 const server=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const action=req.url.split('/').at(-1);log.push(action);
   const hold=holds.get(action);
   const forward=async()=>worker.fetch(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,body:req.method==='GET'?undefined:Buffer.concat(chunks)}),{DB:db,ACCESS_TOKEN:token});
   // A held request never gets its response: forwarded ones change the Worker first.
   if(hold){holds.delete(action);if(hold.forward)await forward();held.push(res);hold.reached();return;}
   const response=await forward();res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
  }catch{res.destroy();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{
  await Promise.all([...live].map(entry=>{entry.proc.kill('SIGKILL');return entry.closed;}));
  for(const res of held)res.destroy();
  await new Promise(resolve=>server.close(resolve));db.close();
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 });
 function run(mode,args=[],env={}){
  const proc=spawn(process.execPath,[child,endpoint,token,pendingPath,journalPath,mode,...args],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  const lines=[];let buffer='',stderr='';const waiters=[];
  proc.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);lines.push(line);for(const w of [...waiters])if(line.startsWith(w.prefix)){waiters.splice(waiters.indexOf(w),1);w.resolve(line);}}});
  proc.stderr.on('data',chunk=>{stderr+=chunk;});
  // 'close' waits for the output streams, so no printed line is missed.
  const closed=new Promise(resolve=>proc.on('close',code=>{live.delete(entry);for(const w of waiters.splice(0))w.reject(Error(`child exited before ${w.prefix}: ${lines.join(' | ')} ${stderr.slice(0,400)}`));resolve(code);}));
  const entry={proc,closed};live.add(entry);
  return {lines,closed,
   line:prefix=>{const found=lines.find(l=>l.startsWith(prefix));return found?Promise.resolve(found):new Promise((resolve,reject)=>waiters.push({prefix,resolve,reject}));},
   // Waits for a held request, failing at once if the child exits first.
   until:reached=>Promise.race([reached,closed.then(()=>{throw Error(`child exited early: ${lines.join(' | ')} ${stderr.slice(0,400)}`);})]),
   kill:async()=>{proc.kill('SIGKILL');await closed;}};
 }
 const task=await store.createTask({prompt:'Complete the task'});
 const start=env=>run('start',[task.id,String(task.version)],env);
 const restart=async()=>{const p=run('restart');const code=await p.closed;return {code,lines:p.lines};};
 const holdNext=(action,{forward=false}={})=>new Promise(reached=>holds.set(action,{forward,reached}));
 const read=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 return {db,store,task,log,holdNext,start,restart,pending:()=>read(pendingPath),journal:()=>read(journalPath)};
}
const afterRestart=(f,before)=>f.log.slice(before).filter(action=>action!=='identity');

test('a process killed while running is reported as restarted by the next process',LIMIT,async t=>{
 const f=await fixture(t),proc=f.start();
 await proc.line('RUNNING');await proc.kill();
 assert.equal(f.journal().phase,'owned');assert.equal(f.pending(),null);
 const next=await f.restart();
 assert.deepEqual(next.lines,['TICK true']);assert.equal(next.code,0);
 const task=await f.store.requireTask(f.task.id);
 assert.equal(task.checkpoint.failure.kind,'restarted');assert.notEqual(task.status,'running');
 assert.equal(f.journal(),null);assert.equal(f.pending(),null);assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),0);
});

test('a process killed after saving its result, while sending it, delivers it once on restart',LIMIT,async t=>{
 const f=await fixture(t),reached=f.holdNext('complete'),proc=f.start({RUN_MS:'20'});
 await proc.until(reached);await proc.kill();
 assert.equal(f.pending().phase,'pending');assert.equal(f.journal(),null);
 assert.equal((await f.store.requireTask(f.task.id)).status,'running');
 const before=f.log.length,next=await f.restart();
 assert.deepEqual(next.lines,['TICK true']);assert.deepEqual(afterRestart(f,before),['complete','ack']);
 assert.equal((await f.store.requireTask(f.task.id)).status,'completed');
 assert.equal(f.pending(),null);assert.equal(await count(f.db,'receipt'),0);
});

test('a process killed after the Worker applied its result but before the reply replays the stored receipt',LIMIT,async t=>{
 const f=await fixture(t),reached=f.holdNext('complete',{forward:true}),proc=f.start({RUN_MS:'20'});
 await proc.until(reached);await proc.kill();
 assert.equal(f.pending().phase,'pending');
 const applied=await f.store.requireTask(f.task.id);assert.equal(applied.status,'completed');assert.equal(await count(f.db,'receipt'),1);
 const before=f.log.length,next=await f.restart();
 assert.deepEqual(next.lines,['TICK true']);assert.deepEqual(afterRestart(f,before),['complete','ack']);
 assert.deepEqual(await f.store.requireTask(f.task.id),applied);
 assert.equal(f.pending(),null);assert.equal(await count(f.db,'receipt'),0);
});

test('a process killed after the Worker accepted its result only acknowledges on restart',LIMIT,async t=>{
 const f=await fixture(t),reached=f.holdNext('ack'),proc=f.start({RUN_MS:'20'});
 await proc.until(reached);await proc.kill();
 assert.equal(f.pending().phase,'ack_pending');assert.equal((await f.store.requireTask(f.task.id)).status,'completed');assert.equal(await count(f.db,'receipt'),1);
 const before=f.log.length,next=await f.restart();
 assert.deepEqual(next.lines,['TICK true']);assert.deepEqual(afterRestart(f,before),['ack']);
 assert.equal(f.pending(),null);assert.equal(await count(f.db,'receipt'),0);
});

test('a process killed after the Worker released the receipt but before the reply finishes idempotently',LIMIT,async t=>{
 const f=await fixture(t),reached=f.holdNext('ack',{forward:true}),proc=f.start({RUN_MS:'20'});
 await proc.until(reached);await proc.kill();
 assert.equal(f.pending().phase,'ack_pending');assert.equal(await count(f.db,'receipt'),0);
 const before=f.log.length,next=await f.restart();
 assert.deepEqual(next.lines,['TICK true']);assert.deepEqual(afterRestart(f,before),['ack']);
 assert.equal(f.pending(),null);assert.equal((await f.store.requireTask(f.task.id)).status,'completed');
});

test('a process killed before its claim response arrived resolves the owner by nonce on restart',LIMIT,async t=>{
 const f=await fixture(t),reached=f.holdNext('start',{forward:true}),proc=f.start();
 await proc.until(reached);await proc.kill();
 assert.equal(f.journal().phase,'requested');assert.equal((await f.store.requireTask(f.task.id)).status,'running');
 const next=await f.restart();
 assert.deepEqual(next.lines,['TICK true']);
 const task=await f.store.requireTask(f.task.id);assert.equal(task.checkpoint.failure.kind,'restarted');
 assert.equal(f.journal(),null);assert.equal(f.pending(),null);assert.equal(await count(f.db,'reservation'),0);assert.equal(await count(f.db,'receipt'),0);
});

test('a process killed while its claim never reached the Worker clears the intent and claims nothing',LIMIT,async t=>{
 const f=await fixture(t),reached=f.holdNext('start'),proc=f.start();
 await proc.until(reached);await proc.kill();
 assert.equal(f.journal().phase,'requested');assert.equal((await f.store.requireTask(f.task.id)).status,f.task.status);
 const before=f.log.length,next=await f.restart();
 assert.deepEqual(next.lines,['TICK false']);assert.deepEqual(afterRestart(f,before),['claim-status','poll']);
 assert.equal(f.journal(),null);assert.equal(f.pending(),null);assert.equal(await count(f.db,'reservation'),0);
 assert.equal((await f.store.requireTask(f.task.id)).status,f.task.status);
});
