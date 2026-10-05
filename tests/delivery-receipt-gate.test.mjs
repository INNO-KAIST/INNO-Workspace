import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {deliveryReceiptVersionFromEnvironment} from '../public/core/delivery-receipt-gate.mjs';
import {TestD1} from './helpers/d1.mjs';

test('the delivery receipt gate opens only for the exact string 1', () => {
  for (const value of [undefined, null, 0, 1, true, '0', '01', '1 ', 'true', 'yes']) {
    assert.equal(deliveryReceiptVersionFromEnvironment({INNO_DESKTOP_RECEIPT_VERSION: value}), 0);
  }
  assert.equal(deliveryReceiptVersionFromEnvironment({INNO_DESKTOP_RECEIPT_VERSION: '1'}), 1);
  assert.equal(deliveryReceiptVersionFromEnvironment(undefined), 0);
});

test('the production Worker turns receipts on only for the exact opt-in, independently of source delegation', async t => {
  const db = new TestD1();
  t.after(() => db.close());
  const token = 'test-receipt-gate-0123456789012345';
  const request = () => new Request('https://inno.test/api/state', {headers: {authorization: `Bearer ${token}`}});
  for (const source of [undefined, '1']) {
    for (const [value, expected] of [[undefined, false], ['0', false], ['true', false], [1, false], ['1', true]]) {
      const env = {DB: db, ACCESS_TOKEN: token};
      if (source !== undefined) env.INNO_SOURCE_DELEGATION_VERSION = source;
      if (value !== undefined) env.INNO_DESKTOP_RECEIPT_VERSION = value;
      const state = await (await worker.fetch(request(), env)).json();
      assert.equal(state.capabilities.desktopDeliveryRecovery, expected, `receipt ${String(value)} source ${String(source)}`);
      assert.equal(state.capabilities.sourceDelegationVersion, source === '1' ? 1 : 0);
    }
  }
});

test('a Worker with receipts on still lets a protocol 0 desktop claim, and a receipts-off Worker refuses receipts without claiming', async t => {
  const db = new TestD1();
  t.after(() => db.close());
  const token = 'test-receipt-gate-0123456789012345';
  const env = receipts => ({DB: db, ACCESS_TOKEN: token, ...(receipts ? {INNO_DESKTOP_RECEIPT_VERSION: '1'} : {})});
  const call = (path, {body, headers = {}, receipts = false} = {}) => worker.fetch(new Request('https://inno.test' + path, {method: body ? 'POST' : 'GET', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers}, body: body ? JSON.stringify(body) : undefined}), env(receipts));
  const created = (await (await call('/api/tasks', {body: {title: 'Gate check', prompt: 'Work'}})).json()).task;
  assert.equal((await call(`/api/tasks/${created.id}/run`, {body: {expectedVersion: created.version, provider: 'codex'}})).status, 202);
  const workspaceId = (await (await call('/api/desktop/identity')).json()).workspaceId;
  const versioned = {'x-inno-delivery-receipt-version': '1', 'x-inno-workspace-id': workspaceId};
  // Desktop on, Worker off: refused before anything is claimed.
  assert.equal((await call('/api/desktop/poll', {body: {}, headers: versioned})).status, 400);
  const state = async () => (await (await call('/api/state')).json()).tasks.find(task => task.id === created.id);
  assert.equal((await state()).status, 'queued');
  // Worker on, desktop off: the old protocol 0 claim still works and carries no receipt version.
  const response = await call('/api/desktop/poll', {body: {}, receipts: true});
  assert.equal(response.status, 200);
  const {claim} = await response.json();
  assert.equal(claim.task.id, created.id);assert.equal(claim.task.checkpoint.deliveryReceiptVersion, undefined);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key GLOB 'desktop_reservation:*'").first()).n), 0);
});
