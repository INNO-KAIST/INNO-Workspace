import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createProcessTree} from '../server/process-tree.mjs';

// H6-1: a bounded or aborted Codex run ends every observed descendant. Only processes whose
// (pid, creation time) identity was observed in the tree are ever ended; a reused PID is
// never touched. The proof claims only what was observed.
// The real tests detach the grandchild: Node puts the processes it spawns in a job object
// that ends them with their parent, which would hide a broken tree kill.
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const SPAWNED=100_000;
// The runner still holds the root's process handle, so its PID cannot be reused.
const HELD={spawnedAt:SPAWNED,heldUntil:()=>Infinity};
function fake(snapshots){
 // Each enumerate() returns the next snapshot (the last one repeats); killed pairs are recorded.
 let i=0;const killed=[];
 return {killed,enumerate:async()=>{const rows=typeof snapshots[Math.min(i,snapshots.length-1)]==='function'?snapshots[Math.min(i,snapshots.length-1)]():snapshots[Math.min(i,snapshots.length-1)];i++;return rows;},killPairs:async pairs=>{killed.push(...pairs.map(p=>`${p.pid}:${p.created}`));}};
}
const tree=(f,extra={})=>createProcessTree({platform:'win32',enumerate:f.enumerate,killPairs:f.killPairs,pauseMs:0,now:()=>SPAWNED+500,...extra});

test('observed descendants are ended by identity and the proof is verified once they are gone',async()=>{
 const live=[{pid:10,ppid:1,created:SPAWNED+5},{pid:11,ppid:10,created:SPAWNED+50},{pid:12,ppid:11,created:SPAWNED+60}];
 const f=fake([live,live,[{pid:99,ppid:1,created:5}]]);
 const t=tree(f).track(10,HELD);
 await t.sample();
 const proof=await t.terminate();
 assert.equal(proof.outcome,'verified');assert.equal(proof.recorded,3);assert.deepEqual(proof.survivors,[]);
 assert.deepEqual(f.killed.sort(),[`10:${SPAWNED+5}`,`11:${SPAWNED+50}`,`12:${SPAWNED+60}`].sort());
});

test('a reused root PID and its children are never ended',async()=>{
 // The root exited; PID 10 now belongs to an unrelated process created later, with a child.
 const f=fake([[{pid:10,ppid:1,created:SPAWNED+5},{pid:11,ppid:10,created:SPAWNED+50}],[{pid:10,ppid:4,created:SPAWNED+900},{pid:20,ppid:10,created:SPAWNED+950},{pid:11,ppid:10,created:SPAWNED+50}],[{pid:10,ppid:4,created:SPAWNED+900},{pid:20,ppid:10,created:SPAWNED+950}]]);
 const t=tree(f).track(10,HELD);
 await t.sample();
 const proof=await t.terminate();
 assert.equal(proof.outcome,'verified');
 assert.deepEqual(f.killed,[`11:${SPAWNED+50}`]);
});

test('an unconfirmed root identity or an enumeration failure ends nothing',async()=>{
 const old=fake([[{pid:10,ppid:1,created:SPAWNED-60_000}]]);
 const t=tree(old).track(10,HELD);await t.sample();
 const proof=await t.terminate();
 assert.equal(proof.outcome,'unavailable');assert.equal(proof.reason,'identity_unconfirmed');assert.deepEqual(old.killed,[]);
 const broken={killed:[],enumerate:async()=>{throw new Error('Access denied');},killPairs:async()=>{throw new Error('must not kill');}};
 const b=tree(broken).track(10,HELD);await b.sample();
 assert.equal((await b.terminate()).outcome,'unavailable');
 assert.equal((await createProcessTree({platform:'linux'}).track(10,HELD).terminate()).outcome,'unavailable');
});

test('the root is confirmed only from a snapshot taken while its PID was still held',async()=>{
 // Codex failed fast and its handle was released before any snapshot; PID 10 now belongs to a
 // process created after the spawn, inside the creation-time window.
 const reused=[{pid:10,ppid:4,created:SPAWNED+300},{pid:21,ppid:10,created:SPAWNED+350}];
 for(const heldUntil of [()=>SPAWNED+200,undefined]){
  const f=fake([reused]);
  const proof=await tree(f).track(10,{spawnedAt:SPAWNED,heldUntil}).terminate();
  assert.equal(proof.outcome,'unavailable');assert.equal(proof.reason,'identity_unconfirmed');assert.deepEqual(f.killed,[]);
 }
 // Even while held, a root created well after the spawn is not accepted.
 const late=fake([[{pid:10,ppid:1,created:SPAWNED+8000}]]);
 const proof=await tree(late,{now:()=>SPAWNED+20_000}).track(10,HELD).terminate();
 assert.equal(proof.reason,'identity_unconfirmed');assert.deepEqual(late.killed,[]);
});

test('a descendant whose intermediate parent exited is still ended when it was observed',async()=>{
 // Codex -> cmd -> node; cmd exits and node is orphaned before termination.
 const f=fake([[{pid:10,ppid:1,created:SPAWNED+5},{pid:30,ppid:10,created:SPAWNED+40},{pid:31,ppid:30,created:SPAWNED+45}],[{pid:10,ppid:1,created:SPAWNED+5},{pid:31,ppid:30,created:SPAWNED+45}],[]]);
 const t=tree(f).track(10,HELD);
 await t.sample();
 assert.equal((await t.terminate()).outcome,'verified');
 assert.ok(f.killed.includes(`31:${SPAWNED+45}`));
});

test('a child of an exited parent is adopted only if created while that parent was last seen alive',async()=>{
 // K (pid 30) was last seen in the snapshot that started at SPAWNED+500, then exited. Y was
 // created before that; X after it, when PID 30 may already have belonged to another process
 // (here R2 holds it now, created after X). X is ambiguous: never ended, never verified.
 const root={pid:10,ppid:1,created:SPAWNED+5},K={pid:30,ppid:10,created:SPAWNED+40};
 const X={pid:31,ppid:30,created:SPAWNED+2000},Y={pid:32,ppid:30,created:SPAWNED+100},R2={pid:30,ppid:4,created:SPAWNED+3000};
 const f=fake([[root,K],[root,X,Y,R2],[X,R2]]);
 const t=tree(f).track(10,HELD);
 await t.sample();
 const proof=await t.terminate();
 assert.deepEqual(f.killed.sort(),[`10:${SPAWNED+5}`,`32:${SPAWNED+100}`]);
 assert.equal(proof.outcome,'unavailable');assert.equal(proof.reason,'ambiguous_orphan');assert.deepEqual(proof.survivors,[31]);
});

test('children of the exited root are adopted up to the moment its PID was released',async()=>{
 // The root was last sampled at SPAWNED+500 and released its PID at SPAWNED+5000. X was created
 // before the release and is ours; Z was created after it and may belong to a reuser.
 const root={pid:10,ppid:1,created:SPAWNED+5};
 const X={pid:40,ppid:10,created:SPAWNED+3000},Z={pid:41,ppid:10,created:SPAWNED+6000};
 let heldUntil=Infinity;
 const f=fake([[root],[X,Z],[Z]]);
 const t=tree(f).track(10,{spawnedAt:SPAWNED,heldUntil:()=>heldUntil});
 await t.sample();
 heldUntil=SPAWNED+5000;
 const proof=await t.terminate();
 assert.deepEqual(f.killed,[`40:${SPAWNED+3000}`]);
 assert.equal(proof.reason,'ambiguous_orphan');assert.deepEqual(proof.survivors,[41]);
});

test('survivors are reported and the whole termination stays within its time budget',async()=>{
 const live=[{pid:10,ppid:1,created:SPAWNED+5},{pid:11,ppid:10,created:SPAWNED+50}];
 const kept=fake([live]);
 const proof=await tree(kept,{rounds:2}).track(10,HELD).terminate();
 assert.equal(proof.outcome,'survivors');assert.deepEqual(proof.survivors.sort(),[10,11]);
 // Each tool call takes 9.5 s or fails at its own timeout, whichever comes first.
 let clock=0;
 const call=async({timeout}={})=>{const used=Math.min(9_500,timeout??Infinity);clock+=used;if(used<9_500)throw new Error('timed out');};
 const slow={enumerate:async options=>{await call(options);return live;},killPairs:async(_pairs,options)=>call(options)};
 const t=createProcessTree({platform:'win32',enumerate:slow.enumerate,killPairs:slow.killPairs,pauseMs:300,budgetMs:30_000,now:()=>SPAWNED+500+clock}).track(10,HELD);
 const result=await t.terminate();
 assert.ok(['survivors','unavailable'].includes(result.outcome));assert.ok(clock<=30_000,`clock ${clock}`);
});

test('a tree larger than the tracking limit is never reported verified, and survivors are capped',async()=>{
 const root={pid:10,ppid:1,created:SPAWNED+5},kids=[11,12,13].map(pid=>({pid,ppid:10,created:SPAWNED+50}));
 const f=fake([[root,...kids],[]]);
 const proof=await tree(f,{maxTracked:2}).track(10,HELD).terminate();
 assert.equal(proof.outcome,'unavailable');assert.equal(proof.reason,'tracking_limit');
 const many=Array.from({length:100},(_,i)=>({pid:100+i,ppid:10,created:SPAWNED+50}));
 const stuck=await tree(fake([[root,...many]]),{rounds:1}).track(10,HELD).terminate();
 assert.equal(stuck.outcome,'survivors');assert.equal(stuck.survivors.length,64);assert.equal(stuck.recorded,101);
});

test('stopping the tracker cancels an in-flight sample and later samples',async()=>{
 let calls=0,signalled=false;
 const enumerate=({signal}={})=>{calls++;return new Promise((_,reject)=>signal?.addEventListener('abort',()=>{signalled=true;reject(new Error('aborted'));}));};
 const t=createProcessTree({platform:'win32',enumerate,killPairs:async()=>{}}).track(10,HELD);
 const pending=t.sample();
 t.stop();
 const settled=await Promise.race([pending.then(()=>'settled'),wait(200).then(()=>'hung')]);
 assert.equal(settled,'settled');assert.equal(signalled,true);
 await t.sample();
 assert.equal(calls,1);
});

test('a real Windows tree with a grandchild is ended and verified',{skip:process.platform!=='win32'},async t=>{
 const script=`const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});process.stdout.write(String(g.pid));setInterval(()=>{},1000);`;
 const spawnedAt=Date.now();
 const parent=spawn(process.execPath,['-e',script],{stdio:['ignore','pipe','ignore'],windowsHide:true});
 t.after(()=>{try{parent.kill();}catch{}});
 const grandchild=await new Promise((resolve,reject)=>{parent.stdout.once('data',d=>resolve(Number(String(d))));parent.once('error',reject);});
 t.after(()=>{try{process.kill(grandchild);}catch{}});
 let releasedAt;parent.once('exit',()=>{releasedAt=Date.now();});
 const heldUntil=()=>parent.exitCode===null&&parent.signalCode===null?Infinity:releasedAt??-Infinity;
 const tracker=createProcessTree().track(parent.pid,{spawnedAt,heldUntil});
 await tracker.sample();
 parent.kill();
 const result=await tracker.terminate();
 await wait(200);
 assert.equal(result.outcome,'verified',JSON.stringify(result));
 assert.ok(result.recorded>=2);
 assert.equal(alive(parent.pid),false);assert.equal(alive(grandchild),false);
});

test('a real Codex-runner abort also ends a grandchild process',{skip:process.platform!=='win32'},async t=>{
 const {createCodexRunner}=await import('../server/runners.mjs');
 // Without the tree the run still settles on Windows, but the grandchild keeps running.
 const script=`const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});process.stderr.write('GRANDCHILD:'+g.pid+'\\n');setInterval(()=>{},1000);`;
 let grandchild;
 const spawnProcess=()=>{const child=spawn(process.execPath,['-e',script],{stdio:['pipe','pipe','pipe'],windowsHide:true});child.stderr.on('data',d=>{const m=/GRANDCHILD:(\d+)/.exec(String(d));if(m)grandchild=Number(m[1]);});return child;};
 const controller=new AbortController();
 // Wait for the spawn sample itself, not a fixed delay, so a loaded machine cannot race it.
 const base=createProcessTree();let firstSample;
 const processTree={track(pid,options){const tracker=base.track(pid,options);return {...tracker,sample(){const pending=tracker.sample();firstSample??=pending;return pending;}};}};
 const runner=createCodexRunner({spawnProcess,processTree,ensureDirectory:()=>{},runDirectory:()=>process.cwd(),modelCatalog:async()=>[]});
 const run=runner.run({task:{id:'tree-check',status:'running',prompt:'Work',checkpoint:{provider:'codex',executionId:'e',generation:1}},executionId:'e',generation:1,signal:controller.signal});
 for(let i=0;i<100&&!grandchild;i++)await wait(50);
 assert.ok(grandchild&&alive(grandchild));
 t.after(()=>{try{process.kill(grandchild);}catch{}});
 await firstSample; // the root and its grandchild are recorded while the handle is held
 controller.abort();
 const settled=await Promise.race([run.then(()=>'resolved',()=>'rejected'),wait(30000).then(()=>'hung')]);
 assert.equal(settled,'rejected');
 for(let i=0;i<40&&alive(grandchild);i++)await wait(250);
 assert.equal(alive(grandchild),false);
});
