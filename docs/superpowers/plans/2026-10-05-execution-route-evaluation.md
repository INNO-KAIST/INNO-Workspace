# CR-004 A 실행 경로 단위 비교 — 설계·작업 계획

> 실행 방식: 작업 단위마다 TDD(RED 확인) → 구현 → inno-opus 독립 검증 → 전체 테스트·`git diff --check`·Wrangler dry-run → docs/PROGRESS.md 기록. 커밋·push·배포·실구독 시험·추가 AI 비교 실행은 사용자 확인 후.

**결정(2026-10-03, PRD 11절):** 관측된 실제 적용 model/effort 실행 경로를 별도 평가 단위로 두고 동일 조건 비교로 승격을 판단한다. 내부 serving version은 미확인 null로 유지하고 비교 범위·한계를 명시한다(docs/MODEL-ROUTE-EVIDENCE-PROPOSAL.md 선택 A).

**현재 막힌 곳(코드 조사 2026-10-05):** model-selection의 qualifiedPairs·promoteCandidate·available·evidenceCurrent가 모두 non-null modelVersion을 요구한다. 관측(worker/review-observation.mjs)은 modelVersion을 항상 null로 기록하고 CLI가 실제로 적용한 model/effort를 읽지 않는다. 실행 근거에는 실행 조건(도구·모드·프롬프트 계약)이 없다. 한 배치에 제공자별 자식 하나라서 같은 프로필의 기준/후보 쌍이 자연히 생기지 않고, 추가 비교 예산은 0이다.

**한계(문서·화면에 명시):** 이 변경은 근거를 만들어 내지 않는다. 같은 입력·평가 기준·실행 조건의 비교 사례가 없으면 승격 근거가 생기지 않는다(승격은 사용자의 승격 검토로만 요청). 제공자가 공개하지 않은 내부 버전 변경은 구분할 수 없다. Claude Routine은 CLI 적용 근거가 없어 실행 경로 평가 대상이 아니다.

## 설계
- **실행 경로(execution route):** `{basis:'cli_arguments', model, effort, conditions}`. model/effort는 실행기가 CLI 인자로 실제 적용한 값(모델 자기보고 아님). conditions는 실행 조건 지문 = sha256(JSON{contract, runner:'codex_exec', mode, args(모델·effort·MCP 주소 인자를 뺀 CLI 인자), mcp 연결 여부, 문맥 조회기 사용 여부, 관리 전달·원본 위임 버전, 실제 전달 플러그인 id·해시}). contract는 프롬프트·도구 계약 버전 상수로, 템플릿을 바꾸면 올린다. Codex CLI 자체 버전은 실행기가 알 수 없어 포함하지 못한다(한계, 90일 근거 만료로만 재검토).
- **근거 수집:** Codex 실행 근거(executionEvidence)에 `routeConditions`(64자리 hex)를 추가한다. 값이 없을 때(이전 데스크톱)는 필드를 만들지 않아 기존 근거 형태가 그대로 유지된다. 관측은 근거의 적용 model/effort가 배정 경로와 같고 conditions가 있을 때만 `route`를 기록하고, 아니면 기존처럼 경로 없이 기록한다.
- **비교 규칙:** 버전 없는 경로의 근거 = 같은 model/effort의 `route` 관측. 쌍은 같은 comparisonId이면서 같은 conditions일 때만 성립하고 comparisonId 하나에 한 쌍만 센다(기존 parent/batch 포함 비교 식별자 유지, 무관한 작업을 짝짓지 않음). 경로 관측과 경로 없는 관측은 짝짓지 않는다. 버전 있는 경로는 기존 규칙 그대로.
- **가용성(근거 수준 분리):** 버전 있는 경로는 기존 `account_catalog` 행(버전·능력·문맥 포함)을 요구한다. 버전 없는 비기준 경로는 데스크톱 계정 카탈로그에 그 model/effort가 신선하게 노출된 사실(`account_exposure` 행, desktop_models에서 파생, 2시간 만료)로 판단하고 능력·문맥 적합성은 주장하지 않는다. 버전 없는 기준 경로의 기존 처리(선택은 wait, 배정 때 계정 목록으로 확인하는 미검증 기준 경로 우회)는 바꾸지 않는다.
- **승격:** 최소 표본·독립 검토 통과·중대 회귀 없음·실측 토큰 감소·지연 비악화·현재 가용성 요구 유지. 이미 승격된 경로가 사용 중이면 그 현재 경로와도 같은 규칙의 직접 비교 근거(최소 표본, 실측 절감)를 요구하고(`insufficient_current_route_evidence`), 승격 근거에 비교 대상(`comparedWithId`)을 남겨 근거 유효성 재검사에 쓴다. 수동 고정/철회 우선, CAS 유지.
- **철회·복구:** 실행 경로로 승격된 경로를 철회하면 이전 경로로 복구한다. 이전 경로가 버전 없는 기준 경로면 가용성 행 없이 복구하고(배정 때마다 계정 목록으로 다시 확인), 미검증 기준 경로 우회 조건에서 `policyVersion===1`을 빼 복구된 기준 경로도 배정·고정할 수 있게 한다. 지금까지는 버전 없는 기준 경로 위 승격이 불가능해 이 경로가 실제로 쓰인 적이 없다.
- **A2 독립 검증 반영(결정):** 고정이 없으면 미검증 기준 경로 우회를 활성 경로와 무관하게 허용한다(버전 있는 기준 경로가 selectAssignment에서 activeId와 무관하게 대체되는 것과 같은 규칙). 그래서 2단계 철회, 이전 경로 미노출 상태의 철회·중대 회귀, 승격 경로의 근거 만료·계정 노출 상실 때도 배정이 막히지 않고 기준 경로로 간다(이유 active_route_not_current). 고정한 경로는 기다린다. 근거 유효성은 저장된 쌍 자체를 다시 확인한다(나중 관측이 기존 쌍을 밀어내지 못함). 버전 있는 후보는 버전 없는 기준 경로의 경로 관측과 짝짓지 않는다(의도, 시험으로 고정).

## 작업 단위
- **A1 근거:** server/runners.mjs(routeConditions), public/core/execution-evidence.mjs(검증·보존), worker/review-observation.mjs(route 기록), public/core/model-selection.mjs validObservation(route 검증·저장). 시험: 조건 지문 결정성·인자 변화 반영, 이전 근거 호환(null), 관측 route 기록/미기록 조건.
- **A2 비교·가용성:** model-selection(qualifiedPairs·promote·evidenceCurrent·available의 경로 모드), worker/allocation-policy(availabilitySnapshot 노출 행, 선택 경로 일치 검사). 시험: 경로 근거로 승격·선택·고정·철회 복원, 조건 불일치·근거 없음은 기존 사유로 차단, 기존 기준 경로 흐름 불변.
- **A3 표시·문서:** model-policy-ui 문구("이 실행 경로의 관측 결과", 내부 버전 미확인), PRD MOD 의미·한계, REQUIREMENTS-STATUS, PROGRESS.
