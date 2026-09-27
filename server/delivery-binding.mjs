const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function deliveryBindingConflict(reason='mismatch'){
 return reason==='unverified'
  ? Object.assign(new Error('Saved result has no verified cloud workspace binding. Keep it for explicit recovery in the original workspace.'),{status:409,code:'WORKSPACE_UNVERIFIED'})
  : Object.assign(new Error('Saved result belongs to a different cloud workspace. Reconnect the original workspace before delivery.'),{status:409,code:'WORKSPACE_MISMATCH'});
}

export function normalizedCloudOrigin(value){
 if(typeof value!=='string'||value!==value.trim()||value.length>2048)throw deliveryBindingConflict('unverified');
 let url;try{url=new URL(value);}catch{throw deliveryBindingConflict('unverified');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw deliveryBindingConflict('unverified');
 return url.origin;
}

export function checkedDeliveryBinding(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.workspaceId!=='string'||!UUID_V4.test(value.workspaceId))throw deliveryBindingConflict('unverified');
 return {origin:normalizedCloudOrigin(value.origin),workspaceId:value.workspaceId};
}

export function createCloudRequest({endpoint,token,fetchFn=fetch}){
 const origin=normalizedCloudOrigin(endpoint);
 return async(route,body,{workspaceId}={})=>{
  if(workspaceId!==undefined&&(typeof workspaceId!=='string'||!UUID_V4.test(workspaceId)))throw deliveryBindingConflict();
  if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//'))throw deliveryBindingConflict();
  let target;try{target=new URL(route,origin);}catch{throw deliveryBindingConflict();}
  if(target.origin!==origin||target.username||target.password)throw deliveryBindingConflict();
  const raw=body===undefined?undefined:JSON.stringify(body);
  if(raw!==undefined&&Buffer.byteLength(raw)>700000)throw Object.assign(Error('Result saved locally; cloud transfer limit exceeded.'),{status:413});
  const response=await fetchFn(target,{
   method:raw===undefined?'GET':'POST',
   headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(workspaceId!==undefined?{'x-inno-workspace-id':workspaceId}:{})},
   body:raw,signal:AbortSignal.timeout(20000),redirect:'error',
  });
  if(!response.ok)throw Object.assign(Error(`INNO HTTP ${response.status}`),{status:response.status});
  return response.json();
 };
}
