import { MAX_COMPRESSED_BYTES } from './extract-shared.mjs';
import { STORAGE, STREAM, compoundFile as readCompoundFile } from './cfb.mjs';

const compoundFile = (bytes) => readCompoundFile(bytes, { label: 'HWP' });

// HWP 5.0 binary documents. The file is a compound file (CFB, the container of older Office
// files); body text is in BodyText/Section0, Section1, ... streams, raw-deflated when the
// FileHeader says so, as records whose PARA_TEXT payload is UTF-16 text with control codes.
// Every length, chain and expansion is bounded so a damaged file fails instead of looping.

function damaged(detail) {
  return new Error(`the HWP file is damaged (${detail})`);
}

// Raw inflate within a byte budget. Hancom's writer leaves bytes after the deflate stream in
// nearly every section, which browsers report as an error after all output; the output is then
// kept (complete: false) and the caller checks that it ends on a record boundary.
async function inflateRaw(bytes, budget) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0, complete = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > budget) {
        await reader.cancel().catch(() => {});
        throw new RangeError('expanded HWP text exceeds the 30 MiB safety limit');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RangeError || !chunks.length) throw error;
    complete = false;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return { data: out, complete };
}

// Control codes below 32: these take eight code units (code, six of data, code again).
const WIDE_CONTROLS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
const PARA_TEXT = 67;
const MAX_SECTIONS = 1000;

function paragraphText(data) {
  const units = [];
  for (let offset = 0; offset + 1 < data.length;) {
    const code = data[offset] | (data[offset + 1] << 8);
    if (code >= 32) { units.push(code); offset += 2; continue; }
    if (WIDE_CONTROLS.has(code)) {
      if (code === 9) units.push(9);
      offset += 16;
      continue;
    }
    if (code === 10) units.push(10);
    else if (code === 24) units.push(45);
    else if (code === 30 || code === 31) units.push(32);
    offset += 2;
  }
  let text = '';
  for (let index = 0; index < units.length; index += 8192) text += String.fromCharCode(...units.slice(index, index + 8192));
  return text;
}

// Paragraph text of one section, and whether its records end exactly at the end of the data.
function sectionParagraphs(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const paragraphs = [];
  let offset = 0;
  while (offset + 4 <= data.length) {
    const header = view.getUint32(offset, true);
    offset += 4;
    let size = header >>> 20;
    if (size === 0xfff) {
      if (offset + 4 > data.length) return { text: paragraphs.join('\n'), exact: false };
      size = view.getUint32(offset, true);
      offset += 4;
    }
    if (offset + size > data.length) return { text: paragraphs.join('\n'), exact: false };
    if ((header & 0x3ff) === PARA_TEXT) {
      const text = paragraphText(data.subarray(offset, offset + size));
      if (text.trim()) paragraphs.push(text.trimEnd());
    }
    offset += size;
  }
  return { text: paragraphs.join('\n'), exact: offset === data.length };
}

export async function hwpSections(bytes, writer) {
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 23)).startsWith('HWP Document File V3')) {
    throw new Error('HWP 3.0 documents are not read; save it as .hwpx or HWP 5.0 (.hwp)');
  }
  const file = compoundFile(bytes);
  const headerId = file.named(0, 'FileHeader', STREAM);
  const header = headerId === undefined ? null : file.read(headerId);
  if (!header || header.length < 40 || new TextDecoder('latin1').decode(header.subarray(0, 17)) !== 'HWP Document File') {
    throw damaged('no HWP 5.0 file header');
  }
  const flags = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(36, true);
  if (flags & 2) throw new Error('password-protected HWP documents are not read');
  if (flags & 4) throw new Error('distribution-only HWP documents are not read');
  const body = file.named(0, 'BodyText', STORAGE);
  const sections = (body === undefined ? [] : file.children(body))
    .map((id) => ({ id, match: /^Section(\d+)$/i.exec(file.entries[id].name) }))
    .filter(({ id, match }) => match && file.entries[id].type === STREAM)
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));
  if (!sections.length) throw damaged('no body text sections');
  if (sections.length > MAX_SECTIONS) throw damaged(`more than ${MAX_SECTIONS} body text sections`);
  // Stored and expanded bytes share one budget, so sections pointing at the same large stream
  // or holding empty deflate blocks cannot multiply the work. Sections read before the budget
  // runs out are kept and the result is marked truncated.
  let budget = MAX_COMPRESSED_BYTES, hasText = false;
  const spend = (bytes) => {
    budget -= bytes;
    if (budget < 0) throw new RangeError('HWP sections exceed the 30 MiB safety limit');
  };
  for (const [index, section] of sections.entries()) {
    let data, complete = true;
    try {
      data = file.read(section.id);
      spend(data.length);
      if (flags & 1) {
        ({ data, complete } = await inflateRaw(data, budget));
        spend(data.length);
      }
    } catch (error) {
      if (error instanceof RangeError && index > 0) { writer.cut(); break; }
      throw error;
    }
    const { text, exact } = sectionParagraphs(data);
    if (!complete && !exact) throw damaged('a compressed section ends in the middle of a record');
    if (text) hasText = true;
    if (!writer.add(`Section ${index + 1}`, text)) break;
  }
  return hasText;
}
