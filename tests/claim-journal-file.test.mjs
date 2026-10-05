import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,rmdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFileJournal} from '../server/claim-journal-file.mjs';

const tempRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.inno/tmp');
async function paths(t){
 await mkdir(tempRoot,{recursive:true});const dir=await mkdtemp(path.join(tempRoot,'claim-journal-file-'));const file=path.join(dir,'claim.json');
 t.after(async()=>{await rm(file,{force:true});await rm(file+'.tmp',{force:true});await rmdir(dir);});
 return file;
}

test('the journal keeps the last committed record and replaces it atomically',async t=>{
 const file=await paths(t),journal=createFileJournal(file);
 assert.equal(journal.read(),null);
 journal.write({version:1,phase:'requested',nonce:'a'});journal.write({version:1,phase:'owned',nonce:'a'});
 assert.deepEqual(journal.read(),{version:1,phase:'owned',nonce:'a'});
 assert.equal(existsSync(file+'.tmp'),false);
 journal.clear();assert.equal(journal.read(),null);assert.equal(existsSync(file),false);
});

test('an unfinished write is discarded because only committed records are a basis for recovery',async t=>{
 const file=await paths(t),journal=createFileJournal(file);
 journal.write({version:1,phase:'requested',nonce:'b'});
 await writeFile(file+'.tmp','{"version":1,"phase":"owned"');
 assert.deepEqual(journal.read(),{version:1,phase:'requested',nonce:'b'});
 assert.equal(existsSync(file+'.tmp'),false);
 await writeFile(file+'.tmp','partial');
 journal.write({version:1,phase:'owned',nonce:'b'});
 assert.equal(JSON.parse(await readFile(file,'utf8')).phase,'owned');
});

test('an unreadable committed journal is preserved and reported for explicit recovery',async t=>{
 const file=await paths(t),journal=createFileJournal(file);
 await writeFile(file,'[1,2]');
 assert.throws(()=>journal.read(),error=>error.code==='CLAIM_JOURNAL_INVALID'&&error.status===409);
 await writeFile(file,'{broken');
 assert.throws(()=>journal.read(),error=>error.code==='CLAIM_JOURNAL_INVALID');
 assert.equal(await readFile(file,'utf8'),'{broken');
});
