import {ConflictError, ValidationError} from '../public/core/tasks.mjs';
import {pluginEvidence} from '../public/core/plugin-evidence.mjs';
import {PLUGIN_CATALOG_MAX, PLUGIN_EXECUTION_BYTES, PLUGIN_LIMITS, approvePlugin, boundedPluginDelivery, buildPluginRecord, disablePlugin, pluginContentHash, pluginSource, validatePluginRecord, validatePluginSelection} from '../public/core/plugins.mjs';

// Selections can change only while no execution owns the task.
const SELECTABLE = new Set(['ready', 'paused', 'failed', 'completed', 'waiting_user', 'waiting_connection', 'waiting_quota']);

// CR-007 S3 plugin registry (cloud workspace). Every change is an explicit user
// request: import from an allowed catalog at a pinned commit, approve the
// reviewed hash, disable, or remove with confirmation. Records and their text
// live in metadata rows; no schema change.
const MAX_PLUGINS = 32;
const ID = /^(anthropics|openai)\/[a-z0-9][a-z0-9-]{0,63}$/;
const AGENT = 'INNO-Workspace-plugin-registry';
const recordKey = id => 'plugin:' + id, contentKey = id => 'plugin_content:' + id;
const httpError = (message, statusCode) => Object.assign(new Error(message), {statusCode});
// git blob SHA-1 ("blob <size>\0<bytes>"), as GitHub lists for each file.
async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`), data = new Uint8Array(header.byteLength + bytes.byteLength);
  data.set(header); data.set(bytes, header.byteLength);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', data)), byte => byte.toString(16).padStart(2, '0')).join('');
}
// File names the registry accepts inside a skill folder (also used by catalog discovery).
export const PLUGIN_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ENTRY = PLUGIN_FILE_NAME;

export function createPluginRegistry(store, {fetchFn}) {
  const db = store.db;
  const read = async key => {
    const row = await db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first();
    return row ? JSON.parse(row.value) : null;
  };
  const upsert = (key, value) => db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, JSON.stringify(value));
  async function requireRecord(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw new ValidationError('plugin id is invalid');
    const record = await read(recordKey(id));
    if (!record) throw httpError('plugin not found', 404);
    return validatePluginRecord(record);
  }
  async function fetchOk(url, init) {
    let response;
    try { response = await fetchFn(url, init); } catch { throw httpError('plugin source is unavailable', 502); }
    if (!response.ok) throw httpError('plugin source is unavailable', 502);
    return response;
  }
  // GitHub serves objects across a fork network, so a commit must be on the
  // catalog's own default branch before its content can carry that repository's name.
  async function requireCatalogCommit(origin) {
    let response;
    try { response = await fetchFn(`https://api.github.com/repos/${origin.repository}/compare/${origin.commit}...HEAD`, {headers: {accept: 'application/vnd.github+json', 'user-agent': AGENT}}); }
    catch { throw httpError('plugin source is unavailable', 502); }
    if (response.status === 404 || response.status === 422) throw new ValidationError('plugin source is invalid');
    if (!response.ok) throw httpError('plugin source is unavailable', 502);
    const comparison = await response.json().catch(() => null);
    if (!['ahead', 'identical'].includes(comparison?.status)) throw new ValidationError('plugin source is invalid');
  }
  // The folder listing is checked before any file is downloaded: only top-level
  // SKILL.md and .md/.txt references, within the size limit. Each download must
  // match its listed size and git blob SHA-1 and be valid UTF-8.
  async function fetchFiles(origin) {
    await requireCatalogCommit(origin);
    const listing = await fetchOk(`https://api.github.com/repos/${origin.repository}/contents/${origin.path}?ref=${origin.commit}`, {headers: {accept: 'application/vnd.github+json', 'user-agent': AGENT}});
    const entries = await listing.json().catch(() => null);
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > PLUGIN_LIMITS.files) throw new ValidationError('plugin files is invalid');
    let total = 0;
    for (const entry of entries) {
      if (entry?.type !== 'file' || typeof entry.name !== 'string' || !ENTRY.test(entry.name) || (entry.name !== 'SKILL.md' && !/\.(md|txt)$/.test(entry.name))
        || entry.path !== `${origin.path}/${entry.name}` || !Number.isSafeInteger(entry.size) || entry.size < 0
        || typeof entry.sha !== 'string' || !/^[0-9a-f]{40}$/.test(entry.sha)) throw new ValidationError('plugin files is invalid');
      total += entry.size;
    }
    if (total > PLUGIN_LIMITS.bytes) throw new ValidationError('plugin size is invalid');
    return Promise.all(entries.map(async entry => {
      const response = await fetchOk(`https://raw.githubusercontent.com/${origin.repository}/${origin.commit}/${origin.path}/${encodeURIComponent(entry.name)}`, {headers: {'user-agent': AGENT}});
      let body;
      try { body = new Uint8Array(await response.arrayBuffer()); } catch { throw httpError('plugin source is unavailable', 502); }
      if (body.byteLength !== entry.size || await gitBlobSha(body) !== entry.sha) throw new ValidationError('plugin files is invalid');
      try { return {path: entry.name, text: new TextDecoder('utf-8', {fatal: true}).decode(body)}; }
      catch { throw new ValidationError('plugin files is invalid'); }
    }));
  }
  async function verifiedContent(record) {
    const content = await read(contentKey(record.id));
    if (!content || content.contentHash !== record.contentHash || !Array.isArray(content.files)
      || !content.files.every(file => file && Object.keys(file).length === 2 && typeof file.path === 'string' && typeof file.text === 'string')
      || new Set(content.files.map(file => file.path)).size !== content.files.length) return null;
    return (await pluginContentHash(content.files)).contentHash === record.contentHash ? content.files : null;
  }
  // Compare-and-swap on the record read: a concurrent import or approval makes this
  // write a conflict instead of silently pairing an approval with unreviewed text.
  async function write(record, previous) {
    const result = await db.prepare("UPDATE metadata SET value=?1 WHERE key=?2 AND json_extract(value,'$.updatedAt')=?3 AND json_extract(value,'$.contentHash')=?4 AND json_extract(value,'$.status')=?5")
      .bind(JSON.stringify(record), recordKey(record.id), previous.updatedAt, previous.contentHash, previous.status).run();
    if (Number(result?.meta?.changes ?? 0) !== 1) throw new ConflictError('The plugin changed concurrently; reload and try again.');
    return record;
  }

  return {
    async list() {
      const rows = (await db.prepare("SELECT value FROM metadata WHERE key GLOB 'plugin:*' ORDER BY key").all()).results;
      return rows.map(row => validatePluginRecord(JSON.parse(row.value)));
    },
    async import(input) {
      const origin = pluginSource(input ?? {});
      const files = await fetchFiles(origin);
      const record = await buildPluginRecord({source: {catalog: origin.catalog, path: origin.path, commit: origin.commit}, files, now: store.now()});
      const existing = await read(recordKey(record.id));
      // Identical content keeps its review state and approval, and repairs an altered stored copy.
      if (existing?.contentHash === record.contentHash) {
        if (!(await verifiedContent(existing))) {
          const repaired = existing.status === 'disabled' && existing.disabledReason === 'hash_mismatch'
            ? {...existing, status: 'review', approval: null, disabledReason: null, updatedAt: store.now()} : existing;
          await db.batch([upsert(recordKey(record.id), validatePluginRecord(repaired)), upsert(contentKey(record.id), {contentHash: record.contentHash, files})]);
          return {plugin: repaired};
        }
        return {plugin: validatePluginRecord(existing)};
      }
      if (!existing && Number((await db.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key GLOB 'plugin:*'").first()).n) >= MAX_PLUGINS)
        throw new ConflictError('The plugin registry is full; remove a plugin first.');
      await db.batch([upsert(recordKey(record.id), record), upsert(contentKey(record.id), {contentHash: record.contentHash, files})]);
      return {plugin: record};
    },
    async approve(input) {
      const {id, contentHash} = input ?? {};
      const record = await requireRecord(id);
      if (!(await verifiedContent(record))) {
        await write(disablePlugin(record, {reason: 'hash_mismatch', now: store.now()}), record);
        throw new ConflictError('The stored plugin text no longer matches its reviewed hash; it was disabled.');
      }
      return {plugin: await write(approvePlugin(record, {contentHash, now: store.now()}), record)};
    },
    async disable(input) {
      const record = await requireRecord((input ?? {}).id);
      return {plugin: await write(disablePlugin(record, {reason: 'user', now: store.now()}), record)};
    },
    async select(taskId, input) {
      const {expectedVersion, plugins} = input ?? {};
      const selection = validatePluginSelection(plugins);
      for (const item of selection) {
        const record = await read(recordKey(item.id));
        if (!record || validatePluginRecord(record).status !== 'approved') throw new ValidationError('Only approved plugins can be selected.');
      }
      return {task: await store.replaceTask(taskId, expectedVersion, current => {
        if (current.parentTaskId) throw new ValidationError('Child plugins are assigned by the delegation coordinator');
        if (!SELECTABLE.has(current.status)) throw new ConflictError('Plugins cannot change while the task is queued or running.', current.version);
        return {...current, plugins: selection, version: current.version + 1, updatedAt: store.now()};
      })};
    },
    // At dispatch: offer the verified text of still-approved selections; record the rest.
    // A stored problem (corrupt record, invalid selection) skips the plugin; it never fails the execution.
    async resolve(task) {
      const offered = [], skipped = [];
      let selection = [], used = 0;
      try { selection = validatePluginSelection(task?.plugins ?? []); } catch { selection = []; }
      for (const item of selection) {
        let record = null;
        try { const stored = await read(recordKey(item.id)); record = stored ? validatePluginRecord(stored) : null; } catch { record = null; }
        if (!record) { skipped.push({id: item.id, reason: 'missing'}); continue; }
        if (record.status !== 'approved') { skipped.push({id: item.id, reason: 'not_approved'}); continue; }
        const files = await verifiedContent(record).catch(() => null);
        if (!files) { await write(disablePlugin(record, {reason: 'hash_mismatch', now: store.now()}), record).catch(() => {}); skipped.push({id: item.id, reason: 'hash_mismatch'}); continue; }
        const ordered = [...files].sort((a, b) => a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path < b.path ? -1 : 1);
        const text = ordered.map(file => file.path === 'SKILL.md' ? file.text : `--- ${file.path} ---\n${file.text}`).join('\n'), size = new TextEncoder().encode(text).byteLength;
        if (used + size > PLUGIN_EXECUTION_BYTES) { skipped.push({id: item.id, reason: 'size_limit'}); continue; }
        used += size;
        offered.push({id: record.id, name: record.name, source: {repository: record.source.repository, path: record.source.path, commit: record.source.commit}, contentHash: record.contentHash, reason: item.reason, text});
      }
      return {offered, skipped};
    },
    // What a master may assign to children: approved plugins' ids, names and descriptions.
    async approvedCatalog() {
      const rows = (await db.prepare("SELECT value FROM metadata WHERE key GLOB 'plugin:*' ORDER BY key").all()).results;
      const approved = [];
      for (const row of rows) {
        try { const record = validatePluginRecord(JSON.parse(row.value)); if (record.status === 'approved') approved.push({id: record.id, name: record.name, description: record.description}); } catch { /* skip an unreadable record */ }
      }
      return approved.slice(0, PLUGIN_CATALOG_MAX);
    },
    async requireApproved(selection) {
      for (const item of selection) {
        let approved = false;
        try { const stored = await read(recordKey(item.id)); approved = !!stored && validatePluginRecord(stored).status === 'approved'; } catch { approved = false; }
        if (!approved) throw new ValidationError('Assigned plugins must be approved.');
      }
    },
    // A desktop's report counts only plugin versions that exist in the registry;
    // otherwise the record is dropped and the result itself is kept.
    async verifyReport(report) {
      let delivery;
      try { delivery = boundedPluginDelivery(report); } catch { return null; }
      if (!delivery) return null;
      for (const item of delivery.applied) {
        const stored = await read(recordKey(item.id)).catch(() => null);
        if (stored?.contentHash !== item.contentHash) return null;
      }
      return delivery;
    },
    // Removal keeps the plugin's evidence (PLG-04): the newest 50 removals stay in plugin_archive.
    // The archive is written only over the value just read and only while the reviewed version
    // is still registered; the record and its text go only when that write happened, so two
    // removals at once both keep their evidence and a re-imported version is not removed.
    async remove(input) {
      const {id, confirm} = input ?? {};
      const record = await requireRecord(id);
      if (confirm !== true) throw new ValidationError('Confirm the plugin removal.');
      const now = store.now();
      const [evidence] = pluginEvidence({plugins: [record], tasks: await store.listTasks(), now: Date.parse(now)});
      const entry = {id: record.id, name: record.name, contentHash: record.contentHash, source: record.source, status: record.status, removedAt: now, evidence};
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const before = (await db.prepare("SELECT value FROM metadata WHERE key='plugin_archive'").first())?.value ?? null;
        let kept;
        try { kept = JSON.parse(before ?? '[]'); } catch { kept = []; }
        const next = JSON.stringify([entry, ...(Array.isArray(kept) ? kept : [])].slice(0, 50));
        const [, removed] = await db.batch([
          db.prepare("INSERT INTO metadata(key,value) SELECT 'plugin_archive',?1 WHERE EXISTS (SELECT 1 FROM metadata WHERE key=?2 AND CASE WHEN json_valid(value) THEN json_extract(value,'$.contentHash') END=?3) AND (SELECT value FROM metadata WHERE key='plugin_archive') IS ?4 ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(next, recordKey(record.id), record.contentHash, before),
          db.prepare("DELETE FROM metadata WHERE key=?1 AND (SELECT value FROM metadata WHERE key='plugin_archive')=?2").bind(recordKey(record.id), next),
          db.prepare('DELETE FROM metadata WHERE key=?1 AND NOT EXISTS (SELECT 1 FROM metadata WHERE key=?2)').bind(contentKey(record.id), recordKey(record.id)),
        ]);
        if (removed.meta.changes) return {removed: record.id};
        const current = await read(recordKey(record.id)).catch(() => null);
        if (!current) throw httpError('plugin not found', 404);
        if (current.contentHash !== record.contentHash) throw new ConflictError('The plugin changed; review it again before removing it.');
      }
      throw new ConflictError('The plugin archive changed during removal; try again.');
    },
    async archive() {
      const value = await read('plugin_archive').catch(() => null);
      return Array.isArray(value) ? value.slice(0, 50) : [];
    },
  };
}
