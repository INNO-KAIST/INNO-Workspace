import { formatShortDateTime } from './time-format.mjs';

// PRV-05: keeping the Claude Routine's master model current on evidence. INNO has no right to
// change the Routine, so it compares the recorded Routine model with the official Claude Code
// model documentation (candidate evidence only, MOD-01) and recent Claude runs, and recommends:
// keep it, or move to a newer documented model of the same family. Other families are listed but
// not recommended: there is no quality or availability evidence for them here (MOD-03/04), and
// names or release dates alone do not rank models. A person's change request is recorded; a
// Claude Code session confirms it, changes the Routine (RemoteTrigger) and records the result.

// The vendor key of the Claude Routine adapter and of its official documentation source.
export const ROUTINE_PROVIDER = 'claude';
const DAY = 86_400_000;
const RUN_WINDOW = 30 * DAY;
const ALIAS = /^[a-z][a-z0-9-]{1,39}$/;
const NOT_MODELS = new Set(['default', 'best', 'opusplan']);

// A versioned model ID, optionally dated: "claude-opus-5-5", "claude-opus-5-5-20261101".
function parseModelId(value) {
  const match = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(String(value ?? ''));
  return match ? { family: match[1], version: [Number(match[2]), Number(match[3] ?? 0)], minorKnown: match[3] !== undefined } : null;
}
// A documented target label: "Opus 5.5", "Claude Opus 5.6", "Opus 6" (minor unknown).
function parseLabel(value) {
  const match = /^(?:Claude\s+)?([A-Za-z]+)\s+(\d{1,2})(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
  return match ? { family: match[1].toLowerCase(), version: [Number(match[2]), Number(match[3] ?? 0)], minorKnown: match[3] !== undefined } : null;
}
const compare = (left, right) => (left[0] - right[0]) || (left[1] - right[1]);
const modelId = (parsed) => `claude-${parsed.family}-${parsed.version[0]}${parsed.minorKnown ? `-${parsed.version[1]}` : ''}`;
const labelOf = (parsed) => `${parsed.family[0].toUpperCase()}${parsed.family.slice(1)} ${parsed.version[0]}${parsed.minorKnown ? `.${parsed.version[1]}` : ''}`;

export function sanitizeRoutineModelRecord(input, now) {
  const parsed = parseModelId(input?.model);
  if (!parsed) throw new TypeError('A versioned Claude model ID such as claude-opus-5-5 is required');
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 60) : labelOf(parsed);
  // The source is what the caller declares (any holder of the Worker token), not a proof.
  return { model: input.model, label, source: 'claude_code_session', recordedAt: now };
}

export const isRoutineAlias = (value) => ALIAS.test(String(value ?? '')) && !NOT_MODELS.has(value);

// Whether a recorded model is the one a request asked for: the alias is its family and, when
// the documentation named a version, the same version.
export function recordMatchesRequest(record, request) {
  const parsed = parseModelId(record?.model);
  if (!parsed || parsed.family !== request?.alias) return false;
  const target = parseLabel(request.target);
  if (!target) return true;
  return target.family === parsed.family && target.version[0] === parsed.version[0] && (!target.minorKnown || target.version[1] === parsed.version[1]);
}

// Recent Claude runs, to report alongside (never as model-quality evidence).
function runSummary(tasks, now) {
  const since = now - RUN_WINDOW;
  let completed = 0, failed = 0, connection = 0;
  for (const task of tasks ?? []) {
    if (task?.checkpoint?.provider !== ROUTINE_PROVIDER) continue;
    const at = Date.parse(task.checkpoint.completedAt ?? task.checkpoint.failure?.occurredAt ?? task.updatedAt);
    if (!(at >= since)) continue;
    if (task.status === 'completed') completed += 1;
    else if (['failed', 'waiting_connection', 'waiting_quota'].includes(task.status)) {
      failed += 1;
      if (['authentication', 'quota', 'unavailable'].includes(task.checkpoint.failure?.kind)) connection += 1;
    }
  }
  return { counts: { completed, failed, since }, connection };
}

export function routineModelRecommendation({ record, discovery, tasks = [], now = Date.now() } = {}) {
  const reasons = [];
  const { counts, connection } = runSummary(tasks, now);
  const source = discovery?.sources?.find((entry) => entry.provider === ROUTINE_PROVIDER);
  const fresh = source?.status === 'fresh';
  const candidates = (discovery?.candidates ?? []).filter((candidate) => candidate.provider === ROUTINE_PROVIDER && isRoutineAlias(candidate.id));
  if (counts.failed >= 3 && counts.failed > counts.completed) {
    reasons.push(`최근 30일 Claude 실행 ${counts.completed + counts.failed}건 중 ${counts.failed}건이 끝나지 못했습니다${connection ? `(연결·한도 문제 ${connection}건)` : ''}. 모델보다 연결·한도 상태를 먼저 확인하세요.`);
  }
  if (!record) {
    reasons.unshift('현재 Routine 모델 기록이 없습니다. Claude Code 세션에서 Routine 설정을 확인해 기록하면 비교를 시작합니다.');
    return { status: 'unknown', reasons, options: [], runs: counts };
  }
  // The family and version come from the model ID only, never from a free-text label.
  const current = parseModelId(record.model);
  if (!current) {
    reasons.unshift(`현재 기록(${record.model})을 해석할 수 없어 비교하지 않습니다. 버전이 있는 모델 ID로 다시 기록하세요.`);
    return { status: 'unknown', reasons, options: [], runs: counts };
  }
  if (!fresh) reasons.push(`공식 문서 확인이 오래되었거나 실패해 새 후보를 판단하지 않습니다${source?.verifiedAt ? ` (마지막 확인 ${formatShortDateTime(source.verifiedAt)})` : ''}. 현재 모델을 유지합니다.`);
  let newest = null;
  const others = [];
  for (const candidate of fresh ? candidates : []) {
    const target = parseLabel(candidate.documentedTarget);
    if (candidate.id !== current.family) {
      others.push({ alias: candidate.id, target: candidate.documentedTarget ?? null, model: target ? modelId(target) : null, recommended: false, note: '다른 계열입니다. 공식 문서의 별칭만 확인했고 이 작업공간의 품질·가용성 근거가 없어 추천하지 않습니다.' });
      continue;
    }
    if (!target || target.family !== current.family) continue;
    const order = target.minorKnown ? compare(target.version, current.version) : target.version[0] - current.version[0];
    if (order > 0) { if (!newest || compare(target.version, newest.parsed.version) > 0) newest = { candidate, parsed: target }; }
    else if (!target.minorKnown && order === 0) reasons.push(`공식 문서가 ${candidate.id} 대상을 '${candidate.documentedTarget}'로만 적어 현재 모델(${record.label})과 판을 비교할 수 없습니다. 현재 모델을 유지합니다.`);
    else if (order === 0) reasons.push(`현재 모델(${record.label})이 공식 문서의 ${candidate.id} 대상(${candidate.documentedTarget})과 같습니다.`);
    else reasons.push(`현재 모델(${record.label})이 공식 문서의 ${candidate.id} 대상(${candidate.documentedTarget})보다 더 새 판입니다. 현재 모델을 유지합니다.`);
  }
  const options = [...(newest ? [{ alias: newest.candidate.id, target: newest.candidate.documentedTarget, model: modelId(newest.parsed), recommended: true, note: '같은 계열의 새 판(공식 문서). 이 계정에서 쓸 수 있는지는 교체 뒤 첫 실행에서 확인합니다.' }] : []), ...others];
  if (newest) reasons.unshift(`공식 문서에 같은 계열의 새 판(${newest.candidate.documentedTarget})이 있습니다. 교체를 추천합니다.`);
  return { status: newest ? 'candidate' : 'keep', reasons, options, runs: counts, fresh };
}
