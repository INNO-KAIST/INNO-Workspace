import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createOutboxRecovery} from '../server/outbox-recovery.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tempRoot=path.join(root,'.inno','tmp'),binding={origin:'https://inno.example',workspaceId:'11111111-1111-4111-8111-111111111111'};
const pending=()=>({version:1,phase:'pending',binding,taskId:'task',action:'complete',input:{executionId:'exec',generation:1,content:'PRIVATE_OUTPUT_TOKEN'}});
async function ack(record=pending()){return {version:1,phase:'ack_pending',binding:record.binding,receipt:{...await createDeliveryReceipt({workspaceId:record.binding.workspaceId,taskId:record.taskId,action:record.action,input:record.input}),acceptedAt:'2026-10-01T00:00:00.000Z'}};}
const hash=raw=>createHash('sha256').update(raw).digest('hex');
function fixture(t,first,temporary){
 fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'outbox-recovery-')),file=path.join(dir,'pending.json');
 const write=(where,value)=>fs.writeFileSync(where,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));
 if(first!==undefined)write(file,first);if(temporary!==undefined)write(file+'.tmp',temporary);
 t.after(()=>{for(const name of [file,file+'.tmp',file+'.tmp.old',file+'.target']){try{fs.unlinkSync(name);}catch(error){if(error.code!=='ENOENT')throw error;}}fs.rmdirSync(dir);});
 const input=()=>({pendingHash:fs.existsSync(file)?hash(fs.readFileSync(file)):null,temporaryHash:hash(fs.readFileSync(file+'.tmp')),confirm:true});
 return {file,input,make:options=>createOutboxRecovery(file,{withExclusive:work=>work(),...options})};
}
test('inspect reveals only safe metadata, verified owner and binding, never saved payload',async t=>{
 const p=pending(),f=fixture(t,p,p),view=await f.make().inspect();assert.equal(view.canPromote,true);assert.equal(view.pending.phase,'pending');assert.equal(view.pending.sha256,f.input().pendingHash);assert.deepEqual(view.pending.binding,binding);assert.deepEqual(view.pending.owner,{taskId:'task',executionId:'exec',generation:1,action:'complete'});assert.equal(JSON.stringify(view).includes('PRIVATE_OUTPUT_TOKEN'),false);assert.equal(JSON.stringify(view).includes('input'),false);assert.equal(fs.existsSync(f.file+'.tmp'),true);
});
test('all four permitted promotion pairs preserve exact temporary bytes',async t=>{
 const p=pending(),a=await ack(p);for(const [first,tmp] of [[undefined,p],[p,p],[p,a],[a,a]]){
  const f=fixture(t,first,tmp),before=fs.readFileSync(f.file+'.tmp');const result=await f.make().promote(f.input());assert.deepEqual(result,{promoted:true,phase:tmp.phase,sha256:hash(before)});assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(fs.existsSync(f.file+'.tmp'),false);
 }
});
test('orphan ACK, changed result, changed binding, changed acceptance time and legacy pairs cannot promote',async t=>{
 const p=pending(),a=await ack(p),other=pending();other.input.content='different';const changedBinding={...p,binding:{...binding,origin:'https://other.example'}},legacy={taskId:'task',action:'complete',input:p.input,binding};
 for(const [first,tmp] of [[undefined,a],[p,other],[p,changedBinding],[a,{...a,receipt:{...a.receipt,acceptedAt:'2026-10-02T00:00:00.000Z'}}],[legacy,p],[p,legacy],['{PRIVATE_OUTPUT_TOKEN',p],[p,'{PRIVATE_OUTPUT_TOKEN']]){
  const f=fixture(t,first,tmp),original=fs.existsSync(f.file)?fs.readFileSync(f.file):null,temporary=fs.readFileSync(f.file+'.tmp'),recovery=f.make(),view=await recovery.inspect();assert.equal(view.canPromote,false);assert.equal(JSON.stringify(view).includes('PRIVATE_OUTPUT_TOKEN'),false);await assert.rejects(()=>recovery.promote(f.input()));if(original)assert.deepEqual(fs.readFileSync(f.file),original);assert.deepEqual(fs.readFileSync(f.file+'.tmp'),temporary);
 }
});
test('promotion requires exclusive caller and exact explicit hashes/confirmation, copied before await',async t=>{
 const f=fixture(t,pending(),pending());await assert.rejects(()=>createOutboxRecovery(f.file).promote(f.input()));assert.throws(()=>createOutboxRecovery('relative-pending.json'));
 for(const bad of [{...f.input(),confirm:false},{...f.input(),extra:true},{...f.input(),pendingHash:null},{...f.input(),temporaryHash:'0'.repeat(64)},{...f.input(),temporaryHash:'bad'}])await assert.rejects(()=>f.make().promote(bad));
 let enter;const entered=new Promise(resolve=>{enter=resolve;});let unlock;const gate=new Promise(resolve=>{unlock=resolve;});const input=f.input(),recovery=f.make({withExclusive:async work=>{enter();await gate;return work();}}),operation=recovery.promote(input);await entered;input.confirm=false;input.temporaryHash='mutated';unlock();assert.equal((await operation).promoted,true);
});
test('fatal UTF8 and bounded oversized reads fail closed without data in metadata',async t=>{
 const invalid=fixture(t,pending(),Buffer.from([0xc3,0x28]));assert.equal((await invalid.make().inspect()).temporary.phase,'invalid');await assert.rejects(()=>invalid.make().promote(invalid.input()));
 const f=fixture(t,undefined,Buffer.alloc(2*1024*1024,65));let bytes=0;const recovery=f.make({fs:{...fs,readSync:(...args)=>{const n=fs.readSync(...args);bytes+=n;return n;}}});const view=await recovery.inspect();assert.equal(view.temporary.phase,'oversize');assert.equal(view.temporary.sha256,null);assert.equal(view.canPromote,false);assert.ok(bytes<=1024*1024+1,bytes);await assert.rejects(()=>recovery.promote(f.input()));
});
test('symbolic links are rejected without following their payload',async t=>{
 const f=fixture(t,undefined,pending());fs.writeFileSync(f.file+'.target',JSON.stringify(pending()));try{fs.symlinkSync(f.file+'.target',f.file,'file');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Host cannot create symbolic links');return;}throw error;}
 const view=await f.make().inspect();assert.equal(view.pending.phase,'unsafe_file');assert.equal(view.canPromote,false);await assert.rejects(()=>f.make().promote(f.input()));assert.equal(fs.lstatSync(f.file).isSymbolicLink(),true);
});
for(const failure of ['fsync','close','rename'])test(`${failure} failure preserves both files and never retries close`,async t=>{
 const f=fixture(t,pending(),await ack()),before=fs.readFileSync(f.file),temporary=fs.readFileSync(f.file+'.tmp');let flushDescriptor,flushClosePending=false,flushCloses=0;
 const io={...fs,fsyncSync:fd=>{flushDescriptor=fd;flushClosePending=true;if(failure==='fsync')throw Error('injected flush');fs.fsyncSync(fd);},closeSync:fd=>{if(fd===flushDescriptor&&flushClosePending){flushClosePending=false;flushCloses++;fs.closeSync(fd);if(failure==='close')throw Error('injected close');}else fs.closeSync(fd);},renameSync:(...args)=>{if(failure==='rename')throw Error('injected rename');return fs.renameSync(...args);}};
 await assert.rejects(()=>f.make({fs:io}).promote(f.input()));assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(f.file+'.tmp'),temporary);assert.equal(flushCloses,1);
});
test('changed file hashes or replacement inode during promotion abort before rename',async t=>{
 for(const which of ['pending','temporary','replacement']){
  const f=fixture(t,pending(),await ack()),originalTemporary=fs.readFileSync(f.file+'.tmp');let changed=false;const io={...fs,fsyncSync:fd=>{fs.fsyncSync(fd);if(changed)return;changed=true;if(which==='replacement'){fs.renameSync(f.file+'.tmp',f.file+'.tmp.old');fs.writeFileSync(f.file+'.tmp',originalTemporary);}else fs.writeFileSync(which==='pending'?f.file:f.file+'.tmp',JSON.stringify(pending())+' ');}};
  await assert.rejects(()=>f.make({fs:io}).promote(f.input()));assert.equal(fs.existsSync(f.file+'.tmp'),true);
 }
});
test('parent realpath change and expected hash staleness block promotion',async t=>{
 const f=fixture(t,pending(),await ack()),input=f.input();fs.writeFileSync(f.file,JSON.stringify(pending())+' ');await assert.rejects(()=>f.make().promote(input));
 let swapped=false;const io={...fs,fsyncSync:fd=>{fs.fsyncSync(fd);swapped=true;},realpathSync:p=>swapped?fs.realpathSync(p)+'-changed':fs.realpathSync(p)};await assert.rejects(()=>f.make({fs:io}).promote(f.input()));assert.equal(fs.existsSync(f.file+'.tmp'),true);
});
test('successful rename performs no subsequent IO that could misreport promotion as failed',async t=>{
 const f=fixture(t,pending(),await ack());let renamed=false;const io={...fs};for(const method of ['lstatSync','openSync','readSync','fstatSync','realpathSync'])io[method]=(...args)=>{if(renamed)throw Error('post-success IO');return fs[method](...args);};io.renameSync=(...args)=>{fs.renameSync(...args);renamed=true;};assert.equal((await f.make({fs:io}).promote(f.input())).promoted,true);
});
test('real child process interruption before rename preserves candidate and restart promotion completes',async t=>{
 const f=fixture(t,pending(),await ack());const source=String.raw`
  import * as fs from 'node:fs';import {createOutboxRecovery} from './server/outbox-recovery.mjs';
  const [file,mode]=process.argv.slice(1);const recovery=createOutboxRecovery(file,{withExclusive:work=>work(),fs:{...fs,renameSync:(...args)=>{if(mode==='cut')process.exit(73);fs.renameSync(...args);}}});
  const view=await recovery.inspect();await recovery.promote({pendingHash:view.pending.sha256,temporaryHash:view.temporary.sha256,confirm:true});
 `;
 const child=mode=>spawnSync(process.execPath,['--input-type=module','-e',source,f.file,mode],{cwd:root,encoding:'utf8',env:{...process.env,TEMP:tempRoot,TMP:tempRoot},timeout:15000});const interrupted=child('cut');assert.equal(interrupted.status,73,interrupted.stderr);assert.equal((await f.make().inspect()).canPromote,true);const resumed=child('resume');assert.equal(resumed.status,0,resumed.stderr);assert.equal(JSON.parse(fs.readFileSync(f.file,'utf8')).phase,'ack_pending');assert.equal(fs.existsSync(f.file+'.tmp'),false);
});
test('lock cleanup failure after committed rename remains success with an explicit uncertainty flag',async t=>{
 const f=fixture(t,pending(),await ack());const result=await f.make({withExclusive:async work=>{await work();throw Error('PRIVATE_LOCK_ERROR');}}).promote(f.input());assert.equal(result.promoted,true);assert.equal(result.recoveryLockUncertain,true);assert.equal(JSON.stringify(result).includes('PRIVATE_LOCK_ERROR'),false);assert.equal(fs.existsSync(f.file+'.tmp'),false);
});
test('the one MiB boundary is read completely but limit plus one is never promoted',async t=>{
 const raw=JSON.stringify(pending());for(const size of [1024*1024,1024*1024+1]){const f=fixture(t,undefined,raw+' '.repeat(size-Buffer.byteLength(raw))),view=await f.make().inspect();assert.equal(view.temporary.bytes,size);assert.equal(view.temporary.phase,size===1024*1024?'pending':'oversize');assert.equal(view.canPromote,size===1024*1024);}
});
test('unsafe-file metadata is rejected before opening either file for payload reads',async t=>{
 const f=fixture(t,pending(),pending());let opens=0;const io={...fs,lstatSync:file=>{const stat=fs.lstatSync(file);return Object.assign(stat,{isSymbolicLink:()=>true});},openSync:(...args)=>{opens++;return fs.openSync(...args);}};const view=await f.make({fs:io}).inspect();assert.equal(view.canPromote,false);assert.equal(view.pending.phase,'unsafe_file');assert.equal(view.temporary.phase,'unsafe_file');assert.equal(opens,0);
});
test('BOM-prefixed temporary JSON stays invalid and is never promoted into FileOutbox',async t=>{
 const f=fixture(t,pending(),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(JSON.stringify(await ack()))])),original=fs.readFileSync(f.file),temporary=fs.readFileSync(f.file+'.tmp'),recovery=f.make();
 assert.throws(()=>JSON.parse(temporary.toString('utf8')),SyntaxError);
 const view=await recovery.inspect();assert.equal(view.temporary.phase,'invalid');assert.equal(view.canPromote,false);await assert.rejects(()=>recovery.promote(f.input()));assert.deepEqual(fs.readFileSync(f.file),original);assert.deepEqual(fs.readFileSync(f.file+'.tmp'),temporary);
});
