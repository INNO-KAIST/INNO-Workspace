function invalid(){throw Object.assign(new Error('Invalid artifact checks: at most 20 bounded checks with status and evidence are required'),{name:'ValidationError',statusCode:400});}
export function sanitizeArtifactChecks(value){
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>20)invalid();
 const clean=value.map(item=>{
  if(!item||typeof item!=='object'||!['pass','fail','not_run'].includes(item.status))invalid();
  for(const [key,max] of [['check',200],['evidence',1500]])if(typeof item[key]!=='string'||!item[key].trim()||item[key].length>max)invalid();
  return {check:item.check.trim(),status:item.status,evidence:item.evidence.trim()};
 });
 if(new TextEncoder().encode(JSON.stringify(clean)).byteLength>30000)invalid();
 return clean;
}
export function artifactCheckSummary(artifact){
 let checks;try{checks=sanitizeArtifactChecks(artifact?.checks);}catch{return '검사 기록 형식 오류';}
 if(!checks?.length)return '검사 기록 없음';
 return `AI 보고 · 통과 ${checks.filter(c=>c.status==='pass').length} · 실패 ${checks.filter(c=>c.status==='fail').length} · 미실시 ${checks.filter(c=>c.status==='not_run').length}`;
}
