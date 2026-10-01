import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {request as httpRequest} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createOutboxRecovery} from '../server/outbox-recovery.mjs';
const token='local-file-recovery-token-0123456789',binding={origin:'https://inno.example',workspaceId:'11111111-1111-4111-8111-111111111111'};
const pending=()=>({version:1,phase:'pending',binding,taskId:'task',action:'complete',input:{executionId:'exec',generation:1,content:'PRIVATE_RESULT_TOKEN'}});
async function fixture(t,{version=1,helper=true,temporary=true,customRecovery}={}){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.inno/tmp');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'local-recovery-')),file=path.join(dir,'pending.json');if(temporary)fs.writeFileSync(file+'.tmp',JSON.stringify(pending()));
 let cloud=0,locks=0;const outbox=createFileOutbox(file),bridge=createDesktopBridge({deliveryReceiptVersion:version,outbox,readDeliveryBinding:async()=>binding,runner:{run:()=>{throw Error('AI forbidden');}},request:async()=>{cloud++;throw Error('PRIVATE_CLOUD_ERROR');}}),original=bridge.recoveryMaintenance;bridge.recoveryMaintenance=async work=>{locks++;return original(work);};
 const recovery=customRecovery??createOutboxRecovery(file,{withExclusive:work=>bridge.recoveryMaintenance(work)});
 const server=createDesktopServer({token,publicDir:new URL('../public',import.meta.url),request:async()=>{cloud++;throw Error('PRIVATE_CLOUD_ERROR');},bridge,deliveryReceiptVersion:version,...(helper?{outboxRecovery:recovery}:{})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));for(const name of [file,file+'.tmp'])if(fs.existsSync(name))fs.unlinkSync(name);fs.rmdirSync(dir);});
 const base='http://127.0.0.1:'+server.address().port;
 const call=(route,input,{auth=true,origin,host,method}={})=>new Promise((resolve,reject)=>{
  const raw=input===undefined?undefined:JSON.stringify(input),req=httpRequest(base+route,{method:method??(input===undefined?'GET':'POST'),headers:{connection:'close','content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{}),...(origin?{origin}:{}),...(host?{host}:{})}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});res.on('end',()=>{try{resolve({status:res.statusCode,...JSON.parse(text)});}catch(error){reject(error);}});});req.on('error',reject);req.end(raw);
 });
 return {file,outbox,bridge,recovery,call,cloud:()=>cloud,locks:()=>locks};
}
test('local status and recovery inspect work offline without cloud calls or payload disclosure',async t=>{
 const f=await fixture(t),status=await f.call('/api/desktop/status');assert.equal(status.status,200);assert.equal(status.capabilities.desktopOutboxRecovery,true);assert.equal(status.outboxStatus,'not_inspected');assert.equal(Object.hasOwn(status.localDesktop,'pending'),false);
 const inspected=await f.call('/api/desktop/recovery');assert.equal(inspected.status,200);assert.equal(inspected.recovery.canPromote,true);assert.equal(inspected.localDesktop.busy,false);assert.equal(Object.hasOwn(inspected.localDesktop,'pending'),false);assert.equal(JSON.stringify(inspected).includes('PRIVATE_RESULT_TOKEN'),false);assert.equal(f.cloud(),0);
});
test('local status stays available with default protocol0, while recovery requires both gate and helper',async t=>{
 for(const config of [{version:0},{helper:false}]){const f=await fixture(t,config),status=await f.call('/api/desktop/status');assert.equal(status.status,200);assert.equal(status.capabilities.desktopOutboxRecovery,false);assert.equal((await f.call('/api/desktop/recovery')).status,404);assert.equal((await f.call('/api/desktop/recovery/promote',{confirm:true})).status,404);assert.equal(f.cloud(),0);assert.equal(f.locks(),0);}
});
test('local recovery routes enforce token, host and same-origin before any recovery or cloud work',async t=>{
 const f=await fixture(t);for(const route of ['/api/desktop/status','/api/desktop/recovery','/api/desktop/recovery/promote'])for(const options of [{auth:false},{origin:'https://evil.example'},{host:'evil.example'}]){const response=await f.call(route,route.endsWith('promote')?{}:undefined,options);assert.equal(response.status,options.auth===false?401:403);}assert.equal(f.cloud(),0);assert.equal(f.locks(),0);assert.equal(fs.existsSync(f.file+'.tmp'),true);
});
test('inspection rejects busy/stopped bridge but safe local status remains available',async t=>{
 for(const mode of ['busy','stopped']){const f=await fixture(t);let resolve,operation;if(mode==='busy')operation=f.bridge.recoveryInspect(()=>new Promise(r=>{resolve=r;}));else f.bridge.stop();assert.equal((await f.call('/api/desktop/recovery')).status,409);assert.equal((await f.call('/api/desktop/status')).status,200);if(resolve){resolve();await operation;}assert.equal(f.cloud(),0);}
});
test('exact confirmation and stale hashes preserve both files and never accept a supplied path',async t=>{
 const f=await fixture(t),view=await f.recovery.inspect(),valid={pendingHash:null,temporaryHash:view.temporary.sha256,confirm:true},before=fs.readFileSync(f.file+'.tmp');
 for(const input of [{...valid,confirm:false},{...valid,temporaryHash:'0'.repeat(64)},{...valid,pendingPath:'somewhere'},{...valid,temporaryHash:'bad'}]){const response=await f.call('/api/desktop/recovery/promote',input);assert.equal(response.status,409,JSON.stringify(response));assert.equal(fs.existsSync(f.file),false);assert.deepEqual(fs.readFileSync(f.file+'.tmp'),before);}assert.equal(f.cloud(),0);
});
test('real promotion acquires one recovery lock, stays unsafe and performs no post-commit status IO',async t=>{
 const f=await fixture(t),view=await f.recovery.inspect();const originalStatus=f.bridge.runtimeStatus;f.bridge.runtimeStatus=()=>{throw Error('PRIVATE_POST_COMMIT_IO');};const result=await f.call('/api/desktop/recovery/promote',{pendingHash:null,temporaryHash:view.temporary.sha256,confirm:true});f.bridge.runtimeStatus=originalStatus;
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.promoted,true);assert.equal(result.phase,'pending');assert.equal(f.locks(),1);assert.equal(fs.existsSync(f.file+'.tmp'),false);assert.equal(f.bridge.status().deliveryUnsafe,true);await assert.rejects(()=>f.bridge.startTask('task',{materials:[]}));f.outbox.clear();await assert.rejects(()=>f.bridge.tick());assert.equal(f.cloud(),0);
});
test('recovery errors use static responses and expose no filesystem error or payload details',async t=>{
 const f=await fixture(t,{customRecovery:{inspect:async()=>{throw Error('PRIVATE_RESULT_TOKEN secret path');},promote:async()=>{throw Error('PRIVATE_RESULT_TOKEN secret path');}}});for(const [route,input] of [['/api/desktop/recovery',undefined],['/api/desktop/recovery/promote',{pendingHash:null,temporaryHash:'a'.repeat(64),confirm:true}]]){const result=await f.call(route,input);assert.equal(result.status,500);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);}assert.equal(f.cloud(),0);
});
test('status uses memory only and bounded recovery inspection never calls unbounded outbox.read',async t=>{
 const f=await fixture(t);fs.writeFileSync(f.file+'.tmp',Buffer.alloc(2*1024*1024,65));let reads=0;f.outbox.read=()=>{reads++;throw Error('PRIVATE_UNBOUNDED_READ');};
 const status=await f.call('/api/desktop/status');assert.equal(status.status,200);assert.equal(status.outboxStatus,'not_inspected');const inspected=await f.call('/api/desktop/recovery');assert.equal(inspected.status,200);assert.equal(inspected.recovery.temporary.phase,'oversize');assert.equal(inspected.recovery.canPromote,false);assert.equal(inspected.localDesktop.busy,false);assert.equal(reads,0);assert.equal(f.cloud(),0);
});
test('oversized promotion body is rejected without helper execution or file changes',async t=>{
 let promotions=0;const f=await fixture(t,{customRecovery:{inspect:async()=>({}),promote:async()=>{promotions++;return {promoted:true};}}}),before=fs.readFileSync(f.file+'.tmp');const result=await f.call('/api/desktop/recovery/promote',{data:'PRIVATE'.repeat(110000)});assert.equal(result.status,413);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(promotions,0);assert.deepEqual(fs.readFileSync(f.file+'.tmp'),before);assert.equal(f.cloud(),0);
});
test('runtime status exceptions stay static and promotion lock uncertainty passes through unchanged',async t=>{
 const expected={promoted:true,phase:'pending',sha256:'a'.repeat(64),recoveryLockUncertain:true},f=await fixture(t,{customRecovery:{inspect:async()=>({}),promote:async()=>expected}});f.bridge.runtimeStatus=()=>{throw Error('PRIVATE_FILE_ERROR');};const status=await f.call('/api/desktop/status');assert.equal(status.status,500);assert.equal(JSON.stringify(status).includes('PRIVATE'),false);assert.deepEqual(await f.call('/api/desktop/recovery/promote',{pendingHash:null,temporaryHash:'a'.repeat(64),confirm:true}),{status:200,...expected});assert.equal(f.cloud(),0);
});
test('HTTP promotion refuses busy or stopped bridge and preserves the exact candidate bytes',async t=>{
 for(const mode of ['busy','stopped']){const f=await fixture(t),view=await f.recovery.inspect(),bytes=fs.readFileSync(f.file+'.tmp');let release,held;if(mode==='busy')held=f.bridge.recoveryInspect(()=>new Promise(resolve=>{release=resolve;}));else f.bridge.stop();const result=await f.call('/api/desktop/recovery/promote',{pendingHash:null,temporaryHash:view.temporary.sha256,confirm:true});assert.equal(result.status,409);assert.deepEqual(fs.readFileSync(f.file+'.tmp'),bytes);assert.equal(fs.existsSync(f.file),false);assert.equal(f.cloud(),0);if(release){release();await held;}}
});
test('unsupported methods and lookalike local recovery routes return 404 without cloud or recovery calls',async t=>{
 const f=await fixture(t);for(const [route,method,input] of [['/api/desktop/status','POST',{}],['/api/desktop/recovery','POST',{}],['/api/desktop/recovery/promote','GET',undefined],['/api/desktop/recovery/promote','PUT',{}],['/api/desktop/recovery/promote/extra','POST',{}],['/api/desktop/status/extra','GET',undefined]])assert.equal((await f.call(route,input,{method})).status,404);assert.equal(f.cloud(),0);assert.equal(f.locks(),0);
});
test('concurrent identical HTTP promotions commit once and keep new AI admission blocked',async t=>{
 const f=await fixture(t),view=await f.recovery.inspect(),input={pendingHash:null,temporaryHash:view.temporary.sha256,confirm:true};const results=await Promise.all([f.call('/api/desktop/recovery/promote',input),f.call('/api/desktop/recovery/promote',input)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(results.filter(r=>r.promoted).length,1);assert.equal(f.bridge.runtimeStatus().deliveryUnsafe,true);await assert.rejects(()=>f.bridge.startTask('task',{materials:[]}));assert.equal(f.cloud(),0);
});
