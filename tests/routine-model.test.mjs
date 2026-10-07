import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.mjs';
import { routineModelRecommendation } from '../public/core/routine-model.mjs';
import { routineModelView } from '../public/provider-management-ui.mjs';
import { createDesktopServer } from '../server/desktop-http.mjs';
import { TestD1 } from './helpers/d1.mjs';

// PRV-05: the Claude Routine's master model is kept current on evidence. INNO cannot change the
// Routine, so it compares the recorded Routine model with the official model documentation and
// recent Claude runs, recommends keeping it or a newer model of the same family (other families
// are listed, not recommended), and records a person's change request. A Claude Code session
// confirms with the person, changes the Routine and records the model it applied.
const NOW = Date.parse('2026-10-07T03:00:00Z');
const official = (candidates, { status = 'fresh', verifiedAt = NOW - 3600_000 } = {}) => ({
  sources: [{ provider: 'claude', status, verifiedAt }],
  candidates: candidates.map(([id, documentedTarget]) => ({ provider: 'claude', id, kind: 'alias', documentedTarget })),
});
const record = { model: 'claude-opus-5-5', label: 'Opus 5.5', source: 'claude_code_session', recordedAt: NOW - 86_400_000 };
const claudeTask = (status, completedAt, failure) => ({ status, checkpoint: { provider: 'claude', completedAt: new Date(completedAt).toISOString(), ...(failure ? { failure: { kind: failure, occurredAt: new Date(completedAt).toISOString() } } : {}) } });

test('with no recorded Routine model there is nothing to compare', () => {
  const result = routineModelRecommendation({ record: null, discovery: official([['opus', 'Opus 5.5']]), tasks: [], now: NOW });
  assert.equal(result.status, 'unknown');
  assert.match(result.reasons.join(' '), /기록이 없습니다/);
});

test('the current model is kept when it is the documented target of its family', () => {
  const result = routineModelRecommendation({ record, discovery: official([['opus', 'Opus 5.5'], ['sonnet', 'Sonnet 5.5'], ['fable', null]]), tasks: [claudeTask('completed', NOW - 3600_000)], now: NOW });
  assert.equal(result.status, 'keep');
  assert.match(result.reasons.join(' '), /Opus 5\.5/);
  assert.deepEqual(result.options.map((option) => [option.alias, option.recommended]), [['sonnet', false], ['fable', false]]);
  assert.match(result.options[0].note, /추천하지 않습니다/);
  assert.deepEqual(result.runs, { completed: 1, failed: 0, since: NOW - 30 * 86_400_000 });
});

test('a newer documented model of the same family is recommended, with what is and is not known', () => {
  const result = routineModelRecommendation({ record, discovery: official([['opus', 'Opus 5.6'], ['sonnet', 'Sonnet 5.5']]), tasks: [], now: NOW });
  assert.equal(result.status, 'candidate');
  const [newer] = result.options;
  assert.deepEqual([newer.alias, newer.target, newer.model, newer.recommended], ['opus', 'Opus 5.6', 'claude-opus-5-6', true]);
  assert.match(newer.note, /계정에서 쓸 수 있는지는 교체 뒤 첫 실행/);
});

test('stale official documentation and failing runs are reported, but never turn into a model change', () => {
  const stale = routineModelRecommendation({ record, discovery: official([['opus', 'Opus 5.6']], { status: 'stale' }), tasks: [], now: NOW });
  assert.equal(stale.status, 'keep');
  assert.match(stale.reasons.join(' '), /공식 문서 확인이 오래되었거나 실패/);
  const failing = routineModelRecommendation({ record, discovery: official([['opus', 'Opus 5.5']]), tasks: [1, 2, 3].map((index) => claudeTask('failed', NOW - index * 3600_000, 'authentication')), now: NOW });
  assert.equal(failing.status, 'keep');
  assert.equal(failing.runs.failed, 3);
  assert.match(failing.reasons.join(' '), /모델보다 연결·한도/);
});

test('the screen text shows the current model, the recommendation and a pending request', () => {
  const recommendation = routineModelRecommendation({ record, discovery: official([['opus', 'Opus 5.6'], ['fable', null]]), tasks: [], now: NOW });
  const view = routineModelView({ record, recommendation, request: null });
  assert.match(view.current, /Opus 5\.5/);
  assert.match(view.status, /교체 후보/);
  assert.deepEqual(view.options.map((option) => option.label), ['Opus 5.6 (opus) · 추천', 'fable']);
  const pending = routineModelView({ record, recommendation, request: { id: 'r1', alias: 'opus', target: 'Opus 5.6', status: 'pending', requestedAt: NOW } });
  assert.match(pending.request, /Opus 5\.6.*Claude Code 세션/);
});

const token = 'test-routine-model-0123456789012345';
function api(db) {
  const env = { DB: db, ACCESS_TOKEN: token };
  return async (path, body) => {
    const response = await worker.fetch(new Request(`https://inno.test${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: response.status, body: await response.json() };
  };
}
async function seedOfficial(db, candidates) {
  const value = { candidates: candidates.map(([id, documentedTarget]) => ({ id, documentedTarget, kind: 'alias' })), verifiedAt: Date.now(), nextAttemptAt: Date.now() + 86_400_000, consecutiveFailures: 0, lastError: null, etag: '', lastModified: '' };
  await db.prepare("INSERT INTO metadata (key,value) VALUES ('official_model_discovery_claude',?1)").bind(JSON.stringify(value)).run();
}

test('the Worker records the Routine model, takes a change request for an official alias, and marks it applied', async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  const call = api(db);
  await seedOfficial(db, [['opus', 'Opus 5.6'], ['fable', null]]);
  assert.equal((await call('/api/routine-model')).body.recommendation.status, 'unknown');
  assert.equal((await call('/api/routine-model/record', { model: 'not a model' })).status, 400);
  const recorded = await call('/api/routine-model/record', { model: 'claude-opus-5-5', label: 'Opus 5.5' });
  assert.equal(recorded.status, 200);
  const before = (await call('/api/routine-model')).body;
  assert.equal(before.record.model, 'claude-opus-5-5');
  assert.equal(before.recommendation.status, 'candidate');
  assert.equal((await call('/api/routine-model/request', { alias: 'gpt-9' })).status, 400, 'only an official Claude alias can be requested');
  const requested = await call('/api/routine-model/request', { alias: 'opus' });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.request.status, 'pending');
  assert.equal(requested.body.request.target, 'Opus 5.6');
  const applied = await call('/api/routine-model/record', { model: 'claude-opus-5-6', label: 'Opus 5.6', appliedRequestId: requested.body.request.id });
  assert.equal(applied.body.request.status, 'applied');
  const after = (await call('/api/routine-model')).body;
  assert.equal(after.record.model, 'claude-opus-5-6');
  assert.equal(after.recommendation.status, 'keep');
  const again = await call('/api/routine-model/request', { alias: 'fable' });
  assert.equal((await call('/api/routine-model/request/withdraw', {})).body.request.status, 'withdrawn');
  assert.equal(again.body.request.status, 'pending');
});

test('the desktop page reads the recommendation and sends requests, but cannot record a Routine model', async (t) => {
  const forwarded = [];
  const server = createDesktopServer({ token, publicDir: new URL('../public', import.meta.url), request: async (path, body) => { forwarded.push({ path, body }); return { ok: true }; }, bridge: { status: () => ({ busy: false }) } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/routine-model`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/api/routine-model/request`, { method: 'POST', headers, body: JSON.stringify({ alias: 'opus' }) })).status, 200);
  assert.equal((await fetch(`${base}/api/routine-model/request/withdraw`, { method: 'POST', headers, body: '{}' })).status, 200);
  assert.notEqual((await fetch(`${base}/api/routine-model/record`, { method: 'POST', headers, body: JSON.stringify({ model: 'claude-opus-5-6' }) })).status, 200);
  assert.deepEqual(forwarded.map((entry) => entry.path), ['/api/routine-model', '/api/routine-model/request', '/api/routine-model/request/withdraw']);
});

test('review: comparisons say only what the documents support, and one candidate per family is recommended', () => {
  const older = routineModelRecommendation({ record: { ...record, model: 'claude-opus-5-6', label: 'Opus 5.6' }, discovery: official([['opus', 'Opus 5.5']]), tasks: [], now: NOW });
  assert.equal(older.status, 'keep');
  assert.doesNotMatch(older.reasons.join(' '), /같습니다/);
  assert.match(older.reasons.join(' '), /더 새 판/);
  const vague = routineModelRecommendation({ record, discovery: official([['opus', 'Opus 5']]), tasks: [], now: NOW });
  assert.equal(vague.status, 'keep');
  assert.match(vague.reasons.join(' '), /비교할 수 없습니다/);
  const newerMajor = routineModelRecommendation({ record, discovery: official([['opus', 'Opus 6']]), tasks: [], now: NOW });
  assert.equal(newerMajor.status, 'candidate');
  const twice = routineModelRecommendation({ record, discovery: official([['opus', 'Opus 5.6'], ['opus', 'Opus 5.7']]), tasks: [], now: NOW });
  assert.deepEqual(twice.options.filter((option) => option.recommended).map((option) => option.target), ['Opus 5.7']);
  const unreadable = routineModelRecommendation({ record: { ...record, model: 'claude-opus', label: 'Opus 5.5' }, discovery: official([['opus', 'Opus 5.6']]), tasks: [], now: NOW });
  assert.equal(unreadable.status, 'unknown', 'the family is never taken from the label');
});

test('review: a record must match the request it applies, and requests, withdrawals and records do not overwrite each other', async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  const call = api(db);
  await seedOfficial(db, [['opus', 'Opus 5.6'], ['sonnet', 'Sonnet 5.5']]);
  assert.equal((await call('/api/routine-model/record', { model: 'claude-opus' })).status, 400, 'a model ID that cannot be read is refused');
  await call('/api/routine-model/record', { model: 'claude-opus-5-5' });
  const first = await call('/api/routine-model/request', { alias: 'opus' });
  assert.equal((await call('/api/routine-model/request', { alias: 'sonnet' })).status, 409, 'one pending request at a time');
  const wrong = await call('/api/routine-model/record', { model: 'claude-sonnet-5-5', appliedRequestId: first.body.request.id });
  assert.equal(wrong.status, 409, 'the applied model must be the requested one');
  assert.equal((await call('/api/routine-model')).body.request.status, 'pending');
  assert.equal((await call('/api/routine-model')).body.record.model, 'claude-opus-5-5', 'nothing was written');
  const applied = await call('/api/routine-model/record', { model: 'claude-opus-5-6-20261101', appliedRequestId: first.body.request.id });
  assert.equal(applied.body.request.status, 'applied');
  const late = await call('/api/routine-model/request/withdraw', { id: first.body.request.id });
  assert.equal(late.body.request.status, 'applied', 'a request already applied cannot be withdrawn');
  await db.prepare("UPDATE metadata SET value=json_set(value,'$.verifiedAt',0) WHERE key='official_model_discovery_claude'").run();
  assert.equal((await call('/api/routine-model/request', { alias: 'sonnet' })).status, 409, 'no requests while the official documents are stale');
  await db.prepare("UPDATE metadata SET value='{broken' WHERE key='routine_model_request'").run();
  await db.prepare("UPDATE metadata SET value=json_set(value,'$.verifiedAt',"+Date.now()+") WHERE key='official_model_discovery_claude'").run();
  assert.equal((await call('/api/routine-model/request', { alias: 'sonnet' })).status, 200, 'a corrupt stored request never blocks a new one');
});
