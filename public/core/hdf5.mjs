// HDF5 (.h5) structure summary for connected files, read in the browser with the vendored jsfive
// reader: each group and dataset with its type, shape and attributes, and the values of small
// datasets. Large datasets are described, never decoded. Traversal is bounded in depth, object
// count and output length, and hard-link cycles are listed once.

export const MAX_HDF5_BYTES = 256 * 1024 * 1024;
const MAX_OBJECTS = 5000;
const MAX_DEPTH = 32;
const MAX_PREVIEW_VALUES = 4096; // datasets up to this many values are read for a preview
const SHOWN_VALUES = 20;
const SHOWN_ATTRIBUTE_ITEMS = 10;
const MAX_STRING = 200;

export async function loadHdf5Library() {
  return import('../vendor/jsfive.mjs');
}

const isTyped = (value) => ArrayBuffer.isView(value) && !(value instanceof DataView);

function quoted(text) {
  return text.length > MAX_STRING ? `${JSON.stringify(text.slice(0, MAX_STRING)).slice(0, -1)}…"` : JSON.stringify(text);
}

function scalar(value, dtype) {
  if (typeof value === 'string') return quoted(value);
  if (typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    // Single and half precision values print with the digits they actually hold.
    return typeof dtype === 'string' && /f[24]$/.test(dtype) && Number.isFinite(value) ? String(Number(value.toPrecision(7))) : String(value);
  }
  if (value instanceof Uint8Array && value.length <= MAX_STRING) return quoted(new TextDecoder().decode(value).replace(/\0+$/, ''));
  try { return JSON.stringify(value)?.slice(0, MAX_STRING) ?? String(value); } catch { return String(value); }
}

function list(values, limit, dtype) {
  const items = Array.from(values.slice(0, limit), (value) => scalar(value, dtype));
  return values.length > limit ? `${items.join(', ')}, … ${values.length} values` : items.join(', ');
}

function attributeText(attrs) {
  const entries = Object.entries(attrs ?? {});
  if (!entries.length) return '';
  return ` attributes: ${entries.map(([key, value]) => {
    const shown = Array.isArray(value) || isTyped(value) ? `[${list(value, SHOWN_ATTRIBUTE_ITEMS)}]` : scalar(value);
    return `${key}=${shown}`;
  }).join(', ')}`;
}

function safeAttributes(object) {
  try { return attributeText(object.attrs); } catch (error) { return ` attributes: (not readable: ${error.message})`; }
}

function dtypeText(dtype) {
  if (typeof dtype === 'string') return dtype;
  try { return JSON.stringify(dtype).slice(0, 80); } catch { return 'unknown type'; }
}

function datasetLine(path, dataset) {
  let shape;
  try { shape = Array.from(dataset.shape ?? []); } catch { shape = []; }
  const dtype = (() => { try { return dataset.dtype; } catch { return undefined; } })();
  const count = shape.reduce((product, size) => product * Number(size), 1);
  const shapeText = shape.length ? `shape ${shape.join('×')}` : 'scalar';
  let description = `dataset ${dtypeText(dtype)}, ${shapeText}`;
  let values = '';
  // Chunked storage (often compressed) can expand far beyond its shape, so its values are not decoded.
  let chunked;
  try { chunked = dataset._dataobjects?.chunks != null; } catch { chunked = true; }
  if (count > MAX_PREVIEW_VALUES) {
    description += `; ${count} values not shown`;
  } else if (chunked) {
    description += '; chunked, values not shown';
  } else {
    try {
      const value = dataset.value;
      values = Array.isArray(value) || isTyped(value) ? list(value, SHOWN_VALUES, dtype) : scalar(value, dtype);
    } catch (error) {
      description += `; values not readable: ${error.message}`;
    }
  }
  return `${path} (${description})${values ? `: ${values}` : ''}${safeAttributes(dataset)}`;
}

const now = () => globalThis.performance?.now?.() ?? Date.now();

// timeLimitMs bounds the whole walk: attribute decoding has no size hint before it runs.
export function hdf5Structure(buffer, { hdf5, maxChars, name = 'file.h5', timeLimitMs = 3000 }) {
  const deadline = now() + timeLimitMs;
  const root = new hdf5.File(buffer, name);
  const lines = ['--- HDF5 structure ---'];
  let length = lines[0].length, objects = 0, truncated = false, stopped = false;
  const seen = new Set();
  const push = (line) => {
    if (stopped) return;
    if (length + 1 + line.length > maxChars) { truncated = true; stopped = true; return; }
    lines.push(line);
    length += 1 + line.length;
  };
  const address = (object) => object?._dataobjects?.offset;
  const visit = (group, path, depth) => {
    let keys = [...group.keys];
    if (keys.length > MAX_OBJECTS) keys = keys.slice(0, MAX_OBJECTS + 1);
    keys.sort();
    for (const key of keys) {
      if (stopped) return;
      if (objects >= MAX_OBJECTS) { push('… (more objects not shown)'); truncated = true; stopped = true; return; }
      if (now() > deadline) { push('… (time limit reached; more objects not shown)'); truncated = true; stopped = true; return; }
      objects += 1;
      const childPath = `${path === '/' ? '' : path}/${key}`;
      let child;
      try { child = group.get(key); } catch (error) { push(`${childPath} (not readable: ${error.message})`); continue; }
      if (child instanceof hdf5.Dataset) { push(datasetLine(childPath, child)); continue; }
      if (!(child instanceof hdf5.Group)) { push(`${childPath} (link not followed)`); continue; }
      if (address(child) !== undefined && seen.has(address(child))) { push(`${childPath} (group, already listed above)`); continue; }
      if (address(child) !== undefined) seen.add(address(child));
      push(`${childPath} (group)${safeAttributes(child)}`);
      if (depth + 1 >= MAX_DEPTH) { push(`${childPath}/… (deeper levels not shown)`); truncated = true; continue; }
      visit(child, childPath, depth + 1);
    }
  };
  if (address(root) !== undefined) seen.add(address(root));
  push(`/ (group)${safeAttributes(root)}`);
  visit(root, '/', 0);
  return { text: lines.join('\n'), truncated };
}
