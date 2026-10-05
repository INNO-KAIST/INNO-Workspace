import {createContextAccess} from '../server/context-access.mjs';
import {createModelCatalog} from '../server/model-routing.mjs';
import {RunStorage} from '../server/run-storage.mjs';
import {LocalRecords} from '../server/local-records.mjs';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {acquireBridgeLock,startupPortMessage,deliveryStopMessage} from '../server/bridge-runtime.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withoutApiEnvironment,createCodexRunner} from '../server/runners.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {runDesktopService} from '../server/desktop-service.mjs';
import {createOutboxRecovery} from '../server/outbox-recovery.mjs';

import {createDesktopReadiness} from '../server/desktop-readiness.mjs';
import {sourceDelegationVersionFromEnvironment} from '../public/core/source-delegation-gate.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createFileJournal} from '../server/claim-journal-file.mjs';
import {createCloudRequest,normalizedCloudOrigin} from '../server/delivery-binding.mjs';
const deliveryReceiptVersion=0;
const stopMessageOptions={pendingPath:'.inno/desktop-pending.json',versioned:deliveryReceiptVersion===1};
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
const contextAccess=createContextAccess();
const runner=createCodexRunner({contextAccess,contextUrl:'http://127.0.0.1:4175/api/desktop/context',spawnProcess:spawnCodex,modelCatalog:createModelCatalog({spawnProcess:spawnCodex,env:withoutApiEnvironment(),cwd:root}),cwd:path.join(privateDir,'desktop-runs'),managedDelivery:true,sourceDelegationVersion:sourceDelegationVersionFromEnvironment(process.env)});
let lock;try{lock=await acquireBridgeLock();}catch(error){const message=startupPortMessage(error);if(!message)throw error;console.error(message);process.exit(1);}
const readDeliveryBinding=async()=>({origin:endpoint,workspaceId:(await request('/api/desktop/identity')).workspaceId});
// The claim journal is used only with delivery receipts (version 1).
const journal=deliveryReceiptVersion===1?createFileJournal(path.join(privateDir,'desktop-claim.json')):undefined;
const bridge=createDesktopBridge({deliveryReceiptVersion,request,runner,outbox,journal,readDeliveryBinding,beforeClaim:createDesktopReadiness({runner,runRoot:path.join(privateDir,'desktop-runs')}),onError:error=>console.error(deliveryStopMessage(error,stopMessageOptions)),onDiscarded:()=>console.log('INNO: 중지된 실행의 결과는 적용하지 않고 정리했습니다.')});
const outboxRecovery=createOutboxRecovery(pendingPath,{withExclusive:work=>bridge.recoveryMaintenance(work)});
const localTokenPath=path.join(privateDir,'desktop-access-token.txt');
if(!existsSync(localTokenPath))writeFileSync(localTokenPath,randomBytes(32).toString('base64url'),{mode:0o600});
const localToken=readFileSync(localTokenPath,'utf8').trim();
const desktopServer=createDesktopServer({contextAccess,deliveryReceiptVersion,outboxRecovery,token:localToken,publicDir:path.join(root,'public'),request,bridge,readDeliveryBinding,runStorage:new RunStorage(path.join(privateDir,'desktop-runs')),localRecords:new LocalRecords(path.join(privateDir,'tasks.sqlite'))});
try{await new Promise((resolve,reject)=>{desktopServer.once('error',reject);desktopServer.listen(4175,'127.0.0.1',resolve);});}catch(e){await lock.close();const message=startupPortMessage(e);if(!message)throw e;console.error(message);process.exit(1);}
writeFileSync(path.join(privateDir,'DESKTOP-ACCESS.md'),'# Desktop cloud workspace\n\n[Open desktop cloud workspace](http://127.0.0.1:4175/#token='+encodeURIComponent(localToken)+')\n\n'+(deliveryReceiptVersion===1?'[Open local result recovery](http://127.0.0.1:4175/recovery.html#token='+encodeURIComponent(localToken)+')\n\n':'')+'This private link opens the same cloud tasks and reads selected sources locally. Do not share it.\n');
const shutdown=new AbortController();
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{shutdown.abort();contextAccess.close();bridge.stop();});
console.log('Desktop source connection: open .inno/DESKTOP-ACCESS.md');
console.log('INNO desktop bridge connected. One task at a time; Ctrl+C to stop.');
try{
 await runDesktopService({bridge,deliveryReceiptVersion,signal:shutdown.signal,
  onDelivered:()=>console.log('INNO result delivered.'),
  onError:error=>console.error(deliveryStopMessage(error,stopMessageOptions))
 });
}finally{
 shutdown.abort();contextAccess.close();bridge.stop();
 try{await bridge.settled();}
 finally{
  try{await new Promise((resolve,reject)=>desktopServer.close(error=>error?reject(error):resolve()));}
  finally{await lock.close();}
 }
}
