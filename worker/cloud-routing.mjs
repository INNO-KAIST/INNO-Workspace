import {autoSwitchDue} from '../public/core/cloud-routing.mjs';
import {providerEnabled} from '../public/core/provider-settings.mjs';
import {providersByTransport} from '../public/core/providers.mjs';
import {ConflictError} from '../public/core/tasks.mjs';

// CR-010: on each scheduled run, auto tasks that waited past their time on the PC without
// starting move once to the cloud Routine and are dispatched. The move is a version-checked
// write, so a desktop claim at the same moment wins and the task stays on the PC. Nothing
// moves while the cloud provider is off or not configured.
export async function moveWaitingAutoTasks({store, adapterFor, dispatch, limit = 10}) {
  const now = store.now();
  const rows = (await store.db.prepare("SELECT body FROM tasks WHERE json_extract(body,'$.status')='queued' AND json_extract(body,'$.checkpoint.routing.mode')='auto' AND json_extract(body,'$.checkpoint.routing.switchedAt') IS NULL AND json_extract(body,'$.checkpoint.routing.switchAfter') <= ?1 AND COALESCE(json_array_length(body,'$.attachments'),0)=0 AND json_extract(body,'$.parentTaskId') IS NULL ORDER BY updated_at ASC LIMIT ?2").bind(now, limit).all()).results ?? [];
  if (!rows.length) return {moved: 0};
  const cloudId = providersByTransport('routine_fire')[0];
  if (!adapterFor(cloudId)?.configured || !providerEnabled(await store.providerSettings(), cloudId)) return {moved: 0};
  let moved = 0;
  for (const row of rows) {
    const task = JSON.parse(row.body);
    if (!autoSwitchDue(task, Date.parse(now))) continue;
    try {
      await store.replaceTask(task.id, task.version, current => {
        if (!autoSwitchDue(current, Date.parse(store.now()))) throw new ConflictError('Auto routing changed', current.version);
        const at = store.now();
        return {...current, version: current.version + 1, updatedAt: at, checkpoint: {...current.checkpoint, provider: cloudId, routing: {...current.checkpoint.routing, provider: cloudId, reason: 'desktop_waited', switchedAt: at}}};
      });
    } catch (error) {
      if (error instanceof ConflictError) continue;
      throw error;
    }
    moved += 1;
    // A dispatch that fails here is retried by the scheduled drain (switched tasks are drained).
    await dispatch(task.id).catch(() => null);
  }
  return {moved};
}
