const integer=(value,min,label)=>{if(!Number.isSafeInteger(value)||value<min)throw new TypeError('Invalid source '+label);return value;};
export function sanitizeSourceView(value,{source,size}={}){
 if(value==null)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||source==='url')throw new TypeError('Invalid source view');
 if(typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.sha256))throw new TypeError('Invalid source view hash');
 const result={kind:value.kind,sha256:value.sha256.toLowerCase()};
 if(value.kind==='text-byte-range'){
  result.start=integer(value.start,0,'range start');result.end=integer(value.end,1,'range end');
  if(result.end<=result.start||result.end-result.start>200000||(size!==undefined&&result.end>integer(size,0,'size')))throw new TypeError('Invalid source byte range');
 }else if(value.kind==='pdf-pages'){
  result.startPage=integer(value.startPage,1,'start page');result.endPage=integer(value.endPage,1,'end page');
  if(result.endPage<result.startPage||result.endPage-result.startPage>=100||result.endPage>1000000)throw new TypeError('Invalid source page range');
 }else throw new TypeError('Unsupported source view kind');
 return result;
}
export function sanitizeSourceCoverage(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||typeof value.partial!=='boolean')throw new TypeError('Invalid source coverage');
 const sourceSize=integer(value.sourceSize,0,'size');const view=sanitizeSourceView(value,{size:sourceSize});
 const method=view.kind==='text-byte-range'?'utf8_text':'pdf_embedded_text';
 if(value.method!==method)throw new TypeError('Invalid source extraction method');
 if(view.kind==='text-byte-range'&&value.partial!==(view.start!==0||view.end!==sourceSize))throw new TypeError('Source partial coverage does not match byte range');
 let totalPages;
 if(view.kind==='pdf-pages'){
  totalPages=integer(value.totalPages,view.endPage,'total pages');
  if(value.partial!==(view.startPage!==1||view.endPage!==totalPages))throw new TypeError('Source partial coverage does not match page range');
 }
 return {...view,sourceSize,partial:value.partial,method,...(totalPages===undefined?{}:{totalPages})};
}
export function sourceCoverageContext(materials){
 const selected=materials.filter(m=>m.coverage).map(m=>({name:m.name,coverage:m.coverage}));
 return selected.length?'SOURCE COVERAGE: '+JSON.stringify(selected)+'\nOnly the selected excerpts were read. Do not infer omitted pages, rows, figures, or whole-source conclusions. The hash checks selected extracted text only, not whole-file integrity. PDF embedded text excludes images and non-text content. State these evidence limits in the result.':'';
}
export async function verifyMaterialViews(task,materials=[]){
 const fail=message=>{throw Object.assign(new Error(message),{name:'ValidationError',statusCode:400});};
 const required=(task.attachments??[]).filter(a=>a.source!=='url').map(a=>a.path||a.name);
 if(required.length){
  if(new Set(required).size!==required.length)fail('Reconnect sources with distinct paths; attachment names are ambiguous');
  const counts=new Map();for(const material of materials)counts.set(material.name,(counts.get(material.name)||0)+1);
  for(const name of required)if(counts.get(name)!==1)fail('Reconnect every required source exactly once before execution');
  const names=new Set(required);if(materials.some(m=>!names.has(m.name)))fail('Unexpected source material outside the task attachments');
 }

 for(const material of materials){if(!material.coverage)continue;let coverage;try{coverage=sanitizeSourceCoverage(material.coverage);}catch(error){fail(error.message);}
  const bytes=new TextEncoder().encode(material.text);
  if(coverage.kind==='text-byte-range'&&bytes.byteLength!==coverage.end-coverage.start)fail('Selected source byte range differs from transmitted text');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==coverage.sha256)fail('Selected source text has changed; select the view again');
 }
 for(const attachment of task.attachments??[]){if(!attachment.view)continue;
  const matching=materials.filter(m=>m.name===(attachment.path||attachment.name));if(matching.length!==1||!matching[0].coverage)fail('Reconnect the selected source view before execution');
  const coverage=matching[0].coverage,view=sanitizeSourceView(coverage,{size:attachment.size});
  if(coverage.sourceSize!==attachment.size||JSON.stringify(view)!==JSON.stringify(sanitizeSourceView(attachment.view,attachment)))fail('Selected source coverage differs from the saved task');
 }
}
