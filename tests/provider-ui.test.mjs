import test from 'node:test';
import assert from 'node:assert/strict';
import {
  providerName, providerOptions, providerAvailable, executorStatusText, queuedText,
  handoffLine, recoveryConfirmText, usageCardModels,
} from '../public/provider-ui.mjs';

// CR-006 S1 WU5: the screen derives provider copy from the registry. These pin
// the exact text the app showed before for Codex and Claude.

test('provider names and run options come from the registry', () => {
  assert.equal(providerName('codex'), 'Codex');
  assert.equal(providerName('CLAUDE'), 'Claude');
  assert.equal(providerName('gemini'), 'gemini');
  assert.equal(providerName(undefined), '제공자 미기재');
  assert.equal(providerName(''), '제공자 미기재');
  assert.deepEqual(providerOptions(), [
    // CR-010: "auto" needs the cloud workspace; without it the option is shown but cannot be chosen.
    {value: 'auto', label: '자동 · PC 우선, 꺼져 있으면 클라우드 Claude', disabled: true},
    {value: 'codex', label: 'Codex · 현재 구독'},
    {value: 'claude', label: 'Claude · 클라우드 Routine'},
    {value: 'claude-code', label: 'Claude · 이 PC (Claude Code)'},
  ]);
});

test('an executor is available when any declared state flag is set', () => {
  assert.equal(providerAvailable('codex', {localCodex: true}), true);
  assert.equal(providerAvailable('codex', {cloudCodex: true}), true);
  assert.equal(providerAvailable('codex', {claudeRoutine: true}), false);
  assert.equal(providerAvailable('claude', {claudeRoutine: true}), true);
  assert.equal(providerAvailable('claude', {localCodex: true, cloudCodex: true}), false);
  assert.equal(providerAvailable('gemini', {localCodex: true, claudeRoutine: true}), false);
  assert.equal(providerAvailable('codex', undefined), false);
});

test('remote executor status keeps the existing copy', () => {
  const cases = [
    ['codex', {cloudCodex: true, desktopSources: true}, false, '같은 클라우드 작업 · 선택한 원본은 이 PC에서만 Codex에 전달합니다.'],
    ['codex', {cloudCodex: true}, true, '데스크톱 연결됨 · 같은 클라우드 작업에 결과를 저장합니다.'],
    ['codex', {cloudCodex: true}, false, '데스크톱 오프라인 · 실행 요청을 대기열에 보관합니다.'],
    ['codex', {localCodex: true}, false, '이 서버의 Codex 구독으로 실행합니다.'],
    ['codex', {localCodex: true, cloudCodex: true}, false, '데스크톱 오프라인 · 실행 요청을 대기열에 보관합니다.'],
    ['codex', {desktopSources: true}, true, '이 서버에 Codex 실행기가 연결되지 않았습니다.'],
    ['codex', {claudeRoutine: true}, false, '이 서버에 Codex 실행기가 연결되지 않았습니다.'],
    ['claude', {claudeRoutine: true}, false, '연결된 클라우드 Routine으로 실행합니다.'],
    ['claude', {localCodex: true}, false, '서버에 Claude Routine 설정이 필요합니다.'],
  ];
  for (const [provider, capabilities, desktopOnline, expected] of cases)
    assert.equal(executorStatusText(provider, capabilities, {desktopOnline}), expected, `${provider} ${JSON.stringify(capabilities)} ${desktopOnline}`);
});

test('queue, handoff and recovery copy keep the existing text', () => {
  assert.equal(queuedText('codex'), 'Codex 실행 대기 중 · 연결된 데스크톱이 켜져 있어야 이어집니다.');
  assert.equal(queuedText('claude'), 'Claude 실행 연결 대기 중');
  // Stored owners are lower-case; display tolerates case and absence.
  assert.equal(queuedText('CODEX'), 'Codex 실행 대기 중 · 연결된 데스크톱이 켜져 있어야 이어집니다.');
  assert.equal(queuedText(undefined), '제공자 미기재 실행 연결 대기 중');
  assert.equal(handoffLine({from: undefined, to: 'CLAUDE', reason: '확인'}), '제공자 미기재 → Claude · 확인');
  assert.equal(handoffLine({from: 'codex', to: 'claude', reason: '검토 필요'}), 'Codex → Claude · 검토 필요');
  assert.equal(handoffLine({from: 'claude', to: 'codex', reason: '파일 생성'}), 'Claude → Codex · 파일 생성');
  assert.equal(recoveryConfirmText('claude'), '이전 Claude 실행이 종료되었음을 확인했습니다.');
  assert.equal(recoveryConfirmText('Claude'), '이전 Claude 실행이 종료되었음을 확인했습니다.');
  assert.equal(recoveryConfirmText('codex'), '이전 실행이 종료되었음을 확인했습니다.');
  assert.equal(recoveryConfirmText(undefined), '이전 실행이 종료되었음을 확인했습니다.');
});

test('usage cards list every provider with its vendor, label, official link and record', () => {
  const codexRecord = {provider: 'codex', usedPercent: 5}, claudeRecord = {provider: 'CLAUDE', usedPercent: 3};
  assert.deepEqual(usageCardModels([claudeRecord, codexRecord]), [
    {provider: 'codex', vendor: 'OPENAI', label: 'Codex', usageUrl: 'https://chatgpt.com/codex/settings/usage', record: codexRecord},
    {provider: 'claude', vendor: 'ANTHROPIC', label: 'Claude', usageUrl: 'https://claude.ai/settings/usage', record: claudeRecord},
    {provider: 'claude-code', vendor: 'ANTHROPIC', label: 'Claude Code', usageUrl: 'https://claude.ai/settings/usage', record: {}},
  ]);
  assert.deepEqual(usageCardModels([]).map(card => card.record), [{}, {}, {}]);
  assert.deepEqual(usageCardModels([{provider: 'claude-code', usedPercent: 1}]).map(card => card.provider), ['codex', 'claude', 'claude-code']);
  assert.deepEqual(usageCardModels([null, codexRecord]).map(card => card.record), [codexRecord, {}, {}]);
});

// 2026-10-06 user report: on a desktop web browser the refusal said "휴대폰에서…". The guidance
// for a source-bound Codex task opened outside the desktop connection page is device-neutral
// and says where to run it.
test('source-bound Codex guidance names the desktop connection page, not a phone',async()=>{
 const {SOURCE_TASK_NEEDS_DESKTOP_PAGE}=await import('../public/provider-ui.mjs');
 assert.doesNotMatch(SOURCE_TASK_NEEDS_DESKTOP_PAGE,/휴대폰/);
 assert.match(SOURCE_TASK_NEEDS_DESKTOP_PAGE,/DESKTOP-ACCESS\.md/);
 assert.match(SOURCE_TASK_NEEDS_DESKTOP_PAGE,/데스크톱 연결 화면/);
});
