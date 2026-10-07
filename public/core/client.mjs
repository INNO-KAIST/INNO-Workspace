import {CreationRetries,creationId} from './create-requests.mjs';
import {sanitizeSourceView} from './source-coverage.mjs';
const attachmentKeys = ['id','name','path','size','lastModified','type','source','url'];
const taskKeys = ['id','title','prompt','type','status','version','createdAt','updatedAt','messages','plan','artifacts','checkpoint','decision','sessionUrl','error','provider','parentTaskId','batchId','parentEpoch','assignment','delegation','projectId'];
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k=>[k,value[k]]));
export function exportBundle(state) {
  return {format:'inno-workspace-v1',exportedAt:new Date().toISOString(),tasks:(state.tasks||[]).map(t=>({
    ...pick(t,taskKeys),attachments:(t.attachments||[]).map(a=>({...pick(a,attachmentKeys),...(a.view?{view:sanitizeSourceView(a.view,a)}:{})}))
  }))};
}
export function parseBundle(text) {
  const b=JSON.parse(text);
  if(b.format!=='inno-workspace-v1'||!Array.isArray(b.tasks)) throw new Error('INNO 작업 기록 형식이 아닙니다.');
  const ids=new Set();
  for(const t of b.tasks){
    if(!t||typeof t.id!=='string'||typeof t.title!=='string'||!Number.isInteger(t.version)||!Array.isArray(t.messages)||!Array.isArray(t.plan)||!Array.isArray(t.artifacts)||!Array.isArray(t.attachments)||ids.has(t.id)) throw new Error('작업 기록이 손상되었습니다.');
    if(t.evaluationBudget!==undefined||t.checkpoint?.evaluationBudget!==undefined)throw new Error('Server-owned evaluation budget cannot be imported');
    ids.add(t.id);
  }
  return exportBundle(b);
}
export function validateEndpoint(input) {
  if(!input.trim()) return '';
  const u=new URL(input);
  if(u.username||u.password) throw new Error('URL에 인증 정보를 넣을 수 없습니다.');
  if(u.protocol!=='https:' && !(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))) throw new Error('외부 연결에는 HTTPS 주소가 필요합니다.');
  if(u.search||u.hash) throw new Error('주소에는 쿼리나 해시를 포함하지 마세요.');
  return u.href.replace(/\/$/,'');
}
const blank=()=>({revision:0,tasks:[],usage:[],capabilities:{connected:false,localCodex:false,claudeRoutine:false,cloud:false}});
// H9-3: between full reads the page asks only for changed tasks. A full read every 10
// minutes, and on any count mismatch, repairs anything a delta could have missed.
const FULL_REFRESH_MS=10*60_000;
// The server's ORDER BY updated_at DESC, id ASC compares bytes, not locale order.
const binary=(x,y)=>x<y?-1:x>y?1:0;
const newestFirst=(a,b)=>binary(String(b.updatedAt??''),String(a.updatedAt??''))||binary(String(a.id),String(b.id));
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('inno-workspace',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function localRead(){const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('workspace');r.onsuccess=()=>{db.close();resolve(r.result||blank());};r.onerror=()=>{db.close();reject(r.error);};});}
async function localMutate(update){
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');let next,result,problem;
  const r=store.get('workspace');r.onsuccess=()=>{try{next={...blank(),...(r.result||{})};result=update(next);next.revision++;store.put({revision:next.revision,tasks:exportBundle(next).tasks},'workspace');}catch(error){problem=error;tx.abort();}};
  tx.oncomplete=()=>{db.close();resolve({state:next,result});};tx.onabort=tx.onerror=()=>{db.close();reject(problem||tx.error||new Error('작업 저장 실패'));};
 });
}

const deliveryWorkspace=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const deliveryConnectionError=()=>Object.assign(Error('작업실 연결을 확인한 뒤 다시 시도하세요. 연결이 변경된 요청은 진행하지 않습니다.'),{status:409});
export class WorkspaceClient {
  constructor({baseUrl='',token='',remote=false,retryStorage,now=()=>Date.now()}={}){this.baseUrl=validateEndpoint(baseUrl);this.token=token;this.remote=remote;this.now=now;this.lastFullSync=-Infinity;this.state=blank();this.lastSync=null;this.syncError=null;this.refreshSequence=0;this.appliedSequence=0;this.syncedRevision=undefined;this.creationRetries=new CreationRetries(this.baseUrl+'\n'+token,retryStorage);}
  async request(path,body,options={}){
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['workspaceId','deliveryReceiptVersion'].includes(key))||Object.keys(options).length&&(options.deliveryReceiptVersion!==1||!deliveryWorkspace(options.workspaceId)))throw deliveryConnectionError();
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
    try{
      const r=await fetch(this.baseUrl+path,{method:body===undefined?'GET':'POST',headers:{...(this.token?{Authorization:`Bearer ${this.token}`} :{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(options.deliveryReceiptVersion===1?{'x-inno-workspace-id':options.workspaceId,'x-inno-delivery-receipt-version':'1'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store',redirect:'error'});
      let d;try{d=await r.json();}catch{throw new Error('서버 응답을 읽을 수 없습니다. API 주소를 확인하세요.');}
      if(!r.ok){const e=new Error(d.error?.message||d.error||d.message||`요청 실패 (${r.status})`);e.status=r.status;if(typeof d.code==='string'&&/^[A-Z_]{1,64}$/.test(d.code))e.code=d.code;throw e;}
      return d;
    }finally{clearTimeout(timeout);}
  }
  async deliveryRecoveryRequest(id,action,input,expectedWorkspaceId,{isCurrent=()=>true}={}){
    const supported=()=>this.remote&&this.state.capabilities?.connected!==false&&this.state.capabilities?.desktopDeliveryRecovery===true;
    if(typeof isCurrent!=='function'||!isCurrent()||!supported()||typeof id!=='string'||!id.trim()||id.length>200||expectedWorkspaceId!==undefined&&!deliveryWorkspace(expectedWorkspaceId))throw deliveryConnectionError();
    const connection={baseUrl:this.baseUrl,token:this.token,remote:this.remote},saved=JSON.parse(JSON.stringify(input));
    const unchanged=()=>isCurrent()&&supported()&&Object.keys(connection).every(key=>this[key]===connection[key]);
    const identity=await this.request('/api/desktop/identity');
    if(!unchanged()||!deliveryWorkspace(identity?.workspaceId)||expectedWorkspaceId!==undefined&&identity.workspaceId!==expectedWorkspaceId)throw deliveryConnectionError();
    const result=await this.request(`/api/desktop/${encodeURIComponent(id)}/${action}`,saved,{workspaceId:identity.workspaceId,deliveryReceiptVersion:1});
    if(action==='reservations'&&!unchanged())throw deliveryConnectionError();
    return result;
  }
  async readDeliveryReservations(id,input,expectedWorkspaceId,options){return this.deliveryRecoveryRequest(id,'reservations',input,expectedWorkspaceId,options);}
  async discardDeliveryReservation(id,input,options){
    if(input?.confirmDiscard!==true||input?.reservation?.taskId!==id||!deliveryWorkspace(input?.reservation?.workspaceId))throw deliveryConnectionError();
    return this.deliveryRecoveryRequest(id,'discard',input,input.reservation.workspaceId,options);
  }
  async refresh(){
    if(!this.remote){this.state={...blank(),...await localRead()};return this.state;}
    const sequence=++this.refreshSequence,since=this.syncedRevision,delta=Number.isSafeInteger(since)&&this.now()-this.lastFullSync<FULL_REFRESH_MS;
    try{
      const s=await this.request('/api/state'+(Number.isSafeInteger(since)?'?since='+since+(delta?'&delta=1':''):''));
      if(sequence<this.appliedSequence||(Number.isSafeInteger(s.revision)&&s.revision<this.state.revision))return this.state;
      if(s.unchanged){
        if(since===undefined||s.revision!==since||this.state.revision!==since)throw Error('동기화 변경 번호가 일치하지 않습니다. 다시 연결하세요.');
        const {unchanged,...metadata}=s;this.state={...this.state,...metadata};
      }else if(s.delta===true){
        // Rows changed after s.since include every row changed after the state's revision, so
        // an overlapping answer still merges; a task never goes back to an older version.
        if(!delta||s.since!==since||s.since>this.state.revision||!Array.isArray(s.tasks)){this.syncedRevision=undefined;return this.refresh();}
        const byId=new Map(this.state.tasks.map(task=>[task.id,task]));
        for(const task of s.tasks){const existing=byId.get(task.id);if(!(existing?.version>task.version))byId.set(task.id,task);}
        const tasks=[...byId.values()],versionSum=tasks.reduce((sum,task)=>sum+(Number.isSafeInteger(task.version)?task.version:0),0);
        // Fewer tasks or a lower version sum than the server means a change was missed.
        if(tasks.length<s.taskCount||Number.isSafeInteger(s.versionSum)&&versionSum<s.versionSum){this.syncedRevision=undefined;return this.refresh();}
        const {delta:_delta,since:_since,taskCount:_count,versionSum:_sum,...metadata}=s;
        this.state={...this.state,...metadata,tasks:tasks.sort(newestFirst)};
      }else{this.state={...blank(),...s};this.lastFullSync=this.now();}
      this.syncedRevision=Number.isSafeInteger(s.revision)&&s.revision>=0?s.revision:undefined;
      this.appliedSequence=sequence;this.syncError=null;this.lastSync=Date.now();return this.state;
    }catch(error){
      if(sequence>=this.appliedSequence){this.syncError=error;this.lastSync=null;}
      throw error;
    }
  }
  async acceptWrite(task){
    // The write was acknowledged. A later read failure must not invite a duplicate write.
    this.appliedSequence=++this.refreshSequence;
    this.syncedRevision=undefined;
    this.lastSync=null;
    const existing=this.state.tasks.find(t=>t.id===task.id);
    if(!existing||task.version>=existing.version){
      this.state={...this.state,tasks:existing?this.state.tasks.map(t=>t.id===task.id?task:t):[task,...this.state.tasks]};
    }
    try{await this.refresh();}catch{/* syncError retains the failed read; the write still succeeded. */}
    return task;
  }
  async create(input){
    if(this.remote){
      creationId(input);
      const retry=input.requestId===undefined?await this.creationRetries.begin(input):null;
      let task;
      try{({task}=await this.request('/api/tasks',{...input,requestId:retry?.id??input.requestId}));}
      catch(error){if(retry&&[400,401,403,404,413,422].includes(error.status))this.creationRetries.finish(retry);throw error;}
      if(!task||typeof task.id!=='string'||!Number.isSafeInteger(task.version)||task.version<1)throw Error('작업 저장 확인 응답이 올바르지 않습니다. 같은 내용으로 다시 시도하세요.');
      if(retry)this.creationRetries.finish(retry);
      return this.acceptWrite(task);
    }
    const {createTask}=await import('./tasks.mjs');const task=createTask(input);const saved=await localMutate(state=>{state.tasks.unshift(task);return task;});this.state=saved.state;return saved.result;
  }
  async action(id,input){
    if(this.remote){const {task}=await this.request(`/api/tasks/${encodeURIComponent(id)}/actions`,input);return this.acceptWrite(task);}
    const {applyAction}=await import('./tasks.mjs');const saved=await localMutate(state=>{const index=state.tasks.findIndex(t=>t.id===id);if(index<0)throw new Error('작업을 찾을 수 없습니다.');const task=applyAction(state.tasks[index],input);state.tasks[index]=task;return task;});this.state=saved.state;return saved.result;
  }
  async run(id,input){if(!this.remote)throw new Error('AI 실행기를 연결하세요. 작업과 첨부 참조는 이 기기에 저장돼 있습니다.');return this.request(`/api/tasks/${encodeURIComponent(id)}/run`,input);}
  // Differentiation ①: another company's model verifies a completed result (cloud workspace only).
  async crossCheck(id,input){if(!this.remote)throw new Error('교차 검증은 클라우드 작업실에서 쓸 수 있습니다.');return this.request(`/api/tasks/${encodeURIComponent(id)}/cross-check`,input);}
  async resumeDelegation(id,expectedVersion){
    if(!this.remote)throw new Error('병렬 작업 재개에는 서버 연결이 필요합니다.');
    const {task}=await this.request(`/api/tasks/${encodeURIComponent(id)}/delegation/resume`,{expectedVersion});
    return task;
  }
  async recoverDelegationChild(id,input){
    if(!this.remote)throw new Error('하위 작업 복구에는 서버 연결이 필요합니다.');
    return this.request(`/api/tasks/${encodeURIComponent(id)}/delegation/recover`,input);
  }
  async retryReviewObservations(id,input){
    if(!this.remote)throw new Error('관측 기록 복구에는 서버 연결이 필요합니다.');
    return this.request(`/api/tasks/${encodeURIComponent(id)}/review-observations`,input);
  }
  async readModelPolicy(id){
    if(!this.remote)throw new Error('모델 정책을 보려면 서버 연결이 필요합니다.');
    return this.request(`/api/tasks/${encodeURIComponent(id)}/model-policy`);
  }
  async readModelDiscovery(){
    if(!this.remote)throw new Error('모델 발견 상태를 보려면 서버 연결이 필요합니다.');
    return this.request('/api/model-discovery');
  }
  async readModelPolicyRetention(){
    if(!this.remote)throw new Error('모델 정책 정리 상태를 보려면 서버 연결이 필요합니다.');
    return this.request('/api/model-policy-retention');
  }
  async changeModelPolicy(id,input){
    if(!this.remote)throw new Error('모델 정책을 바꾸려면 서버 연결이 필요합니다.');
    return this.request(`/api/tasks/${encodeURIComponent(id)}/model-policy`,input);
  }
  // CR-007 S3 plugin registry and per-task selection (cloud workspace only).
  async pluginRequest(path,body){
    if(!this.remote)throw new Error('플러그인을 관리하려면 서버 연결이 필요합니다.');
    return this.request(path,body);
  }
  listPlugins(){return this.pluginRequest('/api/plugins');}
  importPlugin(input){return this.pluginRequest('/api/plugins/import',input);}
  approvePlugin(id,contentHash){return this.pluginRequest('/api/plugins/approve',{id,contentHash});}
  disablePlugin(id){return this.pluginRequest('/api/plugins/disable',{id});}
  removePlugin(id){return this.pluginRequest('/api/plugins/remove',{id,confirm:true});}
  async selectTaskPlugins(id,expectedVersion,plugins){const result=await this.pluginRequest(`/api/tasks/${encodeURIComponent(id)}/plugins`,{expectedVersion,plugins});return result?.task?this.acceptWrite(result.task):result;}
  async recoverExecution(id,input){
    if(!this.remote)throw new Error('실행 복구에는 서버 연결이 필요합니다.');
    const {task}=await this.request(`/api/tasks/${encodeURIComponent(id)}/execution/recover`,input);
    return task;
  }
  async restore(text){if(this.remote)throw new Error('기록 가져오기는 이 기기 보관 모드에서 지원합니다.');const b=parseBundle(text);const saved=await localMutate(state=>{const ids=new Set(state.tasks.map(t=>t.id));let n=0;for(const t of b.tasks)if(!ids.has(t.id)){state.tasks.push(t);ids.add(t.id);n++;}return n;});this.state=saved.state;return saved.result;}
}
