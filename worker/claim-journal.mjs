import {ConflictError,ValidationError} from '../public/core/tasks.mjs';

// A desktop sends a fresh nonce with every receipt-protocol claim and keeps it in a local
// journal before the request leaves. If the response is lost or the desktop dies, it asks
// for the nonce's status instead of guessing which task it was given.
const NONCE=/^[0-9a-f]{64}$/;
const SWEEP_AFTER_MS=86_400_000,SWEEP_LIMIT=32;
export const claimMarkerKey=nonce=>'desktop_claim:'+nonce;

export function withClaimNonce(options,input){
 if(input?.claimNonce===undefined)return options;
 if(!options||typeof input.claimNonce!=='string'||!NONCE.test(input.claimNonce))throw new ValidationError('Invalid desktop claim nonce');
 return {...options,claimNonce:input.claimNonce};
}

// Closed markers and claimed markers whose reservation is gone are dropped a day later;
// a claimed marker stays while its reservation exists so a late restart can still learn
// its owner.
export async function sweepClaimMarkers(db,now){
 const cutoff=new Date(Date.parse(now)-SWEEP_AFTER_MS).toISOString();
 await db.prepare(`DELETE FROM metadata WHERE key IN (SELECT m.key FROM metadata m WHERE m.key GLOB 'desktop_claim:*'
  AND json_extract(m.value,'$.at')<?1
  AND (json_extract(m.value,'$.state')='closed' OR NOT EXISTS (SELECT 1 FROM metadata r WHERE r.key=json_extract(m.value,'$.reservationKey')))
  LIMIT ${SWEEP_LIMIT})`).bind(cutoff).run();
}

// "settled" means the claim's reservation is gone: its result was applied, discharged or
// explicitly discarded, so the desktop has nothing left to report for that owner.
async function storedMarker(db,value,workspaceId){
 let saved;
 try{saved=JSON.parse(value);}catch{throw new ConflictError('Stored desktop claim marker is invalid');}
 if(!saved||typeof saved!=='object'||Array.isArray(saved)||saved.version!==1||saved.workspaceId!==workspaceId)throw new ConflictError('Stored desktop claim marker is invalid');
 if(saved.state==='closed')return {state:'none'};
 if(saved.state!=='claimed'||typeof saved.taskId!=='string'||typeof saved.executionId!=='string'||!Number.isSafeInteger(saved.generation)||saved.generation<1
  ||typeof saved.reservationKey!=='string'||!saved.reservationKey.startsWith('desktop_reservation:'))throw new ConflictError('Stored desktop claim marker is invalid');
 if(!await db.prepare('SELECT 1 FROM metadata WHERE key=?1').bind(saved.reservationKey).first())return {state:'settled'};
 return {state:'claimed',taskId:saved.taskId,executionId:saved.executionId,generation:saved.generation};
}

// Closing the nonce first is the admission fence: a claim with this nonce that arrives
// after this call fails on the existing marker, so "none" stays true.
export async function claimStatus(db,{nonce,workspaceId,now}){
 if(typeof nonce!=='string'||!NONCE.test(nonce))throw new ValidationError('Invalid desktop claim nonce');
 await sweepClaimMarkers(db,now);
 const key=claimMarkerKey(nonce);
 await db.prepare(`INSERT INTO metadata(key,value) SELECT ?1,?2
  WHERE EXISTS (SELECT 1 FROM metadata w WHERE w.key='desktop_workspace_id' AND w.value=?3)
  ON CONFLICT(key) DO NOTHING`).bind(key,JSON.stringify({version:1,state:'closed',workspaceId,at:now}),workspaceId).run();
 const row=await db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first();
 if(typeof row?.value!=='string')throw new ConflictError('Desktop workspace identity mismatch');
 return storedMarker(db,row.value,workspaceId);
}
