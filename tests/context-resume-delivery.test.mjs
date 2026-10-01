import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createCodexRunner} from '../server/runners.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createContextBasis} from '../public/core/context-resume.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
const binding={origin:'https://inno.example',workspaceId:'11111111-1111-4111-8111-111111111111'};
const owner={executionId:'exec',generation:1};
const currentTask=()=>({id:'task',version:1,prompt:'Finish this goal',messages:[],status:'running',checkpoint:{provider:'codex',status:'running',...owner,deliveryReceiptVersion:1}});
async function stateFor(task){const basis=await createContextBasis(task);return {version:1,...basis,items:[{kind:'goal',text:'Finish this goal',references:[{section:'request',digest:basis.basis.requestDigest}]}]};}
function runnerFor(value,capture={}) {
  return createCodexRunner({managedDelivery:true,ensureDirectory:()=>{},runDirectory:()=>process.cwd(),spawnProcess:()=>{
    capture.spawns=(capture.spawns??0)+1;
    const child=new EventEmitter(); child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;
    child.stdin.resume();child.stdin.on('finish',()=>{child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}})+'\n');child.stdout.end();child.emit('close',0,null);});return child;
  }});
}
for(const kind of ['state','null','omitted']) test(`Codex ${kind} resume state survives actual file outbox and restart delivery without rerun`,async t=>{
  const root=path.resolve('.inno/tmp');await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'resume-delivery-'));
  t.after(async()=>{assert.equal(path.dirname(dir),root);await rm(dir,{recursive:true,force:true});});
  const task=currentTask(),resumeState=kind==='state'?await stateFor(task):null;
  const output={summary:'Verified answer',checkpoint:'Verified checkpoint',...(kind==='omitted'?{}:{resumeState})};
  const capture={},realRunner=runnerFor(output,capture),pendingPath=path.join(dir,'pending.json'),outbox=createFileOutbox(pendingPath),delivered=[];
  let runnerResult;
  const request=async(route,input)=>{
    if(route.endsWith('/poll'))return {claim:{task,...owner},workspaceId:binding.workspaceId,deliveryReceiptVersion:1};
    if(route.endsWith('/complete')){
      delivered.push(structuredClone(input));if(delivered.length===1)throw Error('lost response');
      return {deliveryReceipt:{...await createDeliveryReceipt({workspaceId:binding.workspaceId,taskId:task.id,action:'complete',input}),acceptedAt:'2026-10-01T00:00:00.000Z'}};
    }
    if(route.endsWith('/ack'))return {receipt:input.receipt,released:true};
    assert.fail('Unexpected request');
  };
  const bridge=createDesktopBridge({deliveryReceiptVersion:1,readDeliveryBinding:()=>binding,outbox,request,runner:{run:async input=>{runnerResult=await realRunner.run(input);return runnerResult;}}});
  await assert.rejects(()=>bridge.tick(),/lost response/);
  const saved=JSON.parse(await readFile(pendingPath,'utf8'));
  assert.equal(saved.phase,'pending');assert.deepEqual(saved.input,delivered[0]);
  for(const value of [runnerResult,saved.input]) {
    assert.equal(Object.hasOwn(value,'resumeState'),kind!=='omitted');
    if(kind!=='omitted')assert.deepEqual(value.resumeState,resumeState);
  }
  const restarted=createDesktopBridge({deliveryReceiptVersion:1,readDeliveryBinding:()=>binding,outbox:createFileOutbox(pendingPath),request,runner:{run:()=>assert.fail('AI rerun forbidden')}});
  await restarted.tick();assert.deepEqual(delivered[1],delivered[0]);assert.equal(capture.spawns,1);assert.equal(outbox.read(),null);
});

test('invalid or cross-task structured resume state cannot fall back to plaintext output',async()=>{
  const task=currentTask(),valid=await stateFor(task);
  for(const output of [{summary:'answer',resumeState:{...valid,raw:'PRIVATE RAW'}},{summary:'answer',resumeState:{...valid,taskId:'different'}},{resumeState:valid}]) {
    await assert.rejects(()=>runnerFor(output).run({task,...owner}),/resume state/i);
  }
  await assert.rejects(()=>runnerFor({summary:'answer',resumeState:valid}).run({task,executionId:'exec',generation:0}),/resume state/i);
});

test('resume state cannot accompany handoff or delegation before artifact processing',async()=>{
  const task=currentTask(),valid=await stateFor(task);
  for(const branch of ['handoff','delegation'])for(const resumeState of [valid,null]) {
    await assert.rejects(()=>runnerFor({summary:'answer',resumeState,[branch]:{},artifacts:[{name:'missing.txt',mime:'text/plain',path:'missing.txt'}]}).run({task,...owner}),/resume state/i);
  }
});

test('passing review keeps resume state and nonpassing review cannot drop it in a retry branch',async()=>{
  const task={...currentTask(),delegation:{state:'reviewing',children:[{taskId:'child',role:'implementation',acceptanceCriteria:['Verified criterion']}]}};
  const resumeState=await stateFor(task),reviewInputs=[{taskId:'child',role:'implementation',summary:'done',artifacts:[]}];
  for(const status of ['pass','fail','unverifiable']) {
    const reviewReport=[{childTaskId:'child',criteria:[{criterion:'Verified criterion',status,evidence:'Observed evidence'}]}];
    const run=()=>runnerFor({summary:'Reviewed answer',reviewReport,resumeState,...(status==='pass'?{}:{artifacts:[{name:'missing.txt',mime:'text/plain',path:'missing.txt'}]})}).run({task,...owner,reviewInputs});
    if(status==='pass'){const result=await run();assert.deepEqual(result.resumeState,resumeState);assert.deepEqual(result.reviewReport,reviewReport);}
    else await assert.rejects(run,/resume state/i);
  }
});

test('invalid resume output follows safe failure delivery without leaking its raw fields',async()=>{
  const task=currentTask(),raw='PRIVATE_INVALID_RESUME',realRunner=runnerFor({summary:'answer',resumeState:{raw}}),calls=[];
  let saved;
  const bridge=createDesktopBridge({runner:realRunner,outbox:{read:()=>saved,write:value=>{saved=value;},clear:()=>{saved=null;}},request:async(route,input)=>{
    if(route.endsWith('/poll'))return {claim:{task,...owner}};
    calls.push({route,input:structuredClone(input)});assert.ok(route.endsWith('/fail'));assert.doesNotMatch(JSON.stringify(saved),/PRIVATE_INVALID_RESUME/);return {};
  }});
  await bridge.tick();assert.equal(calls.length,1);assert.equal(calls[0].input.failure.kind,'unknown');assert.doesNotMatch(JSON.stringify(calls),/PRIVATE_INVALID_RESUME|resumeState/);
});
