import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {resolve, join, sep} from 'node:path';
import {D1_SCHEMA} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {D1EvaluationBudgets} from '../worker/evaluation-budgets.mjs';
import {SqliteEvaluationBudgets} from '../server/evaluation-budgets.mjs';

const budget = {jobId: 'compare-1', maxExecutions: 1, totalDurationMs: 100};
const reservation = {executionId: 'run-1', generation: 1, phase: 'candidate', maxDurationMs: 100};
const evidence = ({jobId, executionId, generation, phase}) =>
  ({jobId, executionId, generation, phase, confirmed: true, elapsedMs: 40});
function fixture(t, backend, options = {}) {
  const db = backend === 'd1' ? new TestD1() : new DatabaseSync(':memory:');
  if (backend === 'sqlite') db.exec(D1_SCHEMA);
  t.after(() => backend === 'd1' ? db.close() : db.close());
  const Service = backend === 'd1' ? D1EvaluationBudgets : SqliteEvaluationBudgets;
  return {db, ledger: new Service(backend === 'd1' ? db : db, {now: () => 1000, verifyCompletion: evidence, ...options})};
}

for (const backend of ['d1', 'sqlite']) {
  test(`${backend}: unrelated metadata keys do not consume the 32 job allowance`, async t => {
    const {db, ledger} = fixture(t, backend);
    for (let n = 0; n < 32; n++) {
      const key = `evaluationXbudget:unrelated-${n}`;
      if (backend === 'd1') db.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(key, n);
      else db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(key, n);
    }
    assert.equal((await ledger.create(budget)).jobId, budget.jobId);
  });

  test(`${backend}: duplicate creation is exact and job limits stay immutable`, async t => {
    const {ledger} = fixture(t, backend);
    const created = await ledger.create(budget);
    assert.equal(created.stateVersion, 1);
    assert.deepEqual(await ledger.create({...budget}), created);
    await assert.rejects(() => ledger.create({...budget, maxExecutions: 2}), /conflict/i);
    assert.equal((await ledger.read(budget.jobId)).maxExecutions, 1);
  });

  test(`${backend}: only one concurrent claimant gets the final slot; stale writers conflict`, async t => {
    const {ledger} = fixture(t, backend);
    await ledger.create(budget);
    const outcomes = await Promise.allSettled([
      ledger.reserve(budget.jobId, {...reservation, expectedStateVersion: 1}),
      ledger.reserve(budget.jobId, {...reservation, executionId: 'run-2', expectedStateVersion: 1}),
    ]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
    const current = await ledger.read(budget.jobId);
    assert.equal(current.usedExecutions, 1);
    assert.equal(current.stateVersion, 2);
    await assert.rejects(() => ledger.reserve(budget.jobId, {...reservation, executionId: 'run-3', expectedStateVersion: 1}), /stale|conflict/i);
    const replay = current.reservations[0];
    assert.deepEqual(await ledger.reserve(budget.jobId, {executionId: replay.executionId, generation: replay.generation,
      phase: replay.phase, maxDurationMs: replay.maxDurationMs, expectedStateVersion: 1}), current);
  });

  test(`${backend}: trusted completion binds job and owner, while client duration and uncertain exit are rejected`, async t => {
    let verified = evidence;
    const {ledger} = fixture(t, backend, {verifyCompletion: ref => verified(ref)});
    await ledger.create(budget);
    const held = await ledger.reserve(budget.jobId, {...reservation, expectedStateVersion: 1});
    await assert.rejects(() => ledger.settle(budget.jobId, {executionId: 'run-1', generation: 1, expectedStateVersion: 2, elapsedMs: 0}), /invalid|elapsed|request/i);
    verified = () => null;
    await assert.rejects(() => ledger.settle(budget.jobId, {executionId: 'run-1', generation: 1, expectedStateVersion: 2}), /completion|verify|evidence/i);
    verified = ref => ({...evidence(ref), generation: 2});
    await assert.rejects(() => ledger.settle(budget.jobId, {executionId: 'run-1', generation: 1, expectedStateVersion: 2}), /completion|verify|evidence/i);
    assert.deepEqual(await ledger.read(budget.jobId), held);
    verified = evidence;
    const settled = await ledger.settle(budget.jobId, {executionId: 'run-1', generation: 1, expectedStateVersion: 2});
    assert.equal(settled.chargedDurationMs, 40);
    assert.equal(settled.usedExecutions, 1);
    assert.deepEqual(await ledger.settle(budget.jobId, {executionId: 'run-1', generation: 1, expectedStateVersion: 2}), settled);
    verified = ref => ({...evidence(ref), elapsedMs: 41});
    await assert.rejects(() => ledger.settle(budget.jobId, {executionId: 'run-1', generation: 1, expectedStateVersion: 3}), /conflict/i);
  });

  test(`${backend}: malformed stored totals fail closed and do not touch policy metadata`, async t => {
    const {db, ledger} = fixture(t, backend);
    const policyKey = 'model_policy:sentinel';
    const policyValue = '{"stateVersion":7,"sentinel":true}';
    if (backend === 'd1') db.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(policyKey, policyValue);
    else db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(policyKey, policyValue);
    await ledger.create(budget);
    await ledger.reserve(budget.jobId, {...reservation, expectedStateVersion: 1});
    const key = 'evaluation_budget:compare-1';
    if (backend === 'd1') db.db.prepare('UPDATE metadata SET value=json_set(value,\'$.chargedDurationMs\',0) WHERE key=?').run(key);
    else db.prepare('UPDATE metadata SET value=json_set(value,\'$.chargedDurationMs\',0) WHERE key=?').run(key);
    await assert.rejects(() => ledger.read(budget.jobId), /corrupt|invalid/i);
    const row = backend === 'd1' ? db.db.prepare("SELECT value FROM metadata WHERE key='revision'").get() : db.prepare("SELECT value FROM metadata WHERE key='revision'").get();
    assert.equal(Number(row.value), 2);
    const policy = backend === 'd1' ? db.db.prepare('SELECT value FROM metadata WHERE key=?').get(policyKey) : db.prepare('SELECT value FROM metadata WHERE key=?').get(policyKey);
    assert.equal(policy.value, policyValue);
  });

  test(`${backend}: an oversized stored ledger fails closed before it can be used`, async t => {
    const {db, ledger} = fixture(t, backend);
    await ledger.create(budget);
    const oversized = 'x'.repeat(256 * 1024 + 1);
    if (backend === 'd1') db.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(oversized, 'evaluation_budget:compare-1');
    else db.prepare('UPDATE metadata SET value=? WHERE key=?').run(oversized, 'evaluation_budget:compare-1');
    await assert.rejects(() => ledger.read(budget.jobId), /invalid stored budget size/i);
  });
}

test('SQLite file close and reopen retains an unresolved reservation', async t => {
  const root = resolve('.inno/tmp');
  mkdirSync(root, {recursive: true});
  const directory = mkdtempSync(join(root, 'evaluation-budget-'));
  assert.ok(resolve(directory).startsWith(root + sep));
  let db;
  t.after(() => {
    db?.close();
    if (!resolve(directory).startsWith(root + sep)) throw new Error('unsafe cleanup path');
    rmSync(directory, {recursive: true, force: true});
  });
  const filename = join(directory, 'ledger.sqlite');
  db = new DatabaseSync(filename);
  db.exec(D1_SCHEMA);
  const first = new SqliteEvaluationBudgets(db, {now: () => 1000, verifyCompletion: evidence});
  await first.create(budget);
  await first.reserve(budget.jobId, {...reservation, expectedStateVersion: 1});
  db.close();
  db = new DatabaseSync(filename);
  const reopened = new SqliteEvaluationBudgets(db, {now: () => 5000, verifyCompletion: evidence});
  const state = await reopened.read(budget.jobId);
  assert.equal(state.reservations[0].status, 'reserved');
  assert.equal(state.chargedDurationMs, 100);
  await assert.rejects(() => reopened.reserve(budget.jobId, {...reservation, executionId: 'run-2', expectedStateVersion: 2}), /unconfirmed_expired_reservation/i);
});

test('D1 job cap rejects a 33rd ledger without deleting earlier active records', async t => {
  const {ledger} = fixture(t, 'd1');
  for (let n = 0; n < 32; n++) await ledger.create({jobId: `job-${n}`, maxExecutions: 1, totalDurationMs: 1});
  await assert.rejects(() => ledger.create({jobId: 'job-32', maxExecutions: 1, totalDurationMs: 1}), /capacity|limit/i);
  assert.equal((await ledger.read('job-0')).maxExecutions, 1);
});
