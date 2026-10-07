import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {PROVIDER_IDS} from '../public/core/providers.mjs';

// CR-006 S1: generic code reaches providers only through public/core/providers.mjs.
// Every browser, server and Worker source file is scanned, so a new generic file
// is covered automatically. Provider-specific code lives in the adapter files
// below; their literal count is pinned so a new literal there is a reviewed change.
const ROOTS = ['public', 'server', 'worker'];
const SOURCE = /\.(mjs|js|html)$/;
// Every registered provider id (CR-006 S2 added 'claude-code'), longer ids first.
const LITERAL = new RegExp(`(['"\`])(${[...PROVIDER_IDS].sort((a, b) => b.length - a.length).join('|')})\\1`, 'g');
const ADAPTER_LITERALS = {
  'public/core/providers.mjs': 3, // the manifests themselves
  'public/core/claude-routing.mjs': 3, // Claude adapter: routing self-report prompt and its role models
  'server/runners.mjs': 10, // Codex CLI runner (and its provider id for the connector runner table), its handoff prompt and the local Claude Routine runner
  'server/model-routing.mjs': 1, // spawns the Codex CLI app-server for the account catalog
  'server/codex-command.mjs': 1, // resolves the Codex CLI executable bundled with the desktop app
  'worker/claude-routine.mjs': 3, // Claude cloud Routine adapter
  'worker/model-discovery.mjs': 1, // vendor documentation source key, not an execution provider
  'public/core/routine-model.mjs': 1, // Claude Routine model recommendation (PRV-05): its vendor key
  'server/claude-code-runner.mjs': 3, // Claude Code CLI runner (CR-006 S2): its provider id, the CLI executable name and the desktop app's bundled CLI folder
};

function sources() {
  const files = [];
  for (const root of ROOTS)
    for (const name of readdirSync(new URL(`../${root}/`, import.meta.url), {recursive: true})) {
      const file = `${root}/${String(name).replaceAll('\\', '/')}`;
      if (SOURCE.test(file) && !file.startsWith('public/vendor/')) files.push(file);
    }
  return files.sort();
}
const literals = file => [...readFileSync(new URL('../' + file, import.meta.url), 'utf8').matchAll(LITERAL)];

test('generic source files contain no quoted provider ids', () => {
  const files = sources();
  assert.ok(files.includes('public/app.mjs') && files.includes('worker/index.mjs') && files.includes('server/http.mjs'));
  const offenders = files.filter(file => !Object.hasOwn(ADAPTER_LITERALS, file)).flatMap(file => literals(file).map(match => `${file}: ${match[0]}`));
  assert.deepEqual(offenders, []);
});

test('adapter files keep exactly their reviewed provider literals', () => {
  const counts = Object.fromEntries(Object.keys(ADAPTER_LITERALS).map(file => [file, literals(file).length]));
  assert.deepEqual(counts, ADAPTER_LITERALS);
});

// PRV-04: assignment entry points accept only providers that passed the conformance suite.
const ASSIGNMENT_GATES = ['public/core/delegation.mjs', 'public/core/provider-handoff.mjs', 'public/core/model-selection.mjs', 'server/model-routing.mjs'];

test('assignment entry points use the conformance gate', () => {
  for (const file of ASSIGNMENT_GATES) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(source, /isAssignableProvider\(/, file);
    assert.doesNotMatch(source, /isProviderId\(/, file);
  }
});
