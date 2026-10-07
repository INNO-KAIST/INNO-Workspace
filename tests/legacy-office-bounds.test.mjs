import assert from 'node:assert/strict';
import test from 'node:test';
import { extractConnectedText } from '../public/core/extract.mjs';
import { compoundFile, concat, u32s } from './helpers/cfb.mjs';

// CR-009 stage 4 review: Word table rows from paragraph properties, fast-saved and encrypted
// PowerPoint files through Current User and the UserEditAtom chain, crafted Excel and
// PowerPoint files that would repeat work, and .xls files that are really SpreadsheetML or HTML.
const u16 = (value) => new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
const u32 = (value) => u32s([value >>> 0]);
const utf16 = (text) => { const out = new Uint8Array(text.length * 2); for (let index = 0; index < text.length; index += 1) { out[index * 2] = text.charCodeAt(index) & 0xff; out[index * 2 + 1] = text.charCodeAt(index) >> 8; } return out; };
const latin1 = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));
function namedBlob(name, bytes, type = '') {
  const blob = new Blob([bytes], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}
const read = (name, bytes, type) => extractConnectedText(namedBlob(name, bytes, type));
async function timed(label, run) {
  const started = performance.now();
  const result = await run();
  assert.ok(performance.now() - started < 3000, `${label} took ${Math.round(performance.now() - started)} ms`);
  return result;
}

test('Word table rows come from paragraph properties, so an empty cell is not taken for a row end', async () => {
  const fib = new Uint8Array(1024);
  const view = new DataView(fib.buffer);
  view.setUint16(0, 0xa5ec, true); view.setUint16(2, 0xc1, true); view.setUint16(0x0a, 0x0200, true);
  view.setUint16(32, 14, true); view.setUint16(62, 22, true); view.setUint32(76, 6, true); view.setUint16(152, 93, true);
  const text = latin1('A\x07\x07C\x07\x07');
  const fkp = new Uint8Array(512);
  const fkpView = new DataView(fkp.buffer);
  [1024, 1026, 1027, 1029, 1030].forEach((fc, index) => fkpView.setUint32(index * 4, fc, true));
  [200, 200, 200, 220].forEach((offset, index) => { fkp[20 + index * 13] = offset; });
  fkp.set([3, 0, 0, 0x16, 0x24, 0x01], 400); // in a table
  fkp.set([0, 4, 0, 0, 0x16, 0x24, 0x01, 0x17, 0x24, 0x01], 440); // in a table, row end (sprmPFTtp)
  fkp[511] = 4;
  const plcPcd = concat([u32s([0, 6]), u16(0), u32((1024 * 2) | 0x40000000), u16(0)]);
  const clx = concat([new Uint8Array([2]), u32(plcPcd.length), plcPcd]);
  const bte = u32s([1024, 1030, 3]);
  view.setUint32(154 + 13 * 8, clx.length, true); view.setUint32(154 + 13 * 8 + 4, bte.length, true);
  view.setUint32(154 + 33 * 8, 0, true); view.setUint32(154 + 33 * 8 + 4, clx.length, true);
  const word = concat([fib, text, new Uint8Array(1536 - 1024 - text.length), fkp]);
  const result = await read('form.doc', compoundFile([{ name: 'WordDocument', data: word }, { name: '1Table', data: concat([clx, bte]) }]));
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, '--- Document ---\nA\t\tC');
});

const record = (type, data) => concat([u16(type), u16(data.length), data]);
const bof = (kind) => record(0x0809, concat([u16(0x0600), u16(kind), u16(0), u16(0), u32(0), u32(0)]));
const eof = () => record(0x000a, new Uint8Array(0));
const cell = (row, col) => concat([u16(row), u16(col), u16(15)]);
const sheetName = (text) => concat([new Uint8Array([text.length, 1]), utf16(text)]);

test('Excel cells that share one long string, and sheets that repeat one offset, stay within time and the limit', async () => {
  const long = `${'x'.repeat(30_000)}\n${'y'.repeat(30_000)}`;
  const chunks = [];
  for (let at = 0; at < long.length; at += 8000) chunks.push(long.slice(at, at + 8000));
  const sst = concat([record(0x00fc, concat([u32(1), u32(1), u16(long.length), new Uint8Array([0]), latin1(chunks[0])])), ...chunks.slice(1).map((chunk) => record(0x003c, concat([new Uint8Array([0]), latin1(chunk)])))]);
  const cells = concat(Array.from({ length: 30_000 }, (_, row) => record(0x00fd, concat([cell(row, 0), u32(0)]))));
  const sheet = concat([bof(0x10), cells, eof()]);
  const globals = (at) => concat([bof(0x05), record(0x0085, concat([u32(at), new Uint8Array([0, 0]), sheetName('S')])), sst, eof()]);
  const size = globals(0).length;
  const shared = await timed('shared string cells', () => read('shared.xls', compoundFile([{ name: 'Workbook', data: concat([globals(size), sheet]) }])));
  assert.equal(shared.status, 'truncated');
  const empty = concat([bof(0x10), concat(Array.from({ length: 150_000 }, () => record(0x0000, new Uint8Array(0)))), eof()]);
  const many = (at) => concat([bof(0x05), ...Array.from({ length: 3000 }, (_, index) => record(0x0085, concat([u32(at), new Uint8Array([0, 0]), sheetName(`S${index}`)]))), eof()]);
  const manySize = many(0).length;
  await timed('repeated sheet offsets', () => read('repeat.xls', compoundFile([{ name: 'Workbook', data: concat([many(manySize), empty]) }])));
});

test('an Excel sheet keeps its cells after an embedded chart substream', async () => {
  const sheet = concat([bof(0x10), record(0x0203, concat([cell(0, 0), new Uint8Array(new Float64Array([1]).buffer)])), bof(0x20), eof(), record(0x0203, concat([cell(1, 0), new Uint8Array(new Float64Array([2]).buffer)])), eof()]);
  const globals = (at) => concat([bof(0x05), record(0x0085, concat([u32(at), new Uint8Array([0, 0]), sheetName('S')])), eof()]);
  const size = globals(0).length;
  const result = await read('chart.xls', compoundFile([{ name: 'Workbook', data: concat([globals(size), sheet]) }]));
  assert.equal(result.text, '--- Sheet: S ---\n1\n2');
});

const ppt = (type, data, instance = 0, version = 0) => concat([u16((instance << 4) | version), u16(type), u32(data.length), data]);
const pptContainer = (type, children, instance = 0) => ppt(type, concat(children), instance, 0xf);
const textChars = (text) => ppt(0x0fa0, utf16(text));
const textHeader = (kind) => ppt(0x0f9f, u32(kind));
const slidePersist = (id) => ppt(0x03f3, concat([u32(id), u32(0), u32(0), u32(256 + id), u32(0)]));

test('PowerPoint slide containers that overlap are read once, within time', async () => {
  const shared = concat(Array.from({ length: 50_000 }, () => textHeader(0)));
  const count = 4000;
  // Slide k: a container whose first atom covers the headers of later slides and whose other
  // children are one shared list, so every container ends at the same place.
  const headers = [];
  for (let index = 0; index < count; index += 1) {
    const rest = (count - index - 1) * 16;
    headers.push(concat([u16(0x0f), u16(0x03ee), u32(8 + rest + shared.length), u16(0), u16(0x03ef), u32(rest)]));
  }
  const list = pptContainer(0x0ff0, Array.from({ length: count }, (_, index) => slidePersist(index + 1)), 0);
  const document = pptContainer(0x03e8, [list]);
  const offsets = Array.from({ length: count }, (_, index) => document.length + index * 16);
  const persist = ppt(0x1772, concat([u32(1 | (count << 20)), u32s(offsets)]));
  await timed('overlapping slides', () => read('overlap.ppt', compoundFile([{ name: 'PowerPoint Document', data: concat([document, ...headers, shared, persist]) }])));
});

function savedTwice({ encrypted = false } = {}) {
  const box = (text) => pptContainer(0x03ee, [ppt(0x03ef, new Uint8Array(24)), pptContainer(0x040c, [pptContainer(0xf00d, [textChars(text)])])]);
  const parts = [
    pptContainer(0x03e8, [pptContainer(0x0ff0, [slidePersist(1), textChars('old title')], 0)]),
    box('slide one box'),
    pptContainer(0x03e8, [pptContainer(0x0ff0, [slidePersist(1), textChars('new title'), slidePersist(2), textChars('added slide')], 0)]),
    box('slide two box'),
  ];
  const at = [];
  let offset = 0;
  for (const part of parts) { at.push(offset); offset += part.length; }
  const userEdit = (lastEdit, directoryAt) => ppt(0x0ff5, concat([u32(0), u16(0), new Uint8Array([0, 3]), u32(lastEdit), u32(directoryAt), u32(3), u32(4), u16(1), u16(0), ...(encrypted ? [u32(9)] : [])]));
  const firstDirectory = ppt(0x1772, concat([u32(1 | (1 << 20)), u32(at[1]), u32(3 | (1 << 20)), u32(at[0])]));
  const firstDirectoryAt = offset;
  const firstEditAt = firstDirectoryAt + firstDirectory.length;
  const firstEdit = userEdit(0, firstDirectoryAt);
  // Second edit: persist 2 is new and persist 3 (the document) moved; persist 1 stays.
  const secondDirectory = ppt(0x1772, concat([u32(2 | (2 << 20)), u32(at[3]), u32(at[2])]));
  const secondDirectoryAt = firstEditAt + firstEdit.length;
  const secondEditAt = secondDirectoryAt + secondDirectory.length;
  const secondEdit = userEdit(firstEditAt, secondDirectoryAt);
  const stream = concat([...parts, firstDirectory, firstEdit, secondDirectory, secondEdit]);
  const currentUser = concat([u16(0), u16(0x0ff6), u32(24), u32(20), u32(encrypted ? 0xf3d1c4df : 0xe391c05f), u32(secondEditAt), u16(0), u16(0x03f4), new Uint8Array([3, 0]), u16(0)]);
  return compoundFile([{ name: 'PowerPoint Document', data: stream }, { name: 'Current User', data: currentUser }]);
}

test('a fast-saved PowerPoint file is read from its latest edit, and an encrypted one is refused', async () => {
  const latest = await read('saved.ppt', savedTwice());
  assert.equal(latest.status, 'available', latest.reason);
  assert.equal(latest.text, '--- Slide 1 ---\nnew title\nslide one box\n\n--- Slide 2 ---\nadded slide\nslide two box');
  const locked = await read('locked.ppt', savedTwice({ encrypted: true }));
  assert.equal(locked.status, 'unavailable');
  assert.match(locked.reason, /password/i);
});

test('.xls files that are SpreadsheetML or Korean HTML are read; other binary content is refused', async () => {
  const xml = '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Data"><Table><Row><Cell><Data ss:Type="String">이름</Data></Cell><Cell ss:Index="3"><Data ss:Type="Number">5</Data></Cell></Row><Row><Cell><Data ss:Type="String">b</Data></Cell></Row></Table></Worksheet></Workbook>';
  const spreadsheet = await read('export.xls', new TextEncoder().encode(xml));
  assert.equal(spreadsheet.status, 'available', spreadsheet.reason);
  assert.equal(spreadsheet.text, '--- Sheet: Data ---\n이름\t\t5\nb');
  const eucKr = new Uint8Array([...latin1('<html><body><table><tr><td>'), 0xc7, 0xd1, 0xb1, 0xdb, ...latin1('</td></tr></table></body></html>')]);
  assert.equal((await read('bank.xls', eucKr)).text, '한글');
  const biff2 = new Uint8Array([0x09, 0x00, 0x04, 0x00, 0x02, 0x00, 0x10, 0x00, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x03, 0x00]);
  assert.equal((await read('old.xls', biff2)).status, 'unavailable');
});
