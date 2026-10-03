# INNO Workspace — Claude 인수인계 및 전체 검토 지도

작성일: 2026-10-01 (한국시간). 대상: 사용자가 선택한 Claude Opus5.5에서 수행할 후속 개발·독립 총괄 검토.
이 모델명의 가용성·내부 버전·성능을 이 문서가 검증한 것은 아니다. 플랫폼의 Claude Routine 모델이나 계정 설정을 이번 인계에서 변경하지 않았다.

## 1. 가장 먼저 알아야 할 상태

**전체 플랫폼은 미완료다.** 현재 세부 단계 CR-005 Stage2D1(출처 검증 기반 선택적 문맥 전달)은 구현·독립 검토·로컬 전체 검증을 마쳤다. 사용자가 이번 단계까지만 마치고 인계하도록 요청했으므로 Codex에서 새 기능 작업을 시작하지 않는다.

- 최신 제품 코드 커밋: `f4a38ab` — Select source-bound resume context with scoped retrieval.
- 실제 개발 경로: `E:\Develop\INNO Workspace\.inno\worktrees\source-views`.
- 개발 브랜치: `codex/source-release`. 인계 문서를 포함해 이 브랜치를 GitHub에 공유한다. **main 체크아웃만 읽으면 최신 개발 내용이 없다.**
- 저장소: https://github.com/INNO-KAIST/INNO-Workspace
- 기본 체크아웃: `E:\Develop\INNO Workspace`, 브랜치 `codex/desktop-release`, HEAD `c925a00`. 실제 개발 worktree와 혼동하지 않는다.
- 다른 기존 worktree: `.inno/worktrees/parallel-master` (`codex/parallel-master`, `0b1f641`). 관련 작업의 용도를 확인하지 않고 삭제·초기화·재사용하지 않는다.
- 새 언어/빌드 도구/런타임은 추가하지 않았다. JavaScript ES modules + Node >=24, Cloudflare Worker/D1, 정적 HTML/CSS/JS, Python 산출물 검증 도구를 사용한다. React/Vite 프로젝트가 아니다.

### 원격 및 운영 상태 — 이번 인계 중 실제 읽기 전용 확인

|대상|확인값|정확한 의미|
|---|---|---|
|GitHub main|`c925a00a3b69f74877bc9d1689dbe99e4dd1d390` (`git ls-remote`)|현재 개발 변경은 main에 미반영|
|Cloudflare 최신 배포 기록|버전 `e2a00c32-93a7-4a98-a36b-8eeb0eb38445`, 100%, 생성 `2026-09-27T16:34:26.368Z` = 한국시간 09-28 01:34|`wrangler deployments list` 확인. 최신 개발 기능이 배포되었다는 뜻이 아님|
|Worker/API|https://inno-workspace-api.innokaist.workers.dev|이번에는 배포 목록만 확인; 인증된 업무 요청이나 AI 실행은 하지 않음|
|GitHub Pages|https://inno-kaist.github.io/INNO-Workspace/|이번에 Pages의 실제 자산 커밋/캐시를 새로 확인하지 않음|
|receipt 복구 활성화|`scripts/desktop-bridge.mjs`의 `deliveryReceiptVersion=0`|새 receipt protocol 및 복구 UI가 기본 활성 상태가 아님|
|첨부 협업 설정|`wrangler.jsonc`: `INNO_SOURCE_DELEGATION_VERSION="1"`|별도 기능이다. receipt gate와 혼동하지 않는다|

현재 실행 중인 운영 작업/브리지 PID/포트 점유, pending outbox·예약의 실제 내용, 계정 잔여량은 이번 인계에서 조회하지 않았다. 미존재·비어 있음·중단 가능으로 가정하면 안 된다. `wrangler.jsonc`에는 5분 간격 scheduled trigger가 있지만 임의 AI 작업의 24시간 무제한 실행 보장이 아니다.

이 인계의 GitHub 개발 브랜치 공유는 main merge·Worker deploy·Pages publish가 아니다. 향후 원격이 바뀔 수 있으므로 작업을 재개할 때 같은 읽기 전용 확인을 다시 한다.

## 2. 사용자 요구와 이미 받은 승인

1. INNO Workspace 자체가 독립 플랫폼이어야 한다. NanoLab/Prism/RefAtlas/Scheduler/Analytics는 필요할 때만 선택적으로 이용하고 Ledger 연동은 필수 요구가 아니다.
2. 기존 ChatGPT/Codex·Claude 구독만 사용한다. 추가 유료 API, 유료 과금, 계정 변경을 대안으로 몰래 도입하지 않는다.
3. PC가 꺼져도 웹 접근·가능한 클라우드 작업은 유지하되, 로컬 Codex 및 로컬 파일은 PC 없이 사용할 수 없다는 제약을 숨기지 않는다.
4. 파일/폴더 원본은 별도 영구 업로드하지 않는다. 내구성 있는 작업 이력·결정·생성 결과와 일시 조회 원본을 구분한다.
5. 마스터가 목적·완료 기준·자료·위험을 이해하고 적합한 모델/역할을 배정한다. 모델 이름/출시일만으로 품질이나 저비용을 추정하지 않는다.
6. 토큰·시간 효율성과 누적 방지, 재개 시 목표·제약·결정·미완료 항목의 연속성이 중요하다. 미관측 값을 0이나 추정 절감 성과로 표시하지 않는다.
7. 연구뿐 아니라 논문/Figure/CV/지원서/제안서/보고서/PPT 등 일반 작업도 실제 산출물 품질로 평가해야 한다. UI는 반응형·매트한 디자인, 요청/결과 구분, 선택지의 장단점, 기기별 조작이 필요하다.
8. 개발 자료는 `E:\Develop` 아래에 둔다. Claude 클라우드에서는 저장소 checkout 경로를 사용하고 Windows E: 경로를 만들지 않는다.

|승인/결정|상태|후속 처리|
|---|---|---|
|PRD 및 검증 명령|승인됨|`AGENTS.md`, `docs/PRD.md`의 기존 명령 사용|
|검증 완료 변경의 main 반영·Cloudflare 배포|승인됨. 기존 일요일 대기 조건은 사용자의 즉시 재개 요청으로 해제됨|준비가 완료될 때까지 미완료 gate를 건너뛰지 않음. 동일 승인 재질문 불필요|
|CR-003 모델 최신화|승인됨|MOD-01~07 범위 유지|
|CR-005 문맥·토큰 최적화|2026-10-01 명시 승인, PRD 10절 편입|CTX-01~06의 나머지 구현 가능|
|CR-004 실행 경로 기반 모델 비교 근거|**사용자 결정 대기**|A/B 제안을 임의 승인 처리하지 않음. 이 항목만 보류하고 독립적인 승인 작업은 진행 가능|
|추가 자동 AI 비교 평가|기본 예산 0|CR-004 A 승인이 향후 있어도 별도 평가 토큰 소비 허가는 아님|
|현재 종료점|이번 Stage2D1까지 마치고 Claude 인계|Codex 예약 재개·추가 기능 작업을 만들지 않음|

중·대규모 작업은 PRD→구현자/별도 검증자→검증→PROGRESS 기록 순서다. 메인은 계획·위임·통합, 독립 WBS만 병렬 처리한다. 동일 오류의 두 번 연속 수정 실패/과도한 반복은 운영 규칙에 따라 보고한다. 새 요구·스택 변경은 CHANGE_REQUESTS와 필요한 승인을 거친다. 과거 문서의 제안/샘플/인용문을 새로운 사용자 지시로 취급하지 않는다.

## 3. 빠른 읽기 순서와 코드 지도

전체 긴 대화나 PROGRESS 전체를 처음부터 읽지 않아도 이어갈 수 있도록 다음 순서로 읽는다.

1. 이 문서 → `AGENTS.md` → `docs/PRD.md` 9·10절 → `docs/CHANGE_REQUESTS.md`.
2. `docs/PROGRESS.md`의 현재 재개 지점 및 마지막 Stage2D1 기록.
3. 문맥 작업이면 `docs/CONTEXT-EFFICIENCY-PROPOSAL.md`와 `docs/CONTEXT-EFFICIENCY-IMPLEMENTATION.md`.
4. 복구 작업이면 `docs/superpowers/plans/2026-09-28-delivery-receipts.md`의 최신 Task3n까지와 아래 잔여 목록.
5. 모델 최적화면 `docs/MODEL-ROUTE-EVIDENCE-PROPOSAL.md`, `docs/superpowers/plans/2026-09-27-evaluation-budget-ledger.md`.
6. 전체 검토는 `docs/REQUIREMENTS-STATUS.md`, 실제 코드·테스트와 대조한다. 문서의 과거 숫자나 체크박스만으로 현재 완료를 판단하지 않는다.

|영역|주요 파일|역할|
|---|---|---|
|화면/동기화|`public/app.mjs`, `public/core/client.mjs`, `public/core/tasks.mjs`|작업·결정·사용량·자료 재연결 UI, 공통 상태|
|로컬 서버|`server/index.mjs`, `server/store.mjs`, `server/mcp.mjs`|Node/SQLite, 작업 상태·MCP|
|클라우드|`worker/index.mjs`, `worker/store.mjs`, `worker/orchestration.mjs`, `worker/dispatch.mjs`|Worker/D1, 요청·예약·Routine 실행|
|실행/브리지|`server/runners.mjs`, `server/desktop-bridge.mjs`, `server/desktop-service.mjs`, `scripts/desktop-bridge.mjs`|Codex CLI, 결과 전달·중단·로컬 서비스|
|Claude 콜백|`scripts/inno-mcp.mjs`, `worker/execution-scope.mjs`|실행 capability가 부여된 MCP 호출 및 범위 제한|
|문맥|`public/core/task-context.mjs`, `task-context-read.mjs`, `context-resume.mjs`|전문/선택 조립·범위 조회·재개 상태 출처 검증|
|로컬 문맥 조회|`server/context-access.mjs`, `server/desktop-http.mjs`, `scripts/read-local-context.mjs`|실행 중 메모리 snapshot·별도 읽기 권한·고정 helper|
|전달 복구|`server/file-outbox.mjs`, `outbox-recovery.mjs`, `delivery-protocol.mjs`, `worker/delivery-*.mjs`, `public/recovery.*`|저장 결과·receipt·ACK·명시 복구|
|모델/관측|`server/model-routing.mjs`, `public/core/claude-routing.mjs`, `model-selection.mjs`, `worker/model-discovery.mjs`, `review-observation.mjs`|목록/별칭·선택 정책·독립 품질 관측|
|평가 예산|`public/core/evaluation-budget.mjs`, `evaluation-claim.mjs`, `server/evaluation-budgets.mjs`, `worker/evaluation-budgets.mjs`, `server/execution-deadline.mjs`|횟수/시간 예약·원자 claim·로컬 종료 관측|
|사용량/파일 검사|`public/core/execution-usage.mjs`, `usage-presentation.mjs`, `scripts/verify-deliverable.py`|보고된 사용량·단계 표시·Office/PDF 검사|

문서 불일치 주의: PRD 앞부분의 과거 기준 커밋과 `PARALLEL-MASTER.md`의 자료 없는 협업만 가능하다는 설명은 작성 당시 내용이다. `EXECUTION-USAGE.md`의 최초 단일 실행 사용량 설명도 이후 phase/history/cached 관측 기능 전체를 대표하지 않는다. 이 자료들을 후속 검토에서 실제 코드와 맞춰 갱신해야 하며, 현재 없는 기능을 있는 것으로 해석해서도 안 된다.

## 4. 이번까지 구현된 CR-005의 정확한 범위

|단계/커밋|구현|한계|
|---|---|---|
|Stage1 `352efaa`|Codex·Claude 공통 문맥 조립, 초기 중복 요청 제거, 같은 역할의 같은 본문 참조, UTF-8 바이트/해시/manifest|과거의 최근20개/각8000자 절단을 제거했지만 전체 provider 입력 예산은 아님|
|Stage2A `15e8a32`|`read_task_context`: request/checkpoint/message/20개 manifest 페이지, task/version/digest 검증, 기존 실행 범위 유지|첨부 원본/전체 다른 task를 반환하지 않음|
|Stage2B1 `58865e5`|단일 bounded `checkpoint.resumeState`, basis/원본 참조 검증, 새 메시지 pending 표시|source_matched는 해시 일치이며 의미상 완전성/사용자 승인 증명이 아님|
|Stage2B2 `7600f43`|선택적 state 객체/null/생략을 runner→outbox→완료·재전송·local/D1 원자 저장에 연결|handoff/delegation/실패 review와 state 결합은 미지원이므로 거절|
|Stage2C `12144bc`|Claude helper whitelist 누락 수정, 실제 scoped MCP 조회 안내. Codex 메모리 조회 registry/HTTP/helper/실행 권한 폐기|실제 구독 모델이 해당 helper를 사용하는 새 종단 시험은 미실행|
|Stage2D1 `f4a38ab`|유효 상태가 직접 참조한 prefix assistant의 선택 대체, 같은 공유 선택을 두 실행 경로에 연결|초기 과대 문맥 bootstrap, 전체 입력 예산, 지표 저장/UI, 실측 절감은 남음|

### 선택 전달 불변식 — 리뷰에서 반드시 확인

- 옵션 `selection:'resume'`와 `readerAvailable:true`를 실제 조회 가능한 어댑터만 사용한다. 기본·평가 실행·미설정·standalone 경로는 전문 전달이다.
- request·모든 user/system·checkpoint·basis 이후 **모든** 메시지를 유지한다. pending 응답의 20개 목록을 전체 pending으로 잘못 취급하지 않는다.
- state가 같은 task/mode/원문 prefix/범위 해시에 맞고 직접 참조한 과거 assistant만 후보다. 사용자 메시지 바로 앞의 assistant 제안은 보존한다. 엄격히 교대로 대화하는 경우 절감이 제한될 수 있다.
- 중복 참조는 생략된 원문을 인라인 대상으로 가리키지 않는다. 생략 위치/인덱스/전체 SHA-256과 다시 읽는 방법을 본문에 표시한다.
- 상태·안내·표식까지 합친 실제 UTF-8 입력이 기존 dedup 결과보다 작고 96000바이트 이내여야 선택한다.
- 선택 패킷은 `complete:false`, `readiness:'selected_ready'`, `manifest.selection.applied:'resume'`, `retrievalRequired:true`, `budget.exceeded:false`다. 완전 원문이 없다는 의미와 실행 준비를 구분한다. 어댑터는 readiness뿐 아니라 reader/적용 상태/실제 예산도 확인한다.
- 첫 `offset:0` 조회에도 표식의 `expectedDigest`를 사용하고 반환 `contentDigest`를 확인한다. 버전/해시가 달라지면 오래된 선택 상태와 새 원문을 섞지 않는다.
- 요약으로 권한을 얻지 않는다. 과거 제안에 대한 “네/진행해” 해석에 원문이 필요하면 먼저 조회한다. 해시 검증만으로 모델 이해·요약 품질을 보증하지 않는다.
- 별도 AI 압축 호출은 추가하지 않았다. 정상 작업의 선택적 결과로 state를 갱신한다. 모델이 항상 완전한 state를 생성한다는 보장은 없다.

### 현재 수치 제한

- resumeState: JSON UTF-8 32768바이트, 항목1~48, 항목 text 최대2000문자, 원본 참조1~8개/항목, 단일 현재 상태 교체.
- 원문 text 조회: 응답 content 최대16000 UTF-8 바이트, 문자 경계 보존, 후속 페이지 digest 필수. manifest20개/페이지.
- 로컬 registry: 활성 snapshot1개, 동시 조회1개, snapshot4MiB, 요청4096바이트, 응답128KiB, 누적 응답32MiB, 조회1024회, helper 전체10초. 초과는 오류이며 자르지 않는다.
- 조회 토큰은 자식 환경의 `INNO_CONTEXT_*`로만 부여하며 상속값은 제거한다. 관리자 토큰과 다르다. 종료·abort·오류의 최외곽 finally에서 폐기하고 늦은 비동기 응답도 차단한다.
- 바이트 지표는 core 반환값이다. 실제 token/cache/계정 잔여량 또는 재조회까지 합친 비용 절감을 뜻하지 않는다.

## 5. 남은 작업 — 실행 가능한 WBS와 완료 증거

아래 H 번호는 인계용 순서이며 기존 PRD 요구사항을 대체하지 않는다. “미구현”과 “코드 있으나 실제 검증 필요”를 구분한다.

### H1. 최초 과대 문맥 처리 및 재개 연속성 (CTX-01~04,06 / 높음)

> 2026-10-01 갱신: 사용자 결정으로 WU5에서 96KB 초과~384KB는 전문 전달(예산 초과 표시), 384KB 초과만 차단으로 변경했다. 아래 bootstrap 설계는 채택하지 않았으며 이력으로 남긴다. 최신 상태는 PROGRESS.md 재개 지점 참조.

**현상:** 유효 state가 없거나 필수 request/user/system/checkpoint/pending만으로 96KB를 넘으면 실행 전 `CONTEXT_RETRIEVAL_REQUIRED`로 멈춘다. reader가 있다고 무조건 실행하도록 바꾼 것은 아니다.

**남은 구현:** 필수 원문을 나눠 조회하는 bootstrap/재개 프로토콜. 최소 `{taskId,executionId,generation,section,index,digest,byte ranges}`에 결합한 실제 원문 제공 범위와 미처리 목록이 필요하다. manifest/basis를 읽은 것만으로 본문을 읽었다고 인정하면 안 된다. 로컬 registry는 요청/바이트 수만 추적하며 coverage가 없고, Worker reader는 요청 간 coverage를 저장하지 않는다.

**설계·검증 순서:** 같은 provider 의미의 coverage 계약 → 로컬 snapshot/read/결과 경계 → Worker 실행-bound durable metadata/CAS → 완료·일반 state·위임·인계 등 우회 경계 → 취소/재개/응답 유실/epoch·소유권 변경 → 실제 양 provider. 실패·갱신 보고까지 무조건 막아 교착시키지 않는다. 원문 제공 증거는 모델 이해의 증거가 아니다. shell/외부 변경을 조회 이전에 얼마나 제한할 수 있는지도 실제 런타임 기준으로 검토한다.

**완료 증거:** no-state 큰 대화, 큰 최초 요청, 긴 사용자 지시의 뒷부분, 사용자 변경, 20개 초과 pending, 원문 해시 변경, 부분 UTF-8 페이지, 마지막 페이지 누락, 중단/재시작, 다른 실행 coverage 위조에서 누락 없이 이어가거나 정확한 미처리 상태를 보여준다. 단순 complete=true 또는 임의 길이 절단으로 통과시키지 않는다.

### H2. 전체 입력 예산 및 문맥 효율 관측 (CTX-02,05,06 / 높음)

**남음:** 96KB는 request+conversation+checkpoint만 센다. model policy·라우팅 지침·자료·source view·도구 정의·전체 wire payload를 포함한 입력 예산이 없다. `selectionSavedBytes` 등 core metrics의 execution 저장 및 UI 연결도 없다.

**할 일:** 원문/선택/정적 지침/자료/재조회 바이트를 분리 계측; 지원 tokenizer 없으면 byte/추정을 정확히 표기; input/output/cached 및 압축·조회 추가 비용의 미보고 null 보존; 완료·실패·재전송 중복 없는 관측 저장; 사용자 화면에서 원문/선택/차단 사유 확인. 활성 참조를 보호하는 보관 한도/정리 정책과 성능을 검증한다.

**완료 증거:** 동일 입력·조건에서 선택 전후 초기 입력+실제 재조회 합계를 비교한다. 공급자 보고 토큰이 없으면 바이트만 보고한다. cache hit·계정 잔량·API 가격 환산을 만들어내지 않는다. 장기 이력에서 메모리/조회/지표 증가가 제한되고 실패 재시도 때 지표가 중복되지 않는다.

### H3. CR-005 실제 구독 종단 확인 (CTX-01~06, REL-01 / 높음)

**현재 증거:** 합성 Codex 이벤트/가짜 Claude fire + 실제 Node helper subprocess/로컬 HTTP/MCP/D1 테스트다. 새 문맥 기능으로 실제 Codex sandbox 접근·Claude Routine callback을 새로 확인하지 않았다.

**할 일:** 기존 구독 및 최소 실행으로 긴 고정 사례를 두 제공자에서 실행, 원문 해시 재조회·선택 결과·출처 정확성·재개 state·생성 파일 회수·소유권 및 결과 재전송을 관찰. CLI loopback/helper 허용과 Claude checkout 브랜치 최신화를 실제 확인. provider 전환 시 state mode/source 변화가 정확히 처리되는지 확인.

**완료 증거:** 실제 실행 ID/결과/관측 가능 모델/사용량과 한계를 비밀 없이 기록한다. 모델 자기소개는 모델 버전 증거로 쓰지 않는다. Routine callback 문서만 맞는 것으로 실제 연결 완료를 선언하지 않는다.

### H4. 결과 전달 복구의 재시작 안전성 및 운영 활성화 (SRC-02,05,06, REL-01 / 높음)

**구현됨:** receipt 식별/원자 결과 수락/예약/ACK, 기존 브리지 재전송, `.tmp` 점검/해시 확인 명시 채택, 명시 drain, pause/unsafe 서비스 유지, 별도 loopback 복구 UI(Task3n), 합성·파일·브라우저 검증. **기본 protocol은 여전히0이다.**

**남은 핵심:**

1. durable claim journal. 현재 `deliveryUnsafe`/`recoveryPaused`는 메모리다. 실행/결과 기록 실패 뒤 프로세스가 죽고 outbox가 없을 때 새 claim을 막는 영속 의도/owner 기록이 없다.
2. claim/poll 응답 유실의 unknown-owner. 응답을 못 받아 task/execution을 모르면 현재 task-scoped 조회만으로 안전한 자동 해제/재claim을 입증할 수 없다. 임의 추정 owner, 시간 경과만으로 해제는 금지한다.
3. legacy outbox 명시 조정. 현재 legacy는 분류/거절이며 변환·이미 수락 여부 판정·사용자 복구 흐름 전체가 없다. receipt 없는 과거 결과를 자동 수락으로 인정하지 않는다.
4. 위 상태와 snapshot/lock/admission fence를 연결한 실제 프로세스 강제종료·재시작·서비스 종료/OS 로그인 시작 시험. 단순 객체 재생성 시험과 실제 OS 종료를 구분한다.
5. protocol capability 양측 검증, 대기 업무/예약/outbox 영향 확인, 롤백 계획 뒤 활성화·운영 시험. gate0을1로 바꾸는 것만으로 완료하지 않는다.

**journal 설계 메모(아직 구현 아님):** claim 전 bounded 고정 의도 기록, 응답 후 검증 owner, 원자 temp→flush→rename; 저장된 정확한 outbox와 owner/binding 일치 때만 journal 정리. unknown/충돌/empty-outbox를 자동 clear하지 않는다. Windows 전원 장애 내구성은 프로세스 재시작 테스트만으로 보증할 수 없다.

**주요 경로:** `server/file-outbox.mjs`, `outbox-recovery.mjs`, `desktop-bridge.mjs`, `desktop-service.mjs`, `desktop-http.mjs`, `worker/delivery-*`, `scripts/desktop-bridge.mjs`; 계획은 `docs/superpowers/plans/2026-09-28-delivery-receipts.md`.

### H5. 자동 모델 선택·승격의 실제 증거 (MOD-01~05,07 / 일부 승인 대기)

**구현됨:** 공식 후보 수집/조건부 갱신/만료, Codex 계정 모델 목록, 배정 이유/정책/고정·복구 기반, 일반 실행/검토/사용량 관측·보관 및 관리 UI. 이것이 자동 최적화의 실운영 완료는 아니다.

**현재 장애:** actualModelVersion이 null인 경로와 non-null modelVersion을 요구하는 promotion 조건, parent/batch별 comparisonId 때문에 정상 관측이 자동으로 동등 비교 쌍을 만들지 못한다. `model_policy_availability`의 운영 writer 및 중대 회귀 분류도 확인해야 한다. 기존 독립 관측의 `critical:false`를 모든 실패의 자동 중대 오류 판정으로 바꾸지 않는다.

**결정:** CR-004 A(관측된 실행 경로를 별도 평가 단위로 추가) 또는 B(내부 실제 버전 증거까지 자동 승격 보류)는 미승인이다. A를 선택하더라도 실제 serving version=null은 유지하고 비교 범위/한계를 명시한다. 해당 결정 전 정책 의미를 몰래 바꾸지 않는다.

**완료 증거:** 동일 입력/자료 hash/도구/완료 기준으로 적격 비교, 현재 계정 가용성, 독립 품질 기준 전체 통과, 실측 비용·시간, 회귀 시 새 배정만 철회, 실행 중 배정 보존, pinned 정책 우선, 양 provider의 실제 제어 가능한 모델 경로를 확인한다. Claude 고정 Routine master와 요청한 하위 alias를 같은 실제 모델로 보지 않는다.

### H6. 추가 비교 평가의 실행 제한·정산 (MOD-06 / 승인된 기반, 운영 미완료)

**구현됨:** 불변 job 한도·예약/정산 reducer, local/D1 CAS ledger, task claim+reserve 원자 결합, Codex 내부 deadline/close 관측, bound 실행의 일반 delegation/handoff 우회 방지.

**남음:** Windows 프로세스 트리 containment 및 종료 입증 → durable trusted completion receipt → 원자 정산 → 전용 comparison job 생성/기준선·후보·독립검토/모든 phase 예약 → 예산·예약·초과·미확인 UI. `rootProcessClosed`는 자식 프로세스/원격 추론/과금 종료 증거가 아니다. 이를 종료 capability 광고나 자동 정산 근거로 승격하지 않는다. Claude의 강제 시간 종료 능력이 검증되지 않으면 그 비교 경로를 시작하지 않는다.

**완료 증거:** claim/예산 CAS 경쟁, 준비 중 시한 만료, kill 실패/close 지연, 프로세스 트리 잔존, 시작·종료 응답 유실, 재시작 후 미정산 예약 유지, 모든 phase 예산 소비, 사용자 예산0에서 추가 AI 실행0. 새 native helper/런타임이 필요하면 먼저 변경요청 절차.

### H7. 에이전트 수·구성의 유동적 최적화 (원래 기획, MOD 연계 / 미완료)

현재 관리 협업은 Codex1+Claude1의 두 자식 기반이며, 네이티브 지침도 동시2/총6역할 등의 상한이 있다. 임의 개수의 상시/임시 에이전트 생성·편집·삭제·동적 최적화 전체가 아니다.

작업 난도·의존성·자료 범위·오류 비용·가용성·예산에 따른 배정 수/모델 계획, 단일 executor 유지 조건, 변경/삭제 시 owner·epoch·생성 결과 보존, 각 역할 최소 문맥, 마스터 독립 검토·실패 escalation 제한을 설계·검증한다. 모든 요청에서 병렬화하는 것을 효율로 간주하지 않는다. 고정2를 가변 N으로 바꾸면 자식 수/저장·토큰·검토·복구 전 경계를 함께 검증한다.

### H8. 자료·연구·일반 산출물의 실사용 품질 (SRC 및 원래 기획 / 부분 구현)

- 파일/폴더: 임시 연결·재연결·선택 범위와 hash·두 제공자 협업은 구현되어 있지만 모든 형식/무제한 용량이 아니다. 실행에 전달하는 발췌 materials 최대20개/총600000 UTF-8바이트와 첨부 metadata 최대5000개 등 서로 다른 경계를 확인하고 큰 자료의 부분 읽기/형식 확대/오류 UX를 실제로 검증한다. 끊긴 로컬 원본은 재연결 대기로 남겨야 한다.
- 문헌: 선택 문헌 비교·주장 근거·아이디어, 선택적 RefAtlas 파서는 있다. 지속 수집·갱신·검색 색인·중복·철회논문·인용 정확성 평가와 추적 가능한 아이디어 구체화는 남아 있다. “학습”을 모델 가중치 미세조정으로 표현하지 않는다.
- 연구 데이터: 일반 분석과 선택적 식별/계보 기반을 실제 합성→측정→분석 데이터로 검증해야 한다. 단위/정밀도/원시 수치/조건/출처/재현 코드와 연결된 결과의 정확성이 완료 기준이다. NanoLab/Prism 없이 같은 핵심 여정이 가능해야 한다.
- 논문/Figure/CV/지원서/제안서/보고서/PPT: 공통 생성 지침, 파일 전달, Office 컨테이너/검증 보고/Python 검사 도구는 있다. 각 대표 실제 작업의 내용·수치·인용·레이아웃·렌더링·파일 회수·독립 품질 검토를 완성해야 한다.
- 과거 실제 Codex 합성1페이지 PDF 성공은 다른 문서 유형/Claude/과학적 정확성의 증거가 아니다. 생성·렌더러가 없으면 제한을 표시하며 text를 DOCX/PPTX/PDF로 위장하지 않는다.

### H9. 다중 기기·UI·장기 운영·비용 관측 (SRC-05/06, MOD-05/07, REL / 검증 잔여)

반응형 UI·선택지·동기화 충돌·자료 재연결·복구 화면이 있지만 실제 휴대폰 제스처/키보드/접근성/긴 화면/회전·복귀, 여러 기기 동시 수정·계정 변경·오프라인 복귀를 총괄 검증해야 한다. 뷰포트 에뮬레이션만으로 실물 휴대폰 완료를 선언하지 않는다.

정상/실패/위임/전환/검토 등 보고된 사용량 및 캐시 표시 기반이 있지만 실행 중 실시간 스트리밍·강제 종료 전 미보고량·계정 전체 잔여량 자동 동기화는 남거나 제공자 제약이 있다. 구독 잔여량을 API 요금표로 환산하지 않는다.

장기 반복/파일 증가/대규모 이력·동기화/무료 구간 소모·복구·새 모델 갱신 실패를 부하 시험한다. 보관 예외에서 활성 근거 보호와 축적 상한이 충돌할 때 표시·정리 정책이 필요하다. OS 로그인 자동 시작은 등록 완료로 간주하지 않는다. 무한 poll/재시도/대화 전체 재주입을 정상화하지 않는다.

### H10. 운영 릴리스 및 전체 완료 재감사 (REL-01 / 미완료)

개발 브랜치 전체 차이를 독립 리뷰하고, 비활성 기능·마이그레이션·기존 미전달 결과·Claude checkout·데스크톱/Worker/Pages 호환성을 확인한다. 필요한 승인된 테스트와 실제 구독 최소 검증 후 main/Worker/Pages/desktop을 일관된 버전으로 반영한다. 활성 작업을 끊거나 pending/예약/비밀파일을 지우지 않는다. 릴리스 후 인증 거절·상태·정적 자산·결과 회수·원본 비보관을 검증하고 롤백 기준을 기록한다.

전체 완료는 최초 사용자 요구 각각의 현재 코드·실제 산출물·기기·운영 근거로 다시 판단한다. 테스트 개수나 하위 마일스톤 완료만으로 전체 완료를 선언하지 않는다.

## 6. 권장 재개 순서 및 즉시 시작하지 말아야 할 것

1. `codex/source-release`의 handoff와 코드 `f4a38ab` 이후 문서 변경을 확인하고, 첫 작업은 **독립 전체 검토 결과/우선순위** 작성으로 시작한다.
2. H1~H3를 통해 문맥 기능의 남은 종단을 마무리한다. 큰 입력 차단을 임의 해제하지 않는다.
3. H4의 journal/unknown-owner/legacy를 해결하고 receipt 운영 활성화 증거를 모은다. H6 실행 containment는 독립 담당으로 병렬 연구 가능하나 미검증 capability를 노출하지 않는다.
4. CR-004는 사용자 결정을 요청할 별도 항목으로 제시한다. 승인된 나머지 작업을 이것 때문에 모두 멈추지 않는다.
5. H7/H8/H9를 실제 사용 사례와 완료 기준으로 WBS화하고 단계별 검증한다. H10 릴리스/최초 요구 대조는 각 릴리스와 최종에 반복한다.

금지할 지름길: API 유료 전환, 무제한 무료/무손실/최신=동급 성능 주장, null serving-version 위조, 평가 budget0 우회, journal 없이 gate1 운영 활성화, 원본 영구 복사, 다른 INNO 앱 강제 의존, 늦은 결과를 새 owner로 재라벨링, 과거 로그만 보고 재실행 검증 완료 주장.

## 7. 검증 근거와 재실행 명령

이번 코드 `f4a38ab`의 전체 Node 검증: **1098건, 1097 pass, 0 fail, 1 skip**. skip은 `symbolic links are rejected without following their payload` — Windows host가 symbolic link를 만들 수 없다는 기존 환경 제한이다. 이 케이스 통과로 계산하지 않는다.

- 전체 로그: `.inno/tmp/ctx-stage2d1-full.log` (로컬·gitignore, GitHub에는 없음).
- Stage2D1 독립 focused19/19, core14/14(기존 포함), adapter 최신5/5.
- Stage2C 독립 cloud16/16·local58/58, 전체1085pass/1skip. Stage2B2 전체1074pass/1skip. 이들은 각 당시 코드의 기록이다.
- 이번 Wrangler dry-run:64 assets, total356.90KiB/gzip83.34KiB, exit0. 실제 deploy 아님.
- 이번 문맥 단계에서 Python 도구는 변경하지 않았고 Python suite를 새로 실행하지 않았다. CI는 Node와 Python을 모두 실행하도록 구성되어 있다. 향후 실제 CI 결과와 구분한다.
- 새 CR005 실제 구독/실물 휴대폰/장기부하/전원차단 검증은 미실행이다.

Windows PowerShell (해당 개발 worktree에서):

```powershell
Set-Location 'E:\Develop\INNO Workspace\.inno\worktrees\source-views'
$env:TEMP = Join-Path (Get-Location) '.inno/tmp'
$env:TMP = $env:TEMP
npm test
# 범위별 검증 예:
node --test --test-isolation=none tests/task-context-selection.test.mjs tests/context-selection-adapters.test.mjs tests/local-context-access.test.mjs tests/cloud-context-guidance.test.mjs
git diff --check
npx --no-install wrangler deploy --dry-run --outdir .inno/deploy-check
```

이번 검증은 이미 설치된 Wrangler4.131.1의 캐시 실행파일을 사용했다(2026-10-03 Claude 확인: 실제 사용한 캐시는 `E:\Develop\INNO Workspace\.inno\npm-cache\_npx\c943b712072b77c4\node_modules\wrangler`, 버전 4.135.0. PowerShell PATH에는 node/npm이 없어 `%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`(v24.19.0)로 실행). `npx --no-install`이 설치를 찾지 못하면 기존 런타임 위치를 확인하고 자동 새 설치·버전 변경을 하지 않는다. 승인된 Python 명령은 이용 가능한 번들 Python으로 `-B tests/test_verify_deliverable.py`; Linux CI는 `python3 -B tests/test_verify_deliverable.py`다.

클라우드 checkout은 실제 checkout 디렉터리에서 Node>=24와 저장소 CI 명령을 사용한다. Windows `.cmd`, 절대 E: 경로, Codex 데스크톱 런타임 경로를 클라우드에서 그대로 실행하지 않는다.

## 8. 실행·설정·비밀정보 주의사항

- `Start INNO Workspace.cmd`와 `Start INNO Cloud Bridge.cmd`는 데스크톱 브리지 시작이다. 기본 loopback4175를 사용한다. 같은 포트/프로세스를 두 번 시작하지 않는다.
- `npm run preview`/`scripts/preview.mjs`는 별도4174이다. 과거 EADDRINUSE는 중복 listener와 구분해야 한다. 바인딩 전 실제 PID/사용 중 작업을 확인하며 무조건 프로세스를 죽이지 않는다.
- 로컬 전용 실행과 클라우드 연결 실행의 DB/작업/계정을 섞지 않는다. main 체크아웃에서 실행한 프로그램은 worktree 코드 변경을 자동 사용하지 않는다.
- `.inno/`에는 access token·DB·outbox·실행 자료·로컬 로그가 있다. `.env*`, `.dev.vars`, `.wrangler/`, 로그와 함께 Git에서 제외된다. 전체 폴더 zip/업로드/대화 출력 금지. 비밀값이 아니라 필요한 키 이름/설정 상태만 확인한다.
- `.inno/cloud-access-token.txt`, `.inno/desktop-access-token.txt`, `.inno/DESKTOP-ACCESS.md`의 내용을 이 문서/GitHub/Claude 프롬프트에 붙이지 않는다. `DESKTOP-ACCESS.md`의 링크 fragment도 비밀이다.
- Claude 콜백은 전용 클라우드 환경의 호스트 인증과 실행 capability가 필요하다. 과거 연결 성공은 새 checkout/새 환경의 연결 증거가 아니므로 읽기 전용 확인 후 실제 scoped callback을 검증한다.
- 이 인계는 Routine 모델 변경·새 계정·자동화 생성·추가 평가 예산 부여가 아니다.

## 9. Claude에 붙여 넣을 시작 요청

> INNO Workspace 저장소의 `codex/source-release` 브랜치를 사용해 주세요. 먼저 `docs/HANDOFF-CLAUDE.md`, `AGENTS.md`, 승인된 PRD와 현재 PROGRESS를 읽고 코드/테스트/운영 증거를 대조하여 전체 플랫폼을 독립 검토해 주세요. 제품 코드 기준은 `f4a38ab`이며 이후 인계 문서 커밋이 있을 수 있습니다. main은 이전 운영 버전입니다. 최초 요구 전체를 유지하되, 완료된 기능·코드만 있는 기능·실사용 미검증·미구현·외부 제약을 구분해 우선순위를 제시하고 승인 범위의 남은 작업을 순차 수행해 주세요. 기존 구독만 사용하고 API 유료 전환이나 원본 영구 업로드를 하지 마세요. CR-004는 미결정이며 receipt gate는0입니다. 토큰 절약을 위해 이 handoff를 시작점으로 삼고 필요한 코드만 읽되, 직접 검증 없이 이전 완료 주장을 신뢰하지 마세요. 추가 AI 비교는 기본 예산0이며 전체 목표 완료 전에는 완료했다고 선언하지 마세요.

Claude 웹 대화에 이 문서만 첨부하면 로컬 E: 소스나 `.inno/`가 자동 제공되지 않는다. 로컬 Claude Code는 위 worktree에서 시작하고, 클라우드 Claude Code는 GitHub의 해당 브랜치를 checkout해야 한다. 비밀파일을 전달해 이 차이를 우회하지 않는다.
