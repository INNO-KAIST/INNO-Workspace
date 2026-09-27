import assert from 'node:assert/strict';
import test from 'node:test';

import { extractConnectedText } from '../public/core/extract.mjs';
import { extractSourceView, verifySourceView } from '../public/core/source-views.mjs';

function namedBlob(name, parts, type, lastModified = 1) {
  const blob = new Blob(parts, { type });
  Object.defineProperties(blob, {
    name: { value: name },
    lastModified: { value: lastModified },
  });
  return blob;
}

function pdfFixture(pageTexts) {
  const requested = [];
  let destroyed = false;
  const document = {
    numPages: pageTexts.length,
    async getPage(number) {
      requested.push(number);
      return {
        async getTextContent() {
          return { items: (pageTexts[number - 1] ?? []).map(str => ({ str })) };
        },
      };
    },
    async destroy() { destroyed = true; },
  };
  return {
    requested,
    get destroyed() { return destroyed; },
    pdfjs: { GlobalWorkerOptions: {}, getDocument() { return { promise: Promise.resolve(document) }; } },
  };
}

test('a non-prefix text view reads only its bounded byte window and records exact coverage', async () => {
  const calls = [];
  const size = 2 ** 40;
  const file = {
    name: 'huge.txt', type: 'text/plain', size,
    slice(start, end) {
      calls.push([start, end]);
      return new Blob([new Uint8Array(end - start).fill(65)]);
    },
    async arrayBuffer() { throw new Error('whole source read'); },
  };

  const result = await extractSourceView(file, { kind: 'text-byte-range', start: 9_000_000, maxBytes: 12 });

  assert.deepEqual(calls, [[9_000_000, 9_000_012]]);
  assert.equal(result.text, 'AAAAAAAAAAAA');
  assert.equal(result.bytesRead, 12);
  assert.deepEqual(result.view, {
    kind: 'text-byte-range', start: 9_000_000, end: 9_000_012,
    sha256: '0592cedeabbf836d8d1c7456417c7653ac208f71e904d3d0ab37faf711021aff',
  });
  assert.deepEqual(result.coverage, {
    kind: 'text-byte-range', sourceSize: size, partial: true, method: 'utf8_text',
    start: 9_000_000, end: 9_000_012,
    sha256: '0592cedeabbf836d8d1c7456417c7653ac208f71e904d3d0ab37faf711021aff',
  });
});

test('initial text windows skip leading continuation bytes and omit an incomplete trailing code point', async () => {
  const file = namedBlob('unicode.txt', ['A한B🙂C'], 'text/plain');

  const result = await extractSourceView(file, { kind: 'text-byte-range', start: 2, maxBytes: 5 });

  assert.equal(result.status, 'available');
  assert.equal(result.text, 'B');
  assert.equal(result.bytesRead, 5);
  assert.equal(result.coverage.start, 4);
  assert.equal(result.coverage.end, 5);
  assert.equal(result.view.sha256, 'df7e70e5021544f4834bbee64a9e3789febc4be81470df629cad6ddb03320a5c');
});

test('text view output preserves a leading UTF-8 BOM so encoded text exactly covers its byte range', async () => {
  const file = namedBlob('bom.txt', [new Uint8Array([0xef, 0xbb, 0xbf, 65])], 'text/plain');

  const result = await extractSourceView(file, { kind: 'text-byte-range', start: 0, maxBytes: 4 });

  assert.equal(result.text, '\uFEFFA');
  assert.equal(new TextEncoder().encode(result.text).byteLength, result.coverage.end - result.coverage.start);
  assert.equal(result.coverage.partial, false);
});

test('text views reject malformed UTF-8 and ranges above the raw byte cap', async () => {
  const malformed = namedBlob('bad.txt', [new Uint8Array([65, 0xff, 66])], 'text/plain');

  const result = await extractSourceView(malformed, { kind: 'text-byte-range', start: 0, maxBytes: 3 });

  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /UTF-8/i);
  assert.equal(result.view, undefined);
  await assert.rejects(
    extractSourceView(malformed, { kind: 'text-byte-range', start: 0, maxBytes: 200_001 }),
    /200000|byte/i,
  );
});

test('saved text views re-read only exact bounds and reject same-size changed content', async () => {
  const original = namedBlob('notes.txt', ['prefix alpha suffix'], 'text/plain', 7);
  const extracted = await extractSourceView(original, { kind: 'text-byte-range', start: 7, end: 12 });
  const changedBlob = namedBlob('notes.txt', ['prefix omega suffix'], 'text/plain', 7);
  const slices = [];
  const changed = {
    name: changedBlob.name, type: changedBlob.type, size: changedBlob.size, lastModified: 7,
    slice(start, end) { slices.push([start, end]); return changedBlob.slice(start, end); },
    async arrayBuffer() { throw new Error('whole source read'); },
  };

  await assert.rejects(verifySourceView(changed, extracted.view), /changed|select.*again/i);
  assert.deepEqual(slices, [[7, 12]]);

  const outsideOnly = namedBlob('notes.txt', ['changedalpha suffix'], 'text/plain', 7);
  const verified = await verifySourceView(outsideOnly, extracted.view);
  assert.equal(verified.text, 'alpha');
});

test('selected PDF pages process only the requested inclusive range and expose exact coverage', async () => {
  const fixture = pdfFixture([['page 1'], ['page 2'], ['page 3'], ['page 4']]);
  const file = namedBlob('paper.pdf', ['%PDF fixture'], 'application/pdf');

  const result = await extractSourceView(file, { kind: 'pdf-pages', startPage: 2, endPage: 3 }, { pdfjs: fixture.pdfjs });

  assert.deepEqual(fixture.requested, [2, 3]);
  assert.equal(fixture.destroyed, true);
  assert.equal(result.text, '--- Page 2 ---\npage 2\n\n--- Page 3 ---\npage 3');
  assert.deepEqual(result.view, {
    kind: 'pdf-pages', startPage: 2, endPage: 3,
    sha256: '5df15cfd4be11e403a447af012a977e9b8baef860c2ab062dc8577b7fe87d691',
  });
  assert.deepEqual(result.coverage, {
    kind: 'pdf-pages', sourceSize: file.size, partial: true, method: 'pdf_embedded_text',
    startPage: 2, endPage: 3, totalPages: 4,
    sha256: '5df15cfd4be11e403a447af012a977e9b8baef860c2ab062dc8577b7fe87d691',
  });
});

test('PDF source views reject page overflow, image-only ranges, and truncated extraction without claiming coverage', async () => {
  const file = namedBlob('paper.pdf', ['%PDF fixture'], 'application/pdf');
  const overflow = pdfFixture([['one'], ['two']]);
  const outside = await extractSourceView(file, { kind: 'pdf-pages', startPage: 2, endPage: 3 }, { pdfjs: overflow.pdfjs });
  assert.equal(outside.status, 'unavailable');
  assert.deepEqual(overflow.requested, []);
  assert.equal(outside.coverage, undefined);

  const imageOnly = pdfFixture([[], []]);
  const image = await extractSourceView(file, { kind: 'pdf-pages', startPage: 1, endPage: 2 }, { pdfjs: imageOnly.pdfjs });
  assert.equal(image.status, 'unavailable');
  assert.match(image.reason, /OCR.*not supported/i);
  assert.equal(image.view, undefined);

  const truncatedFixture = pdfFixture([['page text']]);
  const truncated = await extractSourceView(file, { kind: 'pdf-pages', startPage: 1, endPage: 1 }, { pdfjs: truncatedFixture.pdfjs, maxChars: 10 });
  assert.equal(truncated.status, 'truncated');
  assert.equal(truncated.view, undefined);
  assert.equal(truncated.coverage, undefined);

  await assert.rejects(
    extractSourceView(file, { kind: 'pdf-pages', startPage: 1, endPage: 101 }, { pdfjs: truncatedFixture.pdfjs }),
    /100|page/i,
  );
});

test('no explicit view preserves connected extraction behavior exactly', async () => {
  const file = namedBlob('notes.txt', ['line one\nline two'], 'text/plain');

  assert.deepEqual(await extractSourceView(file), await extractConnectedText(file));
});
