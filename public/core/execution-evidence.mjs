import {ValidationError} from './tasks.mjs';
import {providerHas} from './providers.mjs';

const cliEvidence = provider => providerHas(provider, 'executionEvidence', 'cli_arguments');

const MODEL=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const EFFORTS=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);

export function boundedExecutionEvidence(value){
 if(value==null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ValidationError('execution evidence is invalid');
 const model=(field)=>{
  if(value[field]===null)return null;
  if(typeof value[field]==='string'&&MODEL.test(value[field]))return value[field];
  throw new ValidationError(`execution evidence ${field} is invalid`);
 };
 const effort=(field)=>{
  if(value[field]===null)return null;
  if(EFFORTS.has(value[field]))return value[field];
  throw new ValidationError(`execution evidence ${field} is invalid`);
 };
 if(!cliEvidence(value.provider)||value.source!=='cli_arguments'||value.actualModelVersion!==null)throw new ValidationError('execution evidence provenance is invalid');
 const elapsed=value.processElapsedMs;
 if(elapsed!==null&&(!Number.isSafeInteger(elapsed)||elapsed<0))throw new ValidationError('execution evidence process time is invalid');
 return {provider:value.provider,source:'cli_arguments',requestedModel:model('requestedModel'),requestedEffort:effort('requestedEffort'),cliAppliedModel:model('cliAppliedModel'),cliAppliedEffort:effort('cliAppliedEffort'),actualModelVersion:null,processElapsedMs:elapsed};
}

export function validateOwnedExecutionEvidence(task,value){
 const evidence=boundedExecutionEvidence(value);
 if(!evidence)return null;
 if(!cliEvidence(task.checkpoint?.provider)||evidence.provider!==task.checkpoint.provider)throw new ValidationError('execution evidence provider does not match owner');
 const assignment=task.parentTaskId?task.assignment:null;
 const assignedModel=assignment?.requestedModel??null,assignedEffort=assignment?.effort??null;
 if(evidence.requestedModel!==assignedModel||evidence.requestedEffort!==assignedEffort)throw new ValidationError('execution evidence requested model does not match assignment');
 if(assignedModel!==null&&evidence.cliAppliedModel!==assignedModel)throw new ValidationError('execution evidence applied model does not match assignment');
 if(assignedEffort!==null&&evidence.cliAppliedEffort!==assignedEffort)throw new ValidationError('execution evidence applied effort does not match assignment');
 return evidence;
}

export function wallElapsedMs(claimedAt,completedAt){
 if(typeof claimedAt!=='string'||typeof completedAt!=='string')return null;
 const start=Date.parse(claimedAt),end=Date.parse(completedAt),duration=end-start;
 return Number.isSafeInteger(duration)&&duration>=0?duration:null;
}
