const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const EVIDENCE_SCOPES = new Set(['metadata', 'abstract', 'full-text']);

function parseJson(text, label) {
  if (typeof text !== 'string') throw new TypeError(`${label} input must be JSON text.`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new TypeError(`Invalid ${label} JSON: ${error.message}`);
  }
}

function assertFiniteNumbers(value, path = '$') {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteNumbers(item, `${path}[${index}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertFiniteNumbers(item, `${path}.${key}`);
  }
}

function normalizeDoi(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('Paper DOI must be a string.');
  const doi = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:/i, '');
  if (!DOI_PATTERN.test(doi) || /[\s<>"{}|\\^`]/.test(doi)) {
    throw new TypeError(`Invalid paper DOI: ${value}`);
  }
  return doi.toLowerCase();
}

function doiFromUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!/^(?:dx\.)?doi\.org$/i.test(url.hostname)) return null;
    return normalizeDoi(decodeURIComponent(url.pathname.slice(1)));
  } catch {
    return null;
  }
}

function asRecords(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') throw new TypeError('RefAtlas JSON must contain paper records.');
  if ('papers' in value) {
    if (Array.isArray(value.papers)) return value.papers;
    if (value.papers && typeof value.papers === 'object') return Object.values(value.papers);
    throw new TypeError('RefAtlas papers must be an array or object map.');
  }
  if ('title' in value || 'ti' in value || 'doi' in value || 'id' in value) return [value];
  return Object.values(value);
}

function normalizePaper(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(`RefAtlas paper ${index + 1} must be an object.`);
  }
  assertFiniteNumbers(record, `paper[${index}]`);
  const title = record.title ?? record.ti;
  if (typeof title !== 'string' || !title.trim()) {
    throw new TypeError(`RefAtlas paper ${index + 1} requires a title.`);
  }
  const id = record.id == null ? null : String(record.id);
  const fieldDoi = normalizeDoi(record.doi);
  const idDoi = id && /^doi:/i.test(id) ? normalizeDoi(id) : null;
  const urlDoi = doiFromUrl(record.url);
  const doiCandidates = [fieldDoi, idDoi, urlDoi].filter(Boolean);
  if (new Set(doiCandidates).size > 1) {
    throw new TypeError(`Paper DOI mismatch among id, doi, and URL: ${id || fieldDoi}`);
  }
  const doi = doiCandidates[0] ?? null;
  if (!id && !doi) throw new TypeError(`RefAtlas paper ${index + 1} requires a source identity.`);

  const abstractValue = record.abstract ?? record.ab ?? '';
  if (typeof abstractValue !== 'string') throw new TypeError('Paper abstract must be a string.');
  const fullTextValue = record.fullText ?? record.full_text ?? '';
  if (typeof fullTextValue !== 'string') throw new TypeError('Paper full-text evidence must be a string.');
  const hasAbstract = Boolean(abstractValue.trim());
  const hasFullText = Boolean(fullTextValue.trim());
  const evidenceScope = record.evidenceScope ?? record.evidence_scope
    ?? (hasFullText ? 'full-text' : hasAbstract ? 'abstract' : 'metadata');
  if (!EVIDENCE_SCOPES.has(evidenceScope)) {
    throw new TypeError(`Unsupported evidence scope: ${evidenceScope}`);
  }
  if (evidenceScope === 'abstract' && !hasAbstract) {
    throw new TypeError('Abstract evidence scope requires abstract text.');
  }
  if (evidenceScope === 'full-text' && !hasFullText) {
    throw new TypeError('Full-text scope requires actual full-text evidence.');
  }

  const normalized = {
    ...record,
    id: id || `doi:${doi}`,
    doi,
    title: title.trim(),
    abstract: abstractValue,
    year: record.year ?? record.yr ?? null,
    venue: record.venue ?? record.vn ?? '',
    authors: record.authors ?? record.au ?? [],
    source: record.source ?? record.src ?? '',
    tags: Array.isArray(record.tags) ? [...record.tags] : [],
    evidenceScope,
  };
  if (hasFullText) normalized.fullText = fullTextValue;
  return normalized;
}

export function parsePrismReport(text) {
  const report = parseJson(text, 'Prism');
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError('Invalid Prism report: expected an object.');
  }
  if (report.app !== 'INNO Prism') throw new TypeError('Prism report must identify app as INNO Prism.');
  if (typeof report.engine !== 'string' || !report.engine.trim()) {
    throw new TypeError('Prism report requires an engine version.');
  }
  if (!report.analysis || typeof report.analysis !== 'object' || Array.isArray(report.analysis)) {
    throw new TypeError('Prism report requires an analysis object.');
  }
  assertFiniteNumbers(report.analysis, 'analysis');
  if (report.source != null && (typeof report.source !== 'object' || Array.isArray(report.source))) {
    throw new TypeError('Prism source must be a source object.');
  }
  const source = report.source
    ? { ...report.source }
    : { app: report.app, file: typeof report.file === 'string' ? report.file : '' };
  assertFiniteNumbers(source, 'source');
  const parsed = { engine: report.engine, analysis: report.analysis, source };
  for (const key of ['settings', 'calibration', 'densityFactor_mWcm2_per_W', 'manualSlope']) {
    if (!Object.prototype.hasOwnProperty.call(report, key)) continue;
    assertFiniteNumbers(report[key], key);
    parsed[key] = report[key];
  }
  return parsed;
}

export function parseRefAtlas(text) {
  const parsed = parseJson(text, 'RefAtlas');
  return asRecords(parsed).map(normalizePaper);
}

function searchableText(paper) {
  const authors = Array.isArray(paper.authors)
    ? paper.authors.map((author) => (typeof author === 'string' ? author : author?.name ?? '')).join(' ')
    : String(paper.authors ?? '');
  return {
    doi: paper.doi ?? '',
    title: paper.title ?? '',
    metadata: [authors, paper.venue, paper.source, ...(paper.tags ?? [])].join(' '),
    abstract: paper.abstract ?? '',
  };
}

export function searchPapers(papers, query, limit = 20) {
  if (!Array.isArray(papers)) throw new TypeError('papers must be an array.');
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError('limit must be a non-negative integer.');
  if (limit === 0) return [];
  const terms = String(query ?? '').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return [];
  return papers
    .map((paper, index) => {
      const fields = searchableText(paper);
      const lowered = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value).toLocaleLowerCase()]));
      if (!terms.every((term) => Object.values(lowered).some((value) => value.includes(term)))) return null;
      let score = 0;
      for (const term of terms) {
        if (lowered.doi.includes(term)) score += 12;
        if (lowered.title.includes(term)) score += 8;
        if (lowered.metadata.includes(term)) score += 3;
        if (lowered.abstract.includes(term)) score += 1;
      }
      return { paper, index, score };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ paper }) => paper);
}

function integration(id, name, repository, { imports = [], appUrl = null } = {}) {
  const repositoryUrl = `https://github.com/INNO-KAIST/${repository}`;
  return Object.freeze({
    id,
    name,
    url: appUrl || repositoryUrl,
    repositoryUrl,
    linkKind: appUrl ? 'app' : 'repository',
    imports: Object.freeze([...imports]),
  });
}

export const INTEGRATIONS = Object.freeze([
  integration('scheduler', 'INNO Scheduler', 'INNO-Scheduler', {
    appUrl: 'https://inno-kaist.github.io/INNO-Scheduler/',
  }),
  integration('nanolab', 'INNO NanoLab', 'INNO-NanoLab'),
  integration('ledger', 'INNO Ledger', 'INNO-Ledger'),
  integration('prism', 'INNO Prism', 'INNO-Prism', { imports: ['analysis-json'] }),
  integration('analytics', 'INNO Analytics', 'INNO-Analytics'),
  integration('refatlas', 'INNO RefAtlas', 'INNO-RefAtlas', { imports: ['catalog-json', 'papers-json'] }),
]);
