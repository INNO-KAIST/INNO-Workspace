import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {checkedContextUrl,CONTEXT_ACCESS_LIMITS} from '../server/context-access.mjs';

const failure=(message,status)=>Object.assign(new Error(message),status===undefined?{}:{status});
async function boundedBytes(stream,limit){
 const chunks=[];let size=0;
 for await(const chunk of stream){
  const bytes=Buffer.from(chunk);size+=bytes.length;
  if(size>limit)throw failure('Local context payload exceeds limit');
  chunks.push(bytes);
 }
 return Buffer.concat(chunks);
}
export async function readLocalContext(input,{env=process.env,fetchFn=fetch}={}){
 let url;
 try{url=checkedContextUrl(env.INNO_CONTEXT_URL);}catch{throw failure('Invalid local context endpoint');}
 const token=env.INNO_CONTEXT_TOKEN;
 if(typeof token!=='string'||!token||token.length>2048)throw failure('Local context access is unavailable');
 if(!input||typeof input!=='object'||Array.isArray(input))throw failure('Invalid local context arguments');
 const body=JSON.stringify(input);
 if(Buffer.byteLength(body)>CONTEXT_ACCESS_LIMITS.maxRequestBytes)throw failure('Local context payload exceeds limit');
 let response,parsed;
 try{
  response=await fetchFn(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(10000)});
  const bytes=await boundedBytes(response.body,CONTEXT_ACCESS_LIMITS.maxResponseBytes);
  parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch{throw failure('Local context request failed');}
 if(!response.ok){
  const error=failure('Local context request rejected',response.status);
  if(response.status===409&&parsed?.code==='CONTEXT_VERSION_CONFLICT'&&Number.isSafeInteger(parsed.currentVersion)&&parsed.currentVersion>0)
   error.currentVersion=parsed.currentVersion;
  throw error;
 }
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw failure('Invalid local context response');
 return parsed;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const deadline=setTimeout(()=>{
  process.stdout.write(JSON.stringify({error:'Local context helper timed out'})+'\n',()=>process.exit(1));
 },10000);
 try{
  if(process.argv.length!==2)throw failure('Local context helper accepts JSON on standard input only');
  let input;
  try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(process.stdin,CONTEXT_ACCESS_LIMITS.maxRequestBytes)));}
  catch{throw failure('Invalid or oversized local context input');}
  process.stdout.write(JSON.stringify(await readLocalContext(input))+'\n');
 }catch(error){
  process.stdout.write(JSON.stringify({error:['Local context helper accepts JSON on standard input only','Invalid or oversized local context input','Invalid local context endpoint','Local context access is unavailable','Invalid local context arguments','Local context payload exceeds limit','Local context request failed','Local context request rejected','Invalid local context response'].includes(error.message)?error.message:'Local context request failed',...(Number.isInteger(error.status)?{status:error.status}:{}),...(Number.isSafeInteger(error.currentVersion)&&error.currentVersion>0?{currentVersion:error.currentVersion}:{})})+'\n');
  process.exitCode=1;
 }finally{clearTimeout(deadline);}
}
