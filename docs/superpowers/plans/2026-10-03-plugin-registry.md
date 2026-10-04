# CR-007 S3 플러그인 등록부·권한·적용 기록 — 설계·작업 계획

> 실행 방식: 작업 단위마다 TDD(RED 확인) → 구현 → inno-opus 독립 검증 → 전체 테스트·`git diff --check`·Wrangler dry-run → docs/PROGRESS.md 기록. 커밋·push·배포·실구독 시험은 사용자 확인 후에만 한다.

**목표:** 공식 카탈로그의 스크립트 없는 Agent Skill(SKILL.md)을 출처·버전·내용 해시로 고정해 등록하고, 검토 보고와 사용자 승인을 거친 것만 작업에 적용하며, 실행마다 실제로 전달된 플러그인을 기록한다(PLG-01, PLG-02, PLG-03의 S3 범위).

**근거:** docs/PROVIDER-PLUGIN-PROPOSAL.md 4절 PLG-01~03·06, 5절 S3("1차는 공식 카탈로그의 SKILL.md만, 스크립트 없는 스킬부터"), PRD 11절. CR-006 S1 레지스트리(docs/PROVIDERS.md)를 사용한다.

**스택:** 기존 JavaScript/Node/Worker/D1. 새 의존성·런타임 없음. 저장은 기존 `metadata` 테이블의 키(`plugin:<id>`)를 쓰고 스키마는 바꾸지 않는다.

## 전역 제약
- 자동 설치 없음. 등록(가져오기)·승인·비활성·삭제는 모두 사용자의 명시적 요청으로만 일어난다. 삭제는 확인 입력이 필요하다.
- 허용 출처만: `github.com/anthropics/skills`의 `skills/` 아래, `github.com/openai/skills`의 `skills/.curated/` 아래. 40자리 커밋 SHA로만 고정(브랜치 이름 거부).
- 스크립트 없는 스킬만: 폴더에 `SKILL.md`와 텍스트 참고 파일(.md/.txt)만 허용. 그 외 파일·하위 폴더가 있으면 등록 거부. 크기 상한(파일 8개, 합계 48KB UTF-8).
- 원본·비밀값 접근 금지(권한 선언 `{scripts:false, network:false, files:'none'}` 고정). 제출물의 AI 작성 은폐(탐지 회피) 목적 스킬은 승인 불가(PLG-06).
- 해시 불일치(저장 내용 변조·재가져오기 차이) 시 즉시 비활성, 실행에는 적용하지 않고 기록한다.
- 유료 API·추가 AI 평가 예산 0, receipt gate 0 유지. 효과 측정·도태·추천은 S4.

## 1. 설계
### 1.1 플러그인 레코드 (public/core/plugins.mjs, 순수 모듈)
```js
{
  version: 1, id: 'anthropics/brand-guidelines',           // catalog/name
  kind: 'agent_skill',
  source: {catalog: 'anthropics', repository: 'anthropics/skills', path: 'skills/brand-guidelines', commit: '<40 hex>'},
  name, description,                                        // SKILL.md frontmatter
  files: [{path: 'SKILL.md', bytes, sha256}],               // 정렬된 파일 목록
  contentHash: '<sha256 hex>',                              // 파일 목록 정규화 해시
  permissions: {scripts: false, network: false, files: 'none'},
  compatibility: {delivery: 'prompt_inline', providers: [...ASSIGNABLE_PROVIDER_IDS]},
  review: {scannedAt, findings: [{rule, line, excerpt}], blocked: false},
  status: 'review' | 'approved' | 'disabled',
  approval: {approvedAt, contentHash} | null, disabledReason: null | 'user' | 'hash_mismatch',
  importedAt, updatedAt,
}
```
본문(SKILL.md와 참고 파일 텍스트)은 같은 키에 저장하되 API 목록 응답에는 요약만 낸다.

### 1.2 검토 보고(정적 검사, 자동 거부와 경고 구분)
- 거부(blocked, 승인 불가): 스크립트·실행 파일 존재, 허용 외 파일, 크기 초과, AI 탐지 회피·작성 사실 은폐 지시(PLG-06).
- 경고(사용자 판단): 셸·네트워크 명령(curl/wget/pip/npm 설치 등), 비밀값·환경변수·자격증명 언급, "이전 지시 무시" 류 지시 우회 문구, 외부 URL. 줄 번호와 짧은 발췌로 보고한다(발췌는 200자 이하).

### 1.3 흐름 (Worker HTTP, 인증 필수)
- `POST /api/plugins/import {catalog, path, commit}`: 허용 출처 확인 → GitHub contents API로 폴더 목록 조회 → raw 파일 가져오기 → 검사·해시 → `status:'review'`로 저장. 같은 id가 승인 상태면 새 버전은 별도 검토 상태로 두고 기존 승인은 유지하지 않는다(해시가 다르면 비활성 후 재검토).
- `GET /api/plugins`: 목록(요약·상태·검토 결과).
- `POST /api/plugins/:id/approve {contentHash}`: 검토한 해시와 일치하고 blocked가 아닐 때만 승인.
- `POST /api/plugins/:id/disable`, `POST /api/plugins/:id/remove {confirm:true}`.
- 외부 조회는 가져오기 요청 때만(하루 1회 카탈로그 조회·추천은 S4).

### 1.4 적용과 기록 (PLG-03)
- 작업 선택: 작업에 `plugins: [{id, reason}]`(최대 3개, 승인된 것만, 같은 이름 중복 금지). 사용자가 작업 화면에서 고르거나, 마스터가 위임 자식 배정에 `plugins`와 이유를 넣는다.
- 전달: 실행 시점에 승인 상태와 저장 해시를 다시 확인한 플러그인만 프롬프트에 "사용자 승인 스킬(출처·커밋·해시)" 구역으로 넣는다. 작업 지시·안전 규칙·INNO 콜백 계약을 바꿀 수 없다고 명시한다. Claude는 Worker routineText, Codex는 claim 보강(reviewInputs와 같은 방식)으로 데스크톱 실행기에 전달하고 실행기가 실제로 넣은 목록을 결과에 보고한다.
- 기록: `checkpoint.pluginsApplied = [{id, contentHash, reason}]`. 클라우드는 fire 시점, 데스크톱은 실행기가 보고한 것만 저장(이전 데스크톱은 보고하지 않으므로 빈 기록). 해시 불일치·비승인으로 빠진 플러그인은 `pluginsSkipped`로 이유와 함께 기록.

## 2. 작업 단위
- **P1 레코드·검토 모듈**: public/core/plugins.mjs(출처 판정, SKILL.md frontmatter 해석, 파일 목록·크기 검사, 정적 검사 규칙, 해시, 레코드 검증·상태 전이 함수) + tests/plugins.test.mjs. 연동 없음.
- **P2 등록부 저장·HTTP**: worker/plugins.mjs(가져오기: 주입 가능한 fetch로 GitHub 조회, 저장, 목록, 승인·비활성·삭제) + worker/index.mjs 라우트 + tests/plugin-registry-http.test.mjs(가짜 GitHub 응답: 정상·스크립트 포함·허용 외 출처·브랜치 이름·크기 초과·탐지 회피 문구·해시 불일치 재가져오기·승인 해시 불일치).
- **P3a 사용자 선택·전달·기록**: `POST /api/tasks/:id/plugins {expectedVersion, plugins:[{id, reason}]}`(실행 중이 아닐 때, 승인된 것만, 최대 3개, 이유 필수) → `task.plugins`. Worker가 실행 시점에 승인 상태와 저장 텍스트 해시를 다시 확인해 전달 목록을 만든다(불일치는 비활성 후 제외). Claude는 어댑터가 routineText에 구역을 넣고 fire 시점에, Codex는 claim 보강(`claim.plugins`)을 데스크톱 연결기가 실행기에 넘기고 실행기가 넣은 목록을 결과에 보고해 complete/fail 시점에 `checkpoint.pluginDelivery = {version:1, applied:[{id, contentHash, reason}], skipped:[{id, reason}]}`로 저장한다. 새 claim에서 초기화. 보고는 선택된 id와 claim이 제공한 해시만 인정한다. 적합성 스위트에 "승인된 플러그인만 전달·기록" 항목 추가(새 제공자도 지켜야 함).
- **P3b 마스터의 자식 배정 선택**: 위임 배정에 `plugins:[{id, reason}]`(승인된 것만)과 마스터 프롬프트의 승인 목록(이름·설명). 자식 작업이 이를 `task.plugins`로 받는다.
- **P4 화면**: 설정의 플러그인 목록(상태·출처·커밋·검토 결과·승인/비활성/삭제), 작업 화면의 선택, 실행 기록 표시. 실제 브라우저 확인.
- **P5 문서·요구 상태 갱신**.

### 진행 상태 (2026-10-03)
- P1·P2·P3a·P3b·P4 구현·독립 검증 완료, P5 문서(docs/PLUGINS.md, REQUIREMENTS-STATUS) 작성. 설계 대비 변경: 라우트는 id를 경로 대신 본문으로 받음, 텍스트는 별도 키(plugin_content:)에 저장, 가져오기 전 커밋이 기본 브랜치에 있는지 확인, 내려받은 바이트를 목록의 크기·git blob SHA-1에 결속, 실행당 플러그인 텍스트 64KB 상한, 해시에 묶인 프롬프트 경계 태그, 데스크톱 보고는 저장된 플러그인 버전과 일치해야 기록.
- 실제 공식 카탈로그 가져오기와 실구독 실행 확인은 사용자 확인 후(외부 접속·실구독).

## 3. 위험
- 프롬프트 주입: 승인된 스킬도 지시를 담으므로 구역 경계와 우선순위 문구, 검토 경고, 크기 상한으로 제한한다. 완전한 차단은 보장하지 않는다(문서에 명시).
- GitHub API 비인증 한도(시간당 60회): 가져오기는 사용자 요청 때만 하므로 충분하다. 실패 시 저장하지 않는다.
- 공식 카탈로그 경로 구조가 바뀌면 가져오기가 실패하고 기존 승인 레코드는 그대로 동작한다.
