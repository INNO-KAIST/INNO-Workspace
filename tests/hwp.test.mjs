import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { extractConnectedText } from '../public/core/extract.mjs';

// CR-009: HWP 5.0 binary documents (the common Hangul word processor format) are read in the
// browser. The file is a compound file (CFB); body text sits in BodyText/SectionN streams,
// usually raw-deflated, as PARA_TEXT records of UTF-16 text with inline control characters.
const END = 0xfffffffe, FREE = 0xffffffff, FATSECT = 0xfffffffd, DIFSECT = 0xfffffffc, NONE = 0xffffffff;
const SECTOR = 512, MINI = 64, CUTOFF = 4096, PER_SECTOR = SECTOR / 4;

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function u32s(values) {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return out;
}

// A minimal compound file writer: small streams go to the mini stream, large ones to sectors.
// An entry may share another entry's stream (sameAs: its index in `entries`), and `filler`
// sectors make the FAT outgrow the 109 header slots so a DIFAT sector is written.
function compoundFile(entries, { filler = 0 } = {}) {
  const nodes = [{ name: 'Root Entry', type: 5, children: [] }, ...entries.map((entry) => ({ ...entry, type: entry.data || entry.sameAs !== undefined ? 2 : 1, children: [] }))];
  entries.forEach((entry, index) => nodes[entry.parent ?? 0].children.push(index + 1));
  const sectors = [], fat = [];
  const place = (bytes) => {
    const start = fat.length, count = Math.max(1, Math.ceil(bytes.length / SECTOR));
    for (let index = 0; index < count; index += 1) {
      fat.push(index === count - 1 ? END : start + index + 1);
      const sector = new Uint8Array(SECTOR);
      sector.set(bytes.subarray(index * SECTOR, (index + 1) * SECTOR));
      sectors.push(sector);
    }
    return start;
  };
  const own = nodes.filter((node) => node.type === 2 && node.data);
  const mini = [], miniFat = [];
  for (const node of own) {
    if (node.data.length >= CUTOFF) continue;
    node.start = miniFat.length;
    const count = Math.max(1, Math.ceil(node.data.length / MINI));
    for (let index = 0; index < count; index += 1) miniFat.push(index === count - 1 ? END : node.start + index + 1);
    const padded = new Uint8Array(count * MINI);
    padded.set(node.data);
    mini.push(padded);
  }
  for (const node of own) if (node.data.length >= CUTOFF) node.start = place(node.data);
  for (const node of nodes) if (node.sameAs !== undefined) { node.start = nodes[node.sameAs + 1].start; node.data = nodes[node.sameAs + 1].data; }
  if (filler) place(new Uint8Array(filler * SECTOR));
  const miniStream = concat(mini);
  nodes[0].start = miniStream.length ? place(miniStream) : END;
  nodes[0].data = { length: miniStream.length };
  while (miniFat.length % PER_SECTOR) miniFat.push(FREE);
  const miniFatStart = miniFat.length ? place(u32s(miniFat)) : END;
  const directory = new Uint8Array(Math.ceil(nodes.length / 4) * 4 * 128);
  const view = new DataView(directory.buffer);
  for (let index = 0; index < directory.length / 128; index += 1) {
    const base = index * 128;
    view.setUint32(base + 68, NONE, true); view.setUint32(base + 72, NONE, true); view.setUint32(base + 76, NONE, true);
    const node = nodes[index];
    if (!node) continue;
    for (let char = 0; char < node.name.length; char += 1) view.setUint16(base + char * 2, node.name.charCodeAt(char), true);
    view.setUint16(base + 64, (node.name.length + 1) * 2, true);
    directory[base + 66] = node.type;
    directory[base + 67] = 1;
    if (node.children.length) view.setUint32(base + 76, node.children[0], true);
    view.setUint32(base + 116, node.type === 1 ? 0 : node.start, true);
    view.setUint32(base + 120, node.type === 1 ? 0 : node.data.length, true);
  }
  for (const node of nodes) node.children.forEach((child, index) => { if (index + 1 < node.children.length) view.setUint32(child * 128 + 72, node.children[index + 1], true); });
  const directoryStart = place(directory);
  let fatCount = 1, difatCount = 0;
  for (;;) {
    const needFat = Math.ceil((fat.length + fatCount + difatCount) / PER_SECTOR);
    const needDifat = needFat > 109 ? Math.ceil((needFat - 109) / (PER_SECTOR - 1)) : 0;
    if (needFat === fatCount && needDifat === difatCount) break;
    fatCount = needFat; difatCount = needDifat;
  }
  const fatSectors = Array.from({ length: fatCount }, (_, index) => fat.length + index);
  for (let index = 0; index < fatCount; index += 1) fat.push(FATSECT);
  const difatStart = fat.length;
  for (let index = 0; index < difatCount; index += 1) fat.push(DIFSECT);
  while (fat.length % PER_SECTOR) fat.push(FREE);
  const difat = [];
  for (let index = 0; index < difatCount; index += 1) {
    const slots = fatSectors.slice(109 + index * (PER_SECTOR - 1), 109 + (index + 1) * (PER_SECTOR - 1));
    while (slots.length < PER_SECTOR - 1) slots.push(FREE);
    difat.push(u32s([...slots, index + 1 < difatCount ? difatStart + index + 1 : END]));
  }
  const header = new Uint8Array(SECTOR);
  const headerView = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  headerView.setUint16(0x18, 0x3e, true); headerView.setUint16(0x1a, 3, true); headerView.setUint16(0x1c, 0xfffe, true);
  headerView.setUint16(0x1e, 9, true); headerView.setUint16(0x20, 6, true);
  headerView.setUint32(0x2c, fatCount, true); headerView.setUint32(0x30, directoryStart, true);
  headerView.setUint32(0x38, CUTOFF, true); headerView.setUint32(0x3c, miniFatStart, true);
  headerView.setUint32(0x40, miniFat.length ? miniFat.length / PER_SECTOR : 0, true);
  headerView.setUint32(0x44, difatCount ? difatStart : END, true); headerView.setUint32(0x48, difatCount, true);
  for (let index = 0; index < 109; index += 1) headerView.setUint32(0x4c + index * 4, index < fatCount ? fatSectors[index] : FREE, true);
  return concat([header, ...sectors, u32s(fat), ...difat]);
}

function record(tag, data, level = 0) {
  const size = data.length;
  const head = size >= 0xfff ? u32s([tag | (level << 10) | (0xfff << 20), size]) : u32s([tag | (level << 10) | (size << 20)]);
  return concat([head, data]);
}
function utf16(text) {
  const out = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) { out[index * 2] = text.charCodeAt(index) & 0xff; out[index * 2 + 1] = text.charCodeAt(index) >> 8; }
  return out;
}
const control = (code) => utf16(String.fromCharCode(code, 0, 0, 0, 0, 0, 0, code)); // 8 code units
const PARA_HEADER = 66, PARA_TEXT = 67;
const paragraph = (level, ...parts) => concat([record(PARA_HEADER, new Uint8Array(22), level), record(PARA_TEXT, concat([...parts, utf16('\r')]), level)]);
function noise(length) {
  const out = new Uint8Array(length);
  let seed = 7;
  for (let index = 0; index < length; index += 1) { seed = (seed * 1103515245 + 12345) >>> 0; out[index] = seed >>> 24; }
  return out;
}
function fileHeader(flags) {
  const header = new Uint8Array(256);
  header.set(new TextEncoder().encode('HWP Document File'));
  new DataView(header.buffer).setUint32(32, 0x05000300, true);
  new DataView(header.buffer).setUint32(36, flags, true);
  return header;
}
const section0 = concat([
  paragraph(0, utf16('첫 문단')),
  paragraph(0, utf16('둘'), control(9), utf16('셋')),
  paragraph(0, utf16('가'), utf16(String.fromCharCode(10)), utf16('나'), utf16(String.fromCharCode(30)), utf16('끝')),
  paragraph(0, control(11)),
  record(99, noise(6000), 1),
  paragraph(1, utf16('셀')),
  paragraph(0, control(2), control(21)),
  record(PARA_TEXT, concat([utf16('홀'), new Uint8Array([0x41])])), // odd length: the stray byte is ignored
]);
const section1 = paragraph(0, utf16('다음 구역'));
const deflate = (bytes) => new Uint8Array(deflateRawSync(bytes));
function hwp({ flags = 1, pack = (bytes) => (flags & 1 ? deflate(bytes) : bytes), sections = [section0, section1], filler = 0 } = {}) {
  return compoundFile([
    { name: 'FileHeader', data: fileHeader(flags) },
    { name: 'DocInfo', data: pack(record(16, new Uint8Array(26))) },
    { name: 'BodyText' },
    // Listed last-first so the reader must sort; { sameAs: k } shares section k's stream.
    ...sections.map((data, index) => (data.sameAs !== undefined ? { name: `Section${index}`, parent: 3, sameAs: 3 + sections.length - 1 - data.sameAs } : { name: `Section${index}`, parent: 3, data: pack(data) })).reverse(),
  ], { filler });
}
function namedBlob(name, bytes, type = '') {
  const blob = new Blob([bytes], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}
const EXPECTED = '--- Section 1 ---\n첫 문단\n둘\t셋\n가\n나 끝\n셀\n홀\n\n--- Section 2 ---\n다음 구역';

test('a compressed HWP 5.0 document gives its body text by section, including table cells', async () => {
  const file = hwp();
  assert.ok(file.length > CUTOFF, 'the fixture keeps one section in regular sectors');
  const result = await extractConnectedText(namedBlob('보고서.hwp', file));
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, EXPECTED);
  assert.equal((await extractConnectedText(namedBlob('보고서.hwp', file, 'application/x-hwp'))).text, EXPECTED);
  assert.equal((await extractConnectedText(namedBlob('양식.hwt', file))).text, EXPECTED, 'HWP templates share the format');
});

test('an uncompressed HWP 5.0 document is read the same way', async () => {
  const result = await extractConnectedText(namedBlob('plain.hwp', hwp({ flags: 0 })));
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, EXPECTED);
});

test('a file whose FAT needs a DIFAT sector is read', async () => {
  const file = hwp({ filler: 15000 });
  assert.ok(new DataView(file.buffer).getUint32(0x48, true) > 0, 'the fixture uses the DIFAT chain');
  const result = await extractConnectedText(namedBlob('big.hwp', file));
  assert.equal(result.status, 'available', result.reason);
  assert.equal(result.text, EXPECTED);
});

test('sections with bytes left after the compressed data are kept; a section damaged mid-way is refused', async () => {
  const trailing = hwp({ pack: (bytes) => concat([deflate(bytes), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]) });
  const kept = await extractConnectedText(namedBlob('trailing.hwp', trailing));
  assert.equal(kept.status, 'available', kept.reason);
  assert.equal(kept.text, EXPECTED);
  const cut = hwp({ pack: (bytes) => { const packed = deflate(bytes); return bytes.length > 1000 ? packed.subarray(0, Math.floor(packed.length * 0.6)) : packed; } });
  const refused = await extractConnectedText(namedBlob('cut.hwp', cut));
  assert.equal(refused.status, 'unavailable');
  assert.match(refused.reason, /^HWP text is unavailable: .*(damaged|incomplete|end)/i);
});

test('password-protected, distribution-only, HWP 3.0 and damaged files are refused with a reason', async () => {
  const locked = await extractConnectedText(namedBlob('locked.hwp', hwp({ flags: 3 })));
  assert.equal(locked.status, 'unavailable');
  assert.match(locked.reason, /password/i);
  const distributed = await extractConnectedText(namedBlob('dist.hwp', hwp({ flags: 5 })));
  assert.equal(distributed.status, 'unavailable');
  assert.match(distributed.reason, /distribution/i);
  const old = await extractConnectedText(namedBlob('old.hwp', new TextEncoder().encode('HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05')));
  assert.equal(old.status, 'unavailable');
  assert.match(old.reason, /HWP 3/);
  const broken = hwp();
  broken.fill(0xff, 512, 1024);
  const damaged = await extractConnectedText(namedBlob('broken.hwp', broken));
  assert.equal(damaged.status, 'unavailable');
  assert.match(damaged.reason, /^HWP text is unavailable: /);
});

test('a cyclic chain in a section stream is refused instead of looping', async () => {
  const file = hwp({ flags: 0 });
  const view = new DataView(file.buffer);
  const fatOffset = (view.getUint32(0x4c, true) + 1) * SECTOR;
  // Section0 is the first stream placed in regular sectors: its second sector now leads back to
  // the first, inside the part of the chain the stream needs.
  view.setUint32(fatOffset + 1 * 4, 0, true);
  const result = await extractConnectedText(namedBlob('loop.hwp', file));
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /cyclic/);
});

test('sections that re-read one stream, or too many sections, stop at the safety limits', async () => {
  const big = concat([paragraph(0, utf16('x')), record(99, noise(1_200_000))]);
  const shared = hwp({ flags: 0, sections: [big, ...Array.from({ length: 29 }, () => ({ sameAs: 0 }))] });
  const reread = await extractConnectedText(namedBlob('shared.hwp', shared));
  assert.equal(reread.status, 'truncated', 'sections read before the limit are kept and marked cut');
  assert.match(reread.text, /^--- Section 1 ---\nx/);
  const many = hwp({ flags: 0, sections: Array.from({ length: 1001 }, () => paragraph(0, utf16('x'))) });
  const sections = await extractConnectedText(namedBlob('many.hwp', many));
  assert.equal(sections.status, 'unavailable');
  assert.match(sections.reason, /sections/);
});

test('reading a short stream walks only the sectors it needs, even along a very long chain', async () => {
  const MINI_OFFSET = 0x3c;
  const small = concat([paragraph(0, utf16('짧은 구역')), record(99, noise(3900))]); // just under the mini-stream cutoff
  const fillers = Array.from({ length: 3200 }, (_, index) => ({ name: `F${index}`, data: small }));
  const sections = Array.from({ length: 1000 }, (_, index) => ({ name: `Section${index}`, parent: 3, sameAs: 3 }));
  const file = compoundFile([
    { name: 'FileHeader', data: fileHeader(0) },
    { name: 'DocInfo', data: record(16, new Uint8Array(26)) },
    { name: 'BodyText' },
    ...fillers,
    ...sections,
  ]);
  // Link every mini stream's last sector to the next one: one chain about 200,000 sectors long.
  const view = new DataView(file.buffer);
  const miniFatOffset = (view.getUint32(MINI_OFFSET, true) + 1) * SECTOR;
  const entries = view.getUint32(0x40, true) * PER_SECTOR;
  for (let index = 0; index + 1 < entries; index += 1) {
    const at = miniFatOffset + index * 4;
    if (view.getUint32(at, true) === END && view.getUint32(at + 4, true) !== FREE) view.setUint32(at, index + 1, true);
  }
  const started = performance.now();
  const result = await extractConnectedText(namedBlob('chain.hwp', file));
  assert.ok(performance.now() - started < 1500, `took ${Math.round(performance.now() - started)} ms`);
  assert.notEqual(result.status, 'unavailable', result.reason);
  assert.match(result.text, /^--- Section 1 ---\n짧은 구역/);
});
