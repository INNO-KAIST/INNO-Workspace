import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdirSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SOURCE_EVIDENCE_LIMITS, boundedSourceEvidence, sourceEvidenceView, traceClaims} from '../public/core/source-evidence.mjs';
import {createCodexRunner, taskPromptWithContext} from '../server/runners.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';

// Differentiation ②: a result made from originals names, for each key claim, the source, a place
// in it and a short quote; the runner on this PC checks each quote against the original text it
// received. Only places, short quotes and the check are kept — never the originals.
const paper = {name: 'paper.txt', text: 'Methods\nWe enrolled 120 participants in   the trial.\nResults\nThe yield rose to 82 percent.'};
const notes = {name: 'notes.md', text: '# Notes\nSample B used 80 mice.'};

test('claims are matched to the sources they name and each quote is checked against the original', () => {
  const traced = traceClaims([
    {text: 'The trial enrolled 120 participants.', sources: [{source: 1, locator: 'Methods', quote: 'We enrolled 120 participants in the trial.'}]},
    {text: 'Sample B used 80 mice.', sources: [{source: 'notes.md', locator: 'line 2', quote: 'Sample B used 80 mice'}]},
    {text: 'The yield was 90 percent.', sources: [{source: 1, locator: 'Results', quote: 'The yield rose to 90 percent.'}]},
    {text: 'The method is new.', sources: []},
    {text: 'Cites a file that was not given.', sources: [{source: 'other.pdf', locator: 'p. 3', quote: 'x'}]},
    {sources: [{source: 1}]},
    'not a claim',
  ], [paper, notes]);
  assert.deepEqual(traced.claims.map(claim => [claim.text, claim.sources.map(source => [source.name, source.found])]), [
    ['The trial enrolled 120 participants.', [['paper.txt', true]]],
    ['Sample B used 80 mice.', [['notes.md', true]]],
    ['The yield was 90 percent.', [['paper.txt', false]]],
    ['The method is new.', []],
    ['Cites a file that was not given.', []],
  ]);
  assert.deepEqual(traceClaims([{text: 'A', sources: [{source: '2', locator: 'l', quote: 'Sample B used 80 mice'}, {source: 0, quote: 'x'}, {source: 3, quote: 'x'}, {source: 1.5, quote: 'x'}]}], [paper, notes]).claims[0].sources.map(source => [source.name, source.found]),
    [['notes.md', true]], 'a number written as text is a number; 0, past the end and fractions are not sources');
  assert.equal(traceClaims(undefined, [paper]), null, 'no claims, no record');
  assert.equal(traceClaims([], [paper]), null, 'an empty list is no record');
  assert.equal(traceClaims([{sources: []}, 'x'], [paper]), null, 'only invalid claims is no record');
  // Model output never throws here: values that are not text become empty text.
  const odd = traceClaims([{text: 'x', sources: [{source: 1, locator: [{toString: 1}], quote: {toString: 1}}]}], [paper]);
  assert.deepEqual(odd.claims[0].sources[0], {name: 'paper.txt', locator: '', quote: '', found: false});
  // Two originals with one name: the first is the one checked.
  assert.equal(traceClaims([{text: 'x', sources: [{source: 'paper.txt', quote: 'We enrolled 120 participants'}]}], [paper, {name: 'paper.txt', text: 'other text'}]).claims[0].sources[0].found, true);
  assert.equal(traceClaims([{text: 'x', sources: []}], [{name: 'img.png', image: {mime: 'image/png'}}]), null, 'image-only sources are not traced');
  const many = traceClaims(Array.from({length: 40}, (_, i) => ({text: `claim ${i}`, sources: [{source: 1, locator: 'Methods', quote: 'We enrolled'}]})), [paper]);
  assert.equal(many.claims.length, SOURCE_EVIDENCE_LIMITS.claims);
  const long = traceClaims(Array.from({length: 40}, (_, i) => ({text: `${'가'.repeat(600)}${i}`, sources: Array.from({length: 8}, () => ({source: 1, locator: '나'.repeat(300), quote: '다'.repeat(400)}))})), [paper]);
  assert.ok(long.claims.length > 0 && long.claims.every(claim => Array.from(claim.text).length <= SOURCE_EVIDENCE_LIMITS.text && claim.sources.length <= SOURCE_EVIDENCE_LIMITS.sources
    && claim.sources.every(source => Array.from(source.locator).length <= SOURCE_EVIDENCE_LIMITS.locator && Array.from(source.quote).length <= SOURCE_EVIDENCE_LIMITS.quote)));
  assert.ok(Buffer.byteLength(JSON.stringify(long)) <= SOURCE_EVIDENCE_LIMITS.bytes, 'the whole record stays small; later claims are left out');
});

test('the cloud keeps a source record only in shape and only for the task\'s own sources', () => {
  const evidence = traceClaims([{text: 'The trial enrolled 120 participants.', sources: [{source: 1, locator: 'Methods', quote: 'We enrolled 120 participants'}]}], [paper]);
  const task = {attachments: [{name: 'paper.txt', path: 'paper.txt', source: 'file'}]};
  assert.deepEqual(boundedSourceEvidence(evidence, task), evidence);
  assert.equal(boundedSourceEvidence({...evidence, claims: [{...evidence.claims[0], sources: [{...evidence.claims[0].sources[0], name: 'secret.txt'}]}]}, task), null, 'a name outside the task\'s sources');
  assert.equal(boundedSourceEvidence({version: 2, claims: []}, task), null);
  assert.equal(boundedSourceEvidence({...evidence, claims: [{...evidence.claims[0], text: 'x'.repeat(SOURCE_EVIDENCE_LIMITS.text + 1)}]}, task), null);
  assert.equal(boundedSourceEvidence({...evidence, extra: 1}, task), null);
  assert.equal(boundedSourceEvidence({version: 1, claims: []}, task), null, 'an empty record is not kept');
  const deep = 'folder/'.repeat(200) + 'paper.txt';
  const nested = {version: 1, claims: [{text: 'x', sources: [{name: deep, locator: '', quote: 'We enrolled', found: true}]}]};
  assert.deepEqual(boundedSourceEvidence(nested, {attachments: [{name: 'paper.txt', path: deep, source: 'file'}]}), nested, 'a long folder path (up to 2,000 characters) is a valid name');
  assert.equal(boundedSourceEvidence(evidence, {attachments: [null, 7, ...task.attachments]})?.version, 1, 'odd attachment entries never throw');
  assert.equal(boundedSourceEvidence({version: 1, claims: [{text: 'x', sources: [{name: {toString: 1}, locator: '', quote: '', found: true}]}]}, task), null);
  const claim = {text: '가'.repeat(SOURCE_EVIDENCE_LIMITS.text), sources: Array.from({length: SOURCE_EVIDENCE_LIMITS.sources}, () => ({name: 'paper.txt', locator: '', quote: '나'.repeat(SOURCE_EVIDENCE_LIMITS.quote), found: false}))};
  assert.equal(boundedSourceEvidence({version: 1, claims: Array(SOURCE_EVIDENCE_LIMITS.claims).fill(claim)}, task), null, 'over the byte limit');
});

test('the page summarises claims: checked in the original, not found, or without a source', () => {
  const view = sourceEvidenceView(traceClaims([
    {text: 'A', sources: [{source: 1, locator: 'Methods', quote: 'We enrolled 120 participants'}]},
    {text: 'B', sources: [{source: 1, locator: 'Results', quote: 'not in the text'}]},
    {text: 'C', sources: []},
  ], [paper]));
  assert.equal(view.summary, '근거 추적: 주장 3개 · 원문 확인 1 · 원문에서 찾지 못함 1 · 근거 없음 1');
  assert.deepEqual(view.claims.map(claim => claim.status), ['found', 'missing', 'unsupported']);
  assert.deepEqual(view.claims.map(claim => claim.label), ['원문 확인', '원문에서 찾지 못함', '근거 없음']);
  assert.match(view.claims[0].sources[0], /paper\.txt · Methods · “We enrolled 120 participants” · 원문 확인됨/);
  assert.equal(sourceEvidenceView(null), null);
  assert.equal(sourceEvidenceView({version: 1, claims: []}), null);
  // A source given without a quote long enough to check is not shown as a failed check.
  const unquoted = sourceEvidenceView(traceClaims([{text: 'D', sources: [{source: 1, locator: 'p. 2', quote: ''}, {source: 1, locator: 'p. 3', quote: 'short'}]}, {text: 'E', sources: []}], [paper]));
  assert.deepEqual(unquoted.claims.map(claim => [claim.status, claim.label]), [['unchecked', '인용 없음'], ['unsupported', '근거 없음']]);
  assert.deepEqual(unquoted.claims[0].sources, ['paper.txt · p. 2 · 인용 없음', 'paper.txt · p. 3 · “short” · 인용이 짧아 확인 안 함']);
  assert.equal(unquoted.summary, '근거 추적: 주장 2개 · 원문 확인 0 · 원문에서 찾지 못함 0 · 근거 없음 1 · 인용 없음 1');
});

test('a Codex run with originals asks for claims and returns the checked record', async t => {
  const dir = await mkdtemp(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.inno/tmp'), 'evidence-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  let prompt = '';
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.pid = 1; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let input = '';
    child.stdin.on('data', chunk => { input += chunk; });
    child.stdin.on('finish', () => {
      prompt = input;
      const answer = {summary: 'The trial enrolled 120 participants.', claims: [{text: 'The trial enrolled 120 participants.', sources: [{source: 1, locator: 'Methods', quote: 'We enrolled 120 participants'}]}]};
      child.stdout.write(JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify(answer)}}) + '\n');
      child.stdout.end(); child.emit('close', 0, null);
    });
    return child;
  };
  const runner = createCodexRunner({spawnProcess, modelCatalog: async () => [], ensureDirectory: folder => mkdirSync(folder, {recursive: true}), runDirectory: ({executionId}) => path.join(dir, executionId)});
  const task = {id: 't1', version: 2, title: 'Paper', type: 'literature', prompt: 'How many participants?', messages: [{role: 'user', content: 'How many participants?'}], attachments: [{id: 'a', name: 'paper.txt', path: 'paper.txt', source: 'file'}], checkpoint: {}};
  const done = await runner.run({task, materials: [paper], executionId: 'e1', generation: 1});
  assert.match(prompt, /claims:\[\{"text"/);
  assert.equal(done.sourceEvidence.claims[0].sources[0].found, true);
  const bare = await runner.run({task: {...task, attachments: []}, materials: [], executionId: 'e2', generation: 1});
  assert.doesNotMatch(prompt, /claims:\[\{"text"/, 'no sources, no request for claims');
  // Evaluation-budget runs keep their fixed prompt.
  const ask = async ownership => (await taskPromptWithContext(task, [paper], {mode: 'root', ...ownership})).text.includes('claims:[{"text"');
  assert.deepEqual([await ask({}), await ask({evaluationBound: true}), await ask({mode: 'child'}), await ask({mode: 'review'}), await ask({claude: true})], [true, false, false, false, false]);
  assert.equal(bare.sourceEvidence, undefined);
});

test('the connector sends a record only for the task\'s own sources, and always sends the result', async () => {
  const evidence = traceClaims([{text: 'The trial enrolled 120 participants.', sources: [{source: 1, locator: 'Methods', quote: 'We enrolled 120 participants'}]}], [paper]);
  const foreign = {...evidence, claims: [{...evidence.claims[0], sources: [{...evidence.claims[0].sources[0], name: 'other.txt'}]}]};
  for (const [sourceEvidence, kept] of [[evidence, true], [foreign, false], [{version: 1, claims: 'x'}, false]]) {
    let value = null, delivered;
    const outbox = {read: () => value, write: next => { value = next; }, clear: () => { value = null; }};
    const task = {id: 't', attachments: [{id: 'a', name: 'paper.txt', path: 'paper.txt', source: 'file'}]};
    const bridge = createDesktopBridge({outbox, request: async (route, input) => { if (route.endsWith('/poll')) return {claim: {task, executionId: 'e', generation: 1}}; delivered = input; }, runner: {run: async () => ({content: 'Done', sourceEvidence})}});
    await bridge.tick();
    assert.equal(delivered.content, 'Done');
    assert.deepEqual(delivered.sourceEvidence, kept ? evidence : undefined);
  }
  // Odd attachment entries in the claim never stop the result.
  {
    let value = null, delivered;
    const outbox = {read: () => value, write: next => { value = next; }, clear: () => { value = null; }};
    const task = {id: 't', attachments: [null, {id: 'a', name: 'paper.txt', path: 'paper.txt', source: 'file'}]};
    const bridge = createDesktopBridge({outbox, request: async (route, input) => { if (route.endsWith('/poll')) return {claim: {task, executionId: 'e', generation: 1}}; delivered = input; }, runner: {run: async () => ({content: 'Done', sourceEvidence: evidence})}});
    await bridge.tick();
    assert.equal(delivered.content, 'Done');
  }
  // A result near the cloud transfer limit is sent without the record rather than not at all.
  let value = null, delivered;
  const outbox = {read: () => value, write: next => { value = next; }, clear: () => { value = null; }};
  const task = {id: 't', attachments: [{id: 'a', name: 'paper.txt', path: 'paper.txt', source: 'file'}]};
  const content = 'x'.repeat(695_000);
  const bridge = createDesktopBridge({outbox, request: async (route, input) => { if (route.endsWith('/poll')) return {claim: {task, executionId: 'e', generation: 1}}; delivered = input; }, runner: {run: async () => ({content, sourceEvidence: evidence})}});
  await bridge.tick();
  assert.equal(delivered.content, content);
  assert.equal(delivered.sourceEvidence, undefined);
});

test('the cloud stores the record from a desktop completion, and drops one naming another file', async t => {
  const db = new TestD1(); t.after(() => db.close());
  const token = 'test-source-evidence-0123456789abcdef', env = {DB: db, ACCESS_TOKEN: token};
  const worker = createWorker({fetchFn: async () => { throw new Error('no network'); }}), store = new D1TaskStore(db);
  const post = async (route, body) => {
    const response = await worker.fetch(new Request('https://inno.test' + route, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(body)}), env);
    return {status: response.status, body: await response.json()};
  };
  const evidence = traceClaims([{text: 'The trial enrolled 120 participants.', sources: [{source: 1, locator: 'Methods', quote: 'We enrolled 120 participants'}]}], [paper]);
  for (const [sourceEvidence, kept] of [[evidence, true], [{...evidence, claims: [{...evidence.claims[0], sources: [{...evidence.claims[0].sources[0], name: 'other.txt'}]}]}, false]]) {
    const task = await store.createTask({prompt: 'How many participants?', attachments: [{id: 'a', name: 'paper.txt', path: 'paper.txt', source: 'file'}]});
    const started = await post(`/api/desktop/${task.id}/start`, {expectedVersion: task.version, sourceNames: ['paper.txt']});
    assert.equal(started.status, 200);
    const {executionId, generation} = started.body.claim;
    assert.equal((await post(`/api/desktop/${task.id}/complete`, {executionId, generation, content: 'The trial enrolled 120 participants.', sourceEvidence})).status, 200);
    const stored = await store.requireTask(task.id);
    assert.equal(stored.status, 'completed', 'the result is always kept');
    assert.deepEqual(stored.checkpoint.sourceEvidence ? stored.checkpoint.sourceEvidence.claims : null, kept ? evidence.claims : null);
    if (kept) assert.equal(stored.checkpoint.sourceEvidence.executionId, executionId);
    if (!kept) continue;
    // The record describes the latest result only: a later result without one clears it, and a
    // completion that is not a desktop one (allowDesktopEvidence unset) never stores one.
    const asked = await store.applyAction(task.id, {action: 'message', expectedVersion: stored.version, content: 'And the yield?'});
    const again = await post(`/api/desktop/${task.id}/start`, {expectedVersion: asked.version, sourceNames: ['paper.txt']});
    assert.equal(again.status, 200);
    assert.equal((await store.requireTask(task.id)).checkpoint.sourceEvidence, undefined, 'a new run clears it (handoff and decisions also start with a claim)');
    await store.finishExecution(task.id, {executionId: again.body.claim.executionId, generation: again.body.claim.generation, content: 'The yield rose.', sourceEvidence});
    assert.equal((await store.requireTask(task.id)).checkpoint.sourceEvidence, undefined);
  }
});
