import { observedExecutions } from './execution-usage.mjs';

// CR-007 S4 (PLG-04): evidence for each registered plugin from normal work. Runs that received
// this version of the plugin (same content hash) are compared with runs that received no plugin
// on the same task type and provider, over the last 90 days. Only rows recorded with the task
// type they ran under count; rows written before that record existed also lack their failure
// kind, so on either side they would keep completions and lose failures. Only work outcomes count: a
// completion, or a failure of the run itself (output limit or an unknown stop); runs that
// never started or lost their connection (quota, sign-in, connection, restart, ...) and
// failures recorded without a kind are left out. With fewer than five runs from five tasks on
// either side nothing is judged (MOD-06). A plugin is flagged only when its runs end
// unfinished far more often and a one-sided exact test says chance alone is unlikely, or when
// it has not been used for a long time. No gain is claimed, and nothing is removed
// automatically: the person decides, and removal keeps this evidence.
export const PLUGIN_EVIDENCE = Object.freeze({ windowDays: 90, minRuns: 5, minTasks: 5, unusedDays: 30, worseMargin: 0.3, worseP: 0.05 });
const DAY = 86_400_000;
const WORK_FAILURES = new Set(['resource', 'unknown']);

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const tokens = (row) => (Number.isSafeInteger(row.inputTokens) || Number.isSafeInteger(row.outputTokens) ? (row.inputTokens ?? 0) + (row.outputTokens ?? 0) : null);
function summary(rows) {
  const completed = rows.filter((row) => row.transition === 'completion').length;
  return { runs: rows.length, tasks: new Set(rows.map((row) => row.taskId)).size, completed, failed: rows.length - completed, medianWallMs: median(rows.map((row) => row.wallElapsedMs)), medianTokens: median(rows.map(tokens)) };
}
const percent = (part, whole) => Math.round((part / whole) * 100);

// One-sided Fisher exact test: the chance of at least `failed` unfinished runs among `runs`
// when both sides share one unfinished rate.
const logChoose = (n, k) => { let total = 0; for (let i = 1; i <= k; i += 1) total += Math.log((n - k + i) / i); return total; };
export function exactWorseP(failed, runs, otherFailed, otherRuns) {
  const all = runs + otherRuns, failures = failed + otherFailed, denominator = logChoose(all, runs);
  let p = 0;
  for (let x = failed; x <= Math.min(runs, failures); x += 1) p += Math.exp(logChoose(failures, x) + logChoose(all - failures, runs - x) - denominator);
  return Math.min(1, p);
}

export function pluginEvidence({ plugins = [], tasks = [], now = Date.now() } = {}) {
  const since = now - PLUGIN_EVIDENCE.windowDays * DAY;
  const recent = observedExecutions(tasks).filter((row) => typeof row.taskType === 'string' && Date.parse(row.completedAt) >= since);
  const counted = (row) => row.transition === 'completion' || (row.transition === 'failure' && WORK_FAILURES.has(row.failureKind));
  const ended = (row) => row.transition === 'completion' || row.transition === 'failure';
  const stratum = (row) => JSON.stringify([row.taskType, row.provider]);
  return plugins.map((plugin) => {
    const receivedThis = (row) => row.plugins?.some((entry) => entry.id === plugin.id && entry.contentHash === plugin.contentHash);
    const delivered = recent.filter(receivedThis);
    const applied = delivered.filter(counted);
    const strata = new Set(applied.map(stratum));
    const baseline = recent.filter((row) => counted(row) && !row.plugins?.length && strata.has(stratum(row)));
    const own = summary(applied), other = summary(baseline);
    const excluded = delivered.filter(ended).length - applied.length;
    let verdict, text;
    const approvedLong = Date.parse(plugin.approval?.approvedAt ?? plugin.approvedAt) <= now - PLUGIN_EVIDENCE.unusedDays * DAY;
    const enough = (side) => side.runs >= PLUGIN_EVIDENCE.minRuns && side.tasks >= PLUGIN_EVIDENCE.minTasks;
    if (!delivered.length && plugin.status === 'approved' && approvedLong) {
      verdict = 'unused';
      text = `최근 ${PLUGIN_EVIDENCE.windowDays}일 동안 적용되지 않았습니다. 필요 없으면 삭제를 검토하세요.`;
    } else if (!enough(own) || !enough(other)) {
      verdict = 'insufficient';
      text = `근거 부족: 적용 ${own.runs}회(작업 ${own.tasks}개), 같은 작업 종류·실행기의 비교 실행 ${other.runs}회(작업 ${other.tasks}개). 각각 ${PLUGIN_EVIDENCE.minTasks}개 작업·${PLUGIN_EVIDENCE.minRuns}회 이상이어야 효과를 판단합니다.`;
    } else if (own.failed / own.runs - other.failed / other.runs >= PLUGIN_EVIDENCE.worseMargin && exactWorseP(own.failed, own.runs, other.failed, other.runs) <= PLUGIN_EVIDENCE.worseP) {
      verdict = 'worse';
      text = `적용한 실행의 미완료 비율(${percent(own.failed, own.runs)}%)이 같은 작업 종류·실행기의 비교 실행(${percent(other.failed, other.runs)}%)보다 크게 높고, 우연으로 보기 어렵습니다. 새 작업에서 빼거나 삭제를 검토하세요.`;
    } else {
      verdict = 'no_clear_difference';
      text = `적용 ${own.runs}회와 비교 ${other.runs}회에서 뚜렷한 차이가 확인되지 않았습니다(완료 ${percent(own.completed, own.runs)}% · ${percent(other.completed, other.runs)}%).`;
    }
    return { id: plugin.id, name: plugin.name ?? plugin.id, contentHash: plugin.contentHash ?? null, ...own, excluded, baseline: other, verdict, text };
  });
}
