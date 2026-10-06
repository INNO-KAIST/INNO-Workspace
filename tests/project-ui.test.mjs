import test from 'node:test';
import assert from 'node:assert/strict';
import {NO_PROJECT,normalizeProjectFilter,taskInProjectFilter,projectListModel,creationProject} from '../public/project-ui.mjs';

// CR-008 Unit 3: the sidebar lists every task, each project and the tasks outside any project;
// a child is filed with its parent, and new tasks go into the selected project only.
const state={
 projects:[{id:'p1',name:'논문',instructions:'한국어로',version:1},{id:'p2',name:'CV',instructions:'',version:1}],
 tasks:[
  {id:'a',projectId:'p1'},{id:'b',projectId:'p2'},{id:'c'},{id:'d',projectId:'deleted'},
  {id:'child',parentTaskId:'a'},
 ],
};

test('the filter keeps known projects and the no-project view, and drops anything else',()=>{
 assert.equal(normalizeProjectFilter('p1',state),'p1');
 assert.equal(normalizeProjectFilter(NO_PROJECT,state),NO_PROJECT);
 assert.equal(normalizeProjectFilter('deleted',state),null);
 assert.equal(normalizeProjectFilter(undefined,state),null);
});

test('a filter shows the project tasks with their children, and no-project includes deleted projects',()=>{
 const ids=filter=>state.tasks.filter(task=>taskInProjectFilter(task,state,filter)).map(task=>task.id);
 assert.deepEqual(ids(null),['a','b','c','d','child']);
 assert.deepEqual(ids('p1'),['a','child']);
 assert.deepEqual(ids(NO_PROJECT),['c','d']);
});

test('the list counts top-level tasks and marks the active row and instructions',()=>{
 const rows=projectListModel(state,'p1');
 assert.deepEqual(rows.map(row=>[row.key,row.label,row.count,row.active]),[[null,'모든 작업',4,false],['p1','논문',1,true],['p2','CV',1,false],[NO_PROJECT,'프로젝트 없음',2,false]]);
 assert.equal(rows[1].hasInstructions,true);assert.equal(rows[2].hasInstructions,false);
 assert.deepEqual(projectListModel({projects:[],tasks:[{id:'x'}]},null).map(row=>row.key),[null]);
});

test('new tasks go into the selected project only',()=>{
 assert.equal(creationProject(state,'p2')?.id,'p2');
 assert.equal(creationProject(state,null),null);
 assert.equal(creationProject(state,NO_PROJECT),null);
 assert.equal(creationProject(state,'deleted'),null);
});
