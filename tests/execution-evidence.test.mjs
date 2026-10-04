import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createCodexRunner} from '../server/runners.mjs';

const catalog=[{model:'gpt-5.6-terra',efforts:['high']}];
function spawnResult(result,capture){
 return (_command,args)=>{
  capture.args=args;
  const child=new EventEmitter();
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.stdin.on('finish',()=>{
   child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:12,output_tokens:4}})+'\n');
   child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}})+'\n');
   child.stdout.end();child.emit('close',0,null);
  });
  return child;
 };
}
function runner(result,capture,times){
 return createCodexRunner({spawnProcess:spawnResult(result,capture),ensureDirectory:()=>{},runDirectory:()=>process.cwd(),modelCatalog:async()=>catalog,now:()=>times.shift()});
}

test('child evidence reports applied CLI arguments and ignores model-authored evidence',async()=>{
 const capture={},task={id:'child',parentTaskId:'parent',batchId:'batch',parentEpoch:1,prompt:'Work',assignment:{provider:'codex',requestedModel:'gpt-5.6-terra',effort:'high',role:'worker',acceptanceCriteria:['Check result'],instructions:'Work'}};
 const result=await runner({summary:'done',executionEvidence:{actualModelVersion:'forged',processElapsedMs:1,cliAppliedModel:'forged'}},capture,[1000,1250]).run({task});
 assert.equal(capture.args[capture.args.indexOf('-m')+1],'gpt-5.6-terra');
 assert.deepEqual(result.executionEvidence,{provider:'codex',source:'cli_arguments',requestedModel:'gpt-5.6-terra',requestedEffort:'high',cliAppliedModel:'gpt-5.6-terra',cliAppliedEffort:'high',actualModelVersion:null,processElapsedMs:250,routeConditions:result.executionEvidence.routeConditions});
 assert.match(result.executionEvidence.routeConditions,/^[0-9a-f]{64}$/);
 assert.equal(result.usage.inputTokens,12);assert.equal(result.usage.outputTokens,4);
});

test('root execution does not turn catalog default into an applied or actual model',async()=>{
 const capture={};
 const result=await runner({summary:'done',executionEvidence:{actualModelVersion:'forged'}},capture,[2000,2010]).run({task:{id:'root',prompt:'Work'}});
 assert.equal(capture.args.includes('-m'),false);
 assert.deepEqual(result.executionEvidence,{provider:'codex',source:'cli_arguments',requestedModel:null,requestedEffort:null,cliAppliedModel:null,cliAppliedEffort:null,actualModelVersion:null,processElapsedMs:10,routeConditions:result.executionEvidence.routeConditions});
 assert.match(result.executionEvidence.routeConditions,/^[0-9a-f]{64}$/);
});

test('invalid or backward wall clock leaves process elapsed time unknown',async()=>{
 for(const times of [[2000,1999],[NaN,3000]]){
  const result=await runner({summary:'done'}, {}, times).run({task:{id:'root',prompt:'Work'}});
  assert.equal(result.executionEvidence.processElapsedMs,null);
 }
});
