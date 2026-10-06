import {retryableStatus} from './bridge-runtime.mjs';
function untilAbort(signal){
 if(signal?.aborted)return Promise.resolve();
 return new Promise(resolve=>signal?.addEventListener('abort',resolve,{once:true}));
}
function delay(ms,signal){
 if(signal?.aborted)return Promise.resolve();
 return new Promise(resolve=>{
  const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};
  const timer=setTimeout(finish,ms);signal?.addEventListener('abort',finish,{once:true});
 });
}
async function notify(callback,value){try{await callback(value);}catch{}}
// The caller owns HTTP and process-lock lifetime, including shutdown after settled().
// A not-ready desktop (H9-1) is retried like a transport failure, with one notice per reason,
// and onRecovered announces the first successful tick after any notice.
export async function runDesktopService({bridge,deliveryReceiptVersion=0,signal,onError=()=>{},onDelivered=()=>{},onRecovered=()=>{},wait=delay}){
 if(![0,1].includes(deliveryReceiptVersion))throw Error('Unsupported delivery protocol');
 const versioned=deliveryReceiptVersion===1;
 const unsafe=()=>versioned&&(bridge.runtimeStatus().deliveryUnsafe||bridge.runtimeStatus().recoveryPaused);
 const park=async()=>{bridge.pauseForRecovery();await untilAbort(signal);};
 let nextDelay=15000,lastErrorKey;
 while(!signal?.aborted){
  if(unsafe()){await park();break;}
  try{
   const worked=await bridge.tick(),recovered=lastErrorKey!==undefined;lastErrorKey=undefined;nextDelay=worked?15000:Math.min(60000,nextDelay*1.5);
   if(recovered)await notify(onRecovered);
   if(unsafe()){await park();break;}
   if(worked)await notify(onDelivered);
  }catch(error){
   const shouldPark=versioned&&(unsafe()||!retryableStatus(error.status));
   if(shouldPark)bridge.pauseForRecovery();
   const key=error?.code==='DESKTOP_NOT_READY'?'not_ready:'+error.reason:Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?String(error.status):'transport';
   if(key!==lastErrorKey){lastErrorKey=key;await notify(onError,error);}
   if(shouldPark){await untilAbort(signal);break;}
   nextDelay=Math.min(60000,nextDelay*2);
   if(!retryableStatus(error.status))break;
  }
  if(!signal?.aborted)await wait(nextDelay,signal);
 }
}
