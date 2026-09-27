import {sanitizeMaterials} from './tasks.mjs';
import {verifyMaterialViews} from './source-coverage.mjs';

// Read only during this invocation. No archive, durable queue, or source cache.
export async function prepareTaskMaterials(task,{connected,getFile,extractText,verifyView,isCurrent=()=>true}){
 const check=()=>{if(!isCurrent())throw Object.assign(Error('자료를 읽는 동안 작업이 변경됐습니다. 최신 내용을 확인하고 다시 실행하세요.'),{code:'STALE_SOURCE_TASK',status:409});};
 check();
 const snapshot={attachments:structuredClone(task.attachments??[])};
 const files=snapshot.attachments.filter(a=>a.source!=='url');
 if(files.length>20)throw Error('한 번에 조회할 자료는 20개 이하여야 합니다.');
 const missing=files.filter(a=>!connected(a));
 if(missing.length)throw Error(`${missing.length}개 원본의 연결이 끊겼습니다. 파일 또는 폴더를 다시 연결하세요.`);
 const materials=[];let total=0;
 for(const a of files){
  check();if(total>=600000)throw Error('한 번에 조회할 텍스트 범위를 초과했습니다. 자료를 나눠 연결하세요.');
  const file=await getFile(a.id);check();
  let result;
  if(a.view){
   if(typeof verifyView!=='function')throw Error('부분 조회 검증기를 사용할 수 없습니다.');
   result=await verifyView(file,a.view);check();
   if(result.status!=='available'||!result.coverage)throw Error(`${a.name}: ${result.reason||'저장된 부분 조회 범위를 확인할 수 없습니다. 새 범위를 미리보기한 뒤 저장하세요.'}`);
  }else{
   result=await extractText(file,{maxChars:Math.min(200000,600000-total)});check();
   if(result.status==='truncated')throw Error(`${a.name}은 텍스트 전송 범위를 초과합니다. 미리보기에서 필요한 조회 범위를 선택하세요. 자동으로 잘라 분석하지 않습니다.`);
   if(result.status!=='available')throw Error(`${a.name}: 이 실행 경로의 텍스트 조회를 지원하지 않습니다. 지원되는 일반 텍스트 또는 PDF 파일을 연결하세요.`);
  }
  total+=new TextEncoder().encode(result.text).byteLength;
  if(total>600000)throw Error('한 번에 조회할 텍스트 범위를 초과했습니다. 자료를 나눠 연결하세요.');
  materials.push({name:a.path||a.name,text:result.text,...(a.view?{coverage:result.coverage}:{})});
 }
 const normalized=sanitizeMaterials(materials);
 await verifyMaterialViews(snapshot,normalized);check();
 return normalized;
}
