import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { IMAGE_LIMITS, isImageAttachment } from '../public/core/image-materials.mjs';
import { prepareTaskMaterials } from '../public/core/source-materials.mjs';
import { sanitizeMaterials } from '../public/core/tasks.mjs';
import { sourceExecutionReadiness } from '../public/source-execution.mjs';
import { sourceExecutionMessage } from '../public/source-execution-ui.mjs';
import { createDesktopBridge } from '../server/desktop-bridge.mjs';
import { createDesktopServer } from '../server/desktop-http.mjs';
import { createClaudeRoutineRunner, createCodexRunner } from '../server/runners.mjs';

// CR-009 stage 3: images reach Codex on this PC as image inputs (codex exec -i). The bytes go
// only from the browser to the local connector, sit in a temporary folder outside the run
// directory during the run, and are deleted afterwards; Claude (cloud Routine) and the Worker
// never receive them.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const BMP = Buffer.concat([Buffer.from('BM'), Buffer.alloc(60, 1)]);
const imageMaterial = (name = 'scan.png', bytes = PNG) => ({ name, image: { data: bytes.toString('base64') } });

test('image materials are refused by default and checked by content when allowed', () => {
  assert.throws(() => sanitizeMaterials([imageMaterial()]), /Codex/);
  const [png] = sanitizeMaterials([imageMaterial()], { images: true });
  assert.deepEqual(png, { name: 'scan.png', image: { mime: 'image/png', data: PNG.toString('base64') } });
  const [jpeg] = sanitizeMaterials([{ name: 'photo.jpg', image: { mime: 'image/png', data: JPEG.toString('base64') } }], { images: true });
  assert.equal(jpeg.image.mime, 'image/jpeg', 'the signature decides the type, not the label');
  assert.throws(() => sanitizeMaterials([imageMaterial('a.bmp', BMP)], { images: true }), /PNG, JPEG, GIF or WebP/);
  assert.throws(() => sanitizeMaterials([{ name: 'x.png', image: { data: 'not base64!' } }], { images: true }), /base64/);
  assert.throws(() => sanitizeMaterials([{ ...imageMaterial(), text: 'both' }], { images: true }), /either text or an image/);
  const big = Buffer.concat([PNG, Buffer.alloc(IMAGE_LIMITS.bytesEach)]);
  assert.throws(() => sanitizeMaterials([imageMaterial('big.png', big)], { images: true }), /10 MB/);
  assert.throws(() => sanitizeMaterials(Array.from({ length: IMAGE_LIMITS.count + 1 }, (_, index) => imageMaterial(`${index}.png`)), { images: true }), /10 images/);
  const nine = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]);
  assert.throws(() => sanitizeMaterials(['a', 'b', 'c', 'd'].map((name) => imageMaterial(`${name}.png`, nine)), { images: true }), /30 MB/);
  assert.equal(sanitizeMaterials([{ name: 'a.txt', text: 'x' }], { images: true })[0].text, 'x');
});

test('attachments are recognised as images by name or type, and SVG stays text', () => {
  assert.equal(isImageAttachment({ name: 'scan.PNG', type: '' }), true);
  assert.equal(isImageAttachment({ name: 'photo', type: 'image/heic' }), true);
  assert.equal(isImageAttachment({ name: 'icon.svg', type: 'image/svg+xml' }), false);
  assert.equal(isImageAttachment({ name: 'notes.txt', type: 'text/plain' }), false);
});

function fileLike(name, bytes, type = '') {
  const blob = new Blob([bytes], { type });
  return Object.assign(blob, { name });
}
const sourceTask = (...names) => ({ id: 't', version: 1, attachments: names.map((name, index) => ({ id: `a${index}`, name, path: name, source: 'file', type: '' })) });
const services = (files, extra = {}) => ({
  connected: () => true,
  getFile: async (id) => files[id],
  extractText: async (file) => ({ status: 'available', text: `text of ${file.name}` }),
  ...extra,
});

test('a run on this PC sends images as image materials beside extracted text', async () => {
  let extracted = 0;
  const materials = await prepareTaskMaterials(sourceTask('scan.png', 'notes.txt'), services({ a0: fileLike('scan.png', PNG), a1: fileLike('notes.txt', 'n') }, {
    allowImages: true,
    extractText: async (file) => { extracted += 1; return { status: 'available', text: `text of ${file.name}` }; },
  }));
  assert.deepEqual(materials, [
    { name: 'scan.png', image: { mime: 'image/png', data: PNG.toString('base64') } },
    { name: 'notes.txt', text: 'text of notes.txt' },
  ]);
  assert.equal(extracted, 1, 'images are not run through text extraction');
});

test('images are refused for runs that do not go to Codex on this PC, and unsupported or large images are refused', async () => {
  await assert.rejects(() => prepareTaskMaterials(sourceTask('scan.png'), services({ a0: fileLike('scan.png', PNG) })), /이 PC의 Codex/);
  await assert.rejects(() => prepareTaskMaterials(sourceTask('a.bmp'), services({ a0: fileLike('a.bmp', BMP) }, { allowImages: true })), /PNG·JPEG·GIF·WebP/);
  let read = false;
  const huge = { name: 'huge.png', type: 'image/png', size: IMAGE_LIMITS.bytesEach + 1, async arrayBuffer() { read = true; return new ArrayBuffer(0); } };
  await assert.rejects(() => prepareTaskMaterials(sourceTask('huge.png'), services({ a0: huge }, { allowImages: true })), /10 MB/);
  assert.equal(read, false);
});

function spawnCapture(capture, { code = 0, result = { summary: 'done' } } = {}) {
  return (_command, args, options) => {
    const imageArgs = [];
    for (let index = 0; index < args.length; index += 1) if (args[index] === '-i') imageArgs.push(args[index + 1]);
    capture.push({ args, cwd: options.cwd, images: imageArgs.map((file) => ({ file, exists: existsSync(file), bytes: existsSync(file) ? readFileSync(file) : null })) });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let input = '';
    child.stdin.on('data', (chunk) => { input += chunk; });
    child.stdin.on('finish', () => {
      capture.at(-1).input = input;
      if (code === 0) child.stdout.write(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(result) } })}\n`);
      child.stdout.end();
      child.emit('close', code, null);
    });
    return child;
  };
}
const codexRunner = (capture, options = {}) => createCodexRunner({ spawnProcess: spawnCapture(capture, options), ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => [], now: () => 1000 });
const imageTask = { id: 'img', prompt: 'Describe the figure', attachments: [{ id: 'a', name: 'scan.png', path: 'scan.png', source: 'file' }] };

test('Codex receives each image with -i before its other options, from a folder outside the run directory', async () => {
  const capture = [];
  const material = sanitizeMaterials([imageMaterial()], { images: true });
  const result = await codexRunner(capture).run({ task: imageTask, materials: material });
  assert.equal(result.content, 'done');
  const [{ args, cwd, images, input }] = capture;
  assert.deepEqual(args.slice(0, 2), ['exec', '-i']);
  assert.equal(args.at(-1), '-');
  assert.equal(images.length, 1);
  assert.ok(images[0].exists, 'the image exists while Codex runs');
  assert.deepEqual(images[0].bytes, PNG);
  assert.equal(path.relative(cwd, images[0].file).startsWith('..') || path.isAbsolute(path.relative(cwd, images[0].file)), true, 'outside the run directory');
  assert.equal(existsSync(images[0].file), false, 'deleted after the run');
  assert.equal(existsSync(path.dirname(images[0].file)), false, 'its folder too');
  assert.match(input, /scan\.png/);
  assert.match(input, /image input 1/);
  assert.doesNotMatch(input, new RegExp(PNG.toString('base64').slice(0, 40).replace(/[+/]/g, '\\$&')), 'the prompt does not carry the bytes');
});

test('the image folder is deleted when Codex fails, and route conditions do not depend on image paths', async () => {
  const failed = [];
  await assert.rejects(() => codexRunner(failed, { code: 1 }).run({ task: imageTask, materials: sanitizeMaterials([imageMaterial()], { images: true }) }));
  assert.equal(existsSync(path.dirname(failed[0].images[0].file)), false);
  const capture = [];
  const withImage = await codexRunner(capture).run({ task: imageTask, materials: sanitizeMaterials([imageMaterial()], { images: true }) });
  const again = await codexRunner(capture).run({ task: imageTask, materials: sanitizeMaterials([imageMaterial()], { images: true }) });
  assert.notEqual(capture[0].images[0].file, capture[1].images[0].file);
  assert.equal(withImage.executionEvidence.routeConditions, again.executionEvidence.routeConditions);
});

test('a result that returns an attached image unchanged does not carry it back as an artifact', async () => {
  const capture = [];
  const result = await codexRunner(capture, { result: { summary: 'done', artifacts: [
    { name: 'copy.png', mime: 'image/png', content: PNG.toString('base64'), encoding: 'base64' },
    { name: 'notes.txt', mime: 'text/plain', content: 'findings' },
  ] } }).run({ task: imageTask, materials: sanitizeMaterials([imageMaterial()], { images: true }) });
  const names = result.artifacts.map((artifact) => artifact.name);
  assert.equal(names.includes('copy.png'), false);
  assert.equal(names.includes('notes.txt'), true);
});

test('the Claude Routine runner refuses image materials before sending anything', async () => {
  let sent = false;
  const runner = createClaudeRoutineRunner({ url: 'https://api.anthropic.com/v1/claude_code/routines/trig_test/fire', token: 'routine-token-for-tests', fetchFn: async () => { sent = true; return new Response('{}'); } });
  await assert.rejects(() => runner.run({ task: imageTask, materials: [{ name: 'scan.png', image: { mime: 'image/png', data: PNG.toString('base64') } }] }), /image/i);
  assert.equal(sent, false);
});

const token = 'local-test-token-0123456789012345';
async function desktopServer(t) {
  const forwarded = [], starts = [];
  const server = createDesktopServer({ token, publicDir: new URL('../public', import.meta.url), request: async (p, b) => { forwarded.push({ p, b }); return {}; }, bridge: { status: () => ({ busy: false }), startTask: async (id, b) => { starts.push({ id, b }); return { id, status: 'running' }; } } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/tasks/t/run`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { post, forwarded, starts };
}

test('the local connector accepts image-sized run requests for Codex and never forwards images toward the cloud', async (t) => {
  const f = await desktopServer(t);
  const photo = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024, 7)]);
  const accepted = await f.post({ provider: 'codex', expectedVersion: 1, materials: [imageMaterial('photo.png', photo)] });
  assert.equal(accepted.status, 202);
  assert.equal(f.starts[0].b.materials[0].image.data.length, photo.toString('base64').length);
  const refused = await f.post({ provider: 'claude', expectedVersion: 1, materials: [imageMaterial()] });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /Codex/);
  assert.equal(f.forwarded.length, 0);
  const text = await f.post({ provider: 'claude', expectedVersion: 1, materials: [{ name: 'a.txt', text: 'x'.repeat(800_000) }] });
  assert.equal(text.status, 413, 'text-only requests keep the earlier body limit');
});

test('the desktop bridge passes image materials to the runner and keeps them off cloud requests', async () => {
  const requests = [], writes = [];
  let supplied;
  const task = { id: 't', attachments: [{ name: 'scan.png', source: 'file' }] };
  const bridge = createDesktopBridge({ outbox: { read: () => null, write: (record) => writes.push(record), clear: () => {} }, request: async (p, b) => { requests.push({ p, b }); return p.endsWith('start') ? { claim: { task, executionId: 'e', generation: 1 } } : { task: { status: 'completed' } }; }, runner: { run: async (input) => { supplied = input.materials; return { content: 'Summary only' }; } } });
  await bridge.startTask('t', { expectedVersion: 1, materials: [imageMaterial()] });
  await bridge.settled();
  assert.equal(supplied[0].image.mime, 'image/png');
  assert.equal(JSON.stringify(requests).includes(PNG.toString('base64').slice(0, 24)), false);
  assert.deepEqual(requests[0].b.sourceNames, ['scan.png']);
  assert.equal(JSON.stringify(writes).includes(PNG.toString('base64').slice(0, 24)), false, 'nor in the local outbox');
});

test('a source task with images waits for Codex instead of starting on Claude', () => {
  const parent = { id: 'p', version: 2, status: 'waiting_children', delegation: { batchId: 'b', epoch: 1, state: 'waiting_children', children: [{ taskId: 'c', provider: 'claude' }] } };
  const child = { id: 'c', version: 1, status: 'queued', parentTaskId: 'p', batchId: 'b', parentEpoch: 1, assignment: { provider: 'claude' }, attachments: [{ id: 'a', name: 'scan.png', type: 'image/png', source: 'file' }] };
  const readiness = sourceExecutionReadiness(child, { tasks: [parent, child], capabilities: { sourceDelegationVersion: 1, claudeRoutine: true } }, () => true);
  assert.deepEqual(readiness, { ready: false, reason: 'images_need_codex' });
  assert.match(sourceExecutionMessage({ readiness: readiness, missing: [] }), /Codex/);
});

test('leftover image folders from a stopped connector are swept, and nothing else is touched', async () => {
  const { mkdtempSync, mkdirSync, utimesSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { sweepImageFolders } = await import('../server/runners.mjs');
  const root = mkdtempSync(path.join(tmpdir(), 'sweep-test-'));
  const old = path.join(root, 'inno-images-old'), fresh = path.join(root, 'inno-images-fresh'), other = path.join(root, 'keep-me');
  for (const folder of [old, fresh, other]) { mkdirSync(folder); writeFileSync(path.join(folder, 'image-01.png'), PNG); }
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(old, past, past);
  utimesSync(other, past, past);
  await sweepImageFolders({ root, olderThan: Date.now() - 60 * 60 * 1000 });
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true, 'a folder younger than the cut-off may belong to a running Codex');
  assert.equal(existsSync(other), true);
  await sweepImageFolders({ root, olderThan: Date.now() + 1000 });
  assert.equal(existsSync(fresh), false, 'at connector start every earlier folder is stale');
});

test('a result that carries an attached image as text is refused or dropped, not delivered', async () => {
  const data = Buffer.concat([PNG, Buffer.alloc(600, 9)]).toString('base64');
  const material = sanitizeMaterials([{ name: 'scan.png', image: { data } }], { images: true });
  await assert.rejects(() => codexRunner([], { result: { summary: `here it is: data:image/png;base64,${data}` } }).run({ task: imageTask, materials: material }), /attached image/);
  const result = await codexRunner([], { result: { summary: 'done', artifacts: [
    { name: 'page.html', mime: 'text/html', content: `<img src="data:image/png;base64,${data}">` },
    { name: 'notes.txt', mime: 'text/plain', content: 'findings' },
  ] } }).run({ task: imageTask, materials: material });
  const names = result.artifacts.map((artifact) => artifact.name);
  assert.equal(names.includes('page.html'), false);
  assert.equal(names.includes('notes.txt'), true);
});

test('an image run does not attach the INNO MCP tools', async () => {
  const capture = [];
  const runner = createCodexRunner({ spawnProcess: spawnCapture(capture), ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => [], now: () => 1000, mcpUrl: 'http://127.0.0.1:4101/mcp', mcpToken: 'token-value-for-image-test' });
  await runner.run({ task: imageTask, materials: sanitizeMaterials([imageMaterial()], { images: true }) });
  await runner.run({ task: { id: 'plain', prompt: 'Work' } });
  assert.equal(capture[0].args.some((arg) => String(arg).includes('mcp_servers')), false);
  assert.equal(capture[1].args.some((arg) => String(arg).includes('mcp_servers')), true, 'runs without images keep them');
});
