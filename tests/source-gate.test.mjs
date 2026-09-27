import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {sourceDelegationVersionFromEnvironment} from '../public/core/source-delegation-gate.mjs';
import {TestD1} from './helpers/d1.mjs';

test('shared environment gate rejects non-string and approximate values', () => {
  for (const value of [undefined, null, 0, 1, true, '0', '01', '1 ', 'true']) {
    assert.equal(sourceDelegationVersionFromEnvironment({INNO_SOURCE_DELEGATION_VERSION: value}), 0);
  }
  assert.equal(sourceDelegationVersionFromEnvironment({INNO_SOURCE_DELEGATION_VERSION: '1'}), 1);
});

test('production Worker export advertises source delegation only for exact opt-in', async t => {
  const db = new TestD1();
  t.after(() => db.close());
  const token = 'test-source-gate-0123456789012345';
  const request = new Request('https://inno.test/api/state', {headers: {authorization: `Bearer ${token}`}});
  for (const [value, expected] of [[undefined, 0], ['0', 0], ['01', 0], ['true', 0], [1, 0], ['1', 1]]) {
    const env = {DB: db, ACCESS_TOKEN: token};
    if (value !== undefined) env.INNO_SOURCE_DELEGATION_VERSION = value;
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.capabilities.sourceDelegationVersion, expected, `env value ${String(value)}`);
  }
});
