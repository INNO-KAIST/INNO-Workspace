import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractConnectedText } from '../public/core/extract.mjs';
import { hdf5Structure } from '../public/core/hdf5.mjs';

// CR-009 stage 2: HDF5 (.h5) files are summarized in the browser with the vendored jsfive
// reader: every group and dataset with its type, shape and attributes, and the values of
// small datasets. Large datasets are never decoded; traversal is bounded.
function namedBlob(name, bytes, type = '') {
  const blob = new Blob([bytes], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}
const sample = readFileSync(new URL('./fixtures/jsfive-test.h5', import.meta.url)); // jsfive's public-domain test file

test('a real HDF5 file is summarized with types, shapes and small values', async () => {
  const result = await extractConnectedText(namedBlob('measurement.h5', sample, 'application/x-hdf5'));
  assert.equal(result.status, 'available', result.reason);
  assert.match(result.text, /^--- HDF5 structure ---\n/);
  assert.match(result.text, /^\/f8 \(dataset <f8, shape 3\): 3, 4, 5$/m);
  assert.match(result.text, /^\/i1 \(dataset <i1, shape 3\): 3, 4, 5$/m);
  assert.match(result.text, /^\/string \(dataset S5, scalar\): "hello"$/m);
  assert.match(result.text, /^\/vlen_string \(dataset .*scalar\): "hello"$/m);
  assert.equal((await extractConnectedText(namedBlob('model.hdf5', sample))).text, result.text);
});

// A small stand-in for the jsfive object model, for shapes a 10 KB fixture cannot hold.
class Group {
  constructor(address, attrs = {}, children = {}) { Object.assign(this, { _dataobjects: { offset: address }, attrs, children }); }
  get keys() { return Object.keys(this.children); }
  get(key) { return this.children[key]; }
}
class Dataset {
  constructor(address, shape, dtype, attrs = {}, values = null) { Object.assign(this, { _dataobjects: { offset: address }, shape, dtype, attrs, values, reads: 0 }); }
  get value() { this.reads += 1; if (!this.values) throw new Error('large dataset must not be read'); return this.values; }
}
const library = (root) => ({ Group, Dataset, File: class { constructor() { return root; } } });

test('groups and attributes are listed, and large datasets are described without reading them', () => {
  const big = new Dataset(30, [2048, 2048], '<f4', { units: 'counts' });
  const root = new Group(1, { title: '측정 1', version: 3 }, {
    entry: new Group(10, { scan: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, {
      image: big,
      wavelength: new Dataset(31, [4], '<f8', {}, [400, 450.5, 500, 550]),
      long_name: new Dataset(32, [], 'S300', {}, 'x'.repeat(300)),
    }),
  });
  const text = hdf5Structure(new ArrayBuffer(8), { hdf5: library(root), maxChars: 200_000 }).text;
  assert.equal(text, [
    '--- HDF5 structure ---',
    '/ (group) attributes: title="측정 1", version=3',
    '/entry (group) attributes: scan=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, … 12 values]',
    `/entry/image (dataset <f4, shape 2048×2048; 4194304 values not shown) attributes: units="counts"`,
    `/entry/long_name (dataset S300, scalar): "${'x'.repeat(200)}…"`,
    '/entry/wavelength (dataset <f8, shape 4): 400, 450.5, 500, 550',
  ].join('\n'));
  assert.equal(big.reads, 0);
});

test('linked cycles, deep nesting and huge object counts stop with a note instead of hanging', () => {
  const loop = new Group(1);
  loop.children = { again: loop, child: new Group(2, {}, { back: loop }) };
  const cyclic = hdf5Structure(new ArrayBuffer(8), { hdf5: library(loop), maxChars: 200_000 });
  assert.match(cyclic.text, /^\/again \(group, already listed above\)$/m);
  assert.match(cyclic.text, /^\/child\/back \(group, already listed above\)$/m);

  let deep = new Group(1000);
  const top = deep;
  for (let level = 0; level < 100; level += 1) { const next = new Group(1001 + level); deep.children = { d: next }; deep = next; }
  const nested = hdf5Structure(new ArrayBuffer(8), { hdf5: library(top), maxChars: 200_000 });
  assert.match(nested.text, /deeper levels not shown/);
  assert.equal(nested.truncated, true);

  const wide = new Group(1, {}, Object.fromEntries(Array.from({ length: 6000 }, (_, index) => [`n${String(index).padStart(4, '0')}`, new Dataset(10 + index, [1], '<i4', {}, [index])])));
  const many = hdf5Structure(new ArrayBuffer(8), { hdf5: library(wide), maxChars: 10_000_000 });
  assert.match(many.text, /more objects not shown/);
  assert.equal(many.truncated, true);
});

test('a damaged or oversized HDF5 file is refused with a reason, without reading an oversized one', async () => {
  const damaged = await extractConnectedText(namedBlob('broken.h5', new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])));
  assert.equal(damaged.status, 'unavailable');
  assert.match(damaged.reason, /HDF5/);
  let read = false;
  const huge = { name: 'huge.h5', type: '', size: 257 * 1024 * 1024, async arrayBuffer() { read = true; return new ArrayBuffer(0); }, slice() { read = true; return new Blob([]); } };
  const result = await extractConnectedText(huge);
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /256 MiB/);
  assert.equal(read, false);
});

test('chunked datasets are described without decoding, and the walk stops at its time limit', () => {
  const chunked = new Dataset(40, [1], '<f8', {});
  chunked._dataobjects.chunks = [100_000_000];
  const text = hdf5Structure(new ArrayBuffer(8), { hdf5: library(new Group(1, {}, { tiny: chunked })), maxChars: 200_000 }).text;
  assert.match(text, /^\/tiny \(dataset <f8, shape 1; chunked, values not shown\)$/m);
  assert.equal(chunked.reads, 0);
  const slow = new Group(1, {}, Object.fromEntries(Array.from({ length: 50 }, (_, index) => {
    const group = new Group(100 + index);
    Object.defineProperty(group, 'attrs', { get() { const until = Date.now() + 20; while (Date.now() < until); return {}; } });
    return [`g${String(index).padStart(2, '0')}`, group];
  })));
  const limited = hdf5Structure(new ArrayBuffer(8), { hdf5: library(slow), maxChars: 200_000, timeLimitMs: 200 });
  assert.match(limited.text, /time limit/);
  assert.equal(limited.truncated, true);
});
