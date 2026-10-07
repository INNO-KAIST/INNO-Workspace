import {checkRunStorage} from './bridge-runtime.mjs';

// A readiness failure names its reason, so the connector can tell the cloud why it is not
// taking work (H9-1) while it keeps re-checking.
const notReady=(reason,message,cause)=>Object.assign(Error(message,cause?{cause}:undefined),{code:'DESKTOP_NOT_READY',reason});

const MESSAGES={
 codex_login:'Sign in to Codex using your ChatGPT subscription before starting a new desktop task.',
 claude_login:'Sign in to Claude Code with your Claude subscription (claude auth login) before starting a new desktop task.',
 claude_cli:'Claude Code CLI was not found on this PC.',
};
const runnerReady=async item=>{try{return await item.available()===true;}catch{return false;}};

// CR-006 S2a: with several runners, each is checked; the result names the ready providers and
// why the others are not, and only a desktop with none ready stops taking work.
export function createDesktopReadiness({runner,runners,runRoot,checkStorage=checkRunStorage}){
 return async()=>{
  try{await checkStorage(runRoot);}catch(error){throw notReady('run_storage',String(error?.message||'Desktop run storage check failed.'),error);}
  if(!Array.isArray(runners)){
   if(!await runner.available())throw notReady('codex_login',MESSAGES.codex_login);
   return;
  }
  const ready=[],waiting=[];
  for(const item of runners){
   if(await runnerReady(item))ready.push(item.provider);
   else waiting.push({provider:item.provider,reason:item.notReadyReason??'codex_login'});
  }
  if(!ready.length){const reason=waiting[0]?.reason??'codex_login';throw Object.assign(notReady(reason,MESSAGES[reason]??'No desktop runner can take work.'),{notReady:waiting});}
  return {ready,notReady:waiting};
 };
}
