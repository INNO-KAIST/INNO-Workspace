import { PLUGIN_LIMITS, PLUGIN_SOURCES, parseSkillFrontmatter, scanSkillText } from '../public/core/plugins.mjs';
import { PLUGIN_FILE_NAME } from './plugins.mjs';

// CR-007 S4 (PLG-05): catalog candidates from the allowed catalogs. Each scheduled run reads at
// most one catalog that is due, so the requests of one run stay small: the default-branch
// commit, its tree in one request, and up to eight SKILL.md files. A catalog is listed again
// once a day; while some SKILL.md files are still unread, the next ones are read an hour later
// from the same listing. A SKILL.md whose blob is unchanged is not read again. A skill folder
// is importable only as the registry would accept it (top-level SKILL.md named after its
// folder and .md/.txt files, within the size limit, no subfolders or scripts). Nothing is
// installed: the person imports a candidate at the listed commit, then reviews and approves it.

const DAY = 86_400_000, HOUR = 3_600_000, LEASE = 120_000, BUDGET = 60_000, TIMEOUT = 8000;
const MAX_TREE_BYTES = 2_000_000, MAX_SKILLS = 200, READS_PER_RUN = 8;
const AGENT = 'INNO-Workspace-plugin-registry';
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const accepted = (path) => path === 'SKILL.md' || (PLUGIN_FILE_NAME.test(path) && /\.(md|txt)$/.test(path));
const key = (catalog) => `plugin_discovery:${catalog}`;
const failure = (message) => Object.assign(new Error(message), { code: message });
const backoff = (failures) => Math.min(DAY, 900_000 * 2 ** Math.min(failures - 1, 7));
const unread = (candidate) => candidate.importable && !candidate.described;

// A fetch cut off at its own timeout or at the end of the run's time budget.
async function boundedFetch(fetchFn, url, init, timeoutMs, deadline) {
  const wait = Math.min(timeoutMs, deadline - Date.now());
  if (wait <= 0) throw failure('time_budget');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), wait);
  try {
    let response;
    try { response = await fetchFn(url, { ...init, redirect: 'manual', signal: controller.signal }); }
    catch { throw failure('network_error'); }
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw failure('http_error'); }
    return { response, done: () => clearTimeout(timer) };
  } catch (error) { clearTimeout(timer); throw error; }
}

async function boundedText(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw failure('body_too_large');
  const reader = response.body?.getReader();
  if (!reader) throw failure('format_changed');
  const chunks = [];
  let size = 0;
  for (;;) {
    let next;
    try { next = await reader.read(); } catch { throw failure('network_error'); }
    const { done, value } = next;
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { void reader.cancel().catch(() => {}); throw failure('body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw failure('format_changed'); }
}

// Skill folders under the catalog prefix, judged as the registry would judge an import.
function skillsFromTree(tree, prefix) {
  const skills = new Map();
  for (const entry of tree) {
    if (typeof entry?.path !== 'string' || !entry.path.startsWith(prefix)) continue;
    const [name, ...rest] = entry.path.slice(prefix.length).split('/');
    if (!NAME.test(name) || !rest.length) continue;
    if (!skills.has(name)) skills.set(name, { name, files: [], nested: false, skillSha: null });
    const skill = skills.get(name);
    if (rest.length > 1 || entry.type === 'tree') { skill.nested = true; continue; }
    if (entry.type !== 'blob') continue;
    skill.files.push({ path: rest[0], bytes: Number.isSafeInteger(entry.size) ? entry.size : Infinity });
    if (rest[0] === 'SKILL.md' && SHA.test(entry.sha)) skill.skillSha = entry.sha;
  }
  return [...skills.values()].slice(0, MAX_SKILLS).map((skill) => {
    const bytes = skill.files.reduce((total, file) => total + file.bytes, 0);
    const reason = !skill.files.some((file) => file.path === 'SKILL.md') ? 'SKILL.md가 없습니다.'
      : skill.nested ? '하위 폴더가 있어 가져올 수 없습니다(최상위 파일만 받습니다).'
      : skill.files.some((file) => !accepted(file.path)) ? '스크립트나 다른 형식 파일이 있어 가져올 수 없습니다(공백 없는 이름의 .md/.txt만 받습니다).'
      : skill.files.length > PLUGIN_LIMITS.files || bytes > PLUGIN_LIMITS.bytes ? `파일 수(${PLUGIN_LIMITS.files}개)나 크기(${PLUGIN_LIMITS.bytes.toLocaleString('en-US')}바이트) 상한을 넘습니다.`
      : null;
    return { name: skill.name, files: skill.files.length, bytes: Number.isFinite(bytes) ? bytes : null, importable: !reason, reason, skillSha: skill.skillSha, described: false, readFailed: false, description: null, warnings: [], blocked: false };
  });
}

export class PluginDiscovery {
  constructor(store, { fetchFn = fetch, timeoutMs = TIMEOUT } = {}) { this.store = store; this.fetchFn = fetchFn; this.timeoutMs = timeoutMs; }

  async stored(catalog) {
    const row = await this.store.db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key(catalog)).first();
    try { const value = row ? JSON.parse(row.value) : null; return value && Array.isArray(value.candidates) ? value : null; } catch { return null; }
  }

  // Sources with their state, and candidates not yet registered.
  async read(registered = new Set()) {
    const now = Date.parse(this.store.now()), sources = [], candidates = [];
    for (const [catalog, { repository, prefix }] of Object.entries(PLUGIN_SOURCES)) {
      const record = await this.stored(catalog);
      const expired = !record?.checkedAt || now - record.checkedAt >= DAY * 2;
      sources.push({ catalog, repository, status: !record?.checkedAt ? 'unavailable' : record.lastError || expired ? 'stale' : 'fresh', checkedAt: record?.checkedAt ?? null, commit: record?.commit ?? null, lastError: record?.lastError ?? null });
      for (const { skillSha, ...candidate } of record?.candidates ?? []) {
        const id = `${catalog}/${candidate.name}`;
        if (registered.has(id)) continue;
        candidates.push({ id, catalog, repository, ...candidate, source: { catalog, path: prefix + candidate.name, commit: record.commit } });
      }
    }
    return { sources, candidates };
  }

  // Reads the SKILL.md of up to eight unread importable skills: its description, whether its
  // name matches the folder (the registry requires it), and the static scan shown as risks.
  async describe({ repository, prefix }, commit, candidates, deadline) {
    let reads = 0;
    for (const candidate of candidates) {
      if (!unread(candidate) || reads >= READS_PER_RUN || Date.now() >= deadline) continue;
      reads += 1;
      try {
        const { response, done } = await boundedFetch(this.fetchFn, `https://raw.githubusercontent.com/${repository}/${commit}/${prefix}${candidate.name}/SKILL.md`, { headers: { 'user-agent': AGENT } }, this.timeoutMs, deadline);
        let text;
        try { text = await boundedText(response, PLUGIN_LIMITS.bytes); } finally { done(); }
        const meta = parseSkillFrontmatter(text);
        const findings = scanSkillText(text);
        Object.assign(candidate, { described: true, readFailed: false, description: typeof meta?.description === 'string' ? meta.description.slice(0, 300) : null, warnings: [...new Set(findings.map((finding) => finding.rule))].slice(0, 10), blocked: findings.some((finding) => finding.severity === 'block') });
        if (meta?.name !== candidate.name) Object.assign(candidate, { importable: false, reason: 'SKILL.md의 이름(name)이 폴더 이름과 달라 가져올 수 없습니다.' });
      } catch {
        // Cut off by the run's time budget: read in the next run. Otherwise the candidate stays
        // listed without a description and the read is tried again the next day.
        if (Date.now() < deadline) Object.assign(candidate, { described: true, readFailed: true });
      }
    }
    return candidates;
  }

  async scan(source, previous, deadline) {
    const json = async (url, maxBytes) => {
      const { response, done } = await boundedFetch(this.fetchFn, url, { headers: { accept: 'application/vnd.github+json', 'user-agent': AGENT } }, this.timeoutMs, deadline);
      try { const text = await boundedText(response, maxBytes); try { return JSON.parse(text); } catch { throw failure('format_changed'); } } finally { done(); }
    };
    const head = await json(`https://api.github.com/repos/${source.repository}/commits/HEAD`, 200_000);
    const commit = typeof head?.sha === 'string' && SHA.test(head.sha) ? head.sha : null;
    if (!commit) throw failure('format_changed');
    const tree = await json(`https://api.github.com/repos/${source.repository}/git/trees/${commit}?recursive=1`, MAX_TREE_BYTES);
    if (!Array.isArray(tree?.tree) || tree.truncated) throw failure('format_changed');
    // What was read from an unchanged SKILL.md is kept; a failed read is tried again.
    const known = new Map((previous?.candidates ?? []).filter((item) => item.described && !item.readFailed && item.skillSha).map((item) => [item.name, item]));
    const candidates = skillsFromTree(tree.tree, source.prefix).map((skill) => {
      const before = known.get(skill.name);
      if (!skill.importable || before?.skillSha !== skill.skillSha) return skill;
      const { described, description, warnings, blocked, importable, reason } = before;
      return { ...skill, described, readFailed: false, description, warnings, blocked, importable, reason };
    });
    return { commit, candidates: await this.describe(source, commit, candidates, deadline) };
  }

  // One due catalog per run: listed once a day (unread SKILL.md files continue an hour later);
  // a failure keeps the last list and waits with backoff.
  async refresh() {
    const now = Date.parse(this.store.now()), owner = crypto.randomUUID(), lock = JSON.stringify({ owner, expiresAt: now + LEASE });
    const claim = await this.store.db.prepare("INSERT INTO metadata(key,value) VALUES('plugin_discovery_lock',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CASE WHEN json_valid(metadata.value) THEN COALESCE(CAST(json_extract(metadata.value,'$.expiresAt') AS INTEGER),0) ELSE 0 END<=?2").bind(lock, now).run();
    if (!claim.meta.changes) return { claimed: false };
    try {
      const due = [];
      for (const [catalog, source] of Object.entries(PLUGIN_SOURCES)) {
        const previous = await this.stored(catalog);
        const at = Number.isFinite(previous?.nextAttemptAt) ? previous.nextAttemptAt : 0;
        if (at <= now) due.push({ catalog, source, previous, at });
      }
      const next = due.sort((a, b) => a.at - b.at)[0];
      if (!next) return { claimed: true };
      const { catalog, source, previous } = next, deadline = Date.now() + BUDGET;
      let record;
      try {
        if (previous?.commit && previous.candidates.some(unread) && now - previous.checkedAt < DAY) {
          const candidates = await this.describe(source, previous.commit, previous.candidates, deadline);
          record = { ...previous, candidates, nextAttemptAt: candidates.some(unread) ? now + HOUR : previous.checkedAt + DAY };
        } else {
          const scanned = await this.scan(source, previous, deadline);
          record = { ...scanned, checkedAt: now, nextAttemptAt: scanned.candidates.some(unread) ? now + HOUR : now + DAY, failures: 0, lastError: null };
        }
      } catch (error) {
        const failures = (previous?.failures ?? 0) + 1;
        record = { commit: previous?.commit ?? null, candidates: previous?.candidates ?? [], checkedAt: previous?.checkedAt ?? null, nextAttemptAt: now + backoff(failures), failures, lastError: error?.code ?? 'network_error' };
      }
      await this.store.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key(catalog), JSON.stringify(record)).run();
      return { claimed: true, catalog };
    } finally {
      await this.store.db.prepare("DELETE FROM metadata WHERE key='plugin_discovery_lock' AND value=?1").bind(lock).run();
    }
  }
}
