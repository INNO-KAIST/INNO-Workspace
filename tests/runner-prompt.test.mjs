import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createCodexRunner,createClaudeRoutineRunner} from '../server/runners.mjs';

function fakeSpawn(capture){
 return ()=>{
  capture.calls=(capture.calls??0)+1;
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
async function promptFor(provider,task,capture={}){
 if(provider==='codex'){
  const runner=createCodexRunner({spawnProcess:fakeSpawn(capture),ensureDirectory:()=>{},runDirectory:()=>process.cwd(),modelCatalog:async()=>[]});
  await runner.run({task});
 }else{
  const runner=createClaudeRoutineRunner({url:'https://api.anthropic.com/fire',token:'fake',fetchFn:async(_url,options)=>{
   capture.calls=(capture.calls??0)+1;
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

 test(`${provider} preserves revised instructions and removes only the initial request echo`,async()=>{
  const request='Original request with detail worth preserving.';
  const cases=[
   {messages:[{role:'user',content:request},{role:'user',content:request}],expected:`[Message #2] user: ${request}`},
   {messages:[{role:'user',content:request},{role:'user',content:'Please revise the output.'}],expected:'[Message #2] user: Please revise the output.'},
   {messages:[{role:'user',content:'Different content.'}],expected:'[Message #1] user: Different content.'},
   {messages:[{role:'assistant',content:request}],expected:`[Message #1] assistant: ${request}`},
  ];
  for(const {messages,expected} of cases){
   const text=await promptFor(provider,task(request,messages));
   assert.equal(original(text),request);assert.equal(conversation(text),expected);
  }
  for(const short of ['Hi','안녕'])assert.equal(conversation(await promptFor(provider,task(short,[{role:'user',content:short}]))),'- No additional messages.');
 });

 test(`${provider} delivers old decisions and full message and checkpoint tails`,async()=>{
  const request='Keep the original objective.';
  const changed='changed-start '+ 'y'.repeat(8_500)+' changed-end';
  const checkpoint='checkpoint-start '+'c'.repeat(8_500)+' checkpoint-end';
  const messages=[{role:'user',content:request},{role:'user',content:'old-decision: do not publish'},...Array.from({length:21},(_,index)=>({role:'assistant',content:`progress-${index}`})),{role:'user',content:changed}];
  const text=await promptFor(provider,{...task(request,messages),checkpoint:{content:checkpoint}});
  assert.equal(original(text),request);
  assert.equal(text.split(request).length-1,1);
  assert.ok(conversation(text).includes('old-decision: do not publish'));
  assert.ok(conversation(text).includes(changed));
  assert.ok(text.includes(checkpoint));
 });

 test(`${provider} blocks oversized mandatory context before any provider execution`,async()=>{
  const capture={};
  const oversized=task('private-original',[{role:'user',content:'private-history '+'x'.repeat(400_000)}]);
  await assert.rejects(()=>promptFor(provider,oversized,capture),error=>{
   assert.equal(error.code,'CONTEXT_RETRIEVAL_REQUIRED');
   assert.doesNotMatch(error.message,/private-original|private-history|xxxxxxxx/);
   return true;
  });
  assert.equal(capture.calls??0,0);
 });
}
