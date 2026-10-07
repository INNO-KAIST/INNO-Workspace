import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { sanitizeUsageHistory, usageHistory } from '../public/core/execution-usage.mjs';
import { exactWorseP, pluginEvidence } from '../public/core/plugin-evidence.mjs';
import { pluginArchiveText, pluginEvidenceText, pluginRecommendationRows } from '../public/plugin-ui.mjs';
import { createWorker } from '../worker/index.mjs';
import { PluginDiscovery } from '../worker/plugin-discovery.mjs';
import { D1TaskStore } from '../worker/store.mjs';
import { TestD1 } from './helpers/d1.mjs';

// CR-007 S4 (PLG-04, PLG-05): each execution records the plugins it received; per plugin the
// screen shows the evidence from normal work against runs of the same task types without
// plugins, says nothing when the samples are too few, and flags unused or worse-performing
// plugins for the person to review. Removing a plugin keeps its evidence. Allowed catalogs are
// read once a day for recommendation candidates; nothing is installed automatically.
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-07T00:00:00Z');
const HASH = 'a'.repeat(64);
const ID = 'anthropics/brand-guidelines';

test('an execution record keeps the plugins its run received', () => {
  const owner = { provider: 'claude', executionId: 'e1', generation: 1, claimedAt: '2026-10-06T00:00:00Z', pluginDelivery: { version: 1, applied: [{ id: ID, contentHash: HASH, reason: 'Brand rules' }], skipped: [] } };
  const [entry] = usageHistory(owner, { inputTokens: 10, outputTokens: 5 }, '2026-10-06T00:01:00Z', { task: { id: 't' }, transition: 'completion' });
  assert.deepEqual(entry.plugins, [{ id: ID, contentHash: HASH }]);
  assert.equal(entry.taskType, 'general', 'a task without a type is recorded as general');
  const [plain] = usageHistory({ ...owner, pluginDelivery: undefined }, {}, '2026-10-06T00:01:00Z', { task: { id: 't' }, transition: 'completion' });
  assert.equal(plain.plugins, undefined);
  // The failure kind and the task type at the time of the run are kept, so later evidence can
  // leave out runs that never started and is not moved by a task whose type changes later.
  const [failed] = usageHistory(owner, {}, '2026-10-06T00:01:00Z', { task: { id: 't', type: 'analysis' }, transition: 'failure', failureKind: 'quota' });
  assert.deepEqual([failed.failureKind, failed.taskType], ['quota', 'analysis']);
  const kept = usageHistory({ ...owner, executionId: 'e2', usageHistory: [failed] }, {}, '2026-10-06T00:02:00Z', { task: { id: 't', type: 'writing' }, transition: 'completion' });
  assert.deepEqual(kept.map((row) => [row.failureKind, row.taskType]), [['quota', 'analysis'], [undefined, 'writing']]);
  assert.equal(sanitizeUsageHistory([failed])[0].failureKind, undefined, 'imported rows carry no failure kind');
});

const run = (transition, plugins, completedAt = NOW - DAY, extra = {}) => ({ provider: 'claude', executionId: `e${Math.random()}`, generation: 1, completedAt: new Date(completedAt).toISOString(), source: 'executor_report', phase: 'master', transition, phaseSource: 'server_state', wallElapsedMs: 60_000, inputTokens: 1000, outputTokens: 200, ...(transition === 'failure' ? { failureKind: 'unknown' } : {}), ...(plugins ? { plugins: plugins.map((id) => ({ id, contentHash: HASH })) } : {}), ...extra });
// Rows carry the task type they ran under, as the server records it; a row given taskType
// undefined stands for a row written before this record existed.
const task = (type, runs) => ({ id: `t${Math.random()}`, title: 'x', type, checkpoint: { usageHistory: runs.map((row) => ('taskType' in row ? row : { ...row, taskType: type })) } });
// One task per run, so each side has as many distinct tasks as runs.
const each = (type, count, make) => Array.from({ length: count }, (_, index) => task(type, [make(index)]));
const approved = (id, approvedAt = NOW - 60 * DAY) => ({ id, name: id.split('/')[1], status: 'approved', approvedAt: new Date(approvedAt).toISOString(), contentHash: HASH });
const judge = (tasks, plugin = approved(ID)) => pluginEvidence({ plugins: [plugin], tasks, now: NOW })[0];

test('evidence says nothing on few runs or few tasks, and flags unused plugins', () => {
  const few = judge([task('analysis', [run('completion', [ID]), run('completion', [ID])]), task('analysis', [run('completion')])]);
  assert.equal(few.verdict, 'insufficient');
  assert.match(few.text, /근거 부족/);
  const oneTask = judge([task('analysis', Array.from({ length: 6 }, () => run('failure', [ID]))), task('analysis', Array.from({ length: 6 }, () => run('completion')))]);
  assert.equal(oneTask.verdict, 'insufficient', 'six runs of one task are not five independent observations');
  assert.equal(judge([]).verdict, 'unused');
  assert.equal(judge([], approved(ID, NOW - 3 * DAY)).verdict, 'insufficient', 'a plugin approved days ago is not called unused');
  const quotaOnly = judge(each('analysis', 3, () => run('failure', [ID], NOW - DAY, { failureKind: 'quota' })));
  assert.notEqual(quotaOnly.verdict, 'unused', 'a plugin that was sent is not unused even when the runs never started');
  const old = judge(each('analysis', 6, () => run('failure', [ID], NOW - 120 * DAY)));
  assert.equal(old.runs, 0, 'runs outside the 90-day window are not counted');
});

test('only a clear and statistically supported difference in unfinished runs is called worse', () => {
  const worse = judge([...each('analysis', 6, (i) => run(i ? 'failure' : 'completion', [ID])), ...each('analysis', 6, () => run('completion')), ...each('writing', 6, () => run('failure'))]);
  assert.equal(worse.verdict, 'worse');
  assert.deepEqual([worse.runs, worse.completed, worse.baseline.runs, worse.baseline.completed], [6, 1, 6, 6], 'another task type is not the comparison');
  assert.match(worse.text, /삭제를 검토/);
  assert.match(pluginEvidenceText(worse), /적용 6회/);
  assert.match(pluginEvidenceText(worse), /중앙값/, 'time and tokens are shown next to the counts');
  // 3 of 5 against 1 of 5 is a 40-point gap, but chance explains it (one-sided exact p ≈ 0.26).
  const weak = judge([...each('analysis', 5, (i) => run(i < 3 ? 'failure' : 'completion', [ID])), ...each('analysis', 5, (i) => run(i < 1 ? 'failure' : 'completion'))]);
  assert.equal(weak.verdict, 'no_clear_difference');
  const even = judge([...each('analysis', 6, () => run('completion', [ID])), ...each('analysis', 6, () => run('completion'))]);
  assert.equal(even.verdict, 'no_clear_difference');
  assert.doesNotMatch(even.text, /우수|좋|향상/, 'no gain is claimed');
  assert.ok(Math.abs(exactWorseP(3, 5, 1, 5) - 66 / 252) < 1e-12);
  assert.ok(Math.abs(exactWorseP(5, 6, 0, 6) - 7 / 924) < 1e-12);
  assert.equal(exactWorseP(0, 5, 0, 5), 1);
  assert.ok(Math.abs(exactWorseP(5, 5, 5, 5) - 1) < 1e-12);
});

test('rows written before failure kinds were recorded count on neither side', () => {
  // Their completions would stay while their failures drop out, making the comparison look better than it was.
  const legacy = (transition) => run(transition, null, NOW - DAY, { taskType: undefined, failureKind: undefined });
  const judged = judge([...each('analysis', 6, (i) => run(i < 3 ? 'failure' : 'completion', [ID])), ...each('analysis', 6, () => run('completion')), ...each('analysis', 10, () => legacy('completion')), ...each('analysis', 5, () => legacy('failure'))]);
  assert.deepEqual([judged.baseline.runs, judged.verdict], [6, 'no_clear_difference']);
});

test('runs that never started, other providers, older plugin versions and later type changes do not move the evidence', () => {
  // Quota and sign-in failures say nothing about the plugin; neither do failures without a kind.
  const notStarted = judge([...each('analysis', 5, () => run('completion', [ID])), ...each('analysis', 5, () => run('failure', [ID], NOW - DAY, { failureKind: 'quota' })), ...each('analysis', 2, () => run('failure', [ID], NOW - DAY, { failureKind: 'authentication' })), ...each('analysis', 1, () => run('failure', [ID], NOW - DAY, { failureKind: undefined })), ...each('analysis', 6, () => run('completion'))]);
  assert.deepEqual([notStarted.runs, notStarted.failed, notStarted.excluded, notStarted.verdict], [5, 0, 8, 'no_clear_difference']);
  assert.match(pluginEvidenceText(notStarted), /제외 8회/);
  const otherProvider = judge([...each('analysis', 6, () => run('failure', [ID])), ...each('analysis', 6, () => run('completion', null, NOW - DAY, { provider: 'codex' }))]);
  assert.deepEqual([otherProvider.baseline.runs, otherProvider.verdict], [0, 'insufficient'], 'Codex runs are not the comparison for Claude runs');
  const olderVersion = judge(each('analysis', 6, () => run('failure', null, NOW - DAY, { plugins: [{ id: ID, contentHash: 'b'.repeat(64) }] })));
  assert.equal(olderVersion.runs, 0, 'runs of an earlier plugin content are not this version\'s evidence');
  // The type recorded with the run wins over the task's current type.
  const moved = judge([...each('writing', 6, () => run('failure', [ID], NOW - DAY, { taskType: 'analysis' })), ...each('analysis', 6, () => run('completion'))]);
  assert.deepEqual([moved.baseline.runs, moved.verdict], [6, 'worse']);
});

const TOKEN = 'plugin-effects-token-0123456789abcdef';
const COMMIT = 'f'.repeat(40);
const SKILL = '---\nname: brand-guidelines\ndescription: Apply brand guidelines.\n---\n\nUse the navy brand palette for every heading.\n';
const gitSha = (text) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
function cloud(t, extraFetch = () => null) {
  const DB = new TestD1();
  t.after(() => DB.close());
  const store = new D1TaskStore(DB);
  const fetchFn = async (url, init = {}) => {
    const target = new URL(String(url));
    const extra = await extraFetch(target, init);
    if (extra) return extra;
    if (target.hostname === 'api.github.com' && target.pathname.includes('/compare/')) return Response.json({ status: 'ahead' });
    if (target.hostname === 'api.github.com' && target.pathname.includes('/contents/')) return Response.json([{ name: 'SKILL.md', path: 'skills/brand-guidelines/SKILL.md', type: 'file', size: Buffer.byteLength(SKILL), sha: gitSha(SKILL) }]);
    if (target.hostname === 'raw.githubusercontent.com') return new Response(SKILL);
    if (target.hostname === 'api.anthropic.com') return Response.json({ claude_code_session_id: 's', claude_code_session_url: 'https://claude.ai/code/s' });
    throw new Error(`unexpected network ${target}`);
  };
  const worker = createWorker({ fetchFn });
  const env = { DB, ACCESS_TOKEN: TOKEN, CLAUDE_ROUTINE_URL: 'https://api.anthropic.com/v1/fire', CLAUDE_ROUTINE_TOKEN: 'routine-token-0123456789' };
  const call = async (path, body) => {
    const response = await worker.fetch(new Request(`https://inno.test${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: response.status, body: await response.json() };
  };
  return { DB, store, call, worker, env };
}

test('a cloud run with a plugin records it in the execution history, and removing the plugin keeps its evidence', async (t) => {
  const { store, call } = cloud(t);
  const { plugin } = (await call('/api/plugins/import', { catalog: 'anthropics', path: 'skills/brand-guidelines', commit: COMMIT })).body;
  await call('/api/plugins/approve', { id: plugin.id, contentHash: plugin.contentHash });
  const created = await store.createTask({ prompt: 'Design a poster' });
  await call(`/api/tasks/${created.id}/plugins`, { expectedVersion: (await store.requireTask(created.id)).version, plugins: [{ id: ID, reason: 'Brand rules apply' }] });
  assert.equal((await call(`/api/tasks/${created.id}/run`, { provider: 'claude', expectedVersion: (await store.requireTask(created.id)).version })).status, 202);
  const running = await store.requireTask(created.id);
  const done = await store.finishExecution(created.id, { executionId: running.checkpoint.executionId, generation: running.checkpoint.generation, content: 'done' });
  assert.deepEqual(done.checkpoint.usageHistory.at(-1).plugins, [{ id: ID, contentHash: plugin.contentHash }]);
  const evidence = (await call('/api/plugin-evidence')).body;
  assert.equal(evidence.plugins[0].id, ID);
  assert.equal(evidence.plugins[0].runs, 1);
  assert.equal((await call('/api/plugins/remove', { id: ID, confirm: true })).status, 200);
  const after = (await call('/api/plugin-evidence')).body;
  assert.deepEqual(after.plugins, []);
  assert.equal(after.archive[0].id, ID);
  assert.equal(after.archive[0].contentHash, plugin.contentHash);
  assert.equal(after.archive[0].evidence.runs, 1);
  // The removal time is shown on a 24-hour clock in the viewer's zone, not as a UTC date.
  assert.match(pluginArchiveText({ ...after.archive[0], removedAt: '2026-10-06T16:30:00Z' }, { timeZone: 'Asia/Seoul' }), /^anthropics\/brand-guidelines · 10월 7일 01:30 삭제 · 적용 1회/);
});

// Runs `action` once, right after the next read of the removal archive.
function afterArchiveRead(DB, action) {
  const prepare = DB.prepare.bind(DB), state = { done: false };
  const hook = (statement) => {
    const first = statement.first.bind(statement), bind = statement.bind.bind(statement);
    statement.first = async () => {
      const row = await first();
      if (!state.done && (statement.sql.includes('plugin_archive') || statement.values.includes('plugin_archive'))) { state.done = true; action(); }
      return row;
    };
    statement.bind = (...values) => hook(bind(...values));
    return statement;
  };
  DB.prepare = (sql) => hook(prepare(sql));
  return state;
}
const importBrand = (call) => call('/api/plugins/import', { catalog: 'anthropics', path: 'skills/brand-guidelines', commit: COMMIT });

test('a removal that races another removal keeps both pieces of evidence', async (t) => {
  const { DB, call } = cloud(t);
  assert.equal((await importBrand(call)).status, 200);
  // Right after this removal reads the archive, another removal writes its own entry.
  const other = { id: 'anthropics/notes', removedAt: '2026-10-06T00:00:00.000Z' };
  const raced = afterArchiveRead(DB, () => DB.db.prepare("INSERT INTO metadata(key,value) VALUES('plugin_archive',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify([other])));
  assert.equal((await call('/api/plugins/remove', { id: ID, confirm: true })).status, 200);
  assert.ok(raced.done);
  const { plugins, archive } = (await call('/api/plugin-evidence')).body;
  assert.deepEqual(plugins, []);
  assert.deepEqual(archive.map((entry) => entry.id), [ID, 'anthropics/notes']);
});

test('a removal stops when the plugin is re-imported or removed meanwhile, and writes no evidence for it', async (t) => {
  const rows = (DB) => DB.db.prepare(`SELECT key FROM metadata WHERE key IN ('plugin:${ID}','plugin_content:${ID}','plugin_archive') ORDER BY key`).all().map((row) => row.key);
  const changed = cloud(t);
  assert.equal((await importBrand(changed.call)).status, 200);
  afterArchiveRead(changed.DB, () => changed.DB.db.prepare("UPDATE metadata SET value=json_set(value,'$.contentHash',?) WHERE key=?").run('c'.repeat(64), `plugin:${ID}`));
  assert.equal((await changed.call('/api/plugins/remove', { id: ID, confirm: true })).status, 409);
  assert.deepEqual(rows(changed.DB), [`plugin:${ID}`, `plugin_content:${ID}`], 'the new version stays and no evidence is written');
  const gone = cloud(t);
  assert.equal((await importBrand(gone.call)).status, 200);
  afterArchiveRead(gone.DB, () => gone.DB.db.prepare("DELETE FROM metadata WHERE key IN (?,?)").run(`plugin:${ID}`, `plugin_content:${ID}`));
  assert.equal((await gone.call('/api/plugins/remove', { id: ID, confirm: true })).status, 404);
  assert.deepEqual(rows(gone.DB), []);
});

// The allowed catalogs, as the GitHub API lists them. Blob SHAs follow the file path, so a
// listing read again on another day reports the same SKILL.md unchanged.
const blob = (path, size) => ({ path, type: 'blob', size, sha: createHash('sha1').update(path).digest('hex') });
function catalogFetch({ failTree = false, many = 0, hang = null } = {}) {
  const trees = {
    'anthropics/skills': [
      blob('skills/brand-guidelines/SKILL.md', 120),
      blob('skills/pdf-tools/SKILL.md', 300),
      blob('skills/pdf-tools/reference.md', 400),
      blob('skills/web-scraper/SKILL.md', 200),
      blob('skills/web-scraper/scrape.py', 900),
      { path: 'skills/deck-maker', type: 'tree' },
      blob('skills/deck-maker/SKILL.md', 200),
      blob('skills/deck-maker/templates/a.md', 200),
      blob('skills/caps/SKILL.md', 100),
      blob('skills/caps/NOTES.MD', 100),
      blob('skills/spaced/SKILL.md', 100),
      blob('skills/spaced/my notes.md', 100),
      blob('skills/renamed/SKILL.md', 100),
      ...Array.from({ length: many }, (_, i) => blob(`skills/extra-${i}/SKILL.md`, 100)),
      blob('README.md', 50),
    ],
    'openai/skills': [
      blob('skills/.curated/notes/SKILL.md', 150),
      blob('skills/.system/hidden/SKILL.md', 150),
    ],
  };
  const skills = {
    'skills/brand-guidelines/SKILL.md': SKILL,
    'skills/pdf-tools/SKILL.md': '---\nname: pdf-tools\ndescription: Read and summarise PDF files.\n---\n\nRun `curl https://example.com` first.\n',
    'skills/.curated/notes/SKILL.md': '---\nname: notes\ndescription: Keep meeting notes tidy.\n---\n\nUse headings.\n',
    'skills/renamed/SKILL.md': '---\nname: something-else\ndescription: Named differently from its folder.\n---\n\nText.\n',
    ...Object.fromEntries(Array.from({ length: many }, (_, i) => [`skills/extra-${i}/SKILL.md`, `---\nname: extra-${i}\ndescription: Extra ${i}.\n---\n\nText.\n`])),
  };
  const counts = { tree: 0, raw: 0 };
  const fetchFn = async (url, init = {}) => {
    const target = new URL(String(url));
    const repository = target.pathname.split('/').slice(2, 4).join('/');
    if (target.hostname === 'api.github.com' && target.pathname.endsWith('/commits/HEAD')) return Response.json({ sha: repository.startsWith('anthropics') ? 'a'.repeat(40) : 'b'.repeat(40) });
    if (target.hostname === 'api.github.com' && target.pathname.includes('/git/trees/')) {
      counts.tree += 1;
      if (failTree) return new Response('rate limited', { status: 403 });
      return Response.json({ tree: trees[repository], truncated: false });
    }
    if (target.hostname === 'raw.githubusercontent.com') {
      counts.raw += 1;
      const path = target.pathname.split('/').slice(4).join('/');
      if (hang && path.includes(hang)) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      return skills[path] ? new Response(skills[path]) : new Response('missing', { status: 404 });
    }
    throw new Error(`unexpected network ${target}`);
  };
  return { fetchFn, counts };
}

test('catalog recommendations list importable skills with their risks, explain the others, and read one catalog a day each', async (t) => {
  const DB = new TestD1();
  t.after(() => DB.close());
  let now = NOW;
  const store = new D1TaskStore(DB, { now: () => new Date(now).toISOString() });
  const { fetchFn, counts } = catalogFetch();
  const discovery = new PluginDiscovery(store, { fetchFn });
  await discovery.refresh();
  assert.deepEqual((await discovery.read()).sources.map((source) => source.status), ['fresh', 'unavailable'], 'one catalog per scheduled run bounds the requests');
  await discovery.refresh();
  const result = await discovery.read(new Set([ID]));
  assert.deepEqual(result.sources.map((source) => [source.catalog, source.status, source.commit]), [['anthropics', 'fresh', 'a'.repeat(40)], ['openai', 'fresh', 'b'.repeat(40)]]);
  const byId = Object.fromEntries(result.candidates.map((candidate) => [candidate.id, candidate]));
  assert.equal(byId[ID], undefined, 'a registered plugin is not recommended');
  assert.equal(byId['anthropics/pdf-tools'].importable, true);
  assert.equal(byId['anthropics/pdf-tools'].description, 'Read and summarise PDF files.');
  assert.ok(byId['anthropics/pdf-tools'].warnings.length > 0, 'the static scan of SKILL.md is shown as a risk');
  assert.deepEqual(byId['anthropics/pdf-tools'].source, { catalog: 'anthropics', path: 'skills/pdf-tools', commit: 'a'.repeat(40) });
  assert.equal(byId['anthropics/web-scraper'].importable, false);
  assert.match(byId['anthropics/web-scraper'].reason, /스크립트/);
  assert.equal(byId['anthropics/deck-maker'].importable, false);
  assert.match(byId['anthropics/deck-maker'].reason, /하위 폴더/);
  // The registry accepts lower-case .md/.txt names without spaces, and a SKILL.md named after its folder.
  assert.equal(byId['anthropics/caps'].importable, false);
  assert.equal(byId['anthropics/spaced'].importable, false);
  assert.equal(byId['anthropics/renamed'].importable, false);
  assert.match(byId['anthropics/renamed'].reason, /이름/);
  assert.equal(byId['openai/notes'].description, 'Keep meeting notes tidy.');
  assert.equal(byId['openai/hidden'], undefined, 'only the curated folder counts');
  await discovery.refresh();
  assert.equal(counts.tree, 2, 'each catalog is read once a day');
  now += DAY + 1;
  await discovery.refresh();
  await discovery.refresh();
  assert.equal(counts.tree, 4);
  const rows = pluginRecommendationRows(result);
  const pdf = rows.find((row) => row.id === 'anthropics/pdf-tools');
  assert.match(pdf.basis, /공식 카탈로그 anthropics\/skills/);
  assert.match(pdf.basis, /관련성은 판단하지 않/, 'the reason says what was and was not judged');
  assert.ok(pdf.risks.some((risk) => /SKILL\.md만/.test(risk)), 'the scan covers SKILL.md only');
  assert.equal(pdf.canImport, true);
  assert.deepEqual(pdf.input, { catalog: 'anthropics', path: 'skills/pdf-tools', commit: 'a'.repeat(40) });
  const shown = (extra) => pluginRecommendationRows({ candidates: [{ id: 'anthropics/x', catalog: 'anthropics', repository: 'anthropics/skills', importable: true, described: true, warnings: [], source: { catalog: 'anthropics', path: 'skills/x', commit: 'a'.repeat(40) }, ...extra }] })[0];
  const blocked = shown({ blocked: true, warnings: ['detection_evasion'] });
  assert.equal(blocked.canImport, false, 'a blocked candidate gets no import button');
  assert.doesNotMatch(blocked.basis, /가져올 수 있습니다/);
  // Before SKILL.md is read, neither its scan nor its name check has run, and the text says so.
  for (const pending of [shown({ described: false }), shown({ readFailed: true })]) {
    assert.doesNotMatch(pending.basis, /등록부 기준으로 가져올 수 있습니다/);
    assert.ok(!pending.risks.some((risk) => /SKILL\.md만 미리 검사했습니다/.test(risk)));
    assert.ok(pending.risks.some((risk) => /가져올 때 모든 파일을 검사/.test(risk)));
  }
  assert.match(shown({ readFailed: true }).basis, /읽지 못했습니다/);
});

test('skill descriptions are read a few at a time, reused while SKILL.md is unchanged, and a hung read is cut off', async (t) => {
  const DB = new TestD1();
  t.after(() => DB.close());
  let now = NOW;
  const store = new D1TaskStore(DB, { now: () => new Date(now).toISOString() });
  const { fetchFn, counts } = catalogFetch({ many: 12, hang: 'pdf-tools' });
  const discovery = new PluginDiscovery(store, { fetchFn, timeoutMs: 50 });
  await discovery.refresh();
  const first = (await discovery.read()).candidates.filter((candidate) => candidate.catalog === 'anthropics' && candidate.importable);
  assert.equal(counts.raw, 8, 'at most eight SKILL.md reads in one run');
  assert.ok(first.some((candidate) => candidate.described === false), 'the rest wait for the next run');
  assert.equal(first.find((candidate) => candidate.id === 'anthropics/pdf-tools').description, null, 'a hung read ends without a description');
  await discovery.refresh(); // the other catalog
  now += 3_600_001;
  await discovery.refresh();
  assert.equal(counts.tree, 2, 'continuing the descriptions does not list the catalog again');
  const later = (await discovery.read()).candidates.filter((candidate) => candidate.catalog === 'anthropics' && candidate.importable);
  assert.ok(later.every((candidate) => candidate.described), 'every importable skill was tried');
  const raw = counts.raw;
  now += DAY;
  await discovery.refresh();
  assert.equal(counts.tree, 3);
  assert.equal(counts.raw - raw, 1, 'an unchanged SKILL.md is not read again; only the read that failed is tried again');
  assert.equal((await discovery.read()).candidates.find((candidate) => candidate.id === 'anthropics/extra-0').description, 'Extra 0.');
});

test('a lock row without an expiry does not stop the catalog refresh for good', async (t) => {
  const DB = new TestD1();
  t.after(() => DB.close());
  await DB.prepare("INSERT INTO metadata(key,value) VALUES('plugin_discovery_lock','{\"owner\":\"old\"}')").run();
  const discovery = new PluginDiscovery(new D1TaskStore(DB), { fetchFn: catalogFetch().fetchFn });
  assert.equal((await discovery.refresh()).claimed, true);
});

test('a failing catalog keeps its last list, backs off, and the Worker serves recommendations without installing anything', async (t) => {
  const DB = new TestD1();
  t.after(() => DB.close());
  const store = new D1TaskStore(DB);
  const { fetchFn, counts } = catalogFetch({ failTree: true });
  const discovery = new PluginDiscovery(store, { fetchFn });
  await discovery.refresh();
  await discovery.refresh();
  const result = await discovery.read(new Set());
  assert.deepEqual(result.sources.map((source) => source.status), ['unavailable', 'unavailable']);
  assert.ok(result.sources.every((source) => source.lastError === 'http_error'));
  await discovery.refresh();
  assert.equal(counts.tree, 2, 'a failure waits before trying again');
  const { call } = cloud(t, (target) => (target.hostname === 'api.github.com' && (target.pathname.endsWith('/commits/HEAD') || target.pathname.includes('/git/trees/')) ? new Response('no', { status: 503 }) : null));
  const served = await call('/api/plugin-recommendations');
  assert.equal(served.status, 200);
  assert.deepEqual(served.body.candidates, []);
  assert.deepEqual((await call('/api/plugins')).body.plugins, [], 'nothing was installed');
});
