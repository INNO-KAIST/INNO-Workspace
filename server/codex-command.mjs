import {existsSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';

// The Codex CLI bundled with the ChatGPT/Codex desktop app lives in a versioned folder that
// the app can replace while INNO runs. Resolve the newest existing executable each time,
// falling back to the plain command name on PATH.
const COMMAND='codex';
export function resolveCodexCommand({platform=process.platform,localAppData=process.env.LOCALAPPDATA}={}){
 if(platform!=='win32'||!localAppData)return COMMAND;
 const binRoot=path.join(localAppData,'OpenAI','Codex','bin');
 try{
  if(!existsSync(binRoot))return COMMAND;
  const installed=readdirSync(binRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory())
   .map(entry=>path.join(binRoot,entry.name,COMMAND+'.exe')).filter(existsSync)
   .map(file=>({file,mtime:statSync(file).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
  return installed[0]?.file??COMMAND;
 }catch{return COMMAND;}
}
