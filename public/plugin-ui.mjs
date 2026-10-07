import {PLUGIN_SELECTION_MAX, PLUGIN_SOURCES, pluginSource} from './core/plugins.mjs';
import {formatShortDateTime} from './core/time-format.mjs';

// CR-007 S3 plugin screen. Skill text, descriptions and review excerpts come
// from third-party files: they are only ever rendered with textContent.
const RULE_LABELS = {
  shell_or_network: '셸·네트워크 명령', external_url: '외부 링크', secret_access: '비밀값·환경 파일',
  instruction_override: '지시 우회 문구', prompt_framing: '프롬프트 경계 문구', ai_detection_mention: 'AI 탐지 언급', ai_detection_evasion: 'AI 작성 탐지 회피',
};
const SKIP_LABELS = {not_approved: '승인 해제', hash_mismatch: '내용 불일치', missing: '삭제됨', size_limit: '실행당 크기 한도'};
const label = (labels, key) => Object.hasOwn(labels, key) ? labels[key] : key;

// The pinned source page, built only from a validated catalog source; null otherwise.
export function pluginSourceLink(plugin) {
  try {
    const origin = pluginSource(plugin.source);
    return `https://github.com/${origin.repository}/tree/${origin.commit}/${origin.path}`;
  } catch { return null; }
}

export function pluginStatusText(plugin) {
  if (plugin.status === 'approved') return '승인됨';
  if (plugin.status === 'disabled') return plugin.disabledReason === 'hash_mismatch' ? '사용 중지 · 저장 내용 불일치' : '사용 중지';
  return plugin.review?.blocked ? '검토 대기 · 승인 불가' : '검토 대기';
}

export function pluginFindingRows(plugin) {
  const rows = (plugin.review?.findings ?? []).map(finding => ({
    level: finding.severity === 'block' ? '차단' : '경고', rule: label(RULE_LABELS, finding.rule),
    where: `${finding.path} ${finding.line}행`, excerpt: finding.excerpt,
  }));
  if (plugin.review?.omittedFindings > 0) rows.push({level: '생략', rule: `추가 검토 결과 ${plugin.review.omittedFindings}건`, where: '', excerpt: ''});
  return rows;
}

export const canApprovePlugin = plugin => plugin.status === 'review' && !plugin.review?.blocked;

export function pluginDeliveryText(delivery) {
  if (!delivery || !Array.isArray(delivery.applied) || !Array.isArray(delivery.skipped)) return '';
  const skipped = delivery.skipped.map(item => `${item?.id}(${label(SKIP_LABELS, item?.reason)})`).join(', ');
  const applied = delivery.applied.length ? `플러그인 전달: ${delivery.applied.map(item => item?.id).join(', ')}` : '플러그인 전달 없음';
  return skipped ? `${applied} · 제외: ${skipped}` : applied;
}

export function pluginImportInput({catalog, name, commit}) {
  const value = String(name ?? '').trim(), pinned = String(commit ?? '').trim();
  if (!Object.hasOwn(PLUGIN_SOURCES, catalog)) throw new Error('플러그인 카탈로그를 선택하세요.');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error('플러그인 이름은 카탈로그 폴더 이름(영문 소문자·숫자·하이픈)이어야 합니다.');
  if (!/^[0-9a-f]{40}$/.test(pinned)) throw new Error('플러그인 커밋은 40자리 커밋 SHA로 고정해야 합니다.');
  return {catalog, path: PLUGIN_SOURCES[catalog].prefix + value, commit: pinned};
}

export function pluginSelectionInput(rows) {
  const chosen = rows.filter(row => row.checked);
  if (chosen.length > PLUGIN_SELECTION_MAX) throw new Error(`작업마다 플러그인은 ${PLUGIN_SELECTION_MAX}개까지 선택할 수 있습니다.`);
  return chosen.map(row => {
    const reason = String(row.reason ?? '').trim();
    if (!reason || reason.length > 500) throw new Error('선택한 플러그인마다 적용 이유를 적어 주세요(500자 이하).');
    return {id: row.id, reason};
  });
}

const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const button = (text, className, name) => { const node = element('button', text, className); node.type = 'button'; if (name) node.setAttribute('aria-label', name); return node; };
const sameSelection = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

// CR-007 S4 (PLG-04): one line of evidence for a plugin from normal work, with the median
// time and tokens next to the counts (shown, not judged).
const minutes = ms => Number.isFinite(ms) ? `${Math.round(ms / 6000) / 10}분` : '—';
const count = n => Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '—';
export function pluginEvidenceText(evidence) {
  if (!evidence) return '';
  const base = evidence.baseline ?? {};
  const medians = evidence.runs ? ` · 중앙값 시간 ${minutes(evidence.medianWallMs)}/${minutes(base.medianWallMs)} · 토큰 ${count(evidence.medianTokens)}/${count(base.medianTokens)}(적용/비교)` : '';
  const excluded = evidence.excluded ? ` · 시작 전·연결 실패 제외 ${evidence.excluded}회` : '';
  return `적용 ${evidence.runs}회(완료 ${evidence.completed} · 미완료 ${evidence.failed}) · 비교 ${base.runs ?? 0}회${medians}${excluded} — ${evidence.text}`;
}

// A removed plugin's kept evidence, with the removal time on the viewer's 24-hour clock.
export function pluginArchiveText(entry, zone) {
  return `${entry.id} · ${formatShortDateTime(entry.removedAt, zone) || '시각 미상'} 삭제 · ${pluginEvidenceText(entry.evidence)}`;
}

// CR-007 S4 (PLG-05): catalog candidates as rows. The basis says what was checked and what was
// not (fit to the person's work is not judged); risks come from the static scan of SKILL.md
// only. Importable ones carry the exact import input, pinned to the listed commit; a blocked
// one cannot be imported.
export function pluginRecommendationRows(data) {
  return (data?.candidates ?? []).map(candidate => {
    const read = candidate.described !== false && !candidate.readFailed;
    const where = `공식 카탈로그 ${candidate.repository ?? candidate.catalog}의 기본 브랜치(커밋 ${String(candidate.source?.commit ?? '').slice(0, 7)})에 있습니다.`;
    const basis = candidate.blocked ? `${where} SKILL.md가 차단 규칙에 해당합니다.`
      : !read ? `${where} 파일 목록은 등록부 기준을 만족하지만 SKILL.md를 ${candidate.readFailed ? '읽지 못했습니다(다음 날 다시 시도)' : '아직 읽지 않았습니다(다음 확인 때 읽음)'}.`
      : `${where} 등록부 기준으로 가져올 수 있습니다.`;
    return {
      id: candidate.id,
      description: candidate.description ?? '',
      described: candidate.described !== false,
      importable: candidate.importable,
      canImport: Boolean(candidate.importable) && !candidate.blocked,
      reason: candidate.reason ?? null,
      basis: `${basis} 작업과의 관련성은 판단하지 않았습니다.`,
      blocked: Boolean(candidate.blocked),
      risks: [
        ...(candidate.blocked ? ['차단 규칙에 해당해 가져올 수 없습니다'] : []),
        ...(candidate.warnings?.length ? [`정적 검사 경고: ${candidate.warnings.join(', ')}`] : []),
        read ? 'SKILL.md만 미리 검사했습니다. 다른 파일은 가져올 때 검사합니다.' : '아직 미리 검사하지 않았습니다. 가져올 때 모든 파일을 검사합니다.',
      ],
      input: candidate.source,
    };
  });
}

// Dialog controller: registry list with review findings and actions, import form,
// and the active task's selection. getContext() -> {client, task, afterChange}.
export function createPluginUI({dialog, getContext}) {
  const list = dialog.querySelector('[data-plugin-list]'), error = dialog.querySelector('[data-plugin-error]'), notice = dialog.querySelector('[data-plugin-notice]');
  const selection = dialog.querySelector('[data-plugin-selection]');
  const recommendations = dialog.querySelector('[data-plugin-recommendations]'), archived = dialog.querySelector('[data-plugin-archive]');
  let plugins = [], evidence = new Map(), suggestions = null, archive = [], busy = false;
  const report = (message, failed = false) => { error.textContent = failed ? message : ''; notice.textContent = failed ? '' : message; };
  // One request at a time; after it, focus moves to the message so keyboard users keep their place.
  async function act(work, done) {
    if (busy) return;
    busy = true;
    for (const control of dialog.querySelectorAll('[data-plugin-list] button, [data-plugin-selection] button, [data-plugin-import] button, [data-plugin-recommendations] button')) control.disabled = true;
    let failed = false;
    try { await work(); report(done); getContext().afterChange?.(); }
    catch (failure) { failed = true; report(failure?.message || '요청을 처리하지 못했습니다.', true); }
    finally { busy = false; }
    try { await refresh(); } catch { if (!failed) error.textContent = '목록을 다시 읽지 못했습니다. 닫았다가 다시 열어 주세요.'; }
    (failed ? error : notice).focus();
  }
  function renderSelection(task) {
    selection.replaceChildren();
    if (!task || task.parentTaskId) { selection.append(element('p', task ? '하위 작업의 플러그인은 부모 작업의 배정에서 정해집니다.' : '작업을 선택하면 적용할 플러그인을 고를 수 있습니다.', 'small-copy')); return; }
    const approved = plugins.filter(plugin => plugin.status === 'approved'), current = new Map((task.plugins ?? []).map(item => [item.id, item.reason]));
    const withdrawn = [...current.keys()].filter(id => !approved.some(plugin => plugin.id === id));
    for (const id of withdrawn) selection.append(element('p', `제외됨: ${id} (승인되지 않아 전달되지 않으며, 저장하면 선택에서 빠집니다)`, 'small-copy'));
    if (!approved.length) { selection.append(element('p', '승인된 플러그인이 없습니다.', 'small-copy')); return; }
    const rendered = task.plugins ?? [];
    const rows = approved.map(plugin => {
      const row = element('div', undefined, 'plugin-select-row'), choose = element('label'), check = element('input'), reason = element('input');
      check.type = 'checkbox'; check.checked = current.has(plugin.id);
      choose.append(check, ' ', plugin.id);
      reason.type = 'text'; reason.maxLength = 500; reason.placeholder = '이 작업에 적용하는 이유'; reason.value = current.get(plugin.id) ?? '';
      reason.setAttribute('aria-label', `${plugin.id} 적용 이유`);
      row.append(choose, reason);
      selection.append(row);
      return {id: plugin.id, check, reason};
    });
    const save = button('이 작업의 플러그인 저장', 'secondary-button');
    save.onclick = () => act(async () => {
      const input = pluginSelectionInput(rows.map(row => ({id: row.id, checked: row.check.checked, reason: row.reason.value})));
      // Save against the task as it is now; if its selection changed meanwhile, show it again first.
      const latest = getContext().task;
      if (!latest || latest.id !== task.id || !sameSelection(latest.plugins, rendered)) throw new Error('작업의 플러그인 선택이 그사이 바뀌었습니다. 다시 확인한 뒤 저장하세요.');
      await getContext().client.selectTaskPlugins(latest.id, latest.version, input);
    }, '작업의 플러그인 선택을 저장했습니다.');
    selection.append(save);
  }
  function renderList() {
    list.replaceChildren();
    if (!plugins.length) { list.append(element('p', '등록된 플러그인이 없습니다.', 'small-copy')); return; }
    for (const plugin of plugins) {
      const card = element('article', undefined, 'plugin-card'), source = pluginSourceLink(plugin);
      card.append(element('h3', plugin.id), element('p', `${pluginStatusText(plugin)} · 커밋 ${String(plugin.source?.commit ?? '').slice(0, 12)} · 해시 ${String(plugin.contentHash ?? '').slice(0, 12)}`, 'small-copy'), element('p', plugin.description));
      if (evidence.has(plugin.id)) card.append(element('p', pluginEvidenceText(evidence.get(plugin.id)), 'small-copy plugin-evidence'));
      if (source) { const link = element('a', '고정된 원문 보기 ↗', 'text-button'); link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
      const findings = pluginFindingRows(plugin);
      if (findings.length) {
        const rows = element('ul', undefined, 'plugin-findings');
        for (const row of findings) rows.append(element('li', [row.level, row.rule, row.where, row.excerpt].filter(Boolean).join(' · ')));
        card.append(rows);
      }
      const actions = element('div', undefined, 'plugin-actions');
      if (canApprovePlugin(plugin)) {
        const approve = button('검토한 내용으로 승인', 'secondary-button', `${plugin.id} 검토한 내용으로 승인`);
        approve.onclick = () => act(() => getContext().client.approvePlugin(plugin.id, plugin.contentHash), '플러그인을 승인했습니다.');
        actions.append(approve);
      }
      if (plugin.status !== 'disabled') {
        const disable = button('사용 중지 (다시 쓰려면 다시 가져와 승인)', 'text-button', `${plugin.id} 사용 중지`);
        disable.onclick = () => act(() => getContext().client.disablePlugin(plugin.id), '플러그인 사용을 중지했습니다.');
        actions.append(disable);
      }
      const confirm = element('input'), confirmLabel = element('label', undefined, 'small-copy'), remove = button('삭제', 'text-button', `${plugin.id} 삭제`);
      confirm.type = 'checkbox'; confirmLabel.append(confirm, ' 삭제 확인'); remove.disabled = true;
      confirm.onchange = () => { remove.disabled = !confirm.checked; };
      remove.onclick = () => act(() => getContext().client.removePlugin(plugin.id), '플러그인을 삭제했습니다.');
      actions.append(confirmLabel, remove);
      card.append(actions);
      list.append(card);
    }
  }
  // Candidates from the allowed catalogs (read daily); importing one starts the usual review.
  function renderRecommendations() {
    if (!recommendations) return;
    recommendations.replaceChildren(element('h3', '카탈로그 후보 (공식 카탈로그, 하루 1회 확인)'));
    if (!suggestions) { recommendations.append(element('p', '추천 후보를 읽지 못했습니다.', 'small-copy')); return; }
    const stale = (suggestions.sources ?? []).filter(source => source.status !== 'fresh');
    if (stale.length) recommendations.append(element('p', `확인되지 않은 카탈로그: ${stale.map(source => source.repository).join(', ')} (마지막 목록을 보여 줍니다)`, 'small-copy'));
    const rows = pluginRecommendationRows(suggestions), importable = rows.filter(row => row.importable), others = rows.filter(row => !row.importable);
    if (!importable.length) recommendations.append(element('p', '지금 가져올 수 있는 새 후보가 없습니다.', 'small-copy'));
    for (const row of importable) {
      const item = element('article', undefined, 'plugin-card');
      item.append(element('h3', row.id), element('p', row.description || (row.described ? '설명을 읽지 못했습니다.' : '설명은 다음 확인 때 읽습니다.')), element('p', row.basis, 'small-copy'));
      for (const risk of row.risks) item.append(element('p', risk, 'small-copy plugin-risk'));
      if (row.canImport) {
        const take = button('가져오기 (검토 후 승인)', 'secondary-button', `${row.id} 가져오기`);
        take.onclick = () => act(() => getContext().client.importPlugin(row.input), '가져왔습니다. 검토 결과를 확인한 뒤 승인하세요.');
        item.append(take);
      }
      recommendations.append(item);
    }
    if (others.length) {
      const details = element('details'), summary = element('summary', `가져올 수 없는 후보 ${others.length}개`), list = element('ul', undefined, 'plugin-findings');
      for (const row of others) list.append(element('li', `${row.id} · ${row.reason}`));
      details.append(summary, list);
      recommendations.append(details);
    }
  }
  function renderArchive() {
    if (!archived) return;
    archived.replaceChildren();
    if (!archive.length) return;
    const details = element('details'), list = element('ul', undefined, 'plugin-findings');
    details.append(element('summary', `삭제한 플러그인의 근거 ${archive.length}개`));
    for (const entry of archive) list.append(element('li', pluginArchiveText(entry)));
    details.append(list);
    archived.append(details);
  }
  async function refresh() {
    const {client, task} = getContext();
    const [listed, measured, suggested] = await Promise.all([
      client.listPlugins(),
      client.request('/api/plugin-evidence').catch(() => null),
      client.request('/api/plugin-recommendations').catch(() => null),
    ]);
    plugins = listed.plugins ?? [];
    evidence = new Map((measured?.plugins ?? []).map(item => [item.id, item]));
    archive = measured?.archive ?? [];
    suggestions = suggested;
    renderList(); renderSelection(task); renderRecommendations(); renderArchive();
  }
  error.tabIndex = -1; notice.tabIndex = -1;
  const form = dialog.querySelector('[data-plugin-import]');
  form.onsubmit = event => {
    event.preventDefault();
    const data = new FormData(form);
    act(async () => { await getContext().client.importPlugin(pluginImportInput({catalog: data.get('catalog'), name: data.get('name'), commit: data.get('commit')})); }, '가져왔습니다. 검토 결과를 확인한 뒤 승인하세요.');
  };
  return {
    async open() { report(''); if (!dialog.open) dialog.showModal(); try { await refresh(); } catch (failure) { report(failure?.message || '플러그인 목록을 읽지 못했습니다.', true); } },
    render: refresh,
  };
}
