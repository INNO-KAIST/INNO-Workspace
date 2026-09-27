import {runnerError} from '../public/core/failures.mjs';
// Keep semantic output, not the full execution transcript. Limits are UTF-16 characters.
export function createTailCollector(maxChars=65536) {
 let tail='';
 return {write(chunk){tail=(tail+chunk.slice(-maxChars)).slice(-maxChars);},finish(){return tail;}};
}
export function createEventCollector({maxLineChars=16*1024*1024}={}) {
 let pending='',thread,message,failure,error,usage={};
 const priority=e=>({AUTH_REQUIRED:3,QUOTA_EXCEEDED:2,CONNECTION_FAILED:1}[runnerError({message:e?.message??e?.error?.message??''}).code]??0);
 function consume(line){
  let e;try{e=JSON.parse(line);}catch{return;}
  if(!e||typeof e!=='object')return;
  if(e.type==='thread.started'&&e.thread_id!=null)thread={type:e.type,thread_id:e.thread_id};
  if(e.type==='item.completed'&&e.item?.type==='agent_message'&&typeof e.item.text==='string')message={type:e.type,item:{type:'agent_message',text:e.item.text}};
  if(e.type==='turn.failed'&&!failure)failure={type:e.type,error:e.error};
  if(e.type==='error'&&(!error||priority(e)>priority(error)))error={type:e.type,message:e.message,error:e.error};
  const u=e.usage??e.turn?.usage;if(u)for(const key of ['input_tokens','cached_input_tokens','output_tokens'])if(Number.isFinite(u[key]))usage[key]=u[key];
 }
 function append(fragment){if(pending.length+fragment.length>maxLineChars){pending='';throw Object.assign(Error('Executor output record exceeds the processing limit. Generated files are retained.'),{code:'OUTPUT_LIMIT'});}pending+=fragment;}
 return {
  write(chunk){let start=0,end;while((end=chunk.indexOf('\n',start))!==-1){append(chunk.slice(start,end));consume(pending);pending='';start=end+1;}append(chunk.slice(start));},
  finish(){if(pending){consume(pending);pending='';}return [thread,message,Object.keys(usage).length?{type:'turn.completed',usage}:null,error,failure].filter(Boolean).map(JSON.stringify).join('\n');}
 };
}
