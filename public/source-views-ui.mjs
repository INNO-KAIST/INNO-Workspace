import {TEXT_BASED_FORMATS,connectedFormat} from './core/extract.mjs?v=formats-2';
const integer=(value,label)=>{const number=Number(value);if(!Number.isInteger(number))throw new Error(`${label}은 정수로 입력하세요.`);return number;};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value)?value:null;

export function sourceViewKind(file){
 const {format}=connectedFormat({name:String(file?.name||''),type:String(file?.type||'')});
 return TEXT_BASED_FORMATS.has(format)?'text':format==='pdf'?'pdf':null;
}

export function selectionFromValues(kind,values){
 if(kind==='text'){
  const start=integer(values?.start,'시작 바이트'),maxBytes=integer(values?.amount,'조회 바이트');
  if(start<0||maxBytes<1||maxBytes>200_000)throw new Error('텍스트 조회 범위는 1바이트에서 200,000바이트 사이여야 합니다.');
  return {kind:'text-byte-range',start,maxBytes};
 }
 if(kind==='pdf'){
  const startPage=integer(values?.start,'시작 페이지'),endPage=integer(values?.end,'끝 페이지');
  if(startPage<1||endPage<startPage||endPage-startPage+1>100)throw new Error('PDF 조회 범위는 연속된 1페이지에서 100페이지 사이여야 합니다.');
  return {kind:'pdf-pages',startPage,endPage};
 }
 throw new Error('이 파일 형식은 조회 범위를 선택할 수 없습니다.');
}

export function storedSourceView(view){
 const sha256=hash(view?.sha256);if(!sha256)throw new Error('선택 범위의 변경 확인 정보가 없습니다. 다시 미리보기 하세요.');
 if(view.kind==='text-byte-range'){
  const start=integer(view.start,'시작 바이트'),end=integer(view.end,'끝 바이트');
  if(start<0||end<=start||end-start>200_000)throw new Error('저장할 텍스트 조회 범위가 유효하지 않습니다.');
  return {kind:view.kind,start,end,sha256};
 }
 if(view.kind==='pdf-pages'){
  const startPage=integer(view.startPage,'시작 페이지'),endPage=integer(view.endPage,'끝 페이지');
  if(startPage<1||endPage<startPage||endPage-startPage+1>100)throw new Error('저장할 PDF 조회 범위가 유효하지 않습니다.');
  return {kind:view.kind,startPage,endPage,sha256};
 }
 throw new Error('저장할 수 없는 조회 범위입니다.');
}

export async function prepareSourceViewPreview(file,selection,extract){
 const result=await extract(file,selection);
 if(result?.status!=='available'||!result.view||!result.coverage){
  // Byte ranges need UTF-8; CP949 or UTF-16 files are read whole or must be converted or split.
  if(/UTF-8/.test(result?.reason||''))throw new Error('이 범위는 UTF-8 텍스트로 읽을 수 없습니다. 범위 선택은 UTF-8 파일만 됩니다. CP949 등 다른 인코딩이면 UTF-8로 저장해 다시 연결하거나, 필요한 부분만 담은 파일로 나눠 연결하세요.');
  throw new Error(result?.reason||'선택한 범위를 정확히 미리볼 수 없습니다. 범위를 줄이거나 지원되는 텍스트 또는 PDF를 연결하세요.');
 }
 return {text:String(result.text??''),coverage:result.coverage,savedView:storedSourceView(result.view)};
}

export function applyAttachmentView(attachments,id,view){
 let found=false;
 const next=(attachments||[]).map(attachment=>{
  if(attachment.id!==id)return attachment;found=true;
  const clean={...attachment};delete clean.view;
  if(view)clean.view=storedSourceView(view);
  return clean;
 });
 if(!found)throw new Error('연결 자료를 찾을 수 없습니다.');
 return next;
}

export function mergeConnectedAttachments(existing,incoming){
 const merged=new Map((existing||[]).map(attachment=>[attachment.id,attachment]));
 for(const attachment of incoming||[]){
  const previous=merged.get(attachment.id);
  merged.set(attachment.id,previous?.view?{...attachment,view:storedSourceView(previous.view)}:attachment);
 }
 return [...merged.values()];
}

export function createSourceViewDraftGuard(){
 let revision=0,request=0;
 return {
  begin:()=>({revision,request:++request}),
  invalidate:()=>++revision,
  isCurrent:token=>Boolean(token)&&token.revision===revision&&token.request===request
 };
}

export function canChangeSourceView(task,busy=false){
 if(busy)return false;
 if(!task)return true;
 if(task.parentTaskId||['queued','claimed','running','waiting_children','queued_for_review','reviewing'].includes(task.status))return false;
 return !task.delegation||['superseded','cancelled'].includes(task.delegation.state);
}

export function coverageDescription(coverage){
 if(coverage?.kind==='text-byte-range')return `부분 조회 · UTF-8 바이트 ${coverage.start}\u2013${coverage.end} (최대 200,000바이트). 변경 확인 해시는 선택한 텍스트에만 적용되며 전체 파일 무결성을 보장하지 않습니다.`;
 if(coverage?.kind==='pdf-pages')return `부분 조회 · PDF ${coverage.startPage}\u2013${coverage.endPage}쪽 (최대 100쪽, 내장 텍스트만). 변경 확인 해시는 선택한 텍스트에만 적용되며 전체 파일 무결성을 보장하지 않습니다.`;
 return '선택한 부분만 조회합니다. 전체 원본을 읽었다는 의미가 아닙니다.';
}
