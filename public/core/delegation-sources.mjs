import {sanitizeAttachments,ValidationError} from './tasks.mjs';
export function validateDelegationSourceIds(value,{sourceDelegationVersion=0}={}){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>20||value.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(value).size!==value.length)throw new ValidationError('Invalid delegation sourceIds');
 if(value.length&&sourceDelegationVersion!==1)throw new ValidationError('Source delegation is not enabled');
 return [...value];
}
export function delegationAttachments(parent,sourceIds,options={}){
 const ids=validateDelegationSourceIds(sourceIds,options);
 if(options.sourceDelegationVersion!==1)return [];
 const raw=parent.attachments??[];
 if(raw.length>20||raw.some(a=>typeof a.id!=='string'||!a.id||a.id.length>200)||new Set(raw.map(a=>a.id)).size!==raw.length)throw new ValidationError('Invalid parent source references');
 const attachments=sanitizeAttachments(raw);
 if(attachments.some(a=>a.source==='url'))throw new ValidationError('URL source references are not supported for source delegation');
 if(new Set(attachments.map(a=>a.path||a.name)).size!==attachments.length)throw new ValidationError('Source paths must be distinct for delegation');
 const byId=new Map(attachments.map(a=>[a.id,a]));
 return ids.map(id=>{const a=byId.get(id);if(!a)throw new ValidationError('Unknown delegation sourceId');return a;});
}

export const SOURCE_DELEGATION_POLICY='For source-scoped delegation, each child may include sourceIds selected only from the provided parent reference IDs. Omitted sourceIds means no source access. Do not put original text, source excerpts or file contents into child instructions, summaries, checkpoints or artifacts merely to transfer them. The client reconnects and supplies selected originals transiently. Choose only necessary sources, keep child tasks independent, and expect source-dependent work to wait while no device can read its originals. Master review must re-read its required originals.';
export function sourceDelegationContext(task,options={}){
 if(options.sourceDelegationVersion!==1||!task.attachments?.length)return '';
 try{const sources=delegationAttachments(task,task.attachments.map(a=>a.id),options);return SOURCE_DELEGATION_POLICY+'\nSelectable parent source references (metadata only): '+JSON.stringify(sources);}catch{return '';}
}
