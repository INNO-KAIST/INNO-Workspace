import {sanitizeMaterials} from './tasks.mjs';
import {verifyMaterialViews} from './source-coverage.mjs';
import {TEXT_BASED_FORMATS,connectedFormat} from './extract.mjs?v=formats-2';
import {IMAGE_LIMITS,encodeImageData,imageKind,isImageAttachment} from './image-materials.mjs';

// Read only during this invocation. No archive, durable queue, or source cache.
// Images go as image materials only when the run goes to Codex on this PC (allowImages).
export async function prepareTaskMaterials(task,{connected,getFile,extractText,verifyView,isCurrent=()=>true,allowImages=false}){
 const check=()=>{if(!isCurrent())throw Object.assign(Error('자료를 읽는 동안 작업이 변경됐습니다. 최신 내용을 확인하고 다시 실행하세요.'),{code:'STALE_SOURCE_TASK',status:409});};
 check();
 const snapshot={attachments:structuredClone(task.attachments??[])};
 const files=snapshot.attachments.filter(a=>a.source!=='url');
 if(files.length>20)throw Error('한 번에 조회할 자료는 20개 이하여야 합니다.');
 const missing=files.filter(a=>!connected(a));
 if(missing.length)throw Error(`${missing.length}개 원본의 연결이 끊겼습니다. 파일 또는 폴더를 다시 연결하세요.`);
 const images=files.filter(a=>isImageAttachment(a));
 if(images.length&&!allowImages)throw Error(`${images[0].name}: 이미지는 이 PC의 Codex 실행으로만 전달됩니다. 실행기를 Codex로 선택하세요.`);
 if(images.length>IMAGE_LIMITS.count)throw Error('한 번에 보낼 수 있는 이미지는 10장 이하입니다. 나눠 연결하세요.');
 const materials=[];let total=0,imageBytes=0;
 for(const a of files){
  check();if(total>=600000)throw Error('한 번에 조회할 텍스트 범위를 초과했습니다. 자료를 나눠 연결하세요.');
  const file=await getFile(a.id);check();
  if(isImageAttachment(a)){
   if(!(file.size<=IMAGE_LIMITS.bytesEach))throw Error(`${a.name}: 이미지는 한 장에 10 MB 이하만 보낼 수 있습니다. 크기를 줄여 다시 연결하세요.`);
   imageBytes+=file.size;if(imageBytes>IMAGE_LIMITS.bytesTotal)throw Error('한 번에 보낼 이미지는 모두 합쳐 30 MB 이하입니다. 나눠 연결하세요.');
   const bytes=new Uint8Array(await file.arrayBuffer());check();
   if(!imageKind(bytes))throw Error(`${a.name}: PNG·JPEG·GIF·WebP 이미지만 Codex에 전달됩니다. 다른 형식(BMP·TIFF·HEIC 등)은 PNG나 JPEG로 저장해 다시 연결하세요.`);
   materials.push({name:a.path||a.name,image:{data:encodeImageData(bytes)}});
   continue;
  }
  let result;
  if(a.view){
   if(typeof verifyView!=='function')throw Error('부분 조회 검증기를 사용할 수 없습니다.');
   result=await verifyView(file,a.view);check();
   if(result.status!=='available'||!result.coverage)throw Error(`${a.name}: ${result.reason||'저장된 부분 조회 범위를 확인할 수 없습니다. 새 범위를 미리보기한 뒤 저장하세요.'}`);
  }else{
   result=await extractText(file,{maxChars:Math.min(200000,600000-total)});check();
   if(result.status==='truncated'){
    const {format}=connectedFormat({name:a.name,type:file?.type});
    throw Error(TEXT_BASED_FORMATS.has(format)
     ?`${a.name}은 텍스트 전송 범위를 초과합니다. 미리보기에서 필요한 조회 범위를 선택하세요(범위 선택은 UTF-8 파일만 됩니다. 다른 인코딩이면 UTF-8로 저장하거나 나눠 연결하세요). 자동으로 잘라 분석하지 않습니다.`
     :format==='pdf'
     ?`${a.name}은 텍스트 전송 범위를 초과합니다. 미리보기에서 필요한 조회 범위를 선택하세요. 자동으로 잘라 분석하지 않습니다.`
     :`${a.name}은 텍스트 전송 범위(20만 자)를 초과합니다. 이 형식은 조회 범위를 고를 수 없으니 필요한 부분만 담은 파일로 나눠 연결하세요. 자동으로 잘라 분석하지 않습니다.`);
   }
   if(result.status!=='available')throw Error(`${a.name}: 텍스트를 읽을 수 없습니다. ${result.reason||'지원하지 않는 형식입니다.'} 텍스트가 들어 있는 문서(한글·오피스·PDF·개방형 문서·코드·데이터 파일 등)를 연결하세요.`);
  }
  total+=new TextEncoder().encode(result.text).byteLength;
  if(total>600000)throw Error('한 번에 조회할 텍스트 범위를 초과했습니다. 자료를 나눠 연결하세요.');
  materials.push({name:a.path||a.name,text:result.text,...(a.view?{coverage:result.coverage}:{})});
 }
 const normalized=sanitizeMaterials(materials,{images:allowImages});
 await verifyMaterialViews(snapshot,normalized);check();
 return normalized;
}
