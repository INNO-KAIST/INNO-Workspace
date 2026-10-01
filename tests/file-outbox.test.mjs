import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tempRoot=path.join(root,'.inno','tmp');
function fixture(t){
 mkdirSync(tempRoot,{recursive:true});
 const dir=mkdtempSync(path.join(tempRoot,'file-outbox-test-'));
 const pending=path.join(dir,'desktop-pending.json');
 t.after(()=>{for(const file of [pending,pending+'.tmp'])if(existsSync(file))unlinkSync(file);rmdirSync(dir);});
 return pending;
}
function child(source,pending){
 const result=spawnSync(process.execPath,['--input-type=module','-e',source,pending],{cwd:root,encoding:'utf8',env:{...process.env,TEMP:tempRoot,TMP:tempRoot}});
 assert.equal(result.status,0,`child failed: ${result.stderr}`);
 return result.stdout.trim();
}

test('file outbox replays a retained completion after process restart without rerunning',t=>{
 const pending=fixture(t);
 child(`
  import {createFileOutbox} from './server/file-outbox.mjs';
  import {createDesktopBridge} from './server/desktop-bridge.mjs';
  const outbox=createFileOutbox(process.argv[1]);
  let runs=0;
  const bridge=createDesktopBridge({outbox,runner:{run:async()=>{runs++;return {content:'DONE'};}},request:async route=>{
   if(route.endsWith('/poll'))return {claim:{task:{id:'task-1'},executionId:'exec-1',generation:1}};
   if(route.endsWith('/complete'))throw Error('completion reply unavailable');
  }});
  try{await bridge.tick();throw Error('delivery unexpectedly succeeded');}catch(error){if(error.message!=='completion reply unavailable')throw error;}
  if(runs!==1||!outbox.read())throw Error('completion was not saved');
 `,pending);
 assert.equal(existsSync(pending),true);
 assert.equal(readFileSync(pending,'utf8').includes('DONE'),true);
 const output=child(`
  import {createFileOutbox} from './server/file-outbox.mjs';
  import {createDesktopBridge} from './server/desktop-bridge.mjs';
  import {existsSync} from 'node:fs';
  const pending=process.argv[1],outbox=createFileOutbox(pending);
  let deliveries=0,polls=0;
  const bridge=createDesktopBridge({outbox,runner:{run:()=>{throw Error('runner must not run');}},request:async(route,input)=>{
   if(route.endsWith('/poll')){polls++;throw Error('must not poll');}
   if(route.endsWith('/complete')){
    if(input.content!=='DONE')throw Error('wrong saved content');
    if(++deliveries===1)throw Error('delivery unavailable');
    return {task:{status:'completed'}};
   }
  }});
  try{await bridge.tick();throw Error('first retry unexpectedly succeeded');}catch(error){if(error.message!=='delivery unavailable')throw error;}
  if(!existsSync(pending)||!outbox.read())throw Error('failed delivery cleared pending record');
  await bridge.tick();
  if(existsSync(pending)||outbox.read()!==null||deliveries!==2||polls!==0)throw Error('replay did not clear only after success');
  console.log('replayed');
 `,pending);
 assert.equal(output,'replayed');
 assert.equal(existsSync(pending),false);
});

test('invalid pending JSON fails closed and stays on disk',async t=>{
 const pending=fixture(t);
 writeFileSync(pending,'{invalid json');
 let requests=0;
 const bridge=createDesktopBridge({outbox:createFileOutbox(pending),runner:{run:()=>{throw Error('must not run');}},request:async()=>{requests++;}});
 await assert.rejects(()=>bridge.tick(),SyntaxError);
 assert.equal(requests,0);
 assert.equal(readFileSync(pending,'utf8'),'{invalid json');
});

import * as realFs from 'node:fs';
test('outbox flushes and closes its exclusive temporary file before rename',t=>{
 const pending=fixture(t),calls=[];
 const fs={...realFs};for(const name of ['openSync','writeFileSync','fsyncSync','closeSync','renameSync'])fs[name]=(...args)=>{calls.push({name,args});return realFs[name](...args);};
 const outbox=createFileOutbox(pending,{fs});outbox.write({phase:'pending',content:'original'});
 assert.deepEqual(calls.map(c=>c.name),['openSync','writeFileSync','fsyncSync','closeSync','renameSync']);assert.deepEqual(calls[0].args,[pending+'.tmp','wx',0o600]);assert.equal(calls[1].args[0],calls[2].args[0]);assert.deepEqual(outbox.read(),{phase:'pending',content:'original'});assert.equal(existsSync(pending+'.tmp'),false);
});
for(const stage of ['writeFileSync','fsyncSync','closeSync','renameSync'])test(`${stage} failure keeps original pending and temporary evidence`,t=>{
 const pending=fixture(t),original='{"phase":"pending","content":"original"}';writeFileSync(pending,original);
 const fs={...realFs,[stage]:(...args)=>{if(stage==='writeFileSync')realFs.writeFileSync(args[0],'partial');if(stage==='closeSync')realFs.closeSync(args[0]);throw Error('injected '+stage);}};
 const outbox=createFileOutbox(pending,{fs});assert.throws(()=>outbox.write({phase:'ack_pending',receipt:'saved'}),new RegExp('injected '+stage));assert.equal(readFileSync(pending,'utf8'),original);assert.equal(existsSync(pending+'.tmp'),true);
 const debris=readFileSync(pending+'.tmp','utf8');const restarted=createFileOutbox(pending);for(const operation of [()=>restarted.read(),()=>restarted.write({other:true}),()=>restarted.clear()])assert.throws(operation,{code:'OUTBOX_RECOVERY_REQUIRED'});assert.equal(readFileSync(pending,'utf8'),original);assert.equal(readFileSync(pending+'.tmp','utf8'),debris);
});
test('orphan temporary files block all new work and survive read/write/clear without a pending file',async t=>{
 const pending=fixture(t);writeFileSync(pending+'.tmp','{"phase":"pending","content":"not renamed"}');const outbox=createFileOutbox(pending);let calls=0;
 const bridge=createDesktopBridge({outbox,request:async()=>{calls++;},runner:{run:()=>{calls++;}}});await assert.rejects(()=>bridge.tick(),{code:'OUTBOX_RECOVERY_REQUIRED'});
 for(const operation of [()=>outbox.read(),()=>outbox.write({new:true}),()=>outbox.clear()])assert.throws(operation,{code:'OUTBOX_RECOVERY_REQUIRED'});assert.equal(calls,0);assert.equal(existsSync(pending),false);assert.equal(readFileSync(pending+'.tmp','utf8'),' {"phase":"pending","content":"not renamed"}'.trim());
});
test('write or flush error survives close failure without closing the descriptor twice',t=>{
 for(const stage of ['writeFileSync','fsyncSync']){
  const pending=fixture(t);writeFileSync(pending,'{"old":true}');let closes=0;
  const fs={...realFs,[stage]:()=>{throw Error('first '+stage);},closeSync:fd=>{closes++;realFs.closeSync(fd);throw Error('secondary close');}};
  assert.throws(()=>createFileOutbox(pending,{fs}).write({next:true}),new RegExp('first '+stage));assert.equal(closes,1);assert.equal(readFileSync(pending,'utf8'),'{"old":true}');assert.equal(existsSync(pending+'.tmp'),true);
 }
});
test('JSON scalars and arrays on disk cannot masquerade as an empty outbox',async t=>{
 for(const raw of ['null','false','0','""','[]']){
  const pending=fixture(t);writeFileSync(pending,raw);let requests=0;
  const bridge=createDesktopBridge({outbox:createFileOutbox(pending),request:async()=>{requests++;return {claim:null};},runner:{}});await assert.rejects(()=>bridge.tick(),{code:'OUTBOX_RECOVERY_REQUIRED'});assert.equal(requests,0);assert.equal(readFileSync(pending,'utf8'),raw);
 }
});
test('invalid write shapes cannot replace a valid saved delivery or create temporary debris',t=>{
 const pending=fixture(t),outbox=createFileOutbox(pending);outbox.write({taskId:'original'});
 for(const value of [null,false,0,'',[],undefined]){assert.throws(()=>outbox.write(value),{code:'OUTBOX_RECOVERY_REQUIRED'});assert.deepEqual(outbox.read(),{taskId:'original'});assert.equal(existsSync(pending+'.tmp'),false);}
});
