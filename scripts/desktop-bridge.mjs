import {resolveCodexCommand} from '../server/codex-command.mjs';
import {createProcessTree} from '../server/process-tree.mjs';
import {createContextAccess} from '../server/context-access.mjs';
import {createModelCatalog} from '../server/model-routing.mjs';
import {RunStorage} from '../server/run-storage.mjs';
import {LocalRecords} from '../server/local-records.mjs';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {acquireBridgeLock,startupPortMessage,deliveryStopMessage} from '../server/bridge-runtime.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withoutApiEnvironment,createCodexRunner,sweepImageFolders} from '../server/runners.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {claudeCodePilotEnabled,createClaudeCodeRunner} from '../server/claude-code-runner.mjs';
import {runDesktopService} from '../server/desktop-service.mjs';
import {createOutboxRecovery} from '../server/outbox-recovery.mjs';

import {createDesktopReadiness} from '../server/desktop-readiness.mjs';
import {sourceDelegationVersionFromEnvironment} from '../public/core/source-delegation-gate.mjs';
import {deliveryReceiptVersionFromEnvironment} from '../public/core/delivery-receipt-gate.mjs';
import {createFileOutbox} from '../server/file-outbox.mjs';
import {createFileJournal} from '../server/claim-journal-file.mjs';
import {createCloudRequest,normalizedCloudOrigin} from '../server/delivery-binding.mjs';
// Receipts (protocol 1) only with INNO_DESKTOP_RECEIPT_VERSION=1; see docs/DELIVERY-ACTIVATION.md.
const deliveryReceiptVersion=deliveryReceiptVersionFromEnvironment(process.env);
const stopMessageOptions={pendingPath:'.inno/desktop-pending.json',versioned:deliveryReceiptVersion===1};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const privateDir=path.join(root,'.inno');mkdirSync(privateDir,{recursive:true});
const endpoint=normalizedCloudOrigin(process.env.INNO_CLOUD_URL||'https://inno-workspace-api.innokaist.workers.dev');
const token=readFileSync(path.join(privateDir,'cloud-access-token.txt'),'utf8').trim();
const pendingPath=path.join(privateDir,'desktop-pending.json');
const outbox=createFileOutbox(pendingPath);
const request=createCloudRequest({endpoint,token});
// The Codex app can replace its bundled CLI while the connector runs: resolve per spawn.
const spawnCodex=(command,args,options)=>spawn(command==='codex'?resolveCodexCommand():command,args,options);
const contextAccess=createContextAccess();
const runner=createCodexRunner({processTree:createProcessTree(),contextAccess,contextUrl:'http://127.0.0.1:4175/api/desktop/context',spawnProcess:spawnCodex,modelCatalog:createModelCatalog({spawnProcess:spawnCodex,env:withoutApiEnvironment(),cwd:root}),cwd:path.join(privateDir,'desktop-runs'),managedDelivery:true,sourceDelegationVersion:sourceDelegationVersionFromEnvironment(process.env)});
let lock;try{lock=await acquireBridgeLock();}catch(error){const message=startupPortMessage(error);if(!message)throw error;console.error(message);process.exit(1);}
// CR-009: image inputs left by a connector that was closed mid-run are removed at start.
await sweepImageFolders({olderThan:Date.now()});
const readDeliveryBinding=async()=>({origin:endpoint,workspaceId:(await request('/api/desktop/identity')).workspaceId});
// The claim journal is used only with delivery receipts (version 1).
const journal=deliveryReceiptVersion===1?createFileJournal(path.join(privateDir,'desktop-claim.json')):undefined;
// CR-006 S2: one runner per desktop provider; each claim runs on its own provider's runner.
// The Claude Code pilot runs only with INNO_CLAUDE_CODE=1 until it is promoted.
const runners=[runner,...(claudeCodePilotEnabled(process.env)?[createClaudeCodeRunner({processTree:createProcessTree(),cwd:path.join(privateDir,'desktop-runs')})]:[])];
const bridge=createDesktopBridge({deliveryReceiptVersion,request,runners,outbox,journal,readDeliveryBinding,beforeClaim:createDesktopReadiness({runners,runRoot:path.join(privateDir,'desktop-runs')}),onError:error=>console.error(deliveryStopMessage(error,stopMessageOptions)),onDiscarded:()=>console.log('INNO: 중지된 실행의 결과는 적용하지 않고 정리했습니다.')});
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
console.log(deliveryReceiptVersion===1?'Delivery receipts: on (local result recovery: see .inno/DESKTOP-ACCESS.md).':'Delivery receipts: off.');
try{
 await runDesktopService({bridge,deliveryReceiptVersion,signal:shutdown.signal,
  onDelivered:()=>console.log('INNO result delivered.'),
  onRecovered:()=>console.log('INNO: 다시 작업을 받을 수 있습니다.'),
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
