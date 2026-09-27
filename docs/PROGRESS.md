# SDD ledger — plan: docs/IMPLEMENTATION.md

User approved implementation; input files/folders are connected references, not permanently uploaded.

| Review pair | Interface check | Finding |
|---|---|---|
| 1/2 | attachment descriptors | Content forbidden in storage; explicit allowlist |
| 1/3 | Task and action API, shared reducer | Same schema used by offline and server |
| 2/3 | AttachmentSession and research exports | UI retains in-memory File handles only |
| 1 | executor state/auth/persistence | Missing remote config must fail visibly |
| 2 | source imports/read budgets | Original files untouched |
| 3 | offline/remote transitions | Failed cloud writes must not appear synced |
| 4 | source delivery | GitHub code only; private user inputs excluded |

Ruling: new dedicated repo inside the writable workspace isolates existing E: apps without a worktree from the empty parent repository.
Ruling: SQLite/D1 replaces the candidate new Firestore task DB to share transactional code across local/cloud; existing Firebase adapters stay separate.
Ruling: no Sites lifecycle because approved design explicitly uses GitHub/Cloudflare hosting for the integrated application.

Task 1: implementation and verification complete; Worker/D1 deployed and live persistence verified; Claude Routine authenticated roundtrip verified on 2026-09-14 (task read, artifact writes, final answer, completed state).
Task 2: complete, including extraction/provenance review fixes.
Task 3: complete with desktop/mobile browser checks and offline CAS fix.
Task 4: GitHub source and Pages published, Cloudflare Worker/D1 deployed. Live auth and persistence verified. Personal onboarding kept outside Git in .inno/CLOUD-ACCESS.md.

2026-09-14: Cloud Codex queue and desktop bridge first slice deployed, real subscription roundtrip verified. See DESKTOP-BRIDGE.md for supported flow and remaining scope.

2026-09-14: Desktop localhost source reconnection and guarded expired-result recovery implemented. Existing local-only records remain separate; no automatic source archival.

2026-09-14: Read-only local SQLite selection and JSON record import deployed. Same-source deduplication, explicit conflict copies, and no-overwrite behavior verified. Local source DB currently contains zero tasks. Full suite: 97 passing tests.

2026-09-14: Interruption policy adds safe quota/auth/network failure categories, bounded recovery guidance, and checkpoint preservation across failure, unavailable runner, Claude launch and desktop expiry. Automatic AI replay remains disabled; saved result delivery retains retries. See INTERRUPTION-RECOVERY.md.

2026-09-14: Incremental bounded Codex event collection, bounded diagnostic suffix, explicit output-limit recovery guidance, and nonrecursive empty-run cleanup deployed.121 tests pass; real subscription result delivery and empty-folder removal verified. See RUNTIME-RESOURCES.md.

2026-09-20: Desktop storage usage view and explicit selected completed-run cleanup implemented and deployed. Active/pending work, changed files and linked paths are protected.128 tests pass; live read-only inventory verified. See STORAGE-MANAGEMENT.md.

2026-09-21: Revision-conditional sync deployed on Worker, local server, desktop proxy and browser client. Unchanged polls skip task/usage reads and payloads while preserving presence metadata. Stale responses cannot regress client state.134tests pass. See SYNC-EFFICIENCY.md.

## 2026-09-21 — 첫 문헌 작업 흐름

선택 RefAtlas 문헌 2~8편의 임시 근거 패킷과 비교/아이디어/AI 자기검토 요청을 구현하고 실제 구독 실행으로 세 결과물 저장을 확인했다. 원문은 요청 기록에 포함하지 않는다. 사용법은 LITERATURE-WORKFLOW.md, 전체 요구 대비 남은 작업은 REQUIREMENTS-STATUS.md 참조. 다음 우선 단계는 산출물 누락·근거 연결의 자동 점검 및 검토 실패 처리이다. 전체 플랫폼 완료를 의미하지 않는다.

## 2026-09-21 — 문헌 결과 형식 점검

최신 실행의 문서 누락·빈 내용·중복·문헌 번호 문제와 보고된 검토 실패를 화면에서 점검한다. 수정 요청 준비는 초안만 작성하며 자동 재실행하지 않는다. 원문 사실성 검증이나 독립 검토 실행 복구는 아직 남아 있다.

## 2026-09-21 — 별도 검토 복구 경로

원래 자료와 최신 비교 결과를 별도 검토 작업으로 전달하는 경로 추가. 원래 하위 에이전트 오류의 상세 기록은 남아 있지 않아 근본 원인은 확정하지 않았다. 새 경로는 하위 호출 없이 직접 검토하도록 요청한다. 주장별 근거 판정은 AI 검토이며 자동 사실성 인증은 아니다.

## 2026-09-21 — 실험 연결 첫 흐름

실제 앱 스키마를 확인해 NanoLab serial → Ledger lotId/Run id → 사용자 지정 Prism 결과 연결을 구현했다. 원본은 세션에서 조회하며 허용된 메타데이터와 주요 분석값만 작업에 연결한다. 로컬 Ledger HTML에 백업 후 색인 내보내기를 추가했다. 웹 Ledger 배포는 변경하지 않았다. 자동 파일 동일성 검증·전체 합성/측정 데이터 통합은 후속 범위이다.

## 2026-09-21 — Ledger 의존 제거

사용자 요청에 따라 NanoLab 시료 + Prism 분석 직접 연결을 기본값으로 변경했다. Ledger는 선택한 경우에만 사용한다. 직접 실험 ID는 기존 Run ID와 구분한다. 가상 자료로 Ledger 없이 시료 선택·연결 확인·작업 준비 전달을 검증했다.

## 2026-09-21 — 실행 사용량 전달

데스크톱 브리지의 사용량 누락을 수정하고 SQLite/D1 결과 저장과 함께 checkpoint에 관측값을 기록한다. 재전송·취소·소유권 충돌 검증과 작업별 최근 실행 표시를 추가했다. 기존 로컬 실행의 소유권 확인 전 제공자 사용량 쓰기를 제거했다. 구독 잔여량과 전체 누적 집계는 별도 미완료 항목이다.

## 2026-09-23 재개 — 현재 상태

* 진행 중인 WBS 항목: W0, docs/PRD.md 및 검증 명령 승인 대기
* 마지막 갱신: 2026-09-23
* 작업 트리: E:\Develop\INNO Workspace\.inno\worktrees\source-views; 기준 커밋 92eb3ce
* 사용자가 예약을 직접 삭제하고 즉시 재개 요청. main 반영·Cloudflare 배포 승인은 유효하며 준비/검증 후 실행.
* 이번 재개에서는 읽기 분석과 문서 준비만 수행. 기존 397개 통과 기록을 새 검증으로 주장하지 않음.

### 요구사항별 상태
|ID|상태|비고|
|---|---|---|
|SRC-01|미완료|자료 준비 공통 모듈 존재; UI 재연결 미연결|
|SRC-02|부분 구현|메모리 조정기 존재; 탭/새로고침/명시 복구 미완료|
|SRC-03|부분 구현|버전·부모 차단 테스트 존재; 계정 전환 생명주기 미완료|
|SRC-04|부분 구현|서버 지원 버전/모의 제공자 기반 존재; 실제 통합 검증 남음|
|SRC-05|미완료|조정기 UI 미연결|
|SRC-06|부분 구현|파일/바이트/대기기록 제한 존재; 통합 반복·누적 검증 남음|
|REL-01|대기|배포 승인됨; 현재 마일스톤 검증 후 진행|

기존 상세 설계/실행 계획은 PRD의 참조를 따른다. 새 스택 도입 없음. AGENTS.md 변경은 CR-001 및 검증 명령 승인 후 추가만 한다.

### 2026-09-23 승인 후 W1 착수

사용자가 PRD와 검증 명령을 승인했다. 기존 AGENTS.md 섹션을 보존하고 승인 명령/프로젝트 구조를 추가했다(CR-001). W0 완료, W1 구현·독립 검증 진행. main/배포 승인 유지. 구현자와 검증자를 분리하며 W1 통과 전 W2 구현하지 않는다.

개발 모델 선호: 사용자 요청으로 Sol 6.0을 범위가 명확한 후속 구현/검증에 고려한다. 품질 동등성을 단정하지 않으며 테스트/독립 리뷰로 확인. 진행 중인 에이전트는 비용 낭비를 피하기 위해 교체하지 않음(CR-002).

### W1 독립 사전 검토

D1 claim은 expectedVersion CAS 및 자식 부모 status/batch/epoch SQL 조건으로 경쟁을 방어한다. 부모 version만의 변경은 클라이언트 추출/전송 전 확인이며 서버 원자 조건과 구분한다. 미해결: 메모리 uncertain의 reload 소실, client 교체 후 영구 차단, 복구/정리 흐름.

검증자는 구현자와 분리하여 아래 시나리오를 제시했다. W1 단위 계약 통과 후 W3에서 실제 HTTP/서버 경합을 검증한다.
1. claim 성공 응답 유실 및 서버 도착 지연 중 coordinator 재생성
2. 두 클라이언트 동시 child/review claim: 실제 provider 시작 최대 1회
3. 추출·refresh·CAS 전후 부모 pause/epoch 변경
4. A 계정 읽기 중 B 전환: A 자료 전달 차단 및 B 정상 재개
5. uncertain은 queued 조회만으로 해제하지 않고 종료 확인/버전 전진 후 복구
6. 100개 한도와 terminal/삭제/계정 전환 정리, 원문/예외 메시지 저장 없음

현재 사전 검토는 읽기 분석이며 테스트 실행 결과가 아니다.

### W1 독립 검증 / 수정 1회차

Sol 6.0 검증자가 전체 Node 410/410 통과 및 diff check를 확인했다. 그러나 별도 재현에서 journal 중복 taskId 행이 Map 변환으로 덮어써져 uncertain 기록이 source_error로 바뀌고 reconnect 후 재전송되는 손상 기록 경로를 발견했다. W1은 아직 통과 처리하지 않는다. 구현자에게 중복 ID fail-closed 및 회귀 테스트를 요청(동일 오류 수정 시도 1회차). UI 작업은 W1 재검증 후 착수한다.

### W1 통과 / W2 착수

2026-09-23 Sol 6.0 독립 재검증: 중복 taskId fail-closed finding 해결. 전체 Node 411/411 통과, diff check 통과(.inno/w1-independent-tests.log). W1 코어 계약 완료; SRC-02/03 전체 사용자 흐름은 W2/W3 검증까지 부분 완료 상태 유지. 동일 오류 수정 1회로 해결. W2 재연결/상태 UI 연결 착수.

### W2 브라우저/독립 검증 중간 결과

별도 Sol 6.0 검증자 전체 Node 418/418 통과(.inno/w2-independent-tests.log), diff check 통과. Main은 루프백 메모리 TestD1+실제 Worker 라우팅+모의 Claude fire를 사용해 부모 화면 필요 원본/배정 모델 표시, 동일 파일 재연결, Claude child running(version3), 새로고침 후 원본 재연결 요구를 확인했다. 390x844 모바일 상세 패널에서 원본 카드와 버튼을 시각 확인했고 console error 없음. 원래 계정·운영 DB·유료 API는 사용하지 않았다. 브라우저 검증은 전체 혼합 제공자 결과 회수/복구 완료 증거가 아니다. UI 내부 용어를 행동 중심으로 수정 중이며 독립 최종 결과와 최신 테스트 후 W2를 완료 처리한다.

### W2 완료 / W3 재개 지점

W2 독립 최종 리뷰: 치명적 결함 없음, 전체418/418 통과. 이후 안내 문구만 사용자 행동 중심으로 수정했고 관련7/7 및 구문/diff 검사 통과. 로컬 브라우저 시험 서버와 생성 탭을 종료했고 뷰포트 설정을 복원했다. W2 구현 완료; W3의 실제 HTTP 경합·응답유실·부모 pause/lease/outbox·서로 다른 원본 범위의 혼합 제공자 전체 검토 흐름은 남아 있다. 기본 기능 게이트는 여전히 꺼져 있으며 운영 배포하지 않았다.

다음 작업: 기존 tests/source-dispatch.test.mjs 및 delegation-http.test.mjs 기반으로 위 W3 시나리오를 독립 검증한다. 실제 구독 시험은 모의 시험으로 입증 못한 경계만 최소 실행. W3가 통과하기 전 기능 게이트를 켜거나 운영 배포하지 않는다. main/Cloudflare 승인, PRD/검증 명령 승인 유효. Sol 6.0은 범위가 명확한 구현/검증에서 사용 중이며 Astra는 통합 판단 담당.

## 2026-09-27 W3 통합 검증 재개

기준 3ce009a clean 확인 후 W3 테스트 구현을 Sol 6.0에 위임했다. 원래 체크아웃의 사용자 변경 4a93387(GitHub 조직 INNO-KAIST 이관)을 발견하여 merge258e478로 보존 통합했다. wrangler.jsonc 충돌은 새 CORS_ORIGINS와 기존 5분 cron을 모두 유지; 관련 research12/12 통과. 별도 PRD 범위 확장이 아니라 기존 사용자 변경 보존이다.

기존 캐시 Wrangler4.131.1의 deploy --dry-run 성공(실배포 아님); PATH에 npm/npx가 없어 기존 wrangler.js를 Node로 직접 실행했다. 조직 이관 통합 뒤 릴리스 검증을 다시 수행할 예정. 운영 상태 읽기 조회: HTTP200, revision74, 12 tasks(completed10/cancelled1/paused1), active execution 없음, Claude Routine configured, desktop offline. 토큰/작업원문 출력 없음. 새 소스 협업 게이트는 아직 활성화하지 않음.

2026-09-27 사용자 신규 요구 CR-003 기록: 두 제공자의 모델 출시·성능·토큰 특성 변화를 자동 인지하고 선택 기준 갱신. 현재 W3 작업은 유지하며, 제품 코드 즉시 수정 없이 마일스톤 후 PRD 반영 여부 확인(운영 원칙2). Python 산출물 검증4/4 및 조직 이관 후 Worker dry-run 성공.

### W3 검토 및 릴리스 이력 주의

HTTP 통합4case 현재 대상4/4 통과. 처음 MCP checkpoint 최종산출물 문구 예상 불일치1건은 테스트 정정1회로 해결; 제품코드 수정 없음. 독립 검토는 원본 파일명/생성 reviewInputs 확인과 실제 runner의 원문 재조회가 다른 증거임을 명시했다. concurrent Promise.all만으로 양쪽 pre-CAS read 증거가 충분하지 않아 결정적 barrier 보강을 요청. source bridge lease/outbox는 별도 테스트 파일에서 보강 중.

2026-09-27 원격 fetch: origin/main 강제 갱신 ec191bd→d989175, 로컬 HEAD와 공통 조상 없음. `git diff --stat origin/main ec191bd` 출력 없음으로 기준 코드 트리 동일함 확인. 릴리스 시 force-push/옛 이력 병합을 하지 않고 최신 origin/main 기반 별도 통합 브랜치에 검증된 트리 변경만 적용하고 재검증한다. 현재 원격 쓰기/배포 없음. 기존 사용자 조직 이관 4a93387의 변경도 보존해야 한다.

### 2026-09-27 W3 테스트 체크포인트

신규 HTTP/bridge 테스트 6개를 독립 Sol 검증자가 검토하고 전체424/424 통과를 보고했으며 로그를 메인이 직접 확인했다. 검증자는 이후 사용량 한도로 종료; 보고와 로그는 보존됨. 두 요청이 같은 버전의 UPDATE에 도착한 것을 barrier로 확인하고 SQL CAS 단일실행을 검증했다. 원본 자료를 사용하는 bridge의 완료응답유실 뒤 새 bridge 인스턴스에서 보관된 결과만 재전송함을 검증했다. outbox는 메모리 box 모의 객체이므로 실제 디스크 영속성/OS 프로세스 재시작의 증거로 주장하지 않는다.

메인이 소규모 추가 검증으로 이미 만료된 lease 상태를 주입한 원본 child의 HTTP poll→paused→종료확인 없는 복구400→명시 복구queued→원본자동claim없음→이전 owner결과409 및 완료 sibling 보존을 확인했다. 실제 시간경과를 기다린 시험은 아니다. 관련3/3, 최신 전체425/425 통과(.inno/w3-final-tests.log). 제품코드 변경 없음. 실구독 혼합 실행·실제 파일 outbox 프로세스 재시작·마스터 원문 읽기의 실제 실행 증거가 아직 필요하며 W3 전체 완료/기능 활성화/운영배포는 보류.

다음: 남은 실제 경계 검증을 최소 구독 사용으로 수행하고 W3 완료 후 W4 최신 origin/main 기반 트리 적용·릴리스 검증. CR-003 모델 자동 최신화는 아직 제품 구현 승인 전 변경요청이며 마일스톤 후 PRD 반영 확인. 새 목표로 원래범위를 대체하지 않는다.

### 2026-09-27 W3 파일 outbox 프로세스 재시작 검증

Sol 6.0 구현자가 기존 desktop-bridge 인라인 저장을 server/file-outbox.mjs로 동작 변경 없이 추출하고 실제 Node 자식 프로세스 두 개를 사용하는 검증을 추가했다. 첫 프로세스 종료 후 두 번째가 runner/poll 없이 보관 결과만 재전송, 전송 실패 중 파일 유지, 성공 후 삭제, 손상 JSON 차단을 확인했다. 구현자 보고: 전체 Node 427/427, 대상 2/2 및 diff check 통과. 메인 통합 리뷰에서 기존 저장 동작 보존을 확인하고 테스트 제목/오류 문구를 실제 입증 범위로 정정한 후 대상 2/2 및 diff check를 직접 확인했다. 실제 서버 수신 후 응답 유실은 기존 HTTP 테스트의 증거이며 이번 프로세스 테스트 자체는 모의 전송이다. 정상 프로세스 종료/재시작의 증거이며 전원 손실/fsync 내구성 보장은 아니다. W3 실구독 혼합 실행과 마스터 원문 읽기 경계는 여전히 남아 있고 게이트/운영 배포는 변경하지 않았다.

CR-003은 모델 출시 자동 감지뿐 아니라 계정 가용성, 작업 종류별 품질 검증, 실측 토큰/지연, 미보고 값 구분, 선택 근거와 정책 복구를 포함한다. 현재 PRD에 승인된 구현으로 표시하지 않으며 현 마일스톤 완료 후 PRD 개정 승인 대상으로 유지한다.

메인 최종 전체 검증: Node 427/427 통과(.inno/w3-outbox-tests.log). 정상 종료 뒤 파일 기반 재전송 체크포인트를 로컬 커밋하며 실구독 경계 검증을 이어간다.

### 2026-09-27 W3 릴리스 경계 읽기 검토

별도 Sol 검토자는 원본 범위 검증 우회 결함을 발견하지 못했으나, worker 기본 export와 desktop runner의 sourceDelegationVersion이 모두 0이어서 현재 트리 배포만으로 기능이 활성화되지 않음을 확인했다. 이것은 의도한 검증 전 게이트이며 출시 완료로 표시하지 않는다. 양쪽 capability 교집합을 확인하고, 데스크톱 지원 준비 후 Worker를 활성화해야 한다. 구형 데스크톱만 연결된 상태에서는 Codex 원본 자식이 대기할 수 있다. 검토는 코드 읽기이며 실환경 증거를 대체하지 않는다.

실제 Codex master 원본 검토 1회는 격리된 합성 자료로 진행 중. 이후 혼합 제공자/클라우드 callback의 실제 경계 검증은 준비된 최신 origin/main 기반 릴리스와 연계하여 수행한다. W3 사전 검증과 배포 후 W4 실환경 검증을 구분하고, 운영에서 확인되지 않은 것을 확인 완료로 표시하지 않는다. 추가 유료 API나 원본 저장 서비스를 도입하지 않는다.

### 2026-09-27 W3 실구독 원문 검토 통과

실제 createCodexRunner 1회(session50939 exit0)로 합성 원본 두 개의 올바른 수치가 잘못된 child 요약/산출물보다 우선하여 최종 summary·review-findings.txt·두 exact review criteria에 반영됨을 확인했다. 메인이 result.json 직접 확인. 계정 기본모델 catalog gpt-6-astra, 강제 모델 지정 없음. 실측 input36,970/output716/cached input30,592; 유료 API/운영DB 변경 없음. 동일 child요약과 파일 내용 때문에 파일만의 독립 기여는 입증하지 않았고, 실제 Claude 및 전체 클라우드 혼합 결과 회수도 아직 미검증이다. 자세한 근거는 VERIFICATION.md.

다음 안전한 작업: 최신 origin/main 기반의 릴리스 체크아웃에서 검증된 트리만 옮기고(기존 이력 강제반영 금지), 데스크톱 지원과 서버 capability의 단계적 활성화를 준비한다. 전체 검증·사용자 조직이관·비밀 제외·독립 리뷰를 확인한 후 기존 승인 범위로 반영하고 실제 혼합 제공자/결과회수 경계를 최소 시험한다. 실패 시 게이트를 비활성으로 유지/복구하며 W3/W4 완료를 주장하지 않는다. CR-003은 현 마일스톤 후 PRD 개정 승인 대상으로 유지한다.

### 2026-09-27 W4 원격 이력 기반 릴리스 준비

작업 시작 clean/HEAD2e1bdc1 확인, origin/main fetch 후 기준 ec191bd와 트리 차이 없음. 앱 worktree 도구는 이 채팅의 저장소에서 origin/main을 찾지 못해 실패했다. 새 폴더를 중복 생성하지 않고 완료된 기존 격리 폴더를 재사용: 원래 codex/source-views(2e1bdc1)를 보존하고 codex/source-release를 origin/main(d989175)에서 생성했다. ec191bd..2e1bdc1 binary tree patch 적용 후 git diff 2e1bdc1 출력없음으로 동일 트리를 확인했다. 이력 강제병합/force push 없음.

릴리스 트리 재검증: Node427/427(.inno/release-tests.log), Python4/4, 기존 Wrangler4.131.1 dry-run 통과. 원격 D1 조회 결과 미적용 마이그레이션 없음. 실제 CI 파일은 .github/workflows/test.yml이며 PRD의 verify.yml 표기만 정정(승인 검증명령 변경 없음). 운영 read-only 조회: revision74, completed10/cancelled1/paused1, 실행중없음. 새 scoped callback 호환성을 위해 GitHub helper 반영 후 Worker 배포 순서를 유지한다. 최종 독립 통합 리뷰 진행 중; 실제 원격 코드/운영 배포 전 상태다. source gate는 아직0.

### 2026-09-27 릴리스 게시 및 운영 배포

독립 통합 리뷰: 확인된 배포 차단 결함 없음. main 정상 push는 처음 GH007(개인 이메일 공개 방지)로 거절되었고, 미게시 커밋에 GitHub 계정 noreply 주소를 적용하여 해결했다. 계정 공개설정 변경/force push 없음. main 커밋8207bbb, GitHub Verify run36312254246 success. 기존 사용자 배포 승인으로 Worker version8e9161d7-47a8-4861-a8f4-76b81d8eae5c 배포 완료. 원본 협업 gate0 유지.

배포 전 Claude Routine 편집 화면에서 이전 innokaist/INNO-Workspace 경로와 capability 없는 구 안내를 확인했다. 이미 연결 가능한 동일 이관 저장소 INNO-KAIST/INNO-Workspace로 교체하고 실행별 capability/renew_execution/고정배정·reviewReport 계약으로 지침을 갱신해 저장 상태 확인. 기존 환경·구독모델·연결권한은 유지했다. 화면 증거 .inno/routine-release-connection.png. 배포 후 인증 없는 state401, 정적 주요자산200, 인증state sourceDelegationVersion0 확인.

실제 Claude callback 시험 한 건을 시작: task1c797d64-1726-4d0f-9ef5-016e82e21101, execution d79b3903-c1c7-41e8-ae4c-dd771d766e59, session https://claude.ai/code/cse_01HNgd8YVTU787T1bHYherus. 마지막 조회 running/version3, artifact아직없음. 재시작하지 않고 동일 실행을 관찰한다. 아직 callback 성공/첨부 협업 출시 완료를 주장하지 않는다. Pages 수동 workflow도 최신 main으로 요청했다.

### 2026-09-27 배포 후 실제 Claude callback 통과

동일 시험 task1c797d64-1726-4d0f-9ef5-016e82e21101이 completed/version7로 종료했고 callback-check.txt 내용 INNO_CALLBACK_20260927_OK가 일치했다. 실제 Claude 구독→새 helper/executionCapability→운영 artifact 저장→완료 callback 경계를 1회 실행으로 확인했다(.inno/release-callback-result.json). Pages run36312501954 success, 실제 source-execution.mjs HTTP200. 인증 거절401 및 sourceGate0 유지도 확인했다. 전체 혼합 제공자/원본 첨부 협업 활성화는 여전히 다음 단계이며 이번 callback 성공을 그 증거로 대체하지 않는다.

### 2026-09-27 SRC-04/REL-01 원본 협업 옵트인 준비

Worker 실제 기본 export와 데스크톱 시작 스크립트가 동일한 `INNO_SOURCE_DELEGATION_VERSION` 문자열 `1`에만 버전 1을 선택하도록 연결했다. Worker fetch/scheduled는 같은 선택 함수를 사용하며 기존 테스트용 createWorker() 기본값 0과 서버·로컬 capability 교집합은 유지한다. 선행 RED에서 실제 기본 export의 버전 0을 확인했고 구현 후 대상 32/32, 전체 Node 429/429 통과(.inno/tmp/source-gate-node-tests.log). 실행·되돌림 절차는 DESKTOP-BRIDGE/DEPLOYMENT에 기록했다. 운영 변수·Wrangler 설정·실제 AI·배포는 변경하지 않았다. 따라서 W3 혼합 실험과 W4 운영 활성화는 계속 미완료다.

### 2026-09-27 원본 협업 활성화 준비

이전 goal turn은 main/Worker/Pages 실제 반영과 live Claude callback 완료로 진전됨. 이번 재개 clean/HEADcc07a53 확인. 실제 사용자 폴더 E:/Develop/INNO Workspace는 기존 codex/inno-workspace(4a93387)를 보존하고 codex/desktop-release를 origin/main에서 생성해 최신화했다. 전환 전 미커밋 변경, 4174/4175 listener, pending 결과 파일 없음 확인. 격리 구현 폴더는 codex/source-release 유지.

기본 비활성 gate를 서버와 데스크톱 각각 명시적 INNO_SOURCE_DELEGATION_VERSION=1로 활성화하는 운영 설정과 회귀검증을 Sol 구현자에게 위임했다. 별도 Sol은 실제 2child+1review 혼합 구독 시험의 단계별 스크립트만 준비 중이며, 양측 gate를 확인하기 전 실구독 시험/운영 task 생성은 하지 않는다. 신규 기능 범위 확장이 아닌 승인된 SRC04/REL01 활성화 작업이다.

### 2026-09-27 원본 협업 capability 활성화

Sol 구현/메인 독립 코드검토: 환경변수 INNO_SOURCE_DELEGATION_VERSION의 정확한 문자열1만 활성화, Worker fetch/scheduled 및 desktop runner 공통 판정. 실제 Worker export RED→GREEN, 전체429/429(.inno/tmp/source-gate-node-tests.log). 커밋27f30de. 실제 사용자 폴더에 ff 반영 후 숨김 desktop bridge PID26568 시작. 운영서버0/로컬1/교집합0을 실제 GETstate로 확인했고, busyfalse와 기존작업 completed11/cancelled1/paused1 확인.

Wrangler vars에1 명시, dry-run통과 후 커밋e8f3312를 정상mainpush, GitHub Verify36313001238 success. Worker version06f213ac-bde6-45b4-8bb8-140cb10a338c 배포. 이후 서버1/로컬1/교집합1/busyfalse 확인. 실제 MCP catalog에 gpt-6-luna low 등 계정모델이 제공됨을 읽기로 확인. 요청모델과 실제 관측모델을 구분한다.

현재 원본 협업 capability는 켜졌으나 마지막 실제혼합 시험을 아직 완료하지 않았다. 실행 중 desktop 프로세스는 사용자 폴더의 .inno/desktop-source-process.txt에 PID, stdout/stderr별도기록. 이번 시작의 환경변수1은 프로세스 범위이며 재시작 설정 영속화는 실험통과후 진행한다. 혼합시험 스크립트는 합성원본에 한정, 부모배정은harness이고 planningAI품질시험으로주장하지 않는다. 원격POST불확실시자동반복금지.

### 2026-09-27 실제 혼합 시험 — 파일 전달 누락 발견, gate 복구

합성 parent e29fec91-86fb-4181-b6db-7293744e8c03, Codex child a2fc5dcc-45e9-4763-aabd-ca50fdbf5881(gpt-6-luna 요청), Claude child92fa4902-ace1-4e1f-b424-3296a027e305(haiku 요청)가 각각completed, childgeneration1/parentreviewgeneration2. 기존smoke status 최종assert는통과했으나 메인의 산출물직접검토에서 중요한 전달누락을 발견했다. 따라서 W3 전체통과로처리하지않는다.

Claude child에는 beta-result.txt와final.md가저장됐지만 checkpoint.resultArtifactIds와 parent.delegation.review.children의목록에는final.md만있었다. 마스터는 beta-result.txt를제공받지못했다고정확히보고했지만 generic수치+textartifact기준은final.md로통과했다. 좁은smokeassert통과가전체생성파일전달을보장하지못했다. 원인추적/등록→완료→reviewInputs 회귀시험 및수정을 Sol에위임. 기존실험DB기록은변경하지않음.

안전복구: wrangler gate0으로되돌려 Worker3654b036-42b3-463f-b128-1f3932489cab 배포, 실제GETstate gate0확인. 데스크톱은support1이지만교집합으로새원본협업차단. 모든시험작업completed; AI 재실행없음. 사용량 actualCodexchild input17484/output77/cache11008, masterreview input38611/output1256/cache31360; Claude미보고는null, 배정모델haiku의실제served모델은미관측. 초기부모배정은harness이며AI계획평가아님. .inno/mixed-source-result.json에합성결과보존.

### 2026-09-27 생성 파일 전달 누락 수정 검증

원인: artifact_task로 등록한 파일의 실행소유자 표식이 없고 finishExecution의 resultArtifactIds가 완료 시 생성 파일만 포함. public/core/tasks.mjs에 검증된 소유자의 등록파일 executionId/generation 표식과 동일콜백중복방지, D1/SQLite finishExecution에는 같은소유자등록파일+완료파일선택을 구현했다. 과거실행파일은보관되나새결과선택에혼합되지않음. 실제MCP→등록→완료재전송→부모manifest→reviewInputs 및오래된소유자409 회귀 RED→GREEN.

구현자 전체432/432 통과, 메인독립코드검토 및 관련8/8 직접실행통과, Worker dry-run gate0통과. 과거완료된시험기록은수정하지않음. 기존등록파일에는owner표식이없어소급선택하지않으며 배포전실행중작업없음. 강화된 .inno/mixed-source-smoke.mjs는마스터실행전과최종검증에서실제artifactId 전달을확인하고, 과거실험에서누락을잡아RED확인했다. 기존smoke통과만으로완료선언하지않음.

### 2026-09-27 누락 수정의 실제 callback 확인 및 재활성화

수정 커밋f8dc81d/Worker f3b7669a-6c60-44d1-8ad6-7cc8ab5d74cc 배포 후 추가 Claude 실행은1건만사용했다. task3f3af851-988a-4cd5-9911-d6131a25281c completed/version6, owned-callback.txt 내용일치, 실행Id/generation일치, resultArtifactIds에 owned-callback.txt + inno-model-routing.json + final.md 포함을실제API에서확인(.inno/owned-callback-result.json). 수정전실험파일을소급편집하거나3실행혼합여정을재실행하지않았다. 수정후전체혼합구독3회를다시실행한증거가아니며, 기존혼합경계증거+수정경로8개회귀+실제등록/완료선택검증의조합이다.

서버gate1재활성화설정을반영한다. 전체플랫폼의유동적에이전트수/모델최신화, 실행중사용량, 실제연구·문서품질과기기장기운영은여전히미완료다. CR003은아직별도PRD개정승인대상. 기존실험의누락기록은그대로보존한다.

### 2026-09-27 현재 마일스톤 체크포인트

원본 협업 W3/W4 구현·검증·배포 완료 범위를 PRD에 갱신했다. 서버 Worker b48c5d2c-0ecc-445f-a715-18fb809d7390, 코드3f4248b, CI36314128571 success, Pages36314160045 success. 실제사용폴더는최신main코드로ff갱신. 사용자환경변수 INNO_SOURCE_DELEGATION_VERSION=1 영속설정 완료(기존터미널에는재설정/재시작필요). 실제 local GETstate 서버1/로컬1/교집합1/busyfalse/pendingfalse 확인. 데스크톱PID26568은계속운영, 별도예약생성없음.

전체목표는완료되지않음. 다음은 CR003 모델자동최신화와 유동적에이전트/품질·사용량최적화의 다음PRD를구체화하고, 사용자변경관리원칙에따라개정승인을받는것. 기존실험후수정에대한증거조합(432회귀, 실제혼합실행, 수정후Claude1회)을정확히유지한다. 수정후3실행혼합전체를재실행했다고주장하지않는다. 모든기기실물장기운영·모든연구/문서종류품질완료를주장하지않는다.

### 2026-09-27 CR-003 개정안 준비

MODEL-REFRESH-PRD-PROPOSAL.md에 MOD-01~07 및 M0~M5 초안을 작성했다. 공식 정보/계정 가용성/실행 관측 분리, 검증 후 승격 및 철회, 추가 AI 평가 기본 0회, 기록 상한과 UI를 제안한다. 제품 코드 변경 없음. 기존 승인 PRD는 유지하며 사용자 개정 승인 대기. Sol 분석가가 기존 구현과 누락 범위를 읽기 전용으로 확인했다.

### 2026-09-27 승인 대기 중 요구사항 기록 정합성 확인

직전 목표 턴은 PRD 제안 문서 작성으로 진행이 있었다. 이번 점검에서 REQUIREMENTS-STATUS.md 하단의 과거 비활성/배포 대기 기록이 현재 상태와 혼동될 수 있음을 발견해 과거 이력임을 명시했다. 현재 무료 운영 잔여 범위와 CR-003 승인 대기 순서를 정정했다. 기존 승인 PRD 및 제품 코드는 변경하지 않았다. 전체 목표 완료 아님; CR-003 구현은 사용자 개정 승인 대기. 문서 변경은 git diff --check로 확인한다.

### 2026-09-27 CR-003 승인 및 M1 시작
사용자 ‘모델 최신화 초안 승인’ 수신. PRD에 MOD-01~07/M0~M5 편입, M0 완료. M1은 계정 카탈로그 페이지 수집·오류/만료 처리와 공식 후보 수집을 순차 구현하고 독립 검증한다. 제품 배정 정책 변경은 M2에서 진행. 기존 source-release 작업 트리 재사용. 동일 오류 두 차례 실패 시 중단 원칙 유지.

### 2026-09-27 CR-003 M1 완료 — 계정 관측과 공식 후보 분리
- M0 승인 완료. M1 구현·독립 검토·전체 Node 450/450 및 Worker dry-run 통과. 로그 .inno/tmp/model-refresh-m1-tests.log, model-refresh-m1-dry-run.log. Python/제작 도구 변경 없음; 실제 AI 추가 실행 없음; 운영 미배포.
- Codex model/list 페이지 전체 수집(100개/20페이지/256KB/10초 한도), 형식·중복·커서 오류 거절, 병렬 조회 합치기. 실제 성공 observedAt를 실행기→기존 desktop transport→Worker로 전달. 캐시 재전송은 시각을 연장하지 않음.
- 레거시 배열은 진단 전용이며 배정 불가. SQL 원자 조건으로 오래된 성공·실패의 동시 덮어쓰기 방지. 갱신 실패 시 이전 검증 목록은 원래 2시간 만료까지만 허용, 이후 차단. 로컬 1시간 캐시 중 계정 전환의 즉시 탐지는 아직 없음.
- 공식 문서 후보는 하루 단위 조건부 조회, 고정 URL/인증정보 제외/리다이렉트 거절, 200KB·8초 제한, D1 lease와 소유자 조건 저장, 실패 백오프. 공개 후보는 계정 가용성 unknown, 승격 candidate 유지. 인증된 GET /api/model-discovery 및 기존 cron에 연결. 문서 형식 변경 시 마지막 정상 자료와 오류 상태 보존.
- 구현자 실제 공식 Markdown 조회: OpenAI 문서 slug100개, Claude 별칭4개 파싱 확인. 이는 구독 가용성이나 품질 증거가 아님. 문서 수집 fixture/HTTP 테스트10개 통과. timeout 오류명이 드물게 network_error일 수 있으나 제한 시간은 유지.
- 독립 리뷰에서 발견한 레거시 재갱신/동시성 문제 수정 후 검증. 최초 전체 회귀449개 중9개 실패는 구형 배열을 쓰던 정상 HTTP fixture 때문; 실제 관측 계약으로 갱신하고 구형 거절 회귀 추가, 전체450개 통과. 검증 단언을 완화하지 않음.
- 다음 M2: 작업별 평가 기준·증거/가용성·정책 버전·선택 이유 저장, 후보 승격/중대 회귀 철회, 실행 중 배정 고정. 이어 M3 실측·예산·기록 정리, M4 UI, M5 릴리스. 승인된 PRD 내 진행하므로 단계별 재승인 불필요.
- 릴리스 조건: 새 Worker가 레거시 보고 배정을 거절하므로 데스크톱 코드 갱신/브리지 재시작 및 실제 observedAt 보고를 확인해야 한다. 현재 운영 Worker/브리지는 이전 검증 버전 그대로 유지.

### 2026-09-27 M2 착수 및 통합 결정
- 직전 턴은 M1 구현·검증 완료로 진행. M1은 로컬 codex/source-release 커밋 4d5c158에 보존, 원격/운영 미반영.
- M2 순수 정책 코어를 Sol 구현자에 위임(public/core/model-selection.mjs 및 전용 테스트). 별도 읽기 전용 감사로 실제 배정과 관측 저장의 연결 지점을 확인했다.
- 구현 순서: 순수 정책 전이 검증 → D1/SQLite 정책 저장 계약 및 CAS → cloud allocate에서 서버 선택을 부모/자식에 원자 저장 → 소유권 검증된 완료/검토 근거 수집 → 재시도·정책 철회 시 기존 배정 불변 검증. UI는 M4에서 연결.
- 선택 기록은 provider/model/effort/policyVersion/evidenceIds/reason. 공개 후보와 실행자의 품질 자기 보고는 자동 승격 근거가 아니다. 독립 검토도 실제 모델 귀속이 미확인이면 해당 신모델의 증거로 삼지 않는다.
- 작업 프로필은 작업군/요구·평가 버전/완료 기준/필요 능력/문맥 범위를 포함한다. 같은 평가 기준의 비교 가능한 독립 표본 최소3쌍을 기본 gate로 삼되, 통계적·전 작업 동일 품질 보장을 의미하지 않는다. 모르는 사용량은 null.
- Codex CLI의 실제 모델 관측은 현재 별도 저장되지 않고 Claude Routine 하위 실제 모델은 미확인. 현재 요청 모델을 실제 버전으로 위장하지 않는다. 가용성·품질 근거 부족 시 기존 경로 또는 확인 대기와 이유를 보존한다.
- 기존 SQLite 단독 경로에는 cloud와 동일한 관리형 위임 조정기가 없다. 정책/관측 JSON 계약은 공유하되 로컬 단독 경로의 미구현 위임을 완료로 표시하지 않는다.

### 2026-09-27 M2 코어·영속 저장 하위 단계 검증
- 새 public/core/model-selection.mjs: 프로필/가용성/실제 버전/독립 관측을 확인하는 순수 정책 API. createSelectionState/registerCandidate/recordObservation/promoteCandidate/withdrawCandidate/selectAssignment. 선택 결과는 모델·effort·정책 버전·근거·이유 포함. 자동 실제 실행 연결 전이다.
- 독립 리뷰에서 성공 표본만 선별한 승격, 1000건 상한에서 critical 철회 차단, 만료 근거 ID 재사용에 의한 오복구를 재현하고 같은 수정 라운드에서 수정. 전체 cohort 실패/검증불가 veto, 비고정 기록 축출, 실행·세대·모델 버전 근거 참조 검증. 독립 정책 테스트14/14 통과.
- worker/model-policies.mjs 및 server/model-policies.mjs: metadata 기반 D1/SQLite 비동기 동일 API(create/read/register/observe/promote/withdraw/select), 상태 버전 CAS, 32프로필/프로필2MB 상한. 관측 검증 콜백은 필수이며 요청의 품질 출처를 자동 신뢰하지 않음. 실제 관측 시각 보존; 수신 시각으로 근거 최신화 금지. 실제 디스크 SQLite 닫기/재열기 포함9/9.
- 메인 독립 통합 실행: 정책/저장23/23, 전체 Node473/473 통과. 로그 .inno/tmp/model-policy-m2-targeted.log 및 model-policy-m2-tests.log. diff check 통과. 새 도구·유료 API·실제 AI 실행 없음.
- M2 전체는 진행 중: 저장 클래스와 순수 코어가 아직 API/마스터 배정 경로에 연결되지 않음. 프로덕션 자동 모델 교체·절감 효과를 주장하지 않는다. 운영 미배포.
- 다음 작업: worker/index의 delegate → worker/delegations.allocate 원자 배정에 선택기 연결, 부모/자식 양쪽 selection snapshot 보존 및 replay 불변. 서버에서 소유권·배치·실제 모델·독립 검토를 확인한 관측만 policy.observe에 전달. D1/SQLite 지원 범위 차이를 유지. 기존 master가 내놓은 임의 policy/evidence 필드는 신뢰하지 않음. 프로필/가용성/실제 모델 근거 없으면 기존 경로와 evidence-insufficient 사유를 기록하고 자동 승격 보류.

### 2026-09-27 M2 실제 배정 연결 하위 단계 완료
- worker/index의 HTTP/MCP 공통 Delegations.allocate에 서버 resolveAllocationPolicy 연결. 서버가 역할/지시/완료 기준/자료 참조에서 해시 프로필을 생성하고 caller selection/policy/evidence 필드는 버린다. 선택 metadata를 부모 delegation.children과 자식 assignment에 동일 원자 저장. profileKey는 기존 정책 저장소와 공유.
- 정책이 없으면 기존 계정 검증된 모델을 unvalidated fallback으로 기록. 정책이 있으면 선택 또는 정책 baseline 사용, 유효 경로가 없으면 거절. 재전송은 저장된 배정을 반환하고 재시도 중 배정을 바꾸지 않는다. 정책·계정·가용성 원문 snapshot 및 missing-policy 조건을 부모 CAS에 포함.
- 독립 리뷰의 만료 경계 결함 수정: 선택/fallback 가용성 및 선택의 90일 품질 근거 만료를 확인하며 SQL UPDATE 시점에도 julianday 기반 deadline 검사. 배치650ms지연 후 선택 모델 만료→baseline 재계산 및 fallback 만료→자식0건 거절 확인. HTTP11/11, 별도 독립 재검토 통과.
- Codex runner 결과에 서버 생성 executionEvidence 추가: 요청 모델/effort, 실제 CLI 인자 모델/effort, actualModelVersion:null, processElapsedMs(신뢰 시계, 잘못된/역행 시 null). AI JSON의 위조 필드는 반영하지 않음. root/review 기본 모델은 추정하지 않음. 이 필드는 아직 bridge 전송/완료 저장에 연결되지 않았다.
- 메인 전체 Node481/481 및 Worker dry-run 통과. 로그 .inno/tmp/allocation-policy-tests.log 및 allocation-policy-dry-run.log. 새 도구/유료API/실제AI 실행 없음. 운영 미배포.
- 검증 범위: 자동 선택 성공 HTTP fixture는 신뢰 가용성·실제 버전·능력 metadata를 시험 DB에 주입했다. 실제 구독의 serving-model/능력 관측 수집은 아직 없음. 현 운영 데이터에는 정책·충분한 증거가 없어 일반 배정은 명시적 fallback; 실제 자동 승격이나 토큰 절감 완료를 주장하지 않는다.
- 다음: executionEvidence를 인증된 desktop 완료/outbox와 소유권 검증된 저장에 연결; 서버 claimedAt/completedAt의 경과 시간과 실제 usage 보존. 완료 부모 reviewReport와 자식 task/batch/epoch/execution을 서버에서 대조해 품질 근거 생성, executor 자기보고/실제 모델 미확인 분리. D1/SQLite parity, stale owner/재전송/위조 입력 회귀를 추가한다. 정책 관리·관측 화면은 M4. M2 전체 및 원래 플랫폼 목표 미완료.

### 2026-09-27 실행 근거 완료 저장 및 검토 관측 검증
- server/desktop-bridge outbox에 정제한 executionEvidence 보존; 인증된 CloudBridge와 로컬 server/http Codex 완료에서만 내부 allowDesktopEvidence 옵션으로 D1/SQLite 저장 허용. MCP/일반 finish 입력의 위조 증거는 신뢰하지 않음. 실행 소유권과 배정 model/effort 검증, actualModelVersion:null 유지. 신규 claim은 과거 executionEvidence/wallElapsedMs/completedAt 초기화.
- 서버 claimedAt→completedAt wallElapsedMs와 실행기 processElapsedMs를 구분. 누락/역행 시 null. 임의 24시간/90일 상한 때문에 정상 장기 완료가 실패하지 않도록 수정. 완료 재전송은 기존 사실을 반환하며 오래된 소유자가 덮지 못함.
- 새 worker/review-observation.mjs verifyReviewObservation(store,evidenceRef,state)는 저장된 부모 완료 리뷰/자식 완료·batch/epoch/실행 ID/세대·배정·평가기준을 대조. 검증된 관측 또는 not_attributable 사유 반환. 독립 검토는 별도 부모 AI 판단이며 사람의 검증 아님; critical:false로 미관측 중대성을 추정하지 않는다.
- 현재 지원하지 않는 provider_attestation/server 표시만으로 실제 버전을 신뢰하던 경로는 독립 리뷰 후 제거. CLI 근거로 실제 제공 모델 버전을 추정하지 않는다. 현재 null-version 경로 관측만 귀속 가능하며 버전별 승격 증거로 쓰지 못함.
- 비교 키는 선택된 source view 범위/hash와 부모·자식 자료 ID 일치를 검증하고 원문을 추가 저장하지 않음. 양측 view 없는 자료는 실행별 키로 분리, 한쪽 누락/잘못된 view/중복 ID는 진단 상태. 서로 다른 원본을 같은 비교 사례로 인정하지 않는다.
- 검증: 메인 실행근거/bridge/server68개, 최종 전체 Node508/508, Worker dry-run 통과. 독립 검토28/28. 로그 .inno/tmp/completion-evidence-targeted.log, completion-evidence-tests.log, completion-evidence-dry-run.log. 실제 AI·새 도구·유료API 사용 없음. 운영 미배포.
- 남은 연결: verifyReviewObservation은 아직 완료 후 후크/policy.observe에 연결되지 않았다. 다음은 부모 검토 완료 뒤 내구성 있는 관측 수집·중복 방지·실패 복구·관측 불가 사유 보존을 연결하고 정상 결과 완료와 부가 관측 실패를 분리한다. 실제 serving-version 관측은 외부/런타임 제약이며 미확인을 숨기지 않는다.
- 중간 handoff/delegation 단계는 terminal completion을 통과하지 않아 이번 executionEvidence 저장 대상이 아님. M3에서 단계별 사용량/경과 시간의 누락과 보관 한도를 다룰 때 반영. M2/M3 및 전체 플랫폼 완료 아님.

### 2026-09-27 검토 관측 자동 처리·복구 연결 완료
- 새 worker/review-observation-pipeline.mjs를 완료 afterComplete와 scheduled에 연결. 부모 reviewReport 완료와 reviewObservation 표식(실행ID/세대/batch/epoch/자식별상태)을 같은 D1 CAS에 저장. 정책관측 후 표식저장 전 장애는 실행식별 중복제거로 복구. 결과 완료와 부가 관측 실패 분리.
- 크론은 due 조건+내구 cursor로 최대10부모/회 처리. 자식별 최대3회·지수 대기 재시도, 상한 후 failed 진단. 정책 없음/귀속 불가/프로필 없음은 terminal 진단이라 반복 조회하지 않음. 이전 검토의 지연 처리와 stale retry 상태가 새 검토를 덮지 못하게 식별자·행상태/attempt CAS 확인.
- 인증된 작업별 관측 진단 GET 경로 추가. 모델이 보낸 품질/출처/시각을 그대로 정책 근거로 받지 않고 저장된 리뷰 검증 후 D1ModelPolicies.observe 호출. 정상 완료의 원본·결과파일은 바꾸지 않음.
- 독립 리뷰 수정: 실제404만 evidence_task_missing, 일시적 DB조회 실패는 제한 재시도. 한 자식의 프로필 누락이 다른 유효 자식을 막지 않도록 독립 처리. legacy unmarked 작업은 적어도1개의 저장프로필이 있는 대상만 복구해 무의미한 전체 과거 backfill 방지.
- MOD05 작은 수정: MCP checkpoint_task에 기존 bounded optional usage schema를 연결하고 finishExecution으로 전달. executor_report 출처 유지, 미보고/부적절 수치는 null, stale owner 거절, 완료 replay가 사용량을 덮지 못함.
- 메인 전체 Node522/522, Worker dry-run 통과. 독립 대상검토37/37. 최초 전체실행521/522의 유일 실패는 scheduled waitUntil 작업수가1→2가 된 기존시험기대값; 양쪽 Promise 완료 대기와 비차단·인증 검증을 유지해 수정. 로그 .inno/tmp/review-pipeline-tests.log 및 review-pipeline-dry-run.log.
- 운영 미배포, 새 도구/유료API/실제AI 실행 없음. 실제모델 버전 미확인·정책 미생성 상태에서는 진단을 남기며 자동승격/절감 성공을 주장하지 않음. 현재 정책 관리/초기화 UI와 승격 처리 연결 등 M2 남은 범위, M3 단계별 사용량/기록 정리, M4 표시·고정·복구, M5 운영반영이 남음.
- 다음: handoff/delegation 같은 비종료 단계의 usage/시간/미보고 관측 손실을 보완하고, 정책·관측·활성 작업 참조를 보존하는 보관 한도/정리 상태를 구현·검증한다. 전체 최초 플랫폼 목표는 계속 유지.

### 2026-09-27 M3 단계별 사용량·정책 근거 보존 하위 단계
- MOD-05: 위임·제공자 전환·검토 재시도·결정 대기·실패·완료에 서버 상태에서 계산한 phase/transition/wallElapsedMs/requestedModel을 기록. 보고가 없으면 토큰은 null, 실행 식별 중복 제거와 최근100건 상한 유지. 가져온 기록의 서버 출처 주장은 제거하고 unknown 처리. 비종료 CLI processElapsedMs는 전달 경로가 없어 추정하지 않음.
- MOD-06: 90일/1000건 정리에서 활성 정책과 진행 중·일시정지 작업의 selection 근거 보존. 이전 정책 근거는 유효기간 안에서만 보존, 만료 근거는 새 선택의 품질 증거가 아님. 시계 역행으로 미래 시각이 된 근거도 삭제하지 않음.
- D1/SQLite 정책 stateVersion 및 작업 전체 revision을 CAS로 대조해 조회 뒤 생긴 배정 참조 삭제 방지. 참조 조회 초과/형식 불명확 시 정리 보류. 현재 정확히2개 자식 계약을 확인하고 그 이상이면 보류. 새 근거 추가가 기존 기록을 제거하지 않는 경우에는 작업 참조 조회 생략.
- 크론 정리는 기본4프로필/회(최대8), 내구 cursor와 상태 CAS, 성공 후1일/실패·보류 후1시간 대기. 인증된 GET /api/model-policy-retention은 읽기 전용. 정리 실패는 기존 작업 실행을 막지 않음. 정상 정책 상한32개와2MB 제한 유지.
- 중대 회귀는 참조 조회 없이 기존 관측을 전부 보존하면서 철회·관측을 저장. 1000건 예외는 진단 가능하며, 추가 관측이2MB를 넘으면 기존 근거를 보존한 철회만 저장하고 critical_regression_evidence_capacity를 반환. 독립 검토에서 발견한 만료ID·용량 경계를 수정했다.
- 검증: 단계별 독립75개 통과, 정책 기존 회귀·새 보존 테스트 및 SQLite 실제 디스크 재시작/커서 복구 확인. 메인 최종 전체539/539 및 Worker dry-run 통과(.inno/tmp/model-retention-m3-tests.log, model-retention-m3-dry-run.log). 이후 진단 상태 연결의 최종 소규모 검증은 아래 후속 기록 참조.
- 성능 한계: 작업 참조 SQL은 반환 행을513개로 제한하지만 JSON 조건 때문에 DB 내부 스캔 수까지 제한하지는 않는다. 오래된/한도 도달 정책의 정리에서 작업 수에 비례한 비용이 남으며, 빈/최신 정책에서는 해당 조회를 생략한다. 작업/첨부/산출물 삭제와 새 도구·실제 AI 실행·운영 배포 없음.
- 다음: 정책 생성/관리·승격 연결 및 M3 추가 비교 실행 예산, M4 갱신·근거·고정·복구 UI, M5 실제 운영 반영. 실제 serving-model 버전 수집은 여전히 미확인. 이 하위 단계나 CR-003을 전체 플랫폼 완료로 표시하지 않는다.
- 최종 연결 확인: 용량 때문에 관측을 추가하지 못한 철회는 duplicate가 아닌 not_attributable과 정확한 사유를 저장. 마지막 변경 후 메인 대상25/25 통과(.inno/tmp/model-retention-m3-final-targeted.log). 독립 검토 종료: 차단 결함 없음. 별도 검증자가 공개 정책 API만으로 만든 정상436관측/1,997,573바이트 상태에서 새 critical 근거가2MB를 넘을 때 기존436관측을 유지한 안전 철회 저장을 확인했다.

### 2026-09-27 M2 정책 관리 연결 착수
- 직전 목표 턴은 단계별 사용량·근거 보존 구현/검증/커밋741297b로 진행이 있었다. 현재 작업 트리 clean 확인. 전체 목표는 계속 진행 중.
- 승인된 MOD-03/04/07 내에서 작업의 저장된 배정 프로필을 기준으로 인증된 정책 조회·초기화·후보 등록·승격·철회 연결을 구현한다. 입력으로 품질 근거·실제 모델 버전을 꾸며낼 수 없고 기존 evidence gate를 유지한다.
- Ruling: 실제 버전 미확인 baseline 정책을 생성한 것만으로 기존 정상 배정이 막히지 않아야 한다. 계정에서 검증 가능한 기존 baseline만 명시적 unvalidated fallback으로 허용하며, 승격된 모델의 증거/가용성 검증과 배정 원자 조건은 우회하지 않는다. Claude 별칭 지원은 구독의 실제 버전 확인을 의미하지 않는다.
- Sol 구현자에 정책 연결·회귀를 위임, 메인은 통합과 독립 검토를 담당. 추가 비교 예산과 UI는 연결 계약 검증 뒤 이어간다. 새 언어/런타임/유료API 없음.
- MOD-05/07 사용량 UI 병행 구현: 기존 검증된 phase/transition/wallElapsedMs/requestedModel을 표시하고 실제 모델 버전 미확인을 명시. 메인 브라우저 검증은 합성 데이터만 든 메모리 SQLite 서버에서 수행: 1280x900 및390x844, 62.345초 표시/보고123·45와 미보고 구분, 모바일 document390px·카드335px 가로 넘침 없음. 사용한 미리보기 세션과 탭은 종료했다. 실제 AI·사용자 데이터 변경 없음.
- 브라우저 갱신 주의: 로컬 서버의 이름 고정 JavaScript 자산 max-age=3600 때문에 일반 reload 뒤 이전 UI가 남았다. 별도 localhost origin의 새 캐시에서 최신 코드를 확인했다. M5 릴리스에서 캐시 재검증/버전 처리와 이전 열린 탭 갱신 검증을 수행할 필요가 있다. 이번 UI 변경이 전체 모바일 제스처 검증을 뜻하지는 않는다.

### 2026-09-27 M2 정책 관리 API 및 M4 단계별 사용량 표시 완료
- GET/POST /api/tasks/:childId/model-policy를 기존 인증 게이트에 연결. 저장된 부모·자식 배정 일치와 서버 재계산 프로필을 확인하며 일반/root/import 작업은 거절한다. initialize/register_candidate/promote/withdraw의 입력 필드 제한과 stateVersion CAS 적용. 프로필·실제 버전·품질 근거 입력 위조 불가.
- 초기 baseline과 후보는 modelVersion:null, 실제 버전은 추정하지 않음. 기존 계정/별칭 검증을 유지하며 Codex 계정 관측과 Claude의 정적 별칭/실제 가용성 미확인을 구분해 응답. 조회는 정책/후보 요약·관측 수만 제공하고 전체 근거 본문은 반환하지 않음.
- shared unverifiedBaselineRoute는 최초 policyVersion1, activeId=baselineId, 이전 정책/활성 근거 없음, 실제 버전null인 baseline만 허용. 현재 계정 검증과 원자 배정 guard를 유지하며 기존의 정상 배정을 초기화만으로 차단하지 않음. 독립 검토에서 확인한 GET wait/실제fallback 표시 불일치를 공통 규칙으로 수정. 기존 실행 배정은 바뀌지 않음.
- public/core/usage-presentation.mjs와 사용량 카드 연결: 검증된 단계·전환, 서버 기준 경과 시간(대기 포함), 요청 모델과 실제 버전 미확인 표시. null·레거시·가져온 기록은 확인 불가, 실제0은0밀리초. 동적 텍스트 escaping 유지. 데스크톱/모바일 합성 기록 브라우저 검증은 위 기록 참조.
- 메인 전체 Node545/545, Worker dry-run 및 diff check 통과. 독립 정책36/36, UI/사용량18/18. 로그 .inno/tmp/policy-management-tests.log 및 policy-management-dry-run.log. 실제 AI 추가 실행/새 도구/운영 배포 없음.
- 남은 범위: 정책 관리 화면·계정/공식 갱신 표시·수동 고정/복구, 자동 초기화/승격 운영 연결, 추가 비교 실행 예산, 신뢰된 serving-model 버전 귀속 경로, M5 캐시 갱신/desktop 재시작/운영 반영. 이번 API의 null-version 후보는 아직 승격할 수 없다. 모델 최신화 전체나 최초 플랫폼 목표 완료 아님.

### 2026-09-27 M4 정책 관리 화면 착수
- 직전 목표 턴은 정책 API·사용량 UI 구현/전체545개 검증/커밋2a68fff로 진행이 있었다. clean 작업 트리 확인 후 재사용.
- 승인된 MOD-07 내에서 부모 위임 카드/하위 작업에 정책 관리 진입, 현재 고정 배정과 향후 정책 선택 구분, 후보 등록·초기화·승격·철회를 연결한다. 요청 시에만 조회하고 기존5초 상태 동기화마다 정책 전체를 조회하지 않는다.
- UI 구현과 계정 관측/선택지 응답 보완을 별도 Sol 구현자에 위임하고 독립 검토자를 분리한다. 서버·계정·작업 전환 및 응답 지연/중복클릭의 방어를 검증한다. 새 스택·유료API·추가 AI 평가 없음.

### 2026-09-27 M4 정책 관리 화면·데스크톱 경로 하위 단계 완료
- 부모 위임 카드와 하위 작업 상세에 capability 기반 정책 관리 진입 추가. 모달에서 현재 고정 배정과 향후 정책, 계정 관측/만료, 모델 버전 미확인, 관측 건수와 최소 비교3쌍을 구분. 후보 등록·기준 초기화·승격 검토·철회는 인증된 기존 API에 연결하며 실제 AI 실행을 만들지 않음.
- Codex 모델/effort 선택지는 유효한 계정 관측에서만 제공(2시간, refresh_failed의 유효 마지막 목록은 유지). Claude 선택지는 내장 역할 별칭이며 계정 가용성/실제 버전 미확인, effort는 기존 배정의 계획 의도만 유지. UI에 별도 문구. 데스크톱 프록시는 좁은 GET/POST 정책 경로를 인증 후 전달하고 capability를 보존.
- 정책 조회는 창 열기/명시적 갱신/충돌 복구에만 수행. 작업·client·selectionEpoch·창세대·조회순서 fence, 오래된 요청이 새 창의 busy를 해제하지 못하는 소유권 확인, 중복 POST 차단. 409는 재조회만 하고 POST 자동 재시도 없음. 초기 조회 실패 후 재시도와 만료된 Codex 초기화 거절 표시를 검증.
- 독립 검토 수정: 동일 창 조회 역전, 창 재열기 busy 해제, 실제 승격 성공을 보류로 표시하는 문구, 조회 실패 후 갱신, 중복 후보 선택지 및 실제 버전/내부 사유 표시. 최종 차단 결함 없음. 기존 배정 변경 없음.
- 메인 브라우저 검증: TestD1 메모리 DB + 실제 Worker + 실제 데스크톱 HTTP 프록시, 합성 작업으로 Codex 초기화→후보 등록→근거 부족 승격 보류→철회, Claude 초기화→sonnet 후보 등록→승격 보류 확인. 1280x900 데스크톱 및390x844 모바일 확인, 모바일 dialog clientWidth/scrollWidth 모두350px로 가로 넘침 없음. 화면 .inno/tmp/policy-ui-desktop.png 및 policy-ui-mobile.png. 실제 구독 실행 없음. 검증 탭·viewport·서버 세션13516 종료.
- 전체 Node554/554, Worker dry-run, diff check 통과. 로그 .inno/tmp/policy-ui-m4-tests.log 및 policy-ui-m4-dry-run.log. 독립 UI/client16개, 구현자 관련34개, metadata/proxy23개 확인. 마지막 Claude 문구 변경은 전용6개 및 최종전체에 포함.
- 아직 운영 미배포. MOD07 전체 남은 항목은 공식 갱신/정리 진단 표시와 수동 고정/복구 정책 통합이며, MOD03/04 자동 초기화·승격/실제 serving-version 귀속 경로, MOD06 추가 비교 실행 예산, M5 운영·캐시 갱신 검증도 남는다. 구독의 모델 버전 미확인을 숨기거나 후보 등록을 품질 최적화 완료로 표시하지 않는다. 최초 전체 플랫폼 목표 유지.

### 2026-09-27 M4 공식 발견·정리 진단 표시 착수
- 승인된 MOD01/02/06/07 범위에서 사용량 화면에 필요할 때만 여는 진단 패널 연결. 공식 문서 후보와 계정 가용성/검증된 품질을 구분하며 추가 AI 실행·강제 외부 새로고침은 만들지 않는다.
- Sol 구현자와 독립 리뷰어를 분리. 실제 Worker + 메모리 D1 + 데스크톱 프록시의 합성 데이터로 UI를 확인한다. 신규 스택/유료API 없음. 정책 고정·비교 예산은 이 하위 단계 이후의 남은 범위.

### 2026-09-27 M4 공식 발견·정리 진단 표시 하위 단계 완료
- 사용량 화면의 기본 닫힌 패널에서 공식 출처/확인·만료·다음 시도/오류와 최대100개 후보, 정책 근거 정리 상태/건수/보존 예외/다음 점검 표시. 공식 API 문서와 Claude Code 별칭을 구분하고 계정 가용성·실제 버전·품질 미확인을 명시한다. 링크는 기존 공식 두 URL로 제한.
- 최초 펼침/명시적 갱신에서 인증된 GET 두 개만 병렬 조회. 5초 동기화는 조회를 추가하지 않는다. 재열기는 캐시를 유지하며 버튼으로 서버 저장 상태만 다시 읽는다. 외부 공식 문서의 즉시 수집이나 AI 실행을 만들지 않는다.
- 클라이언트/기능 지원 변경 시 과거 자료 제거, 오래된 요청의 응답 무시. 요청 중 닫힘 후 재열기 고착 방지, 중복 요청 버튼 잠금, 각 경로 독립 실패 및 마지막 정상 자료/조회 오류 병행 표시를 검증. 데스크톱 프록시는 인증된 두 GET만 허용하며 POST는 거절.
- 독립 리뷰 차단 결함 없음, 전용8/8. 메인 전체 Node562/562, Worker dry-run 통과. 로그 .inno/tmp/model-diagnostics-tests.log 및 model-diagnostics-dry-run.log. 구현자 인접 SQLite 시험의 샌드박스 EPERM은 쓰기 권한 승인 실행에서13/13 통과했으며 메인 전체에도 포함.
- 실제 Worker + TestD1 메모리 DB + 실제 desktop 프록시의 합성 자료로 브라우저 확인. 1280x900 및390x844, 모바일 문서390px/패널335px clientWidth=scrollWidth. 화면 .inno/tmp/model-diagnostics-desktop.png 및 model-diagnostics-mobile.png. 검증 서버 세션53880과 탭 종료, viewport 복원. 실제 구독 AI 실행·추가 유료API·운영 배포 없음.
- 다음: 정책 수동 고정/해제·복구 통합, 추가 비교 실행 예산, 자동 초기화·승격 운영 연결과 실제 serving-version 귀속 제약 처리, M5 배포·캐시 갱신·desktop 재시작 검증. 이번 진단 화면은 모델 최신화 전체 또는 최초 플랫폼 완료가 아니다.

### 2026-09-27 M2/M4 모델 정책 고정·해제 착수
- 직전 목표 턴은 진단 UI 구현/562개 검증/커밋67318f2로 진행이 있었다. clean 상태 확인 후 동일 작업 트리를 재사용한다.
- 승인 MOD04/07 범위: 현재 활성 경로를 수동 고정하고 해제한다. 임의 미검증 후보로 강제 전환하는 기능은 아니며 고정 중 승격은 보류한다. 가용성/근거 만료 시 다른 모델로 조용히 전환하지 않고 대기하고, 중대 회귀나 명시적 철회는 고정을 해제하며 기존 복구 검증을 적용한다.
- 고정은 다음 배정에만 영향을 주고 저장된 실행 배정은 수정하지 않는다. 원자 배정은 이미 policy stateVersion을 검사하므로 제어 상태 변경도 경합 검증 대상이다. 초기 실제버전 미확인 baseline의 기존 명시적 fallback 조건을 넓히지 않는다.
- WBS: backend/core·D1/SQLite 구현자, 기존 정책 모달 UI 구현자, 별도 리뷰어를 분리. 메인은 통합·전체 검증·브라우저 확인·기록. API 계약과 코드 검증 후 다음 항목으로 진행한다. 새 스택/추가 유료API 없음.

### 2026-09-27 M2/M4 현재 정책 고정·해제 하위 단계 완료
- public/core/model-selection에 현재 활성 경로 pin/unpin 추가. 상태 버전만 증가해 원자 배정 CAS에 포함하며 모델 정책 버전은 실제 경로 변경에만 증가. 레거시 pin 누락은 null, 저장된 불일치/철회 경로 pin은 거절하고 순수 선택도 조용한 fallback을 하지 않는다.
- 고정 중 다른 후보 승격 보류. 승격된 고정 경로의 계정 가용성 또는 비교 근거 만료 시 새 배정 대기, 활성 후보 철회·중대 회귀 시 같은 상태 변경에서 고정 해제 후 기존 검증된 복구 적용. 현재 초기 baseline의 중대 회귀 처리는 기존 core에서 철회 대상이 아니므로 후속 품질 연결의 남은 범위다.
- D1/SQLite 공통 pin/unpin CAS와 HTTP 엄격 입력 제한. 실제버전 미확인 초기 baseline은 기존 policyVersion1/이전정책 없음/활성근거 없음 조건과 서버 catalog.validate 콜백으로만 허용. 사용자 입력으로 검증 면제 불가. Claude 별칭 고정은 배정 계획을 유지하며 실제 Routine 제공 모델을 바꾸거나 확인했다는 뜻이 아니다.
- 정책 모달에서 활성 경로와 일치하는 후보만 고정, 고정 중 승격 조작 차단, 해제와 철회 가능. 이전 실행 배정 불변, 해제만으로 AI 실행/자동 승격을 시작하지 않는 안내. 최신 상태 충돌409 재조회와 계정·작업·창 변경 시 오래된 응답 무시를 유지.
- 구현자 core46/46, UI10/10, 독립56/56. 메인 전체 Node574/574, Worker dry-run 및 diff check 통과. 로그 .inno/tmp/policy-pin-tests.log 및 policy-pin-dry-run.log. SQLite 실제 파일 close/reopen 고정 보존과 레거시 복원, D1 배정 중 pin 변경 첫 CAS 0건/최신 재시도 성공, HTTP 위조/오래된 요청 거절 확인.
- 브라우저 합성 데이터 + 실제 Worker/desktop 경로: Codex 초기화→고정→후보 등록(승격 버튼 없음)→해제(승격 버튼 복귀)→고정, Claude 별칭 초기화→모바일 고정 확인. 1280x900,390x844에서 모바일 문서390/dialog335 clientWidth=scrollWidth. 화면 .inno/tmp/policy-pin-desktop.png 및 policy-pin-mobile.png. 검증 서버68365와 탭 종료, viewport 복원. 최종 불일치 pin 방어는 독립/API 회귀로 확인했으며 브라우저는 정상 고정 흐름 확인이다.
- 운영 미배포, 실제 구독 AI 실행·새 스택·추가 유료API 없음. 다음은 MOD06 추가 비교 실행 예산 및 실행 예약/취소 연결, MOD03/04 자동 정책 초기화·승격과 serving-version 귀속 제약·baseline 회귀, M5 실제 배포/desktop 갱신. 전체 원래 플랫폼과 CR003 완료로 표시하지 않는다.

### 2026-09-27 MOD06 비교 실행 예산 기반 착수
- 직전 턴은 고정/해제 구현·574개 검증·커밋28b3a66로 진행. clean 작업 트리 확인.
- 현 실행 구조 조사: 기존 위임은 Codex+Claude 각1개 독립 업무용으로 동일 입력·동일 제공자 기준선/후보 비교를 대체하지 못한다. 별도 비교 job의 실행 예약을 실제 claim에 연결해야 하며 설정값만 추가한 상태를 완료로 보지 않는다.
- 공식 Routine fire 문서(https://platform.claude.com/docs/en/api/claude-code/routines-fire, 2026-09-27 확인)는 트리거 전용 토큰·즉시 세션 반환·idempotency 없음·text 입력만 명시한다. 원격 실행 중단/시간 한도 계약은 확인되지 않았다. 현재 코드도 원격 취소를 구현하지 않음. 단순 시작 허용 기한을 총 실행시간 한도로 바꾸어 주장하지 않는다.
- 승인 범위의 구현계획 docs/superpowers/plans/2026-09-27-evaluation-budget-ledger.md 작성. 첫 하위 단계는 기본0회/시간·보수적 예약·검증된 종료 정산·D1/SQLite 영구 기록. Sol 구현자와 독립 검토자 분리. 실제 claim 원자 결합·Codex 종료타이머/능력협상·Claude 시간제한 제약·동일입력 평가·UI는 이어질 필수 작업이며 기반만으로 기능활성화/완료/운영배포 금지.

### 2026-09-27 MOD06 비교 예산 영구 예약 기록 기반 완료
- 새 public/core/evaluation-budget.mjs는 job별 불변 한도(기본0회/0ms, 최대100회/24시간)와 실행별 최대시간 예약/정산을 처리. 추가 실행 모든 단계(master/baseline/candidate/review/retry/handoff)를 구분하며 횟수는 반환하지 않는다. 동일 실행·세대·phase·시간 한도의 재전송만 변경 없이 반환, 다른 내용 재사용은 충돌.
- 새 worker/evaluation-budgets.mjs 및 server/evaluation-budgets.mjs는 D1/SQLite CAS와 원자 revision 갱신. 최대32개 job/각256KiB/100예약 상한, 임의 삭제 없음. 32개는 초기 안전 상한이며 정상 비교 기능 공개 전 종료 job 보관·정리 흐름도 필요하다. 저장 상태의 ID·합계·시각·버전 일관성을 검증하고 훼손 상태에서 진행하지 않는다.
- settle은 생성자에 주입된 서버 신뢰 종료 검증기만 허용. job/실행/세대/단계 일치를 확인하며 클라이언트 elapsedMs·확인 플래그는 수용하지 않는다. 종료 미확인 예약은 시간만 지나도 환불하지 않고, 만료 미정산 예약이 있으면 새 실행 예약을 차단한다. 정확한 재전송은 허용. 실제 경과시간이 한도를 넘으면 overrun 보존·새 실행 금지; 전달만 늦고 실제 시간은 정상인 정산은 초과로 오인하지 않음.
- 독립 검토 보완: SQL LIKE 밑줄 와일드카드로 다른 metadata가 상한에 포함되지 않도록 정확한 GLOB 접두어 사용, 정책 metadata sentinel·세대/phase 충돌·큰 상태 거절 검증 추가. 독립24/24, 메인 전체 Node598/598와 Worker dry-run 통과. 로그 .inno/tmp/evaluation-budget-ledger-tests.log 및 evaluation-budget-ledger-dry-run.log.
- SQLite 실제 파일 close/reopen 뒤 미정산 예약 보존 확인. D1은 TestD1 시뮬레이션이며 실제 클라우드DB 검증 아님. 원장 모듈은 현재 실행 경로에서 호출하지 않는 내부 기반이다. Worker dry-run은 기존 패키지 비회귀를 확인하며 새 예산이 실제 실행을 제한한다는 근거가 아니다. 실AI/새 스택/추가 비용/운영 배포 없음.
- 필수 다음 단계: 전용 비교job 생성·동일입력/평가기준 보존 및 actual claim+budget을 하나의 원자 작업으로 결합, Codex 종료 타이머·검증기·capability 협상, 시간 종료를 확인할 수 없는 Claude 경로 보류, 사용자가 설정하는 예산·예약/소모/보류 UI. 이 연결 전 MOD06 또는 전체 최신화 완료를 주장하지 않는다. 다른 원래 플랫폼 목표도 유지.

### 2026-09-27 MOD06 실행권·예산 원자 결합 착수
- 직전 턴은 예산 기록 기반 구현·598개 검증·커밋2cdd4c5로 진행. clean 상태 확인 후 재사용.
- 다음 WBS는 D1TaskStore/SqliteTaskStore의 실제 claimExecution에서 비교용 작업의 실행 소유권과 예산 예약을 한 번에 저장. 작업 또는 원장 상태 경합/SQL 실패 시 한쪽만 기록되지 않아야 한다. 기본0·종료미확인·초과 한도는 실행권 생성 전에 거절.
- 내부 attachEvaluationBudget는 신선한 준비 작업과 기존 검증된 원장만 결합하고 HTTP/MCP에는 노출하지 않는다. 일반 create/import 입력의 비교 표식을 신뢰하지 않는다. 현재 비교 실행은 Codex+지원 executionBudgetVersion=1이 명시된 내부 호출에서만 가능하게 구성하며 기존 실행기는 아직 그 능력을 보고하지 않으므로 운영 비교는 보류 상태로 유지.
- 시간 제한을 지원하지 않는 Claude/레거시 실행기는 예산 없는 실행으로 우회하지 않고 거절. 원래 2-child 일반 위임이 예산 없는 자식을 만들지 못하도록 비교 작업에서 해당 경로를 거절한다. 전용 비교 orchestration과 동일입력/평가기준 연결은 다음 필수 단계다.
- 구현자와 별도 리뷰어에 위임. 신규 의존성/언어 없음. 대상 회귀→전체검증→기록 순서를 유지한다. 외부에서 쓸 수 있는 비교 기능 완성을 뜻하지 않는다.

### 2026-09-27 MOD06 실행권·예산 원자 결합 하위 단계 완료
- 현재 상태: 내부 claim 연결 완료, 실제 비교 실행은 미활성. 다음 WBS는 Codex 시간 제한·프로세스 종료 확인·신뢰 정산·실행기 capability 협상이며 이후 전용 비교 job/동일 입력·평가 기준/UI 연결이 필요하다. MOD06 및 전체 목표는 진행 중.
- D1TaskStore/SqliteTaskStore에서 task owner·실제 executionId/generation의 예약·revision을 한 트랜잭션으로 저장. task/ledger CAS와 D1 마지막 무결성 assertion으로 경합·SQL 오류·원장 UPDATE 0건의 부분 저장을 막는다. 일반 claim에는 추가 task 조회를 넣지 않았다.
- 내부 attach는 ready/version1/비수입 root만 허용, task별 불변 job과 job별 여러 phase 작업을 지원. Codex+executionBudgetVersion=1만 허용하고 해당 capability는 현재 HTTP/MCP/실행기 경로에 노출하지 않는다. 시간 제어 미지원 Claude/레거시 경로는 보류한다.
- 이전 lease 만료나 pause/resume만으로 종료를 추정하지 않는다. 동일 작업의 이전 예약은 신뢰 정산 전 재실행 거절, 새 실행ID 충돌 거절. 생성/import 표식 위조와 변경/삭제, 일반 위임 및 handoff 우회를 거절한다. D1 위임은 부모/기존 자식의 DB 저장 표식까지 조회해 호출자 snapshot 위조를 거절한다.
- 독립 리뷰에서 위조 자식 snapshot으로 표식 삭제되는 RED를 실제 재현한 후 수정 및 동일 재현의 거절/보존 확인. 미해결 P0/P1 발견 없음. 전용23/23, 독립 관련113/113, 메인 최종 전체 Node621/621·Worker dry-run·diff check 통과. 로그 .inno/tmp/evaluation-claim-tests.log 및 evaluation-claim-dry-run.log. SQLite 파일 재시작 확인; D1은 TestD1이며 실제 클라우드 DB 검증 아님.
- 검증 절차 이탈: 구현자가 테스트 작성 전에 구현 코드를 작성했다. 전체 작업을 사전 RED→GREEN으로 주장하지 않는다. 종료 미확인 재실행 방어는 구현 후 GREEN 검증이며, 위조 위임 자식 방어만 독립 리뷰에서 수정 전 실제 RED→수정 후 GREEN을 확인했다. 첫 전용 실행의 옵션/동기 assertion fixture와 재시작 lease 조건도 보정했다.
- 새 언어/런타임/의존성·실제 구독 AI 실행·추가 API 비용·운영 배포 없음. 비교의 실시간 한도 강제/완료 정산, 실제 모델 버전 귀속과 자동 승격, baseline 중대 회귀, M5 실제 코드/desktop 갱신 및 배포는 남아 있다.

### 2026-09-27 MOD06 Codex 실행 기한 연결 착수
- 직전 목표 턴은 d7308b6 및621개 검증으로 progress. clean 작업 트리 확인.
- 승인된 Task4 실행기 기한 검사/시간 초과 중단/본체 종료 관측을 구현자에 위임하고 별도 리뷰한다. Node 본체 close는 Windows 전체 process tree 및 원격 추론 취소 증거가 아니므로 capability/정산 활성화와 구분한다. 상위 전체 목표와 나머지 MOD06은 계속 진행 중.

### 2026-09-27 MOD06 Codex 실행 기한·로컬 종료 관측 하위 단계 완료
- 현재 상태: Task4 내부 runner 연결 완료. 다음은 공개 비교 실행에 필요한 실행 격리/중첩 CLI 우회 제한과 신뢰할 종료 계약을 확정하고 durable receipt→task/ledger 원자 정산→bridge 능력 협상을 연결하는 단계. 전용 비교 job/동일 입력·평가 기준/UI 및 나머지 모델 최신화/원래 플랫폼 목표는 진행 중.
- server/execution-deadline.mjs와 Codex runner가 예산 v1·작업/실행 소유권·job/phase/24시간 상한·claimedAt/deadline 일치를 검증한다. root 비교만 허용. 준비 전/후 및 prompt 생성 후 spawn 직전 기한 검사, 서버 시각과 단조 시계 중 보수적인 잔여시간을 사용. 기한 만료나 유효하지 않은 시계는 실행 거절.
- 타이머/abort/출력 오류의 중단 요청은 종료 증거가 아니므로 본체 close까지 기다린다. kill throw/실패 및 live-pid error도 비교 실행의 종료로 간주하지 않음. 선행 process error가 타이머 kill을 누락하던 결함은 실제 RED 재현 후 수정. 정상 실행의 기존 즉시 process-error 처리는 유지하며 회귀 테스트로 확인.
- 결과/오류의 localExecution은 started/rootProcessClosed/elapsedMs/deadlineExceeded만 runner 관측으로 생성, 모델 보고값 불신. elapsed 미확인은 null. 본체 close의 경과시간이며 전체 서버 예약시간·자식 전체 종료·원격 추론 취소·토큰 과금 종료의 증거가 아니다. 외부 전송/자동 정산에 아직 사용하지 않는다.
- 비교 실행에서 configured MCP/native multi_agent/일반 위임·handoff 지시 및 반환 우회를 차단. CLI 도구 설정은 shell에서 별도 CLI를 호출하는 것까지 OS 수준으로 봉쇄하지 않으므로 중첩 실행과 Windows process tree 감독은 공개 capability 전 필수 검증 사항이다. 현재 runner/bridge는 비교 capability를 광고하지 않으며 운영 비교는 계속 비활성.
- 테스트 선행 RED 최초8/8 예상 실패, process-error kill 및 일반 오류 처리 추가 RED 후 수정. 최종 구현자 관련29/29, 독립32/32, 메인 전체 Node632/632·Worker dry-run·diff check 통과. 실제 무해한 Node 자식 프로세스의 시간 초과→kill→close 확인, 실제 Codex/Claude AI 호출 없음. 로그 .inno/tmp/evaluation-deadline-tests.log 및 evaluation-deadline-dry-run.log. dry-run은 Worker 기존 패키징 비회귀이며 Node 실행기 검증은 Node 테스트 결과에 근거한다.
- 신규 언어/런타임/의존성·유료API·운영 배포 없음. Windows 강한 process containment에 새 구성요소가 필요하면 CHANGE_REQUESTS와 PRD 위험 항목을 통해 별도 처리한다. 이 단계만으로 엄격한 전체 실행시간/과금 상한을 보장한다고 표시하지 않는다.

### 2026-09-27 MOD04 기준 모델 중대 회귀 제외 착수
- 직전 목표 턴은34e6cc4 및632개 검증으로 progress. clean 작업 트리 확인.
- MOD06 공개 실행은 process containment/중첩 CLI/정산 계약 연결이 남아 있다. 병행 가능한 승인 MOD04의 알려진 baseline 중대 회귀 gap을 별도 하위 단계로 처리한다.
- 구현자/독립 리뷰 분리, 기존 withdrawn/CAS 사용, 기존 frozen assignment 유지. 새 언어/런타임 없음.

### 2026-09-27 MOD04 기준 모델 중대 회귀 제외 하위 단계 완료
- 현재 상태: 알려진 baseline 중대 회귀 gap 해소. MOD04 전체 자동 정책 초기화/운영 가용성 증거/실제 모델 버전 귀속과 재자격 검증, MOD06 실행 격리·정산·전용 비교/UI, M5 배포 및 원래 플랫폼 목표는 남아 있다.
- 신뢰된 독립 검토의 critical은 baseline(활성/비활성)도 기존 withdrawn으로 제외. 활성 baseline은 pin/현재 경로를 해제하고 적격 복구가 없으면 대기한다. 비활성 baseline은 정상 활성 후보와 동결 배정·비교 근거를 보존하며, 이후 fallback/rollback에 재사용하지 않는다. self-report는 철회 트리거가 아니다.
- select/pin/신규 승격/초기 null-version fallback에서 제외 상태 및 레거시 baseline critical 관측을 검사. 이미 적격한 활성 후보의 기존 검증을 무조건 무효화하지 않으며, 철회된 기준선으로 새로운 후보 승격을 허용하지 않는다.
- 레거시 critical은 prune 및 새 정상 observation에서 기록을 지우기 전에 withdrawn으로 영구화. worker.prune의 recent-only 조기 반환도 상태 변경이 있으면 CAS 저장. D1/SQLite parity에서 정리/새 관측 이후 baseline이 재선택되지 않음을 검증. 용량 초과 경로는 정상 활성 후보가 아닌 문제 baseline을 제외하고 기존 observation 전체를 보존한다.
- 대기 사유 baseline_critical_regression을 실제 core 선택 경로와 한국어 UI 문구에 연결. 기존 레이아웃/조작 흐름 유지. 실제 recordObservation→selectAssignment→render 단위 통합 검증이며 이번 단계 새 브라우저 화면 검증을 수행했다는 주장은 하지 않는다.
- RED: 새 pure 경계4건, D1/SQLite legacy prune2건, UI 원인 미연결을 재현 후 수정. 구현자 및 독립 대상64/64, 메인 최종 전체 Node644/644·Worker dry-run·diff check 통과. 로그 .inno/tmp/baseline-regression-tests.log 및 baseline-regression-dry-run.log. 독립 리뷰 차단 결함 없음.
- 개발 브랜치에만 저장, 실제 AI 호출·새 스택·추가 API 비용·운영 배포 없음. 자동 재자격 부여를 무검증 철회 해제로 대체하지 않는다.

### 2026-09-27 MOD03 초기 배정 정책 자동 연결 착수
- 직전 턴6591f11/644개 검증으로 progress, clean 작업트리 확인.
- 기존 수동 초기화만 있는 상태에서 실제 신규 배정이 성공할 때 초기 정책도 같은 D1 batch로 저장하도록 연결. modelVersion:null/품질미검증 유지. 상한32로 일반작업 차단하지 않고 초기화보류를 명시.
- 계획 docs/superpowers/plans/2026-09-27-auto-initial-policy.md. 구현자/독립리뷰 분리, 기존스택/구독원칙 유지.

### 2026-09-27 MOD03 초기 배정 정책 자동 연결 하위 단계 완료
- 현재 상태: 실제 신규 하위 배정에 초기 정책 자동 생성 연결. 수동 초기화 없는 정상 관측 기반 진입점 확보. 실제 serving-version/가용성 근거 생성과 검증 후보 승격, MOD06 종료격리·정산·전용비교/UI, M5 배포와 원래 플랫폼 목표는 계속 남아 있다.
- resolveAllocationPolicy는 읽기와 계획만 수행. catalog.validate를 통과한 요청 provider/model/effort로 baseline/id=baseline/modelVersion:null/정책version1을 준비한다. Codex는 fresh 계정 목록, Claude는 현재 정적 지원 별칭 검사이므로 Claude 계정 가용성·실제 모델 확인으로 표현하지 않는다. 초기 선택은 baseline_version_unverified/unvalidated_fallback, 품질/효율 근거를 만들어내지 않는다.
- replaceDelegation은 새 정책 canonical state와 profile key, 해당 신규 child의 frozen assignment 연결을 검증. parent CAS에 기존 catalog/availability/policy 부재·정확한 GLOB policy 개수+신규개수<=32를 포함. 성공 operationId 아래에서 부모·자식·초기정책·revision을 같은 D1 batch에 저장, SQL 오류와 정책/자식 INSERT 0건에도 내부 assertion으로 전체 rollback.
- 동시 초기화/부모 상태 충돌은 기존 제한된 재시도에서 최신 정책을 다시 읽으며 덮어쓰지 않음. 같은 요청 replay는 정책/자식 중복 생성 없음. 철회·고정 등 기존 정책 선택 조건은 유지. 일반 capacity 계산과 D1/SQLite 정책 저장소도 GLOB exact prefix로 통일.
- 슬롯이 부족하면 입력 순서대로 가능한 초기화만 준비하고 남은 profile은 현재 카탈로그 검증을 거친 요청 경로로 배정. policyVersion:null/policy_capacity_unavailable 사유 및 한국어 표시, 자동 삭제 없음. 기존 과거 미등록 작업의 수동 initialize는 테스트 fixture를 분리해 보존. 32개는 누적 한도이므로 향후 수명주기 정리/재사용 개선은 남아 있다.
- RED: 최초 초기화/저장실패/용량사유, 정책0건·자식0건·UI 원시사유 노출 재현 후 수정. 최종 구현자·독립 대상40/40, 메인 전체 Node656/656·Worker dry-run·diff check 통과. 로그 .inno/tmp/auto-initial-policy-tests.log 및 auto-initial-policy-dry-run.log. D1은 TestD1이며 운영DB 실제 검증 아님. UI는 기존 레이아웃의 사유 문자열만 변경하고 렌더 단위 검증함.
- 신규 언어/런타임/의존성·실제 AI 호출·추가 API 비용·운영 배포 없음. 자동 초기화는 자동 모델 변경/품질 검증/승격 완료를 뜻하지 않는다.

### 2026-09-28 자동 승격 실경로 감사 및 CR004 제안
- 직전 목표 턴f23f7f8/656개 검증으로 progress. clean tree 확인 후 구현/PRD/공식문서 대조에서 실제 자동승격 불가능 경로 발견: non-null version gate와 actualModelVersion:null 기록, parent/batch마다 다른 비교ID.
- 내부 계획에 추가했던 엄격한 serving-version 조건을 사용자 별도승인으로 해석하지 않음. 현재구독최적화 의도와의 불일치를 숨긴 채 작동하지 않는 자동gate만 추가하지 않는다.
- CR004의 실행경로기반 평가(실제버전미확인 유지) 대안과 엄격한승격보류 대안을 구체적으로 작성. 품질근거 신뢰범위에 관한 사용자선택 대기. 코드/PRD/운영 변경·AI 실행 없음. 전체목표는 active; 다른 승인된 작업도 남아 있어 goal blocked 아님.
- 독립 추가감사: production model_policy_availability writer 없음, 정상 review quality.critical:false 고정도 확인. 현재 자동승격/중대회귀 운영연결은 실효 검증되지 않았음을 제안서에 명시. CR004 A/B 사용자 선택 질문 제시, 추가 AI 소비 승인은 요청하지 않음.

### 2026-09-28 모델 정책 안내와 사용 가이드 현행화
- 현재 구독 정상 실행의 관측만으로 자동 모델 승격이 작동하지 않음을 정책 창에 명시. 정책 등록·고정·보고된 사용량과 자동 최적화를 구분한다.
- MODEL-ROUTING.md의 오래된 미구현 설명을 수정하고 개발 브랜치 기준 사용 순서, 실제 버전 미확인, 정책 저장 한도, 비교/중대 회귀 연결의 남은 범위를 기록.
- 소규모 안내 변경이며 평가 규칙·실행 동작·PRD는 변경하지 않았다. CR004 A/B 선택은 계속 대기. 새 스택·AI 호출·운영 배포 없음.
- 기존 UI 테스트12/12 및 git diff --check 통과. 로그 .inno/tmp/model-readiness-copy-tests.log. 브라우저 시각 검증은 이번 문구 변경에서 수행하지 않음.

### 2026-09-28 MOD06 빈 근거 목록의 정리 한도 오계산 수정
- 직전 목표 턴은3e9348a 안내 수정으로 progress. CR004 선택 대기와 독립적인 승인 MOD06 보존 경로 감사 후 실제 결함 수정.
- 신규 fallback 배정은 evidenceIds:[]를 정상 저장한다. 기존 TASK_PINS_SQL이 빈 배열도 한도에 포함해 비종료 작업513개에서 실제 보호참조가 없어도 정리/관측 추가가 scan limit으로 보류되는 것을 독립 TestD1 재현 및 D1/SQLite RED로 확인.
- 유효한 빈 배열만 SQL 대상에서 제외. 비어 있지 않은 참조·비정상 타입·2개 초과 자식 shape는 기존 검사 유지. 실제513개 보호행 한도와 revision CAS는 보존한다. 결과 행 상한의 오계산 수정이며 전체 tasks 테이블 조회 비용을 없애는 인덱스 최적화는 아니다.
- D1/SQLite 회귀:513 빈 snapshot와 혼합 실제 pin에서 오래된 비보호 관측 삭제 및 관측 추가 성공, 실제 pin 보존; 진짜513 보호행과 손상/알 수 없는 shape는 보류. 독립18/18, 메인 전체660/660, Worker dry-run 및 diff check 통과. 로그 .inno/tmp/empty-pin-full-tests.log 및 empty-pin-dry-run.log. 실제 운영 D1 검증은 아님.
- 보존 범위 확인: 모델정책 observation은 프로필별90일/1000건(참조된 근거 예외), 작업 실행 usageHistory는 작업별 최근100회이며 전역90일/1000건 규칙이 아님. UI도 해당 차이를 명시한다.
- 남은 복구 항목: review observation pipeline은 재시도 소진 후 failed 행을 자동 재수집하지 않는다. 이번 수정은 이미 failed인 기록을 재처리하지 않으며 실제 운영 발생 여부도 확인하지 않았다. 릴리스 전 진단/명시적 복구 검증 필요.
- 새 언어/런타임·CR004 평가 기준 변경·AI 실행·운영 배포 없음. 전체 목표와 자동 모델 선택/비교 실행 및 릴리스는 진행 중.

### 2026-09-28 MOD07 부모 작업의 관측 수집 진단 UI 연결
- 직전 턴7971e53 보존 결함 수정/660개 검증으로 progress. 승인 MOD07 상태 확인 범위에서 완료 부모의 reviewObservation을 기존 작업 화면에 연결했다. CR004 평가 기준은 그대로 대기.
- 기존 task snapshot만 읽어 최대2개 frozen child의 관측 저장/기존 기록/대기/재시도 시각/재시도 종료/정책 미등록/귀속 불가를 표시한다. 관측 수집 실패와 작업 결과 실패를 구분하고 저장 성공을 품질 통과나 승격으로 표현하지 않는다. 새 GET/poll/AI 실행/복구 mutation 없음.
- 현재 완료 부모·완료 배정 및 executionId/generation/batchId/epoch와 정확히 일치하는 자식2건만 신뢰. 누락/오래된 marker·중복/잘못된 ID는 미확인. 원인 코드는 own-property allowlist, 역할명80문자/HTML escape, 원시 상태/원인 미노출.
- RED: 표시누락, prototype 원인키, 숫자ID의 regex 강제변환 재현 후 수정. 메인 중간전체는 마지막 숫자ID RED와 겹쳐664/665 실패했으며, 구현 동결 후 최종전체665/665 통과(.inno/tmp/observation-status-final-tests.log). 독립 대상/pipeline17/17은 마지막 타입guard 이전 검토이며, 최종guard는 구현자 대상5/5와 메인전체로 검증. Worker dry-run 통과는 타입guard 이전 패키징; 신규파일/모듈연결은 동일. diff check 통과.
- 실제 합성 TestD1+Worker+desktop UI fixture를 CUA로1280x900/390x844 검증: 저장/실패 상태 표시, 모바일doc390/viewport390 및panel329/client329로 가로넘침없음, 진단블록1개, 새작업전환0개. 최종코드 reload 후 상태 재확인. screenshot .inno/tmp/observation-status-mobile.png. 운영DB·실구독 실행 없음.
- 남은 범위: failed 관측의 명시적 재수집/원인 복구, CR004 및 자동선택 실경로, MOD06 비교/정산, 릴리스. index.html 앱script cache version 갱신은 릴리스에 포함해 기존 브라우저 갱신 확인 필요. 신규스택·운영배포 없음.

### 2026-09-28 MOD06/07 실패 관측 재수집 backend 검증
- 직전85c2288/665개 검증으로 progress. 현재 계획 docs/superpowers/plans/2026-09-28-observation-recovery.md에 따라 기존 저장결과만 재수집하는 복구 연결 중.
- 인증된 POST review-observations retry_failed 계약 구현. 현재 완료 부모·검토 identity·고정자식2개·task version CAS 검증 후 failed만 pending으로 변경. 완료결과/소유권/성공관측 보존. failed없음409. AI dispatch 없이 기존cron처리.
- manual recoveryCount는 safeinteger 증가(임의누적3회한도없음), 자동시도는기존3회. process/mark가 recoveryCount를검사해 이전비동기결과의 ABA덮어쓰기방지. legacycount0.
- 구현자RED20/25→GREEN26/26, 메인대상26/26(.inno/tmp/observation-recovery-backend-tests.log). UI연결/통합전체/브라우저검증은다음단계, 실제배포없음. backend코드동결, 독립review대기.

### 2026-09-28 MOD06/07 실패 관측 재수집 UI·통합 완료
- backend독립26/26 후 UI순차구현. 지원서버(remote+reviewObservationRecovery)와 현재유효한실패marker에만 관측 기록 다시 수집 표시. client.POST는 기존저장결과 재수집만 요청하며 결과/AI실행 재생성없음.
- UI는 요청중중복click차단, POST이후현재선택에한해capturedclient상태조회. 조회성공시최신실패여부확인후사용자새click만허용, 자동재POST없음. 조회실패시 상태 다시 확인(GET만) 잠금. 계정/task/epoch변경시old결과알림적용X. same-task 검토identity변경시fresh전체렌더와oldnotice억제분리.
- 독립리뷰에서 marker A/B 교차의 늦은조회가 새uncertain/pending을해제하는두경계를각각RED로재현후token일치시에만해제하도록수정. backend recoveryCount ABA guard와 UI request token guard를구분. 실제서버recorded/critical_regression사유한국어표시추가.
- 최종동결후 메인전체682/682(.inno/tmp/observation-recovery-final-tests.log), 독립42/42, Worker dry-run(.inno/tmp/observation-recovery-dry-run.log), app구문/diff check통과. 이전680개전체통과후2개교차회귀가추가되었으며 최종수치는682.
- 실제합성TestD1+Worker+desktop+C UA브라우저:390x844모바일에서버튼click→두failed가pending→합성8초scheduler의기존pipeline.process→두recorded로전환, 정상결과보존/버튼제거확인. 실제운영cron은기존5분이며8초는검증fixture전용. desktop기존1280폭흐름에서도버튼표시확인. doc390==viewport390/panel329==client329로가로넘침없음. screenshot .inno/tmp/observation-recovered-mobile.png. 마지막token-only패치는자동회귀로검증했고최종브라우저전체복구재실행은하지않음.
- 가이드 MODEL-ROUTING.md에복구순서/자동반복금지/정책미등록·귀속불가제외/저장성공≠품질검증기록. PRD와새스택변경없음. 실제AI·운영DB변경·운영배포없음.
- 남은전체범위 유지: CR004선택과실제모델/가용성·비교근거연결, MOD06전용비교/실행격리/정산, M5기존클라이언트캐시·bridge갱신/배포, 유동에이전트·연구/문서·장기복구등. 이번완료는관측재수집하위단계에한정.

### 2026-09-28 검증 기능 운영 반영 — 부분 릴리스
- 직전 fab7ca7 관측복구 구현/682개 검증으로 progress. 기존 main 반영·Cloudflare 배포 명시승인에 따라 release 수행. 전체목표와 CR004선택은 미완료 유지.
- 배포내용: 공식모델발견/계정목록수집, 초기정책·관리·고정/진단, 단계사용량, 근거보존, 관측수집/명시재수집. 자동승격 실경로/추가비교실행은 활성화하지 않음. 예산/기한/claim 내부기반은 포함되지만 공개비교capability는 미광고.
- 검증: Node682/682, Python4/4, Worker dry-run, 독립호환74/74. main 코드 a830cf3 GitHub Verify run36330950415 success. Pages run36331069052 success. app入口query model-recovery-20260928. 실제페이지부팅/no JS error 및양쪽정적asset확인.
- 최초push는 GH007 이메일공개보호로거절되어원격불변. 미게시5커밋의author/committer email을GitHub noreply로정규화, 전후treehash동일검증후재push성공. 이전history는 codex/pre-model-release-email-normalization 참조로보존. 문서의 fab7ca7 등기존기록은정규화전검증시점ID이며운영code는a830cf3.
- Worker b7116d21-aa78-4cf9-9d4b-d57a6f93df00 배포후 root E:\Develop\INNO Workspace를c67546a→a830cf3 fast-forward. 루트수정문서11개는source사본과동일함을확인하고stash e7175eb7af283064e25846c5f6856dff946230a5에보존(복원불필요,동일내용최신tree에포함). 원본/비밀/로컬DB 삭제없음.
- 운영전 기존17작업(completed15/paused1/cancelled1), active0/outbox없음 및localbusyfalse재확인. 기존bridgePID26568 idle에서종료, 새bridgePID4620 hidden기동. sourceDelegationVersion1 및busyfalse/pendingfalse 확인, 모델계정관측fresh/7개, stderr비어있음. Worker→bridge 순서는 DEPLOYMENT.md에기록.
- 운영후 인증없는state401, 인증capabilities modelPolicyManagement/modelDiagnostics/reviewObservationRecovery true, 실제모델discovery진단/retention조회정상(retentioncomplete,lastErrornull). 기존17작업상태유지.
- 실구독최소smoke1건 75b5debf-b50d-449a-8dad-00b5e06ebf1e: 도구/자료/위임없는Codex한줄요청 queued→completed/version4, INNO 연결 확인 결과클라우드회수. 실행ID579cad8a-76e3-424b-8398-4b8a930c5dd3, reported input18871/output46/cachedInput12416(입력포함), phase1기록. 실제Claude는이번릴리스에서재호출하지않음; MCPhelper불변/호환회귀와기존실증거에한정. 이smoke는추가모델품질비교가아님.
- 짧은요청의기본입력문맥18871token관측: 품질유지조건에서고정prompt/도구/설정문맥의불필요소모분석이후속필요. 무조건모델하향/컨텍스트삭제로절감했다고주장하지않음.
- 잔여: 실제여러기기/오프라인장기여정, 자동선택CR004/availability/comparison근거, 전용평가실행격리/정산, 유동에이전트및연구/문서제작품질. 부분릴리스완료이며PRD M5전체/전체플랫폼완료선언아님.

### 2026-09-28 단일 원요청 중복 전달 절감 — 서버 단계
- 직전 승인확인 턴은 상태 재확인만으로 no progress. 현재 tree9687d79 clean 재확인 후 승인된 사용량효율 범위의 원인 분석 재개.
- createTask는 원요청을 prompt와 첫 user message에 저장하며 taskPrompt는 양쪽을 출력한다. 유일한 메시지가 user이고 원요청과 정확히 같을 때만 중복 대화 렌더를 기존 No additional messages 문구로 대체. 대체 문구가 기존 행보다 짧을 때만 적용한다.
- 원요청 전문, 다중 대화/동일문장 후속 반복/수정/비user, 기존20개·8k/80k 경계 보존. stored task/message 원본은 수정하지 않는다. imported 단일동일본문에도 동일한 의미 유지.
- 구현자 RED2/4→GREEN4/4 및 인접22/22, 메인 대상4/4 통과(.inno/tmp/prompt-dedup-main-target.log). server/runners.mjs 및 tests/runner-prompt.test.mjs만 해당. 독립리뷰와 cloud routine 별도 경로 검증 진행 중.
- 이 변경은 플랫폼이 생성하는 문자열의 중복을 줄인다. 기존 smoke18871 입력토큰 전체의 원인 규명이나 실측 토큰 절감률을 주장하지 않는다. 사용자/프로젝트 지시문·도구 문맥은 제거하지 않았고 실제AI/네트워크 실행 없음. CR004결정 및 전체목표 미완료 유지.

### 2026-09-28 단일 원요청 중복 전달 절감 — 클라우드·통합 완료
- Worker routineText에도 서버와 동일한 유일 user/정확본문일치/짧은문구 조건 적용. createWorker의 인증된 run HTTP→가짜 Routine POST body까지 검증하며 Codex/local Routine/cloud Routine 세 경로를 모두 다뤘다.
- 서버 독립53/53, Worker RED8/9→GREEN9/9 및 독립인접39/39. 메인 동결후 전체688/688(.inno/tmp/prompt-dedup-full.log), Worker dry-run(.inno/tmp/prompt-dedup-dry-run.log), 구문/diff 검사 통과. 실제 AI·운영 작업·외부 Routine 호출 없음.
- 변경은 실행 프롬프트 렌더만이며 원요청, 저장 대화, 첨부, checkpoint, 라우팅/가용성/품질기준은 보존한다. 아주짧은 요청은 대체문구가 더길면 기존중복을 유지한다. 실제 tokenizer/구독소비 절감률은 미측정. 18871token 고정 문맥의 전체원인은 아직 확정하지 않았다.
- PRD M1의 오래된 운영미배포 상태를 이미검증된 2026-09-28 a830cf3 부분릴리스 상태로 정정(범위변경없음). 이번 프롬프트 패치는 개발트리 검증완료이며 main/운영에는 아직 미반영. 다음 릴리스에서 브리지 idle/outbox 및 클라우드 작업상태 확인후 반영할 것.
- CR004결정, 실제 자동선택/비교근거, 예산실행격리/정산, 유동에이전트와 연구·문서·기기/장기복구 여정은 여전히 미완료. 전체goal active 유지.

### 2026-09-28 원요청 중복 절감 운영 반영
- 직전10bfbd0은 세 구독 실행 경로 변경/전체688개 검증으로 progress. 코드 변경 없이 기존 main/Cloudflare 배포 승인 범위로 릴리스.
- main10bfbd060705f64ada3ba8590bd1723536c4b717 반영. GitHub Verify run36332146715 success. 추가 Python4/4 통과. Cloudflare Worker fea12b63-66f3-49a2-bc2a-5eb063703f55 배포(.inno/tmp/prompt-dedup-deploy.log). 정적자산 변경없음/업로드없음, D1마이그레이션없음.
- 배포전후18개 작업(completed16/paused1/cancelled1) 보존, active0/outbox없음. PID4620이 desktop-bridge임과 재차idle확인후종료. root E:\Develop\INNO Workspace clean에서10bfbd0 fast-forward, PID9488 hidden기동. authenticated local state로 cloud sync/idle/pendingfalse 및 양쪽sourcegate1 확인, stderr0bytes. 비인증cloudstate401 확인.
- 별도 실구독AI smoke는 이번에추가하지않음. 세 프롬프트본문 경로는 직전합성688개회귀 및 독립검증, 이번운영확인은배포ID·인증·연결·기존상태보존에한정. 실제토큰절감/Claude실행을 이번배포에서실측했다고주장하지않는다.
- 전체goal active. CR004 선택대기와자동선택 실근거/비교예산격리·정산/유동에이전트/연구문서·기기·장기복구 남음. 다음 작업은 승인범위 내 잔여실사용흐름 검토에서 이어간다.

### 2026-09-28 SRC02/06 모델 목록 조회 중 종료 경계 수정
- 직전b2b1886 프롬프트패치운영반영은progress. clean현재상태에서 장기복구 독립감사 수행.
- modelSnapshot 대기중 stop()되면 이후 /start 또는 /poll에서 새소유권을요청하고 실제runner는시작하지않는경합 확인. 두경로 모두모델조회직후 stopped재검사. 기존요청후guard와기존프로세스close대기는유지.
- 구현자 deferred snapshot RED20/22→GREEN22/22 및인접34/34. 메인·독립 outbox/desktop/source recovery27/27(.inno/tmp/stop-model-lookup-tests.log), 구문/diff검사통과. 실제AI/운영변경없음. 개발트리수정이며아직운영미반영.
- 다음우선복구결함1: outbox가endpoint/account에결합되지않아 A결과미전달중현재endpoint/token을B로변경하면B에old본문POST가능. 서버404/409거절도전송자체를막지못함. 현재운영에서발생했다고주장하지않으며코드경로확인. 결과보존+서버가발급한안정workspace식별/정규화origin일치검사계약필요; 비밀평문저장금지.
- 다음복구결함2: 실제TestD1합성재현에서 완료저장후응답유실→사용자후속message(completed→ready)→보관완료재전송이409. outbox가남고실제script는비재시도종료하여새작업차단. 단순409무시/old결과삭제/AI재실행금지; 원자적완료수신기록으로이미수락된동일전송만확인하는후속설계필요. 새generation/인계/위임도포함할것.
- 위결함은기존승인 SRC02/03/06의복구·계정격리요구 범위. 전체목표active, CR004선택대기와독립적으로다음수정진행가능.
