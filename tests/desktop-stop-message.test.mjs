import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliveryStopMessage} from '../server/bridge-runtime.mjs';
const pending='.inno/desktop-pending.json';
const error=(props,message='raw')=>Object.assign(Error(message),props);

test('an unfinished legacy outbox write names both preserved files',()=>{
 const text=deliveryStopMessage(error({status:409,code:'OUTBOX_RECOVERY_REQUIRED'}),{pendingPath:pending,versioned:false});
 assert.match(text,/\.inno\/desktop-pending\.json\.tmp/);assert.match(text,/\.inno\/desktop-pending\.json\b/);assert.match(text,/keep both files/i);assert.doesNotMatch(text,/delete them until/i);
});

test('versioned recovery points to the local recovery page instead of files',()=>{
 const text=deliveryStopMessage(error({status:409,code:'OUTBOX_RECOVERY_REQUIRED'}),{pendingPath:pending,versioned:true});
 assert.match(text,/recovery/i);assert.match(text,/DESKTOP-ACCESS\.md/);
});

test('a rejected legacy replay keeps the actionable pending-file hint',()=>{
 assert.equal(deliveryStopMessage(error({status:409}),{pendingPath:pending,versioned:false}),'Execution changed. Review .inno/desktop-pending.json before resuming.');
});

test('authentication, workspace and unsaved-result errors keep their specific text',()=>{
 assert.equal(deliveryStopMessage(error({status:401}),{pendingPath:pending}),'Cloud authentication failed.');
 assert.equal(deliveryStopMessage(error({code:'WORKSPACE_MISMATCH'},'Workspace changed.'),{pendingPath:pending}),'Workspace changed.');
 assert.equal(deliveryStopMessage(error({status:409,code:'OUTBOX_WRITE_FAILED'},'Not saved.'),{pendingPath:pending}),'Not saved.');
});

test('other interruptions include the cause without claiming a result was saved',()=>{
 const text=deliveryStopMessage(error({},'connect ECONNREFUSED'),{pendingPath:pending});
 assert.match(text,/ECONNREFUSED/);assert.match(text,/Any saved result is kept/);assert.doesNotMatch(text,/saved results are retained/);
 assert.match(deliveryStopMessage(undefined,{pendingPath:pending}),/unknown error/);
 assert.ok(deliveryStopMessage(error({},'x'.repeat(5000)),{pendingPath:pending}).length<400);
 assert.match(deliveryStopMessage(error({status:409}),{pendingPath:pending,versioned:true}),/Any saved result is kept/);
});
