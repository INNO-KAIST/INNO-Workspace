import {projectForTask} from './core/projects.mjs';

// CR-008 screen helpers. The sidebar filter is null (every task), NO_PROJECT (tasks outside any
// project, including those whose project was deleted) or a project id. A delegation child is
// filed with its parent, and counts cover top-level tasks only.
export const NO_PROJECT='none';

export function normalizeProjectFilter(filter,state){
 if(filter===NO_PROJECT)return filter;
 return typeof filter==='string'&&(state?.projects??[]).some(project=>project.id===filter)?filter:null;
}

export function taskInProjectFilter(task,state,filter){
 if(filter===null||filter===undefined)return true;
 const project=projectForTask(task,{projects:state?.projects??[],tasks:state?.tasks??[]});
 return filter===NO_PROJECT?!project:project?.id===filter;
}

export function projectListModel(state,filter){
 const projects=state?.projects??[],roots=(state?.tasks??[]).filter(task=>!task.parentTaskId);
 const count=key=>roots.filter(task=>taskInProjectFilter(task,state,key)).length;
 const rows=[{key:null,label:'모든 작업',count:roots.length,active:filter===null||filter===undefined}];
 for(const project of projects)rows.push({key:project.id,label:project.name,count:count(project.id),active:filter===project.id,project,hasInstructions:Boolean(project.instructions?.trim())});
 const outside=count(NO_PROJECT);
 if(projects.length&&outside)rows.push({key:NO_PROJECT,label:'프로젝트 없음',count:outside,active:filter===NO_PROJECT});
 return rows;
}

// The project new tasks are created in: the selected one, never "all" or "no project".
export function creationProject(state,filter){
 const key=normalizeProjectFilter(filter,state);
 return key&&key!==NO_PROJECT?(state.projects??[]).find(project=>project.id===key)??null:null;
}

// Sidebar rows built with DOM nodes only. onSelect(key) filters; onEdit(project) opens settings.
export function renderProjectList(root,rows,{onSelect,onEdit}={}){
 root.replaceChildren(...rows.map(row=>{
  const item=document.createElement('div');item.className='project-row'+(row.active?' active':'');
  const select=document.createElement('button');select.type='button';select.className='project-item';select.dataset.project=row.key??'';
  select.setAttribute('aria-pressed',String(row.active));
  const name=document.createElement('span');name.className='project-name';name.textContent=row.label;
  const count=document.createElement('small');count.textContent=String(row.count);
  select.append(name,count);select.onclick=()=>onSelect?.(row.key);
  item.append(select);
  if(row.project){
   const edit=document.createElement('button');edit.type='button';edit.className='project-edit';edit.textContent='⋯';
   edit.setAttribute('aria-label',`${row.label} 프로젝트 설정`);edit.onclick=()=>onEdit?.(row.project);
   item.append(edit);
  }
  return item;
 }));
}
