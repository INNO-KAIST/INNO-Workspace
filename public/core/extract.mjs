export const MAX_EXTRACTED_CHARS = 200_000;
export const MAX_PDF_PAGES = 100;
export const MAX_COMPRESSED_BYTES = 30 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  'csv', 'html', 'htm', 'json', 'jsonl', 'log', 'md', 'markdown', 'mjs', 'js',
  'py', 'rst', 'text', 'toml', 'tsv', 'txt', 'xml', 'yaml', 'yml',
]);
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function extensionOf(name) {
  const match = typeof name === 'string' ? /\.([^.]+)$/.exec(name) : null;
  return match ? match[1].toLowerCase() : '';
}

function formatFromExtension(extension) {
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (extension === 'pdf' || extension === 'docx' || extension === 'pptx') return extension;
  return null;
}

function formatFromMime(type) {
  if (type.startsWith('text/')) return 'text';
  if (/^(application\/(json|ld\+json|xml|x-ndjson|javascript))$/.test(type)) return 'text';
  if (type === 'application/pdf') return 'pdf';
  if (type === DOCX_TYPE) return 'docx';
  if (type === PPTX_TYPE) return 'pptx';
  return null;
}

function validateFile(file) {
  if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size) || file.size < 0) {
    throw new TypeError('A browser File or File-like object is required.');
  }
}

function validateMaxChars(value) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('maxChars must be a positive integer.');
  return Math.min(value, MAX_EXTRACTED_CHARS);
}

function unavailable(size, reason, bytesRead = 0) {
  return { status: 'unavailable', text: '', bytesRead, size, reason };
}

function boundedText(text, maxChars, size, bytesRead, forcedTruncation = false) {
  const truncated = forcedTruncation || text.length > maxChars;
  return {
    status: truncated ? 'truncated' : 'available',
    text: text.slice(0, maxChars),
    bytesRead,
    size,
  };
}

function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, key) => {
    if (key[0] === '#') {
      const codePoint = key[1].toLowerCase() === 'x'
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);
      try { return String.fromCodePoint(codePoint); } catch { return '\uFFFD'; }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[key.toLowerCase()];
  });
}

function inlineXmlText(xml, namespace) {
  const pieces = [];
  const tokenPattern = new RegExp(
    `<${namespace}:t\\b[^>]*>([\\s\\S]*?)<\\/${namespace}:t\\s*>|<${namespace}:(tab|br)\\b[^>]*\\/?>`,
    'gi',
  );
  for (const match of xml.matchAll(tokenPattern)) {
    if (match[1] != null) pieces.push(decodeXml(match[1]));
    else pieces.push(match[2].toLowerCase() === 'tab' ? '\t' : '\n');
  }
  return pieces.join('');
}

function paragraphText(xml, paragraphTag, textNamespace) {
  const paragraphs = [];
  const pattern = new RegExp(`<${paragraphTag}\\b[^>]*>([\\s\\S]*?)<\\/${paragraphTag}\\s*>`, 'gi');
  for (const match of xml.matchAll(pattern)) {
    const text = inlineXmlText(match[1], textNamespace);
    if (text.trim()) paragraphs.push(text);
  }
  return paragraphs.join('\n');
}

export function extractWordXml(xml) {
  if (typeof xml !== 'string') throw new TypeError('Word XML must be text.');
  return paragraphText(xml, 'w:p', 'w');
}

export function extractPowerPointXml(xml) {
  if (typeof xml !== 'string') throw new TypeError('PowerPoint XML must be text.');
  return paragraphText(xml, 'a:p', 'a');
}

async function loadPdfLibrary() {
  return import('../vendor/pdf.mjs');
}

async function loadZipLibrary() {
  await import('../vendor/jszip.min.js');
  if (!globalThis.JSZip) throw new Error('JSZip did not initialize.');
  return globalThis.JSZip;
}

function entryUncompressedSize(entry) {
  const size = entry?._data?.uncompressedSize;
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function relevantZipSize(entries) {
  let total = 0;
  for (const entry of entries) {
    const size = entryUncompressedSize(entry);
    if (size == null) return null;
    total += size;
    if (total > MAX_COMPRESSED_BYTES) return total;
  }
  return total;
}

export function readZipEntryText(entry, maxBytes = MAX_COMPRESSED_BYTES) {
  if (!entry || typeof entry.internalStream !== 'function') {
    return Promise.reject(new TypeError('ZIP entry does not support bounded streaming.'));
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    return Promise.reject(new RangeError('ZIP expansion limit must be a positive integer.'));
  }
  const declaredSize = entryUncompressedSize(entry);
  if (declaredSize != null && declaredSize > maxBytes) {
    return Promise.reject(new RangeError('Expanded Office document XML exceeds the safety limit.'));
  }
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder('utf-8');
    let text = '';
    let bytesRead = 0;
    let settled = false;
    let stream;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (typeof stream?.pause === 'function') stream.pause();
      reject(error);
    };
    try {
      stream = entry.internalStream('uint8array');
      stream
        .on('data', (chunk) => {
          if (settled) return;
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          if (bytesRead + bytes.byteLength > maxBytes) {
            fail(new RangeError('Expanded Office document XML exceeds the safety limit.'));
            return;
          }
          bytesRead += bytes.byteLength;
          text += decoder.decode(bytes, { stream: true });
        })
        .on('error', fail)
        .on('end', () => {
          if (settled) return;
          settled = true;
          text += decoder.decode();
          resolve({ text, bytesRead });
        });
      stream.resume();
    } catch (error) {
      fail(error);
    }
  });
}

async function extractPdf(file, maxChars, injectedPdfjs, selectedPages) {
  if (file.size > MAX_COMPRESSED_BYTES) {
    return unavailable(file.size, 'PDF documents larger than 30 MiB are not read.');
  }
  let pdfjs;
  try {
    pdfjs = injectedPdfjs || await loadPdfLibrary();
    if (!pdfjs || typeof pdfjs.getDocument !== 'function') throw new Error('PDF parser is unavailable.');
    if (pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data });
    const document = await loadingTask.promise;
    try {
      const startPage = selectedPages?.startPage ?? 1;
      const endPage = selectedPages?.endPage ?? Math.min(document.numPages, MAX_PDF_PAGES);
      if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage || endPage - startPage + 1 > MAX_PDF_PAGES) {
        return unavailable(file.size, 'PDF page selection must contain 1 to 100 pages.', file.size);
      }
      if (endPage > document.numPages) {
        return unavailable(file.size, 'Selected PDF pages are outside this document.', file.size);
      }
      let output = '';
      let hasText = false;
      let truncated = selectedPages ? false : document.numPages > MAX_PDF_PAGES;
      for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = (content.items || [])
          .map((item) => (typeof item?.str === 'string' ? item.str : ''))
          .filter(Boolean)
          .join(' ')
          .trim();
        if (pageText) hasText = true;
        const section = `--- Page ${pageNumber} ---\n${pageText}`;
        const separator = output ? '\n\n' : '';
        if (output.length + separator.length + section.length > maxChars) {
          output += (separator + section).slice(0, maxChars - output.length);
          truncated = true;
          break;
        }
        output += separator + section;
      }
      if (!hasText) {
        return unavailable(file.size, 'No embedded PDF text was found; OCR is not supported.', file.size);
      }
      const result = boundedText(output, maxChars, file.size, file.size, truncated);
      if (selectedPages) result.pdfPages = { startPage, endPage, totalPages: document.numPages };
      return result;
    } finally {
      if (typeof document.destroy === 'function') await document.destroy();
    }
  } catch (error) {
    return unavailable(file.size, `PDF text is unavailable: ${error.message}`, file.size);
  }
}

async function openZip(file, injectedJSZip) {
  if (file.size > MAX_COMPRESSED_BYTES) {
    return { error: unavailable(file.size, 'Compressed Office documents larger than 30 MiB are not read.') };
  }
  try {
    const JSZip = injectedJSZip || await loadZipLibrary();
    if (!JSZip || typeof JSZip.loadAsync !== 'function') throw new Error('JSZip parser is unavailable.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { zip: await JSZip.loadAsync(bytes), bytesRead: bytes.byteLength };
  } catch (error) {
    return { error: unavailable(file.size, `Office document text is unavailable: ${error.message}`, file.size) };
  }
}

async function extractDocx(file, maxChars, injectedJSZip) {
  const opened = await openZip(file, injectedJSZip);
  if (opened.error) return opened.error;
  const documentEntry = opened.zip.file('word/document.xml');
  if (!documentEntry) return unavailable(file.size, 'The DOCX document XML is missing.', opened.bytesRead);
  const expandedSize = relevantZipSize([documentEntry]);
  if (expandedSize != null && expandedSize > MAX_COMPRESSED_BYTES) {
    return unavailable(file.size, 'Expanded Office document XML exceeds the 30 MiB safety limit.', opened.bytesRead);
  }
  try {
    const xml = await readZipEntryText(documentEntry, MAX_COMPRESSED_BYTES);
    const text = extractWordXml(xml.text);
    if (!text) return unavailable(file.size, 'The DOCX document contains no extractable text.', opened.bytesRead);
    return boundedText(`--- Document ---\n${text}`, maxChars, file.size, opened.bytesRead);
  } catch (error) {
    return unavailable(file.size, `DOCX text is unavailable: ${error.message}`, opened.bytesRead);
  }
}

async function extractPptx(file, maxChars, injectedJSZip) {
  const opened = await openZip(file, injectedJSZip);
  if (opened.error) return opened.error;
  const slides = Object.keys(opened.zip.files)
    .map((path) => ({ path, match: /^ppt\/slides\/slide(\d+)\.xml$/i.exec(path) }))
    .filter(({ match }) => match)
    .map(({ path, match }) => ({ path, number: Number(match[1]), entry: opened.zip.file(path) }))
    .sort((left, right) => left.number - right.number);
  if (!slides.length) return unavailable(file.size, 'The PPTX contains no slide XML.', opened.bytesRead);
  const expandedSize = relevantZipSize(slides.map(({ entry }) => entry));
  if (expandedSize != null && expandedSize > MAX_COMPRESSED_BYTES) {
    return unavailable(file.size, 'Expanded Office document XML exceeds the 30 MiB safety limit.', opened.bytesRead);
  }
  let output = '';
  let hasText = false;
  let truncated = false;
  let expansionBudget = MAX_COMPRESSED_BYTES;
  try {
    for (const slide of slides) {
      const xml = await readZipEntryText(slide.entry, expansionBudget);
      expansionBudget -= xml.bytesRead;
      const slideText = extractPowerPointXml(xml.text);
      if (slideText) hasText = true;
      const section = `--- Slide ${slide.number} ---\n${slideText}`;
      const separator = output ? '\n\n' : '';
      if (output.length + separator.length + section.length > maxChars) {
        output += (separator + section).slice(0, maxChars - output.length);
        truncated = true;
        break;
      }
      output += separator + section;
    }
  } catch (error) {
    return unavailable(file.size, `PPTX text is unavailable: ${error.message}`, opened.bytesRead);
  }
  if (!hasText) return unavailable(file.size, 'The PPTX contains no extractable text.', opened.bytesRead);
  return boundedText(output, maxChars, file.size, opened.bytesRead, truncated);
}

async function extractPlainText(file, maxChars) {
  const byteLimit = Math.min(file.size, maxChars * 4 + 4);
  const slice = file.slice(0, byteLimit);
  const bytes = new Uint8Array(await slice.arrayBuffer());
  const decoded = new TextDecoder('utf-8').decode(bytes);
  return boundedText(decoded, maxChars, file.size, bytes.byteLength, file.size > bytes.byteLength);
}

export async function extractConnectedText(file, {
  maxChars = MAX_EXTRACTED_CHARS,
  pdfjs,
  pdfPages,
  JSZip,
} = {}) {
  validateFile(file);
  const limit = validateMaxChars(maxChars);
  const extension = extensionOf(file.name);
  const type = typeof file.type === 'string' ? file.type.toLowerCase().split(';', 1)[0].trim() : '';
  const extensionFormat = formatFromExtension(extension);
  const mimeFormat = formatFromMime(type);
  if (extensionFormat && mimeFormat && extensionFormat !== mimeFormat) {
    return unavailable(file.size, `File MIME type does not match its extension: ${type} versus .${extension}.`);
  }
  const format = mimeFormat || extensionFormat;

  if (format === 'text') return extractPlainText(file, limit);
  if (format === 'pdf') return extractPdf(file, limit, pdfjs, pdfPages);
  if (format === 'docx') return extractDocx(file, limit, JSZip);
  if (format === 'pptx') return extractPptx(file, limit, JSZip);
  return unavailable(file.size, `Unsupported connected file type: ${type || extension || 'unknown'}.`);
}
