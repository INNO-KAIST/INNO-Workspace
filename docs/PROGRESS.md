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
