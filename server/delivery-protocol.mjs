import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
import {checkedDeliveryBinding} from './delivery-binding.mjs';
const fields=['version','id','workspaceId','taskId','executionId','generation','action','payloadDigest','acceptedAt'];
export const protocolError=()=>Object.assign(Error('Desktop delivery protocol could not be verified. Preserve saved delivery for recovery.'),{status:409,code:'DELIVERY_UNVERIFIED'});
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw protocolError();}
export function protocolBinding(value){exact(value,['origin','workspaceId']);const binding=checkedDeliveryBinding(value);if(binding.origin!==value.origin)throw protocolError();return binding;}
export async function checkedReceipt(value,binding,expected){
 exact(value,fields);const receipt=Object.fromEntries(fields.map(key=>[key,value[key]]));
 if(receipt.version!==1||receipt.workspaceId!==binding.workspaceId||typeof receipt.payloadDigest!=='string'||!/^[0-9a-f]{64}$/.test(receipt.payloadDigest)||typeof receipt.acceptedAt!=='string')throw protocolError();
 const time=Date.parse(receipt.acceptedAt);if(!Number.isFinite(time)||new Date(time).toISOString()!==receipt.acceptedAt)throw protocolError();
 const identity=await createDeliveryReceipt({workspaceId:receipt.workspaceId,taskId:receipt.taskId,action:receipt.action,input:{executionId:receipt.executionId,generation:receipt.generation}});
 if(identity.id!==receipt.id||expected&&Object.keys(expected).some(key=>receipt[key]!==expected[key]))throw protocolError();
 return receipt;
}
export async function checkedRecord(record){
 if(record?.version!==1)throw protocolError();
 const binding=protocolBinding(record.binding);
 if(record.phase==='pending'){
  exact(record,['version','phase','binding','taskId','action','input']);
  const descriptor=await createDeliveryReceipt({workspaceId:binding.workspaceId,taskId:record.taskId,action:record.action,input:record.input});
  return {binding,descriptor};
 }
 if(record.phase==='ack_pending'){
  exact(record,['version','phase','binding','receipt']);
  await checkedReceipt(record.receipt,binding);return {binding};
 }
 throw protocolError();
}
export function checkedClaim(response,binding,taskId){
 if(response?.deliveryReceiptVersion!==1||response.workspaceId!==binding.workspaceId)throw protocolError();
 const claim=response.claim;if(claim===null&&!taskId)return null;
 const task=claim?.task,checkpoint=task?.checkpoint;
 const id=value=>typeof value==='string'&&!!value.trim()&&value.length<=200;
 if(!id(task?.id)||taskId&&task.id!==taskId||!id(claim?.executionId)||!Number.isSafeInteger(claim?.generation)||claim.generation<1||task.status!=='running'||checkpoint?.status!=='running'||checkpoint.provider!=='codex'||checkpoint.deliveryReceiptVersion!==1||checkpoint.executionId!==claim.executionId||checkpoint.generation!==claim.generation)throw protocolError();
 return claim;
}
export async function checkedAck(response,record){
 const receipt=await checkedReceipt(response?.receipt,record.binding);
 if(typeof response.released!=='boolean'||fields.some(key=>receipt[key]!==record.receipt[key]))throw protocolError();
}
