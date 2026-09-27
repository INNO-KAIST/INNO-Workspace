import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {createCodexRunner} from '../server/runners.mjs';

const binding = {jobId:'comparison-1',phase:'candidate',maxDurationMs:100,provider:'codex'};
const claimedAt = new Date(1000).toISOString();
function task(overrides={}) {
  return {id:'comparison-task',status:'running',prompt:'Compare.',evaluationBudget:binding,
    checkpoint:{provider:'codex',executionId:'execution-1',generation:2,claimedAt,
      evaluationBudget:{jobId:'comparison-1',phase:'candidate',maxDurationMs:100,deadlineAtMs:1100}},
    ...overrides};
}
const owned = (value=task(),extra={}) => ({task:value,executionId:'execution-1',generation:2,executionBudgetVersion:1,...extra});
function syntheticChild({onKill=()=>true,onInput}={}) {
  const child = new EventEmitter();
  child.pid=1234;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.kill=onKill;
  child.stdin.on('finish',()=>onInput?.(child));
  child.complete=(value={summary:'done'},code=0)=>{
    child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}})+'\n');
    child.stdout.end();child.emit('close',code,null);
  };
  return child;
}
function runner(spawnProcess,extra={}) {
  return createCodexRunner({spawnProcess,modelCatalog:async()=>[{model:'gpt-6-astra',efforts:['high']}],
    ensureDirectory:()=>{},runDirectory:()=>process.cwd(),now:()=>1010,monotonicNow:()=>0,...extra});
}

test('bound runner rejects missing version, mismatched owner or binding, and expired claim before spawn',async()=>{
  let spawns=0;const run=runner(()=>{spawns++;throw Error('unexpected spawn');});
  for(const input of [
    owned(task(),{executionBudgetVersion:undefined}),
    owned(task(),{executionBudgetVersion:2}),
    owned(task(),{executionId:'other'}),
    owned(task({checkpoint:{...task().checkpoint,generation:3}})),
    owned(task({evaluationBudget:{...binding,phase:'review'}})),
    owned(task({checkpoint:{...task().checkpoint,evaluationBudget:{...task().checkpoint.evaluationBudget,deadlineAtMs:1200}}})),
    owned(task({parentTaskId:'parent',assignment:{provider:'codex'}})),
    owned(task({delegation:{state:'reviewing',children:[]}})),
  ]) await assert.rejects(()=>run.run(input),/budget|claim|ownership|deadline/i);
  const expired=runner(()=>{spawns++;throw Error('unexpected spawn');},{now:()=>1100});
  await assert.rejects(()=>expired.run(owned()),/expired|deadline/i);
  assert.equal(spawns,0);
});

test('preparation time consumes budget and an expired claim never spawns',async()=>{
  let clock=1010,spawns=0;
  const run=runner(()=>{spawns++;throw Error('unexpected spawn');},{now:()=>clock,
    modelCatalog:async()=>{clock=1100;return [];}});
  await assert.rejects(()=>run.run(owned()),/expired|deadline/i);
  assert.equal(spawns,0);
});

test('bound root disables native agents and MCP, rejects model-returned delegation and handoff',async()=>{
  for(const forbidden of [{delegation:{independent:true,children:[]}},{handoff:{provider:'claude'}}]){
    let args,opts,prompt='';
    const run=runner((_cmd,a,o)=>{args=a;opts=o;const child=syntheticChild({onInput:c=>c.complete({summary:'done',...forbidden})});child.stdin.on('data',chunk=>prompt+=chunk);return child;},
      {mcpUrl:'http://127.0.0.1:8787/mcp',mcpToken:'secret',managedDelivery:true});
    await assert.rejects(()=>run.run(owned()),/delegation|handoff/i);
    assert.deepEqual(args.slice(args.indexOf('--disable'),args.indexOf('--disable')+2),['--disable','multi_agent']);
    assert.equal(args.some(value=>String(value).includes('mcp_servers.inno')),false);
    assert.equal(opts.env.INNO_MCP_TOKEN,undefined);
    assert.doesNotMatch(prompt,/Use the INNO MCP tools|provider handoff is available/i);
  }
});

test('bound success carries independent local close observation, ignoring model-forged evidence',async()=>{
  let mono=0;
  const run=runner(()=>syntheticChild({onInput:c=>{mono=10;c.complete({summary:'done',localExecution:{rootProcessClosed:false,elapsedMs:0},executionEvidence:{processElapsedMs:0}});}}),
    {monotonicNow:()=>mono});
  const result=await run.run(owned());
  assert.equal(result.localExecution.started,true);
  assert.equal(result.localExecution.rootProcessClosed,true);
  assert.equal(result.localExecution.elapsedMs,10);
  assert.equal(result.localExecution.deadlineExceeded,false);
  assert.equal(result.delegation,undefined);
  assert.equal(result.handoff,undefined);
});

test('bound direct run does not instruct use of the unavailable MCP bridge',async()=>{
  let prompt='';
  const run=runner(()=>{const child=syntheticChild({onInput:c=>c.complete()});child.stdin.on('data',chunk=>prompt+=chunk);return child;});
  await run.run(owned());
  assert.doesNotMatch(prompt,/Use the INNO MCP tools|provider handoff is available/i);
});

test('timeout requests termination but keeps run pending until close',async()=>{
  let child,kills=0,settled=false;
  const run=runner(()=>child=syntheticChild({onKill:()=>{kills++;return true;}}),{now:()=>Date.now(),monotonicNow:()=>performance.now()});
  const start=Date.now();
  const value=task({checkpoint:{...task().checkpoint,claimedAt:new Date(start).toISOString(),evaluationBudget:{...task().checkpoint.evaluationBudget,maxDurationMs:40,deadlineAtMs:start+40}},evaluationBudget:{...binding,maxDurationMs:40}});
  const promise=run.run(owned(value)).finally(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,75));
  assert.ok(kills>=1);assert.equal(settled,false);
  child.emit('close',null,'SIGTERM');
  await assert.rejects(promise,error=>{
    assert.equal(error.localExecution.started,true,error.stack);
    assert.equal(error.localExecution.rootProcessClosed,true);
    assert.equal(error.localExecution.deadlineExceeded,true);
    return true;
  });
});

test('kill throw and process error do not settle a started process before close',async()=>{
  for(const trigger of ['kill-throw','process-error']){
    let child,settled=false,kills=0;
    const run=runner(()=>child=syntheticChild({onKill:()=>{kills++;if(trigger==='kill-throw')throw Error('kill failed');return true;}}),
      {now:()=>Date.now(),monotonicNow:()=>performance.now()});
    const start=Date.now();
    const value=task({checkpoint:{...task().checkpoint,claimedAt:new Date(start).toISOString(),evaluationBudget:{...task().checkpoint.evaluationBudget,maxDurationMs:40,deadlineAtMs:start+40}},evaluationBudget:{...binding,maxDurationMs:40}});
    const promise=run.run(owned(value)).finally(()=>{settled=true;});
    await new Promise(resolve=>setTimeout(resolve,10));
    if(trigger==='process-error')child.emit('error',Error('process failed'));
    await new Promise(resolve=>setTimeout(resolve,60));
    assert.ok(kills>=1,`${trigger} must request termination after timeout`);
    assert.equal(settled,false);
    child.emit('close',null,'SIGTERM');
    await assert.rejects(promise,error=>{
      assert.equal(error.localExecution.rootProcessClosed,true);
      assert.equal(error.localExecution.started,true);
      return true;
    });
  }
});

test('abort waits for close and ordinary execution retains its existing path',async()=>{
  let child,settled=false;const controller=new AbortController();
  const bound=runner(()=>child=syntheticChild({onKill:()=>true}));
  const promise=bound.run(owned(task(),{signal:controller.signal})).finally(()=>{settled=true;});
  await new Promise(resolve=>setImmediate(resolve));controller.abort();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  child.emit('close',null,'SIGTERM');
  await assert.rejects(promise,error=>{assert.equal(error.name,'AbortError');assert.equal(error.localExecution.rootProcessClosed,true);return true;});
  const ordinary=runner(()=>syntheticChild({onInput:c=>c.complete()}));
  const result=await ordinary.run({task:{id:'ordinary',prompt:'Work'}});
  assert.equal(result.content,'done');
  assert.equal(result.localExecution,undefined);
});

test('normal close removes abort listener and deadline timer',async()=>{
  let child,kills=0;
  const controller=new AbortController();
  const run=runner(()=>child=syntheticChild({onKill:()=>{kills++;return true;},onInput:c=>c.complete()}));
  const result=await run.run(owned(task(),{signal:controller.signal}));
  assert.equal(result.localExecution.rootProcessClosed,true);
  controller.abort();
  await new Promise(resolve=>setTimeout(resolve,110));
  assert.equal(kills,0);
});

test('ordinary process error retains immediate failure behavior without waiting for close',async()=>{
  let child;
  const run=runner(()=>child=syntheticChild());
  const promise=run.run({task:{id:'ordinary-error',prompt:'Work'}});
  await new Promise(resolve=>setImmediate(resolve));
  child.emit('error',Error('ordinary process error'));
  await Promise.race([assert.rejects(promise,/ordinary process error/),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('ordinary process error did not settle')),50))]);
});

test('real harmless Node process times out and reports only local root close',async()=>{
  const start=Date.now();
  const value=task({checkpoint:{...task().checkpoint,claimedAt:new Date(start).toISOString(),evaluationBudget:{...task().checkpoint.evaluationBudget,maxDurationMs:250,deadlineAtMs:start+250}},evaluationBudget:{...binding,maxDurationMs:250}});
  let realChild;
  const run=runner((_cmd,_args,opts)=>realChild=spawn(process.execPath,['-e','setInterval(() => {}, 1000)'],opts),
    {now:()=>Date.now(),monotonicNow:()=>performance.now()});
  const watchdog=setTimeout(()=>realChild?.kill(),2000);
  try {
    await assert.rejects(()=>run.run(owned(value)),error=>{
      assert.equal(error.localExecution.started,true,error.stack);
      assert.equal(error.localExecution.rootProcessClosed,true);
      assert.equal(error.localExecution.deadlineExceeded,true);
      assert.ok(error.localExecution.elapsedMs>=1);
      return true;
    });
  } finally {clearTimeout(watchdog);if(realChild?.exitCode===null&&!realChild.killed)realChild.kill();}
});
