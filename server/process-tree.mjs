import {execFile} from 'node:child_process';

// Ends the descendants of a Codex run on Windows with built-in tools only (H6).
// Safety rules:
// - A process is identified by (pid, creation time). Ending is by identity: each target
//   is re-read and ended only if its creation time still matches. Nothing uses
//   `taskkill /T`, whose tree expansion has no creation-time guard. A few milliseconds
//   remain between that check and `Terminate`, which resolves the PID again; a target
//   would have to exit and its PID be reused inside that window.
// - The root's identity is confirmed only from a snapshot that finished while the runner
//   still held the root's process handle (Windows does not reuse a PID while a handle is
//   open), and only if it was created around the spawn time. Otherwise nothing is ended.
// - Descendants are learned while the run is alive (a sample at spawn, then periodic
//   samples) and again at termination. A row is adopted only if its parent PID belonged to
//   a tracked process when the row was created: the parent is present now, or was last
//   seen alive (the root: last held) after the row was created. Other rows under a
//   tracked PID are ambiguous; they are never ended and the proof is not verified.
// The proof claims only what was observed. A descendant whose parent lived only between two
// samples is never observed (its parent PID is unknown), so 'verified' does not cover it.
// - 'verified': every observed descendant is gone, none was ambiguous and the tracking limit
//   was not reached;
// - 'survivors': some remained within the bounded retries and time budget;
// - 'unavailable': the tree could not be observed, the root identity was not confirmed, a
//   row was ambiguous or the tracking limit was reached.
const CALL_MS=10000,MAX_SURVIVORS=64;
const runTool=(file,args,{timeout,signal})=>new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout,signal,maxBuffer:16*1024*1024},(error,stdout)=>error?reject(error):resolve(String(stdout))));
const LIST="Get-CimInstance Win32_Process | ForEach-Object { '{0},{1},{2}' -f $_.ProcessId,$_.ParentProcessId,$(if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}else{-1}) }";

async function enumerateWindows({timeout=CALL_MS,signal}={}){
 return (await runTool('powershell.exe',['-NoProfile','-NonInteractive','-Command',LIST],{timeout,signal})).split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
  const [pid,ppid,created]=line.split(',').map(Number);return {pid,ppid,created};
 }).filter(row=>Number.isSafeInteger(row.pid)&&Number.isSafeInteger(row.ppid)&&Number.isSafeInteger(row.created));
}

// One PowerShell call per round; the target list holds integers only.
async function killPairsWindows(pairs,{timeout=CALL_MS}={}){
 const list=pairs.filter(p=>Number.isSafeInteger(p.pid)&&p.pid>0&&Number.isSafeInteger(p.created)&&p.created>=0).map(p=>`${p.pid}:${p.created}`).join(',');
 if(!list)return;
 const script=`foreach($t in '${list}'.Split(',')){ $p,$c=$t.Split(':'); $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p); if($proc -and $proc.CreationDate -and ([DateTimeOffset]$proc.CreationDate).ToUnixTimeMilliseconds() -eq [int64]$c){ Invoke-CimMethod -InputObject $proc -MethodName Terminate | Out-Null } }`;
 await runTool('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout});
}

export function createProcessTree({platform=process.platform,enumerate=enumerateWindows,killPairs=killPairsWindows,rounds=3,pauseMs=300,budgetMs=30000,identitySlackMs=5000,maxTracked=512,now=Date.now,checkedAt=()=>new Date().toISOString()}={}){
 return {
  // heldUntil(): Infinity while the runner holds the root's process handle, then the time
  // from which its PID may have been reused.
  track(pid,{spawnedAt,heldUntil=()=>-Infinity}={}){
   const known=new Map(),seen=new Map(),identity=row=>`${row.pid}:${row.created}`;
   const samples=new AbortController();
   let root=null,capped=false;
   const lastAlive=k=>Math.max(seen.get(identity(k))??-Infinity,k===root?heldUntil():-Infinity);
   const classify=(row,holder)=>{
    const parents=[...known.values()].filter(k=>k.pid===row.ppid&&k.created<=row.created);
    if(!parents.length)return 'unrelated';
    const current=holder.get(row.ppid);
    if(current&&parents.some(p=>p.created===current.created))return 'adopt';
    // A newer process holding the parent PID since before this row was its real parent.
    if(current&&row.created>=current.created)return 'unrelated';
    return parents.some(p=>row.created<lastAlive(p))?'adopt':'ambiguous';
   };
   // Returns the ambiguous rows of this snapshot, or null while the root is unconfirmed.
   const absorb=(rows,startedAt,endedAt)=>{
    if(!root){
     const candidate=rows.find(row=>row.pid===pid);
     if(!candidate||!(heldUntil()>endedAt)||!Number.isSafeInteger(spawnedAt)||Math.abs(candidate.created-spawnedAt)>identitySlackMs)return null;
     root=candidate;known.set(identity(candidate),candidate);
    }
    const holder=new Map(rows.map(row=>[row.pid,row]));
    for(const row of rows)if(known.has(identity(row)))seen.set(identity(row),Math.max(seen.get(identity(row))??-Infinity,startedAt));
    const open=()=>rows.filter(row=>!known.has(identity(row))&&row.created>=root.created);
    for(let changed=true;changed;){
     changed=false;
     for(const row of open()){
      if(classify(row,holder)!=='adopt')continue;
      if(known.size>=maxTracked){capped=true;continue;}
      known.set(identity(row),row);seen.set(identity(row),startedAt);changed=true;
     }
    }
    return open().filter(row=>classify(row,holder)==='ambiguous');
   };
   const result=(outcome,present=[],reason)=>({outcome,recorded:known.size,survivors:present.slice(0,MAX_SURVIVORS).map(row=>row.pid),...(reason?{reason}:{}),checkedAt:checkedAt()});
   return {
    async sample(){
     if(platform!=='win32'||samples.signal.aborted)return;
     const startedAt=now();
     try{const rows=await enumerate({timeout:CALL_MS,signal:samples.signal});if(!samples.signal.aborted)absorb(rows,startedAt,now());}catch{}
    },
    stop(){samples.abort();},
    async terminate(){
     if(platform!=='win32'||!Number.isSafeInteger(pid)||pid<=0)return result('unavailable',[],'unsupported');
     const started=now(),remaining=()=>budgetMs-(now()-started),callMs=()=>Math.min(CALL_MS,remaining());
     const snapshot=async()=>{
      const startedAt=now(),timeout=callMs();
      if(timeout<=0)throw new Error('time budget spent');
      const rows=await enumerate({timeout});
      return {rows,ambiguous:absorb(rows,startedAt,now())};
     };
     let snap;
     try{snap=await snapshot();}catch{return result('unavailable',[],'enumeration_failed');}
     if(!snap.ambiguous)return result('unavailable',[],'identity_unconfirmed');
     for(let round=0;;round++){
      const present=[...known.values()].filter(k=>snap.rows.some(row=>row.pid===k.pid&&row.created===k.created));
      if(!present.length){
       if(capped)return result('unavailable',[],'tracking_limit');
       if(snap.ambiguous?.length)return result('unavailable',snap.ambiguous,'ambiguous_orphan');
       return result('verified');
      }
      if(round>=rounds||callMs()<=0)return result('survivors',present);
      try{await killPairs(present,{timeout:callMs()});}catch{}
      const pause=Math.min(pauseMs,remaining());
      if(pause>0)await new Promise(resolve=>setTimeout(resolve,pause));
      if(callMs()<=0)return result('survivors',present);
      try{snap=await snapshot();}catch{return result('unavailable',present,'enumeration_failed');}
     }
    },
   };
  },
 };
}
