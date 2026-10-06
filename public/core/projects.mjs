import {ConflictError,ValidationError} from './tasks.mjs';

// CR-008: a project groups tasks and holds instructions that every execution of its tasks
// receives. A task names its project with projectId; a delegation child follows its parent.
// Deleting a project keeps its tasks: a projectId that names no project reads as no project.
export const PROJECT_LIMITS=Object.freeze({name:80,instructions:8000,count:100,id:200});

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function text(value,label,max,{required}){
 if(typeof value!=='string')throw new ValidationError(`${label} must be text`);
 const result=value.trim();
 if(required&&!result)throw new ValidationError(`${label} is required`);
 if(result.length>max)throw new ValidationError(`${label} is too long`);
 return result;
}

export function projectId(value){
 if(value===undefined||value===null)return null;
 return text(value,'project id',PROJECT_LIMITS.id,{required:true});
}

export function createProject(input,{now,id}){
 if(!object(input))throw new ValidationError('Invalid project');
 const at=now();
 return {id:id(),name:text(input.name,'project name',PROJECT_LIMITS.name,{required:true}),
  instructions:input.instructions===undefined?'':text(input.instructions,'project instructions',PROJECT_LIMITS.instructions,{required:false}),
  version:1,createdAt:at,updatedAt:at};
}

export function updateProject(current,input,{now}){
 if(!object(input))throw new ValidationError('Invalid project change');
 if(!Number.isInteger(input.expectedVersion)||input.expectedVersion!==current.version)throw new ConflictError('Project changed; reload and try again',current.version);
 return {...current,
  name:input.name===undefined?current.name:text(input.name,'project name',PROJECT_LIMITS.name,{required:true}),
  instructions:input.instructions===undefined?current.instructions:text(input.instructions,'project instructions',PROJECT_LIMITS.instructions,{required:false}),
  version:current.version+1,updatedAt:now()};
}

export function storedProject(value){
 try{
  const project=typeof value==='string'?JSON.parse(value):value;
  if(!object(project)||typeof project.id!=='string'||typeof project.name!=='string'||typeof project.instructions!=='string'||!Number.isSafeInteger(project.version))return null;
  return {id:project.id,name:project.name,instructions:project.instructions,version:project.version,createdAt:project.createdAt,updatedAt:project.updatedAt};
 }catch{return null;}
}

export function projectForTask(task,{projects=[],tasks=[]}={}){
 let id=task?.projectId;
 if(!id&&task?.parentTaskId)id=tasks.find(item=>item?.id===task.parentTaskId)?.projectId;
 return id?projects.find(project=>project.id===id)??null:null;
}

// The block every execution of a project's tasks receives. Without instructions there is no
// block, so a task outside any project, or in a project without instructions, keeps exactly
// the prompt it had before projects existed.
export function projectInstructionsBlock(project){
 const instructions=typeof project?.instructions==='string'?project.instructions.trim():'';
 if(!instructions)return '';
 return `Project ${JSON.stringify(String(project.name??''))} instructions (apply to every task in this project; the user request below takes precedence when they conflict):\n<project_instructions>\n${instructions}\n</project_instructions>`;
}
