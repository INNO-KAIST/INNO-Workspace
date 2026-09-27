export function sourceDelegationVersionFromEnvironment(env) {
  return env?.INNO_SOURCE_DELEGATION_VERSION === '1' ? 1 : 0;
}
