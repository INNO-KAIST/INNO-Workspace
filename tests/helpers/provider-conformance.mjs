import assert from 'node:assert/strict';
import {boundedContextDelivery} from '../../public/core/context-delivery.mjs';

// CR-006 PRV-04 common conformance suite. Every registered provider runs these
// checks through its real adapter and the production transport (desktop
// connector with delivery receipts, or cloud Routine fire with MCP callbacks),
// the real Worker entry points and store. Only the provider's external process
// or API is faked by its harness (tests/helpers/provider-harnesses.mjs).
//
// Harness contract:
//   provider                       manifest id
//   secrets                        long-lived secrets configured for the adapter (tokens, API keys).
//                                  Scoped execution capabilities may leave; these must not.
//   outbound()                     every string that left toward the provider except authentication
//                                  headers: prompts, process argv and environment, request bodies
//   create(prompt, {sources})      task, optionally with source attachments of those names
//   launch(task, {materials, content, usage}) -> owner {taskId, executionId, generation, prompt}
//   deliver(owner, {executionId, generation, usage})
//                                  the owner's result through the provider's own result path; given
//                                  identity overrides it posts as a stale or forged owner would. A second
//                                  call for the same owner resends the recorded result. -> {accepted}
//   pause(taskId) -> task;  restart(taskId, options) -> new owner after a confirmed stop
//   launchFailing(task) -> owner   a definitive provider rejection after the prompt was sent
//   terminated(owner) -> boolean   only for cancellation 'process_terminate'
//   read(taskId) -> task;  dump() -> string   everything the store persisted
//   installPlugin(name) -> {id, contentHash, marker}   an approved plugin whose text contains marker
//   selectPlugins(taskId, selection);  disablePlugin(id)   the user's plugin actions
export const SOURCE_SENTINEL = 'conformance-source-7f3a9c-original-excerpt';
const SOURCE = 'conformance-source.txt';

async function launched(h, {materials, ...options} = {}) {
  const task = await h.create('Conformance request', {sources: materials ? materials.map(m => m.name) : []});
  return {task, owner: await h.launch(task, {content: 'Conformance answer', materials: materials ?? [], ...options})};
}
const withSource = () => ({materials: [{name: SOURCE, text: SOURCE_SENTINEL}]});

export const CONFORMANCE_CHECKS = Object.freeze({
  async ownership(h) {
    const {task, owner} = await launched(h);
    assert.equal((await h.deliver(owner, {generation: owner.generation + 1})).accepted, false, 'another generation must not deliver');
    assert.equal((await h.deliver(owner, {executionId: 'foreign-execution'})).accepted, false, 'another execution must not deliver');
    assert.notEqual((await h.read(task.id)).status, 'completed');
    assert.equal((await h.deliver(owner)).accepted, true, 'the owner delivers');
    const done = await h.read(task.id);
    assert.equal(done.status, 'completed');
    assert.deepEqual([done.checkpoint.provider, done.checkpoint.executionId, done.checkpoint.generation], [h.provider, owner.executionId, owner.generation]);
  },

  async staleOwner(h) {
    const {task, owner: first} = await launched(h);
    await h.pause(task.id);
    const second = await h.restart(task.id, {content: 'Second answer'});
    assert.ok(second.generation > first.generation, 'a restart claims a new generation');
    assert.equal((await h.deliver(first)).accepted, false, 'a superseded owner must not deliver');
    assert.notEqual((await h.read(task.id)).status, 'completed');
    assert.equal((await h.deliver(second)).accepted, true, 'the current owner delivers');
    assert.equal((await h.read(task.id)).checkpoint.generation, second.generation);
  },

  async cancellation(h, manifest) {
    const {task, owner} = await launched(h);
    const paused = await h.pause(task.id);
    assert.equal(paused.status, 'paused', 'the stop action pauses the task');
    assert.equal(Boolean(paused.checkpoint.confirmationRequired), manifest.capabilities.cancellation === 'confirmation_required', 'declared stop guarantee');
    if (manifest.capabilities.cancellation === 'process_terminate')
      assert.equal(await h.terminated(owner), true, 'the stop terminates the running process');
    assert.equal((await h.deliver(owner)).accepted, false, 'a stopped owner must not complete the task');
    assert.equal((await h.read(task.id)).status, 'paused');
  },

  async replay(h) {
    const {task, owner} = await launched(h, {usage: {inputTokens: 7, outputTokens: 3}});
    assert.equal((await h.deliver(owner)).accepted, true);
    const first = await h.read(task.id);
    assert.equal((await h.deliver(owner)).accepted, true, 'a resent result is acknowledged');
    const second = await h.read(task.id);
    assert.equal(second.status, 'completed');
    assert.equal(second.messages.length, first.messages.length, 'a resent result adds no message');
    assert.equal(second.artifacts.length, first.artifacts.length, 'a resent result adds no artifact');
    assert.deepEqual(second.checkpoint.usageHistory, first.checkpoint.usageHistory, 'a resent result adds no usage');
  },

  async sourceRetention(h) {
    const {task, owner} = await launched(h, withSource());
    assert.ok(h.outbound().some(value => value.includes(SOURCE_SENTINEL)), 'the adapter must deliver the transient source');
    assert.equal((await h.deliver(owner)).accepted, true);
    assert.equal((await h.read(task.id)).status, 'completed');
    assert.equal((await h.dump()).includes(SOURCE_SENTINEL), false, 'source text must not be stored');
  },

  async secrets(h) {
    const {owner} = await launched(h, withSource());
    assert.equal((await h.deliver(owner)).accepted, true);
    assert.ok(h.secrets.length > 0);
    const outbound = h.outbound().join('\n'), stored = await h.dump();
    for (const secret of h.secrets) {
      assert.equal(outbound.includes(secret), false, 'a secret left toward the provider');
      assert.equal(stored.includes(secret), false, 'a secret was stored');
    }
  },

  async usage(h) {
    const reported = await launched(h, {usage: {inputTokens: 7, outputTokens: 3}});
    assert.equal((await h.deliver(reported.owner)).accepted, true);
    const counted = (await h.read(reported.task.id)).checkpoint.usageHistory.find(row => row.executionId === reported.owner.executionId);
    assert.deepEqual([counted?.inputTokens, counted?.outputTokens], [7, 3], 'reported usage is stored');
    const silent = await launched(h);
    assert.equal((await h.deliver(silent.owner)).accepted, true);
    const unknown = (await h.read(silent.task.id)).checkpoint.usageHistory.find(row => row.executionId === silent.owner.executionId);
    assert.deepEqual([unknown?.inputTokens, unknown?.outputTokens], [null, null], 'unreported usage stays null, never 0');
  },

  async contextDelivery(h) {
    const {task, owner} = await launched(h);
    assert.equal((await h.deliver(owner)).accepted, true);
    const delivery = (await h.read(task.id)).checkpoint.contextDelivery;
    assert.equal(delivery?.provider, h.provider, 'context delivery is recorded for the provider');
    assert.deepEqual(boundedContextDelivery(delivery), delivery);
    assert.equal(delivery.promptBytes, Buffer.byteLength(owner.prompt), 'recorded prompt bytes match what was sent');
    assert.deepEqual([delivery.inputTokens, delivery.cachedTokens], [null, null]);
  },

  async pluginDelivery(h) {
    const kept = await h.installPlugin('conformance-kept'), dropped = await h.installPlugin('conformance-dropped');
    const task = await h.create('Conformance plugins');
    await h.selectPlugins(task.id, [{id: kept.id, reason: 'Applies to this task'}, {id: dropped.id, reason: 'Withdrawn before launch'}]);
    await h.disablePlugin(dropped.id);
    const owner = await h.launch(await h.read(task.id), {content: 'Conformance answer'});
    assert.ok(h.outbound().some(value => value.includes(kept.marker)), 'an approved plugin reaches the provider');
    assert.equal(h.outbound().some(value => value.includes(dropped.marker)), false, 'a withdrawn plugin never reaches the provider');
    assert.equal((await h.deliver(owner)).accepted, true);
    assert.deepEqual((await h.read(task.id)).checkpoint.pluginDelivery, {version: 1, applied: [{id: kept.id, contentHash: kept.contentHash, reason: 'Applies to this task'}], skipped: [{id: dropped.id, reason: 'not_approved'}]}, 'plugin delivery is recorded');
  },

  async failurePath(h) {
    const task = await h.create('Conformance failure');
    const owner = await h.launchFailing(task);
    const failed = await h.read(task.id);
    assert.ok(['failed', 'waiting_connection', 'waiting_quota'].includes(failed.status), 'a definitive rejection ends the execution');
    assert.equal(failed.checkpoint.failure?.automaticRetry, false);
    const delivery = failed.checkpoint.contextDelivery;
    assert.equal(delivery?.provider, h.provider, 'a failed launch records the context it sent');
    assert.equal(delivery.promptBytes, Buffer.byteLength(owner.prompt));
    for (const row of failed.checkpoint.usageHistory ?? [])
      assert.deepEqual([row.inputTokens, row.outputTokens], [null, null], 'unreported failure usage stays null');
  },
});

// todo marks a check that documents a known gap (with its tracking item); it
// still runs and reports, but does not fail the suite.
export function runProviderConformance(test, {manifest, createHarness, label = manifest.id, todo = {}}) {
  for (const [name, check] of Object.entries(CONFORMANCE_CHECKS))
    test(`${label} conformance: ${name}`, todo[name] ? {todo: todo[name]} : {}, async t => check(await createHarness(t), manifest));
}
