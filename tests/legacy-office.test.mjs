import assert from 'node:assert/strict';
import test from 'node:test';
import { extractConnectedText } from '../public/core/extract.mjs';
import { compoundFile, concat, u32s } from './helpers/cfb.mjs';

// CR-009 stage 4: Word, Excel and PowerPoint 97-2003 files (.doc, .xls, .ppt) are read in the
// browser from their compound file: Word through its piece table, Excel through BIFF8 records,
// PowerPoint through its slide list and slide drawings. Encrypted and pre-97 files are refused.
const u16 = (value) => new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
const u32 = (value) => u32s([value >>> 0]);
const f64 = (value) => { const out = new Uint8Array(8); new DataView(out.buffer).setFloat64(0, value, true); return out; };
const utf16 = (text) => { const out = new Uint8Array(text.length * 2); for (let index = 0; index < text.length; index += 1) { out[index * 2] = text.charCodeAt(index) & 0xff; out[index * 2 + 1] = text.charCodeAt(index) >> 8; } return out; };
const latin1 = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));
function namedBlob(name, bytes, type = '') {
  const blob = new Blob([bytes], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}
const read = (name, bytes, type) => extractConnectedText(namedBlob(name, bytes, type));

// Word 97-2003: a FIB at the start of WordDocument, the piece table (CLX) in the 1Table stream.
function wordFile({ pieces, mainLength, encrypted = false, nFib = 0xc1 }) {
  const fib = new Uint8Array(1024);
  const view = new DataView(fib.buffer);
  view.setUint16(0, 0xa5ec, true);
  view.setUint16(2, nFib, true);
  view.setUint16(0x0a, 0x0200 | (encrypted ? 0x0100 : 0), true); // fWhichTblStm: 1Table
  view.setUint16(32, 14, true); // csw
  view.setUint16(62, 22, true); // cslw
  view.setUint32(64 + 12, mainLength, true); // ccpText
  view.setUint16(152, 93, true); // cbRgFcLcb (Word 97)
  const data = [], cps = [0], descriptors = [];
  let offset = fib.length, cp = 0;
  for (const piece of pieces) {
    const bytes = piece.compressed ? latin1(piece.text) : utf16(piece.text);
    descriptors.push(concat([u16(0), u32(piece.compressed ? (offset * 2) | 0x40000000 : offset), u16(0)]));
    data.push(bytes);
    offset += bytes.length;
    cp += piece.text.length;
    cps.push(cp);
  }
  const plcPcd = concat([u32s(cps), ...descriptors]);
  const clx = concat([new Uint8Array([1]), u16(2), new Uint8Array([0, 0]), new Uint8Array([2]), u32(plcPcd.length), plcPcd]);
  view.setUint32(154 + 33 * 8, 0, true); // fcClx
  view.setUint32(154 + 33 * 8 + 4, clx.length, true); // lcbClx
  return compoundFile([{ name: 'WordDocument', data: concat([fib, ...data]) }, { name: '1Table', data: clx }]);
}
const WORD_PIECES = [
  { text: 'Hello Word\r', compressed: true },
  { text: '한글 \x13 HYPERLINK "x" \x14링크\x15 끝\r', compressed: false },
  { text: 'A\x07B\x07\x07', compressed: true },
  { text: 'FOOTNOTE\r', compressed: true },
];
const mainLength = WORD_PIECES.slice(0, 3).reduce((sum, piece) => sum + piece.text.length, 0);

test('a Word 97-2003 document gives its main text from the piece table', async () => {
  const result = await read('memo.doc', wordFile({ pieces: WORD_PIECES, mainLength }), 'application/msword');
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Document ---\nHello Word\n한글 링크 끝\nA\tB');
  assert.equal((await read('양식.dot', wordFile({ pieces: WORD_PIECES, mainLength }))).text, result.text, 'templates share the format');
});

// Excel 97-2003 (BIFF8): records of [type u16][length u16][data] in the Workbook stream.
const record = (type, data) => concat([u16(type), u16(data.length), data]);
const bof = (kind) => record(0x0809, concat([u16(0x0600), u16(kind), u16(0), u16(0), u32(0), u32(0)]));
const eof = () => record(0x000a, new Uint8Array(0));
const cell = (row, col) => concat([u16(row), u16(col), u16(15)]);
const unicodeString = (text) => concat([u16(text.length), new Uint8Array([1]), utf16(text)]);
const sheetName = (text) => concat([new Uint8Array([text.length, 1]), utf16(text)]);
function workbook({ encrypted = false } = {}) {
  const sstHead = concat([u32(6), u32(5), unicodeString('이름'), concat([u16(5), new Uint8Array([0]), latin1('value')]), concat([u16(5), new Uint8Array([0]), latin1('hello')]),
    concat([u16(4), new Uint8Array([0x08]), u16(1), latin1('rich'), u16(0), u16(1)]),
    concat([u16(8), new Uint8Array([0]), latin1('ABC')])]); // the fifth string continues in CONTINUE
  const sst = concat([record(0x00fc, sstHead), record(0x003c, concat([new Uint8Array([1]), utf16('DEF가나')]))]);
  const rk = (value) => u32(value);
  const data = concat([
    bof(0x10),
    record(0x00fd, concat([cell(0, 0), u32(0)])), record(0x00fd, concat([cell(0, 1), u32(1)])),
    record(0x0203, concat([cell(1, 0), f64(1.5)])), record(0x027e, concat([cell(1, 1), rk((42 << 2) | 2)])), record(0x027e, concat([cell(1, 2), rk((314 << 2) | 3)])),
    record(0x00fd, concat([cell(2, 0), u32(2)])), record(0x0205, concat([cell(2, 1), new Uint8Array([1, 0])])),
    record(0x0006, concat([cell(2, 2), new Uint8Array([0, 0, 0, 0, 0, 0, 0xff, 0xff]), u16(0), u32(0), u16(0)])), record(0x0207, unicodeString('calc')),
    record(0x00bd, concat([u16(3), u16(0), u16(15), rk((7 << 2) | 2), u16(15), rk(0x40040000), u16(1)])),
    record(0x00fd, concat([cell(4, 0), u32(3)])), record(0x00fd, concat([cell(4, 1), u32(4)])), record(0x0204, concat([cell(4, 3), unicodeString('inline')])),
    record(0x0006, concat([cell(5, 2), f64(10), u16(0), u32(0), u16(0)])),
    eof(),
  ]);
  const notes = concat([bof(0x10), record(0x00fd, concat([cell(0, 0), u32(2)])), eof()]);
  const globals = (positions) => concat([
    bof(0x05), ...(encrypted ? [record(0x002f, new Uint8Array(6))] : []),
    record(0x0085, concat([u32(positions[0]), new Uint8Array([0, 0]), sheetName('Data')])),
    record(0x0085, concat([u32(positions[1]), new Uint8Array([0, 0]), sheetName('Notes')])),
    sst, eof(),
  ]);
  const size = globals([0, 0]).length;
  return compoundFile([{ name: 'Workbook', data: concat([globals([size, size + data.length]), data, notes]) }]);
}

test('an Excel 97-2003 workbook gives each sheet with shared, inline, number and formula values', async () => {
  const result = await read('book.xls', workbook(), 'application/vnd.ms-excel');
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Sheet: Data ---\n이름\tvalue\n1.5\t42\t3.14\nhello\tTRUE\tcalc\n7\t2.5\nrich\tABCDEF가나\t\tinline\n\t\t10\n\n--- Sheet: Notes ---\nhello');
});

// PowerPoint 97-2003: records with [ver/instance u16][type u16][length u32] in the
// "PowerPoint Document" stream; containers have version 0xF.
const ppt = (type, data, instance = 0, version = 0) => concat([u16((instance << 4) | version), u16(type), u32(data.length), data]);
const pptContainer = (type, children, instance = 0) => ppt(type, concat(children), instance, 0xf);
const textChars = (text) => ppt(0x0fa0, utf16(text));
const textBytes = (text) => ppt(0x0fa8, latin1(text));
const textHeader = (kind) => ppt(0x0f9f, u32(kind));
const slidePersist = (id) => ppt(0x03f3, concat([u32(id), u32(0), u32(0), u32(256 + id), u32(0)]));
function presentation({ withList = true } = {}) {
  const slideOne = pptContainer(0x03ee, [ppt(0x03ef, new Uint8Array(24)), pptContainer(0x040c, [pptContainer(0xf002, [pptContainer(0xf004, [pptContainer(0xf00d, [textHeader(4), textChars('글상자 텍스트')])])])])]);
  const slideTwo = pptContainer(0x03ee, [ppt(0x03ef, new Uint8Array(24))]);
  const master = pptContainer(0x03f8, [textChars('마스터 텍스트')]);
  const document = pptContainer(0x03e8, withList ? [
    pptContainer(0x0ff0, [slidePersist(1), textHeader(0), textChars('첫 슬라이드 제목'), textHeader(1), textBytes('first body\rsecond line'), slidePersist(2), textHeader(0), textChars('둘째 슬라이드')], 0),
    pptContainer(0x0ff0, [slidePersist(9), textChars('notes text')], 2),
  ] : []);
  const slideOneAt = document.length, slideTwoAt = slideOneAt + slideOne.length;
  const persist = ppt(0x1772, concat([u32(1 | (2 << 20)), u32(slideOneAt), u32(slideTwoAt)]));
  return compoundFile([{ name: 'PowerPoint Document', data: concat([document, slideOne, slideTwo, master, persist]) }, { name: 'Current User', data: new Uint8Array(40) }]);
}

test('a PowerPoint 97-2003 presentation gives each slide in order, without notes or masters', async () => {
  const result = await read('talk.ppt', presentation(), 'application/vnd.ms-powerpoint');
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Slide 1 ---\n첫 슬라이드 제목\nfirst body\nsecond line\n글상자 텍스트\n\n--- Slide 2 ---\n둘째 슬라이드');
  const fallback = await read('shapes.ppt', presentation({ withList: false }));
  assert.equal(fallback.status, 'available', fallback.reason);
  assert.equal(fallback.text, '--- Slide 1 ---\n글상자 텍스트\n\n--- Slide 2 ---\n', 'without a slide list, slides are read in file order');
});

test('encrypted, pre-97 and unrecognised older Office files are refused with a reason', async () => {
  const lockedWord = await read('locked.doc', wordFile({ pieces: WORD_PIECES, mainLength, encrypted: true }));
  assert.equal(lockedWord.status, 'unavailable');
  assert.match(lockedWord.reason, /password/i);
  const oldWord = await read('old.doc', wordFile({ pieces: WORD_PIECES, mainLength, nFib: 0x65 }));
  assert.match(oldWord.reason, /Word 95|older/i);
  const lockedBook = await read('locked.xls', workbook({ encrypted: true }));
  assert.match(lockedBook.reason, /password/i);
  const book95 = await read('old.xls', compoundFile([{ name: 'Book', data: concat([bof(0x05), eof()]) }]));
  assert.match(book95.reason, /Excel 95|older/i);
  const lockedSlides = await read('locked.ppt', compoundFile([{ name: 'PowerPoint Document', data: new Uint8Array(16) }, { name: 'EncryptedSummary', data: new Uint8Array(16) }]));
  assert.match(lockedSlides.reason, /password/i);
  const unknown = await read('mystery.doc', compoundFile([{ name: 'Something', data: new Uint8Array(16) }]));
  assert.equal(unknown.status, 'unavailable');
  assert.match(unknown.reason, /not a Word, Excel or PowerPoint 97-2003 file/);
  const garbage = await read('broken.xls', new Uint8Array([0x89, 0, 1, 2, 0, 0, 3, 4]));
  assert.equal(garbage.status, 'unavailable');
});

test('.doc and .xls files that are really HTML, RTF or text (as many systems export) are read by content', async () => {
  const html = await read('statement.xls', new TextEncoder().encode('<html><body><table><tr><td>날짜</td><td>금액</td></tr><tr><td></td><td>1,000</td></tr></table></body></html>'));
  assert.equal(html.status, 'available', html.reason);
  assert.equal(html.text, '날짜\t금액\n\t1,000');
  const rtf = await read('letter.doc', new TextEncoder().encode('{' + String.fromCharCode(92) + 'rtf1 Dear reader' + String.fromCharCode(92) + 'par}'));
  assert.equal(rtf.text, 'Dear reader');
  assert.equal((await read('plain.doc', new TextEncoder().encode('just text'))).text, 'just text');
});

test('pieces, cells and slides that repeat large content stop at the character limit', async () => {
  const big = 'x'.repeat(60_000) + '\r';
  const pieces = Array.from({ length: 50 }, () => ({ text: big, compressed: true }));
  const repeated = await read('repeat.doc', wordFile({ pieces, mainLength: big.length * 50 }));
  assert.equal(repeated.status, 'truncated');
  assert.ok(repeated.text.length <= 200_000);
});
