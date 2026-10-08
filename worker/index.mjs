import {assertRunAdmission} from '../public/core/task-size.mjs';
import {providerDisabledError,providerEnabled} from '../public/core/provider-settings.mjs';
import {assertProviderId,assertProviderTakes,providerManifest,providerTransport,providersByTransport} from '../public/core/providers.mjs';
import {sourceDelegationVersionFromEnvironment} from '../public/core/source-delegation-gate.mjs';
import {deliveryReceiptVersionFromEnvironment} from '../public/core/delivery-receipt-gate.mjs';
import {verifyMaterialViews} from '../public/core/source-coverage.mjs';
import {runRemoteClaim,settleRemoteChild} from './dispatch.mjs';
import {createRemoteAdapters} from './remote-adapters.mjs';
import {createPluginRegistry} from './plugins.mjs';
import {isRootMaster} from '../public/core/plugins.mjs';
import {authorizeExecution,scopedRead} from './execution-scope.mjs';
import {countContextRead,sweepContextReads,withContextReads} from './context-reads.mjs';
import {settleBoundedExecution,sweepBoundedSettlements} from './evaluation-settlement.mjs';
import {ModelCatalog} from './model-catalog.mjs';
import {OfficialModelDiscovery} from './model-discovery.mjs';
import {PluginDiscovery} from './plugin-discovery.mjs';
import {pluginEvidence} from '../public/core/plugin-evidence.mjs';
import {ROUTINE_PROVIDER,isRoutineAlias,routineModelRecommendation,sanitizeRoutineModelRecord} from '../public/core/routine-model.mjs';
import {Delegations} from './delegations.mjs';
import {createOrchestration} from './orchestration.mjs';
import {validateReviewReport} from '../public/core/delegation.mjs';
import {parseRevision} from '../public/core/sync.mjs';
import {RecordImporter} from './imports.mjs';
import {CloudBridge} from './bridge.mjs';
import { ConflictError, ValidationError, sanitizeMaterials } from '../public/core/tasks.mjs';
import { handleMcp } from '../server/mcp.mjs';
import { AUTO_ROUTING, D1TaskStore } from './store.mjs';
import {AUTO_PROVIDER,autoRouting,autoRoutingBlocker,chooseAutoProvider} from '../public/core/cloud-routing.mjs';
import {moveWaitingAutoTasks} from './cloud-routing.mjs';
import {CROSS_CHECK_LIMITS,crossCheckPrompt,crossCheckVerifier} from '../public/core/cross-check.mjs';
import {digestText} from '../public/core/create-requests.mjs';
import {createReviewObservationPipeline} from './review-observation-pipeline.mjs';
import {D1ModelPolicies} from './model-policies.mjs';
import {createTaskPolicyManagement} from './policy-management.mjs';
import {workspaceIdentity} from './workspace-identity.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
import {readDeliveryReceipt,readDeliveryRecord} from './delivery-receipts.mjs';
import {dischargeRefusedDelivery} from './delivery-discharge.mjs';
import {claimStatus,sweepClaimMarkers,withClaimNonce} from './claim-journal.mjs';
import {legacyDeliveryStatus} from './legacy-delivery.mjs';
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
    const catalog=new ModelCatalog(store),discovery=new OfficialModelDiscovery(store,{fetchFn}),pluginDiscovery=new PluginDiscovery(store,{fetchFn});
    const plugins=createPluginRegistry(store,{fetchFn}),adapterFor=createRemoteAdapters({fetchFn,env,sourceDelegationVersion,catalog,plugins,projects:{resolve:task=>store.projectForTask(task)}});
    // Desktop claims carry the verified text of the task's still-approved plugins.
    const hydrate=async claim=>{
      const hydrated=await orchestration.hydrateClaim(claim);
      if(!hydrated?.task)return hydrated;
      const task=hydrated.task,extra={};
      if(task.plugins?.length){const {offered,skipped}=await plugins.resolve(task);Object.assign(extra,{plugins:offered,pluginsSkipped:skipped});}
      // A root master may assign approved plugins to the children it delegates.
      if(isRootMaster(task)){const pluginCatalog=await plugins.approvedCatalog();if(pluginCatalog.length)extra.pluginCatalog=pluginCatalog;}
      // CR-008: the project's instructions travel with the execution.
      const project=await store.projectForTask(task);if(project)extra.project={id:project.id,name:project.name,instructions:project.instructions};
      return {...hydrated,...extra};
    };
    // State flags the UI reads for each cloud provider (manifest ui.availability).
    const remoteFlags=Object.fromEntries(providersByTransport('routine_fire').flatMap(id=>providerManifest(id).ui.availability.map(flag=>[flag,adapterFor(id).configured])));
    const reviewObservations=createReviewObservationPipeline(store),policyRetention=new D1ModelPolicies(store.db),policyManagement=createTaskPolicyManagement(store,catalog);
    const orchestration=createOrchestration({store,delegations:new Delegations(store,{sourceDelegationVersion,catalog,plugins}),adapterFor,waitUntil:context.waitUntil?promise=>context.waitUntil(promise):undefined});
    const handoff=async(input,options)=>{const task=await store.handoffExecution(input.taskId,input,options);return orchestration.dispatch(task.id);};
    const afterComplete=async task=>{
      const recovery=orchestration.reconcileTask(task.id).catch(()=>null);
      const observation=task.status==='completed'&&task.delegation?.state==='completed'?reviewObservations.process(task.id).catch(()=>null):Promise.resolve(null);
      // A bounded execution settles its reservation from the proof stored with this result.
      const settlement=task.evaluationBudget?settleBoundedExecution(store,task):Promise.resolve(null);
      if(context.waitUntil){context.waitUntil(recovery);context.waitUntil(observation);context.waitUntil(settlement);}else await Promise.all([recovery,observation,settlement]);
    };
    const delegate=async(taskId,input,options)=>orchestration.allocate(taskId,input,options);
    return {store,bridge,orchestration,hydrate,adapterFor,remoteFlags,plugins,handoff,afterComplete,catalog,discovery,pluginDiscovery,delegate,reviewObservations,policyRetention,policyManagement};
  }
  return {
    async scheduled(event,env,context={}) {
      const {store,orchestration,discovery,pluginDiscovery,reviewObservations,policyRetention,adapterFor}=runtime(env,context);
      // CR-003 MOD-02: an official-only, bounded daily refresh runs independently of orchestration.
      // CR-007 S4 (PLG-05): the allowed plugin catalogs are read on the same daily schedule.
      const refresh=Promise.all([discovery.refresh().catch(()=>null),pluginDiscovery.refresh().catch(()=>null)]);
      const drain=orchestration.drain();
      const observations=reviewObservations.drain().catch(()=>null);
      const retention=policyRetention.cleanupBatch().catch(()=>null);
      const reads=sweepContextReads(store.db,store.now());
      const settlements=sweepBoundedSettlements(store);
      // CR-010: auto tasks that waited past their time on the PC move once to the cloud.
      const autoMoves=moveWaitingAutoTasks({store,adapterFor,dispatch:id=>orchestration.dispatch(id)}).catch(()=>null);
      if(context.waitUntil){context.waitUntil(refresh);context.waitUntil(observations);context.waitUntil(retention);context.waitUntil(reads);context.waitUntil(settlements);context.waitUntil(autoMoves);return drain;}
      const [result]=await Promise.allSettled([drain,refresh,observations,retention,reads,settlements,autoMoves]);
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
        const {store,bridge,orchestration,hydrate,adapterFor,remoteFlags,plugins,handoff,afterComplete,catalog,discovery,pluginDiscovery,delegate,reviewObservations,policyRetention,policyManagement}=runtime(env,context);
        // Starts one run of a task on a named provider (a desktop queue entry or a cloud fire);
        // routing is the server-built auto record, or null to clear an earlier one (CR-010).
        const startRun=async(taskId,input,routing)=>{
          assertProviderId(input.provider);
          const materials = sanitizeMaterials(input.materials);
          const transport=providerTransport(input.provider);
          // H9-2: a run starts only while its result is sure to fit in the task.
          const requested=await store.requireTask(taskId);
          assertRunAdmission(requested);
          assertProviderTakes(input.provider,requested);
          if(!providerEnabled(await store.providerSettings(),input.provider))throw providerDisabledError(input.expectedVersion);
          if(transport==='routine_fire'){
            const task=await store.requireTask(taskId);
            if((task.parentTaskId||task.delegation?.state==='queued_for_review')&&materials.length&&(sourceDelegationVersion!==1||!task.attachments?.length))throw new ValidationError('Declared source delegation is not enabled for this execution');
            await verifyMaterialViews(task,materials);
          }
          if (transport === 'desktop_bridge') return {status:202,body:{task:await bridge.enqueue(taskId,{...input,materials},{routing})}};
          const remote=adapterFor(input.provider),unavailable=remote?.unavailableReason??'Remote provider is not configured.';
          if (!remote?.configured) {
            const task = await store.markWaiting(taskId, {expectedVersion: input.expectedVersion, provider: input.provider, reason: unavailable});
            return {status:503,body:{error: unavailable, task}};
          }
          const claim = await store.claimExecution(taskId, {provider: input.provider, expectedVersion: input.expectedVersion,sourceBound:materials.length>0,[AUTO_ROUTING]:routing});
          const execution=runRemoteClaim({store,claim,launch:owner=>remote.launch(owner,{materials})}).then(()=>settleRemoteChild(store,claim,orchestration.reconcileTask));
          if(context.waitUntil)context.waitUntil(execution);else await execution;
          return {status:202,body:{task: claim.task}};
        };
        const capabilities = {desktopDeliveryRecovery:deliveryReceiptVersion===1,sourceDelegationVersion:sourceDelegationVersion===1?1:0,modelPolicyManagement:true,modelDiagnostics:true,reviewObservationRecovery:true,cloudCodex: true, localCodex: false, ...remoteFlags, cloud: true, connected: true, pluginRegistry: true, projects: true};
        const bridgeMatch=pathname.match(/^\/api\/desktop\/([^/]+)\/(start|renew|complete|fail|ack|reservations|discard|legacy-status)$/);
        const recoveryRoute=bridgeMatch&&['reservations','discard','legacy-status'].includes(bridgeMatch[2]);
        const receiptHeader=request.headers.get('x-inno-delivery-receipt-version');
        const receiptRequested=request.headers.has('x-inno-delivery-receipt-version');
        const claimStatusRoute=pathname==='/api/desktop/claim-status';
        if(receiptRequested&&(deliveryReceiptVersion!==1||receiptHeader!=='1'||request.method!=='POST'||(pathname!=='/api/desktop/poll'&&!claimStatusRoute&&(!bridgeMatch||!['start','complete','fail','ack','reservations','discard','legacy-status'].includes(bridgeMatch[2])))))
          throw new ValidationError('Desktop delivery receipt version is not enabled for this route');
        if(receiptRequested&&!request.headers.has('x-inno-workspace-id'))throw new ValidationError('Workspace identity is required for desktop delivery receipt');
        if((bridgeMatch?.[2]==='ack'||recoveryRoute||claimStatusRoute)&&!receiptRequested)throw new ValidationError('Desktop delivery acknowledgment requires version 1');
        const claimOptions=receiptRequested?{deliveryReceiptVersion:1,workspaceId:request.headers.get('x-inno-workspace-id')}:undefined;
        const claimConfirmation=receiptRequested?{deliveryReceiptVersion:1}:{};
        const desktopMutation=request.method==='POST'&&(pathname==='/api/desktop/poll'||claimStatusRoute||Boolean(bridgeMatch));
        const desktopWorkspaceId=desktopMutation?(recoveryRoute?(await store.db.prepare("SELECT value FROM metadata WHERE key='desktop_workspace_id'").first())?.value:await workspaceIdentity(store.db)):undefined;
        if(recoveryRoute&&(typeof desktopWorkspaceId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(desktopWorkspaceId)))throw new ConflictError('Workspace identity is missing or invalid');
        if(desktopMutation&&request.headers.has('x-inno-workspace-id')&&request.headers.get('x-inno-workspace-id')!==desktopWorkspaceId)
          throw new ConflictError('Workspace identity mismatch');

        if (request.method === 'GET' && pathname === '/api/desktop/identity') {
          return responseJson({workspaceId:await workspaceIdentity(store.db)},200,headers);
        }

        if (request.method === 'GET' && pathname === '/api/state') {
          const providerSettings=await store.providerSettings(),desktop=await bridge.presence();
          // CR-006 S2: a desktop provider without a fixed flag is available once its runner was reported.
          const reported=desktop.providers?[...desktop.providers.ready,...Object.keys(desktop.providers.notReady)]:[];
          const desktopFlags=Object.fromEntries(reported.flatMap(id=>providerManifest(id).ui.availability.filter(flag=>capabilities[flag]===undefined).map(flag=>[flag,true])));
          return responseJson({...await store.getState({...capabilities,...desktopFlags,disabledProviders:providerSettings.disabled,providerSettingsVersion:providerSettings.version},parseRevision(url.searchParams.get('since')),{delta:url.searchParams.get('delta')==='1'}), desktop}, 200, headers);
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
        if (request.method === 'GET' && pathname === '/api/plugins') return responseJson({plugins: await plugins.list()}, 200, headers);
        // CR-007 S4: per-plugin evidence from normal work (with removed plugins' kept evidence),
        // and recommendation candidates from the allowed catalogs. Neither changes anything.
        if (request.method === 'GET' && pathname === '/api/plugin-evidence') return responseJson({plugins: pluginEvidence({plugins: await plugins.list(), tasks: await store.listTasks(), now: Date.parse(store.now())}), archive: await plugins.archive()}, 200, headers);
        if (request.method === 'GET' && pathname === '/api/plugin-recommendations') return responseJson(await pluginDiscovery.read(new Set((await plugins.list()).map(plugin => plugin.id))), 200, headers);
        const pluginMatch = pathname.match(/^\/api\/plugins\/(import|approve|disable|remove)$/);
        if (request.method === 'POST' && pluginMatch) return responseJson(await plugins[pluginMatch[1]](await body(request)), 200, headers);
        const pluginSelectionMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/plugins$/);
        if (request.method === 'POST' && pluginSelectionMatch) return responseJson(await plugins.select(decodeURIComponent(pluginSelectionMatch[1]), await body(request)), 200, headers);
        if (request.method === 'POST' && pathname === '/mcp') {
          const message=await body(request),scope=await authorizeExecution(store,env.ACCESS_TOKEN,message),owner=scope?.scope;
          const reply=await handleMcp(owner?withContextReads(store,owner):store,message,{sourceDelegationVersion,handoff,models:()=>catalog.read(),listTasks:()=>scope?[scope.task]:[],readTask:id=>scopedRead(store,scope,id),delegate:args=>delegate(args.taskId,args),retryReview:args=>orchestration.retryReview(args.taskId,args),afterComplete});
          // Authorized read calls count (tool errors with 0 bytes); successful ones add their returned bytes.
          if(owner&&message.params?.name==='read_task_context'){
            const text=reply?.result&&reply.result.isError!==true?reply.result.content?.[0]?.text:'';
            await countContextRead(store.db,owner,typeof text==='string'?new TextEncoder().encode(text).byteLength:0,store.now());
          }
          return responseJson(reply, 200, headers);
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
        if(request.method==='POST'&&claimStatusRoute){
          const input=await body(request);
          return responseJson(await claimStatus(store.db,{nonce:input?.nonce,workspaceId:desktopWorkspaceId,now:store.now()}),200,headers);
        }
        if (request.method === 'POST' && pathname === '/api/desktop/poll') {
          const input=await body(request);await bridge.reportProviders(input);if(input.models!==undefined)await catalog.report(input.models);
          const options=withClaimNonce(claimOptions,input);if(options?.claimNonce)await sweepClaimMarkers(store.db,store.now());
          return responseJson({claim: await hydrate(await bridge.claim(options,input)),workspaceId:desktopWorkspaceId,...claimConfirmation,...(options?.claimNonce?{claimNonce:options.claimNonce}:{})}, 200, headers);
        }
        // CR-008: projects.
        if(request.method==='POST'&&pathname==='/api/projects')return responseJson({project:await store.createProject(await body(request))},200,headers);
        const projectMatch=pathname.match(/^\/api\/projects\/([^/]+)$/);
        if(request.method==='POST'&&projectMatch)return responseJson(await store.changeProject(decodeURIComponent(projectMatch[1]),await body(request)),200,headers);
        if(request.method==='POST'&&pathname==='/api/providers/settings')return responseJson({settings:await store.updateProviderSettings(await body(request))},200,headers);
        // PRV-05: Routine model recommendation, change requests, and the recorded model.
        if(pathname==='/api/routine-model'&&request.method==='GET'){
          const state=await store.routineModelState(),now=Date.parse(store.now());
          return responseJson({...state,recommendation:routineModelRecommendation({record:state.record,discovery:await discovery.read(),tasks:await store.listTasks(),now})},200,headers);
        }
        if(request.method==='POST'&&pathname==='/api/routine-model/record'){
          const input=await body(request);let record;
          try{record=sanitizeRoutineModelRecord(input,Date.parse(store.now()));}catch(error){throw new ValidationError(error.message);}
          return responseJson(await store.recordRoutineModel(record,typeof input?.appliedRequestId==='string'?input.appliedRequestId:null),200,headers);
        }
        if(request.method==='POST'&&pathname==='/api/routine-model/request'){
          const input=await body(request),alias=input?.alias,official=await discovery.read();
          const candidate=isRoutineAlias(alias)?(official.candidates??[]).find(c=>c.provider===ROUTINE_PROVIDER&&c.id===alias):null;
          if(!candidate)throw new ValidationError('Only a Claude alias from the official model documentation can be requested');
          if((official.sources??[]).find(s=>s.provider===ROUTINE_PROVIDER)?.status!=='fresh')throw new ConflictError('The official model documentation is out of date; try again after it is checked');
          return responseJson(await store.requestRoutineModel({id:crypto.randomUUID(),alias,target:candidate.documentedTarget??null,status:'pending',requestedAt:Date.parse(store.now())}),200,headers);
        }
        if(request.method==='POST'&&pathname==='/api/routine-model/request/withdraw'){
          const input=await body(request);
          return responseJson(await store.withdrawRoutineModelRequest(Date.parse(store.now()),typeof input?.id==='string'?input.id:null),200,headers);
        }
        if(request.method==='POST'&&pathname==='/api/desktop/presence')return responseJson({desktop:await bridge.reportNotReady(await body(request))},200,headers);
        if(request.method==='POST'&&bridgeMatch){
          const id=decodeURIComponent(bridgeMatch[1]), input=await body(request);
          if(bridgeMatch[2]==='legacy-status')return responseJson(await legacyDeliveryStatus(store,id,input),200,headers);
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
          const settled=(record,replayed)=>responseJson({deliveryReceipt:record.receipt,replayed,...(record.discarded?{discarded:true}:{})},200,headers);
          if(deliveryReceipt){
            const saved=await readDeliveryRecord(store.db,deliveryReceipt);
            if(saved)return settled(saved,true);
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
           if(bridgeMatch[2]==='start'){
             const options=withClaimNonce(claimOptions,input);if(options?.claimNonce)await sweepClaimMarkers(store.db,store.now());
             return responseJson({claim:await hydrate(await bridge.start(id,input,options)),workspaceId:desktopWorkspaceId,...claimConfirmation,...(options?.claimNonce?{claimNonce:options.claimNonce}:{})},200,headers);
           }
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
                // A retry that cannot start its child (H9-2 growth limit) asks the person instead, so this result is still stored.
                if(!report.some(row=>row.criteria.some(c=>c.status==='unverifiable'))&&parent.delegation.retryCount<1){try{const result=await orchestration.retryReview(id,input,receiptOptions);return await accepted(result.parent);}catch(error){if(error?.code!=='TASK_BODY_LIMIT')throw error;}}
                const task=await store.requestDecision(id,{...input,prompt:'하위 결과의 검토 기준을 모두 확인하지 못했습니다. 근거를 확인하고 진행 방향을 선택해 주세요.',options:[{label:'검토 보완',pros:'검증이 부족한 기준을 보완합니다.',cons:'추가 작업이 필요합니다.'},{label:'요청 수정',pros:'목표 또는 기준을 다시 지정합니다.',cons:'기존 배정이 변경될 수 있습니다.'}]},receiptOptions);
                return await accepted(task);
              }
            }
           }
           // The receipt above binds the original body; only the stored plugin record is filtered.
           const reported=input.pluginDelivery===undefined?input:{...input,pluginDelivery:(await plugins.verifyReport(input.pluginDelivery))??undefined};
           const task=bridgeMatch[2]==='renew'?await bridge.renew(id,input):bridgeMatch[2]==='complete'?await bridge.complete(id,reported,receiptOptions):await bridge.fail(id,reported,receiptOptions);
           if(bridgeMatch[2]!=='renew')await afterComplete(task);
           return await accepted(task);
          }catch(error){
            if(deliveryReceipt){
              const saved=await readDeliveryRecord(store.db,deliveryReceipt);
              if(saved)return settled(saved,true);
              // A result its task can never accept is settled without applying it.
              if(error instanceof ConflictError||error instanceof ValidationError){
                const discharged=await dischargeRefusedDelivery(store,deliveryReceipt,store.now());
                if(discharged)return settled(discharged,false);
              }
            }
            throw error;
          }
        }
        const runMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
        if (request.method === 'POST' && runMatch) {
          const taskId = decodeURIComponent(runMatch[1]);
          const input = await body(request);
          if (!Number.isInteger(input.expectedVersion)) throw new ValidationError('expectedVersion is required');
          // CR-010: "auto" picks the runner here (PC first) and records why; an explicit choice clears the record.
          let routing=null;
          if(input.provider===AUTO_PROVIDER){
            const blocker=autoRoutingBlocker(await store.requireTask(taskId));
            if(blocker||(Array.isArray(input.materials)&&input.materials.length))throw new ValidationError(blocker??'원본 파일이 연결된 작업은 자동 배정을 쓸 수 없습니다. 이 PC 실행기를 고르세요.');
            const decision=chooseAutoProvider({desktop:await bridge.presence(),settings:await store.providerSettings(),cloudConfigured:Boolean(adapterFor(providersByTransport('routine_fire')[0])?.configured)});
            input.provider=decision.provider;routing=autoRouting(decision,store.now());
          }
          const started=await startRun(taskId,input,routing);
          return responseJson(started.body,started.status,headers);
        }
        // Differentiation ①: a person asks another company's model to verify a completed result.
        // The verification task is created once per result version (a fixed creation id), linked
        // to the result with a version-checked write, and run on the verifier's runner.
        const crossMatch=pathname.match(/^\/api\/tasks\/([^/]+)\/cross-check$/);
        if(request.method==='POST'&&crossMatch){
          const taskId=decodeURIComponent(crossMatch[1]),input=await body(request);
          if(!Number.isInteger(input.expectedVersion))throw new ValidationError('expectedVersion is required');
          const original=await store.requireTask(taskId);
          if(original.version!==input.expectedVersion)throw new ConflictError('The result changed; reload before cross-checking.',original.version);
          const settings=await store.providerSettings();
          // The first desktop runner may wait in the queue for the PC; another one counts only once
          // this PC reports it ready, so a verification never waits for a runner that is not there.
          const desktop=await bridge.presence(),firstDesktop=providersByTransport('desktop_bridge')[0];
          const choice=crossCheckVerifier(original,{available:id=>providerTransport(id)==='desktop_bridge'?id===firstDesktop||Boolean(desktop.providers?.ready.includes(id)):Boolean(adapterFor(id)?.configured),disabled:settings.disabled});
          if(choice.blocked)throw new ValidationError(choice.blocked);
          const hex=await digestText(`cross-check:${original.id}:${original.version}`);
          const requestId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
          // A removed project is not carried over: the verification would otherwise fail to be created.
          const project=original.projectId?await store.projectForTask(original):null;
          const created=await store.createTask({requestId,prompt:crossCheckPrompt(original),title:`교차 검증: ${original.title}`,type:'verification',...(project?{projectId:original.projectId}:{})});
          const now=store.now();
          // The verification names its result first, so a link that fails later still leaves it identifiable.
          const verification=created.crossCheckOf?created:await store.replaceTask(created.id,created.version,current=>({...current,version:current.version+1,updatedAt:now,crossCheckOf:{taskId:original.id,version:original.version,provider:original.checkpoint.provider,executionId:original.checkpoint.executionId??null,generation:original.checkpoint.generation??null}}));
          await store.replaceTask(original.id,original.version,current=>({...current,version:current.version+1,updatedAt:now,crossChecks:[{taskId:created.id,provider:choice.provider,requestedAt:now},...(current.crossChecks??[])].slice(0,CROSS_CHECK_LIMITS.records)}));
          // Created and linked: a run that could not start leaves the task ready for the person to run.
          let started=null,startError=null;
          try{started=await startRun(verification.id,{provider:choice.provider,expectedVersion:verification.version},null);}
          catch(error){startError={code:error?.code??null,message:error?.statusCode&&error.statusCode<500?String(error.message).slice(0,300):'검증 작업을 시작하지 못했습니다.'};console.warn('INNO: cross-check verification not started:',error?.message??error);}
          return responseJson({task:await store.requireTask(original.id),crossCheck:started?.body?.task??await store.requireTask(verification.id),...(startError?{startError}:{})},202,headers);
        }
        if (env.ASSETS && request.method === 'GET') return env.ASSETS.fetch(request);
        return responseJson({error: 'not found'}, 404, headers);
      } catch (error) {
        const status = error?.statusCode ?? 500;
        const result = {error: status === 500 ? 'internal server error' : error.message};
        if(['DESKTOP_DELIVERY_CAPACITY','ROUTINE_SIBLING_BUSY','TASK_BODY_LIMIT','PROVIDER_DISABLED'].includes(error?.code))result.code=error.code;
        if (error instanceof ConflictError && Number.isInteger(error.currentVersion)) result.currentVersion = error.currentVersion;
        return responseJson(result, status, headers);
      }
    },
  };
}

// One Worker per gate combination, chosen from exact environment opt-ins.
const configuredWorkers = new Map();
const configuredWorker = env => {
  const sourceDelegationVersion = sourceDelegationVersionFromEnvironment(env), deliveryReceiptVersion = deliveryReceiptVersionFromEnvironment(env);
  const key = `${sourceDelegationVersion}:${deliveryReceiptVersion}`;
  if (!configuredWorkers.has(key)) configuredWorkers.set(key, createWorker({sourceDelegationVersion, deliveryReceiptVersion}));
  return configuredWorkers.get(key);
};

export default {
  fetch(request, env, context) { return configuredWorker(env).fetch(request, env, context); },
  scheduled(event, env, context) { return configuredWorker(env).scheduled(event, env, context); },
};
