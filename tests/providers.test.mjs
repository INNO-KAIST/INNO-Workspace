import test from 'node:test';
import assert from 'node:assert/strict';
import {ValidationError} from '../public/core/tasks.mjs';
import {CLAUDE_ROLE_MODELS} from '../public/core/claude-routing.mjs';
import {
  PROVIDER_MANIFESTS, PROVIDER_IDS, createProviderRegistry, validateProviderManifest,
  isProviderId, assertProviderId, providerManifest, providerLabel, providerTransport,
  providerCapability, providersByTransport, usesTransport, providerHas, providerModels,
  ASSIGNABLE_PROVIDER_IDS, isAssignableProvider, PROVIDER_CONFORMANCE_SUITE_VERSION,
} from '../public/core/providers.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const codex = () => clone(PROVIDER_MANIFESTS.find(m => m.id === 'codex'));
const claude = () => clone(PROVIDER_MANIFESTS.find(m => m.id === 'claude'));
const rejects = (manifest, field) => assert.throws(() => validateProviderManifest(manifest), error => error instanceof ValidationError && error.message === `provider manifest ${field} is invalid`);

test('the registry declares Codex and Claude in their existing order', () => {
  assert.deepEqual([...PROVIDER_IDS], ['codex', 'claude']);
  for (const manifest of PROVIDER_MANIFESTS) assert.doesNotThrow(() => validateProviderManifest(manifest));
});

test('existing transport differences are declared as capabilities', () => {
  assert.equal(providerTransport('codex'), 'desktop_bridge');
  assert.equal(providerManifest('codex').execution.location, 'local');
  assert.equal(providerTransport('claude'), 'routine_fire');
  assert.equal(providerManifest('claude').execution.location, 'cloud');
  assert.deepEqual([...providersByTransport('desktop_bridge')], ['codex']);
  assert.deepEqual([...providersByTransport('routine_fire')], ['claude']);
  assert.deepEqual([...providersByTransport('unknown')], []);
  const expected = {
    codex: {fileArtifacts: true, resultCallback: 'desktop_bridge', cancellation: 'process_terminate', usageReport: 'runtime_reported', deliveryReceipts: 1, executionEvidence: 'cli_arguments', evaluationBudget: true},
    claude: {fileArtifacts: true, resultCallback: 'mcp_checkpoint', cancellation: 'confirmation_required', usageReport: 'self_reported_optional', deliveryReceipts: 0, executionEvidence: null, evaluationBudget: false},
  };
  for (const [id, capabilities] of Object.entries(expected))
    for (const [name, value] of Object.entries(capabilities)) assert.equal(providerCapability(id, name), value, `${id}.${name}`);
  assert.deepEqual(providerManifest('codex').models, {catalog: 'account_catalog'});
  assert.deepEqual(providerManifest('claude').models, {catalog: 'built_in_roles', roles: ['haiku', 'sonnet', 'opus']});
  for (const name of ['teleport', 'toString', Symbol('x')]) assert.throws(() => providerCapability('codex', name), ValidationError);
});

test('unknown providers are rejected with the existing message', () => {
  for (const value of ['gemini', 'Codex', '', undefined, null, 'toString', '__proto__', 'constructor'])
    assert.equal(isProviderId(value), false, String(value));
  assert.equal(assertProviderId('claude'), 'claude');
  for (const call of [() => assertProviderId('gemini'), () => providerManifest('gemini'), () => providerTransport('toString')])
    assert.throws(call, error => error instanceof ValidationError && error.message === 'provider must be codex or claude');
  assert.equal(providerLabel('codex'), 'Codex');
  assert.equal(providerLabel('claude'), 'Claude');
  assert.equal(providerLabel('gemini'), null);
});

test('manifests accept only subscription authentication', () => {
  for (const kind of ['api_key', 'paid_api', 'oauth_api', 'subscription', '']) {
    const manifest = codex(); manifest.auth.kind = kind; rejects(manifest, 'auth');
  }
  const paid = claude(); paid.auth.paidApi = true; rejects(paid, 'auth');
  const missing = codex(); delete missing.auth.paidApi; rejects(missing, 'auth');
  for (const paidApi of [0, 'false', null]) { const manifest = codex(); manifest.auth.paidApi = paidApi; rejects(manifest, 'auth'); }
  const extra = codex(); extra.auth.apiKey = 'x'; rejects(extra, 'auth');
  const crossed = codex(); crossed.auth.kind = 'subscription_cloud_routine'; rejects(crossed, 'auth');
  const apiKey = codex(); apiKey.id = 'api-provider'; apiKey.auth.kind = 'api_key';
  assert.throws(() => createProviderRegistry([apiKey]), ValidationError);
});

test('manifest validation rejects undeclared or inconsistent declarations', () => {
  const cases = [
    [m => { m.extra = true; }, 'shape'],
    [m => { m.manifestVersion = 2; }, 'manifestVersion'],
    [m => { m.id = 'Codex'; }, 'id'],
    [m => { m.id = 'a'; }, 'id'],
    [m => { m.id = 'x'.repeat(33); }, 'id'],
    [m => { m.label = ''; }, 'label'],
    [m => { m.vendor = 'openai'; }, 'vendor'],
    [m => { m.capabilities.teleport = true; }, 'capabilities'],
    [m => { delete m.capabilities.fileArtifacts; }, 'capabilities'],
    [m => { m.capabilities.usageReport = 'always'; }, 'usageReport'],
    [m => { m.capabilities.deliveryReceipts = 2; }, 'deliveryReceipts'],
    [m => { m.execution.location = 'cloud'; }, 'execution'],
    [m => { m.execution.transport = 'carrier_pigeon'; }, 'execution'],
    [m => { m.capabilities.resultCallback = 'mcp_checkpoint'; }, 'resultCallback'],
    [m => { m.capabilities.cancellation = 'confirmation_required'; }, 'cancellation'],
    [m => { m.models = {catalog: 'built_in_roles', roles: []}; }, 'models'],
    [m => { m.models = {catalog: 'account_catalog', roles: ['x']}; }, 'models'],
    [m => { m.models = {catalog: 'guess'}; }, 'models'],
    [m => { m.ui.usageUrl = 'http://example.test/usage'; }, 'ui'],
    [m => { m.ui.availability = []; }, 'ui'],
    [m => { m.ui.extra = 'x'; }, 'ui'],
    [m => { m.label = '   '; }, 'label'],
    [m => { m.label = 'x'.repeat(41); }, 'label'],
    [m => { m.label = 7; }, 'label'],
    [m => { m.ui.option = '  '; }, 'ui'],
    [m => { m.ui.usageUrl = ['https://example.test/usage']; }, 'ui'],
    [m => { m.ui.usageUrl = 'not a url'; }, 'ui'],
    [m => { m.ui.availability = ['localCodex', 'localCodex']; }, 'ui'],
    [m => { m.ui.availability = ['a', 'b', 'c', 'd', 'e']; }, 'ui'],
    [m => { m.ui.availability = ['local-codex']; }, 'ui'],
    [m => { m.models = {catalog: 'built_in_roles', roles: ['a', 'a']}; }, 'models'],
    [m => { m.models = {catalog: 'built_in_roles', roles: ['Bad Role']}; }, 'models'],
    [m => { m.models = {catalog: 'built_in_roles', roles: 'a b c d e f g h i'.split(' ')}; }, 'models'],
    [m => { delete m.vendor; }, 'shape'],
  ];
  for (const [change, field] of cases) { const manifest = codex(); change(manifest); rejects(manifest, field); }
  const cloudReceipts = claude(); cloudReceipts.capabilities.deliveryReceipts = 1; rejects(cloudReceipts, 'deliveryReceipts');
  const cloudEvidence = claude(); cloudEvidence.capabilities.executionEvidence = 'cli_arguments'; rejects(cloudEvidence, 'executionEvidence');
  const cloudStop = claude(); cloudStop.capabilities.cancellation = 'process_terminate'; rejects(cloudStop, 'cancellation');
  const cloudBudget = claude(); cloudBudget.capabilities.evaluationBudget = true; rejects(cloudBudget, 'evaluationBudget');
  const cloudUsage = claude(); cloudUsage.capabilities.usageReport = 'runtime_reported'; rejects(cloudUsage, 'usageReport');
  for (const value of [null, [], 'codex', 1]) rejects(value, 'manifest');
});

test('registered manifests are immutable', () => {
  assert.ok(Object.isFrozen(PROVIDER_MANIFESTS));
  assert.throws(() => { PROVIDER_MANIFESTS[0].capabilities.evaluationBudget = false; }, TypeError);
  assert.throws(() => { PROVIDER_MANIFESTS[1].models.roles.push('mythos'); }, TypeError);
  assert.throws(() => { PROVIDER_MANIFESTS[0].ui.availability[0] = 'x'; }, TypeError);
  assert.throws(() => { PROVIDER_IDS.push('gemini'); }, TypeError);
  assert.ok(Object.isFrozen(providerManifest('claude').models.roles));
});

test('a separate registry can add a provider without touching the defaults', () => {
  const fixture = {...codex(), id: 'fixture-cli', label: 'Fixture CLI', models: {catalog: 'built_in_roles', roles: ['fixture']}};
  const registry = createProviderRegistry([...PROVIDER_MANIFESTS, fixture]);
  assert.deepEqual([...registry.ids], ['codex', 'claude', 'fixture-cli']);
  assert.deepEqual([...registry.byTransport('desktop_bridge')], ['codex', 'fixture-cli']);
  assert.equal(registry.label('fixture-cli'), 'Fixture CLI');
  assert.throws(() => registry.assert('gemini'), error => error instanceof ValidationError && error.message === 'provider must be codex or claude or fixture-cli');
  assert.ok(Object.isFrozen(registry.manifest('fixture-cli').capabilities));
  assert.equal(Object.isFrozen(fixture.capabilities), false);
  assert.deepEqual([...PROVIDER_IDS], ['codex', 'claude']);
  assert.throws(() => createProviderRegistry([codex(), codex()]), error => error instanceof ValidationError && /duplicate/.test(error.message));
  assert.throws(() => createProviderRegistry([]), ValidationError);
  // The account catalog is one desktop-reported list today; a second provider would be checked against it.
  assert.throws(() => createProviderRegistry([codex(), {...codex(), id: 'second-cli'}]), error => error instanceof ValidationError && error.message === 'provider registry allows one account_catalog provider');
});

test('a registry stores exactly the manifest it validated', () => {
  let reads = 0;
  const shifting = codex(); shifting.id = 'shifting-cli';
  Object.defineProperty(shifting.auth, 'paidApi', {enumerable: true, get: () => reads++ > 0});
  const stored = createProviderRegistry([shifting]).manifest('shifting-cli');
  assert.equal(stored.auth.paidApi, false);
  for (const value of [{...codex(), id: 'fn-cli', label: () => 'x'}, new Proxy(codex(), {})])
    assert.throws(() => createProviderRegistry([value]), ValidationError);
  const hidden = codex(); hidden.id = 'hidden-cli'; delete hidden.vendor;
  Object.defineProperty(hidden, 'vendor', {value: 'OPENAI', enumerable: false}); hidden.extra = 1;
  assert.throws(() => createProviderRegistry([hidden]), ValidationError);
});

test('transport and capability predicates are false for unknown or missing owners', () => {
  assert.equal(usesTransport('codex', 'desktop_bridge'), true);
  assert.equal(usesTransport('claude', 'desktop_bridge'), false);
  assert.equal(usesTransport('claude', 'routine_fire'), true);
  assert.equal(providerHas('codex', 'deliveryReceipts', 1), true);
  assert.equal(providerHas('claude', 'deliveryReceipts', 1), false);
  assert.equal(providerHas('claude', 'cancellation', 'confirmation_required'), true);
  assert.equal(providerHas('codex', 'executionEvidence', 'cli_arguments'), true);
  for (const owner of [undefined, null, '', 'gemini', 'toString'])
    assert.equal(usesTransport(owner, 'desktop_bridge') || providerHas(owner, 'evaluationBudget', true), false, String(owner));
  assert.throws(() => providerHas('codex', 'teleport', true), ValidationError);
});

test('declared model catalogs are readable for stored owners', () => {
  assert.deepEqual(providerModels('codex'), {catalog: 'account_catalog'});
  assert.deepEqual([...providerModels('claude').roles], ['haiku', 'sonnet', 'opus']);
  assert.deepEqual([...CLAUDE_ROLE_MODELS], ['haiku', 'sonnet', 'opus']);
  for (const owner of [undefined, null, 'gemini', 'toString']) assert.equal(providerModels(owner), null);
});

test('only providers that passed the current conformance suite are assignable', () => {
  assert.equal(PROVIDER_CONFORMANCE_SUITE_VERSION, 1);
  assert.deepEqual([...ASSIGNABLE_PROVIDER_IDS], ['codex', 'claude']);
  assert.equal(isAssignableProvider('codex'), true);
  for (const owner of [undefined, 'gemini', 'toString']) assert.equal(isAssignableProvider(owner), false);
  const pending = {...codex(), id: 'pending-cli', models: {catalog: 'built_in_roles', roles: ['p']}, conformance: {suiteVersion: 1, status: 'pending'}};
  const future = {...pending, id: 'future-cli', conformance: {suiteVersion: 2, status: 'passed'}};
  const registry = createProviderRegistry([...PROVIDER_MANIFESTS, pending, future]);
  assert.deepEqual([registry.assignable('pending-cli'), registry.assignable('future-cli'), registry.assignable('claude')], [false, false, true]);
  assert.deepEqual([...registry.assignableIds], ['codex', 'claude']);
  for (const conformance of [{suiteVersion: 1, status: 'ok'}, {suiteVersion: 0, status: 'passed'}, {status: 'passed'}, {suiteVersion: 1, status: 'passed', evidence: 'x'}]) {
    const manifest = codex(); manifest.conformance = conformance; rejects(manifest, 'conformance');
  }
});
