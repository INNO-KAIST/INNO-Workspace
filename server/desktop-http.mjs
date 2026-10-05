import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {checkedDeliveryBinding,deliveryBindingConflict} from './delivery-binding.mjs';
import {usesTransport} from '../public/core/providers.mjs';
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
async function body(req,maxBytes=750000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Object.assign(Error('Request exceeds supported byte limit'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}}
export function createDesktopServer({token,publicDir,request,bridge,localRecords,runStorage,readDeliveryBinding,deliveryReceiptVersion=0,outboxRecovery,contextAccess}){
 if(typeof token!=='string'||token.length<24)throw Error('A strong local token is required');
 const localRecoveryEnabled=deliveryReceiptVersion===1&&typeof outboxRecovery?.inspect==='function'&&typeof outboxRecovery?.promote==='function';
 const localDrainEnabled=localRecoveryEnabled&&typeof outboxRecovery?.readPending==='function'&&typeof bridge?.drainPending==='function';
 const localLegacyEnabled=localRecoveryEnabled&&typeof outboxRecovery?.readLegacy==='function'&&typeof outboxRecovery?.archiveLegacy==='function'&&typeof bridge?.legacyStatus==='function'&&typeof bridge?.deliverLegacy==='function';
 const legacyInput=(input,{confirm,refusal=false})=>{
  const keys=[...(confirm?['confirm']:[]),'pendingHash'];
  const given=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input).filter(key=>!(refusal&&key==='afterRefusal')).sort().join():'';
  if(!input||typeof input!=='object'||Array.isArray(input)||given!==keys.join()||typeof input.pendingHash!=='string'||!/^[0-9a-f]{64}$/.test(input.pendingHash)||confirm&&input.confirm!==true
   ||input.afterRefusal!==undefined&&input.afterRefusal!==true)
   throw Object.assign(Error('Invalid legacy recovery request'),{status:400});
  return input.pendingHash;
 };
 // Hashes of legacy results whose old-route delivery the Worker refused in this process.
 // Only then may a result still classified deliverable be archived, with an extra confirmation.
 const refusedLegacy=new Set();
 const legacyState=async record=>(await bridge.legacyStatus(record)).state;
 const root=path.resolve(publicDir instanceof URL?fileURLToPath(publicDir):publicDir);
 const server=createServer(async(req,res)=>{
  try{
   const port=server.address()?.port,hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
   if(!hosts.has(req.headers.host))return json(res,403,{error:'Invalid local host'});
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'Cross-origin access is not allowed'});
   const url=new URL(req.url,`http://${req.headers.host}`),p=url.pathname;
   // This exact read-only route uses an execution capability, never admin auth.
   if(p==='/api/desktop/context'){
    if(req.method!=='POST'||!contextAccess)return json(res,404,{error:'not found'});
    if(url.search||req.url!==p)return json(res,400,{error:'Invalid local context endpoint'});
    const authorization=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');
    if(!authorization)return json(res,401,{error:'Local context access is unavailable'});
    try{return json(res,200,await contextAccess.read(authorization[1],await body(req,4096)));}
    catch(error){
     const status=[400,401,409,413,429].includes(error?.statusCode??error?.status)?(error.statusCode??error.status):500;
     const versionConflict=error?.code==='CONTEXT_VERSION_CONFLICT'&&Number.isSafeInteger(error.currentVersion)&&error.currentVersion>0;
     return json(res,status,{error:'Local context read could not be completed',...(versionConflict?{code:'CONTEXT_VERSION_CONFLICT',currentVersion:error.currentVersion}:{})});
    }
   }
   if(p.startsWith('/api/')){
    const expected=Buffer.from('Bearer '+token),actual=Buffer.from(req.headers.authorization||'');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return json(res,401,{error:'unauthorized'});
    const localStatus=req.method==='GET'&&p==='/api/desktop/status';
    const localInspect=req.method==='GET'&&p==='/api/desktop/recovery';
    const localPromote=req.method==='POST'&&p==='/api/desktop/recovery/promote';
    const localDrain=req.method==='POST'&&p==='/api/desktop/recovery/drain';
    const legacyRoute=req.method==='POST'&&['/api/desktop/recovery/legacy-status','/api/desktop/recovery/legacy-deliver','/api/desktop/recovery/legacy-archive'].includes(p)?p.split('/').at(-1):null;
    if(localStatus||localInspect||localPromote||localDrain||legacyRoute){
     if(!localStatus&&!localRecoveryEnabled||localDrain&&!localDrainEnabled||legacyRoute&&!localLegacyEnabled)return json(res,404,{error:'not found'});
     try{
      if(localStatus)return json(res,200,{localDesktop:bridge.runtimeStatus(),outboxStatus:'not_inspected',capabilities:{desktopOutboxRecovery:localRecoveryEnabled,desktopOutboxDrain:localDrainEnabled,desktopLegacyRecovery:localLegacyEnabled}});
      if(legacyRoute==='legacy-status'){
       const pendingHash=legacyInput(await body(req),{confirm:false});
       const record=await bridge.recoveryInspect(()=>outboxRecovery.readLegacy(pendingHash));
       return json(res,200,{state:await legacyState(record),...(refusedLegacy.has(pendingHash)?{refused:true}:{})});
      }
      if(legacyRoute==='legacy-deliver'){
       const pendingHash=legacyInput(await body(req),{confirm:true});
       try{return json(res,200,await bridge.deliverLegacy({readLegacy:()=>outboxRecovery.readLegacy(pendingHash)}));}
       catch(error){if(error?.legacyRefused!==true)throw error;refusedLegacy.add(pendingHash);return json(res,200,{delivered:false,refused:true});}
      }
      if(legacyRoute==='legacy-archive'){
       const input=await body(req),pendingHash=legacyInput(input,{confirm:true,refusal:true}),afterRefusal=input.afterRefusal===true;
       // The Worker check runs inside the helper's exclusive lock, right before the move.
       return json(res,200,await outboxRecovery.archiveLegacy({pendingHash,confirm:true},{allowed:async record=>{
        const state=await legacyState(record);
        return state!=='deliverable'||afterRefusal&&refusedLegacy.has(pendingHash);
       }}));
      }
      if(localInspect){const recovery=await bridge.recoveryInspect(()=>outboxRecovery.inspect());return json(res,200,{recovery,localDesktop:bridge.runtimeStatus()});}
      if(localDrain){
       const input=await body(req);
       if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||!Object.hasOwn(input,'pendingHash')||!Object.hasOwn(input,'confirm')||input.confirm!==true||typeof input.pendingHash!=='string'||!/^[0-9a-f]{64}$/.test(input.pendingHash))throw Object.assign(Error('Invalid recovery confirmation'),{status:409});
       const pendingHash=input.pendingHash;
       const drained=await bridge.drainPending({readPending:()=>outboxRecovery.readPending(pendingHash)});
       if(drained!==true)throw Object.assign(Error('Saved delivery was not verified'),{status:409});
       return json(res,200,{drained:true});
      }
      // The helper owns recoveryMaintenance through withExclusive. Do not nest
      // locks or perform status/file I/O after its committed promotion.
      return json(res,200,await outboxRecovery.promote(await body(req)));
     }catch(error){return json(res,[400,409,413].includes(error?.status??error?.statusCode)?(error.status??error.statusCode):500,{error:'Local delivery recovery could not be completed. Review the local recovery status.'});}
    }
    if(req.method==='GET'&&p==='/api/state'){const state=await request(p+url.search),localDesktop=bridge.status();return json(res,200,{...state,capabilities:{...state.capabilities,desktopDeliveryRecovery:state.capabilities?.desktopDeliveryRecovery===true&&typeof readDeliveryBinding==='function',desktopSourceDelegationVersion:state.capabilities?.sourceDelegationVersion===1&&localDesktop.sourceDelegationVersion===1?1:0,desktopSources:true,localRecordImport:!!localRecords,runStorage:!!runStorage},localDesktop});}
    if(req.method==='GET'&&p==='/api/desktop/identity'){
     if(typeof readDeliveryBinding!=='function')throw deliveryBindingConflict('unverified');
     return json(res,200,{workspaceId:checkedDeliveryBinding(await readDeliveryBinding()).workspaceId});
    }
    const recovery=p.match(/^\/api\/desktop\/([^/]+)\/(reservations|discard)$/);
    if(req.method==='POST'&&recovery){
     if(typeof readDeliveryBinding!=='function'||req.headers['x-inno-delivery-receipt-version']!=='1'||typeof req.headers['x-inno-workspace-id']!=='string')throw deliveryBindingConflict('unverified');
     const expectedWorkspaceId=req.headers['x-inno-workspace-id'];
     const freshBinding=async original=>{
      const current=checkedDeliveryBinding(await readDeliveryBinding());
      if(current.workspaceId!==expectedWorkspaceId||original&&(current.origin!==original.origin||current.workspaceId!==original.workspaceId))throw deliveryBindingConflict();
      return current;
     };
     const initial=await freshBinding(),input=await body(req);
     if(recovery[2]==='discard'){
      if(input?.confirmDiscard!==true)throw Object.assign(Error('명시적인 폐기 확인이 필요합니다.'),{status:400});
      if(input?.reservation?.workspaceId!==expectedWorkspaceId||input?.reservation?.taskId!==decodeURIComponent(recovery[1]))throw deliveryBindingConflict();
      return json(res,200,await bridge.maintenance(async()=>{const binding=await freshBinding(initial);return request(p,input,{workspaceId:binding.workspaceId,deliveryReceiptVersion:1});}));
     }
     const binding=await freshBinding(initial);
     return json(res,200,await request(p,input,{workspaceId:binding.workspaceId,deliveryReceiptVersion:1}));
    }
    if(req.method==='GET'&&(p==='/api/model-discovery'||p==='/api/model-policy-retention'))return json(res,200,await request(p));
    if(runStorage&&req.method==='GET'&&p==='/api/run-storage'){const view=await bridge.maintenance(async()=>{const state=await request('/api/state');return runStorage.list(state.tasks);});return json(res,200,{...view,desktop:bridge.status()});}
    if(runStorage&&req.method==='POST'&&p==='/api/run-storage/remove'){const input=await body(req);if(input.confirm!==true)return json(res,400,{error:'삭제 확인이 필요합니다.'});const result=await bridge.maintenance(async()=>{const state=await request('/api/state');return runStorage.remove(input.runs,state.tasks);});return json(res,200,result);}
    if(localRecords&&req.method==='GET'&&p==='/api/local-records')return json(res,200,await localRecords.list(url.searchParams.get('cursor')||''));
    if(localRecords&&req.method==='POST'&&p==='/api/local-records/import'){
     const input=await body(req);const task=await localRecords.read(input.id,input.hash);
     return json(res,200,await request('/api/imports',{task,copy:input.copy??false}));
    }
    if(req.method==='POST'&&p==='/api/imports')return json(res,200,await request(p,await body(req)));
    const run=p.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if(req.method==='POST'&&run){const input=await body(req);if(usesTransport(input.provider,'desktop_bridge'))return json(res,202,{task:await bridge.startTask(decodeURIComponent(run[1]),input)});if(usesTransport(input.provider,'routine_fire'))return json(res,202,await request(p,input));return json(res,400,{error:'Invalid provider'});}
    if(req.method==='POST'&&/^\/api\/tasks\/[^/]+\/(?:delegation\/(?:resume|recover)|execution\/recover)$/.test(p))return json(res,200,await request(p,await body(req)));
    if(/^\/api\/tasks\/[^/]+\/model-policy$/.test(p)&&['GET','POST'].includes(req.method))return json(res,200,await request(p,req.method==='POST'?await body(req):undefined));
    if(req.method==='GET'&&p==='/api/plugins')return json(res,200,await request(p));
    if(req.method==='POST'&&(/^\/api\/plugins\/(?:import|approve|disable|remove)$/.test(p)||/^\/api\/tasks\/[^/]+\/plugins$/.test(p)))return json(res,200,await request(p,await body(req)));
    if(/^\/api\/tasks\/[^/]+\/review-observations$/.test(p)&&['GET','POST'].includes(req.method))return json(res,200,await request(p,req.method==='POST'?await body(req):undefined));
    if(req.method==='POST'&&(p==='/api/tasks'||/^\/api\/tasks\/[^/]+\/actions$/.test(p)))return json(res,p==='/api/tasks'?201:200,await request(p,await body(req)));
    return json(res,404,{error:'not found'});
   }
   if(req.method!=='GET')return json(res,404,{error:'not found'});
   const candidate=path.resolve(root,p==='/'?'index.html':decodeURIComponent(p).replace(/^\/+/,''));
   const realRoot=await realpath(root),file=await realpath(candidate);
   if(!file.startsWith(realRoot+path.sep)||!MIME[path.extname(file)])return json(res,404,{error:'not found'});
   if(!(await stat(file)).isFile())return json(res,404,{error:'not found'});
   res.writeHead(200,{'content-type':MIME[path.extname(file)],'cache-control':'no-cache','x-content-type-options':'nosniff'});const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch(e){if(res.headersSent){res.destroy();return;}json(res,e.status||e.statusCode||(e.name==='ValidationError'?400:e.code==='ENOENT'?404:500),{error:e.status===401?'Cloud authentication failed':e.message});}
 });
 server.requestTimeout=30000;server.headersTimeout=15000;return server;
}
