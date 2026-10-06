import {
  MAX_COMPRESSED_BYTES, MAX_EXTRACTED_CHARS, MAX_PDF_PAGES, boundedText, paragraphText,
  readZipEntryText, relevantZipSize, sectionWriter, unavailable, zipReader,
} from './extract-shared.mjs';
import { epubSections, hwpxSections, notebookSections, odfSections, rtfText, xlsxSections } from './extract-office.mjs';
import { hwpSections } from './hwp.mjs';

export { MAX_COMPRESSED_BYTES, MAX_EXTRACTED_CHARS, MAX_PDF_PAGES, readZipEntryText };

// Extensions read as plain text, across fields: documents and markup, data and configuration,
// source code, and common scientific and engineering text formats. Files with any other name
// are still read when their content proves to be text.
export const TEXT_EXTENSIONS = new Set([
  // Writing, markup and notes
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'asciidoc', 'org', 'textile', 'wiki', 'tex', 'latex', 'ltx',
  'bib', 'bst', 'cls', 'sty', 'html', 'htm', 'xhtml', 'xml', 'xsd', 'xsl', 'xslt', 'svg', 'srt', 'vtt', 'sbv', 'ics',
  'vcf', 'eml', 'log', 'diff', 'patch',
  // Data and configuration
  'csv', 'tsv', 'psv', 'tab', 'json', 'jsonl', 'ndjson', 'json5', 'geojson', 'topojson', 'yaml', 'yml', 'toml', 'ini',
  'cfg', 'conf', 'config', 'properties', 'env', 'arff', 'graphql', 'gql', 'proto', 'thrift', 'avsc', 'kml', 'gpx',
  'rdf', 'ttl', 'owl', 'sparql', 'plist',
  // Source code
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro', 'css', 'scss', 'sass', 'less',
  'py', 'pyi', 'pyw', 'pyx', 'pxd', 'r', 'rmd', 'qmd', 'jl', 'm', 'mm', 'c', 'h', 'cc', 'cpp', 'cxx', 'c++', 'hpp',
  'hh', 'hxx', 'inl', 'cu', 'cuh', 'cl', 'glsl', 'hlsl', 'wgsl', 'cs', 'csx', 'fs', 'fsx', 'fsi', 'vb', 'java',
  'kt', 'kts', 'scala', 'sc', 'groovy', 'gradle', 'go', 'rs', 'swift', 'dart', 'php', 'rb', 'erb', 'pl', 'pm', 'lua',
  'sh', 'bash', 'zsh', 'fish', 'ksh', 'csh', 'ps1', 'psm1', 'psd1', 'bat', 'cmd', 'sql', 'asm', 's', 'f', 'for',
  'f77', 'f90', 'f95', 'f03', 'f08', 'pas', 'pp', 'd', 'nim', 'zig', 'v', 'sv', 'svh', 'vh', 'vhd', 'vhdl', 'hs',
  'lhs', 'ml', 'mli', 'elm', 'erl', 'hrl', 'ex', 'exs', 'clj', 'cljs', 'cljc', 'edn', 'lisp', 'lsp', 'el', 'scm',
  'ss', 'rkt', 'tcl', 'awk', 'sed', 'vim', 'cmake', 'mk', 'mak', 'ninja', 'nix', 'tf', 'tfvars', 'hcl', 'bicep',
  'dockerfile', 'containerfile', 'gitignore', 'gitattributes', 'editorconfig', 'prisma', 'sol', 'move', 'cairo',
  'ino', 'pde', 'ahk', 'au3', 'applescript', 'vbs', 'vba', 'bas', 'frm', 'cbl', 'cob', 'ada', 'adb', 'ads', 'pro',
  'pri', 'qml', 'xaml', 'csproj', 'vbproj', 'fsproj', 'vcxproj', 'props', 'targets', 'sln', 'resx', 'gemspec',
  'podspec', 'lock', 'sum', 'mod', 'nuspec', 'pom', 'sbt', 'cabal', 'opam', 'rockspec', 'jinja', 'j2', 'njk', 'hbs',
  'mustache', 'liquid', 'twig', 'ejs', 'pug', 'haml', 'slim', 'tpl', 'tmpl',
  // Statistics, mathematics and notebooks in text form
  'do', 'ado', 'sas', 'sps', 'stan', 'bug', 'jags', 'nb', 'wl', 'wls', 'mpl', 'mac', 'sage', 'gp', 'gnuplot', 'plt',
  'mod', 'dat', 'gms', 'lp', 'mps', 'ampl', 'smt2',
  // Bioinformatics, chemistry and physics
  'fasta', 'fa', 'fna', 'faa', 'ffn', 'frn', 'fas', 'fastq', 'fq', 'gff', 'gff3', 'gtf', 'gb', 'gbk', 'genbank',
  'embl', 'bed', 'bedgraph', 'wig', 'sam', 'maf', 'aln', 'clustal', 'phy', 'phylip', 'nex', 'nexus', 'nwk', 'newick',
  'tre', 'pdb', 'ent', 'cif', 'mmcif', 'mol', 'mol2', 'sdf', 'sd', 'xyz', 'smi', 'smiles', 'inchi', 'gjf', 'gro',
  'top', 'itp', 'mdp', 'ndx', 'psf', 'prmtop', 'inpcrd', 'lammps', 'lmp', 'poscar', 'incar', 'kpoints', 'cube',
  'mzml', 'mgf', 'jdx', 'dx', 'cdl',
  // Engineering, CAD exchange and instruments
  'inp', 'gcode', 'ngc', 'nc1', 'dxf', 'step', 'stp', 'iges', 'igs', 'kicad_pcb', 'kicad_sch', 'kicad_pro', 'net',
  'cir', 'sp', 'spice', 'lib', 'scs', 'sdc', 'xdc', 'ucf', 'qsf', 'tcl', 'ldf', 'dbc', 'a2l', 'hex', 'srec', 'ihex',
  'csvy', 'nmea', 'tle',
]);

// Formats that are text underneath: their raw bytes can also be read as a byte range.
export const TEXT_BASED_FORMATS = new Set(['text', 'rtf', 'ipynb']);
const OOXML_FORMATS = new Set(['docx', 'xlsx', 'pptx']);
const EXTENSION_FORMATS = new Map(Object.entries({
  pdf: 'pdf',
  docx: 'docx', docm: 'docx', dotx: 'docx', dotm: 'docx',
  pptx: 'pptx', pptm: 'pptx', ppsx: 'pptx', ppsm: 'pptx', potx: 'pptx', potm: 'pptx',
  xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', xltm: 'xlsx',
  hwpx: 'hwpx', hwtx: 'hwpx', hwp: 'hwp', hwt: 'hwp',
  odt: 'odt', ott: 'odt', ods: 'ods', ots: 'ods', odp: 'odp', otp: 'odp',
  epub: 'epub', rtf: 'rtf', ipynb: 'ipynb',
  h5: 'hdf5', hdf5: 'hdf5', he5: 'hdf5',
  doc: 'legacy-office', dot: 'legacy-office', xls: 'legacy-office', xlt: 'legacy-office', ppt: 'legacy-office', pps: 'legacy-office',
  png: 'image', jpg: 'image', jpeg: 'image', jfif: 'image', gif: 'image', webp: 'image', bmp: 'image', tif: 'image',
  tiff: 'image', heic: 'image', heif: 'image', avif: 'image', ico: 'image',
}));
const MIME_FORMATS = new Map(Object.entries({
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template': 'docx',
  'application/vnd.ms-word.document.macroenabled.12': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow': 'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.template': 'pptx',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template': 'xlsx',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsx',
  'application/hwp+zip': 'hwpx', 'application/vnd.hancom.hwpx': 'hwpx', 'application/haansofthwpx': 'hwpx',
  'application/x-hwp': 'hwp', 'application/vnd.hancom.hwp': 'hwp', 'application/haansofthwp': 'hwp',
  'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.text-template': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods', 'application/vnd.oasis.opendocument.spreadsheet-template': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp', 'application/vnd.oasis.opendocument.presentation-template': 'odp',
  'application/epub+zip': 'epub',
  'application/rtf': 'rtf', 'text/rtf': 'rtf',
  'application/x-ipynb+json': 'ipynb',
  'application/x-hdf5': 'hdf5', 'application/x-hdf': 'hdf5',
  'application/msword': 'legacy-office', 'application/vnd.ms-excel': 'legacy-office', 'application/vnd.ms-powerpoint': 'legacy-office',
  'image/svg+xml': 'text',
}));
const TEXT_MIME = /^application\/(json|ld\+json|xml|x-ndjson|javascript|ecmascript|x-javascript|x-sh|x-csh|x-yaml|yaml|toml|x-tex|x-latex|x-bibtex|sql|graphql|x-python|x-perl|x-ruby|x-php|x-httpd-php|x-subrip|x-sql)$|^application\/[\w.-]+\+(json|xml)$/;

function extensionOf(name) {
  const match = typeof name === 'string' ? /\.([^./\\]+)$/.exec(name) : null;
  return match ? match[1].toLowerCase() : '';
}

function mimeOf(file) {
  return typeof file?.type === 'string' ? file.type.toLowerCase().split(';', 1)[0].trim() : '';
}

function formatFromExtension(extension) {
  return TEXT_EXTENSIONS.has(extension) ? 'text' : EXTENSION_FORMATS.get(extension) ?? null;
}

function formatFromMime(type) {
  if (MIME_FORMATS.has(type)) return MIME_FORMATS.get(type);
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('text/') || TEXT_MIME.test(type)) return 'text';
  return null;
}

// How a connected file is read: { format } (null when only its content can tell), or
// { conflict } when its MIME type and extension disagree. Systems label some text files
// oddly (.csv as Excel, .ts as MPEG video), so a text extension wins over the MIME type and
// the content is still checked; any other disagreement is refused.
export function connectedFormat(file) {
  const extension = extensionOf(file?.name);
  const type = mimeOf(file);
  const extensionFormat = formatFromExtension(extension);
  const mimeFormat = formatFromMime(type);
  if (extensionFormat && mimeFormat && extensionFormat !== mimeFormat) {
    if (TEXT_BASED_FORMATS.has(extensionFormat)) return { format: extensionFormat, extension, type };
    // Older systems label .docx/.xlsx/.pptx with the binary Office MIME types; the reader checks the content.
    if (mimeFormat === 'legacy-office' && OOXML_FORMATS.has(extensionFormat)) return { format: extensionFormat, extension, type };
    return { format: null, conflict: true, extension, type };
  }
  return { format: mimeFormat || extensionFormat || null, extension, type };
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

// Text bytes to a string, or null for binary content.
// - A UTF-16 byte-order mark decides UTF-16. Files whose extension says text are also checked
//   for UTF-16 without one (zero high bytes on ASCII).
// - Content of unknown type must look like text: no NUL bytes, few control characters.
//   Files whose extension says text may hold some (\x01-delimited exports, NUL padding, which
//   is dropped) and are refused only when mostly binary.
// - UTF-8 is preferred, including a UTF-8 file with a stray byte or two. Otherwise files whose
//   extension says text are tried as Korean CP949 (older Windows files), then lossy UTF-8.
const REPLACEMENT = String.fromCharCode(0xfffd);
const isControl = (byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c && byte !== 0x0b && byte !== 0x1b && byte !== 0x08;

function byteCounts(bytes) {
  let nul = 0, control = 0;
  for (const byte of bytes) {
    if (byte === 0) nul += 1;
    else if (isControl(byte)) control += 1;
  }
  return { nul, control };
}

function utf16Order(bytes) {
  const end = Math.min(bytes.length - (bytes.length % 2), 8192);
  if (end < 4) return null;
  let evenZero = 0, oddZero = 0;
  for (let index = 0; index < end; index += 2) {
    if (bytes[index] === 0) evenZero += 1;
    if (bytes[index + 1] === 0) oddZero += 1;
  }
  const pairs = end / 2;
  if (oddZero >= pairs * 0.3 && evenZero * 4 <= oddZero) return 'utf-16le';
  if (evenZero >= pairs * 0.3 && oddZero * 4 <= evenZero) return 'utf-16be';
  return null;
}

function mostlyText(text) {
  let control = 0;
  for (let index = 0; index < text.length; index += 1) if (isControl(text.charCodeAt(index))) control += 1;
  return control <= text.length * 0.02;
}

const replacements = (text) => text.split(REPLACEMENT).length - 1;

export function decodeTextBytes(bytes, { complete = true, legacy = true } = {}) {
  const stream = !complete;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes, { stream });
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes, { stream });
  const { nul, control } = byteCounts(bytes);
  if (!legacy && (nul || control > bytes.length * 0.02)) return null;
  if (nul) {
    const order = utf16Order(bytes);
    if (order) {
      const text = new TextDecoder(order).decode(bytes, { stream });
      if (mostlyText(text)) return text;
    }
  }
  const clean = nul ? bytes.filter((byte) => byte !== 0) : bytes;
  if (control > clean.length * 0.5) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(clean, { stream }); } catch { /* not clean UTF-8 */ }
  const lossy = new TextDecoder('utf-8').decode(clean, { stream });
  const bad = replacements(lossy), few = bad <= Math.max(2, clean.length / 1000);
  if (!legacy) return few ? lossy : null;
  // UTF-8 with a stray byte has far more valid non-ASCII characters than errors; mostly-ASCII
  // CP949 (source code with Korean comments) has almost none, so it goes on to CP949.
  if (few && validNonAscii(lossy) > bad) return lossy;
  try { return new TextDecoder('euc-kr', { fatal: true }).decode(clean, { stream }); } catch { /* not CP949 */ }
  return bad <= lossy.length * 0.1 ? lossy : null;
}

function validNonAscii(text) {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x80 && code !== 0xfffd) count += 1;
  }
  return count;
}

async function extractPlainText(file, maxChars, { sniffed = false, label = '' } = {}) {
  const byteLimit = Math.min(file.size, maxChars * 4 + 4);
  const slice = file.slice(0, byteLimit);
  const bytes = new Uint8Array(await slice.arrayBuffer());
  const decoded = decodeTextBytes(bytes, { complete: bytes.byteLength >= file.size, legacy: !sniffed });
  if (decoded == null) {
    return unavailable(file.size, sniffed
      ? `Unsupported connected file type: ${label}; its content is not text.`
      : 'The file content is binary, not text.', bytes.byteLength);
  }
  return boundedText(decoded, maxChars, file.size, bytes.byteLength, file.size > bytes.byteLength);
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
      const writer = sectionWriter(maxChars);
      let hasText = false;
      for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = (content.items || [])
          .map((item) => (typeof item?.str === 'string' ? item.str : ''))
          .filter(Boolean)
          .join(' ')
          .trim();
        if (pageText) hasText = true;
        if (!writer.add(`Page ${pageNumber}`, pageText)) break;
      }
      if (!hasText) {
        return unavailable(file.size, 'No embedded PDF text was found; OCR is not supported.', file.size);
      }
      const truncated = writer.truncated || (!selectedPages && document.numPages > MAX_PDF_PAGES);
      const result = boundedText(writer.text, maxChars, file.size, file.size, truncated);
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
    return { error: unavailable(file.size, 'Compressed documents larger than 30 MiB are not read.') };
  }
  try {
    const JSZip = injectedJSZip || await loadZipLibrary();
    if (!JSZip || typeof JSZip.loadAsync !== 'function') throw new Error('JSZip parser is unavailable.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { zip: await JSZip.loadAsync(bytes), bytesRead: bytes.byteLength };
  } catch (error) {
    return { error: unavailable(file.size, `Document text is unavailable: ${error.message}`, file.size) };
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
  const writer = sectionWriter(maxChars);
  let hasText = false;
  let expansionBudget = MAX_COMPRESSED_BYTES;
  try {
    for (const slide of slides) {
      const xml = await readZipEntryText(slide.entry, expansionBudget);
      expansionBudget -= xml.bytesRead;
      const slideText = extractPowerPointXml(xml.text);
      if (slideText) hasText = true;
      if (!writer.add(`Slide ${slide.number}`, slideText)) break;
    }
  } catch (error) {
    return unavailable(file.size, `PPTX text is unavailable: ${error.message}`, opened.bytesRead);
  }
  if (!hasText) return unavailable(file.size, 'The PPTX contains no extractable text.', opened.bytesRead);
  return boundedText(writer.text, maxChars, file.size, opened.bytesRead, writer.truncated);
}

// Other ZIP-based documents: each reader writes sections and says whether any held text.
const ZIP_DOCUMENTS = {
  xlsx: { label: 'XLSX workbook', read: (zip, read, writer) => xlsxSections(read, writer) },
  hwpx: { label: 'HWPX document', read: (zip, read, writer) => hwpxSections(zip, read, writer) },
  odt: { label: 'OpenDocument text', read: (zip, read, writer) => odfSections('odt', read, writer) },
  ods: { label: 'OpenDocument spreadsheet', read: (zip, read, writer) => odfSections('ods', read, writer) },
  odp: { label: 'OpenDocument presentation', read: (zip, read, writer) => odfSections('odp', read, writer) },
  epub: { label: 'EPUB book', read: (zip, read, writer) => epubSections(read, writer) },
};

async function extractZipDocument(file, format, maxChars, injectedJSZip) {
  const document = ZIP_DOCUMENTS[format];
  const opened = await openZip(file, injectedJSZip);
  if (opened.error) return opened.error;
  const writer = sectionWriter(maxChars);
  try {
    if (!await document.read(opened.zip, zipReader(opened.zip), writer)) {
      return unavailable(file.size, `The ${document.label} contains no extractable text.`, opened.bytesRead);
    }
  } catch (error) {
    return unavailable(file.size, `${document.label} text is unavailable: ${error.message}`, opened.bytesRead);
  }
  return boundedText(writer.text, maxChars, file.size, opened.bytesRead, writer.truncated);
}

async function wholeFile(file, label) {
  if (file.size > MAX_COMPRESSED_BYTES) return { error: unavailable(file.size, `${label} files larger than 30 MiB are not read.`) };
  return { bytes: new Uint8Array(await file.arrayBuffer()) };
}

async function extractRtf(file, maxChars) {
  const loaded = await wholeFile(file, 'RTF');
  if (loaded.error) return loaded.error;
  const { bytes } = loaded;
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '{\\rtf') return extractPlainText(file, maxChars);
  try {
    const { text, truncated } = rtfText(bytes, maxChars);
    if (!text) return unavailable(file.size, 'The RTF document contains no extractable text.', bytes.byteLength);
    return boundedText(text, maxChars, file.size, bytes.byteLength, truncated);
  } catch (error) {
    return unavailable(file.size, `RTF text is unavailable: ${error.message}`, bytes.byteLength);
  }
}

async function extractNotebook(file, maxChars) {
  const loaded = await wholeFile(file, 'Notebook');
  if (loaded.error) return loaded.error;
  const { bytes } = loaded;
  let notebook;
  try { notebook = JSON.parse(decodeTextBytes(bytes) ?? ''); } catch { return extractPlainText(file, maxChars); }
  const writer = sectionWriter(maxChars);
  if (!notebookSections(notebook, writer)) return extractPlainText(file, maxChars);
  return boundedText(writer.text, maxChars, file.size, bytes.byteLength, writer.truncated);
}

async function extractHwp(file, maxChars) {
  const loaded = await wholeFile(file, 'HWP');
  if (loaded.error) return loaded.error;
  const { bytes } = loaded;
  const writer = sectionWriter(maxChars);
  try {
    if (!await hwpSections(bytes, writer)) return unavailable(file.size, 'The HWP document contains no extractable text.', bytes.byteLength);
  } catch (error) {
    return unavailable(file.size, `HWP text is unavailable: ${error.message}.`, bytes.byteLength);
  }
  return boundedText(writer.text, maxChars, file.size, bytes.byteLength, writer.truncated);
}

// HDF5: a structure summary (groups, datasets, attributes, small values) from jsfive, which
// needs the whole file in memory, so files above 256 MiB are not read.
async function extractHdf5(file, maxChars, injectedHdf5) {
  const { MAX_HDF5_BYTES, hdf5Structure, loadHdf5Library } = await import('./hdf5.mjs');
  if (file.size > MAX_HDF5_BYTES) return unavailable(file.size, 'HDF5 files larger than 256 MiB are not read.');
  let bytesRead = 0;
  try {
    const hdf5 = injectedHdf5 || await loadHdf5Library();
    const buffer = await file.arrayBuffer();
    bytesRead = buffer.byteLength;
    const summary = hdf5Structure(buffer, { hdf5, maxChars, name: file.name });
    return boundedText(summary.text, maxChars, file.size, bytesRead, summary.truncated);
  } catch (error) {
    return unavailable(file.size, `HDF5 structure is unavailable: ${error?.message || 'the file could not be parsed'}.`, bytesRead);
  }
}

const MEDIA_MIME = /^(audio|video|font|model)\//;
function unsupported(file, label, detail) {
  return unavailable(file.size, `Unsupported connected file type: ${label}${detail ? `; ${detail}` : ''}.`);
}

export async function extractConnectedText(file, {
  maxChars = MAX_EXTRACTED_CHARS,
  pdfjs,
  pdfPages,
  JSZip,
  hdf5,
} = {}) {
  validateFile(file);
  const limit = validateMaxChars(maxChars);
  const { format, conflict, extension, type } = connectedFormat(file);
  if (conflict) {
    return unavailable(file.size, `File MIME type does not match its extension: ${type} versus .${extension}.`);
  }
  const label = type || (extension ? `.${extension}` : 'unknown');

  if (format === 'text') return extractPlainText(file, limit);
  if (format === 'pdf') return extractPdf(file, limit, pdfjs, pdfPages);
  if (format === 'docx') return extractDocx(file, limit, JSZip);
  if (format === 'pptx') return extractPptx(file, limit, JSZip);
  if (Object.hasOwn(ZIP_DOCUMENTS, format)) return extractZipDocument(file, format, limit, JSZip);
  if (format === 'rtf') return extractRtf(file, limit);
  if (format === 'ipynb') return extractNotebook(file, limit);
  if (format === 'hdf5') return extractHdf5(file, limit, hdf5);
  if (format === 'hwp') return extractHwp(file, limit);
  if (format === 'legacy-office') return unsupported(file, label, 'older binary Office files are not read yet; save it as .docx, .xlsx or .pptx');
  if (format === 'image') return unsupported(file, label, 'images hold no text to read');
  if (MEDIA_MIME.test(type)) return unsupported(file, label);
  return extractPlainText(file, limit, { sniffed: true, label });
}
