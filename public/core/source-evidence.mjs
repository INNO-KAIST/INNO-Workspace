// Differentiation ② (source evidence): a result made from originals names, for each key claim,
// the source, a place in it and a short quote. The runner on this PC checks each quote against
// the original text it received; only places, short quotes and the check are kept, never the
// originals. A locator is shown as written (page numbering differs between documents).
// The whole record stays under 32 KB (UTF-8), so it never crowds out the result it describes.
// A source name is an attachment's path (up to 2,000 characters) or name, as the runner sees it.
export const SOURCE_EVIDENCE_LIMITS = Object.freeze({claims: 30, text: 500, sources: 5, locator: 100, quote: 200, name: 2_000, minQuote: 8, bytes: 32_000});
const encoder = new TextEncoder();
const bytesOf = value => encoder.encode(JSON.stringify(value)).byteLength;

// The first n characters of text, never splitting a character made of two UTF-16 units. Model
// output that is not text becomes empty text, so nothing here can throw on it.
const chars = (value, n) => typeof value === 'string' ? Array.from(value).slice(0, n).join('') : '';
const normal = value => value.replace(/\s+/g, ' ').trim().toLowerCase();
const checkable = quote => normal(quote).length >= SOURCE_EVIDENCE_LIMITS.minQuote;
const textual = material => material && !material.image && typeof material.text === 'string' && typeof material.name === 'string';

// Sources are named by name or by their number in the prompt (<source index="N">, also written as
// text). A source this run did not receive is dropped; a claim left without sources is shown as
// unsupported. No claims, or none valid, is no record (null).
export function traceClaims(claims, materials = []) {
  if (!Array.isArray(claims) || !Array.isArray(materials) || !materials.some(textual)) return null;
  const byName = new Map();
  for (const material of materials) if (textual(material) && !byName.has(material.name)) byName.set(material.name, material);
  const byIndex = index => Number.isInteger(index) && index >= 1 && textual(materials[index - 1]) ? materials[index - 1] : null;
  const resolve = source => (typeof source === 'string' ? byName.get(source) : null) ?? (typeof source === 'string' && /^[1-9]\d{0,3}$/.test(source) ? byIndex(Number(source)) : byIndex(source));
  const traced = [];
  let bytes = bytesOf({version: 1, claims: []});
  for (const claim of claims) {
    if (traced.length >= SOURCE_EVIDENCE_LIMITS.claims) break;
    if (!claim || typeof claim !== 'object' || typeof claim.text !== 'string' || !claim.text.trim()) continue;
    const sources = [];
    for (const item of Array.isArray(claim.sources) ? claim.sources : []) {
      if (sources.length >= SOURCE_EVIDENCE_LIMITS.sources) break;
      const material = item && typeof item === 'object' ? resolve(item.source) : null;
      if (!material || Array.from(material.name).length > SOURCE_EVIDENCE_LIMITS.name) continue;
      const quote = chars(item.quote, SOURCE_EVIDENCE_LIMITS.quote);
      const found = checkable(quote) && normal(material.text).includes(normal(quote));
      sources.push({name: material.name, locator: chars(item.locator, SOURCE_EVIDENCE_LIMITS.locator), quote, found});
    }
    const entry = {text: chars(claim.text.trim(), SOURCE_EVIDENCE_LIMITS.text), sources};
    // Claims past the byte limit are left out, as the later of more than 30 claims are.
    bytes += bytesOf(entry) + 1;
    if (bytes > SOURCE_EVIDENCE_LIMITS.bytes) break;
    traced.push(entry);
  }
  return traced.length ? {version: 1, claims: traced} : null;
}

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const short = (value, max, min = 0) => typeof value === 'string' && value.length >= min && Array.from(value).length <= max;
// The record as the cloud accepts it: exact shape and limits, and (given the task) only the task's
// own source names. Anything else is dropped (null); the result itself is never refused for it.
export function boundedSourceEvidence(value, task) {
  if (!exact(value, ['version', 'claims']) || value.version !== 1 || !Array.isArray(value.claims) || !value.claims.length || value.claims.length > SOURCE_EVIDENCE_LIMITS.claims) return null;
  for (const claim of value.claims) {
    if (!exact(claim, ['text', 'sources']) || !short(claim.text, SOURCE_EVIDENCE_LIMITS.text, 1) || !Array.isArray(claim.sources) || claim.sources.length > SOURCE_EVIDENCE_LIMITS.sources) return null;
    for (const source of claim.sources) {
      if (!exact(source, ['name', 'locator', 'quote', 'found']) || !short(source.name, SOURCE_EVIDENCE_LIMITS.name, 1) || !short(source.locator, SOURCE_EVIDENCE_LIMITS.locator) || !short(source.quote, SOURCE_EVIDENCE_LIMITS.quote) || typeof source.found !== 'boolean') return null;
    }
  }
  if (bytesOf(value) > SOURCE_EVIDENCE_LIMITS.bytes) return null;
  if (task) {
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    const names = new Set(attachments.filter(item => item && typeof item === 'object' && item.source !== 'url').map(item => item.path || item.name));
    if (value.claims.some(claim => claim.sources.some(source => !names.has(source.name)))) return null;
  }
  return {version: 1, claims: value.claims.map(claim => ({text: claim.text, sources: claim.sources.map(({name, locator, quote, found}) => ({name, locator, quote, found}))}))};
}

const STATUS_LABELS = {found: '원문 확인', missing: '원문에서 찾지 못함', unchecked: '인용 없음', unsupported: '근거 없음'};
const sourceState = source => source.found ? '원문 확인됨' : !source.quote.trim() ? '인용 없음' : !checkable(source.quote) ? '인용이 짧아 확인 안 함' : '원문에서 찾지 못함';
// The page view: a summary line and, per claim, its state and source lines. A source given without
// a quote long enough to check is not a failed check: such a claim is shown as "인용 없음".
export function sourceEvidenceView(evidence) {
  if (!Array.isArray(evidence?.claims) || !evidence.claims.length) return null;
  const claims = evidence.claims.map(claim => {
    const status = !claim.sources.length ? 'unsupported' : claim.sources.some(source => source.found) ? 'found' : claim.sources.some(source => checkable(source.quote)) ? 'missing' : 'unchecked';
    return {
      text: claim.text, status, label: STATUS_LABELS[status],
      sources: claim.sources.map(source => [source.name, source.locator || '위치 없음', ...(source.quote ? [`“${source.quote}”`] : []), sourceState(source)].join(' · ')),
    };
  });
  const count = status => claims.filter(claim => claim.status === status).length;
  const unchecked = count('unchecked');
  return {summary: `근거 추적: 주장 ${claims.length}개 · 원문 확인 ${count('found')} · 원문에서 찾지 못함 ${count('missing')} · 근거 없음 ${count('unsupported')}${unchecked ? ` · 인용 없음 ${unchecked}` : ''}`, claims};
}
