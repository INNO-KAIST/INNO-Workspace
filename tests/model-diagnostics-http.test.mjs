import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopServer} from '../server/desktop-http.mjs';

test('desktop forwards only authenticated diagnostics GET requests',async t=>{
 const token='diagnostics-desktop-token-12345',calls=[];
 const server=createDesktopServer({token,publicDir:new URL('../public',import.meta.url),request:async path=>{calls.push(path);return path==='/api/model-discovery'?{sources:[],candidates:[]}:{status:'never_run',removed:0};},bridge:{status:()=>({})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const paths=['/api/model-discovery','/api/model-policy-retention'];
 for(const path of paths){
  assert.equal((await fetch(base+path)).status,401);
  const response=await fetch(base+path,{headers:{authorization:'Bearer '+token}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  await response.json();
  assert.equal((await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token}})).status,404);
 }
 assert.deepEqual(calls,paths);
});
