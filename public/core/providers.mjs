import {ValidationError} from './tasks.mjs';

// Declarative provider registry (CR-006 PRV-01..03). A provider is added by a
// manifest here plus an adapter; generic code asks the registry for transport
// and capabilities instead of comparing provider ids.
export const PROVIDER_MANIFEST_VERSION = 1;
// PRV-04: tests/provider-conformance.test.mjs runs this suite version for every
// manifest; only a provider that declares it passed may be assigned work.
export const PROVIDER_CONFORMANCE_SUITE_VERSION = 1;

// Only official subscription sign-in paths are registrable; API keys and paid
// usage are rejected by the validator (PRV-02).
const AUTH_KINDS = new Set(['subscription_cli', 'subscription_cloud_routine']);
const TRANSPORTS = Object.freeze({desktop_bridge: 'local', routine_fire: 'cloud'});
// Capabilities each transport actually implements. A manifest cannot declare a
// behavior its transport does not provide (PRV-03: no unverified capability).
// Codex review-phase pauses still need confirmation; that depends on delegation
// state, not on this per-provider cancellation guarantee.
const TRANSPORT_CAPABILITIES = Object.freeze({
  desktop_bridge: {resultCallback: ['desktop_bridge'], cancellation: ['process_terminate'], deliveryReceipts: [0, 1], executionEvidence: [null, 'cli_arguments']},
  routine_fire: {resultCallback: ['mcp_checkpoint'], cancellation: ['confirmation_required'], deliveryReceipts: [0], executionEvidence: [null], evaluationBudget: [false], usageReport: ['self_reported_optional', 'none']},
});
const TRANSPORT_AUTH = Object.freeze({desktop_bridge: 'subscription_cli', routine_fire: 'subscription_cloud_routine'});
const CAPABILITY_VALUES = Object.freeze({
  fileArtifacts: [true, false],
  resultCallback: ['desktop_bridge', 'mcp_checkpoint'],
  cancellation: ['process_terminate', 'confirmation_required'],
  usageReport: ['runtime_reported', 'self_reported_optional', 'none'],
  deliveryReceipts: [0, 1],
  executionEvidence: [null, 'cli_arguments'],
  evaluationBudget: [true, false],
  // Which work may be assigned: any (top-level tasks, delegation children, handoff targets) or
  // top_level (a task the person runs, and its cross-check; never a child or a handoff).
  assignment: ['any', 'top_level'],
});
const KEYS = ['manifestVersion', 'id', 'label', 'vendor', 'auth', 'execution', 'capabilities', 'models', 'ui', 'conformance'];

export const PROVIDER_MANIFESTS = deepFreeze([
  {
    manifestVersion: 1, id: 'codex', label: 'Codex', vendor: 'OPENAI',
    auth: {kind: 'subscription_cli', paidApi: false},
    execution: {location: 'local', transport: 'desktop_bridge'},
    capabilities: {fileArtifacts: true, resultCallback: 'desktop_bridge', cancellation: 'process_terminate', usageReport: 'runtime_reported', deliveryReceipts: 1, executionEvidence: 'cli_arguments', evaluationBudget: true, assignment: 'any'},
    models: {catalog: 'account_catalog'},
    ui: {option: 'Codex · 현재 구독', usageUrl: 'https://chatgpt.com/codex/settings/usage', availability: ['localCodex', 'cloudCodex']},
    conformance: {suiteVersion: 1, status: 'passed'},
  },
  {
    manifestVersion: 1, id: 'claude', label: 'Claude', vendor: 'ANTHROPIC',
    auth: {kind: 'subscription_cloud_routine', paidApi: false},
    execution: {location: 'cloud', transport: 'routine_fire'},
    capabilities: {fileArtifacts: true, resultCallback: 'mcp_checkpoint', cancellation: 'confirmation_required', usageReport: 'self_reported_optional', deliveryReceipts: 0, executionEvidence: null, evaluationBudget: false, assignment: 'any'},
    models: {catalog: 'built_in_roles', roles: ['haiku', 'sonnet', 'opus']},
    ui: {option: 'Claude · 클라우드 Routine', usageUrl: 'https://claude.ai/settings/usage', availability: ['claudeRoutine']},
    conformance: {suiteVersion: 1, status: 'passed'},
  },
  // CR-006 S2: the Claude Code CLI on this PC with the Claude subscription login. Passed the
  // conformance suite and two real-subscription checks (2026-10-08); its runner takes top-level
  // tasks only, so it is never a delegation child or a handoff target.
  {
    manifestVersion: 1, id: 'claude-code', label: 'Claude Code', vendor: 'ANTHROPIC',
    auth: {kind: 'subscription_cli', paidApi: false},
    execution: {location: 'local', transport: 'desktop_bridge'},
    capabilities: {fileArtifacts: true, resultCallback: 'desktop_bridge', cancellation: 'process_terminate', usageReport: 'runtime_reported', deliveryReceipts: 1, executionEvidence: null, evaluationBudget: false, assignment: 'top_level'},
    models: {catalog: 'built_in_roles', roles: ['haiku', 'sonnet', 'opus']},
    ui: {option: 'Claude · 이 PC (Claude Code)', usageUrl: 'https://claude.ai/settings/usage', availability: ['localClaudeCode']},
    conformance: {suiteVersion: 1, status: 'passed'},
  },
]);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function validateProviderManifest(manifest) {
  const fail = field => { throw new ValidationError(`provider manifest ${field} is invalid`); };
  if (!record(manifest)) fail('manifest');
  if (!exactKeys(manifest, KEYS)) fail('shape');
  if (manifest.manifestVersion !== PROVIDER_MANIFEST_VERSION) fail('manifestVersion');
  if (typeof manifest.id !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(manifest.id)) fail('id');
  if (!text(manifest.label, 40)) fail('label');
  if (typeof manifest.vendor !== 'string' || !/^[A-Z][A-Z0-9 ]{1,23}$/.test(manifest.vendor)) fail('vendor');
  const {auth, execution, capabilities, models, ui} = manifest;
  if (!exactKeys(auth, ['kind', 'paidApi']) || !AUTH_KINDS.has(auth.kind) || auth.paidApi !== false) fail('auth');
  if (!exactKeys(execution, ['location', 'transport']) || !Object.hasOwn(TRANSPORTS, execution.transport)
    || TRANSPORTS[execution.transport] !== execution.location) fail('execution');
  if (!exactKeys(capabilities, Object.keys(CAPABILITY_VALUES))) fail('capabilities');
  for (const [name, allowed] of Object.entries(CAPABILITY_VALUES)) if (!allowed.includes(capabilities[name])) fail(name);
  for (const [name, allowed] of Object.entries(TRANSPORT_CAPABILITIES[execution.transport])) if (!allowed.includes(capabilities[name])) fail(name);
  if (TRANSPORT_AUTH[execution.transport] !== auth.kind) fail('auth');
  const roles = models?.roles;
  if (!(exactKeys(models, ['catalog']) && models.catalog === 'account_catalog')
    && !(exactKeys(models, ['catalog', 'roles']) && models.catalog === 'built_in_roles' && Array.isArray(roles) && roles.length >= 1 && roles.length <= 8
      && roles.every(role => typeof role === 'string' && /^[a-z][a-z0-9.-]{0,31}$/.test(role)) && new Set(roles).size === roles.length)) fail('models');
  let usageUrl = null;
  if (typeof ui?.usageUrl === 'string' && ui.usageUrl.length <= 200) try { usageUrl = new URL(ui.usageUrl); } catch { /* reported below */ }
  if (!exactKeys(ui, ['option', 'usageUrl', 'availability']) || !text(ui.option, 60) || usageUrl?.protocol !== 'https:'
    || !Array.isArray(ui.availability) || ui.availability.length < 1 || ui.availability.length > 4
    || !ui.availability.every(flag => typeof flag === 'string' && /^[A-Za-z]{1,40}$/.test(flag)) || new Set(ui.availability).size !== ui.availability.length) fail('ui');
  const {conformance} = manifest;
  if (!exactKeys(conformance, ['suiteVersion', 'status']) || !Number.isSafeInteger(conformance.suiteVersion) || conformance.suiteVersion < 1
    || !['passed', 'pending'].includes(conformance.status)) fail('conformance');
  return manifest;
}

export function createProviderRegistry(manifests) {
  if (!Array.isArray(manifests) || manifests.length < 1) throw new ValidationError('provider registry requires manifests');
  const byId = new Map();
  for (const input of manifests) {
    // Validate the copy that is stored, so accessors cannot pass one value and keep another.
    let manifest;
    try { manifest = structuredClone(input); } catch { throw new ValidationError('provider manifest manifest is invalid'); }
    validateProviderManifest(manifest);
    if (byId.has(manifest.id)) throw new ValidationError(`provider manifest id is duplicate: ${manifest.id}`);
    byId.set(manifest.id, deepFreeze(manifest));
  }
  // The account catalog is a single desktop-reported list until catalogs are keyed by provider.
  if ([...byId.values()].filter(manifest => manifest.models.catalog === 'account_catalog').length > 1)
    throw new ValidationError('provider registry allows one account_catalog provider');
  const ids = Object.freeze([...byId.keys()]);
  const message = `provider must be ${ids.join(' or ')}`;
  const has = id => typeof id === 'string' && byId.has(id);
  const manifest = id => { if (!has(id)) throw new ValidationError(message); return byId.get(id); };
  const assignable = id => has(id) && byId.get(id).conformance.status === 'passed' && byId.get(id).conformance.suiteVersion === PROVIDER_CONFORMANCE_SUITE_VERSION;
  const capabilityName = name => { if (typeof name !== 'string' || !Object.hasOwn(CAPABILITY_VALUES, name)) throw new ValidationError(`provider capability is unknown: ${String(name)}`); return name; };
  return Object.freeze({
    ids, has, manifest, assignable, assignableIds: Object.freeze(ids.filter(assignable)),
    // Delegation children and handoff targets: assignable providers that take any work.
    delegableIds: Object.freeze(ids.filter(id => assignable(id) && byId.get(id).capabilities.assignment === 'any')),
    assert: id => manifest(id).id,
    label: id => has(id) ? byId.get(id).label : null,
    transport: id => manifest(id).execution.transport,
    capability: (id, name) => manifest(id).capabilities[capabilityName(name)],
    byTransport: transport => Object.freeze(ids.filter(id => byId.get(id).execution.transport === transport)),
    // Predicates for stored owners: an absent or unregistered provider has no transport or capability.
    usesTransport: (id, transport) => has(id) && byId.get(id).execution.transport === transport,
    providerHas: (id, name, value) => capabilityName(name) && has(id) && byId.get(id).capabilities[name] === value,
    providerModels: id => has(id) ? byId.get(id).models : null,
  });
}

export const PROVIDERS = createProviderRegistry(PROVIDER_MANIFESTS);
export const PROVIDER_IDS = PROVIDERS.ids;
export const isProviderId = PROVIDERS.has;
export const isAssignableProvider = PROVIDERS.assignable;
export const ASSIGNABLE_PROVIDER_IDS = PROVIDERS.assignableIds;
export const DELEGABLE_PROVIDER_IDS = PROVIDERS.delegableIds;
// A top-level-only provider runs a task the person runs, never a delegation child, a reviewing
// or delegating parent, or an evaluation-budget task (its runner refuses them).
export function assertProviderTakes(provider, task) {
  if (PROVIDERS.providerHas(provider, 'assignment', 'top_level') && (task?.parentTaskId || task?.assignment || task?.evaluationBudget
    || (task?.delegation && !['superseded', 'cancelled'].includes(task.delegation.state))))
    throw new ValidationError(`${PROVIDERS.label(provider)}는 사람이 실행하는 최상위 작업만 맡습니다. 하위·위임·평가 예산 작업은 다른 실행기를 고르세요.`);
}
export const assertProviderId = PROVIDERS.assert;
export const providerManifest = PROVIDERS.manifest;
export const providerLabel = PROVIDERS.label;
export const providerTransport = PROVIDERS.transport;
export const providerCapability = PROVIDERS.capability;
export const providersByTransport = PROVIDERS.byTransport;
export const usesTransport = PROVIDERS.usesTransport;
export const providerHas = PROVIDERS.providerHas;
export const providerModels = PROVIDERS.providerModels;
