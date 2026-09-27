import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {createDeliveryReceipt} from '../public/core/delivery-receipt.mjs';
import {releaseDeliveryReceipt} from '../worker/delivery-ack.mjs';

const workspaceId='123e4567-e89b-42d3-a456-426614174000';
const acceptedAt='2026-09-28T00:00:00.000Z';
const input={executionId:'execution-1',generation:1,content:'saved result'};

async function fixture(t){
 const db=new TestD1();t.after(()=>db.close());
 await db.prepare("INSERT INTO metadata(key,value) VALUES('desktop_workspace_id',?1)").bind(workspaceId).run();
 const descriptor=await createDeliveryReceipt({workspaceId,taskId:'task-1',action:'complete',input});
 const receipt={...descriptor,acceptedAt};
 const key='desktop_receipt:'+receipt.id;
 const save=async value=>db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind(key,JSON.stringify(value)).run();
 const read=async()=>db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first();
 return {db,receipt,key,save,read};
}

test('matching ACK deletes only the receipt and is idempotent after response loss',async t=>{
 const {db,receipt,save,read}=await fixture(t);await save(receipt);
 assert.deepEqual(await releaseDeliveryReceipt(db,receipt),{receipt,released:true});
 assert.equal(await read(),null);
 assert.deepEqual(await releaseDeliveryReceipt(db,receipt),{receipt,released:false});
 assert.equal((await db.prepare("SELECT value FROM metadata WHERE key='revision'").first()).value,0);
});

test('missing receipt still rejects malformed descriptor or wrong workspace',async t=>{
 const {db,receipt}=await fixture(t);
 for(const bad of [{...receipt,id:'f'.repeat(64)},{...receipt,payloadDigest:'x'.repeat(64)},
  {...receipt,payloadDigest:{toString:()=>receipt.payloadDigest}},{...receipt,acceptedAt:'2026-09-28'},
  {...receipt,generation:0},{...receipt,extra:true},{...receipt,workspaceId:'123e4567-e89b-42d3-a456-426614174001'}]){
  await assert.rejects(()=>releaseDeliveryReceipt(db,bad),{statusCode:409});
 }
});

test('stored receipt with different digest or malformed JSON survives ACK',async t=>{
 const {db,receipt,key,save,read}=await fixture(t);
 await save({...receipt,payloadDigest:'f'.repeat(64)});
 await assert.rejects(()=>releaseDeliveryReceipt(db,receipt),{statusCode:409});
 assert.ok(await read());
 await db.prepare('UPDATE metadata SET value=?1 WHERE key=?2').bind('{broken',key).run();
 await assert.rejects(()=>releaseDeliveryReceipt(db,receipt),{statusCode:409});
 assert.equal((await read()).value,'{broken');
});

test('stored accepted time mismatch does not release the receipt',async t=>{
 const {db,receipt,save,read}=await fixture(t);
 await save({...receipt,acceptedAt:'2026-09-28T00:00:01.000Z'});
 await assert.rejects(()=>releaseDeliveryReceipt(db,receipt),{statusCode:409});
 assert.ok(await read());
});

test('a zero-row DELETE with the same receipt still present fails closed',async t=>{
 const {db,receipt,save,read}=await fixture(t);await save(receipt);
 db.db.exec("CREATE TRIGGER retain_receipt BEFORE DELETE ON metadata WHEN OLD.key LIKE 'desktop_receipt:%' BEGIN SELECT RAISE(IGNORE); END");
 await assert.rejects(()=>releaseDeliveryReceipt(db,receipt),{statusCode:409});
 assert.ok(await read());
});

test('workspace change before DELETE cannot release a receipt',async t=>{
 const {db,receipt,save,read}=await fixture(t);await save(receipt);
 const original=db.prepare.bind(db);let switched=false;
 db.prepare=sql=>{
  const prepared=original(sql);
  if(!sql.startsWith('DELETE FROM metadata'))return prepared;
  return {bind:(...values)=>({run:async()=>{
   if(!switched){switched=true;await original("UPDATE metadata SET value='123e4567-e89b-42d3-a456-426614174001' WHERE key='desktop_workspace_id'").run();}
   return prepared.bind(...values).run();
  }})};
 };
 await assert.rejects(()=>releaseDeliveryReceipt(db,receipt),{statusCode:409});
 assert.ok(await read());
});

test('concurrent matching ACK that removes the row is idempotent',async t=>{
 const {db,receipt,key,save,read}=await fixture(t);await save(receipt);
 const original=db.prepare.bind(db);let raced=false;
 db.prepare=sql=>{
  const prepared=original(sql);
  if(!sql.startsWith('DELETE FROM metadata'))return prepared;
  return {bind:(...values)=>({run:async()=>{
   if(!raced){raced=true;await original('DELETE FROM metadata WHERE key=?1').bind(key).run();}
   return prepared.bind(...values).run();
  }})};
 };
 assert.deepEqual(await releaseDeliveryReceipt(db,receipt),{receipt,released:false});
 assert.equal(await read(),null);
});

test('row changed after read is preserved as a conflict',async t=>{
 const {db,receipt,key,save,read}=await fixture(t);await save(receipt);
 const original=db.prepare.bind(db);let raced=false;
 db.prepare=sql=>{
  const prepared=original(sql);
  if(!sql.startsWith('DELETE FROM metadata'))return prepared;
  return {bind:(...values)=>({run:async()=>{
   if(!raced){raced=true;await original('UPDATE metadata SET value=?1 WHERE key=?2')
    .bind(JSON.stringify({...receipt,payloadDigest:'f'.repeat(64)}),key).run();}
   return prepared.bind(...values).run();
  }})};
 };
 await assert.rejects(()=>releaseDeliveryReceipt(db,receipt),{statusCode:409});
 assert.ok(await read());
});
