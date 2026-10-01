import {createModelCatalog} from '../server/model-routing.mjs';
import {RunStorage} from '../server/run-storage.mjs';
import {LocalRecords} from '../server/local-records.mjs';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {acquireBridgeLock,startupPortMessage,retryableStatus} from '../server/bridge-runtime.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withoutApiEnvironment,createCodexRunner} from '../server/runners.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createDesktopReadiness} from '../server/desktop-readiness.mjs';
import {sourceDelegationVersionFromEnvironment} from '../public/core/source-delegation-gate.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createCloudRequest,normalizedCloudOrigin} from '../server/delivery-binding.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const privateDir=path.join(root,'.inno');mkdirSync(privateDir,{recursive:true});
const endpoint=normalizedCloudOrigin(process.env.INNO_CLOUD_URL||'https://inno-workspace-api.innokaist.workers.dev');
const token=readFileSync(path.join(privateDir,'cloud-access-token.txt'),'utf8').trim();
const pendingPath=path.join(privateDir,'desktop-pending.json');
const outbox=createFileOutbox(pendingPath);
const request=createCloudRequest({endpoint,token});
let codexCommand='codex';
if(process.platform==='win32'&&process.env.LOCALAPPDATA){
 const binRoot=path.join(process.env.LOCALAPPDATA,'OpenAI','Codex','bin');
 if(existsSync(binRoot)){
  const installed=readdirSync(binRoot,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(binRoot,e.name,'codex.exe')).filter(existsSync).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
  if(installed.length)codexCommand=installed[0];
 }
}
const spawnCodex=(command,args,options)=>spawn(command==='codex'?codexCommand:command,args,options);
const runner=createCodexRunner({spawnProcess:spawnCodex,modelCatalog:createModelCatalog({spawnProcess:spawnCodex,env:withoutApiEnvironment(),cwd:root}),cwd:path.join(privateDir,'desktop-runs'),managedDelivery:true,sourceDelegationVersion:sourceDelegationVersionFromEnvironment(process.env)});
let lock;try{lock=await acquireBridgeLock();}catch(error){const message=startupPortMessage(error);if(!message)throw error;console.error(message);process.exit(1);}
const readDeliveryBinding=async()=>({origin:endpoint,workspaceId:(await request('/api/desktop/identity')).workspaceId});
const bridge=createDesktopBridge({request,runner,outbox,readDeliveryBinding,beforeClaim:createDesktopReadiness({runner,runRoot:path.join(privateDir,'desktop-runs')}),onError:e=>console.error(e.code?.startsWith('WORKSPACE_')?e.message:e.status?'INNO result delivery HTTP '+e.status:'INNO execution interrupted; saved results are retained.')});
const localTokenPath=path.join(privateDir,'desktop-access-token.txt');
if(!existsSync(localTokenPath))writeFileSync(localTokenPath,randomBytes(32).toString('base64url'),{mode:0o600});
const localToken=readFileSync(localTokenPath,'utf8').trim();
const desktopServer=createDesktopServer({token:localToken,publicDir:path.join(root,'public'),request,bridge,readDeliveryBinding,runStorage:new RunStorage(path.join(privateDir,'desktop-runs')),localRecords:new LocalRecords(path.join(privateDir,'tasks.sqlite'))});
try{await new Promise((resolve,reject)=>{desktopServer.once('error',reject);desktopServer.listen(4175,'127.0.0.1',resolve);});}catch(e){await lock.close();const message=startupPortMessage(e);if(!message)throw e;console.error(message);process.exit(1);}
writeFileSync(path.join(privateDir,'DESKTOP-ACCESS.md'),'# Desktop cloud workspace\n\n[Open desktop cloud workspace](http://127.0.0.1:4175/#token='+encodeURIComponent(localToken)+')\n\nThis private link opens the same cloud tasks and reads selected sources locally. Do not share it.\n');
let stopping=false,wake;
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{stopping=true;bridge.stop();wake?.();});
console.log('Desktop source connection: open .inno/DESKTOP-ACCESS.md');
console.log('INNO desktop bridge connected. One task at a time; Ctrl+C to stop.');
let delay=15000,lastError='';
while(!stopping){
 try{if(stopping)break;const worked=await bridge.tick();delay=worked?15000:Math.min(60000,delay*1.5);if(worked)console.log('INNO result delivered.');lastError='';}
 catch(e){const message=e.code?.startsWith('WORKSPACE_')?e.message:e.status===409?'Execution changed. Review .inno/desktop-pending.json before resuming.':e.status===401?'Cloud authentication failed.':e.message;if(message!==lastError){console.error(message);lastError=message;}delay=Math.min(60000,delay*2);if(!retryableStatus(e.status))break;}
 if(!stopping)await new Promise(resolve=>{const timer=setTimeout(resolve,delay);wake=()=>{clearTimeout(timer);resolve();};});
}

await bridge.settled();
await new Promise(resolve=>desktopServer.close(resolve));
await lock.close();
