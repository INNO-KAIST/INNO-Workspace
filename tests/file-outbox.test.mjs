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
