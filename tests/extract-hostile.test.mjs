import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { extractConnectedText, extractPowerPointXml } from '../public/core/extract.mjs';

// CR-009 review: extraction runs on the browser's main thread, so hostile or damaged files must
// cost time and memory in proportion to their size (no quadratic regex scans, no output larger
// than the character limit), and unusual but legitimate text must still be read.
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
  return namedBlob(name, [await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], type);
}
const read = (file) => extractConnectedText(file, { JSZip });
async function timed(label, run) {
  const started = performance.now();
  const result = await run();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 3000, `${label} took ${Math.round(elapsed)} ms`);
  return result;
}
const workbook = {
  'xl/workbook.xml': '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
};
const BACKSLASH = String.fromCharCode(92);

test('spreadsheet padding, repeated cells and space runs stay within the character limit', async () => {
  const padded = await zipFile('wide.xlsx', { ...workbook, 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${Array.from({ length: 20000 }, (_, row) => `<row r="${row + 1}"><c r="XFC${row + 1}"><v>1</v></c></row>`).join('')}</sheetData></worksheet>` });
  const shared = await zipFile('shared.xlsx', { ...workbook, 'xl/sharedStrings.xml': `<sst><si><t>${'가'.repeat(100_000)}</t></si></sst>`, 'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1">${'<c t="s"><v>0</v></c>'.repeat(5000)}</row></sheetData></worksheet>` });
  const repeated = await zipFile('repeat.ods', { 'content.xml': `<office:spreadsheet><table:table table:name="T">${`<table:table-row><table:table-cell table:number-columns-repeated="100"><text:p>${'x'.repeat(5000)}</text:p></table:table-cell></table:table-row>`.repeat(200)}</table:table></office:spreadsheet>` });
  const spaces = await zipFile('spaces.odt', { 'content.xml': `<office:text><text:p>${'x<text:s text:c="1000"/>'.repeat(200_000)}</text:p></office:text>` });
  for (const [label, file] of [['padded XLSX', padded], ['shared-string XLSX', shared], ['repeated ODS', repeated], ['space-run ODT', spaces]]) {
    const result = await timed(label, () => read(file));
    assert.ok(result.text.length <= 200_000, `${label}: ${result.text.length} characters`);
    assert.notEqual(result.status, 'available', label);
  }
});

test('unclosed tags and missing brackets are read in linear time', async () => {
  const many = 200_000;
  const files = [
    ['docx', await zipFile('a.docx', { 'word/document.xml': `<w:body>${'<w:p><w:r><w:t>'.repeat(many)}` })],
    ['docx brackets', await zipFile('b.docx', { 'word/document.xml': `<w:body><w:p>${'<w:t'.repeat(many * 2)}</w:p>` })],
    ['pptx', await zipFile('c.pptx', { 'ppt/slides/slide1.xml': `<p:sld>${'<a:p><a:t>'.repeat(many)}` })],
    ['xlsx rows', await zipFile('d.xlsx', { ...workbook, 'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1">${'<c r="A1">'.repeat(many)}</row></sheetData></worksheet>` })],
    ['xlsx tags', await zipFile('e.xlsx', { ...workbook, 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${'<row'.repeat(many * 2)}</sheetData></worksheet>` })],
    ['xlsx prefixes', await zipFile('f.xlsx', { ...workbook, 'xl/workbook.xml': `<x:workbook ${Array.from({ length: 50_000 }, (_, index) => `xmlns:p${index}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`).join(' ')}><x:sheets><x:sheet name="S" r:id="rId1"/></x:sheets></x:workbook>`, 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>' })],
    ['odt', await zipFile('g.odt', { 'content.xml': `<office:text>${'<text:p><text:span>'.repeat(many)}` })],
    ['ods', await zipFile('h.ods', { 'content.xml': `<table:table table:name="T">${'<table:table-row><table:table-cell>'.repeat(many)}` })],
    ['hwpx', await zipFile('i.hwpx', { 'Contents/section0.xml': `<hs:sec>${'<hp:p><hp:run><hp:t>'.repeat(many)}` })],
    ['epub', await zipFile('j.epub', { 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>', 'c.opf': '<package><manifest><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="a"/></spine></package>', 'a.xhtml': `<html><body><p>ok</p>${'<script>'.repeat(many)}${'<'.repeat(many * 4)}</body></html>` })],
  ];
  for (const [label, file] of files) await timed(label, () => read(file));
});

test('long runs of spaces do not stall line clean-up', async () => {
  const run = ' '.repeat(2_000_000);
  await timed('RTF', () => read(namedBlob('s.rtf', [`{${BACKSLASH}rtf1 a${run}x${BACKSLASH}par}`])));
  await timed('notebook', () => read(namedBlob('s.ipynb', [JSON.stringify({ cells: [{ cell_type: 'code', source: `a${run}x` }] })])));
  const epub = await zipFile('s.epub', { 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>', 'c.opf': '<package><manifest><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="a"/></spine></package>', 'a.xhtml': `<html><body><p>a${' '.repeat(150_000)}x</p></body></html>` }); // within the 200,000-character limit
  const book = await timed('EPUB', () => read(epub));
  assert.match(book.text, /a +x/);
});

test('RTF nesting is bounded, binary payloads are skipped and Unicode fallbacks end with their group', async () => {
  const deep = await timed('deep RTF', () => read(namedBlob('deep.rtf', [`{${BACKSLASH}rtf1 ${'{'.repeat(500_000)}x${'}'.repeat(500_000)}}`])));
  assert.equal(deep.status, 'unavailable');
  assert.match(deep.reason, /nest/i);
  const b = BACKSLASH;
  const rtf = `{${b}rtf1${b}ansi a{${b}*${b}blipuid 1}{${b}pict${b}bin4 }}}}}b{${b}u54620}x{${b}uc1${b}u54620${b}'3f}y${b}par}`;
  const result = await read(namedBlob('mixed.rtf', [rtf]));
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, 'ab한x한y');
  const long = await read(namedBlob('long.rtf', [`{${b}rtf1 ok${b}${'z'.repeat(200_000)} end}`]));
  assert.equal(long.status, 'available', long.reason);
  assert.match(long.text, /^ok/);
});

test('XLSX runs, quoting and relationship prefixes vary between writers', async () => {
  const file = await zipFile('vary.xlsx', {
    'xl/workbook.xml': "<workbook xmlns:ns1='http://schemas.openxmlformats.org/officeDocument/2006/relationships'><sheets><sheet name='Data' sheetId='1' ns1:id='rId1'/></sheets></workbook>",
    'xl/_rels/workbook.xml.rels': "<Relationships><Relationship Id='rId1' Target='worksheets/sheet1.xml'/></Relationships>",
    'xl/sharedStrings.xml': '<sst><si><r><t/></r><r><t>값</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': "<worksheet><sheetData><row r='1'><c r='A1' t='s'><v>0</v></c><c r='B1'><v>2</v></c></row></sheetData></worksheet>",
  });
  const result = await read(file);
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Sheet: Data ---\n값\t2');
});

test('PowerPoint tab-stop definitions are not read as tab characters', () => {
  assert.equal(extractPowerPointXml('<a:p><a:pPr><a:tabLst><a:tab pos="914400" algn="l"/></a:tabLst></a:pPr><a:r><a:t>a</a:t></a:r><a:r><a:t>b</a:t></a:r></a:p>'), 'ab');
});

test('text files keep a few control bytes, drop NUL padding, and decode UTF-16 without a byte-order mark', async () => {
  assert.equal((await read(namedBlob('export.txt', ['a\x01b\x01c\n']))).text, 'a\x01b\x01c\n');
  assert.equal((await read(namedBlob('pad.log', ['line\x00\x00\x00 more']))).text, 'line more');
  const little = Buffer.from('한글 notes\n', 'utf16le');
  assert.equal((await read(namedBlob('le.txt', [little]))).text, '한글 notes\n');
  const big = Buffer.from(little);
  big.swap16();
  assert.equal((await read(namedBlob('be.txt', [big]))).text, '한글 notes\n');
  assert.equal((await read(namedBlob('blob.zzz', ['a\x01\x02\x03\x04b\x05\x06\x07\x0e\x0f']))).status, 'unavailable', 'unknown types stay strict');
});

test('a UTF-8 file with a stray byte stays UTF-8 instead of turning into CP949', async () => {
  const bytes = Buffer.concat([Buffer.from('café résumé naïve '.repeat(50)), Buffer.from([0xff]), Buffer.from(' end')]);
  const result = await read(namedBlob('latin.txt', [bytes]));
  assert.match(result.text, /^café résumé naïve /);
  assert.doesNotMatch(result.text, /[가-힣]/);
});

test('an XLSX labelled with the older Excel MIME type is read as XLSX', async () => {
  const file = await zipFile('report.xlsx', { ...workbook, 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData></worksheet>' }, 'application/vnd.ms-excel');
  const result = await read(file);
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Sheet: S ---\nok');
});

test('an RTF cut at the character limit is reported as truncated even after line clean-up', async () => {
  const b = BACKSLASH;
  const result = await read(namedBlob('table.rtf', [`{${b}rtf1 ${`a${b}cell ${b}row `.repeat(150_000)}}`]));
  assert.equal(result.status, 'truncated');
});

test('an ODP slide whose paragraph fills the limit keeps that text and is truncated', async () => {
  const file = await zipFile('long.odp', { 'content.xml': `<office:presentation><draw:page draw:name="p1"><text:p>${'x'.repeat(250_000)}</text:p></draw:page></office:presentation>` });
  const result = await read(file);
  assert.equal(result.status, 'truncated');
  assert.match(result.text, /^--- Slide 1 ---\nxxxx/);
});

test('a mostly-ASCII CP949 file with a few Korean words decodes as CP949', async () => {
  const ascii = Buffer.from('int value = 1; // note\n'.repeat(200));
  const korean = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x0a]); // "한글\n" in CP949
  const result = await read(namedBlob('main.c', [Buffer.concat([ascii, korean])]));
  assert.match(result.text, /한글\n$/);
});

test('a greater-than sign inside an attribute value does not end the tag', async () => {
  const { extractWordXml } = await import('../public/core/extract.mjs');
  assert.equal(extractWordXml('<w:p><w:r><w:t xml:space="a>b">text</w:t></w:r></w:p>'), 'text');
});
