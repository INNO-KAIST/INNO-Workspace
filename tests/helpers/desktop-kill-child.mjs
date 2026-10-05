// Child process for tests/desktop-process-kill.test.mjs. It runs the real desktop bridge
// (receipt protocol 1, file outbox, claim journal) against the parent's test Worker. It
// opens no listening port and never touches the real desktop connector (4174/4175).
import {createDesktopBridge} from '../../server/desktop-bridge.mjs';
import {createFileOutbox} from '../../server/file-outbox.mjs';
import {createFileJournal} from '../../server/claim-journal-file.mjs';
import {createCloudRequest} from '../../server/delivery-binding.mjs';

const [parent,token,pendingPath,journalPath,mode,taskId,expectedVersion]=process.argv.slice(2);
const say=line=>process.stdout.write(line+'\n');
// The cloud origin stays HTTPS as in production; calls are carried to the parent's local server.
const origin='https://inno.example';
const request=createCloudRequest({endpoint:origin,token,fetchFn:(url,options)=>fetch(new URL(url.pathname+url.search,parent),options)});
const readDeliveryBinding=async()=>({origin,workspaceId:(await request('/api/desktop/identity')).workspaceId});
const runner=mode==='start'
 ? {run:()=>{say('RUNNING');return new Promise(resolve=>setTimeout(()=>resolve({content:'child result'}),Number(process.env.RUN_MS??60_000)));}}
 : {run:()=>{say('RERUN');throw Error('AI must not rerun after a restart');}};
const bridge=createDesktopBridge({deliveryReceiptVersion:1,request,runner,readDeliveryBinding,heartbeatMs:3_600_000,
 outbox:createFileOutbox(pendingPath),journal:createFileJournal(journalPath),onError:error=>say('ERROR '+(error?.message??'unknown'))});
try{
 if(mode==='start'){
  await bridge.startTask(taskId,{expectedVersion:Number(expectedVersion),materials:[]});
  say('CLAIMED');await bridge.settled();say('SETTLED');
 }else{
  // A restarted process: one tick resolves whatever the previous process left behind.
  say('TICK '+await bridge.tick());
 }
}catch(error){say('FAILED '+(error?.message??'unknown'));process.exitCode=1;}
