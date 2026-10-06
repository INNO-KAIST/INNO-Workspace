import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {
  MAX_COMPRESSED_BYTES,
  MAX_PDF_PAGES,
  extractConnectedText,
  extractPowerPointXml,
  extractWordXml,
  readZipEntryText,
} from '../public/core/extract.mjs';

function namedBlob(name, parts, type) {
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

test('plain text extraction bounds the read and reports character truncation', async () => {
  const blob = namedBlob('notes.txt', ['한'.repeat(12)], 'text/plain');
  let sliceEnd = null;
  const file = {
    name: blob.name, type: blob.type, size: blob.size,
    slice(start, end) { sliceEnd = end; return blob.slice(start, end); },
  };

  const result = await extractConnectedText(file, { maxChars: 5 });

  assert.equal(result.status, 'truncated');
  assert.equal(result.text, '한한한한한');
  assert.ok(sliceEnd <= 24);
  assert.equal(result.bytesRead, 24);
  assert.equal(result.size, 36);
});

test('plain text below the limit is available', async () => {
  const result = await extractConnectedText(namedBlob('notes.md', ['line one\nline two'], 'text/markdown'));
  assert.deepEqual(result, {
    status: 'available', text: 'line one\nline two', bytesRead: 17, size: 17,
  });
});

test('PDF extraction uses ordered page markers and caps work at 100 pages', async () => {
  let requestedPages = 0;
  const pdfDocument = {
    numPages: MAX_PDF_PAGES + 5,
    async getPage(number) {
      requestedPages += 1;
      return { async getTextContent() { return { items: [{ str: `page ${number}` }] }; } };
    },
    async destroy() {},
  };
  const pdfjs = { GlobalWorkerOptions: {}, getDocument() { return { promise: Promise.resolve(pdfDocument) }; } };
  const file = namedBlob('paper.pdf', ['%PDF fixture'], 'application/pdf');

  const result = await extractConnectedText(file, { pdfjs, maxChars: 200_000 });

  assert.equal(result.status, 'truncated');
  assert.match(result.text, /^--- Page 1 ---\npage 1/);
  assert.match(result.text, /--- Page 100 ---\npage 100$/);
  assert.equal(requestedPages, MAX_PDF_PAGES);
});

test('image-only PDFs explicitly report that OCR is unavailable', async () => {
  const pdfDocument = {
    numPages: 1,
    async getPage() { return { async getTextContent() { return { items: [] }; } }; },
    async destroy() {},
  };
  const pdfjs = { GlobalWorkerOptions: {}, getDocument() { return { promise: Promise.resolve(pdfDocument) }; } };

  const result = await extractConnectedText(namedBlob('scan.pdf', ['pdf'], 'application/pdf'), { pdfjs });

  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /OCR.*not supported/i);
});

test('parser selection rejects conflicting MIME and extension while allowing generic MIME fallback', async () => {
  let parserCalls = 0;
  const pdfDocument = {
    numPages: 1,
    async getPage() { return { async getTextContent() { return { items: [{ str: 'paper text' }] }; } }; },
    async destroy() {},
  };
  const pdfjs = {
    GlobalWorkerOptions: {},
    getDocument() { parserCalls += 1; return { promise: Promise.resolve(pdfDocument) }; },
  };

  const conflict = await extractConnectedText(namedBlob('paper.pdf', ['not a pdf'], 'text/plain'), { pdfjs });
  const generic = await extractConnectedText(namedBlob('paper.pdf', ['pdf'], 'application/octet-stream'), { pdfjs });

  assert.equal(conflict.status, 'unavailable');
  assert.match(conflict.reason, /MIME.*extension/i);
  assert.equal(generic.status, 'available');
  assert.equal(parserCalls, 1);
});

test('Word and PowerPoint XML extraction decodes text and preserves structure markers', () => {
  const word = extractWordXml('<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>A &amp; B</w:t></w:r><w:r><w:tab/><w:t>C</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t><w:br/><w:t>line</w:t></w:r></w:p></w:body></w:document>');
  const slide = extractPowerPointXml('<p:sld><p:cSld><a:p><a:r><a:t>Title</a:t></a:r></a:p><a:p><a:r><a:t>Body &lt;value&gt;</a:t></a:r></a:p></p:cSld></p:sld>');
  const formattedRuns = extractWordXml('<w:document><w:body><w:p><w:r><w:t xml:space="preserve"> Leading </w:t></w:r><w:r><w:t>middle</w:t></w:r><w:r><w:t xml:space="preserve"> trailing </w:t></w:r></w:p></w:body></w:document>');

  assert.equal(word, 'A & B\tC\nSecond\nline');
  assert.equal(slide, 'Title\nBody <value>');
  assert.equal(formattedRuns, ' Leading middle trailing ');
});

test('DOCX and PPTX extract actual vendored JSZip archives in document order', async () => {
  const JSZip = vendoredJsZip();
  const docxZip = new JSZip();
  docxZip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>');
  const docx = namedBlob('report.docx', [await docxZip.generateAsync({ type: 'uint8array' })], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const pptxZip = new JSZip();
  pptxZip.file('ppt/slides/slide10.xml', '<p:sld><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:sld>');
  pptxZip.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>');
  pptxZip.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>');
  const pptx = namedBlob('slides.pptx', [await pptxZip.generateAsync({ type: 'uint8array' })], 'application/vnd.openxmlformats-officedocument.presentationml.presentation');

  assert.equal((await extractConnectedText(docx, { JSZip })).text, '--- Document ---\nFirst paragraph\nSecond paragraph');
  assert.equal((await extractConnectedText(pptx, { JSZip })).text, '--- Slide 1 ---\nFirst\n\n--- Slide 2 ---\nSecond\n\n--- Slide 10 ---\nTenth');
});

test('ZIP entry extraction stops streaming before an unknown-size entry can allocate past its bound', async () => {
  let paused = false;
  const handlers = {};
  const stream = {
    on(event, handler) { handlers[event] = handler; return this; },
    pause() { paused = true; },
    resume() {
      handlers.data(new Uint8Array([65, 66, 67]));
      handlers.data(new Uint8Array([68, 69, 70]));
      if (!paused) handlers.end();
    },
  };
  const entry = {
    _data: {},
    internalStream(format) {
      assert.equal(format, 'uint8array');
      return stream;
    },
    async async() { throw new Error('unbounded allocation attempted'); },
  };

  await assert.rejects(readZipEntryText(entry, 4), /expanded.*limit/i);
  assert.equal(paused, true);
});

test('large compressed documents and unsupported formats fail without reading bytes', async () => {
  let read = false;
  const largeDocx = {
    name: 'large.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: MAX_COMPRESSED_BYTES + 1,
    async arrayBuffer() { read = true; return new ArrayBuffer(0); },
  };
  const largePdf = {
    name: 'large.pdf', type: 'application/pdf', size: MAX_COMPRESSED_BYTES + 1,
    async arrayBuffer() { read = true; return new ArrayBuffer(0); },
  };

  const largeResult = await extractConnectedText(largeDocx, { JSZip: vendoredJsZip() });
  const largePdfResult = await extractConnectedText(largePdf, { pdfjs: { getDocument() {} } });
  const binaryResult = await extractConnectedText(namedBlob('clip.mp4', ['binary'], 'video/mp4'));
  // CR-009 stage 2: HDF5 is now read; damaged content is refused with an HDF5 reason.
  const hdf5Result = await extractConnectedText(namedBlob('data.h5', ['binary'], 'application/x-hdf5'));
  assert.equal(hdf5Result.status, 'unavailable');
  assert.match(hdf5Result.reason, /HDF5/);

  assert.equal(largeResult.status, 'unavailable');
  assert.match(largeResult.reason, /30 MiB/i);
  assert.equal(largePdfResult.status, 'unavailable');
  assert.match(largePdfResult.reason, /30 MiB/i);
  assert.equal(read, false);
  assert.equal(binaryResult.status, 'unavailable');
  assert.match(binaryResult.reason, /unsupported/i);
});
