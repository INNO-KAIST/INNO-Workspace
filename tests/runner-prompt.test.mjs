import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createCodexRunner,createClaudeRoutineRunner} from '../server/runners.mjs';

function fakeSpawn(capture){
 return ()=>{
  const child=new EventEmitter();
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.stdin.on('data',chunk=>{capture.text=(capture.text??'')+chunk;});
  child.stdin.on('finish',()=>{
   child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Done'}})+'\n');
   child.stdout.end();child.emit('close',0,null);
  });
  return child;
 };
}
async function promptFor(provider,task){
 const capture={};
 if(provider==='codex'){
  const runner=createCodexRunner({spawnProcess:fakeSpawn(capture),ensureDirectory:()=>{},runDirectory:()=>process.cwd(),modelCatalog:async()=>[]});
  await runner.run({task});
 }else{
  const runner=createClaudeRoutineRunner({url:'https://api.anthropic.com/fire',token:'fake',fetchFn:async(_url,options)=>{
   capture.text=JSON.parse(options.body).text;
   return {ok:true,json:async()=>({claude_code_session_url:'https://example.test/session',claude_code_session_id:'fake'})};
  }});
  await runner.run({task});
 }
 return capture.text;
}
const task=(prompt,messages)=>({id:'prompt-case',type:'general',title:'Prompt case',prompt,messages,plan:[]});
const between=(text,start,end)=>text.split(start)[1]?.split(end)[0]?.trimEnd();
const original=text=>between(text,'User request:\n','\nRecent durable conversation');
const conversation=text=>between(text,'Recent durable conversation (newer messages can revise the original request):\n','\nLast durable checkpoint:');

for(const provider of ['codex','claude']){
 test(`${provider} sends a long sole original request once without truncating it`,async()=>{
  const request='original-start '+ 'x'.repeat(8_500)+' original-end';
  const text=await promptFor(provider,task(request,[{role:'user',content:request}]));
  assert.equal(original(text),request);
  assert.equal(conversation(text),'- No additional messages.');
  assert.equal((text.match(/original-start/g)||[]).length,1);
  assert.equal((text.match(/original-end/g)||[]).length,1);
 });

 test(`${provider} retains changed, follow-up, non-user, and short-message conversation behavior`,async()=>{
  const request='Original request with detail worth preserving.';
  const cases=[
   {messages:[{role:'user',content:request},{role:'user',content:request}],expected:`user: ${request}\n\nuser: ${request}`},
   {messages:[{role:'user',content:request},{role:'user',content:'Please revise the output.'}],expected:`user: ${request}\n\nuser: Please revise the output.`},
   {messages:[{role:'user',content:'Different content.'}],expected:'user: Different content.'},
   {messages:[{role:'assistant',content:request}],expected:`assistant: ${request}`},
  ];
  for(const {messages,expected} of cases){
   const text=await promptFor(provider,task(request,messages));
   assert.equal(original(text),request);assert.equal(conversation(text),expected);
  }
  const short='Hi';
  assert.equal(conversation(await promptFor(provider,task(short,[{role:'user',content:short}]))),'user: Hi');
  const shortUnicode='안녕';
  assert.equal(conversation(await promptFor(provider,task(shortUnicode,[{role:'user',content:shortUnicode}]))),'user: 안녕');
  const changed='changed-start '+ 'y'.repeat(8_500)+' changed-end';
  assert.equal(conversation(await promptFor(provider,task(request,[{role:'user',content:changed}]))),`user: ${changed.slice(0,8_000)}`);
  const history=Array.from({length:21},(_,index)=>({role:'user',content:`message-${String(index).padStart(2,'0')}:`+'z'.repeat(4_500)}));
  const bounded=conversation(await promptFor(provider,task(request,history)));
  assert.equal(bounded.length,80_000);
  assert.doesNotMatch(bounded,/message-00:/);
  assert.match(bounded,/message-20:/);
 });
}
