import {checkRunStorage} from './bridge-runtime.mjs';

export function createDesktopReadiness({runner,runRoot,checkStorage=checkRunStorage}){
 return async()=>{
  await checkStorage(runRoot);
  if(!await runner.available())throw Error('Sign in to Codex using your ChatGPT subscription before starting a new desktop task.');
 };
}
