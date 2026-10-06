import { MAX_EXTRACTED_CHARS, MAX_PDF_PAGES, TEXT_BASED_FORMATS, connectedFormat, extractConnectedText } from './extract.mjs?v=formats-1';

const HASH = /^[a-f0-9]{64}$/;

function validateFile(file) {
  if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size) || file.size < 0 || typeof file.slice !== 'function') {
    throw new TypeError('A browser File or File-like object is required.');
  }
}

// Byte ranges for text (and the raw text of RTF and notebooks) and page ranges for PDF; other
// formats are read whole.
function selectedFormat(file) {
  const { format } = connectedFormat(file);
  return TEXT_BASED_FORMATS.has(format) ? 'text' : format === 'pdf' ? 'pdf' : null;
}

function unavailable(file, reason, bytesRead = 0) {
  return { status: 'unavailable', text: '', bytesRead, size: file.size, reason };
}

function validateTextSelection(file, selection) {
  const start = selection.start;
  if (!Number.isInteger(start) || start < 0 || start >= file.size) throw new RangeError('Text view start is outside the source.');
  const hasEnd = selection.end !== undefined;
  if (hasEnd && selection.maxBytes !== undefined) throw new RangeError('Text view uses either end or maxBytes, not both.');
  if (hasEnd) {
    if (!Number.isInteger(selection.end) || selection.end <= start || selection.end > file.size) throw new RangeError('Text view end is outside the source.');
    if (selection.end - start > MAX_EXTRACTED_CHARS) throw new RangeError('Text view cannot exceed 200000 raw bytes.');
    return { start, end: selection.end, exact: true };
  }
  const maxBytes = selection.maxBytes ?? MAX_EXTRACTED_CHARS;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_EXTRACTED_CHARS) throw new RangeError('Text view maxBytes must be 1 to 200000.');
  return { start, end: Math.min(file.size, start + maxBytes), exact: false };
}

function continuation(byte) {
  return byte >= 0x80 && byte <= 0xbf;
}

function validUtf8Prefix(bytes) {
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index];
    if (lead <= 0x7f) { index += 1; continue; }
    let length;
    if (lead >= 0xc2 && lead <= 0xdf) length = 2;
    else if (lead >= 0xe0 && lead <= 0xef) length = 3;
    else if (lead >= 0xf0 && lead <= 0xf4) length = 4;
    else throw new TypeError('Selected text is not valid UTF-8.');
    const available = bytes.length - index;
    const checkCount = Math.min(length, available);
    for (let offset = 1; offset < checkCount; offset += 1) {
      const byte = bytes[index + offset];
      if (!continuation(byte)) throw new TypeError('Selected text is not valid UTF-8.');
      if (offset === 1) {
        if (lead === 0xe0 && byte < 0xa0) throw new TypeError('Selected text is not valid UTF-8.');
        if (lead === 0xed && byte > 0x9f) throw new TypeError('Selected text is not valid UTF-8.');
        if (lead === 0xf0 && byte < 0x90) throw new TypeError('Selected text is not valid UTF-8.');
        if (lead === 0xf4 && byte > 0x8f) throw new TypeError('Selected text is not valid UTF-8.');
      }
    }
    if (available < length) return index;
    index += length;
  }
  return index;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function extractTextView(file, selection) {
  const range = validateTextSelection(file, selection);
  const bytes = new Uint8Array(await file.slice(range.start, range.end).arrayBuffer());
  let skipped = 0;
  if (!range.exact) {
    while (skipped < bytes.length && skipped < 3 && continuation(bytes[skipped])) skipped += 1;
  }
  if (skipped < bytes.length && continuation(bytes[skipped])) {
    return unavailable(file, 'Selected text does not begin at a valid UTF-8 boundary.', bytes.byteLength);
  }
  let prefix;
  try { prefix = validUtf8Prefix(bytes.subarray(skipped)); }
  catch (error) { return unavailable(file, error.message, bytes.byteLength); }
  if (range.exact && prefix !== bytes.byteLength - skipped) {
    return unavailable(file, 'Saved text view no longer ends at a valid UTF-8 boundary.', bytes.byteLength);
  }
  if (prefix === 0) return unavailable(file, 'Selected text contains no complete UTF-8 characters.', bytes.byteLength);
  const selected = bytes.subarray(skipped, skipped + prefix);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(selected); }
  catch { return unavailable(file, 'Selected text is not valid UTF-8.', bytes.byteLength); }
  const start = range.start + skipped;
  const end = start + prefix;
  const hash = await sha256(text);
  const view = { kind: 'text-byte-range', start, end, sha256: hash };
  const coverage = {
    kind: view.kind, sourceSize: file.size, partial: start !== 0 || end !== file.size,
    method: 'utf8_text', start, end, sha256: hash,
  };
  return { status: 'available', text, bytesRead: bytes.byteLength, size: file.size, coverage, view };
}

function validatePdfSelection(selection) {
  const { startPage, endPage } = selection;
  if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage) {
    throw new RangeError('PDF view requires a valid inclusive page range.');
  }
  if (endPage - startPage + 1 > MAX_PDF_PAGES) throw new RangeError('PDF view cannot exceed 100 pages.');
  return { startPage, endPage };
}

async function extractPdfView(file, selection, options) {
  const pages = validatePdfSelection(selection);
  const extracted = await extractConnectedText(file, { ...options, pdfPages: pages });
  const { pdfPages, ...result } = extracted;
  if (result.status !== 'available' || !pdfPages) return result;
  const hash = await sha256(result.text);
  const view = { kind: 'pdf-pages', startPage: pages.startPage, endPage: pages.endPage, sha256: hash };
  const coverage = {
    kind: view.kind, sourceSize: file.size,
    partial: pages.startPage !== 1 || pages.endPage !== pdfPages.totalPages,
    method: 'pdf_embedded_text', startPage: pages.startPage, endPage: pages.endPage, totalPages: pdfPages.totalPages, sha256: hash,
  };
  return { ...result, coverage, view };
}

export async function extractSourceView(file, selection, options = {}) {
  if (selection == null) return extractConnectedText(file, options);
  validateFile(file);
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new TypeError('Source view selection is required.');
  const format = selectedFormat(file);
  if (selection.kind === 'text-byte-range') {
    if (format !== 'text') return unavailable(file, 'Text byte ranges require a supported UTF-8 text file.');
    return extractTextView(file, selection);
  }
  if (selection.kind === 'pdf-pages') {
    if (format !== 'pdf') return unavailable(file, 'PDF page views require a PDF file.');
    return extractPdfView(file, selection, options);
  }
  throw new RangeError('Unsupported source view selection kind.');
}

export async function verifySourceView(file, savedView, options = {}) {
  if (!savedView || typeof savedView !== 'object' || !HASH.test(savedView.sha256 ?? '')) {
    throw new TypeError('Saved source view metadata is invalid.');
  }
  const extracted = await extractSourceView(file, savedView, options);
  const sameBounds = savedView.kind === 'text-byte-range'
    ? extracted.view?.start === savedView.start && extracted.view?.end === savedView.end
    : savedView.kind === 'pdf-pages'
      ? extracted.view?.startPage === savedView.startPage && extracted.view?.endPage === savedView.endPage
      : false;
  if (extracted.status !== 'available' || !sameBounds || extracted.view.sha256 !== savedView.sha256) {
    throw new Error('Connected source view changed; select the range again.');
  }
  return extracted;
}
