import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {resolveCodexCommand} from '../server/codex-command.mjs';

// H9: the ChatGPT/Codex app can rewrite %LOCALAPPDATA%\OpenAI\Codex\bin while the connector
// runs (observed 2026-10-06). The executable is resolved again for every spawn.
test('the newest existing codex.exe is chosen, and a removed one is never reused',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'inno-codex-bin-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bin=path.join(root,'OpenAI','Codex','bin');
 const install=(name,seconds)=>{const dir=path.join(bin,name);mkdirSync(dir,{recursive:true});const exe=path.join(dir,'codex.exe');writeFileSync(exe,'');utimesSync(exe,seconds,seconds);return exe;};
 const older=install('aaa',1000),newer=install('bbb',2000);
 mkdirSync(path.join(bin,'ccc'));writeFileSync(path.join(bin,'ccc','rg.exe'),'');
 assert.equal(resolveCodexCommand({platform:'win32',localAppData:root}),newer);
 rmSync(path.dirname(newer),{recursive:true,force:true});
 assert.equal(resolveCodexCommand({platform:'win32',localAppData:root}),older);
 rmSync(bin,{recursive:true,force:true});
 assert.equal(resolveCodexCommand({platform:'win32',localAppData:root}),'codex');
 assert.equal(resolveCodexCommand({platform:'linux',localAppData:root}),'codex');
});
