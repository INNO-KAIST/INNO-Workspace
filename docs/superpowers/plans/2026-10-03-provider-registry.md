# CR-006 S1 제공자 레지스트리 추상화 — 설계·작업 계획

> 실행 방식: 작업 단위(WU)마다 TDD(RED 확인) → 구현 → inno-opus 독립 검증 → 전체 테스트·`git diff --check`·Wrangler dry-run → docs/PROGRESS.md 기록 후 다음 단위. 커밋·push·배포·실구독 시험은 사용자 확인 후에만 한다.

**목표:** `codex|claude` 두 값에 고정된 저장소·실행기·배정·화면을 선언형 manifest + 어댑터 계약으로 옮기고, 새 제공자가 통과해야 할 공통 적합성 시험 스위트를 만든다. 기존 동작은 바꾸지 않는다(PRV-01, PRV-03, PRV-04의 S1 범위).

**근거:** docs/PROVIDER-PLUGIN-PROPOSAL.md(승인 2026-10-03) 4절 PRV-01~04, 5절 S1, PRD 11절.

**스택:** 기존 JavaScript/Node/Worker/D1. 새 언어·빌드 도구·런타임·의존성 없음. D1 스키마 변경 없음.

## 전역 제약
- 기존 ChatGPT/Codex·Claude 구독만 사용. 유료 API·overage 금지(manifest 검증기가 API 키 인증 종류를 거부).
- 추가 AI 비교 평가 예산 0, receipt gate 0 유지. 원본 영구 업로드 금지. `.inno` 비밀값 출력 금지.
- 기존 전체 테스트(기준 1164건 중 1163 pass, 1 skip)를 수정 없이 통과해야 한다. 기존 오류 문구·API 응답 모양·저장 데이터 모양은 그대로 둔다.
- 모델 프롬프트 문구는 바꾸지 않는다(모델 행동 변화 방지). 세 번째 제공자용 프롬프트 일반화는 S2.
- 실행 중인 데스크톱 연결기와 클라우드 Routine `trig_01JqQA1ENd9B2yKpeZVLvx3J`는 건드리지 않는다.

## 1. 코드 조사 결과 (2026-10-03, HEAD 5e7f404)
제공자 리터럴은 32개 파일 약 130곳. 성격별로 네 가지다.
1. **식별자 검증·열거**: `['codex','claude'].includes(...)`, MCP JSON schema `enum`, 사용량 요약 반복, 문맥 전달 기록 검증(context-delivery, execution-usage, delegation, model-selection, provider-handoff, server/store, worker/store, server/http, worker/index, server/mcp).
2. **전송 방식 의미(실제로는 능력 차이)**: Codex=데스크톱 브리지(로컬 PC, lease, lease 만료 시 일시정지, receipt v1, CLI 인자 실행 근거, 평가 예산), Claude=클라우드 Routine fire(외부 부작용 전 durable claim, 불확실 시 확인 필요, 원격 소유 중 재claim 금지, 일시정지 시 확인 필요). 위치: worker/store(286·330·342·349·495·518), worker/bridge(SQL 포함), worker/dispatch, worker/orchestration, worker/delivery-receipts·reservations, server/delivery-protocol, server/execution-deadline, evaluation-claim, execution-evidence, provider-handoff(lease 만료 복구), server/http(allowDesktopEvidence), server/desktop-http(실행 요청 분기), worker/index(실행 요청 분기).
3. **배정(모델 카탈로그)**: Codex=데스크톱이 보고한 계정 카탈로그(모델+effort), Claude=내장 역할 별칭(haiku/sonnet/opus). 위치: server/model-routing, worker/model-catalog, worker/policy-management, worker/allocation-policy, claude-routing(`CLAUDE_ROLE_MODELS` 중복 정의 2곳).
4. **화면**: public/app.mjs(17곳: 표시명, 실행 가능 여부, 대기·안내 문구, 사용량 카드), model-policy-ui, source-execution, index.html 선택 상자.

저장 구조: provider는 task JSON 본문(checkpoint.provider, assignment.provider, usageHistory[].provider, handoff from/to, contextDelivery.provider)과 `usage` 테이블 PK 문자열로만 저장된다. CHECK 제약·enum 컬럼이 없으므로 **스키마 마이그레이션은 필요 없다**. S1은 새 제공자 값을 쓰지 않으므로 이전 Worker로의 롤백도 데이터 변환 없이 가능하다. 이를 호환성 시험으로 고정한다(WU2).

## 2. 설계

### 2.1 선언형 manifest (public/core/providers.mjs)
브라우저·로컬 서버·Worker가 같이 쓰는 순수 모듈(의존: tasks.mjs의 ValidationError만). manifest는 코드에 선언된 고정 데이터이며 사용자 입력으로 바뀌지 않는다.

```js
{
  manifestVersion: 1,
  id: 'codex',                                   // /^[a-z][a-z0-9-]{1,31}$/
  label: 'Codex', vendor: 'OPENAI',
  auth: {kind: 'subscription_cli', paidApi: false},            // PRV-02: subscription_cli | subscription_cloud_routine 만 허용
  execution: {location: 'local', transport: 'desktop_bridge'}, // PRV-03: desktop_bridge→local, routine_fire→cloud
  capabilities: {
    fileArtifacts: true,
    resultCallback: 'desktop_bridge',          // desktop_bridge | mcp_checkpoint
    cancellation: 'process_terminate',         // process_terminate | confirmation_required (중단 보장 수준)
    usageReport: 'runtime_reported',           // runtime_reported | self_reported_optional | none
    deliveryReceipts: 1,                       // 0 | 1
    executionEvidence: 'cli_arguments',        // null | cli_arguments
    evaluationBudget: true,
  },
  models: {catalog: 'account_catalog'},        // account_catalog | {catalog:'built_in_roles', roles:[...]}
  ui: {option: 'Codex · 현재 구독', usageUrl: 'https://chatgpt.com/codex/settings/usage', availability: ['localCodex', 'cloudCodex']},
  conformance: {suiteVersion: 1, status: 'passed'},  // WU6에서 추가·강제
}
```
Claude manifest: `subscription_cloud_routine`, `cloud/routine_fire`, `mcp_checkpoint`, `confirmation_required`, `self_reported_optional`, receipts 0, evidence null, evaluationBudget false, `built_in_roles ['haiku','sonnet','opus']`, `Claude · 클라우드 Routine`, `https://claude.ai/settings/usage`, `['claudeRoutine']`.

검증기 `validateProviderManifest`는 모르는 키·값, 중복 id, location/transport 불일치, `paidApi!==false`, 허용되지 않은 인증 종류(API 키 등)를 거부한다.

### 2.2 레지스트리 API
```js
createProviderRegistry(manifests) → {ids, has(id), manifest(id), assert(id), label(id), transport(id),
  capability(id,name), byTransport(t), assignable(id)}
export const PROVIDERS = createProviderRegistry(PROVIDER_MANIFESTS)  // 순서: codex, claude
export PROVIDER_IDS, isProviderId, assertProviderId, providerManifest, providerLabel,
  providerTransport, providerCapability, providersByTransport, isAssignableProvider
```
`assert`의 오류 문구는 `provider must be ${ids.join(' or ')}` → 현재와 같은 `provider must be codex or claude`.

### 2.3 어댑터 계약
- **데스크톱 브리지 전송(local)**: Worker `CloudBridge`는 `providersByTransport('desktop_bridge')`에 속한 제공자만 claim/enqueue한다(SQL은 `json_each(?)` 바인딩). 데스크톱이 provider를 보내지 않으면 유일한 데스크톱 제공자를 쓴다(현재 codex, 이전 데스크톱 호환). 로컬 실행기는 `{available(), run({task,materials,executionId,generation,signal})}` 계약이며 server/provider-runners.mjs의 제공자별 factory 표로 만든다.
- **클라우드 fire 전송(cloud)**: worker 어댑터 `{id, transport:'routine_fire', configured(env), fire({fetchFn,env,task,materials,claim,catalog,sourceDelegationVersion}) → {claude_code_session_url, claude_code_session_id, contextDelivery}}`. 일반 `dispatchRemote`/`runRemoteClaim`이 claim→fire→불확실 확인 절차를 맡고, 기존 `dispatchClaude`/`runClaudeClaim` export는 호환 래퍼로 남긴다.
- **능력 기반 분기**: 저장소·receipt·평가·실행 근거·일시정지·복구는 제공자 id 대신 transport/capability로 판단한다. 두 제공자에 대해 기존 분기와 진리표가 같아야 한다(WU3 특성 시험).
- 제공자 고유 코드(Codex CLI 실행·이벤트 해석·계정 카탈로그, Claude Routine 프롬프트·fire·자기보고 라우팅, 공식 문서 탐색)는 어댑터 파일에 남는다.

### 2.4 리터럴 경계 시험
`tests/provider-boundary.test.mjs`가 public/, server/, worker/의 .mjs에서 따옴표로 둘러싼 `codex`/`claude` 리터럴을 찾는다. 허용 파일(사유 기록): `public/core/providers.mjs`(manifest), `server/runners.mjs`(두 어댑터 구현), `server/model-routing.mjs`(Codex app-server 카탈로그 조회), `public/core/claude-routing.mjs`(Claude 자기보고 라우팅), `worker/claude-routine.mjs`(Claude fire 어댑터), `worker/model-discovery.mjs`(공급사 공식 문서 출처 키이며 실행 제공자가 아님), `public/model-diagnostics-ui.mjs`(같은 공급사 문서 출처 표시). WU마다 대상 파일을 늘리며, 늘린 직후 RED를 확인한다.

### 2.5 적합성 시험 스위트와 배정 게이트 (PRV-04)
`tests/helpers/provider-conformance.mjs`의 `runProviderConformance(test, manifest, createHarness)`가 실제 어댑터 + 실제 저장소(TestD1) + 가짜 외부 입출력(가짜 spawn/fetch)으로 다음을 공통 검증한다.
1. 소유권·세대: 다른 executionId/generation의 결과는 ConflictError, 소유자 결과만 반영.
2. 중단: 선언한 `cancellation` 수준과 실제 동작 일치(process_terminate=확인 없이 정지, confirmation_required=확인 대기 기록), 중단 후 옛 소유자 결과 거부.
3. 결과 전달·재전송: 같은 소유자의 같은 결과 재전송이 중복 기록(사용량·산출물)을 만들지 않음.
4. 원본 비보관: 전달된 원문 sentinel이 저장소 전체 덤프에 없음.
5. 비밀값 비노출: 어댑터 설정의 토큰 sentinel이 저장소 덤프·오류 문구에 없음.
6. 미보고 사용량 null: 사용량 없이 완료하면 기록의 토큰 값이 0이 아니라 null.
7. 문맥 전달 기록: `checkpoint.contextDelivery.provider===manifest.id`이고 검증기를 통과.
`tests/provider-conformance.test.mjs`는 **등록된 모든 manifest**를 순회하며 하네스가 없으면 실패한다. manifest가 `conformance.status:'passed'`이고 `suiteVersion`이 현재 버전일 때만 `isAssignableProvider`가 참이며, 위임·인계·모델 선택 검증은 이 게이트를 쓴다. 스위트 자체의 검출력은 실제 어댑터에 의도적 결함(비밀값 기록, 세대 무시, 원문 저장 등)을 넣은 하네스 변형이 실패하는 것으로 보인다. (2026-10-03 변경: 레지스트리를 저장소·브리지 전체에 주입해야 하는 가짜 세 번째 제공자 방식은 침습적이라 채택하지 않음. 실제 새 제공자는 S2에서 운영 manifest로 추가해 같은 스위트를 통과시킨다.)

## 3. 작업 단위
각 단위의 "완료 기준"을 inno-opus 독립 검증의 근거 항목으로 쓴다.

### WU0 잔여 결함: Claude fire 확정 실패 시 contextDelivery 저장
- 파일: worker/index.mjs(fireRoutine), tests/context-delivery-claude.test.mjs.
- RED: Routine이 401(authentication)·429(quota)로 응답하면 task는 failed이고 `checkpoint.contextDelivery`(claude/full_ready/promptBytes=실제 전송 본문 바이트)가 있어야 한다 → 현재 null.
- 구현: `!response.ok`일 때 던지는 runnerError에 `contextDelivery: routine.delivery`를 붙인다. 불확실(5xx·네트워크·잘못된 응답)은 기존대로 확인 대기이며 기록하지 않는다(시험으로 고정).
- 완료 기준: 확정 실패 2종 저장, 불확실 경로 무변화, 기존 시험 무수정 통과.

### WU1 manifest·레지스트리 모듈
- 파일: public/core/providers.mjs(신규), tests/providers.test.mjs(신규).
- RED: 모듈 부재. 시험: 운영 manifest 2개 검증 통과·순서, assert 오류 문구 동일, API 키 인증·`paidApi:true`·모르는 capability·transport/location 불일치·중복 id 거부, 조회 함수 결과, manifest 동결(변경 불가).
- 완료 기준: 순수 모듈, 연동 없음, 동작 변화 없음.

### WU2 저장소·식별자 검증 경계 이전 + 저장 호환성
- 파일: public/core/context-delivery.mjs, execution-usage.mjs, delegation.mjs, model-selection.mjs, provider-handoff.mjs(11행), server/store.mjs(215), worker/store.mjs(333), server/http.mjs(113), worker/index.mjs(347), server/mcp.mjs(enum 3곳).
- 시험: tests/provider-storage-compat.test.mjs(신규) — 기존 형태 기록(checkpoint·assignment·usageHistory·handoff·contextDelivery·usage 테이블)이 이전과 같은 결과로 읽히고, 미등록 제공자 값은 이전처럼 거부·제외됨. 경계 시험에 위 파일 추가(RED 확인).
- 완료 기준: 리터럴 제거, 오류 문구·응답 동일, 스키마 변경 없음 문서화.

### WU3 실행기: 전송·능력 기반 분기와 어댑터 계약
- 파일: worker/store.mjs(286·330·342·349·495·518), worker/bridge.mjs, worker/dispatch.mjs, worker/orchestration.mjs, worker/index.mjs(실행 분기·원격 어댑터 표), worker/claude-routine.mjs(신규, fireRoutine·routineText 이동 + Claude 어댑터), worker/remote-adapters.mjs(신규, routine_fire 어댑터 표·정합성 검사), worker/delivery-receipts.mjs, worker/delivery-reservations.mjs, server/delivery-protocol.mjs, server/execution-deadline.mjs, server/http.mjs(156), server/desktop-http.mjs(93), public/core/evaluation-claim.mjs, execution-evidence.mjs, provider-handoff.mjs(7, CODEX_HANDOFF_POLICY는 Codex 어댑터인 server/runners.mjs로 이동). 2026-10-03 변경: 로컬 서버의 실행기 표는 이미 server/index.mjs의 `runners[provider]`(제공자 id 키)이므로 server/provider-runners.mjs는 만들지 않는다.
- 시험: tests/provider-transport.test.mjs(신규) — 두 제공자에 대한 분기 진리표(일시정지 확인, 재claim 금지, 불확실 확인, receipt·평가 예산·CLI 실행 근거 허용, 브리지/디스패처의 claim 범위)와 원격 어댑터 표 정합성. 경계 시험 확장(RED).
- 완료 기준: 기존 시험 무수정 통과, 진리표 동일.

### WU4 배정: 모델 카탈로그 종류 기반 검증
- 파일: server/model-routing.mjs(검증부), worker/model-catalog.mjs, worker/policy-management.mjs, worker/allocation-policy.mjs, public/core/claude-routing.mjs·server/model-routing.mjs의 `CLAUDE_ROLE_MODELS`를 manifest roles에서 파생.
- 시험: 카탈로그 종류별 검증이 기존과 같은 결과·오류 문구, `ModelCatalog.read()` 응답 모양 동일. 경계 시험 확장(RED).

### WU5 화면: manifest 기반 표시
- 파일: public/provider-ui.mjs(신규 순수 함수: 선택지, 표시명, 실행 가능 여부, 대기·실행 안내 문구, 사용량 카드 모델), public/app.mjs, public/model-policy-ui.mjs, public/source-execution.mjs, public/index.html(선택 상자 생성).
- 시험: tests/provider-ui.test.mjs(신규) — 현재 화면 문구를 특성 시험으로 고정(두 제공자 × 연결 상태). 실제 브라우저 확인은 로컬 미리보기 가능 범위에서 수행하고 결과를 기록.

### WU6 적합성 시험 스위트·배정 게이트
- 파일: tests/helpers/provider-conformance.mjs, tests/helpers/provider-harnesses.mjs, tests/provider-conformance.test.mjs(신규), public/core/providers.mjs(conformance 필드·`isAssignableProvider`), 배정 검증부(WU4 파일)에서 게이트 사용.
- RED: 하네스 없는 manifest·미통과 manifest가 배정 후보로 쓰임.
- 완료 기준: codex·claude 실제 어댑터가 7개 항목 통과, fixture 제공자 통과/의도적 결함 fixture 실패, 미통과 제공자는 위임·인계·모델 선택에서 거부.

### WU7 문서·요구 상태
- docs/PROVIDER-HANDOFF 또는 신규 docs/PROVIDERS.md(제공자 추가 절차: manifest → 어댑터 → 하네스 → 스위트 통과 → 사용자 확인), REQUIREMENTS-STATUS·PROGRESS 갱신. 경계 시험 최종 범위(public/server/worker 전체, 허용 파일만 예외).

## 4. 위험과 대응
- 진리표 차이로 인한 미묘한 동작 변화 → WU3 특성 시험을 구현 전에 작성하고 현재 코드에서 GREEN 확인 후 리팩터링.
- SQL `json_each` 바인딩 → node:sqlite 시험과 D1 모두 지원(SQLite JSON1). Wrangler dry-run으로 번들 확인.
- 화면 회귀 → 순수 함수 특성 시험 + 가능 범위 브라우저 확인.
- 범위 확대 → 프롬프트 문구, 관리 화면(PRV-06), 새 제공자(S2)는 이번 범위 밖.
