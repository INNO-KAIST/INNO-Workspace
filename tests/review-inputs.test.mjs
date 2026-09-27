import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewInputs} from '../worker/review-inputs.mjs';
const parent={id:'p',delegation:{batchId:'b',state:'reviewing',review:{children:[{taskId:'c',role:'writer',summary:'result',artifacts:[{artifactId:'a',name:'draft.txt',mime:'text/plain',encoding:'utf-8',bytes:3}]}]}}};
parent.delegation.review.children.push({...parent.delegation.review.children[0],taskId:'c2',artifacts:[]});
const child={id:'c',parentTaskId:'p',batchId:'b',status:'completed',artifacts:[{id:'a',name:'draft.txt',mime:'text/plain',encoding:'utf-8',content:'abc'}]};
test('review hydrates generated files without copying them into durable parent',async()=>{const before=JSON.stringify(parent);const result=await reviewInputs({requireTask:async id=>({...child,id})},parent);assert.equal(result[0].artifacts[0].content,'abc');assert.equal(JSON.stringify(parent),before);});
test('review refuses changed ownership, status, missing or modified artifacts',async()=>{for(const modified of [{...child,batchId:'old'},{...child,status:'running'},{...child,artifacts:[]},{...child,artifacts:[{...child.artifacts[0],content:'abcde'}]}])await assert.rejects(()=>reviewInputs({requireTask:async()=>modified},parent));});
