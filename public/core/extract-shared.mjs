// Shared pieces of connected-file text extraction (public/core/extract.mjs and the format
// readers). Everything stays bounded: characters returned, bytes read and bytes expanded.
// Extraction runs on the browser's main thread, so markup is scanned with indexOf in a single
// pass: damaged or hostile files (unclosed tags, a missing '>') cost time in proportion to
// their size, never quadratic regular-expression backtracking.
export const MAX_EXTRACTED_CHARS = 200_000;
export const MAX_PDF_PAGES = 100;
export const MAX_COMPRESSED_BYTES = 30 * 1024 * 1024;

const NBSP = String.fromCharCode(0xa0);
const REPLACEMENT = String.fromCharCode(0xfffd);

export function unavailable(size, reason, bytesRead = 0) {
  return { status: 'unavailable', text: '', bytesRead, size, reason };
}

export function boundedText(text, maxChars, size, bytesRead, forcedTruncation = false) {
  const truncated = forcedTruncation || text.length > maxChars;
  return {
    status: truncated ? 'truncated' : 'available',
    text: text.slice(0, maxChars),
    bytesRead,
    size,
  };
}

// Collects "--- Title ---" sections up to maxChars, as PDF pages and slides always did.
// `remaining` tells readers how much more text is worth building.
export function sectionWriter(maxChars) {
  let output = '';
  let truncated = false;
  return {
    add(title, body) {
      if (truncated) return false;
      const section = `--- ${title} ---\n${body}`;
      const separator = output ? '\n\n' : '';
      if (output.length + separator.length + section.length > maxChars) {
        output += (separator + section).slice(0, maxChars - output.length);
        truncated = true;
        return false;
      }
      output += separator + section;
      return true;
    },
    // A reader that stopped early (its output reached the limit) marks the result truncated.
    cut() { truncated = true; },
    get remaining() { return truncated ? 0 : Math.max(0, maxChars - output.length); },
    get text() { return output; },
    get truncated() { return truncated; },
  };
}

// Builds text up to a character limit; past it, further pieces are dropped and `full` is set.
// Readers whose output can grow faster than their input (column padding, repeated cells)
// stop doing work once the limit is reached.
export function textBudget(limit) {
  const pieces = [];
  let length = 0;
  return {
    push(text) {
      if (length > limit) return false;
      const piece = length + text.length > limit + 1 ? text.slice(0, limit + 1 - length) : text;
      pieces.push(piece);
      length += piece.length;
      return length <= limit;
    },
    get full() { return length > limit; },
    get length() { return length; },
    get text() { return pieces.join(''); },
  };
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: NBSP, ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', deg: '°',
};

export function decodeXml(value) {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] === '#') {
      const codePoint = key[1].toLowerCase() === 'x'
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);
      try { return String.fromCodePoint(codePoint); } catch { return REPLACEMENT; }
    }
    return NAMED_ENTITIES[key.toLowerCase()] ?? entity;
  });
}

// Removes trailing whitespace from every line, in linear time.
export function trimLineEnds(text) {
  return text.split('\n').map((line) => line.trimEnd()).join('\n');
}

const isNameEnd = (code) => code === 32 || code === 9 || code === 10 || code === 13 || code === 47 || code === 62;

// The '>' that ends a tag, skipping any inside quoted attribute values; -1 when there is none.
function tagEnd(xml, from) {
  let quote = 0;
  for (let index = from; index < xml.length; index += 1) {
    const code = xml.charCodeAt(index);
    if (quote) { if (code === quote) quote = 0; }
    else if (code === 34 || code === 39) quote = code;
    else if (code === 62) return index;
  }
  return -1;
}

// Markup tokens in document order: { text } with entities decoded (CDATA kept as is), or
// { name, close, empty, raw } for a tag. Comments, declarations and processing instructions
// are skipped; an unterminated tag or comment ends the scan.
export function* markupTokens(xml) {
  let position = 0;
  while (position < xml.length) {
    const open = xml.indexOf('<', position);
    if (open < 0) { yield { text: decodeXml(xml.slice(position)) }; return; }
    if (open > position) yield { text: decodeXml(xml.slice(position, open)) };
    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end < 0) return;
      position = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9);
      if (end < 0) return;
      yield { text: xml.slice(open + 9, end) };
      position = end + 3;
      continue;
    }
    const end = tagEnd(xml, open + 1);
    if (end < 0) return;
    position = end + 1;
    const first = xml.charCodeAt(open + 1);
    if (first === 33 || first === 63) continue; // <!DOCTYPE …>, <?xml …?>
    const close = first === 47;
    let nameEnd = open + (close ? 2 : 1);
    const nameStart = nameEnd;
    while (nameEnd < end && !isNameEnd(xml.charCodeAt(nameEnd))) nameEnd += 1;
    if (nameEnd === nameStart) continue;
    yield { name: xml.slice(nameStart, nameEnd), close, empty: !close && xml.charCodeAt(end - 1) === 47, raw: xml.slice(open, end + 1) };
  }
}

// Text runs of WordprocessingML, DrawingML and HWPX (namespace w, a or hp): text inside <ns:t>,
// tabs and line breaks as characters, tab-stop definitions (<ns:tabs>, <ns:tabLst>) ignored.
function inlineCollector(namespace) {
  const prefix = `${namespace}:`;
  const controls = { tab: '\t', br: '\n', cr: '\n', lineBreak: '\n', fwSpace: ' ', nbSpace: ' ', hyphen: '-' };
  let pieces = [], inText = 0, skipping = 0;
  return {
    token(token) {
      if (token.text !== undefined) { if (inText && !skipping) pieces.push(token.text); return; }
      if (!token.name.startsWith(prefix)) return;
      const local = token.name.slice(prefix.length);
      if (local === 'tabs' || local === 'tabLst') { if (!token.empty) skipping += token.close ? (skipping ? -1 : 0) : 1; return; }
      if (skipping) return;
      if (local === 't') { if (!token.empty) inText += token.close ? (inText ? -1 : 0) : 1; return; }
      if (!token.close && Object.hasOwn(controls, local)) pieces.push(controls[local]);
    },
    take() { const text = pieces.join(''); pieces = []; return text; },
  };
}

export function inlineXmlText(xml, namespace) {
  const collector = inlineCollector(namespace);
  for (const token of markupTokens(xml)) collector.token(token);
  return collector.take();
}

// Paragraphs in document order. A paragraph nested in another (a table cell inside an HWPX
// paragraph) ends the text gathered so far and is listed where it appears.
export function paragraphText(xml, paragraphTag, textNamespace) {
  const paragraphs = [];
  const collector = inlineCollector(textNamespace);
  let depth = 0;
  const flush = () => { const text = collector.take(); if (text.trim()) paragraphs.push(text); };
  for (const token of markupTokens(xml)) {
    if (token.name === paragraphTag) {
      if (token.empty) continue;
      if (depth) flush();
      depth = token.close ? Math.max(0, depth - 1) : depth + 1;
      continue;
    }
    if (depth) collector.token(token);
  }
  if (depth) flush();
  return paragraphs.join('\n');
}

const SKIPPED_MARKUP = new Set(['script', 'style', 'head']);
const LEADING_SPACES = new RegExp(`^[ ${NBSP}]+`);
const BLOCK_MARKUP = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'tr', 'table', 'section', 'article', 'blockquote', 'pre', 'header', 'footer', 'figure', 'figcaption', 'dt', 'dd']);

// Markup (XHTML, HTML) to readable lines: scripts and styles dropped, blocks on new lines.
export function markupText(markup) {
  const pieces = [];
  let skipping = 0;
  for (const token of markupTokens(markup)) {
    if (token.text !== undefined) { if (!skipping) pieces.push(token.text); continue; }
    const name = token.name.toLowerCase();
    if (SKIPPED_MARKUP.has(name)) { if (!token.empty) skipping = token.close ? Math.max(0, skipping - 1) : skipping + 1; continue; }
    if (skipping) continue;
    if (name === 'br' || BLOCK_MARKUP.has(name)) pieces.push('\n');
    else if ((name === 'td' || name === 'th') && !token.close) pieces.push('\t');
  }
  return pieces.join('').split('\n')
    .map((line) => line.trimEnd().replace(LEADING_SPACES, ''))
    .filter((line) => line.trim())
    .join('\n');
}

// The value of a quoted attribute in one start tag.
export function attribute(tag, name) {
  const match = new RegExp(`\\s${name.replace(/[:.]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return match ? decodeXml(match[1] ?? match[2]) : undefined;
}

export function entryUncompressedSize(entry) {
  const size = entry?._data?.uncompressedSize;
  return Number.isFinite(size) && size >= 0 ? size : null;
}

export function relevantZipSize(entries) {
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

// Reads ZIP entries against one shared expansion budget.
export function zipReader(zip) {
  let left = MAX_COMPRESSED_BYTES;
  return async (path) => {
    const entry = zip.file(path);
    if (!entry) return null;
    if (left <= 0) throw new RangeError('Expanded document XML exceeds the 30 MiB safety limit.');
    const result = await readZipEntryText(entry, left);
    left -= result.bytesRead;
    return result.text;
  };
}
