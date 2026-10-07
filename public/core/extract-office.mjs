import {attribute,markupText,markupTokens,paragraphText,textBudget} from './extract-shared.mjs';

// CR-009 readers for ZIP-based documents (XLSX, HWPX, OpenDocument, EPUB), RTF and Jupyter
// notebooks. Each turns the file into readable text sections; none needs a new library.
// read(path) returns an entry's text within the shared expansion budget, or null. Markup is
// scanned in one pass (markupTokens); readers whose output can outgrow their input (column
// padding, repeated cells, space runs) stop at the writer's remaining room and mark the
// result truncated with writer.cut().

const MAX_COLUMNS = 16384;
const MAX_REPEAT = 100;

function columnIndex(reference) {
  if (!reference) return null;
  let index = 0, letters = 0;
  for (const char of reference.toUpperCase()) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90 || letters === 3) break;
    index = index * 26 + (code - 64);
    letters += 1;
  }
  return letters ? index - 1 : null;
}

// Depth counter for an element that may nest: +1 on a start tag, -1 on an end tag.
const nest = (depth, token) => (token.empty ? depth : token.close ? Math.max(0, depth - 1) : depth + 1);

// Some writers (Hancom Cell among them) prefix every element, as in <x:row>; names whose prefix
// is bound to the spreadsheet or relationship namespace are read without it.
const OOXML_NAMESPACES = /xmlns:([\w.-]+)\s*=\s*["'](?:http:\/\/schemas\.openxmlformats\.org\/(?:spreadsheetml\/2006\/main|package\/2006\/relationships)|http:\/\/purl\.oclc\.org\/ooxml\/spreadsheetml\/main)["']/g;
function spreadsheetNames(xml) {
  const prefixes = new Set(Array.from(xml.matchAll(OOXML_NAMESPACES), (match) => match[1]));
  return (name) => {
    const colon = name.indexOf(':');
    return colon > 0 && prefixes.has(name.slice(0, colon)) ? name.slice(colon + 1) : name;
  };
}
const anyLocalName = (name) => name.slice(name.indexOf(':') + 1);
const relationshipId = (tag) => attribute(tag, 'r:id') ?? /\s[\w.-]+:id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag)?.slice(1).find((value) => value !== undefined);

// Text of <t> runs inside a string item, leaving out phonetic guides (<rPh>).
function runCollector() {
  let pieces = [], inText = 0, phonetic = 0;
  return {
    token(token, name) {
      if (token.text !== undefined) { if (inText && !phonetic) pieces.push(token.text); return; }
      if (name === 'rPh') phonetic = nest(phonetic, token);
      else if (name === 't') inText = nest(inText, token);
    },
    take() { const text = pieces.join(''); pieces = []; inText = 0; phonetic = 0; return text; },
  };
}

function sharedStrings(xml) {
  const local = spreadsheetNames(xml);
  const strings = [], runs = runCollector();
  let inItem = false;
  for (const token of markupTokens(xml)) {
    const name = token.text === undefined ? local(token.name) : null;
    if (name === 'si') {
      if (token.empty) strings.push('');
      else if (token.close) { if (inItem) strings.push(runs.take()); inItem = false; }
      else { runs.take(); inItem = true; }
      continue;
    }
    if (inItem) runs.token(token, name);
  }
  return strings;
}

const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const cellText = (value) => value.replace(/[\t\n\r]+/g, ' ');

// One worksheet as tab-separated rows. Values are placed by their column reference; trailing
// empty cells and empty rows are left out.
function worksheetText(xml, shared, budget) {
  const local = spreadsheetNames(xml);
  const runs = runCollector();
  let row = null, cell = null, inValue = 0, inInline = 0, hasRows = false;
  const placeCell = () => {
    let value = '';
    if (cell.type === 'inlineStr') value = runs.take();
    else if (cell.raw.length) {
      const raw = cell.raw.join('');
      value = cell.type === 's' ? (shared[Number(raw)] ?? '') : raw;
      // Numbers are stored with 17 significant digits (298.14999999999998); show 298.15.
      if ((cell.type == null || cell.type === 'n') && NUMBER.test(value)) value = String(Number(value));
    }
    if (!value) return;
    let index = columnIndex(cell.ref) ?? row.column;
    if (index < row.column) index = row.column;
    if (index >= MAX_COLUMNS) return;
    const separators = (row.started ? 1 : 0) + index - row.column;
    if (!row.started) { if (hasRows && !budget.push('\n')) return; row.started = true; hasRows = true; }
    if (separators && !budget.push('\t'.repeat(Math.min(separators, MAX_COLUMNS)))) return;
    budget.push(cellText(value));
    row.column = index + 1;
  };
  for (const token of markupTokens(xml)) {
    if (budget.full) break;
    if (token.text !== undefined) {
      if (cell && inValue) cell.raw.push(token.text);
      else if (cell && inInline) runs.token(token, null);
      continue;
    }
    const name = local(token.name);
    if (name === 'row') {
      row = token.close || token.empty ? null : { column: 0, started: false };
      continue;
    }
    if (!row) continue;
    if (name === 'c') {
      if (token.close) { if (cell) placeCell(); cell = null; }
      else if (!token.empty) { cell = { ref: attribute(token.raw, 'r'), type: attribute(token.raw, 't'), raw: [] }; inValue = 0; inInline = 0; runs.take(); }
      continue;
    }
    if (!cell) continue;
    if (name === 'v') inValue = nest(inValue, token);
    else if (name === 'is') inInline = nest(inInline, token);
    else if (inInline) runs.token(token, name);
  }
  return hasRows;
}

export async function xlsxSections(read, writer) {
  const workbook = await read('xl/workbook.xml') ?? '';
  const relations = await read('xl/_rels/workbook.xml.rels') ?? '';
  const workbookName = spreadsheetNames(workbook), relationName = spreadsheetNames(relations);
  const targets = new Map();
  for (const token of markupTokens(relations)) {
    if (token.name && !token.close && relationName(token.name) === 'Relationship') targets.set(attribute(token.raw, 'Id'), attribute(token.raw, 'Target'));
  }
  const sheets = [];
  for (const token of markupTokens(workbook)) {
    if (token.name && !token.close && workbookName(token.name) === 'sheet') sheets.push({ name: attribute(token.raw, 'name') ?? 'Sheet', target: targets.get(relationshipId(token.raw)) });
  }
  const sharedXml = await read('xl/sharedStrings.xml');
  const shared = sharedXml == null ? [] : sharedStrings(sharedXml);
  let hasText = false;
  for (const sheet of sheets) {
    if (!sheet.target) continue;
    const path = sheet.target.startsWith('/') ? sheet.target.slice(1) : `xl/${sheet.target.replace(/^\.\//, '')}`;
    const xml = await read(path);
    if (xml == null) continue;
    const budget = textBudget(writer.remaining + 1);
    if (worksheetText(xml, shared, budget)) hasText = true;
    if (!writer.add(`Sheet: ${sheet.name}`, budget.text) || budget.full) { writer.cut(); break; }
  }
  return hasText;
}

export async function hwpxSections(zip, read, writer) {
  const sections = Object.keys(zip.files)
    .map((path) => ({ path, match: /^Contents\/section(\d+)\.xml$/i.exec(path) }))
    .filter(({ match }) => match)
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));
  let hasText = false;
  for (const [index, section] of sections.entries()) {
    const text = paragraphText(await read(section.path) ?? '', 'hp:p', 'hp');
    if (text) hasText = true;
    if (!writer.add(`Section ${index + 1}`, text)) break;
  }
  return hasText;
}

// OpenDocument paragraphs (<text:p>, <text:h>) with their spans flattened and spaces, tabs and
// line breaks kept. A paragraph nested in another (a note) is listed where it appears.
function odfParagraphs(budget) {
  let depth = 0, pieces = [], length = 0, hasText = false;
  const room = () => budget.limit + 1 - budget.length - length;
  const add = (text) => {
    const left = room();
    if (left <= 0) return;
    const piece = text.length > left ? text.slice(0, left) : text;
    pieces.push(piece);
    length += piece.length;
  };
  const flush = () => {
    const text = pieces.join('');
    pieces = [];
    length = 0;
    if (!text.trim()) return;
    hasText = true;
    if (budget.length) budget.push('\n');
    budget.push(text);
  };
  return {
    get open() { return depth > 0; },
    get hasText() { return hasText; },
    get full() { return budget.full || room() <= 0; },
    token(token) {
      if (token.text !== undefined) { if (depth) add(token.text); return; }
      const name = token.name;
      if (name === 'text:p' || name === 'text:h') {
        if (token.empty) return;
        if (depth) flush();
        depth = nest(depth, token);
        return;
      }
      if (!depth || token.close) return;
      if (name === 'text:s') add(' '.repeat(Math.min(Number(attribute(token.raw, 'text:c') ?? 1) || 1, 1000)));
      else if (name === 'text:tab') add('\t');
      else if (name === 'text:line-break') add('\n');
    },
    finish() { if (depth || pieces.length) flush(); depth = 0; },
  };
}

function boundedBudget(limit) {
  const budget = textBudget(limit);
  return Object.assign(budget, { limit });
}

function odtText(xml, writer) {
  const budget = boundedBudget(writer.remaining + 1);
  const paragraphs = odfParagraphs(budget);
  for (const token of markupTokens(xml)) {
    if (paragraphs.full) break;
    paragraphs.token(token);
  }
  const cut = paragraphs.full;
  paragraphs.finish();
  writer.add('Document', budget.text);
  if (cut || budget.full) writer.cut();
  return paragraphs.hasText;
}

function odpText(xml, writer) {
  let slide = 0, page = null, hasText = false;
  for (const token of markupTokens(xml)) {
    if (token.name === 'draw:page' && !token.empty) {
      if (token.close) {
        if (!page) continue;
        page.paragraphs.finish();
        if (page.paragraphs.hasText) hasText = true;
        slide += 1;
        const fits = writer.add(`Slide ${slide}`, page.budget.text);
        page = null;
        if (!fits) { writer.cut(); break; }
      } else {
        const budget = boundedBudget(writer.remaining + 1);
        page = { budget, paragraphs: odfParagraphs(budget) };
      }
      continue;
    }
    if (!page) continue;
    if (page.paragraphs.full) {
      page.paragraphs.finish();
      writer.add(`Slide ${slide + 1}`, page.budget.text);
      writer.cut();
      return hasText || page.paragraphs.hasText;
    }
    page.paragraphs.token(token);
  }
  return hasText;
}

function odsText(xml, writer) {
  let table = null, depth = 0, row = null, cell = null, hasText = false;
  const placeCell = (value, repeat) => {
    const text = cellText(value);
    const copies = text ? Math.min(repeat, MAX_REPEAT) : 0;
    for (let copy = 0; copy < copies && row.column < MAX_COLUMNS && !table.budget.full; copy += 1) {
      if (!row.started) { if (table.hasRows) table.budget.push('\n'); row.started = true; table.hasRows = true; }
      const separators = (row.written ? 1 : 0) + row.column - row.next;
      if (separators) table.budget.push('\t'.repeat(Math.min(separators, MAX_COLUMNS)));
      table.budget.push(text);
      row.written = true;
      row.column += 1;
      row.next = row.column;
    }
    row.column = Math.min(MAX_COLUMNS, row.column + (repeat - copies));
  };
  for (const token of markupTokens(xml)) {
    if (token.name === 'table:table') {
      if (token.empty) continue;
      if (!token.close) {
        depth += 1;
        if (depth === 1) table = { name: attribute(token.raw, 'table:name') ?? 'Sheet', budget: textBudget(writer.remaining + 1), hasRows: false };
        continue;
      }
      depth = Math.max(0, depth - 1);
      if (depth || !table) continue;
      if (table.hasRows) hasText = true;
      const fits = writer.add(`Sheet: ${table.name}`, table.budget.text);
      const full = table.budget.full;
      table = null;
      if (!fits || full) { writer.cut(); break; }
      continue;
    }
    if (!table || depth !== 1) continue;
    if (table.budget.full) continue;
    if (token.name === 'table:table-row') {
      row = token.close || token.empty ? null : { column: 0, next: 0, started: false, written: false };
      continue;
    }
    if (!row) continue;
    if (token.name === 'table:table-cell' || token.name === 'table:covered-table-cell') {
      if (token.close) { if (cell) { cell.paragraphs.finish(); placeCell(cell.budget.text.replace(/\n/g, ' '), cell.repeat); } cell = null; continue; }
      const repeat = Math.max(1, Math.min(Number(attribute(token.raw, 'table:number-columns-repeated') ?? 1) || 1, MAX_COLUMNS));
      if (token.empty) { row.column = Math.min(MAX_COLUMNS, row.column + repeat); continue; }
      const budget = boundedBudget(writer.remaining + 1);
      cell = { repeat, budget, paragraphs: odfParagraphs(budget) };
      continue;
    }
    if (cell) cell.paragraphs.token(token);
  }
  return hasText;
}

export async function odfSections(kind, read, writer) {
  const xml = await read('content.xml');
  if (xml == null) return false;
  if (kind === 'odt') return odtText(xml, writer);
  if (kind === 'ods') return odsText(xml, writer);
  return odpText(xml, writer);
}

function resolvePath(base, href) {
  const parts = base.split('/').slice(0, -1);
  let target = href.split('#')[0];
  try { target = decodeURI(target); } catch { /* keep the raw href */ }
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

export async function epubSections(read, writer) {
  let opfPath = null;
  for (const token of markupTokens(await read('META-INF/container.xml') ?? '')) {
    if (token.name && !token.close && anyLocalName(token.name) === 'rootfile') { opfPath = attribute(token.raw, 'full-path'); break; }
  }
  const opf = opfPath ? await read(opfPath) : null;
  if (!opf) return false;
  const manifest = new Map(), spine = [];
  for (const token of markupTokens(opf)) {
    if (!token.name || token.close) continue;
    const name = anyLocalName(token.name);
    if (name === 'item') manifest.set(attribute(token.raw, 'id'), attribute(token.raw, 'href'));
    else if (name === 'itemref') spine.push(attribute(token.raw, 'idref'));
  }
  let hasText = false;
  for (const [index, href] of spine.map((id) => manifest.get(id)).filter(Boolean).entries()) {
    const text = markupText(await read(resolvePath(opfPath, href)) ?? '');
    if (text) hasText = true;
    if (!writer.add(`Section ${index + 1}`, text)) break;
  }
  return hasText;
}

// RTF: a 7-bit control-word stream. Destinations that hold no document text are skipped;
// \'hh bytes are decoded with the font's code page and \uN gives Unicode directly.
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'object', 'objdata', 'fldinst', 'filetbl', 'revtbl', 'pgdsctbl', 'mmathPr', 'wgrffmtfilter', 'userprops', 'docvar', 'bkmkstart', 'bkmkend']);
const RTF_SYMBOLS = { par: '\n', line: '\n', sect: '\n', page: '\n', row: '\n', tab: '\t', cell: '\t', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ' };
const CODE_PAGES = { 949: 'euc-kr', 932: 'shift_jis', 936: 'gbk', 950: 'big5', 65001: 'utf-8', 874: 'windows-874' };
const MAX_RTF_DEPTH = 512;
const MAX_CONTROL_WORD = 32;
const MAX_CONTROL_DIGITS = 10;

// Font character sets (\fcharsetN) to code pages; charset 2 is the Symbol font.
const CHARSET_PAGES = { 0: 1252, 128: 932, 129: 949, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250 };
const SYMBOL_CHARSET = 2;
const SYMBOL_BYTES = { 0xb7: '•' };
const pageLabel = (page) => CODE_PAGES[page] ?? (page >= 1250 && page <= 1258 ? `windows-${page}` : null);

// Bytes are decoded with the code page of the font in use (PowerPoint writes bullets as \'95
// in a Western font inside a Korean document), falling back to the document's \ansicpg.
function rtfDecoders(bytes) {
  const prefix = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 262144)));
  const decoders = new Map();
  const decoder = (label) => {
    if (!decoders.has(label)) { try { decoders.set(label, new TextDecoder(label)); } catch { decoders.set(label, null); } }
    return decoders.get(label);
  };
  const documentDecoder = decoder(pageLabel(Number(/\\ansicpg(\d+)/.exec(prefix)?.[1] ?? 1252)) ?? 'windows-1252') ?? decoder('windows-1252');
  const fonts = new Map([...prefix.matchAll(/\{\\f(\d+)(?=[\\\s;])[^{};]*?\\fcharset(\d+)/g)].map((match) => [Number(match[1]), Number(match[2])]));
  const defaultFont = Number(/\\deff(\d+)/.exec(prefix)?.[1] ?? Number.NaN);
  const forFont = (font) => {
    const charset = fonts.get(font);
    if (charset === SYMBOL_CHARSET) return null;
    const label = charset === undefined ? null : pageLabel(CHARSET_PAGES[charset]);
    return (label && decoder(label)) || documentDecoder;
  };
  return { defaultFont, decode(font, pending) {
    const fontDecoder = forFont(font);
    if (fontDecoder) return fontDecoder.decode(new Uint8Array(pending));
    return pending.map((byte) => SYMBOL_BYTES[byte] ?? (byte < 0x80 ? String.fromCharCode(byte) : '')).join('');
  } };
}

const isLetter = (byte) => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
const isDigit = (byte) => byte >= 48 && byte <= 57;

// Text of an RTF document. Reading stops once the text passes maxChars; `truncated` says so
// even when trimming line ends afterwards brings the text back under the limit.
export function rtfText(bytes, maxChars = Infinity) {
  const decoders = rtfDecoders(bytes);
  const fresh = () => ({ skip: false, uc: 1, font: decoders.defaultFont });
  let output = '', pending = [], stack = [], state = fresh(), skipChars = 0, groupStart = false;
  const flush = () => { if (pending.length) { output += decoders.decode(state.font, pending); pending = []; } };
  const emit = (text) => { flush(); if (!state.skip) output += text; };
  let index = 0;
  for (; index < bytes.length && output.length <= maxChars; index += 1) {
    const byte = bytes[index];
    if (byte === 123) { // {
      flush();
      if (stack.length >= MAX_RTF_DEPTH) throw new Error('RTF groups are nested too deeply');
      stack.push(state); state = { ...state }; groupStart = true; skipChars = 0;
      continue;
    }
    if (byte === 125) { flush(); state = stack.pop() ?? fresh(); groupStart = false; skipChars = 0; continue; } // }
    if (byte === 92) { // backslash
      const next = bytes[index + 1] ?? 0;
      if (next === 92 || next === 123 || next === 125) { index += 1; if (skipChars) skipChars -= 1; else if (!state.skip) pending.push(next); groupStart = false; continue; }
      if (next === 39) { // \'hh
        const value = Number.parseInt(String.fromCharCode(bytes[index + 2] ?? 0, bytes[index + 3] ?? 0), 16);
        index += 3;
        if (skipChars) skipChars -= 1; else if (!state.skip && Number.isFinite(value)) pending.push(value);
        groupStart = false;
        continue;
      }
      if (next === 42) { index += 1; state.skip = true; continue; } // \*
      if (next === 126) { index += 1; emit(' '); continue; } // \~
      if (next === 95) { index += 1; emit('-'); continue; } // \_
      if (next === 45 || next === 10 || next === 13) { index += 1; if (next !== 45) emit('\n'); continue; }
      let end = index + 1;
      while (end < bytes.length && end - index <= MAX_CONTROL_WORD && isLetter(bytes[end])) end += 1;
      if (end === index + 1) { index += 1; groupStart = false; continue; } // other control symbols
      const word = String.fromCharCode(...bytes.subarray(index + 1, end));
      let numberEnd = end;
      if (bytes[numberEnd] === 45) numberEnd += 1;
      const digitsStart = numberEnd;
      while (numberEnd < bytes.length && numberEnd - digitsStart < MAX_CONTROL_DIGITS && isDigit(bytes[numberEnd])) numberEnd += 1;
      const parameter = numberEnd > digitsStart ? Number(String.fromCharCode(...bytes.subarray(end, numberEnd))) : null;
      index = numberEnd - 1;
      if (bytes[numberEnd] === 32) index += 1;
      if (word === 'bin' && parameter > 0) { flush(); index += Math.min(parameter, bytes.length); groupStart = false; continue; }
      if (skipChars) { skipChars -= 1; groupStart = false; continue; } // a control word in a \uN fallback
      if (groupStart && RTF_SKIP.has(word)) state.skip = true;
      groupStart = false;
      if (word === 'u' && parameter != null) { emit(String.fromCharCode(parameter < 0 ? parameter + 65536 : parameter)); skipChars = state.uc; continue; }
      if (word === 'uc' && parameter != null) { state.uc = parameter; continue; }
      if (word === 'f' && parameter != null) { flush(); state.font = parameter; continue; }
      if (word === 'plain') { flush(); state.font = decoders.defaultFont; continue; }
      if (Object.hasOwn(RTF_SYMBOLS, word)) emit(RTF_SYMBOLS[word]);
      continue;
    }
    groupStart = false;
    if (byte === 13 || byte === 10) continue;
    if (skipChars) { skipChars -= 1; continue; }
    // Long plain runs are decoded in pieces, split after an ASCII byte so no double-byte character is cut.
    if (!state.skip) { pending.push(byte); if (pending.length >= 65536 && (byte < 0x80 || pending.length >= 1 << 20)) flush(); }
  }
  flush();
  const text = output.split('\n').map((line) => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, truncated: index < bytes.length };
}

// Jupyter notebook: cell sources in order with their text outputs; images are only noted.
const joined = (value) => (Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : '');
export function notebookSections(notebook, writer) {
  const cells = Array.isArray(notebook?.cells) ? notebook.cells : null;
  if (!cells) return false;
  let hasText = false;
  for (const [index, cell] of cells.entries()) {
    const parts = [joined(cell?.source)];
    for (const output of Array.isArray(cell?.outputs) ? cell.outputs : []) {
      if (output?.output_type === 'stream') parts.push(joined(output.text));
      else if (output?.output_type === 'error') parts.push(`${output.ename ?? 'Error'}: ${output.evalue ?? ''}`);
      else if (output?.data && typeof output.data === 'object') {
        if (output.data['text/plain'] !== undefined) parts.push(joined(output.data['text/plain']));
        if (Object.keys(output.data).some((type) => type.startsWith('image/'))) parts.push('[image output omitted]');
      }
    }
    const text = parts.map((part) => part.trimEnd()).filter(Boolean).join('\n');
    if (text) hasText = true;
    if (!writer.add(`Cell ${index + 1} (${typeof cell?.cell_type === 'string' ? cell.cell_type : 'cell'})`, text)) break;
  }
  return hasText;
}

// SpreadsheetML 2003 (Excel XML, often saved with an .xls name by exporting systems): each
// Worksheet's rows of cells; a cell's ss:Index gives its 1-based column.
export function spreadsheetMlSections(xml, writer) {
  let sheet = null, row = null, cell = null, inData = 0, hasText = false;
  const finishSheet = () => {
    if (!sheet) return true;
    const fits = writer.add(`Sheet: ${sheet.name}`, sheet.budget.text), full = sheet.budget.full;
    sheet = null;
    if (!fits || full) { writer.cut(); return false; }
    return true;
  };
  for (const token of markupTokens(xml)) {
    if (token.text !== undefined) { if (cell && inData) cell.parts.push(token.text); continue; }
    const name = anyLocalName(token.name);
    if (name === 'Worksheet') {
      if (token.empty) continue;
      if (!finishSheet()) return hasText;
      if (!token.close) sheet = { name: attribute(token.raw, 'ss:Name') ?? 'Sheet', budget: textBudget(writer.remaining + 1), firstRow: true };
      continue;
    }
    if (!sheet || sheet.budget.full) continue;
    if (name === 'Row') {
      if (token.close || token.empty) {
        if (row?.line) { sheet.budget.push((sheet.firstRow ? '' : '\n') + row.line); sheet.firstRow = false; hasText = true; }
        row = null;
      } else row = { line: '', column: -1, next: 0 };
      continue;
    }
    if (!row) continue;
    if (name === 'Cell') {
      if (token.close) {
        const value = cell ? cellText(cell.parts.join('')) : '';
        const room = writer.remaining + 1 - sheet.budget.length - row.line.length;
        if (cell && value && room > 0 && cell.col < MAX_COLUMNS) {
          row.line += '\t'.repeat(row.column < 0 ? cell.col : cell.col - row.column) + value.slice(0, room);
          row.column = cell.col;
        }
        cell = null;
      } else {
        const index = Number(attribute(token.raw, 'ss:Index'));
        const col = Number.isInteger(index) && index >= 1 ? Math.max(index - 1, row.next) : row.next;
        row.next = col + 1;
        cell = token.empty ? null : { col, parts: [] };
      }
      continue;
    }
    if (name === 'Data') inData = nest(inData, token);
  }
  finishSheet();
  return hasText;
}
