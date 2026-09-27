import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const DEFAULT_URL='https://inno-workspace-api.innokaist.workers.dev/mcp';
const TOOLS=new Set(['read_task','list_tasks','claim_execution','checkpoint_task','artifact_task','plan_task','request_decision','handoff_task','delegate_task','retry_delegation','available_models','renew_execution']);
export function prepareRequest(tool,args={},endpoint=DEFAULT_URL){
 const url=new URL(endpoint);
 if(url.protocol!=='https:')throw new Error('MCP endpoint must use HTTPS');
 if(url.username||url.password||url.search||url.hash)throw new Error('MCP URL cannot contain credentials, query or fragment');
 if(tool!=='--list'&&!TOOLS.has(tool))throw new Error('Unsupported INNO tool');
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Tool arguments must be a JSON object');
 const {executionCapability,...toolArguments}=args;
 if(executionCapability!==undefined&&(typeof executionCapability!=='string'||!executionCapability||executionCapability.length>4096))throw new Error('Execution capability is invalid');
 const input=JSON.stringify({jsonrpc:'2.0',id:1,method:tool==='--list'?'tools/list':'tools/call',...(executionCapability!==undefined?{executionCapability}:{}),...(tool==='--list'?{}:{params:{name:tool,arguments:toolArguments}})});
 if(Buffer.byteLength(input)>750000)throw new Error('Request cannot exceed 750000 UTF-8 bytes');
 // The Claude cloud agent proxy supplies Authorization for this exact host.
 // Never add credentials to argv, source files or environment variables here.
 return {url:url.href,input,args:['--silent','--show-error','--fail-with-body','--proto','=https','--connect-timeout','10','--max-time','45','--request','POST','--header','Content-Type: application/json','--header','Accept: application/json','--data-binary','@-',url.href]};
}
export function curlTransport(request){
 return new Promise((resolve,reject)=>{
  const child=spawn('curl',request.args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const stdout=[],stderr=[];let size=0,finished=false;
  const fail=error=>{if(finished)return;finished=true;child.kill();reject(error);};
  child.on('error',fail);child.stdin.on('error',fail);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>16000000)fail(new Error('MCP response is too large'));else stdout.push(chunk);});
  child.stderr.on('data',chunk=>{if(stderr.length<20)stderr.push(chunk);});
  child.on('close',code=>{if(finished)return;finished=true;resolve({code,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')});});
  child.stdin.end(request.input);
 });
}
export async function callTool(tool,args={}, {endpoint=DEFAULT_URL,transport=curlTransport}={}){
 const response=await transport(prepareRequest(tool,args,endpoint));
 if(response.code!==0){let safe='';try{const parsed=JSON.parse(response.stdout);safe=typeof parsed?.error==='string'?parsed.error:typeof parsed?.error?.message==='string'?parsed.error.message:'';}catch{}if(safe)throw new Error(`INNO request failed: ${safe.slice(0,500).replace(/[\u0000-\u001f\u007f]/g,' ')}`);throw new Error(`INNO HTTP request failed (curl ${response.code}). Verify the environment API credential and exact allowed host. ${response.stderr||''}`);}
 let body;try{body=JSON.parse(response.stdout);}catch{throw new Error('INNO did not return JSON');}
 if(body.error)throw new Error(body.error.message||'MCP protocol error');
 if(!body.result)throw new Error('MCP result is missing');
 if(body.result.isError)throw new Error(body.result.content?.filter(x=>x.type==='text'||!x.type).map(x=>x.text).join('\n')||'MCP tool failed');
 return body.result;
}
export async function readArguments(stream){
 const chunks=[];let size=0;
 for await(const chunk of stream){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>750000)throw new Error('Input exceeds 750000 bytes');chunks.push(bytes);}
 const raw=Buffer.concat(chunks).toString('utf8').trim();return raw?JSON.parse(raw):{};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const tool=process.argv[2];if(!tool)throw new Error('Usage: node scripts/inno-mcp.mjs TOOL < arguments.json; use --list for tool schemas');
  const argumentsObject=tool==='--list'?{}:await readArguments(process.stdin);
  const result=await callTool(tool,argumentsObject);process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}

