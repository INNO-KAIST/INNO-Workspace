// The desktop runner's own observation of a bounded execution (H6): process start and
// close, monotonic elapsed time, the deadline outcome and the optional process-tree proof.
// Optional evidence: anything outside the exact shape is dropped, never the result.
const OUTCOMES=new Set(['verified','survivors','unavailable']);
const keys=(value,allowed,required)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));
const count=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;

function boundedTree(tree){
 if(!keys(tree,['outcome','recorded','survivors','reason','checkedAt'],['outcome','recorded','survivors','checkedAt'])
  ||!OUTCOMES.has(tree.outcome)||!count(tree.recorded,100000)
  ||!Array.isArray(tree.survivors)||tree.survivors.length>64||!tree.survivors.every(pid=>count(pid,2**32))
  ||typeof tree.checkedAt!=='string'||tree.checkedAt.length>40
  ||tree.reason!==undefined&&(typeof tree.reason!=='string'||!/^[a-z_]{1,40}$/.test(tree.reason)))return null;
 return {outcome:tree.outcome,recorded:tree.recorded,survivors:[...tree.survivors],...(tree.reason!==undefined?{reason:tree.reason}:{}),checkedAt:tree.checkedAt};
}

export function boundedLocalExecution(value){
 if(!keys(value,['started','rootProcessClosed','elapsedMs','deadlineExceeded','tree'],['started','rootProcessClosed','elapsedMs','deadlineExceeded'])
  ||typeof value.started!=='boolean'||typeof value.rootProcessClosed!=='boolean'||typeof value.deadlineExceeded!=='boolean'
  ||!(value.elapsedMs===null||count(value.elapsedMs,86_400_000)))return null;
 let tree;
 if(value.tree!==undefined){tree=boundedTree(value.tree);if(!tree)return null;}
 return {started:value.started,rootProcessClosed:value.rootProcessClosed,elapsedMs:value.elapsedMs,deadlineExceeded:value.deadlineExceeded,...(tree?{tree}:{})};
}

// A reservation may settle only from this: the root closed, a measured elapsed time and
// every local descendant observed gone.
export function verifiedLocalExecution(value){
 const observed=boundedLocalExecution(value),tree=observed?.tree;
 return observed&&observed.rootProcessClosed&&observed.started&&Number.isSafeInteger(observed.elapsedMs)
  &&tree?.outcome==='verified'&&tree.survivors.length===0&&Number.isFinite(Date.parse(tree.checkedAt))?observed:null;
}
