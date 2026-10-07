import { STREAM, compoundFile, isCompoundFile } from './cfb.mjs';
import { textBudget, trimLineEnds } from './extract-shared.mjs';

// CR-009 stage 4: Word, Excel and PowerPoint 97-2003 files (.doc, .xls, .ppt and templates)
// read from their compound file. Word: the piece table (CLX) gives the main text and paragraph
// properties mark table rows. Excel: BIFF8 records give sheets, shared strings and values.
// PowerPoint: Current User and the UserEditAtom chain give the latest document and slides.
// Work and output are bounded: a crafted file that repeats content (pieces, shared strings,
// sheets, slide containers) stops at the writer's room or at a budget tied to the file size.

const cp1252 = new TextDecoder('windows-1252');
const utf16le = new TextDecoder('utf-16le');
const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const damaged = (detail) => new Error(`the file is damaged (${detail})`);
const ROW_END = String.fromCharCode(0xe000); // private marker for a Word table row end

// Latin-1: each byte is the low byte of a UTF-16 code unit (Excel and PowerPoint 8-bit text).
function latin1(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return text;
}

export async function legacyOfficeSections(bytes, writer) {
  if (!isCompoundFile(bytes)) throw new Error('not a Word, Excel or PowerPoint 97-2003 file');
  const file = compoundFile(bytes, { label: 'Office 97-2003' });
  const stream = (name) => {
    const id = file.named(0, name, STREAM);
    return id === undefined ? null : file.read(id);
  };
  if (file.named(0, 'EncryptedSummary', STREAM) !== undefined) throw new Error('password-protected Office files are not read');
  const word = stream('WordDocument');
  if (word) return wordSections(word, stream, writer);
  const workbook = stream('Workbook');
  if (workbook) return excelSections(workbook, writer);
  if (file.named(0, 'Book', STREAM) !== undefined) throw new Error('Excel 95 and older workbooks are not read; save it as .xlsx');
  const slides = stream('PowerPoint Document');
  if (slides) return powerPointSections(slides, stream('Current User'), writer);
  throw new Error('not a Word, Excel or PowerPoint 97-2003 file');
}

// ---- Word ----------------------------------------------------------------------------

// Word's text marks, cleaned piece by piece (field state carries across pieces): paragraph and
// line ends become new lines, a cell end a tab and a row end a new line; field codes are dropped
// and field results kept. Without paragraph properties a cell end right after one is a row end.
function wordCleaner(knownRows) {
  const fields = [];
  let codeDepth = 0, lastCell = false;
  return (raw) => {
    const out = [];
    for (let index = 0; index < raw.length; index += 1) {
      const code = raw.charCodeAt(index);
      if (code === 0x13) { fields.push(false); codeDepth += 1; lastCell = false; continue; }
      if (code === 0x14) { if (fields.length && !fields.at(-1)) { fields[fields.length - 1] = true; codeDepth -= 1; } continue; }
      if (code === 0x15) { if (fields.length && !fields.pop()) codeDepth -= 1; continue; }
      if (codeDepth) continue;
      if (code === 0xe000) { out.push('\n'); lastCell = false; continue; }
      if (code === 0x07) {
        if (knownRows) out.push('\t');
        else { out.push(lastCell ? '\n' : '\t'); lastCell = !lastCell; }
        continue;
      }
      lastCell = false;
      if (code === 0x0d || code === 0x0b || code === 0x0c || code === 0x0e) out.push('\n');
      else if (code === 0x09) out.push('\t');
      else if (code === 0x1e) out.push('-');
      else if (code === 0xa0) out.push(' ');
      else if (code >= 0x20) out.push(raw[index]);
    }
    return out.join('');
  };
}

// File offsets of table row ends: paragraphs whose properties carry sprmPFTtp or
// sprmPFInnerTtp, from the PAPX FKP pages listed in PlcBtePapx. null when unavailable.
function rowEndRanges(word, table, fcLcbAt) {
  const view = viewOf(word), tableView = viewOf(table);
  const at = view.getUint32(fcLcbAt + 13 * 8, true), length = view.getUint32(fcLcbAt + 13 * 8 + 4, true);
  if (length < 12 || (length - 4) % 8 || at + length > table.length) return null;
  const count = (length - 4) / 8, ranges = [];
  for (let index = 0; index < count && index < 65536; index += 1) {
    const page = (tableView.getUint32(at + (count + 1) * 4 + index * 4, true) & 0x3fffff) * 512;
    if (page + 512 > word.length) continue;
    const runs = word[page + 511];
    if ((runs + 1) * 4 + runs * 13 > 511) continue;
    for (let run = 0; run < runs; run += 1) {
      const offset = word[page + (runs + 1) * 4 + run * 13] * 2;
      if (!offset) continue;
      let start = page + offset, size = word[start] * 2 - 1;
      if (word[start] === 0) { size = word[start + 1] * 2; start += 2; } else start += 1;
      const end = Math.min(start + size, page + 511);
      for (let sprm = start + 2; sprm + 2 <= end;) {
        const id = view.getUint16(sprm, true), kind = id >> 13;
        if ((id === 0x2417 || id === 0x244c) && word[sprm + 2] === 1) {
          ranges.push([view.getUint32(page + run * 4, true), view.getUint32(page + (run + 1) * 4, true)]);
          break;
        }
        const operand = kind === 0 || kind === 1 ? 1 : kind === 3 ? 4 : kind === 7 ? 3 : kind === 6 ? (sprm + 2 < end ? word[sprm + 2] + 1 : end) : 2;
        if (id === 0xc615 && word[sprm + 2] === 255) break;
        sprm += 2 + operand;
      }
    }
  }
  return ranges.sort((left, right) => left[0] - right[0]);
}

function inRanges(ranges, fc) {
  let low = 0, high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (fc < ranges[middle][0]) high = middle - 1;
    else if (fc >= ranges[middle][1]) low = middle + 1;
    else return true;
  }
  return false;
}

function wordSections(word, stream, writer) {
  if (word.length < 0x200) throw damaged('no Word header');
  const view = viewOf(word);
  if (view.getUint16(0, true) !== 0xa5ec) throw damaged('no Word header');
  if (view.getUint16(2, true) < 0xc0) throw new Error('Word 95 and older documents are not read; save it as .docx');
  const flags = view.getUint16(0x0a, true);
  if (flags & 0x0100) throw new Error('password-protected Word documents are not read');
  const table = stream(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw damaged('no table stream');
  const csw = view.getUint16(32, true);
  const lwAt = 34 + csw * 2 + 2;
  if (lwAt + 16 > word.length) throw damaged('no piece table');
  const cslw = view.getUint16(lwAt - 2, true);
  const fcLcbAt = lwAt + cslw * 4 + 2;
  if (fcLcbAt + 33 * 8 + 8 > word.length || view.getUint16(fcLcbAt - 2, true) < 34) throw damaged('no piece table');
  const mainLength = view.getUint32(lwAt + 12, true);
  const fcClx = view.getUint32(fcLcbAt + 33 * 8, true), lcbClx = view.getUint32(fcLcbAt + 33 * 8 + 4, true);
  if (fcClx + lcbClx > table.length) throw damaged('piece table outside its stream');
  const tableView = viewOf(table);
  let at = fcClx, plcAt = -1, plcLength = 0;
  while (at + 3 <= fcClx + lcbClx) {
    if (table[at] === 1) { at += 3 + tableView.getUint16(at + 1, true); continue; }
    if (table[at] === 2 && at + 5 <= table.length) { plcLength = tableView.getUint32(at + 1, true); plcAt = at + 5; break; }
    throw damaged('unexpected piece table entry');
  }
  if (plcAt < 0 || plcLength < 4 || (plcLength - 4) % 12 || plcAt + plcLength > table.length) throw damaged('no piece table');
  const pieces = (plcLength - 4) / 12;
  const rows = rowEndRanges(word, table, fcLcbAt);
  const clean = wordCleaner(Boolean(rows?.length));
  const budget = textBudget(writer.remaining + 1);
  let decoded = 0;
  for (let index = 0; index < pieces && !budget.full; index += 1) {
    const cpStart = tableView.getUint32(plcAt + index * 4, true);
    const cpEnd = Math.min(tableView.getUint32(plcAt + (index + 1) * 4, true), mainLength);
    if (cpEnd <= cpStart) continue;
    // Overlapping pieces cannot make the work exceed the document's own size.
    const count = Math.min(cpEnd - cpStart, word.length - decoded);
    if (count <= 0) { writer.cut(); break; }
    decoded += count;
    const fc = tableView.getUint32(plcAt + (pieces + 1) * 4 + index * 8 + 2, true);
    const compressed = Boolean(fc & 0x40000000);
    const offset = compressed ? (fc & 0x3fffffff) / 2 : fc & 0x3fffffff;
    const width = compressed ? 1 : 2;
    if (offset + count * width > word.length) throw damaged('a text piece lies outside the document');
    let raw = compressed ? cp1252.decode(word.subarray(offset, offset + count)) : utf16le.decode(word.subarray(offset, offset + count * 2));
    if (rows?.length && raw.includes('\x07')) {
      raw = raw.replace(/\x07/g, (mark, position) => (inRanges(rows, offset + position * width) ? ROW_END : mark));
    }
    budget.push(clean(raw));
  }
  const text = trimLineEnds(budget.text).replace(/\n{3,}/g, '\n\n').trim();
  writer.add('Document', text);
  if (budget.full) writer.cut();
  return Boolean(text);
}

// ---- Excel ---------------------------------------------------------------------------

const ERRORS = { 0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A' };
const MAX_CELLS = 2_000_000;
const decodeChars = (bytes, high) => (high ? utf16le.decode(bytes) : latin1(bytes));

// An XLUnicodeString inside one record: [cch u16][flags u8][chars].
function recordString(data, at) {
  if (at + 3 > data.length) return '';
  const count = viewOf(data).getUint16(at, true), high = data[at + 2] & 1;
  return decodeChars(data.subarray(at + 3, at + 3 + count * (high ? 2 : 1)), high);
}

// Shared strings: the SST record and its CONTINUE records. A string whose characters cross into
// a CONTINUE record restarts there with one flags byte giving the character width. Damage stops
// the table where it is; the strings read so far are kept.
function sharedStrings(segments) {
  let segment = 0, at = 0;
  const strings = [];
  const left = () => segments[segment].length - at;
  const next = () => { segment += 1; at = 0; return segment < segments.length; };
  const take = (count) => {
    const parts = [];
    let remaining = count;
    while (remaining > 0) {
      if (left() === 0 && !next()) throw damaged('shared strings end early');
      const size = Math.min(remaining, left());
      parts.push(segments[segment].subarray(at, at + size));
      at += size;
      remaining -= size;
    }
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(count);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  };
  const skip = (count) => {
    let remaining = count;
    while (remaining > 0) {
      if (left() === 0 && !next()) throw damaged('shared strings end early');
      const size = Math.min(remaining, left());
      at += size;
      remaining -= size;
    }
  };
  const u16 = () => { const bytes = take(2); return bytes[0] | (bytes[1] << 8); };
  const u32 = () => { const bytes = take(4); return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0; };
  try {
    u32();
    const unique = u32();
    for (let index = 0; index < unique; index += 1) {
      if (left() === 0 && !next()) break;
      const count = u16(), flags = take(1)[0];
      let high = flags & 1;
      const runs = flags & 0x08 ? u16() : 0;
      const extra = flags & 0x04 ? u32() : 0;
      const parts = [];
      let remaining = count;
      while (remaining > 0) {
        if (left() === 0) {
          if (!next()) throw damaged('shared strings end early');
          high = take(1)[0] & 1;
        }
        const chars = Math.min(remaining, high ? Math.floor(left() / 2) : left());
        if (chars === 0) throw damaged('a shared string is cut');
        parts.push(decodeChars(take(chars * (high ? 2 : 1)), high));
        remaining -= chars;
      }
      strings.push(parts.join(''));
      skip(runs * 4 + extra);
    }
  } catch { /* keep the strings read before the damage */ }
  return strings;
}

function rkValue(rk) {
  let value;
  if (rk & 2) value = (rk | 0) >> 2;
  else {
    const view = new DataView(new ArrayBuffer(8));
    view.setUint32(4, rk & 0xfffffffc, true);
    value = view.getFloat64(0, true);
  }
  return rk & 1 ? value / 100 : value;
}
const numberText = (value) => (Number.isFinite(value) ? String(value) : '');

function excelSections(stream, writer) {
  const view = viewOf(stream);
  // Every record costs at least four bytes: all sheets together cannot read more than that.
  let recordBudget = Math.floor(stream.length / 4) + 1;
  const records = function* (start) {
    for (let at = start; at + 4 <= stream.length;) {
      if (--recordBudget < 0) return;
      const type = view.getUint16(at, true), length = view.getUint16(at + 2, true);
      if (at + 4 + length > stream.length) return;
      yield { type, data: stream.subarray(at + 4, at + 4 + length) };
      at += 4 + length;
    }
  };
  const sheets = [], segments = [], offsets = new Set();
  let inSst = false, first = true;
  for (const { type, data } of records(0)) {
    if (first) {
      if (type !== 0x0809) throw damaged('no workbook header');
      if (data.length < 2 || viewOf(data).getUint16(0, true) !== 0x0600) throw new Error('Excel 95 and older workbooks are not read; save it as .xlsx');
      first = false;
      continue;
    }
    if (type === 0x002f) throw new Error('password-protected Excel workbooks are not read');
    if (type === 0x003c && inSst) { segments.push(data); continue; }
    inSst = false;
    if (type === 0x00fc) { segments.push(data); inSst = true; }
    else if (type === 0x0085 && data.length >= 8 && data[5] === 0) {
      const sheetAt = viewOf(data).getUint32(0, true);
      if (offsets.has(sheetAt)) continue;
      offsets.add(sheetAt);
      const count = data[6], high = data[7] & 1;
      sheets.push({ at: sheetAt, name: decodeChars(data.subarray(8, 8 + count * (high ? 2 : 1)), high) || 'Sheet' });
    } else if (type === 0x000a) break;
  }
  if (first) throw damaged('no workbook header');
  const strings = segments.length ? sharedStrings(segments) : [];
  let hasText = false, cells = 0;
  for (const sheet of sheets) {
    // Values are kept as references (a shared string is not copied per cell) and cleaned only
    // when written.
    const rows = new Map();
    let pending = null, depth = 0;
    const put = (row, col, value) => {
      if (value === '' || value == null || col > 255) return;
      if ((cells += 1) > MAX_CELLS) throw damaged('too many cells');
      if (!rows.has(row)) rows.set(row, new Map());
      rows.get(row).set(col, value);
    };
    for (const { type, data } of records(sheet.at)) {
      // A sheet runs from its BOF to the matching EOF; embedded charts nest their own BOF/EOF.
      if (type === 0x0809) { depth += 1; continue; }
      if (depth === 0) break;
      if (type === 0x000a) { depth -= 1; if (depth === 0) break; continue; }
      if (depth > 1 || data.length < 6) continue;
      const cellView = viewOf(data), row = cellView.getUint16(0, true), col = cellView.getUint16(2, true);
      if (type === 0x00fd && data.length >= 10) put(row, col, strings[cellView.getUint32(6, true)]);
      else if ((type === 0x0204 || type === 0x00d6) && data.length >= 9) put(row, col, recordString(data, 6));
      else if (type === 0x0203 && data.length >= 14) put(row, col, numberText(cellView.getFloat64(6, true)));
      else if (type === 0x027e && data.length >= 10) put(row, col, numberText(rkValue(cellView.getUint32(6, true))));
      else if (type === 0x00bd) {
        for (let at = 4, index = 0; at + 6 <= data.length - 2; at += 6, index += 1) put(row, col + index, numberText(rkValue(cellView.getUint32(at + 2, true))));
      } else if (type === 0x0205 && data.length >= 8) put(row, col, data[7] ? ERRORS[data[6]] ?? '#ERROR' : data[6] ? 'TRUE' : 'FALSE');
      else if (type === 0x0006 && data.length >= 14) {
        if (data[12] === 0xff && data[13] === 0xff) {
          if (data[6] === 0) pending = { row, col };
          else if (data[6] === 1) put(row, col, data[8] ? 'TRUE' : 'FALSE');
          else if (data[6] === 2) put(row, col, ERRORS[data[8]] ?? '#ERROR');
        } else put(row, col, numberText(cellView.getFloat64(6, true)));
      } else if (type === 0x0207 && pending) { put(pending.row, pending.col, recordString(data, 0)); pending = null; }
    }
    const budget = textBudget(writer.remaining + 1);
    let firstRow = true;
    for (const row of [...rows.keys()].sort((a, b) => a - b)) {
      const values = rows.get(row);
      // Values sit at their columns: tabs before the first one, then one per column step.
      let line = '', column = -1;
      for (const col of [...values.keys()].sort((a, b) => a - b)) {
        const value = values.get(col);
        const room = writer.remaining + 1 - budget.length - line.length;
        if (room <= 0) break;
        line += '\t'.repeat(column < 0 ? col : col - column) + (value.length > room ? value.slice(0, room) : value).replace(/[\t\n\r]+/g, ' ');
        column = col;
      }
      if (!line) continue;
      if (!budget.push((firstRow ? '' : '\n') + line)) break;
      firstRow = false;
      hasText = true;
    }
    if (!writer.add(`Sheet: ${sheet.name}`, budget.text) || budget.full) { writer.cut(); break; }
  }
  if (recordBudget < 0) writer.cut();
  return hasText;
}

// ---- PowerPoint ----------------------------------------------------------------------

const MAX_DEPTH = 16;
const MAX_SLIDES = 10_000;
const ENCRYPTED_TOKEN = 0xf3d1c4df;

function pptRecords(bytes, start, end) {
  const view = viewOf(bytes), records = [];
  for (let at = start; at + 8 <= end;) {
    const head = view.getUint16(at, true), type = view.getUint16(at + 2, true), length = view.getUint32(at + 4, true);
    if (at + 8 + length > end) break;
    records.push({ type, version: head & 0x0f, instance: head >> 4, start: at + 8, end: at + 8 + length });
    at += 8 + length;
  }
  return records;
}
function pptRecordAt(bytes, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 8 > bytes.length) return null;
  const [record] = pptRecords(bytes, offset, bytes.length);
  return record?.start === offset + 8 ? record : null;
}

const slideText = (text) => trimLineEnds(text.replace(/[\r\x0b]/g, '\n').replace(/[\x00-\x08\x0c\x0e-\x1f]/g, '')).trim();
function atomText(bytes, record) {
  if (record.type === 0x0fa0) return slideText(utf16le.decode(bytes.subarray(record.start, record.end - ((record.end - record.start) % 2))));
  if (record.type === 0x0fa8) return slideText(latin1(bytes.subarray(record.start, record.end)));
  return null;
}

// Text atoms of one container and its descendants, in order.
function containerText(bytes, record, depth = 0, out = []) {
  for (const child of pptRecords(bytes, record.start, record.end)) {
    const text = atomText(bytes, child);
    if (text) out.push(text);
    else if (child.version === 0x0f && depth < MAX_DEPTH) containerText(bytes, child, depth + 1, out);
  }
  return out;
}

// Persist object offsets for the wanted ids. With Current User, the UserEditAtom chain is
// followed from the newest edit (whose directory entries win); otherwise every persist
// directory in the stream is read, later ones winning.
function persistOffsets(bytes, edits, top, wanted) {
  const view = viewOf(bytes), found = new Map();
  const readDirectory = (record, override) => {
    for (let at = record.start; at + 4 <= record.end;) {
      const head = view.getUint32(at, true), first = head & 0xfffff, count = head >>> 20;
      at += 4;
      for (let index = 0; index < count && at + 4 <= record.end; index += 1, at += 4) {
        const id = first + index;
        if (wanted.has(id) && (override || !found.has(id))) found.set(id, view.getUint32(at, true));
      }
    }
  };
  if (edits) for (const edit of edits) { const directory = pptRecordAt(bytes, edit.directoryAt); if (directory?.type === 0x1772) readDirectory(directory, false); }
  else for (const record of top) if (record.type === 0x1772) readDirectory(record, true);
  return found;
}

// The UserEditAtom chain from Current User, newest first; null when it is missing or broken.
function editChain(bytes, currentUser) {
  if (!currentUser || currentUser.length < 20) return null;
  const userView = viewOf(currentUser);
  if (userView.getUint32(12, true) === ENCRYPTED_TOKEN) throw new Error('password-protected PowerPoint presentations are not read');
  const view = viewOf(bytes), edits = [], seen = new Set();
  for (let offset = userView.getUint32(16, true); offset && edits.length < 10_000 && !seen.has(offset);) {
    seen.add(offset);
    const record = pptRecordAt(bytes, offset);
    if (record?.type !== 0x0ff5 || record.end - record.start < 28) return edits.length ? edits : null;
    if (record.end - record.start >= 32 && !edits.length) throw new Error('password-protected PowerPoint presentations are not read');
    edits.push({ directoryAt: view.getUint32(record.start + 12, true), documentId: view.getUint32(record.start + 16, true) });
    offset = view.getUint32(record.start + 8, true);
  }
  return edits.length ? edits : null;
}

function powerPointSections(bytes, currentUser, writer) {
  const top = pptRecords(bytes, 0, bytes.length);
  const view = viewOf(bytes);
  const edits = editChain(bytes, currentUser);
  let document = null;
  if (edits) {
    const documentAt = persistOffsets(bytes, edits, top, new Set([edits[0].documentId])).get(edits[0].documentId);
    const record = pptRecordAt(bytes, documentAt);
    if (record?.type === 0x03e8) document = record;
  }
  document ??= top.find((record) => record.type === 0x03e8) ?? null;
  const slides = [];
  for (const list of document ? pptRecords(bytes, document.start, document.end).filter((record) => record.type === 0x0ff0 && record.instance === 0) : []) {
    for (const child of pptRecords(bytes, list.start, list.end)) {
      if (child.type === 0x03f3 && child.end - child.start >= 4) {
        if (slides.length >= MAX_SLIDES) break;
        slides.push({ persist: view.getUint32(child.start, true), texts: [] });
      } else if (slides.length) { const text = atomText(bytes, child); if (text) slides.at(-1).texts.push(text); }
    }
  }
  // Each slide container is read once and may not start inside one already read; all of them
  // together read at most the stream's size.
  const readRanges = [];
  let scanned = 0;
  const readContainer = (record) => {
    if (!record || record.type !== 0x03ee) return [];
    if (readRanges.some(([start, end]) => record.start - 8 >= start && record.start - 8 < end)) return [];
    scanned += record.end - record.start;
    if (scanned > bytes.length) return null;
    readRanges.push([record.start - 8, record.end]);
    return containerText(bytes, record);
  };
  let hasText = false;
  const write = (index, texts) => {
    const text = texts.join('\n');
    if (text) hasText = true;
    return writer.add(`Slide ${index + 1}`, text);
  };
  if (slides.length) {
    const offsets = persistOffsets(bytes, edits, top, new Set(slides.map((slide) => slide.persist)));
    for (const [index, slide] of slides.entries()) {
      const drawing = readContainer(pptRecordAt(bytes, offsets.get(slide.persist)));
      if (drawing === null) { writer.cut(); break; }
      if (!write(index, [...slide.texts, ...drawing])) break;
    }
  } else {
    let index = 0;
    for (const record of top) {
      if (record.type !== 0x03ee) continue;
      const drawing = readContainer(record);
      if (drawing === null) { writer.cut(); break; }
      if (!write(index, drawing) || (index += 1) >= MAX_SLIDES) break;
    }
  }
  return hasText;
}
