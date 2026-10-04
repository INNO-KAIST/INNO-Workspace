import {providersByTransport, usesTransport} from '../public/core/providers.mjs';
import {createClaudeRoutineAdapter} from './claude-routine.mjs';

// Cloud (routine_fire) provider adapters. Adding a cloud provider means a
// manifest in public/core/providers.mjs plus one factory here. Each adapter is
// {provider, configured, unavailableReason, launch(claim, {materials})}; launch
// resolves {sessionUrl, checkpoint, contextDelivery} or throws.
export const REMOTE_ADAPTER_FACTORIES = Object.freeze([createClaudeRoutineAdapter]);

export function createRemoteAdapters(options = {}, factories = REMOTE_ADAPTER_FACTORIES) {
  const adapters = new Map();
  for (const create of factories) {
    const adapter = create(options);
    if (!usesTransport(adapter?.provider, 'routine_fire')) throw new Error(`not a cloud provider: ${adapter?.provider}`);
    if (adapters.has(adapter.provider)) throw new Error(`duplicate remote adapter: ${adapter.provider}`);
    if (typeof adapter.configured !== 'boolean' || typeof adapter.unavailableReason !== 'string' || typeof adapter.launch !== 'function')
      throw new Error(`invalid remote adapter: ${adapter.provider}`);
    adapters.set(adapter.provider, adapter);
  }
  for (const provider of providersByTransport('routine_fire'))
    if (!adapters.has(provider)) throw new Error(`missing remote adapter: ${provider}`);
  return provider => adapters.get(provider) ?? null;
}
