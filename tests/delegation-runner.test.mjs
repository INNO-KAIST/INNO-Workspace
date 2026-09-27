import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCodexRunner} from '../server/runners.mjs';
import {prepareReviewInputs} from '../server/handoff-inputs.mjs';
import {CLAUDE_ROUTING_POLICY, claudeTaskRoutingPolicy} from '../public/core/claude-routing.mjs';

const catalog = [
  {model: 'gpt-6-astra', efforts: ['high'], isDefault: true},
  {model: 'gpt-5.6-terra', efforts: ['medium', 'high']},
];

const assignment = (provider = 'codex') => ({
  role: provider === 'codex' ? 'implementation' : 'independent review',
  provider,
  requestedModel: provider === 'codex' ? 'gpt-5.6-terra' : 'sonnet',
  effort: 'high',
  sufficientReason: 'The work is bounded and independently checkable.',
  acceptanceCriteria: ['The result cites its checks.', 'The requested output is complete.'],
  instructions: 'Produce one self-contained result for the assigned role.',
});

const childTask = (overrides = {}) => ({
  id: 'child-codex', title: 'Implementation', prompt: 'Implement the bounded part.', type: 'general', plan: [],
  parentTaskId: 'parent', batchId: 'batch', parentEpoch: 1, assignment: assignment('codex'),
  ...overrides,
});

function spawnReturning(value, capture = {}) {
  return (_command, args) => {
    capture.args = args;
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => true;
    child.stdin.on('data', chunk => { capture.input = (capture.input ?? '') + chunk; });
    child.stdin.on('finish', () => {
      child.stdout.write(`${JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify(value)}})}\n`);
      child.stdout.end(); child.emit('close', 0, null);
    });
    return child;
  };
}

test('Codex child uses the assigned catalog model and effort and disables native subagents', async () => {
  const capture = {};
  const runner = createCodexRunner({
    spawnProcess: spawnReturning({summary: 'bounded result'}, capture),
    ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => catalog,
  });
  const result = await runner.run({task: childTask()});
  assert.equal(capture.args[capture.args.indexOf('-m') + 1], 'gpt-5.6-terra');
  assert.ok(capture.args.includes('model_reasoning_effort="high"'));
  assert.deepEqual(capture.args.slice(capture.args.indexOf('--disable'), capture.args.indexOf('--disable') + 2), ['--disable', 'multi_agent']);
  assert.equal(capture.args.includes('--enable'), false);
  assert.match(capture.input, /Produce one self-contained result/);
  assert.match(capture.input, /The result cites its checks/);
  assert.equal(result.content, 'bounded result');
});

test('Codex child rejects unavailable model or effort before spawning', async () => {
  let spawns = 0;
  const runner = createCodexRunner({spawnProcess: () => { spawns++; }, modelCatalog: async () => catalog});
  await assert.rejects(() => runner.run({task: childTask({assignment: {...assignment('codex'), requestedModel: 'gpt-missing'}})}), /assigned Codex model.*catalog/i);
  await assert.rejects(() => runner.run({task: childTask({assignment: {...assignment('codex'), effort: 'ultra'}})}), /assigned Codex effort.*catalog/i);
  assert.equal(spawns, 0);
});

test('Codex runner exposes the sanitized account model catalog', async () => {
  const runner = createCodexRunner({modelCatalog: async () => [{model: 'gpt-5.6-terra', supportedReasoningEfforts: [{reasoningEffort: 'high'}], description: 'omit'}, {model: 'bad model', efforts: ['high']}]});
  assert.deepEqual(await runner.models(), [{model: 'gpt-5.6-terra', efforts: ['high'], isDefault: false}]);
});

test('managed root preserves a valid two-provider delegation while ordinary delivery does not', async () => {
  const delegation = {independent: true, children: [assignment('codex'), assignment('claude')]};
  const task = {id: 'parent', title: 'Compare', prompt: 'Compare independent approaches.', type: 'analysis', plan: []};
  const managed = createCodexRunner({spawnProcess: spawnReturning({summary: 'allocated', delegation}), ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => catalog, managedDelivery: true});
  assert.deepEqual((await managed.run({task})).delegation, delegation);
  const ordinary = createCodexRunner({spawnProcess: spawnReturning({summary: 'answer', delegation}), ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => catalog});
  assert.equal((await ordinary.run({task})).delegation, undefined);
});

test('managed root rejects malformed or unavailable delegation assignments', async () => {
  const task = {id: 'parent', title: 'Compare', prompt: 'Compare independent approaches.', type: 'analysis', plan: []};
  for (const delegation of [
    {independent: true, children: [assignment('codex')]},
    {independent: true, children: [{...assignment('codex'), requestedModel: 'gpt-missing'}, assignment('claude')]},
    {independent: true, children: [assignment('codex'), {...assignment('claude'), requestedModel: 'invented'}]},
  ]) {
    const runner = createCodexRunner({spawnProcess: spawnReturning({summary: 'allocated', delegation}), ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => catalog, managedDelivery: true});
    await assert.rejects(() => runner.run({task}), /delegation|catalog|Claude role model/i);
  }
});

test('managed root rejects delegation when source materials would have to be copied', async () => {
  const delegation = {independent: true, children: [assignment('codex'), assignment('claude')]};
  const runner = createCodexRunner({spawnProcess: spawnReturning({summary: 'allocated', delegation}), ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => catalog, managedDelivery: true});
  await assert.rejects(() => runner.run({task: {id: 'parent', prompt: 'Use the source.', attachments: [{id: 'source'}]}}), /source|attachment/i);
});

test('child and review executions reject recursive delegation and provider handoff', async () => {
  const reviewChildren=[{taskId:'child-a',...assignment('codex')}];
  for (const [task,reviewInputs] of [[childTask(),[]], [{id: 'parent', prompt: 'Integrate', delegation: {state: 'reviewing', children: reviewChildren}},[{taskId:'child-a',role:'implementation',summary:'done',artifacts:[]}]]]) {
    for (const forbidden of [{delegation: {independent: true, children: []}}, {handoff: {provider: 'claude'}}]) {
      const runner = createCodexRunner({spawnProcess: spawnReturning({summary: 'result', ...forbidden}), ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => catalog, managedDelivery: true});
      await assert.rejects(() => runner.run({task,reviewInputs}), /cannot return.*delegation|cannot return.*handoff|recursive/i);
    }
  }
});

test('review inputs become isolated per-child files and exact review report is preserved', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'inno-review-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const children = [
    {taskId: 'child-a', ...assignment('codex')},
    {taskId: 'child-b', ...assignment('claude')},
  ];
  const reviewInputs = [
    {taskId: 'child-a', role: 'implementation', summary: 'Implementation completed.', artifacts: [{id: 'a1', name: '../../report.md', mime: 'text/markdown', encoding: 'utf-8', content: '# child A evidence'}]},
    {taskId: 'child-b', role: 'independent review', summary: 'Review completed.', artifacts: [{artifactId: 'b1', name: 'notes.txt', mime: 'text/plain', encoding: 'base64', content: Buffer.from('child B evidence').toString('base64')}]},
  ];
  const reviewReport = children.map(child => ({
    childTaskId: child.taskId,
    criteria: child.acceptanceCriteria.map(criterion => ({criterion, status: 'pass', evidence: `Verified for ${child.taskId}`})),
  }));
  const capture = {};
  const runner = createCodexRunner({spawnProcess: spawnReturning({summary: 'integrated', reviewReport}, capture), runDirectory: () => directory, ensureDirectory: () => {}, modelCatalog: async () => catalog, managedDelivery: true});
  const result = await runner.run({task: {id: 'parent', title: 'Review', prompt: 'Integrate.', type: 'analysis', plan: [], delegation: {state: 'reviewing', children}}, reviewInputs});
  assert.deepEqual(result.reviewReport, reviewReport);
  assert.match(capture.input, /inno-review-001-child-a-001\.md/);
  assert.match(capture.input, /inno-review-002-child-b-001\.txt/);
  assert.doesNotMatch(capture.input, /# child A evidence|child B evidence/);
  assert.equal(await readFile(path.join(directory, 'inno-review-001-child-a-001.md'), 'utf8'), '# child A evidence');
  assert.equal(await readFile(path.join(directory, 'inno-review-002-child-b-001.txt'), 'utf8'), 'child B evidence');
});

test('review phase requires every exact assigned criterion', async () => {
  const children = [{taskId: 'child-a', ...assignment('codex')}];
  const reviewInputs = [{taskId: 'child-a', role: 'implementation', summary: 'done', artifacts: []}];
  for (const reviewReport of [undefined, [{childTaskId: 'child-a', criteria: [{criterion: 'different', status: 'pass', evidence: 'guess'}]}]]) {
    const runner = createCodexRunner({spawnProcess: spawnReturning({summary: 'integrated', ...(reviewReport ? {reviewReport} : {})}), ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => catalog, managedDelivery: true});
    await assert.rejects(() => runner.run({task: {id: 'parent', prompt: 'Integrate.', delegation: {state: 'reviewing', children}}, reviewInputs}), /review report|criterion/i);
  }
});

test('review input role must match the durable child assignment', async () => {
  const children = [{taskId: 'child-a', ...assignment('codex')}];
  const reviewReport = [{childTaskId: 'child-a', criteria: children[0].acceptanceCriteria.map(criterion => ({criterion, status: 'pass', evidence: 'checked'}))}];
  const runner = createCodexRunner({spawnProcess: spawnReturning({summary: 'integrated', reviewReport}), ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => catalog, managedDelivery: true});
  await assert.rejects(() => runner.run({task: {id: 'parent', prompt: 'Integrate.', delegation: {state: 'reviewing', children}}, reviewInputs: [{taskId: 'child-a', role: 'wrong role', summary: 'done', artifacts: []}]}), /role|match/i);
});

test('review input preparation rejects missing content, invalid base64, and oversized totals', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'inno-review-invalid-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const wrap = artifact => [{taskId: 'child', role: 'reviewer', summary: 'done', artifacts: [artifact]}];
  await assert.rejects(() => prepareReviewInputs(wrap({name: 'missing.txt', mime: 'text/plain'}), directory), /missing/i);
  await assert.rejects(() => prepareReviewInputs(wrap({name: 'bad.bin', mime: 'application/octet-stream', encoding: 'base64', content: '%%%'}), directory), /base64/i);
  await assert.rejects(() => prepareReviewInputs(wrap({name: 'large.txt', mime: 'text/plain', encoding: 'utf-8', content: 'x'.repeat(5_000_001)}), directory), /5 MB|limit|large/i);
});

test('Claude task routing fixes one native child role and keeps ordinary root routing unchanged', () => {
  assert.equal(claudeTaskRoutingPolicy({id: 'root'}), CLAUDE_ROUTING_POLICY);
  const policy = claudeTaskRoutingPolicy(childTask({id: 'claude-child', assignment: assignment('claude')}));
  assert.match(policy, /exactly one.*sonnet/is);
  assert.match(policy, /create additional roles/i);
  assert.match(policy, /wrapper|observedModel/is);
  assert.throws(() => claudeTaskRoutingPolicy(childTask({assignment: {...assignment('claude'), requestedModel: 'invented'}})), /Claude role model/i);
});

test('Claude review routing forbids recursive roles and requires exact assigned criteria', () => {
  const policy = claudeTaskRoutingPolicy({id: 'parent', delegation: {state: 'reviewing', children: [{taskId: 'child', ...assignment('claude')}]}});
  assert.match(policy, /review phase/i);
  assert.match(policy, /exact assigned acceptance criteria/i);
  assert.match(policy, /do not spawn|must not.*handoff/i);
});
