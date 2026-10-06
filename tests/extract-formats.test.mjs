import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { extractConnectedText } from '../public/core/extract.mjs';

// CR-009 stage 1: commonly used formats are read in the browser without new libraries. Text in
// any extension (code, science, config) is read when its content is text; Korean CP949 text
// files decode; RTF, notebooks, spreadsheets, HWPX, OpenDocument and EPUB give readable text.
function namedBlob(name, parts, type = '') {
  const blob = new Blob(parts, { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}
function vendoredJsZip() {
  const source = readFileSync(new URL('../public/vendor/jszip.min.js', import.meta.url), 'utf8');
  const context = {
    module: { exports: {} }, exports: {}, require() { throw new Error('Unexpected external require'); },
    setImmediate, clearImmediate, setTimeout, clearTimeout, console, Buffer,
    Uint8Array, Uint16Array, Uint32Array, ArrayBuffer, Blob, TextEncoder, TextDecoder,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(source, context, { filename: 'jszip.min.js' });
  return context.module.exports;
}
const JSZip = vendoredJsZip();
async function zipFile(name, entries, type = '') {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return namedBlob(name, [await zip.generateAsync({ type: 'uint8array' })], type);
}
const read = (file) => extractConnectedText(file, { JSZip });

test('text in any extension is read by content, and binary content is refused', async () => {
  for (const [name, type] of [['measure.dat', ''], ['Makefile', ''], ['main.ts', 'video/mp2t'], ['analysis.R', ''], ['Model.java', ''], ['query.sql', ''], ['paper.tex', 'application/x-tex'], ['refs.bib', ''], ['seq.fasta', ''], ['run.ipynb.bak', 'application/octet-stream']]) {
    const result = await read(namedBlob(name, ['x = 1\nprint(x)\n'], type));
    assert.equal(result.status, 'available', `${name}: ${result.reason}`);
    assert.match(result.text, /print\(x\)/);
  }
  assert.equal((await read(namedBlob('blob.bin', [new Uint8Array([0x00, 0x01, 0x02, 0xff, 0x00])], 'application/octet-stream'))).status, 'unavailable');
  assert.equal((await read(namedBlob('photo.raw', [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00])]))).status, 'unavailable');
});

test('Korean CP949 text decodes, and UTF-8 stays UTF-8', async () => {
  const cp949 = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0xb9, 0xae, 0xbc, 0xad]); // "한글 문서"
  assert.equal((await read(namedBlob('old.txt', [cp949], 'text/plain'))).text, '한글 문서');
  assert.equal((await read(namedBlob('new.txt', ['한글 문서'], 'text/plain'))).text, '한글 문서');
});

test('RTF text is read with its code page and Unicode escapes', async () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg949{\fonttbl{\f0 Batang;}}{\colortbl;\red0\green0\blue0;}\f0 Hello \'c7\'d1\'b1\'db\par World \u54620?\tab end\par}`;
  const result = await read(namedBlob('memo.rtf', [rtf], 'text/rtf'));
  assert.equal(result.status, 'available', result.reason);
  assert.match(result.text, /Hello 한글\nWorld 한\tend/);
  assert.doesNotMatch(result.text, /Batang|red0|rtf1/);
});

test('a Jupyter notebook gives its cells and text outputs', async () => {
  const notebook = { cells: [
    { cell_type: 'markdown', source: ['# 측정 분석\n', '설명'] },
    { cell_type: 'code', source: 'x = 1', outputs: [{ output_type: 'stream', text: ['1\n'] }, { output_type: 'display_data', data: { 'image/png': 'AAAA', 'text/plain': ['<Figure>'] } }] },
  ] };
  const result = await read(namedBlob('analysis.ipynb', [JSON.stringify(notebook)], 'application/x-ipynb+json'));
  assert.equal(result.status, 'available', result.reason);
  assert.match(result.text, /--- Cell 1 \(markdown\) ---\n# 측정 분석\n설명/);
  assert.match(result.text, /--- Cell 2 \(code\) ---\nx = 1/);
  assert.match(result.text, /1\n/);assert.match(result.text, /<Figure>/);assert.match(result.text, /image output omitted/);
  assert.doesNotMatch(result.text, /AAAA/);
});

test('an XLSX workbook gives each sheet as tab-separated rows', async () => {
  const file = await zipFile('data.xlsx', {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>이름</t></si><si><r><t>값</t></r><r><t>2</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>alpha &amp; beta</t></is></c><c r="C2"><v>3.5</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="str"><f>A1</f><v>note</v></c></row></sheetData></worksheet>',
  }, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const result = await read(file);
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Sheet: Data ---\n이름\t값2\nalpha & beta\t\t3.5\n\n--- Sheet: Notes ---\nnote');
});

test('an HWPX document gives its sections in order', async () => {
  const file = await zipFile('보고서.hwpx', {
    mimetype: 'application/hwp+zip',
    'Contents/section1.xml': '<hs:sec><hp:p><hp:run><hp:t>다음 구역</hp:t></hp:run></hp:p></hs:sec>',
    'Contents/section0.xml': '<hs:sec><hp:p><hp:run><hp:t>첫 문단</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>둘</hp:t><hp:tab/><hp:t>셋</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t/><hp:t>넷<hp:tab width="4000" leader="0" type="1"/>다섯</hp:t></hp:run></hp:p></hs:sec>',
  });
  const result = await read(file);
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Section 1 ---\n첫 문단\n둘\t셋\n넷\t다섯\n\n--- Section 2 ---\n다음 구역');
});

test('OpenDocument text, spreadsheet and presentation are read', async () => {
  const odt = await zipFile('note.odt', { 'content.xml': '<office:document-content><office:body><office:text><text:h>제목</text:h><text:p>본문 <text:span>강조</text:span><text:s/>끝<text:tab/>탭<text:line-break/>다음 줄</text:p></office:text></office:body></office:document-content>' }, 'application/vnd.oasis.opendocument.text');
  assert.equal((await read(odt)).text, '--- Document ---\n제목\n본문 강조 끝\t탭\n다음 줄');
  const ods = await zipFile('table.ods', { 'content.xml': '<office:spreadsheet><table:table table:name="Sheet1"><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"><text:p>b</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row></table:table></office:spreadsheet>' });
  assert.equal((await read(ods)).text, '--- Sheet: Sheet1 ---\na\tb\tb');
  const odp = await zipFile('talk.odp', { 'content.xml': '<office:presentation><draw:page draw:name="p1"><draw:frame><draw:text-box><text:p>첫 슬라이드</text:p></draw:text-box></draw:frame></draw:page><draw:page draw:name="p2"><draw:frame><draw:text-box><text:p>둘째</text:p></draw:text-box></draw:frame></draw:page></office:presentation>' });
  assert.equal((await read(odp)).text, '--- Slide 1 ---\n첫 슬라이드\n\n--- Slide 2 ---\n둘째');
});

test('an EPUB gives its chapters in reading order', async () => {
  const file = await zipFile('book.epub', {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf': '<package><manifest><item id="c1" href="ch1.xhtml"/><item id="c2" href="text/ch2.xhtml"/></manifest><spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>',
    'OEBPS/ch1.xhtml': '<html><body><h1>Chapter One</h1><p>first &amp; only</p><script>bad()</script></body></html>',
    'OEBPS/text/ch2.xhtml': '<html><body><p>Preface</p></body></html>',
  }, 'application/epub+zip');
  const result = await read(file);
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Section 1 ---\nPreface\n\n--- Section 2 ---\nChapter One\nfirst & only');
});

test('Word tab-stop definitions are not read as tab characters', async () => {
  const { extractWordXml } = await import('../public/core/extract.mjs');
  const xml = '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t>이름</w:t></w:r><w:r><w:tab/><w:t>값</w:t></w:r></w:p>';
  assert.equal(extractWordXml(xml), '이름\t값');
});

test('an XLSX whose elements carry a namespace prefix (as Hancom Cell writes) is read', async () => {
  const ns = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const file = await zipFile('budget.xlsx', {
    'xl/workbook.xml': `<x:workbook ${ns}><x:sheets><x:sheet name="Budget" sheetId="1" r:id="rId3"/></x:sheets></x:workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<x:sst ${ns}><x:si><x:t>Rent</x:t></x:si></x:sst>`,
    'xl/worksheets/sheet1.xml': `<x:worksheet ${ns}><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1"><x:v>500</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
  });
  const result = await read(file);
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Sheet: Budget ---\nRent\t500');
});

test('XLSX numbers are shown in their shortest form, as the spreadsheet shows them', async () => {
  const file = await zipFile('values.xlsx', {
    'xl/workbook.xml': '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>298.14999999999998</v></c><c r="B1" t="n"><v>596.29999999999995</v></c><c r="C1" t="str"><v>0.10000000000000001</v></c><c r="D1"><v>1E-3</v></c></row></sheetData></worksheet>',
  });
  assert.equal((await read(file)).text, '--- Sheet: S ---\n298.15\t596.3\t0.10000000000000001\t0.001');
});

test('RTF bytes are decoded with the character set of the font in use (as PowerPoint writes bullets)', async () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg949{\fonttbl{\f1\fnil\fcharset129 \'b8\'bc\'c0\'ba;}{\f2\fnil\fcharset0 Arial;}{\f3\fnil\fcharset2 Symbol;}}
\pard\plain {\pntext\pard\plain\loch\f2 \'95\tab}{\*\pn\pnlvlblt\pnf2{\pntxtb \'95}}{\loch\af1\dbch\f1 \'c7\'d1\'b1\'db\par}
{\f3 \'b7}{\f2  caf\'e9}\par}`;
  const result = await read(namedBlob('slides.rtf', [rtf]));
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '•\t한글\n• café');
});
