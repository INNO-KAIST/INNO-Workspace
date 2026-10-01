import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,unlinkSync,rmdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFileOutbox} from '../server/file-outbox.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tempRoot=path.join(root,'.inno','tmp');
function fixture(t){
 mkdirSync(tempRoot,{recursive:true});const dir=mkdtempSync(path.join(tempRoot,'file-protocol-'));
 const pending=path.join(dir,'pending.json'),server=path.join(dir,'server.json'),events=path.join(dir,'events.jsonl');
 t.after(()=>{for(const file of [pending,pending+'.tmp',server,events])if(existsSync(file))unlinkSync(file);rmdirSync(dir);});return {pending,server,events};
}
const childSource=String.raw`
 import * as fs from 'node:fs';
 import {createFileOutbox} from './server/file-outbox.mjs';
 import {createDesktopBridge} from './server/desktop-bridge.mjs';
 import {createDeliveryReceipt} from './public/core/delivery-receipt.mjs';
 const [pending,server,events,mode]=process.argv.slice(1);
 const binding={origin:'https://inno.example',workspaceId:'11111111-1111-4111-8111-111111111111'};
 const recordEvent=value=>fs.appendFileSync(events,JSON.stringify(value)+'\n');
 const disk=createFileOutbox(pending,{fs:{...fs,renameSync:(...args)=>{if(mode==='before_rename')process.exit(73);return fs.renameSync(...args);},unlinkSync:(...args)=>{if(mode==='clear_failed')throw Error('injected clear failure');return fs.unlinkSync(...args);}}});
 const outbox={read:disk.read,write:record=>{disk.write(record);if(mode===record.phase+'_written')process.exit(73);},clear:()=>{disk.clear();if(mode==='cleared')process.exit(73);}};
 if(mode==='read_empty'){if(outbox.read()!==null)throw Error('expected empty');process.exit(0);}
 const request=async(route,input)=>{
  if(route.endsWith('/poll')){recordEvent('poll');return {workspaceId:binding.workspaceId,deliveryReceiptVersion:1,claim:{task:{id:'task',status:'running',checkpoint:{provider:'codex',status:'running',executionId:'execution',generation:1,deliveryReceiptVersion:1}},executionId:'execution',generation:1}};}
  if(route.endsWith('/complete')){
   recordEvent('complete');let state=fs.existsSync(server)?JSON.parse(fs.readFileSync(server,'utf8')):{};
   const descriptor=await createDeliveryReceipt({workspaceId:binding.workspaceId,taskId:'task',action:'complete',input});
   if(state.receipt&&state.receipt.payloadDigest!==descriptor.payloadDigest)throw Error('changed result');
   state.receipt??={...descriptor,acceptedAt:'2026-10-01T00:00:00.000Z'};fs.writeFileSync(server,JSON.stringify(state));
   if(mode==='result_reply_lost')process.exit(73);return {deliveryReceipt:state.receipt};
  }
  if(route.endsWith('/ack')){
   recordEvent('ack');const state=JSON.parse(fs.readFileSync(server,'utf8'));
   if(JSON.stringify(input.receipt)!==JSON.stringify(state.receipt))throw Error('changed acknowledgment');
   const released=!state.released;state.released=true;fs.writeFileSync(server,JSON.stringify(state));
   if(mode==='ack_reply_lost')process.exit(73);return {receipt:state.receipt,released};
  }
  throw Error('unexpected route');
 };
 const bridge=createDesktopBridge({deliveryReceiptVersion:1,outbox,request,readDeliveryBinding:()=>binding,runner:{run:async()=>{recordEvent('run');return {content:'DURABLE_OUTPUT'};}}});
 try{await bridge.tick();}catch(error){if(mode==='clear_failed'&&error.message==='injected clear failure')process.exit(73);if(mode==='orphan_read'&&error.code==='OUTBOX_RECOVERY_REQUIRED')process.exit(0);throw error;}
 if(mode==='orphan_read')throw Error('orphan was silently ignored');
`;
function child(f,mode,status=0){const result=spawnSync(process.execPath,['--input-type=module','-e',childSource,f.pending,f.server,f.events,mode],{cwd:root,encoding:'utf8',env:{...process.env,TEMP:tempRoot,TMP:tempRoot},timeout:15000});assert.equal(result.status,status,`child ${mode} failed: ${result.stderr}`);}
const events=f=>readFileSync(f.events,'utf8').trim().split('\n').map(line=>JSON.parse(line));
for(const boundary of ['pending_written','result_reply_lost','ack_pending_written','ack_reply_lost','clear_failed'])test(`actual process restart after ${boundary} resumes the persisted phase with one AI run`,t=>{
 const f=fixture(t);child(f,boundary,73);const saved=createFileOutbox(f.pending).read(),isPending=['pending_written','result_reply_lost'].includes(boundary);assert.equal(saved.phase,isPending?'pending':'ack_pending');
 if(!isPending){assert.deepEqual(Object.keys(saved).sort(),['binding','phase','receipt','version']);assert.equal(readFileSync(f.pending,'utf8').includes('DURABLE_OUTPUT'),false);}
 const before=events(f);child(f,'resume');const after=events(f),resumed=after.slice(before.length);assert.deepEqual(resumed,isPending?['complete','ack']:['ack']);assert.equal(after.filter(event=>event==='poll').length,1);assert.equal(after.filter(event=>event==='run').length,1);assert.equal(createFileOutbox(f.pending).read(),null);assert.equal(JSON.parse(readFileSync(f.server,'utf8')).released,true);
});
test('process exit immediately after clear leaves no result or ACK to replay on restart',t=>{const f=fixture(t);child(f,'cleared',73);const before=events(f);child(f,'read_empty');assert.deepEqual(events(f),before);assert.deepEqual(before,['poll','run','complete','ack']);assert.equal(existsSync(f.pending),false);assert.equal(existsSync(f.pending+'.tmp'),false);});
test('process exit after flushed temporary write before rename preserves evidence and blocks restart admission',t=>{
 const f=fixture(t);child(f,'before_rename',73);assert.equal(existsSync(f.pending),false);assert.equal(existsSync(f.pending+'.tmp'),true);const evidence=readFileSync(f.pending+'.tmp','utf8');assert.equal(JSON.parse(evidence).phase,'pending');const before=events(f);child(f,'orphan_read');assert.deepEqual(events(f),before);assert.equal(readFileSync(f.pending+'.tmp','utf8'),evidence);assert.deepEqual(before,['poll','run']);
});
