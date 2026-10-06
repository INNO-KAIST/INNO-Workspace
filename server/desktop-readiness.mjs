import {checkRunStorage} from './bridge-runtime.mjs';

// A readiness failure names its reason, so the connector can tell the cloud why it is not
// taking work (H9-1) while it keeps re-checking.
const notReady=(reason,message,cause)=>Object.assign(Error(message,cause?{cause}:undefined),{code:'DESKTOP_NOT_READY',reason});

export function createDesktopReadiness({runner,runRoot,checkStorage=checkRunStorage}){
 return async()=>{
  try{await checkStorage(runRoot);}catch(error){throw notReady('run_storage',String(error?.message||'Desktop run storage check failed.'),error);}
  if(!await runner.available())throw notReady('codex_login','Sign in to Codex using your ChatGPT subscription before starting a new desktop task.');
 };
}
