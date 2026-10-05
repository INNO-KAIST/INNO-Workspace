// Scoped context re-reads made by one cloud execution, counted by the Worker so the
// execution's delivery record can show them. Best effort: counting never fails or
// delays a result.
// - A counter starts at 0/0 when the execution is fired, so a missing counter means
//   unmeasured, not zero.
// - Counted: read_task_context calls that passed execution authorization, including
//   tool errors (0 bytes). Not counted: calls rejected before the tool (bad, expired
//   or superseded capability, reads outside the assignment). A review master's reads
//   of its children count under the master's execution.
// - Only a completion through the same execution's MCP call merges the counts. Other
//   endings (failure, handoff, delegation, expiry) leave the record unmeasured; their
//   counters are swept by the scheduled handler a day later, 32 per run.
const SWEEP_AFTER_MS=86_400_000,SWEEP_LIMIT=32;
const key=scope=>`context_read:${scope.taskId}:${scope.executionId}:${scope.generation}`;
const count=value=>Number.isSafeInteger(value)&&value>=0;

export async function startContextReads(db,scope,now){
 try{await db.prepare(`INSERT OR IGNORE INTO metadata(key,value) VALUES(?1,json_object('version',1,'requests',0,'bytes',0,'at',?2))`).bind(key(scope),now).run();}catch{}
}

// One atomic upsert per counted read.
export async function countContextRead(db,scope,bytes,now){
 if(!count(bytes))return;
 try{
  await db.prepare(`INSERT INTO metadata(key,value) VALUES(?1,json_object('version',1,'requests',1,'bytes',?2,'at',?3))
   ON CONFLICT(key) DO UPDATE SET value=json_object('version',1,'requests',json_extract(value,'$.requests')+1,'bytes',json_extract(value,'$.bytes')+?2,'at',?3)`).bind(key(scope),bytes,now).run();
 }catch{}
}

export async function sweepContextReads(db,now){
 try{
  const cutoff=new Date(Date.parse(now)-SWEEP_AFTER_MS).toISOString();
  await db.prepare(`DELETE FROM metadata WHERE key IN (SELECT key FROM metadata WHERE key GLOB 'context_read:*' AND json_extract(value,'$.at')<?1 LIMIT ${SWEEP_LIMIT})`).bind(cutoff).run();
 }catch{}
}

// Counts for this execution, or null when none were recorded or the row is unreadable.
export async function takeContextReads(db,scope){
 try{
  const row=await db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key(scope)).first();
  const saved=typeof row?.value==='string'?JSON.parse(row.value):null;
  return saved?.version===1&&count(saved.requests)&&count(saved.bytes)?{requests:saved.requests,bytes:saved.bytes}:null;
 }catch{return null;}
}

export async function clearContextReads(db,scope){
 try{await db.prepare('DELETE FROM metadata WHERE key=?1').bind(key(scope)).run();}catch{}
}

// The store an execution-scoped MCP call sees: completing that same execution carries
// its counted re-reads as a server option (never from tool input), then clears them.
// Take, finish and clear are separate steps; a read landing between them is lost.
export function withContextReads(store,scope){
 return new Proxy(store,{get(target,property){
  if(property==='finishExecution')return async(id,input,options={})=>{
   const own=id===scope.taskId&&input?.executionId===scope.executionId&&input?.generation===scope.generation;
   const reads=own?await takeContextReads(target.db,scope):null;
   const task=await target.finishExecution(id,input,reads?{...options,contextReads:reads}:options);
   if(reads)await clearContextReads(target.db,scope);
   return task;
  };
  const value=Reflect.get(target,property,target);
  return typeof value==='function'?value.bind(target):value;
 }});
}
