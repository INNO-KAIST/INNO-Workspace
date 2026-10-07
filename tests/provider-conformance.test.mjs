import test from 'node:test';
import assert from 'node:assert/strict';
import {PROVIDER_MANIFESTS, PROVIDER_CONFORMANCE_SUITE_VERSION, isAssignableProvider, providerManifest} from '../public/core/providers.mjs';
import {CONFORMANCE_CHECKS, SOURCE_SENTINEL, runProviderConformance} from './helpers/provider-conformance.mjs';
import {PROVIDER_HARNESSES, createClaudeCodeHarness, createCodexHarness} from './helpers/provider-harnesses.mjs';

// CR-006 PRV-04: every registered provider runs the common suite through its
// real adapter. A manifest cannot be registered here without a harness.
test('every registered provider has a conformance harness and a declared result', () => {
  for (const manifest of PROVIDER_MANIFESTS) {
    assert.equal(typeof PROVIDER_HARNESSES[manifest.id], 'function', `${manifest.id} needs a conformance harness`);
    assert.equal(manifest.conformance.suiteVersion, PROVIDER_CONFORMANCE_SUITE_VERSION, manifest.id);
    assert.equal(isAssignableProvider(manifest.id), manifest.conformance.status === 'passed', manifest.id);
  }
});

for (const manifest of PROVIDER_MANIFESTS) runProviderConformance(test, {manifest, createHarness: PROVIDER_HARNESSES[manifest.id]});

// The desktop delivery receipt protocol (version 1) is built but not enabled in
// production (receipt gate 0). A user-stopped execution is settled by a discarded
// receipt (H4-1), so it must pass the same checks as version 0.
runProviderConformance(test, {
  manifest: providerManifest('codex'), label: 'codex receipts v1',
  createHarness: t => createCodexHarness(t, {receipts: 1}),
});
// CR-006 S2: the Claude Code pilot declares delivery receipts, which production uses.
runProviderConformance(test, {
  manifest: providerManifest('claude-code'), label: 'claude-code receipts v1',
  createHarness: t => createClaudeCodeHarness(t, {receipts: 1}),
});

// The suite must fail adapters with known defects, or a passing run proves nothing.
// Each defect must be caught by the assertion that names it, not by a setup step.
const tamper = async (h, taskId, change) => {
  const task = await h.read(taskId);
  await h.store.replaceTask(task.id, task.version, current => ({...current, version: current.version + 1, ...change(current)}));
};
const afterDelivery = change => h => ({...h, async deliver(owner, overrides) {
  const result = await h.deliver(owner, overrides);
  await tamper(h, owner.taskId, change(h));
  return result;
}});
const DEFECTS = [
  {check: 'ownership', detectedBy: 'another generation must not deliver', defect: h => ({...h, deliver: owner => h.deliver(owner)})},
  {check: 'staleOwner', detectedBy: 'a superseded owner must not deliver', defect: h => {
    let latest = null;
    const track = owner => (latest = owner);
    return {...h,
      launch: async (task, options) => track(await h.launch(task, options)),
      restart: async (id, options) => track(await h.restart(id, options)),
      deliver: (owner, overrides) => h.deliver(latest ?? owner, overrides)};
  }},
  {check: 'cancellation', detectedBy: 'the stop action pauses the task', defect: h => ({...h, pause: id => h.read(id)})},
  {check: 'cancellation', detectedBy: 'the stop terminates the running process', when: m => m.capabilities.cancellation === 'process_terminate', defect: h => ({...h, terminated: async () => false})},
  {check: 'replay', detectedBy: 'a resent result is acknowledged', defect: h => {
    const sent = new WeakSet();
    return {...h, async deliver(owner, overrides) { if (sent.has(owner)) return {accepted: false}; sent.add(owner); return h.deliver(owner, overrides); }};
  }},
  {check: 'replay', detectedBy: 'a resent result adds no message', defect: afterDelivery(() => current => ({messages: [...current.messages, {...current.messages.at(-1), id: crypto.randomUUID()}]}))},
  {check: 'sourceRetention', detectedBy: 'source text must not be stored', defect: afterDelivery(() => current => ({checkpoint: {...current.checkpoint, note: SOURCE_SENTINEL}}))},
  {check: 'secrets', detectedBy: 'a secret left toward the provider', defect: h => ({...h, outbound: () => [...h.outbound(), 'token in body ' + h.secrets[0]]})},
  {check: 'secrets', detectedBy: 'a secret was stored', defect: afterDelivery(h => current => ({checkpoint: {...current.checkpoint, note: h.secrets.at(-1)}}))},
  {check: 'usage', detectedBy: 'unreported usage stays null, never 0', defect: h => {
    const reported = new WeakMap();
    return {...h,
      async launch(task, options = {}) { const owner = await h.launch(task, options); reported.set(owner, !!options.usage); return owner; },
      deliver: (owner, overrides = {}) => h.deliver(owner, reported.get(owner) ? overrides : {...overrides, usage: {inputTokens: 0, outputTokens: 0}})};
  }},
  {check: 'contextDelivery', detectedBy: 'context delivery is recorded for the provider', defect: afterDelivery(() => current => ({checkpoint: {...current.checkpoint, contextDelivery: undefined}}))},
  {check: 'contextDelivery', detectedBy: 'recorded prompt bytes match what was sent', defect: afterDelivery(() => current => ({checkpoint: {...current.checkpoint, contextDelivery: {...current.checkpoint.contextDelivery, promptBytes: current.checkpoint.contextDelivery.promptBytes + 1}}}))},
  {check: 'pluginDelivery', detectedBy: 'a withdrawn plugin never reaches the provider', defect: h => ({...h, disablePlugin: async () => {}})},
  {check: 'pluginDelivery', detectedBy: 'plugin delivery is recorded', defect: afterDelivery(() => current => ({checkpoint: {...current.checkpoint, pluginDelivery: undefined}}))},
  {check: 'failurePath', detectedBy: 'a failed launch records the context it sent', defect: h => ({...h, async launchFailing(task) {
    const owner = await h.launchFailing(task);
    await tamper(h, owner.taskId, current => ({checkpoint: {...current.checkpoint, contextDelivery: undefined}}));
    return owner;
  }})},
];

test('every check has at least one defect it catches', () => {
  assert.deepEqual(Object.keys(CONFORMANCE_CHECKS).filter(name => !DEFECTS.some(row => row.check === name)), []);
});

test('the suite fails adapters with known defects', async t => {
  for (const manifest of PROVIDER_MANIFESTS)
    for (const {check, detectedBy, defect, when} of DEFECTS) {
      if (when && !when(manifest)) continue;
      await assert.rejects(async () => CONFORMANCE_CHECKS[check](defect(await PROVIDER_HARNESSES[manifest.id](t)), manifest),
        error => error instanceof assert.AssertionError && error.message.startsWith(detectedBy), `${manifest.id} ${check}: ${detectedBy}`);
    }
});
