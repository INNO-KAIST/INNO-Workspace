import test from 'node:test';
import assert from 'node:assert/strict';
import {
 applyAttachmentView,
 canChangeSourceView,
 coverageDescription,
 createSourceViewDraftGuard,
 mergeConnectedAttachments,
 prepareSourceViewPreview,
 selectionFromValues,
 sourceViewKind,
 storedSourceView
} from '../public/source-views-ui.mjs';

test('source selection is offered only for text and PDF files',()=>{
 assert.equal(sourceViewKind({name:'notes.md',type:''}),'text');
 assert.equal(sourceViewKind({name:'paper.PDF',type:''}),'pdf');
 assert.equal(sourceViewKind({name:'paper.pdf',type:'text/plain'}),null);
 assert.equal(sourceViewKind({name:'data.bin',type:'application/octet-stream'}),null);
 // CR-009: the same format rules as text extraction, so every text extension gets byte ranges
 assert.equal(sourceViewKind({name:'analysis.R',type:''}),'text');
 assert.equal(sourceViewKind({name:'data.csv',type:'application/vnd.ms-excel'}),'text');
 assert.equal(sourceViewKind({name:'main.ts',type:'video/mp2t'}),'text');
 assert.equal(sourceViewKind({name:'보고서.hwp',type:''}),null);
 assert.equal(sourceViewKind({name:'table.xlsx',type:''}),null);
 // RTF and notebooks are text underneath; their raw bytes keep byte ranges (as before CR-009)
 assert.equal(sourceViewKind({name:'memo.rtf',type:'text/rtf'}),'text');
 assert.equal(sourceViewKind({name:'run.ipynb',type:'application/json'}),'text');
});

test('selection inputs enforce exact text and PDF limits',()=>{
 assert.deepEqual(selectionFromValues('text',{start:'7',amount:'200000'}),{kind:'text-byte-range',start:7,maxBytes:200000});
 assert.deepEqual(selectionFromValues('pdf',{start:'2',end:'101'}),{kind:'pdf-pages',startPage:2,endPage:101});
 for(const input of [{start:'-1',amount:'1'},{start:'0',amount:'0'},{start:'0',amount:'200001'}])assert.throws(()=>selectionFromValues('text',input));
 for(const input of [{start:'0',end:'1'},{start:'3',end:'2'},{start:'1',end:'101'}])assert.throws(()=>selectionFromValues('pdf',input));
});

test('preview delegates extraction and stores only exact metadata',async()=>{
 const original={name:'secret.txt'};
 const result=await prepareSourceViewPreview(original,{kind:'text-byte-range',start:4,maxBytes:12},async(file,selection)=>{
  assert.equal(file,original);assert.equal(selection.start,4);
  return {status:'available',text:'PRIVATE_SENTINEL',coverage:{kind:'text-byte-range',sourceSize:100,partial:true,method:'utf8_text',start:4,end:20,sha256:'a'.repeat(64)},view:{kind:'text-byte-range',start:4,end:20,sha256:'a'.repeat(64),text:'PRIVATE_SENTINEL'}};
 });
 assert.equal(result.text,'PRIVATE_SENTINEL');
 assert.deepEqual(result.savedView,{kind:'text-byte-range',start:4,end:20,sha256:'a'.repeat(64)});
 assert.equal(JSON.stringify(result.savedView).includes('PRIVATE_SENTINEL'),false);
 await assert.rejects(()=>prepareSourceViewPreview(original,{},async()=>({status:'truncated',reason:'too large'})),/too large/);
 // CR-009: a CP949 or UTF-16 file cannot use byte ranges; say what to do instead of a dead end
 await assert.rejects(()=>prepareSourceViewPreview(original,{},async()=>({status:'unavailable',reason:'Selected text is not valid UTF-8.'})),/UTF-8로 저장/);
});

test('attachment view save and reset never persist extracted bytes',()=>{
 const attachments=[{id:'a',name:'large.txt',view:{kind:'text-byte-range',start:0,end:1,sha256:'b'.repeat(64)}},{id:'b',name:'other.txt'}];
 const view=storedSourceView({kind:'pdf-pages',startPage:2,endPage:4,sha256:'c'.repeat(64),text:'PRIVATE_SENTINEL',coverage:{secret:true}});
 const saved=applyAttachmentView(attachments,'a',view);
 assert.deepEqual(saved[0].view,{kind:'pdf-pages',startPage:2,endPage:4,sha256:'c'.repeat(64)});
 assert.equal(JSON.stringify(saved).includes('PRIVATE_SENTINEL'),false);
 const reset=applyAttachmentView(saved,'a',null);
 assert.equal('view'in reset[0],false);
 assert.equal(reset[1],attachments[1]);
});

test('reconnecting the same attachment keeps its saved source view',()=>{
 const view={kind:'text-byte-range',start:8,end:20,sha256:'d'.repeat(64)};
 const existing=[{id:'same',name:'old.txt',size:20,lastModified:1,type:'text/plain',view},{id:'kept',name:'kept.txt'}];
 const incoming=[{id:'same',name:'fresh.txt',size:20,lastModified:1,type:'text/plain'},{id:'new',name:'new.txt'}];
 const merged=mergeConnectedAttachments(existing,incoming);
 assert.equal(merged.length,3);assert.equal(merged[0].name,'fresh.txt');assert.deepEqual(merged[0].view,view);assert.equal(merged[1],existing[1]);
});

test('editing a selection or starting a newer preview invalidates stale async results',()=>{
 const guard=createSourceViewDraftGuard(),first=guard.begin();
 assert.equal(guard.isCurrent(first),true);
 guard.invalidate();assert.equal(guard.isCurrent(first),false);
 const second=guard.begin(),third=guard.begin();
 assert.equal(guard.isCurrent(second),false);assert.equal(guard.isCurrent(third),true);
});

test('source selection changes are locked by execution, child ownership, and active delegation',()=>{
 assert.equal(canChangeSourceView(null,false),true);
 assert.equal(canChangeSourceView({status:'ready'},true),false);
 assert.equal(canChangeSourceView({status:'ready',parentTaskId:'parent'},false),false);
 assert.equal(canChangeSourceView({status:'ready',delegation:{state:'waiting'}},false),false);
 assert.equal(canChangeSourceView({status:'ready',delegation:{state:'superseded'}},false),true);
 assert.equal(canChangeSourceView({status:'running'},false),false);
});

test('coverage copy identifies partial range, limit, and selection-only hash scope',()=>{
 const text=coverageDescription({kind:'text-byte-range',start:7,end:20,partial:true,method:'utf8_text'});
 assert.match(text,/7–20/);assert.match(text,/200,000/);assert.match(text,/선택한 텍스트/);assert.match(text,/전체 파일.*보장하지/);
 const pdf=coverageDescription({kind:'pdf-pages',startPage:3,endPage:5,partial:true,method:'pdf_embedded_text'});
 assert.match(pdf,/3–5/);assert.match(pdf,/100/);assert.match(pdf,/내장 텍스트/);
});
