import {assertProviderId,providerManifest,providerTransport,providersByTransport} from '../public/core/providers.mjs';
import {sourceDelegationVersionFromEnvironment} from '../public/core/source-delegation-gate.mjs';
import {verifyMaterialViews} from '../public/core/source-coverage.mjs';
import {runRemoteClaim} from './dispatch.mjs';
import {createRemoteAdapters} from './remote-adapters.mjs';
import {authorizeExecution,scopedRead} from './execution-scope.mjs';
import {ModelCatalog} from './model-catalog.mjs';
import {OfficialModelDiscovery} from './model-discovery.mjs';
import {Delegations} from './delegations.mjs';
import {createOrchestration} from './orchestration.mjs';
import {validateReviewReport} from '../public/core/delegation.mjs';
import {parseRevision} from '../public/core/sync.mjs';
import {RecordImporter} from './imports.mjs';
import {CloudBridge} from './bridge.mjs';
import { ConflictError, ValidationError, sanitizeMaterials } from '../public/core/tasks.mjs';
import { handleMcp } from '../server/mcp.mjs';
import { D1TaskStore } from './store.mjs';
import {createReviewObservationPipeline} from './review-observation-pipeline.mjs';
import {D1ModelPolicies} from './model-policies.mjs';
import {createTaskPolicyManagement} from './policy-management.mjs';
import {workspaceIdentity} from './workspace-identity.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
import {readDeliveryReceipt} from './delivery-receipts.mjs';
import {releaseDeliveryReceipt} from './delivery-ack.mjs';
import {listDeliveryReservations,releaseDeliveryReservation} from './delivery-recovery.mjs';

function responseJson(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8', ...headers},
  });
}

function cors(request, env) {
  const origin = request.headers.get('origin');
  const allowed = new Set(String(env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
  return origin && allowed.has(origin)
    ? {'access-control-allow-origin': origin, vary: 'Origin'}
    : {};
}

function authorized(request, env) {
  const expected = env.ACCESS_TOKEN;
  const actual = request.headers.get('authorization');
  return typeof expected === 'string' && expected.length >= 24 && actual === `Bearer ${expected}`;
}

async function body(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 750_000) throw new ValidationError('request body is too large');
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('request body must be valid JSON');
  }
}

export function createWorker({fetchFn = fetch,sourceDelegationVersion=0,deliveryReceiptVersion=0} = {}) {
  function runtime(env,context={}){
    const store=new D1TaskStore(env.DB),bridge=new CloudBridge(store,{sourceDelegationVersion});
    const catalog=new ModelCatalog(store),discovery=new OfficialModelDiscovery(store,{fetchFn});
    const adapterFor=createRemoteAdapters({fetchFn,env,sourceDelegationVersion,catalog});
    // State flags the UI reads for each cloud provider (manifest ui.availability).
    const remoteFlags=Object.fromEntries(providersByTransport('routine_fire').flatMap(id=>providerManifest(id).ui.availability.map(flag=>[flag,adapterFor(id).configured])));
    const reviewObservations=createReviewObservationPipeline(store),policyRetention=new D1ModelPolicies(store.db),policyManagement=createTaskPolicyManagement(store,catalog);
    const orchestration=createOrchestration({store,delegations:new Delegations(store,{sourceDelegationVersion,catalog}),adapterFor,waitUntil:context.waitUntil?promise=>context.waitUntil(promise):undefined});
    const handoff=async(input,options)=>{const task=await store.handoffExecution(input.taskId,input,options);return orchestration.dispatch(task.id);};
    const afterComplete=async task=>{
      const recovery=orchestration.reconcileTask(task.id).catch(()=>null);
      const observation=task.status==='completed'&&task.delegation?.state==='completed'?reviewObservations.process(task.id).catch(()=>null):Promise.resolve(null);
      if(context.waitUntil){context.waitUntil(recovery);context.waitUntil(observation);}else await Promise.all([recovery,observation]);
    };
    const delegate=async(taskId,input,options)=>orchestration.allocate(taskId,input,options);
    return {store,bridge,orchestration,adapterFor,remoteFlags,handoff,afterComplete,catalog,discovery,delegate,reviewObservations,policyRetention,policyManagement};
  }
  return {
    async scheduled(event,env,context={}) {
      const {orchestration,discovery,reviewObservations,policyRetention}=runtime(env,context);
      // CR-003 MOD-02: an official-only, bounded daily refresh runs independently of orchestration.
      const refresh=discovery.refresh().catch(()=>null);
      const drain=orchestration.drain();
      const observations=reviewObservations.drain().catch(()=>null);
      const retention=policyRetention.cleanupBatch().catch(()=>null);
      if(context.waitUntil){context.waitUntil(refresh);context.waitUntil(observations);context.waitUntil(retention);return drain;}
      const [result]=await Promise.allSettled([drain,refresh,observations,retention]);
      if(result.status==='rejected')throw result.reason;
      return result.value;
    },
    async fetch(request, env, context = {}) {
      const headers = cors(request, env);
      try {
        const url = new URL(request.url);
        const pathname = url.pathname;
        if (request.method === 'OPTIONS') {
          if (!headers['access-control-allow-origin']) return responseJson({error: 'origin is not allowed'}, 403);
          return new Response(null, {status: 204, headers: {
            ...headers,
            'access-control-allow-headers': 'authorization, content-type, x-inno-workspace-id, x-inno-delivery-receipt-version',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-max-age': '600',
          }});
        }
        if (request.method === 'GET' && pathname === '/api/health') return responseJson({status: 'ok'}, 200, headers);
        if (pathname.startsWith('/api/') || pathname === '/mcp') {
          if (!authorized(request, env)) return responseJson({error: 'unauthorized'}, 401, {...headers, 'www-authenticate': 'Bearer'});
        }
        const {store,bridge,orchestration,adapterFor,remoteFlags,handoff,afterComplete,catalog,discovery,delegate,reviewObservations,policyRetention,policyManagement}=runtime(env,context);
        const capabilities = {desktopDeliveryRecovery:deliveryReceiptVersion===1,sourceDelegationVersion:sourceDelegationVersion===1?1:0,modelPolicyManagement:true,modelDiagnostics:true,reviewObservationRecovery:true,cloudCodex: true, localCodex: false, ...remoteFlags, cloud: true, connected: true};
        const bridgeMatch=pathname.match(/^\/api\/desktop\/([^/]+)\/(start|renew|complete|fail|ack|reservations|discard)$/);
        const recoveryRoute=bridgeMatch&&['reservations','discard'].includes(bridgeMatch[2]);
        const receiptHeader=request.headers.get('x-inno-delivery-receipt-version');
        const receiptRequested=request.headers.has('x-inno-delivery-receipt-version');
        if(receiptRequested&&(deliveryReceiptVersion!==1||receiptHeader!=='1'||request.method!=='POST'||(pathname!=='/api/desktop/poll'&&(!bridgeMatch||!['start','complete','fail','ack','reservations','discard'].includes(bridgeMatch[2])))))
          throw new ValidationError('Desktop delivery receipt version is not enabled for this route');
        if(receiptRequested&&!request.headers.has('x-inno-workspace-id'))throw new ValidationError('Workspace identity is required for desktop delivery receipt');
        if((bridgeMatch?.[2]==='ack'||recoveryRoute)&&!receiptRequested)throw new ValidationError('Desktop delivery acknowledgment requires version 1');
        const claimOptions=receiptRequested?{deliveryReceiptVersion:1,workspaceId:request.headers.get('x-inno-workspace-id')}:undefined;
        const claimConfirmation=receiptRequested?{deliveryReceiptVersion:1}:{};
        const desktopMutation=request.method==='POST'&&(pathname==='/api/desktop/poll'||Boolean(bridgeMatch));
        const desktopWorkspaceId=desktopMutation?(recoveryRoute?(await store.db.prepare("SELECT value FROM metadata WHERE key='desktop_workspace_id'").first())?.value:await workspaceIdentity(store.db)):undefined;
        if(recoveryRoute&&(typeof desktopWorkspaceId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(desktopWorkspaceId)))throw new ConflictError('Workspace identity is missing or invalid');
        if(desktopMutation&&request.headers.has('x-inno-workspace-id')&&request.headers.get('x-inno-workspace-id')!==desktopWorkspaceId)
          throw new ConflictError('Workspace identity mismatch');

        if (request.method === 'GET' && pathname === '/api/desktop/identity') {
          return responseJson({workspaceId:await workspaceIdentity(store.db)},200,headers);
        }

        if (request.method === 'GET' && pathname === '/api/state') {
          return responseJson({...await store.getState(capabilities,parseRevision(url.searchParams.get('since'))), desktop: await bridge.presence()}, 200, headers);
        }
        if (request.method === 'GET' && pathname === '/api/model-discovery') {
          // The common /api/* gate above already authenticates; keep this check explicit.
          if (!authorized(request, env)) return responseJson({error:'unauthorized'},401,{...headers,'www-authenticate':'Bearer'});
          return responseJson(await discovery.read(),200,headers);
        }
        if (request.method === 'GET' && pathname === '/api/model-policy-retention') {
          return responseJson(await policyRetention.retentionStatus(),200,headers);
        }
        const policyMatch=pathname.match(/^\/api\/tasks\/([^/]+)\/model-policy$/);
        if(policyMatch&&['GET','POST'].includes(request.method)){
          const taskId=decodeURIComponent(policyMatch[1]);
          return responseJson(request.method==='GET'?await policyManagement.read(taskId):await policyManagement.apply(taskId,await body(request)),200,headers);
        }
        const observationMatch=pathname.match(/^\/api\/tasks\/([^/]+)\/review-observations$/);
        if(request.method==='GET'&&observationMatch){
          const task=await store.requireTask(decodeURIComponent(observationMatch[1]));
          return responseJson({taskId:task.id,reviewObservation:task.reviewObservation??null},200,headers);
        }
        if(request.method==='POST'&&observationMatch){
          return responseJson(await reviewObservations.retryFailed(decodeURIComponent(observationMatch[1]),await body(request)),200,headers);
        }
        if (request.method === 'POST' && pathname === '/api/imports') {
          const input=await body(request);return responseJson(await new RecordImporter(store).import(input.task,{copy:input.copy??false}),200,headers);
        }
        if (request.method === 'POST' && pathname === '/api/tasks') {
          return responseJson({task: await store.createTask(await body(request))}, 201, headers);
        }
        if (request.method === 'POST' && pathname === '/mcp') {
          const message=await body(request),scope=await authorizeExecution(store,env.ACCESS_TOKEN,message);
          return responseJson(await handleMcp(store,message,{sourceDelegationVersion,handoff,models:()=>catalog.read(),listTasks:()=>scope?[scope.task]:[],readTask:id=>scopedRead(store,scope,id),delegate:args=>delegate(args.taskId,args),retryReview:args=>orchestration.retryReview(args.taskId,args),afterComplete}), 200, headers);
        }
        const executionRecoveryMatch=pathname.match(/^\/api\/tasks\/([^/]+)\/execution\/recover$/);
        if(request.method==='POST'&&executionRecoveryMatch){let task=await store.recoverRemoteExecution(decodeURIComponent(executionRecoveryMatch[1]),await body(request));if(task.status==='queued_for_review')task=await orchestration.dispatch(task.id);return responseJson({task},200,headers);}
        const recoveryMatch=pathname.match(/^\/api\/tasks\/([^/]+)\/delegation\/recover$/);
        if(request.method==='POST'&&recoveryMatch){const result=await orchestration.recoverChild(decodeURIComponent(recoveryMatch[1]),await body(request));return responseJson({task:result.parent},200,headers);}
        const resumeMatch=pathname.match(/^\/api\/tasks\/([^/]+)\/delegation\/resume$/);
        if(request.method==='POST'&&resumeMatch){const result=await orchestration.resume(decodeURIComponent(resumeMatch[1]),await body(request));return responseJson({task:result.parent},200,headers);}
        const actionMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/actions$/);
        if (request.method === 'POST' && actionMatch) {
          const task = await store.applyAction(decodeURIComponent(actionMatch[1]), await body(request));
          return responseJson({task}, 200, headers);
        }
        if (request.method === 'POST' && pathname === '/api/desktop/poll') {
          const input=await body(request);if(input.models!==undefined)await catalog.report(input.models);
          return responseJson({claim: await orchestration.hydrateClaim(await bridge.claim(claimOptions)),workspaceId:desktopWorkspaceId,...claimConfirmation}, 200, headers);
        }
        if(request.method==='POST'&&bridgeMatch){
          const id=decodeURIComponent(bridgeMatch[1]), input=await body(request);
          if(bridgeMatch[2]==='reservations')return responseJson(await listDeliveryReservations(store.db,id,input,desktopWorkspaceId),200,headers);
          if(bridgeMatch[2]==='discard'){
            if(input?.reservation?.taskId!==id)throw new ConflictError('Desktop reservation discard task mismatch');
            if(input.reservation.workspaceId!==desktopWorkspaceId)throw new ConflictError('Desktop reservation discard workspace mismatch');
            return responseJson(await releaseDeliveryReservation(store.db,input),200,headers);
          }
          if(bridgeMatch[2]==='ack'){
            if(input?.receipt?.taskId!==id)throw new ConflictError('Desktop delivery acknowledgment task mismatch');
            if(input.receipt.workspaceId!==desktopWorkspaceId)throw new ConflictError('Desktop delivery acknowledgment workspace mismatch');
            return responseJson(await releaseDeliveryReceipt(store.db,input.receipt),200,headers);
          }
          const deliveryReceipt=receiptRequested&&['complete','fail'].includes(bridgeMatch[2])?await createDeliveryReceipt({workspaceId:desktopWorkspaceId,taskId:id,action:bridgeMatch[2],input}):undefined;
          if(deliveryReceipt){
            const saved=await readDeliveryReceipt(store.db,deliveryReceipt);
            if(saved)return responseJson({deliveryReceipt:saved,replayed:true},200,headers);
          }
          const receiptOptions={deliveryReceipt};
          const accepted=async task=>{
            if(!deliveryReceipt)return responseJson({task},200,headers);
            const saved=await readDeliveryReceipt(store.db,deliveryReceipt);
            if(!saved)throw new ConflictError('Accepted desktop delivery receipt is missing');
            return responseJson({task,deliveryReceipt:saved,replayed:false},200,headers);
          };
          try{
           if(bridgeMatch[2]==='complete'&&input.resumeState!==undefined&&(input.handoff||input.delegation||
             (Array.isArray(input.reviewReport)&&input.reviewReport.some(row=>Array.isArray(row?.criteria)&&row.criteria.some(criterion=>criterion?.status!=='pass')))))
             throw new ValidationError('Resume state is not supported on handoff, delegation, or non-passing review transitions');
           if(input.models!==undefined)await catalog.report(input.models);
           if(bridgeMatch[2]==='start')return responseJson({claim:await orchestration.hydrateClaim(await bridge.start(id,input,claimOptions)),workspaceId:desktopWorkspaceId,...claimConfirmation},200,headers);
           if(bridgeMatch[2]==='complete'&&input.handoff)return await accepted(await handoff({...input,taskId:id},receiptOptions));
           if(bridgeMatch[2]==='complete'&&input.delegation){const result=await delegate(id,{...input.delegation,executionId:input.executionId,generation:input.generation,content:input.content,usage:input.usage},receiptOptions);return await accepted(result.parent);}
           if(bridgeMatch[2]==='complete'&&input.reviewReport){
            const parent=await store.requireTask(id);
            const replay=parent.delegation?.lastReviewRetry;
            if(replay?.executionId===input.executionId&&replay?.generation===input.generation&&!['superseded','cancelled'].includes(parent.delegation.state)){
              if(deliveryReceipt||parent.checkpoint?.deliveryReceiptVersion===1)throw new ConflictError('Delivery receipt replay requires stored verification',parent.version);
              if(input.resumeState!==undefined)throw new ValidationError('Resume state is not supported on non-completion review replay');
              return responseJson({task:parent},200,headers);
            }
            if(parent.status==='waiting_user'&&parent.checkpoint?.executionId===input.executionId&&parent.checkpoint?.generation===input.generation){
              if(deliveryReceipt||parent.checkpoint?.deliveryReceiptVersion===1)throw new ConflictError('Delivery receipt replay requires stored verification',parent.version);
              if(input.resumeState!==undefined)throw new ValidationError('Resume state is not supported on non-completion review replay');
              return responseJson({task:parent},200,headers);
            }
            if(parent.status==='running'&&parent.delegation?.state==='reviewing'){
              store.assertExecution(parent,input);
              const report=validateReviewReport(parent,input,{requirePass:false});
              if(report.some(row=>row.criteria.some(c=>c.status!=='pass'))){
                if(!report.some(row=>row.criteria.some(c=>c.status==='unverifiable'))&&parent.delegation.retryCount<1){const result=await orchestration.retryReview(id,input,receiptOptions);return await accepted(result.parent);}
                const task=await store.requestDecision(id,{...input,prompt:'하위 결과의 검토 기준을 모두 확인하지 못했습니다. 근거를 확인하고 진행 방향을 선택해 주세요.',options:[{label:'검토 보완',pros:'검증이 부족한 기준을 보완합니다.',cons:'추가 작업이 필요합니다.'},{label:'요청 수정',pros:'목표 또는 기준을 다시 지정합니다.',cons:'기존 배정이 변경될 수 있습니다.'}]},receiptOptions);
                return await accepted(task);
              }
            }
           }
           const task=bridgeMatch[2]==='renew'?await bridge.renew(id,input):bridgeMatch[2]==='complete'?await bridge.complete(id,input,receiptOptions):await bridge.fail(id,input,receiptOptions);
           if(bridgeMatch[2]!=='renew')await afterComplete(task);
           return await accepted(task);
          }catch(error){
            if(deliveryReceipt){
              const saved=await readDeliveryReceipt(store.db,deliveryReceipt);
              if(saved)return responseJson({deliveryReceipt:saved,replayed:true},200,headers);
            }
            throw error;
          }
        }
        const runMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
        if (request.method === 'POST' && runMatch) {
          const taskId = decodeURIComponent(runMatch[1]);
          const input = await body(request);
          assertProviderId(input.provider);
          if (!Number.isInteger(input.expectedVersion)) throw new ValidationError('expectedVersion is required');
          const materials = sanitizeMaterials(input.materials);
          const transport=providerTransport(input.provider);
          if(transport==='routine_fire'){
            const task=await store.requireTask(taskId);
            if((task.parentTaskId||task.delegation?.state==='queued_for_review')&&materials.length&&(sourceDelegationVersion!==1||!task.attachments?.length))throw new ValidationError('Declared source delegation is not enabled for this execution');
            await verifyMaterialViews(task,materials);
          }
          if (transport === 'desktop_bridge') return responseJson({task:await bridge.enqueue(taskId,{...input,materials})},202,headers);
          const remote=adapterFor(input.provider),unavailable=remote?.unavailableReason??'Remote provider is not configured.';
          if (!remote?.configured) {
            const task = await store.markWaiting(taskId, {expectedVersion: input.expectedVersion, provider: input.provider, reason: unavailable});
            return responseJson({error: unavailable, task}, 503, headers);
          }
          const claim = await store.claimExecution(taskId, {provider: input.provider, expectedVersion: input.expectedVersion,sourceBound:materials.length>0});
          const execution=runRemoteClaim({store,claim,launch:owner=>remote.launch(owner,{materials})});
          if(context.waitUntil)context.waitUntil(execution);else await execution;
          return responseJson({task: claim.task}, 202, headers);
        }
        if (env.ASSETS && request.method === 'GET') return env.ASSETS.fetch(request);
        return responseJson({error: 'not found'}, 404, headers);
      } catch (error) {
        const status = error?.statusCode ?? 500;
        const result = {error: status === 500 ? 'internal server error' : error.message};
        if(error?.code==='DESKTOP_DELIVERY_CAPACITY')result.code=error.code;
        if (error instanceof ConflictError && Number.isInteger(error.currentVersion)) result.currentVersion = error.currentVersion;
        return responseJson(result, status, headers);
      }
    },
  };
}

const defaultWorker = createWorker();
const sourceDelegationWorker = createWorker({sourceDelegationVersion: 1});
const configuredWorker = env => sourceDelegationVersionFromEnvironment(env) === 1 ? sourceDelegationWorker : defaultWorker;

export default {
  fetch(request, env, context) { return configuredWorker(env).fetch(request, env, context); },
  scheduled(event, env, context) { return configuredWorker(env).scheduled(event, env, context); },
};
