import test from 'node:test';
import assert from 'node:assert/strict';
import {ValidationError} from '../public/core/tasks.mjs';
import {validateDelegationResult, delegationRoutingPolicy} from '../server/model-routing.mjs';
import {ModelCatalog} from '../worker/model-catalog.mjs';
import {availabilitySnapshot} from '../worker/allocation-policy.mjs';
import {CLAUDE_ROLE_MODELS} from '../public/core/claude-routing.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';

// CR-006 S1 WU4: assignment checks follow each provider's declared model
// catalog (Codex: desktop account catalog, Claude: built-in role models).
const rows = [{model: 'gpt-5.4', efforts: ['high', 'medium'], isDefault: true}];
const child = (provider, requestedModel, effort = 'high') => ({role: provider + ' role', provider, requestedModel, effort, sufficientReason: 'Enough for the bounded work', acceptanceCriteria: ['Evidence is cited'], instructions: 'Do the bounded work.'});
const delegation = (...children) => ({independent: true, children});

test('delegation results validate each child against its provider catalog', () => {
  const valid = validateDelegationResult(delegation(child('codex', 'gpt-5.4'), child('claude', 'sonnet')), rows);
  assert.deepEqual(valid.children.map(c => [c.provider, c.requestedModel]), [['codex', 'gpt-5.4'], ['claude', 'sonnet']]);
  assert.throws(() => validateDelegationResult(delegation(child('codex', 'gpt-5.4'), child('claude', 'mythos')), rows), {message: 'Assigned Claude role model is not supported: mythos'});
  assert.throws(() => validateDelegationResult(delegation(child('codex', 'gpt-9'), child('claude', 'sonnet')), rows), {message: 'Assigned Codex model is not present in the account catalog: gpt-9'});
  assert.throws(() => validateDelegationResult(delegation(child('codex', 'gpt-5.4', 'low'), child('claude', 'sonnet')), rows), {message: 'Assigned Codex effort is not present in the account catalog for gpt-5.4: low'});
  assert.throws(() => validateDelegationResult(delegation(child('codex', 'gpt-5.4'), child('gemini', 'pro')), rows), {message: 'Invalid delegation provider'});
  assert.throws(() => validateDelegationResult(delegation(child('codex', 'gpt-5.4'), {...child('claude', 'sonnet'), provider: undefined}), rows), {message: 'Invalid delegation provider'});
  assert.throws(() => validateDelegationResult(delegation(child('claude', 'opus'), child('claude', 'sonnet')), rows), {message: 'Invalid delegation: one Codex and one Claude child with distinct roles are required'});
  assert.match(delegationRoutingPolicy(rows), /Claude subscription role-model candidates: \["haiku","sonnet","opus"\]/);
});

test('the cloud model catalog keeps its shape and per-provider checks', async t => {
  const DB = new TestD1(); t.after(() => DB.close());
  const store = new D1TaskStore(DB);
  const catalog = new ModelCatalog(store);
  const observedAt = Date.parse(store.now());
  await catalog.report({status: 'fresh', observedAt, models: rows});
  const read = await catalog.read();
  assert.deepEqual(read, {codex: [{model: 'gpt-5.4', efforts: ['high', 'medium'], isDefault: true}], lastGoodCodex: [{model: 'gpt-5.4', efforts: ['high', 'medium'], isDefault: true}], availability: 'fresh', reportedAt: observedAt, claude: ['haiku', 'sonnet', 'opus'], source: 'desktop_account_catalog', observedExecutionModels: false});
  assert.equal(Object.isFrozen(read.claude), false);
  assert.notEqual(read.claude, CLAUDE_ROLE_MODELS);
  await catalog.validate([child('codex', 'gpt-5.4'), child('claude', 'opus')]);
  await assert.rejects(() => catalog.validate([child('claude', 'mythos')]), error => error instanceof ValidationError && error.message === 'Unsupported Claude role model');
  await assert.rejects(() => catalog.validate([child('codex', 'gpt-9')]), error => error instanceof ValidationError && error.message === 'Reconnect desktop to confirm the selected Codex model and effort before delegation');
  await assert.rejects(() => catalog.validate([child('codex', 'gpt-5.4', 'low')]), error => error instanceof ValidationError && error.message === 'Reconnect desktop to confirm the selected Codex model and effort before delegation');
  await catalog.validate([child('gemini', 'anything')]);
  await catalog.validate([{requestedModel: 'anything'}]);
});

test('only account-catalog observations count as verified availability', async t => {
  const DB = new TestD1(); t.after(() => DB.close());
  const store = new D1TaskStore(DB);
  const now = Date.parse(store.now());
  const row = provider => ({source: 'account_catalog', ...(provider === undefined ? {} : {provider}), model: 'gpt-5.4', modelVersion: 'v1', efforts: ['high'], observedAt: now - 1000, expiresAt: now + 60_000});
  await DB.prepare("INSERT INTO metadata(key,value) VALUES('model_policy_availability',?1)").bind(JSON.stringify([row('codex'), row('claude'), row('gemini'), row(undefined)])).run();
  const snapshot = await availabilitySnapshot(store, {availability: 'fresh', codex: rows});
  assert.deepEqual(snapshot.rows.map(x => x.provider), ['codex']);
});
