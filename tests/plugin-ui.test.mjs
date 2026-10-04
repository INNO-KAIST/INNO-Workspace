import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {createWorker} from '../worker/index.mjs';
import {WorkspaceClient} from '../public/core/client.mjs';
import {
  pluginSourceLink, pluginStatusText, pluginFindingRows, canApprovePlugin, pluginDeliveryText,
  pluginImportInput, pluginSelectionInput,
} from '../public/plugin-ui.mjs';
import {TestD1} from './helpers/d1.mjs';
import {PLUGIN_RULE_NAMES, PLUGIN_SKIP_REASONS} from '../public/core/plugins.mjs';

// CR-007 S3 P4: plugin management and per-task selection on the screen.
const COMMIT = 'a'.repeat(40), HASH = 'b'.repeat(64);
const plugin = (overrides = {}) => ({
  id: 'anthropics/brand-guidelines', name: 'brand-guidelines', description: 'Apply brand guidelines.',
  source: {catalog: 'anthropics', repository: 'anthropics/skills', path: 'skills/brand-guidelines', commit: COMMIT}, contentHash: HASH,
  review: {scannedAt: '2026-10-03T00:00:00.000Z', rulesVersion: 1, findings: [], omittedFindings: 0, blocked: false},
  status: 'review', approval: null, disabledReason: null, ...overrides,
});

test('the desktop forwards only authenticated plugin routes to the cloud', async t => {
  const token = 'local-test-token-0123456789012345', calls = [];
  const server = createDesktopServer({token, publicDir: new URL('../public', import.meta.url), request: async (p, b) => { calls.push({p, b}); return {plugins: []}; }, bridge: {status: () => ({})}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port, auth = {authorization: 'Bearer ' + token};
  const post = (path, body, headers = auth) => fetch(base + path, {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  assert.equal((await fetch(base + '/api/plugins')).status, 401);
  assert.equal((await fetch(base + '/api/plugins', {headers: auth})).status, 200);
  assert.deepEqual(calls.at(-1), {p: '/api/plugins', b: undefined});
  for (const route of ['import', 'approve', 'disable', 'remove']) {
    assert.equal((await post('/api/plugins/' + route, {id: 'x'})).status, 200, route);
    assert.deepEqual(calls.at(-1), {p: '/api/plugins/' + route, b: {id: 'x'}});
  }
  assert.equal((await post('/api/tasks/t1/plugins', {expectedVersion: 2, plugins: []})).status, 200);
  assert.deepEqual(calls.at(-1), {p: '/api/tasks/t1/plugins', b: {expectedVersion: 2, plugins: []}});
  const count = calls.length;
  assert.equal((await post('/api/plugins/install', {})).status, 404);
  assert.equal((await post('/api/plugins/import', {}, {})).status, 401);
  assert.equal(calls.length, count, 'nothing else reaches the cloud');
});

test('the cloud workspace advertises the plugin registry', async t => {
  const DB = new TestD1(); t.after(() => DB.close());
  const token = 'plugin-ui-token-0123456789abcdef';
  const response = await createWorker().fetch(new Request('https://inno.test/api/state', {headers: {authorization: 'Bearer ' + token}}), {DB, ACCESS_TOKEN: token});
  assert.equal((await response.json()).capabilities.pluginRegistry, true);
});

test('the client calls the plugin routes', async t => {
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { calls.push([String(url).replace('https://inno.test', ''), init.method, init.body ? JSON.parse(init.body) : undefined]); return Response.json({ok: true}); };
  t.after(() => { globalThis.fetch = original; });
  const client = new WorkspaceClient({baseUrl: 'https://inno.test', token: 'token', remote: true});
  await assert.rejects(() => new WorkspaceClient().listPlugins(), /서버 연결/);
  await client.listPlugins();
  await client.importPlugin({catalog: 'anthropics', path: 'skills/x', commit: COMMIT});
  await client.approvePlugin('anthropics/x', HASH);
  await client.disablePlugin('anthropics/x');
  await client.removePlugin('anthropics/x');
  await client.selectTaskPlugins('t1', 4, [{id: 'anthropics/x', reason: 'r'}]);
  assert.deepEqual(calls, [
    ['/api/plugins', 'GET', undefined],
    ['/api/plugins/import', 'POST', {catalog: 'anthropics', path: 'skills/x', commit: COMMIT}],
    ['/api/plugins/approve', 'POST', {id: 'anthropics/x', contentHash: HASH}],
    ['/api/plugins/disable', 'POST', {id: 'anthropics/x'}],
    ['/api/plugins/remove', 'POST', {id: 'anthropics/x', confirm: true}],
    ['/api/tasks/t1/plugins', 'POST', {expectedVersion: 4, plugins: [{id: 'anthropics/x', reason: 'r'}]}],
  ]);
});

test('plugin cards show status, pinned source and review findings', () => {
  assert.equal(pluginSourceLink(plugin()), `https://github.com/anthropics/skills/tree/${COMMIT}/skills/brand-guidelines`);
  assert.equal(pluginStatusText(plugin()), '검토 대기');
  assert.equal(pluginStatusText(plugin({status: 'approved'})), '승인됨');
  assert.equal(pluginStatusText(plugin({status: 'disabled', disabledReason: 'user'})), '사용 중지');
  assert.equal(pluginStatusText(plugin({status: 'disabled', disabledReason: 'hash_mismatch'})), '사용 중지 · 저장 내용 불일치');
  const findings = [{path: 'SKILL.md', rule: 'external_url', line: 4, severity: 'warn', excerpt: 'See https://x'}, {path: 'notes.md', rule: 'ai_detection_evasion', line: 2, severity: 'block', excerpt: 'bypass GPTZero'}];
  assert.deepEqual(pluginFindingRows(plugin({review: {...plugin().review, findings, omittedFindings: 3, blocked: true}})), [
    {level: '경고', rule: '외부 링크', where: 'SKILL.md 4행', excerpt: 'See https://x'},
    {level: '차단', rule: 'AI 작성 탐지 회피', where: 'notes.md 2행', excerpt: 'bypass GPTZero'},
    {level: '생략', rule: '추가 검토 결과 3건', where: '', excerpt: ''},
  ]);
  assert.equal(canApprovePlugin(plugin()), true);
  assert.equal(canApprovePlugin(plugin({review: {...plugin().review, blocked: true}})), false);
  assert.equal(canApprovePlugin(plugin({status: 'approved'})), false);
});

test('every review rule and skip reason has a Korean label, and hostile records get no link', () => {
  for (const rule of PLUGIN_RULE_NAMES) {
    const [row] = pluginFindingRows(plugin({review: {...plugin().review, findings: [{path: 'SKILL.md', rule, line: 1, severity: 'warn', excerpt: 'x'}]}}));
    assert.notEqual(row.rule, rule, `${rule} needs a label`);
  }
  for (const reason of PLUGIN_SKIP_REASONS) assert.doesNotMatch(pluginDeliveryText({version: 1, applied: [], skipped: [{id: 'anthropics/x', reason}]}), new RegExp(`\\(${reason}\\)`), reason);
  assert.equal(pluginFindingRows(plugin({review: {...plugin().review, findings: [{path: 'SKILL.md', rule: 'constructor', line: 1, severity: 'warn', excerpt: 'x'}]}}))[0].rule, 'constructor');
  for (const source of [{...plugin().source, path: 'skills/x?next=/login'}, {...plugin().source, catalog: 'evil'}, {...plugin().source, commit: 'main'}])
    assert.equal(pluginSourceLink(plugin({source})), null, JSON.stringify(source));
  assert.equal(pluginDeliveryText({version: 1, applied: 'x'}), '');
});

test('execution records describe plugin delivery without claiming more', () => {
  assert.equal(pluginDeliveryText(undefined), '');
  assert.equal(pluginDeliveryText({version: 1, applied: [{id: 'anthropics/brand-guidelines', contentHash: HASH, reason: 'r'}], skipped: []}), '플러그인 전달: anthropics/brand-guidelines');
  assert.equal(pluginDeliveryText({version: 1, applied: [], skipped: [{id: 'anthropics/x', reason: 'not_approved'}, {id: 'openai/y', reason: 'hash_mismatch'}]}),
    '플러그인 전달 없음 · 제외: anthropics/x(승인 해제), openai/y(내용 불일치)');
});

test('import and selection forms are validated before any request', () => {
  assert.deepEqual(pluginImportInput({catalog: 'openai', name: ' doc-review ', commit: COMMIT}), {catalog: 'openai', path: 'skills/.curated/doc-review', commit: COMMIT});
  assert.deepEqual(pluginImportInput({catalog: 'anthropics', name: 'brand', commit: COMMIT}), {catalog: 'anthropics', path: 'skills/brand', commit: COMMIT});
  for (const bad of [{catalog: 'anthropics', name: 'brand', commit: 'main'}, {catalog: 'anthropics', name: '../x', commit: COMMIT}, {catalog: 'other', name: 'brand', commit: COMMIT}])
    assert.throws(() => pluginImportInput(bad), /플러그인/);
  assert.deepEqual(pluginSelectionInput([{id: 'anthropics/a', checked: true, reason: ' 브랜드 규칙 '}, {id: 'anthropics/b', checked: false, reason: ''}]), [{id: 'anthropics/a', reason: '브랜드 규칙'}]);
  assert.throws(() => pluginSelectionInput([{id: 'anthropics/a', checked: true, reason: ' '}]), /이유/);
  assert.throws(() => pluginSelectionInput(['a', 'b', 'c', 'd'].map(name => ({id: `anthropics/${name}`, checked: true, reason: 'r'}))), /3개/);
});
