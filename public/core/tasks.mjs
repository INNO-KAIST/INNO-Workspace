import {sanitizeResumeState} from './context-resume.mjs';
import {validateOfficeArtifact} from './office-container.mjs';
import {sanitizeArtifactChecks} from './artifact-checks.mjs';
import {sanitizeSourceView,sanitizeSourceCoverage} from './source-coverage.mjs';
import {FULL_CONTEXT_HARD_MAX_BYTES,EMPTY_CHECKPOINT_TEXT,EMPTY_CONVERSATION_TEXT,messageLine} from './context-limits.mjs';
const MAX_PLAN_ITEMS = 6;
const MAX_TEXT = 200_000;

// The request, the checkpoint and every user turn are always delivered inline. A
// write that makes those alone exceed the context hard cap could never run, so it
// is refused when written. For a new task the sum is exact; for a later turn it is
// a lower bound of what every run must send.
const utf8Bytes = value => new TextEncoder().encode(value).byteLength;
function requireRunnable(bytes) {
  if (bytes > FULL_CONTEXT_HARD_MAX_BYTES) {
    throw new ValidationError(`요청·체크포인트와 이 입력만으로 한 번에 전달할 수 있는 상한(${FULL_CONTEXT_HARD_MAX_BYTES / 1000}KB, UTF-8 기준)을 넘어 실행할 수 없습니다. 긴 자료는 첨부로 연결하거나 새 작업으로 나누어 진행하세요.`);
  }
}
const checkpointText = task => String((typeof task?.checkpoint === 'string' ? task.checkpoint : task?.checkpoint?.content) ?? '') || EMPTY_CHECKPOINT_TEXT;

export const TERMINAL_STATUSES = Object.freeze(['completed', 'cancelled']);
export const TASK_STATUSES = Object.freeze([
  'ready',
  'queued',
  'waiting_children',
  'queued_for_review',
  'running',
  'paused',
  'waiting_user',
  'waiting_quota',
  'waiting_connection',
  'failed',
  ...TERMINAL_STATUSES,
]);

const DEFAULT_PLANS = Object.freeze({
  literature: [
    ['researcher', '근거 수집', '관련 문헌과 출처 범위를 확인합니다.'],
    ['synthesizer', '근거 종합', '검증된 근거를 요청에 맞게 종합합니다.'],
    ['reviewer', '인용 검토', '주장과 출처의 일치를 검토합니다.'],
  ],
  analysis: [
    ['analyst', '자료 분석', '제공된 자료의 범위와 품질을 확인하고 분석합니다.'],
    ['reviewer', '결과 검토', '계산과 결론을 독립적으로 점검합니다.'],
  ],
  writing: [
    ['writer', '초안 작성', '요청한 형식과 근거에 맞는 초안을 작성합니다.'],
    ['reviewer', '초안 검토', '정확성, 구성, 누락을 검토합니다.'],
  ],
  presentation: [
    ['researcher', '자료 구성', '발표 목적에 맞는 근거와 핵심 메시지를 구성합니다.'],
    ['designer', '슬라이드 제작', '읽기 쉬운 흐름과 시각 계층으로 편집 가능한 슬라이드를 제작합니다.'],
    ['reviewer', '발표 검토', '내용 정확성, 가독성, 누락과 형식 문제를 검토합니다.'],
  ],
  career: [
    ['career_editor', '경력 자료 편집', '제공된 사실만 사용해 지원 목적에 맞게 경력 자료를 편집합니다.'],
    ['reviewer', '사실 검토', '미확인 주장, 누락, 표현의 정확성을 검토합니다.'],
  ],
  general: [
    ['executor', '요청 수행', '요청을 수행하고 확인 가능한 결과를 남깁니다.'],
    ['reviewer', '결과 확인', '결과가 요청과 자료 범위에 맞는지 확인합니다.'],
  ],
});

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

// Shared by the cloud desktop claim/renewal and the desktop heartbeat tolerance.
export const DESKTOP_EXECUTION_LEASE_MS = 120_000;

export class ConflictError extends Error {
  constructor(message, currentVersion) {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
    this.currentVersion = currentVersion;
  }
}

function dependencies(overrides = {}) {
  return {
    now: overrides.now ?? (() => new Date().toISOString()),
    id: overrides.id ?? (() => crypto.randomUUID()),
  };
}

function text(value, label, {required = true, max = MAX_TEXT} = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${label} must be a string`);
  }
  const result = value.trim();
  if (required && !result) throw new ValidationError(`${label} is required`);
  if (result.length > max) throw new ValidationError(`${label} is too long`);
  return result;
}

function finiteNumber(value, label, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new ValidationError(`${label} must be a non-negative number`);
  return value;
}

function descriptor(input, makeId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('attachment must be an object');
  }
  const source = input.source ?? 'file';
  if (!['file', 'folder', 'url'].includes(source)) {
    throw new ValidationError('attachment source is invalid');
  }
  const result = {
    id: typeof input.id === 'string' && input.id ? input.id : makeId(),
    name: text(input.name, 'attachment name', {max: 500}),
    path: text(input.path ?? input.name, 'attachment path', {max: 2_000}),
    size: finiteNumber(input.size, 'attachment size'),
    lastModified: finiteNumber(input.lastModified, 'attachment lastModified'),
    type: typeof input.type === 'string' ? input.type.slice(0, 255) : '',
    source,
  };
  if (source === 'url') {
    try {
      const url = new URL(input.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      result.url = url.toString();
    } catch {
      throw new ValidationError('attachment url must be an http(s) URL');
    }
  }
  if(input.view!=null){try{result.view=sanitizeSourceView(input.view,result);}catch(error){throw new ValidationError(error.message);}}
  return result;
}

export function sanitizeAttachments(attachments, overrides = {}) {
  if (!Array.isArray(attachments)) throw new ValidationError('attachments must be an array');
  if (attachments.length > 5_000) throw new ValidationError('attachments cannot contain more than 5000 items');
  const deps = dependencies(overrides);
  return attachments.map(item => descriptor(item, deps.id));
}

function planItem(input, makeId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('plan item must be an object');
  }
  const status = input.status ?? 'pending';
  if (!['pending', 'active', 'blocked', 'completed', 'cancelled'].includes(status)) {
    throw new ValidationError('plan item status is invalid');
  }
  return {
    id: typeof input.id === 'string' && input.id ? input.id : makeId(),
    role: text(input.role, 'plan role', {max: 100}),
    label: text(input.label, 'plan label', {max: 200}),
    status,
    instructions: text(input.instructions, 'plan instructions', {max: 4_000}),
  };
}

function normalizePlan(input, makeId) {
  if (!Array.isArray(input)) throw new ValidationError('plan must be an array');
  if (input.length > MAX_PLAN_ITEMS) throw new ValidationError('plan cannot contain more than 6 items');
  return input.map(item => planItem(item, makeId));
}

function defaultPlan(type, makeId) {
  const template = DEFAULT_PLANS[type] ?? DEFAULT_PLANS.general;
  return template.map(([role, label, instructions]) => ({
    id: makeId(), role, label, status: 'pending', instructions,
  }));
}

function artifact(input, makeId, createdAt) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('artifact must be an object');
  }
  const encoding = input.encoding ?? 'utf-8';
  if (!['utf-8', 'base64'].includes(encoding)) throw new ValidationError('artifact encoding is invalid');
  const result = {
    id: typeof input.id === 'string' && input.id ? input.id : makeId(),
    name: text(input.name, 'artifact name', {max: 500}),
    mime: text(input.mime, 'artifact mime', {max: 255}),
    content: text(input.content, 'artifact content', {required: false, max: 500_000}),
    encoding,
    checks: sanitizeArtifactChecks(input.checks),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : createdAt,
  };
  validateOfficeArtifact(result);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 500_000) {
    throw new ValidationError('artifact serialized content cannot exceed 500000 UTF-8 bytes');
  }
  return result;
}

export function createTask(input, overrides = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('task input must be an object');
  }
  if (input.evaluationBudget !== undefined || input.executionBudgetVersion !== undefined ||
      input.checkpoint?.evaluationBudget !== undefined) {
    throw new ValidationError('evaluation budget fields are server owned');
  }
  const deps = dependencies(overrides);
  const now = deps.now();
  const prompt = text(input.prompt, 'prompt');
  requireRunnable(utf8Bytes(prompt) + utf8Bytes(EMPTY_CHECKPOINT_TEXT) + utf8Bytes(EMPTY_CONVERSATION_TEXT));
  const type = typeof input.type === 'string' && input.type.trim() ? input.type.trim().slice(0, 100) : 'general';
  const projectId = input.projectId === undefined || input.projectId === null ? null : text(input.projectId, 'project id', {max: 200});
  return {
    ...(projectId ? {projectId} : {}),
    id: deps.id(),
    title: typeof input.title === 'string' && input.title.trim()
      ? input.title.trim().slice(0, 120)
      : prompt.split(/\r?\n/, 1)[0].slice(0, 120),
    prompt,
    type,
    status: 'ready',
    version: 1,
    createdAt: now,
    updatedAt: now,
    messages: [{id: deps.id(), role: 'user', content: prompt, createdAt: now}],
    plan: defaultPlan(type, deps.id),
    attachments: sanitizeAttachments(input.attachments ?? [], {id: deps.id}),
    artifacts: [],
    checkpoint: null,
  };
}

function assertAction(task, input) {
  if (!task || typeof task !== 'object') throw new ValidationError('task is required');
  if (!input || typeof input !== 'object') throw new ValidationError('action input is required');
  if (!Number.isInteger(input.expectedVersion)) throw new ValidationError('expectedVersion is required');
  if (input.expectedVersion !== task.version) {
    throw new ConflictError(`version conflict: expected ${input.expectedVersion}, current ${task.version}`, task.version);
  }
  // Renaming or moving a finished task only changes how it is filed (CR-008).
  if (TERMINAL_STATUSES.includes(task.status) && !(task.status === 'completed' && input.action === 'message') && !['rename', 'move'].includes(input.action)) {
    throw new ConflictError(`task is terminal (${task.status})`, task.version);
  }
}

export function applyAction(task, input, overrides = {}) {
  assertAction(task, input);
  const deps = dependencies(overrides);
  const now = deps.now();
  const next = structuredClone(task);

  if(task.checkpoint?.confirmationRequired&&input.action==='resume')throw new ConflictError('Confirm the previous remote execution before resuming',task.version);
  if(task.delegation && task.delegation.state!=='superseded' && ['pause','cancel','message','decide'].includes(input.action)){
    const state=['message','decide'].includes(input.action)?'superseded':input.action==='pause'?'paused':'cancelled';
    next.delegation={...task.delegation,state,epoch:task.delegation.epoch+1};
    if(state==='superseded'){
      next.status='ready';
      next.checkpoint={...(task.checkpoint??{}),status:'superseded',executionId:undefined,expiresAt:undefined,updatedAt:now};
    }
  }
  if(task.delegation&&task.delegation.state!=='superseded'&&input.action==='resume')throw new ValidationError('Use delegation resume to preserve child results');
  if(task.delegation&&['waiting_children','queued_for_review'].includes(task.status)&&input.action==='attachments')throw new ConflictError('Sources cannot change during delegation',task.version);

  switch (input.action) {
    case 'pause':
      if (task.status === 'paused') throw new ConflictError('task is already paused', task.version);
      next.status = 'paused';
      break;
    case 'resume':
      if (!['paused', 'failed', 'waiting_user', 'waiting_quota', 'waiting_connection'].includes(task.status)) {
        throw new ConflictError(`task cannot resume from ${task.status}`, task.version);
      }
      next.status = 'ready';
      next.checkpoint = task.checkpoint ? {...task.checkpoint, status: 'ready', updatedAt: now} : task.checkpoint;
      break;
    case 'cancel':
      next.status = 'cancelled';
      next.checkpoint = task.checkpoint ? {...task.checkpoint, status: 'cancelled', updatedAt: now} : task.checkpoint;
      break;
    case 'message':
    case 'decide': {
      const content = text(input.content, `${input.action} content`);
      const request = String(task.prompt ?? '');
      // A first message equal to the request is sent as a reference to it.
      const line = next.messages.length === 0 && content === request ? EMPTY_CONVERSATION_TEXT : messageLine(next.messages.length, 'user', content);
      requireRunnable(utf8Bytes(request) + utf8Bytes(checkpointText(task)) + utf8Bytes(line));
      next.messages.push({id: deps.id(), role: 'user', content, createdAt: now});
      if (task.status === 'waiting_user' || task.status === 'completed') next.status = 'ready';
      if (task.status === 'running') {
        next.status = 'ready';
        next.checkpoint = {...(task.checkpoint ?? {}), status: 'superseded', updatedAt: now};
      }
      break;
    }
    case 'checkpoint':
      next.checkpoint = {
        ...(task.checkpoint ?? {}),
        content: text(input.content, 'checkpoint content'),
        updatedAt: now,
      };
      if(input.resumeState===null)delete next.checkpoint.resumeState;
      else if(input.resumeState!==undefined){
        const resumeState=sanitizeResumeState(input.resumeState);
        if(resumeState.taskId!==task.id)throw new ValidationError('Resume state task scope mismatch');
        next.checkpoint.resumeState=resumeState;
      }
      break;
    case 'artifact':
      next.artifacts.push(artifact(input.artifact, deps.id, now));
      break;
    case 'plan':
      next.plan = normalizePlan(input.plan, deps.id);
      break;
    // CR-008: a person renames a task or files it into a project. A delegation child follows
    // its parent, so it is renamed or moved through the parent only.
    case 'rename':
    case 'move':
      if (task.parentTaskId) throw new ValidationError('A delegation child follows its parent; rename or move the parent task');
      if (input.action === 'rename') next.title = text(input.title, 'title', {max: 120});
      else if (input.projectId === null) delete next.projectId;
      else next.projectId = text(input.projectId, 'project id', {max: 200});
      break;
    case 'attachments':
      if (task.status === 'running') throw new ConflictError('attachments cannot change while task is running', task.version);
      next.attachments = sanitizeAttachments(input.attachments, {id: deps.id});
      break;
    default:
      throw new ValidationError('unsupported action');
  }

  next.version = task.version + 1;
  next.updatedAt = now;
  return next;
}

export function applyOwnedExecutionAction(task, input, overrides = {}) {
  const next = applyAction(task, input, overrides);
  if (input.action !== 'artifact') return next;
  const registered = next.artifacts.at(-1);
  const repeated = task.artifacts.some(a =>
    a.executionId === input.executionId && a.generation === input.generation
    && a.name === registered.name && a.mime === registered.mime
    && a.encoding === registered.encoding && a.content === registered.content
    && JSON.stringify(a.checks) === JSON.stringify(registered.checks));
  if (repeated) next.artifacts.pop();
  else Object.assign(registered, {executionId: input.executionId, generation: input.generation});
  return next;
}

export function sanitizeMaterials(materials) {
  if (materials === undefined) return [];
  if (!Array.isArray(materials)) throw new ValidationError('materials must be an array');
  if (materials.length > 20) throw new ValidationError('materials cannot contain more than 20 items');
  let total = 0;
  return materials.map(item => {
    if (!item || typeof item !== 'object') throw new ValidationError('material must be an object');
    const name = text(item.name, 'material name', {max: 500});
    if(typeof item.text!=='string'||item.text.length>200000)throw new ValidationError('Invalid material text');
    const content=item.text;
    total += new TextEncoder().encode(content).byteLength;
    if (total > 600_000) throw new ValidationError('total material text is too large');
    let coverage;try{coverage=sanitizeSourceCoverage(item.coverage);}catch(error){throw new ValidationError(error.message);}
    return {name,text:content,...(coverage?{coverage}:{})};
  });
}

export function sanitizeDecision(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('decision must be an object');
  const prompt = text(input.prompt, 'decision prompt', {max: 2_000});
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 5) {
    throw new ValidationError('decision requires 2 to 5 options');
  }
  const options = input.options.map(option => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) throw new ValidationError('decision option must be an object');
    return {
      label: text(option.label, 'decision option label', {max: 200}),
      pros: text(option.pros, 'decision option pros', {max: 1_000}),
      cons: text(option.cons, 'decision option cons', {max: 1_000}),
    };
  });
  if (new Set(options.map(option => option.label)).size !== options.length) throw new ValidationError('decision option labels must be unique');
  return {prompt, options};
}
