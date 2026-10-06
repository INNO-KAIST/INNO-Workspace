import {createServer} from 'node:net';
import {readdir,stat} from 'node:fs/promises';
import path from 'node:path';
export async function acquireBridgeLock(port=4174){const server=createServer(socket=>socket.destroy());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({port,host:'127.0.0.1',exclusive:true},resolve);});return {port:server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};}
export function retryableStatus(status){return status===undefined||status===408||status===429||status>=500;}
export async function checkRunStorage(root,{maxBytes=256*1024*1024,maxEntries=5000}={}){let bytes=0,entries=0;async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(++entries>maxEntries)throw Error('Desktop run storage entry limit reached. Review saved outputs.');const full=path.join(dir,item.name);if(item.isSymbolicLink())continue;if(item.isDirectory())await walk(full);else{bytes+=(await stat(full)).size;if(bytes>maxBytes)throw Error('Desktop run storage limit reached (256 MiB). Review saved outputs.');}}}try{await walk(root);}catch(e){if(e.code!=='ENOENT')throw e;}return {bytes,entries};}

export function startupPortMessage(error){
 if(error?.code!=='EADDRINUSE')return null;
 return 'INNO 시작 안내: 로컬 포트 '+error.port+'을 이미 사용 중입니다. 다른 INNO 창이 실행 중이면 그대로 두고 .inno/DESKTOP-ACCESS.md의 링크로 접속하세요. 접속되지 않으면 해당 포트를 사용하는 프로그램을 확인하세요. 기존 프로그램은 종료하지 않았습니다.';
}

// Console text when the desktop service stops or reports an interrupted delivery.
// Points to preserved evidence; never suggests deleting a saved result.
export function deliveryStopMessage(error,{pendingPath='.inno/desktop-pending.json',versioned=false}={}){
 if(error?.code==='DESKTOP_NOT_READY'&&error.reason==='codex_login')
  return 'INNO 대기: 이 PC에서 Codex 로그인이 확인되지 않아 새 작업을 받지 않습니다. ChatGPT/Codex 앱에서 로그인 상태를 확인하세요. 1분 안팎 간격으로 다시 확인하고, 확인되면 자동으로 이어집니다. 로그인한 뒤에도 이 안내가 계속되면 이 창에서 Ctrl+C로 종료하고 Start INNO Cloud Bridge.cmd를 다시 실행하세요.';
 if(error?.code==='DESKTOP_NOT_READY')
  return `INNO 대기: 실행 저장 공간 점검에 실패해 새 작업을 받지 않습니다 (${String(error.message||'').slice(0,200)}). .inno/DESKTOP-ACCESS.md의 작업 화면에서 실행 저장 공간을 정리하세요. 정리되면 자동으로 이어집니다.`;
 if(error?.code==='OUTBOX_WRITE_FAILED'||error?.code?.startsWith?.('WORKSPACE_'))return error.message;
 if(error?.code==='OUTBOX_RECOVERY_REQUIRED')return versioned
  ?'A saved result needs explicit recovery. Open local result recovery from .inno/DESKTOP-ACCESS.md before resuming.'
  :`A saved result write was interrupted. Keep both files, ${pendingPath} and ${pendingPath}.tmp, and review the result before restarting; removing them can lose the result.`;
 if(error?.status===401)return 'Cloud authentication failed.';
 if(error?.status===409&&!versioned)return `Execution changed. Review ${pendingPath} before resuming.`;
 const detail=String(error?.message||'unknown error').slice(0,200);
 return `INNO delivery interrupted (${detail}). Any saved result is kept on this desktop; review local desktop status.`;
}
