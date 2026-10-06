// H9-2: a task's whole stored body stays below Cloudflare D1's 2,000,000-byte row limit.
// - No write may store more than TASK_BODY_MAX_BYTES. A state change (pause, cancel, resume,
//   failure, lease expiry) on a row stored larger before this limit existed may keep its size,
//   or add up to STATE_CHANGE_SLACK_BYTES while staying below the D1 limit.
// - A write that grows the body for a person or an executor during a run (creation, message,
//   decision, artifact, checkpoint, plan, attachments, import) must leave it at or below
//   TASK_GROWTH_MAX_BYTES unless it shrinks.
// - Every execution starts at or below TASK_GROWTH_MAX_BYTES (the run route refuses, and a
//   claim pauses an over-limit task instead of starting it), and the write that ends a run
//   (completion or handoff) adds at most COMPLETION_GROWTH_MAX_BYTES. So a started run can
//   always store its result: 1,000,000 + 800,000 < 1,900,000. Desktop results fit because the
//   connector sends at most 700,000 bytes and always includes its artifacts.
// Nothing already stored is removed to make room; the person continues in a new task.
export const TASK_BODY_MAX_BYTES=1_900_000;
export const TASK_GROWTH_MAX_BYTES=1_000_000;
export const COMPLETION_GROWTH_MAX_BYTES=800_000;
const STATE_CHANGE_SLACK_BYTES=16_384,D1_SAFE_BYTES=1_990_000;

const encoder=new TextEncoder();
// UTF-8 needs at most 3 bytes per UTF-16 code unit, so short text skips the encoding pass.
const byteLength=(text,limit)=>limit!==undefined&&text.length*3<=limit?text.length:encoder.encode(text).byteLength;
export const taskBodyBytes=task=>byteLength(JSON.stringify(task));

const CONTINUE='이 작업의 저장 기록이 상한(약 1MB)에 도달해 더 저장할 수 없습니다. 기존 기록은 그대로 두고, 새 작업을 만들어 이어 가세요.';
const HARD='이 변경을 저장하면 작업 저장 한도(1.9MB)를 넘습니다. 기존 기록은 그대로 두고, 새 작업을 만들어 이어 가세요.';
const RESULT='실행 결과가 한 번에 저장할 수 있는 크기(0.8MB)를 넘습니다. 큰 결과는 여러 파일로 나누거나 줄여서 저장하고, 계속 필요하면 새 작업으로 이어 가세요.';
export class TaskBodyLimitError extends Error {
 constructor(message=CONTINUE){super(message);this.name='TaskBodyLimitError';this.statusCode=413;this.code='TASK_BODY_LIMIT';}
}

// Returns the serialized body to store. growth: 'grow' for a person's or an executor's
// addition, 'completion' for the write that ends a run; omitted for state changes.
export function serializeTaskBody(next,{current,growth}={}){
 // Below the smallest threshold every check passes, so the estimate is enough there.
 const text=JSON.stringify(next),size=byteLength(text,COMPLETION_GROWTH_MAX_BYTES);
 let before;const currentBytes=()=>before??=current?taskBodyBytes(current):0;
 if(size>TASK_BODY_MAX_BYTES&&(growth||!current||size>Math.max(currentBytes(),Math.min(currentBytes()+STATE_CHANGE_SLACK_BYTES,D1_SAFE_BYTES))))throw new TaskBodyLimitError(HARD);
 if(growth==='grow'&&size>TASK_GROWTH_MAX_BYTES&&(!current||size>currentBytes()))throw new TaskBodyLimitError();
 if(growth==='completion'&&current&&size>COMPLETION_GROWTH_MAX_BYTES&&size-currentBytes()>COMPLETION_GROWTH_MAX_BYTES)throw new TaskBodyLimitError(RESULT);
 return text;
}

export function assertRunAdmission(task){
 if(taskBodyBytes(task)>TASK_GROWTH_MAX_BYTES)throw new TaskBodyLimitError();
}

// The page asks this on every render; a task object is replaced when it changes.
const nearLimit=new WeakMap();
export function taskNearLimit(task){
 if(!task||typeof task!=='object')return false;
 if(!nearLimit.has(task))nearLimit.set(task,taskBodyBytes(task)>TASK_GROWTH_MAX_BYTES);
 return nearLimit.get(task);
}
