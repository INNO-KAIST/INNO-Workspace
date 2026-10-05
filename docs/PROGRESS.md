# SDD ledger — plan: docs/IMPLEMENTATION.md
## 현재 재개 지점 (2026-10-01)
- 전체 목표: 2026-10-01 사용자 요청으로 재개. 아래 과거 완료 표기는 당시 하위 단계의 완료이며 전체 플랫폼 완료가 아니다.
- 운영 기준: main 문서 c925a00, 실행 코드 1e504e3, Worker e2a00c32-93a7-4a98-a36b-8eeb0eb38445. 미전달 결과 작업실 귀속 운영 반영 완료.
- 개발 중: SRC02/06 delivery-receipts 계획의 Task1 식별자 완료, Task2 원자 저장·수락 경로·HTTP replay 내부 연결 검증 완료/최신 하단 기록 참조. Task3a 내부 claim 예약·상한 검증 완료. Task3b 예약의 receipt 전환·내부 ACK helper 검증 완료. Task3c HTTP claim/ACK 협상 내부 gate 연결 완료; Task3d 클라이언트 상태 전이 내부 연결 검증 완료. Task3e 실제 파일 저장·프로세스 재시작과 로그인 독립 drain 검증 완료. Task3f 내부 명시 예약 해제, Task3g 인증된 조회·폐기 HTTP, Task3h 복구 UI·client·local proxy 연결 및 Task4 Worker·실제 파일 통합 4개 검증 완료. 운영 활성화는 미완료.
- 다음: Task3i 임시파일 복구 helper 검증 완료. Task3j 전용 복구 잠금·안전 상태 조회 검증 완료. Task3k 로컬 복구 API 검증 완료. Task3l 복구 서비스 루프·스크립트 배선 검증 완료(기본0). Task3m 해시 확인 명시 전달 HTTP 검증 완료. Task3n 로컬 복구 UI 구현·독립 리뷰·실제 브라우저 검증 완료. 전체1010건 중1009통과/0실패/기존symlink1skip. 이후 legacy outbox 명시 복구와 실행 중 결과 기록 실패의 재시작 차단 검증 → 운영 활성화·배포 검증. receipt 없이 과거에 수락된 결과를 자동 인정하지 않는다. CR005 문맥 최적화는 2026-10-01 승인·PRD 반영 완료. CONTEXT-EFFICIENCY-IMPLEMENTATION.md Stage1 공통 조립/제공자 연결 검증 완료. Stage2A 범위 제한 원문 조회 검증 완료. Stage2B1 재개 상태 저장·출처 검증 완료. Stage2B2 일반 결과 전달·저장 연결 검증 완료. Stage2C 제공자별 실제 조회 helper 연결 완료. Stage2D1 선택적 문맥 전달·전체1097pass 검증 완료. 사용자 요청으로 현재 단계 종료 후 Claude handoff. 다음 최초 oversize 처리·전체 prompt 예산·관측 UI·실제 구독 환경 검증; 상세 HANDOFF-CLAUDE.md.
- **Claude 재개 지점(2026-10-01 저녁 갱신, 이 줄이 위 두 줄보다 우선):** Claude 독립 총괄 검토 후 WU1(renew 일시 오류 허용·v0 결과 저장 실패 차단), WU2(데스크톱 fail/renew의 complete 정합), WU3(Claude 선택 조회 version-only 충돌 연속성), WU4(snapshot 불가 시 전문 대체·v0 정지 안내), WU5(사용자 결정: 96KB 초과~384KB 전문 전달, 상한 초과만 차단)를 구현·독립검증·기록했다. 사용자 요청으로 로컬 커밋 d1da52d(codex/source-release, push 안 함)에 담았으며 main/Worker/Pages 미배포. 2026-10-03: WU6(문맥 전달 관측)·WU7(문서) 완료, CR-006/007 승인·CR-004 A 결정. 2026-10-03 릴리스 완료(main/Worker ebc60186/Pages/데스크톱 6125c11, Claude·Codex 실구독 최소 시험 통과, INNO Claude Routine 재생성 trig_01JqQA1ENd9B2yKpeZVLvx3J). 2026-10-03: CR-006 S1 제공자 레지스트리(로컬 커밋 696aee5, 계획 docs/superpowers/plans/2026-10-03-provider-registry.md), CR-007 S3 플러그인 등록부(로컬 커밋 7793f1c, 계획 docs/superpowers/plans/2026-10-03-plugin-registry.md, 문서 docs/PLUGINS.md) — push·배포 안 함. 2026-10-05: CR-004 A 실행 경로 평가(로컬 커밋 3cbf0e0, 문서 docs/MODEL-ROUTING.md). H4 결과 전달 복구 H4-1~H4-5 완료(커밋 전, 계획 docs/superpowers/plans/2026-10-05-delivery-journal.md, 활성화 준비 docs/DELIVERY-ACTIVATION.md). 내용: 사용자 중단 결과 정리, claim journal·nonce, 이전 형식 결과 정리 화면, 실제 프로세스 강제종료 시험 7지점. receipt gate는 0 유지. 다음: H4 커밋 확인 → receipt 활성화·배포·실구독 시험은 사용자 승인 대기. (이전 2026-10-01 예약 재개 계획은 이 세션에서 직접 진행으로 대체)
- CR-004는 A안으로 결정(2026-10-03)되어 실행 경로 평가를 구현했다(2026-10-05, 커밋 전). 추가 비교 예산 0이라 실제 승격 근거 형성은 미확인.
- 전체 잔여 범위는 REQUIREMENTS-STATUS.md와 PRD.md 유지. 세부 검증과 한계는 아래 최신 일자 기록에 누적한다.

## 과거 단계 기록

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

### 2026-09-28 SRC02/03 outbox 작업실 귀속 — 서버 식별자
- 직전61679b2 중단경계수정은progress. 현재clean확인후기존승인 SRC02/03/06 내계정격리수정계획 docs/superpowers/plans/2026-09-28-outbox-workspace-binding.md 작성. 새언어/런타임/스키마없음.
- Task1 인증GET /api/desktop/identity는기존D1 metadata의desktop_workspace_id UUID v4 한행반환. 기존값읽기만, 최초INSERT OR IGNORE후read; 손상값failclosed, 인증없는요청storage접근전거절. 단일행이라작업수따른누적없음/revision변경없음.
- 구현자RED1/4→GREEN4/4, 인접24/24; 메인4/4(.inno/tmp/workspace-identity-target.log), 구문/diff검사통과. 실제AI/네트워크/운영DB수정없음. 아직로컬outbox귀속연결이없어계정격리결함완료아님.
- 다음서버기대workspaceheader검증+claim응답ID, 그후로컬binding캡처/재전송직전확인/redirect금지로순차진행. 조회→POST사이DB교체는네트워크본문전송원자보장불가, 서버저장차단으로구분. 같은UUID복제DB는구별불가. legacyoutbox는자동귀속/삭제금지이며후속명시복구계약필요.

### 2026-09-28 outbox 귀속 Task2a 서버 경합 검사
- Task1 독립4/4 후 서버순차단계. 인증된 desktop POST poll/start/renew/complete/fail는body·modelsreport·mutation이전 안정workspaceID조회. x-inno-workspace-id 헤더가존재하면비일치(빈값포함)409. 모든complete인계/위임/review분기전중앙검사. 기존무헤더클라이언트허용.
- poll/start는 top-level workspaceId를반환해새desktop이preflight와실제claim의식별자를대조가능. 손상identity는500safe/작업변경없음. 구현자RED4/7→GREEN7/7, 인접64/64, 메인7/7(.inno/tmp/workspace-guard-target.log). 로컬binding Task2b진행중, 아직전체격리완료/배포아님.

### 2026-09-28 outbox 귀속 Task2b·통합 검증 완료
- 새desktop production script에 readDeliveryBinding 필수연결. preclaim identity확인+stopped재검사, 서버claim응답 ID대조후AI시작, 실행당binding복사·고정, renew기대ID header, outbox binding보존. deliver직전identity다시조회하고원주소/ID일치때만결과POST.
- legacy/malformed/다른origin/새DB/identity조회실패는보관파일유지·결과POST0·새AI0. helper는HTTPSorigin정규화/외부absolute·protocol-relative·역슬래시URL차단/redirect:error/700000bytes한도. runtime오류안내는WORKSPACE_UNVERIFIED와WORKSPACE_MISMATCH구분, 토큰/원문추가저장없음. 기본옵션없는라이브러리호환경로는유지하지만실제script는항상검사주입.
- Task2b RED0/9→GREEN9/9 후보강12/12. 처음RED의stop콜백대기하네스는bounded event-loop 판정으로수정해미구현검사도종료되도록함. fake Worker HTTP와실제fileoutbox통합: 정상complete,preflight후다른DB409/DB무변경/파일보존,원DB재연결및파일재시작후replay성공/AI재실행0. 실제AI·외부HTTP·운영DB 없음.
- 메인최종전체709/709(.inno/tmp/workspace-binding-full.log), 독립43/43, Worker dry-run(.inno/tmp/workspace-binding-dry-run.log), 구문/diff검사통과. docs/DESKTOP-BRIDGE에정상복구/legacy보류/구버전호환과보장한계기록. REQUIREMENTS-STATUS의오래된CR003미배포표기도실제부분배포상태로정정.
- 개발브랜치검증완료이며이번patch는아직운영미반영. 다음릴리스는기존idle/outboxempty확인후Worker→bridge순서. 무헤더구bridge는보호미적용; same-origin identity확인후DB교체의본문네트워크전송자체는보장불가(서버mutation은차단),같은ID복제DB구별불가.
- 남은장기복구핵심: 이미수락된완료응답유실후후속message/newgeneration 재전송수신기록계약, 식별자없는legacy명시귀속도구, renew오류로outbox생성전중단되는결과보존범위. 이번패치로전체장기복구/전체플랫폼완료를주장하지않음. 전체goal active.
- 검증순서보충: 전체709/709·독립43/43 이후소스변경없음. 동일ID의인증토큰교체를테스트만보강했고최종메인대상12/12(.inno/tmp/workspace-binding-final-target.log)로재확인. 실제자격증명교체나운영호출은없음.

### 2026-09-28 작업실 귀속·중단 경계 운영 반영
- 직전1e504e3 구현/709개검증은progress. 기존main/Cloudflare승인에따라61679b2중단수정과1e504e3작업실귀속을함께배포. code main1e504e3, GitHub Verify36333735375 success, Python4/4 추가검증.
- Worker e2a00c32-93a7-4a98-a36b-8eeb0eb38445 배포(.inno/tmp/workspace-binding-deploy.log). 정적자산변경/업로드없음, 스키마migration없음. 인증identity GET 및 새bridge poll에서 기존metadata에고정identity한행초기화.
- 배포전후18작업(completed16/paused1/cancelled1), active0/outbox없음확인. 기존PID9488의desktop-bridge/idle재확인후종료, root clean b2b1886→1e504e3 fast-forward, 새PID26892 hidden실행. 양측sourcegate1, localbusyfalse/stoppedfalse/pendingfalse, stderr0bytes.
- 실제Worker identity반복GET동일ID, 비인증401, 임의다른workspaceID+malformedbody POST /api/desktop/poll은본문검사/claim전409. 새bridge인증state조회정상, 기존작업상태보존. 토큰/작업본문/identity값출력없음. 실제구독AI실행은추가하지않았고 실제outbox동일결과회수는직전fakeWorker+실제파일통합증거에한정.
- 남은복구: 수락완료응답유실후후속메시지/세대변경의receipt재전송, legacy명시귀속도구, 실행renew실패전후결과보존. CR004결정과전체기획도미완료. 전체goal active.

### 2026-09-28 SRC02/06 내구성 수신 기록 Task1
- 직전c925a00 계정격리운영반영은progress. 현재clean코드확인후완료응답유실+후속message/newgeneration 복구계획 docs/superpowers/plans/2026-09-28-delivery-receipts.md 작성. 기존승인복구/축적관리범위, 새스택없음.
- 독립원자성감사: replaceTask/replaceDelegation accepting전이에만명시receipt전달, task mutation과receipt동일D1batch. changes()예산/리비전의존SQL보존, parentoperation/child성공검사, 동시CAS패자의receipt재조회필요. upfrontreplay는catalog.report/legacyshortcut/dispatch보다앞이어야함. receipt없는과거수락은추정증명하지않음.
- 독립보존감사: pending→수락descriptor확인→atomic ack_pending저장→서버release→localclear 계약. 신뢰된로컬phase하에missingrelease는멱등응답가능, 별도HMAC영구키불필요. offlineunacked임의TTL삭제금지. 제안상한은inflightclaim슬롯예약까지원자결합해야완료후거절로AI낭비안함; 아직슬롯/정리구현전. fileflush/rename전원상실내구성은별도입증필요.
- Task1 public/core/delivery-receipt.mjs의createDeliveryReceipt는JSONwire정규화·객체key순서무관/배열순서보존으로owner tuple id와전체payloadDigest SHA256생성. 반환은version/workspace/task/execution/generation/action/id/digest만, 원문없음. 700000UTF8bytes/depth64/식별자200문자/positiveSafeGeneration/UUIDv4와complete|fail검증. prototype형key·undefined/nonfinite/toJSON·cycle/BigInt 경계확인.
- 구현자RED stub7/7실패→대상/인접15/15, 전체717/717보고. 메인대상8/8직접통과(.inno/tmp/delivery-receipt-target.log). 서버body파싱결과와클라이언트실제wirepayload기준으로만사용해야함. 아직productionimport/API연결/자동복구활성화/운영배포없음. Task2atomic전이와Task3ack/정리/예산슬롯을이어구현해야함.
- 동결후독립대상8/8·모듈구문·diff검사통과, 차단결함없음. 전체goal active이며수신기록실연결/정리/legacy복구및전체기획잔여를유지한다.

### 2026-09-28 SRC02/06 Task2a 내부 원자 수신 기록 저장
- 직전47ea757 shareddescriptor구현은progress. 현재clean확인후Task2a명시옵션hook구현: replaceTask(...,authorization,{deliveryReceipt}) / replaceDelegation(...,policyPlan,{deliveryReceipt}). 프로덕션route는아직옵션을전달하지않으며기존경로유지.
- worker/delivery-receipts는정확필드/owner tupleSHA/실제DBworkspace/현재Codex실행/수락전이검증. 첫await전descriptor복사, acceptedAt서버시각. 완료·실패·인계·배정·검토재시도·사용자결정대기의허용형태를구분하며running갱신이나task-onlywaiting_children기록거절. payloadDigest와실제HTTP본문대조는후속route에서필수.
- 기존budget/revision changes()순서보존후receiptINSERT를같은D1batch에추가. taskversion/parentoperation/DBworkspace조건및0write sentinel로작업·자식·revision·receipt전체rollback. 기존receiptkey덮어쓰기불가. evaluation budget commit과receipt동시옵션은명시거절. CAS실패는수신기록없음/Conflict분류보존.
- 독립중간발견반영: delegation은authoritativeparentowner, 정확한frozen2children/records집합, 실제child부모·batch·버전, before/after동일ID와1증분검사. unchanged완료형제보존reviewretry허용. 부모만갱신하거나child0쓰기/다른ID혼합은receipt와부모전이모두없음.
- 구현자RED에서기존receipt누락·mutabledescriptor·부모only·위조snapshot·child누락/crossID/version·불완전decision을재현후수정. 최종target18/18, 인접103/103, 전체735/735(.inno/tmp/receipt-store-full.log) 메인로그확인+메인target18/18(.inno/tmp/receipt-store-main-target.log). Worker dry-run(.inno/tmp/receipt-store-dry-run.log)은마지막decision형태predicate보강전이며모듈/의존구조동일, 최종구문검사통과. 실제D1/AI/외부HTTP실행없음.
- Task2전체는미완료: domainaccepting메서드옵션전달/HTTPupfrontreplay·CAS패자재조회/receipt응답아직없음. Task3claimslot/상한·ack_pending·서버release·fileflush복구도남음. capability미광고/운영배포없음. 전체goalactive.
- 최종동결본독립58/58 및모듈구문/diff검사통과, 차단결함없음. 다음은Task2의수락메서드/HTTP replay를이hook에명시연결하되Task3수명관리검증전공개활성화하지않는단계.

## 2026-09-28 — SRC02/06 Task2b 수락 경로 연결
- 완료: store finish/fail/handoff/requestDecision, CloudBridge complete/fail, Delegations allocate/retryReview/requeue, orchestration allocate/retryReview에 선택적 deliveryReceipt를 명시적으로 전달한다. 실제 수락 DB 변경에만 붙으며 dispatch/reconcile로 전달하지 않는다.
- 기존 호출은 유지한다. receipt를 사용하는 상태 기반 replay는 저장된 기록 확인 전 409로 거절하고 null은 해당 shortcut에서 400으로 거절한다. 기존 성공 상태로 새 receipt를 만들지 않는다.
- 검증: 새 domain RED 6건 및 null replay RED 후 GREEN 7/7; 구현자 인접 127/127, 최종 전체 742/742 (.inno/tmp/receipt-domain-full.log). 메인 별도 대상 7/7, 독립 검토 대상·인접 120/120, 구문·diff 검사 및 기존 Wrangler dry-run 통과 (.inno/tmp/receipt-domain-dry-run.log).
- 운영 변경/실제 AI 실행/새 스택 없음. HTTP index 및 capability는 미연결이다. Task2 전체, Task3 보관 상한·claim 예약·ack_pending 정리와 통합 배포는 미완료다.
- 다음: 원본 parsed HTTP input에서 descriptor 생성, catalog/report·상태 shortcut·dispatch보다 앞선 저장 receipt 조회, CAS 패배 재조회 및 일치한 요청만 성공 응답. 프로토콜 활성화는 Task3 완료 이후.
## 2026-09-28 — SRC02/06 Task2c HTTP replay 연결 (운영 비활성)
- 원본 parsed HTTP payload에서 descriptor를 계산하고 모델 보고·상태 shortcut·dispatch보다 먼저 저장 receipt를 조회한다. 동일 결과 재전송은 task 조회/변경 없이 receipt만 반환한다. 내용 불일치·손상 저장값은 거절한다.
- complete의 일반/하위 완료·handoff·allocation·review retry/decision/pass와 fail에 명시적 옵션 전달. CAS 또는 수락 후 후속 처리 실패는 동일한 저장 receipt가 있을 때만 성공 확인한다. 영수증 없는 기존 성공을 자동 전환하지 않는다.
- 내부 createWorker({deliveryReceiptVersion:1})에서만 테스트 가능. 기본/exported Worker는 0이며 capability도 광고하지 않는다. 비활성/잘못된 protocol header와 workspace header 누락은 본문 처리 전 거절한다.
- 검증: HTTP RED 7건 중 6건 실패 재현 후 GREEN 11/11, 최종 전체 753/753 (.inno/tmp/receipt-http-full.log), 메인 대상 11/11, 독립 인접 80/80, 구문·diff 및 Wrangler dry-run 통과. 실제 AI·운영 호출 없음.
- 다음 Task3: 실행 회차별 admission 예약과 receipt 합계 상한, 원자 예약→수신 기록 전환, 로컬 pending→ack_pending→서버 해제→파일 정리, 불확실 실행의 명시적 복구. 후속 설계는 delivery-receipts 계획에 기록했다. 전체 복구 및 제품 전체 완료는 아니다.
- 마지막 테스트 보강: 실제 새 Codex generation 시작 후 이전 결과 replay에서도 새 owner·running 상태·전체 task snapshot·revision 보존을 확인했다. 테스트 파일만 변경했으며 최종 메인 대상 11/11 통과 (.inno/tmp/receipt-http-main-final.log). 전체 753/753 및 독립 80/80은 이 테스트 보강 전 동일 구현 코드 기준이다.

## 2026-09-28 — SRC02/06 Task3a 내부 claim 예약·상한
- claimExecution의 별도 내부 options에서만 receiptVersion1 Codex claim을 예약한다. API 입력에 예약 권한을 넣을 수 없고, HTTP 경로는 아직 이를 전달하지 않는다.
- owner(workspace/task/execution/generation)별 reservation과 receipt 합계 1024건 상한. 실제 task UPDATE와 예약 INSERT 모두 workspace/cap guard를 가지며, task→budget(있는 경우)→revision→reservation→rollback sentinel 순서로 원자 처리한다. 상한은 DESKTOP_DELIVERY_CAPACITY로 구분하고 bridge가 삼키지 않는다.
- 새 claim은 이전 checkpoint의 protocol version을 명시 갱신하며 legacy가 version1을 물려받지 않는다. 이전 실행 예약은 자동 삭제하지 않는다.
- 검증: RED 8건 실패 후 최종 대상 12/12, 인접 74/74, 전체 765/765 (.inno/tmp/receipt-reservation-full.log); 메인 대상 12/12, 독립 71/71, 구문·diff 및 Wrangler dry-run 통과. 마지막 한 슬롯 동시 요청/동일 작업 CAS/INSERT 실패·0행/작업실 교체/평가예산 롤백을 포함한다.
- 미완료: Task3b reservation→receipt 전환과 unreceipted 결과 거절, ACK 해제; 공개 claim 협상, 클라이언트 pending→ack_pending, no-result 명시 복구와 UI. 운영 기본 protocol은 계속 비활성이다. 새 스택·AI 실행·배포 없음.
- 클라이언트 설계 검토에서 초기 outbox 쓰기 실패 후 새 claim 차단, Codex 로그인과 독립적인 pending drain, Windows power-loss 보장 한계를 계획에 추가했다.
## 2026-09-28 — Task3b 완료 후 사용자 요청 일시중지
- 현재 세부 단계 완료: version1 claim의 정확한 owner 예약을 raw CAS로 삭제하고 같은 batch에서 receipt를 저장한다. missing/손상/변경된 예약은 거절, task·children·revision·예약은 실패 시 함께 rollback. cap 1024에서도 기존 슬롯을 교체하므로 결과 수락 가능하다.
- 모든 새 receipt는 version1 claim+예약 필수다. 미배포 Task2 테스트 fixture를 최종 계약에 맞게 갱신했다. opted 결과의 무영수증 수락/상태 replay는 거절하고 legacy no-receipt, renew/pause/cancel/reconcile는 유지한다.
- 별도 내부 releaseDeliveryReceipt helper는 exact9필드·ID hash·workspace·저장값을 검증 후 raw CAS DELETE. 동시 ACK의 missing은 멱등 처리, 다른 내용/계속 남은 row는 거절. task/revision은 바꾸지 않는다. 아직 HTTP 노출 없음.
- 검증: 최종 전체 785/785 (.inno/tmp/receipt-acceptance-full.log); 메인 acceptance+ACK 18/18; 독립 인접 142/142; 변경 Worker 구문·diff 검사 및 Wrangler dry-run 통과. 마지막 HTTP 테스트 보강도 최종 전체 실행에 포함됨. 실제 AI·운영 DB 변경·배포 없음.
- 사용자 요청: 현재 작업까지만 마무리한 뒤 토큰 절약을 위해 일시중지. 새 세부 단계와 배포를 시작하지 않는다. 전체 플랫폼 목표는 미완료다.
- 재개 지점: Task3 공개 claim/ACK 협상, 클라이언트 pending→검증된 ack_pending 영속화→서버 release→local clear. missing ACK 성공만으로 초기 pending 원문을 삭제하지 말 것. 예약 없는 실행의 명시적 복구, 로컬 쓰기 실패 후 새 claim 차단, 로그인과 독립적인 outbox drain도 남아 있다.
- 운영은 기존 c925a00 문서 / 1e504e3 실행 코드 유지. 새 receipt protocol은 기본 비활성. 전체 목표 및 CR004 대기 상태는 유지한다.
## 2026-10-01 — 재개, Task3c HTTP 협상 및 CR-005 설계
- Task3c: 내부 version1 gate에서 poll/start에 reservation 옵션 전달과 확인 버전 응답, ACK의 인증/workspace/URL task/정확 receipt 확인 및 release helper 연결. ACK는 catalog/task/dispatch를 실행하지 않는다. capacity code는 허용한 값만 응답한다.
- opted hydration 실패는 원래 오류와 reservation을 보존하며 가짜 receipt를 만들지 않는다. no-result 명시 복구는 여전히 남아 있다. 기본/exported Worker는 gate0, capability 미광고, 운영 배포 없음.
- 검증: TDD 대상5/5, 전체790/790 (.inno/tmp/task3c-http-full.log), 메인5/5, 독립66/66, diff 및 기존 Wrangler dry-run 통과. AI 실행/외부 운영 데이터 변경 없음.
- 다음: 클라이언트의 verified claim/pending→ack_pending→ACK→clear, 파일쓰기 실패 차단, 구독 CLI 로그인과 독립적인 결과 drain, no-result 복구 및 통합·기기 검증. 과거 운영 버전 정보는 9월28일 확인값이며 이번에 운영을 다시 조회한 것은 아니다.
- 새 사용자 요구 CR-005 접수: 장기 대화 압축에 더해 공급자 공통 문맥 구성/중복 제거/선택 조회/재개 상태 검증/실측·캐시 구분. docs/CONTEXT-EFFICIENCY-PROPOSAL.md 작성, PRD 편입 승인 질문 전달; 승인 전 제품 코드 변경 없음.
- 읽기전용 감사: server/runners.mjs taskPrompt 및 worker/index.mjs routineText의 최근20개/각앞8000자/합계뒤80000자/checkpoint앞8000자 제한은 과거 결정·긴 요청의 끝부분을 누락할 수 있다. 단일 최초 요청 외 중복 제거는 제한적이다. 이 범위를 CTX-01~06으로 제안했다.
- 개발 작업에도 전체 이력 재독보다 재개 문서·변경 파일 확인, 최소 맥락 위임, 변경 범위별 테스트와 최종 전체1회를 우선한다. Sol 구현 위임은 용량 부족으로 실패하여 기본 모델 위임으로 한 번 대체했으며 중복 구현은 없었다.
## 2026-10-01 — Task3d 클라이언트 수신 확인 상태 전이
- 명시적 deliveryReceiptVersion1 내부 옵션에서만 claim 버전/workspace/owner를 AI 실행 전 확인한다. 기본 legacy 유지, renew에는 receipt header를 보내지 않는다.
- exact wire pending을 보관하고 동일 descriptor의 서버 receipt를 검증한 뒤 원문 없는 ack_pending을 await write한다. 그 후 ACK 응답을 검증하고 await clear한다. ack_pending으로 생성한 새 bridge 인스턴스는 result POST/poll/runner 없이 ACK만 실행한다.
- 최초 결과 구성·저장 실패와 확인 불가능한 claim은 deliveryUnsafe로 새 claim/start를 막는다. 갱신 오류/중지 시 opted 결과를 먼저 저장하고 자동 전달하지 않는다. pending drain은 새 실행과 구분한다. 메모리 latch의 재시작 이후 지속성이나 전원 차단 보장은 주장하지 않는다.
- 독립 검토에서 null 응답이 검증 전 destructuring을 통해 latch를 우회하는 결함을 찾아 수정했다. 최종 대상19/19, 최종 전체809/809 (.inno/tmp/task3d-client-final-full.log), 메인19/19, 독립 최초73/73 및 수정후 관련53/53, diff 통과.
- 검증은 mock outbox의 실패·새 인스턴스 재개를 포함한다. 실제 FileOutbox flush와 별도 프로세스 재시작, 로그인과 독립적인 startup drain, no-result 명시 복구는 다음 단계다. Worker 코드 변경 없어 이번에는 dry-run을 반복하지 않았다. 프로덕션 옵션/스크립트 변경·배포·실제 AI 없음.
- CR-005 설계 승인 질문은 계속 대기; 자동 목표 재개를 승인 응답으로 해석하지 않는다. 기존 승인 범위의 복구 작업은 계속 가능하다.
### 2026-10-01 SRC02/06 Task3e 실제 파일 재시작·시작 검사 분리
- FileOutbox는 배타적 tmp 생성 → write → fsync → close → rename으로 저장한다. write/flush/close/rename 실패는 기존 pending 및 tmp를 보존하며, tmp가 남으면 read/write/clear를 차단해 명시 복구를 요구한다. JSON scalar/배열을 빈 outbox로 오인하지 않도록 거절한다.
- 실제 자식 프로세스 종료·재시작 7개 경계에서 pending/ack_pending 보존을 검증했다. ack_pending 재개는 결과 POST·새 claim·AI 재실행 없이 ACK만 전송한다. 합성 HTTP이며 실제 AI·운영 DB 호출은 없다. Windows 전원 상실 시 디렉터리 rename 내구성은 입증하지 않았다.
- 실제 desktop script의 선행 runner.available 검사를 beforeClaim helper로 옮겼다. 저장된 결과·ACK 정리는 로그인 여부와 독립적이며, 새 claim에는 저장 공간과 CLI 가용성 검사를 적용한다. 기본 receipt protocol 0을 유지한다.
- 구현 대상 37/37 및 readiness 인접 46/46; 독립 파일 37/37·startup 39/39, 미해결 리뷰 결함 없음. 최종 통합 Node 830/830 (.inno/tmp/task3e-final-full.log), script 구문 및 git diff --check 통과. 최종 전체 검사 이후 제품 코드 변경 없음.
- 내부 개발 완료이며 운영 미배포. Task3 전체와 Task4는 미완료: no-result 예약, tmp/legacy 명시 복구, 실제 Worker lifecycle 통합과 활성화 필요. CR004/CR005 승인 대기 상태 유지. 전체 목표 active.
### 2026-10-01 SRC02/06 Task3f 명시 예약 해제·Task4 파일/Worker 통합
- 내부 releaseDeliveryReservation은 정확한 6필드 예약과 expectedVersion/confirmDiscard:true를 요구한다. running(만료 포함), 손상 task/예약, 다른 작업실, complete/fail 수신 기록 존재를 거절한다. raw 예약·task body/version·workspace·양쪽 receipt 부재를 단일 DELETE로 검사하며 task/revision/budget를 수정하지 않는다.
- 예약 missing은 reservation_not_found만 반환한다. 결과 수락이나 과거 폐기 성공의 증거가 아니다. 새 TTL/tombstone/자동 삭제 없음. 현재·과거 실행 예약의 수동 폐기 기반이며 HTTP/UI는 아직 연결 전이다.
- 구현 RED0/17 → GREEN22/22, 독립22/22 및 인접39/39. 실제 late acceptance 승리 시 receipt 보존·discard 충돌; discard가 acceptance preflight 이후 먼저 실행되면 수락 batch 전체 rollback(task/revision 불변/receipt0)을 독립 재현했다. expiry-paused recoverInterrupted 경로에서도 missing reservation으로 차단됨을 확인했다.
- 신규 delivery-lifecycle.test는 createWorker+TestD1+createCloudRequest+실제 FileOutbox+DesktopBridge를 연결한다. 정상 complete/ACK 정리, 수락 응답 유실 후 후속 메시지 보존 재전송, ACK 응답 유실 후 ACK만 재시도, 작업실 교체 시 pending 보존·원DB 재연결 4/4. 새 모델 조회/claim/AI 재실행 없이 drain됨을 검증했다. fixture 파일만 비재귀 정리한다.
- 최종 전체 Node 856/856(.inno/tmp/task3f-lifecycle-full.log), 독립 검토 결함 없음, git diff --check 통과. 실제 네트워크/AI/운영DB/스키마 변경 없음. 테스트 SQLite와 in-process Worker 증거이며 실제 Cloudflare 장애 복구 보장을 의미하지 않는다.
- 다음은 복구 API/사용자 확인·임시파일/legacy 명시 복구·실제 script 활성화와 릴리스 검증이다. default protocol0 유지, 운영 미배포. CR004/CR005 승인 대기 및 전체 목표 active 유지.
### 2026-10-01 SRC02/06 Task3g 인증된 예약 조회·명시 폐기 경로
- POST desktop/:task/reservations와 /discard를 내부 protocol1 gate에 연결했다. 인증·정확한 version/workspace header가 필요하며 새 경로는 기존 workspace metadata만 읽고 missing/손상을 거절한다. 조회·거절은 쓰기0, catalog/report/claim/dispatch 미진입. default/exported0과 기존 legacy 경로 유지.
- 목록은 정확한 input/expectedVersion/afterKey를 검증하고 최대1025행 SELECT로1024초과를 거절한다. 전체6필드/workspace/hash검증 후 해당task만50개 keycursor페이지로 반환한다. 페이지 고정스냅샷 보장없으며 폐기는별도CAS. 1024개 Node로컬wall 약41ms는Cloudflare CPU/무료구간성능증거가 아니다.
- 독립리뷰에서 header A 확인후본문읽기중 DB B 전환+B본문이면 discard가 B예약을지울수있음을재현했다. ACK에도동일원인. 두분기의 body.workspaceId와최초desktopWorkspaceId를결합해수정하고 recovery identity UUID검사도body전에강제했다. RED재현 후신규3회귀통과, 미해결리뷰없음.
- 최초 새HTTP RED1/14→기능구현16/16, 전체872/872(.inno/tmp/task3g-full.log)는위경합보강전검증. 최종보강후 구현자·독립관련58/58, 메인최종변경/통합57/57(.inno/tmp/task3g-final-main.log), Worker dry-run(.inno/tmp/task3g-final-dry-run.log), diff검사통과. 불필요한전체검사반복은하지않았다.
- 운영/실제AI/외부HTTP/스키마변경없음. 사용자UI·client headers·local proxy·CORS연결은아직미구현이며독립읽기감사결과를기존계획에저장했다. 로컬/다른기기의결과존재를서버가증명할수없으므로해제확인과pending차단은다음연결에필수. 임시파일/legacy복구와활성화도남아있다. 전체goal active; CR004/CR005승인대기.
### 2026-10-01 SRC02/05/06 Task3h 사용자 복구 UI·클라이언트·로컬 연결
- WorkspaceClient 예약조회/폐기는 매요청 identity를 새로 확인하고 baseUrl/token/remote와 UI isCurrent를 identity 후 POST 직전 다시 검사한다. 전환된 old client 요청이 뒤늦게 전송되지 않는다. 이미 성공한 폐기를 뒤늦은 연결 변경으로 실패로 바꾸지 않는다. 추가 header는 workspace/version으로 제한하고 redirect:error 적용.
- 로컬 proxy는 identity/예약 route를 명시 허용하고 auth/origin/header/body 귀속검사를 유지한다. discard는 bridge.maintenance 내부 fresh binding 재검사 후 전달하여 busy/pending/stopped/unsafe 경계를 지킨다. script의 기존 binding 함수를 재사용한다. Worker 내부 version1만 recovery capability true, 기본/exported0 그대로이며 승인origin CORS에필요header만추가.
- 별도복구dialog: task예약50개페이지, 두확인(모든기기의실행종료/미전달결과없음), 실행/로컬상태차단, selection/client/epoch/version 무효화, exact descriptor 응답검증. missing은성공표시하지않음. 자동조회poll/자동retry/원본파일삭제/브라우저확인영구저장없음. 목록DOM유지로focus보존, 한국어일시/모바일줄바꿈.
- UI 초기RED는module-not-found이며행동RED증거아님. 실제추가안전회귀4개가실패후수정됨: version변경중busy영구유지, 잘못된목록/응답, 목록DOM보존등. UI최종10/10, client/proxy구현60/60, 독립A인접47/47 및최종UI/client/proxy26/26. 최종전체901/901(.inno/tmp/task3h-full.log), Worker dry-run(.inno/tmp/task3h-dry-run.log),구문/diff검사통과.
- 실제C UA in-app browser에서 real Worker/TestD1 in-memory/localproxy/public UI를 연결한127.0.0.1임시화면검증. desktop 및390x844 viewport, 목록선택, 체크1개일때폐기비활성, Escape취소및focus복귀, 재열기체크초기화, 체크2개후검증용예약해제/성공문구/버전3유지확인. 실제휴대폰하드웨어·클라우드배포검증은아님. 임시viewport복원·탭닫기·식별된검증용Node종료·fixture파일삭제완료.
- 운영/유료API/실제AI/운영DB변경없음. 새기능기본비활성, 미배포. 다음은 orphan tmp/legacy명시복구 및결과저장실패후재시작차단보장, 최종활성화/릴리스검증. 전체goal active, CR004/005승인대기유지.
### 2026-10-01 SRC02/06 Task3i 임시파일 복구 helper
- 고정 pending/.tmp 경로에서 최대1MiB+1 읽기, regular-file/UTF-8/부모 경로·파일 정체성·해시 검사. 조회는 원문 없는 상태·검증된 owner/binding만 반환한다. legacy는 진단만 가능하다.
- 명시 확인·예상 해시·호출자 배타 잠금 필수. 일치하는 pending/ack_pending 조합만 flush→close1회→재검사→rename으로 승격한다. orphan ACK·손상·다른 결과는 보존하며 거절한다. rename 후 잠금 해제 실패는 성공+recoveryLockUncertain으로 구분한다. 자동 삭제/TTL/백업 누적 없음.
- 메인 검토에서 BOM 자동 제거로 기존 FileOutbox가 읽지 못하는 파일을 승격하는 문제를 발견했다. 실제 RED 후 ignoreBOM:true로 파싱 거절, 양 파일 보존 회귀 통과. NUL 경로 의심은 독립 재현으로 철회하여 불필요한 변경 없음.
- 최종 전체918건:917통과/0실패/1skip(.inno/tmp/task3i-full.log). 최종 대상53통과/1skip, 독립 최초33통과/1skip 및 BOM 추가1/1, 구문/diff 통과. 실제 자식 프로세스 재시작·flush/close/rename 실패 포함. Windows 실제 symlink 생성은 EPERM으로 skip; 주입 unsafe-file 검사에서는 원문 open0 확인.
- 외부 편집자에 대한 완전 CAS, 전체 Windows reparse 방어, 전원상실 rename 내구성은 보장하지 않는다. helper만 내부 완료이며 서비스/UI/legacy 채택/영속 claim journal 미완료. 기본 protocol0, 실제AI/운영DB/배포 없음. CR004/005 승인 대기, 전체 목표 active.

### 2026-10-01 SRC02/06 Task3j 브리지 복구 잠금·종료 대기
- 내부 protocol1 recoveryInspect/recoveryMaintenance가 tick/start/기존maintenance와 같은 busy를 첫 await 전에 선점한다. 읽기 검사는 unsafe를 초기화하거나 새로 설정하지 않으며, 변경 복구는 진입 즉시 unsafe를 유지한다. busy/stopped/version0는 콜백 전에 거절한다. 기존maintenance 제약 유지.
- settled는 진행 중 복구 완료도 기다린다. 복구 도중 stop은 완료된 승격을 실패로 바꾸지 않고, 완료 후 busy만 해제한다. version1 outbox 읽기 오류는 status/start/tick/maintenance에서 unsafe를 유지하고, status는 원문 오류 없이 pending:true/recoveryRequired:true를 반환한다. 정상 legacy 상태 형식 유지.
- 실제 FileOutbox+복구helper+bridge에서 명시 승격→complete/ACK 전달→새 claim/AI0 검증. 검사 오류·동시 진입·실패 후 재시도·stop/settled 대기 포함. RED0/7→신규8/8, 구현 관련73통과/1skip, 독립57/57, 최종 전체926건 중925통과/0실패/1skip(.inno/tmp/task3j-full.log), 구문/diff 통과. skip은 앞 단계의 실제 Windows symlink 생성 권한 제한이다.
- 이 보호는 프로세스 내부다. 재시작 이후 안전성은 영속 claim journal·소유자 확인 계약이 필요하다. 이번에 scriptloop/HTTP/UI는 변경하지 않았다. 다음은 클라우드 의존 없는 로컬 복구 endpoint·polling 정지 상태 및 명시 drain-only 연결. 기본 protocol0/운영 미배포/실제AI 없음. CR004/005 승인 대기, 전체 목표 active.

### 2026-10-01 SRC02/06 Task3k 클라우드 독립 로컬 복구 API
- GET /api/desktop/status는 파일 I/O 없는 runtimeStatus와 outboxStatus:not_inspected를 반환한다. 내부 version1+helper가 있을 때만 GET /api/desktop/recovery와 POST /api/desktop/recovery/promote 사용 가능. 기존 token/Host/Origin 인증 이후 cloud 처리 전에 분기하며 기본0은 파일복구404.
- GET 검사는 recoveryInspect 안의 bounded helper 1회만 사용하고 잠금 해제 후 메모리 상태를 결합한다. 기존 status의 전체 FileOutbox 재독을 피하여 큰 파일 진단의 메모리 한도를 유지한다. POST는 helper.withExclusive 잠금만 한 번 사용하고 commit후 상태/파일I/O 없음. 새route 오류는 고정 메시지로 원문/경로 누출 방지.
- 실제 HTTP+bridge+FileOutbox+helper: cloud unavailable에서 조회·승격, 인증/origin/host거절, busy/stopped파일보존, stalehash/확인/경로추가거절, 유사경로·잘못된메서드404, 같은hash동시승격200/409 한 번만commit. 2MiB파일에서 unbounded outbox.read0 및 oversize검사, 새claim/AI0 검증.
- 최초RED0/7→최종신규13/13, 관련54통과/1skip, 독립38/38. 전체939건 중938통과/0실패/1skip(.inno/tmp/task3k-full.log), 구문/diff 통과. skip은 기존Windows 실제symlink권한제한.
- scriptloop/운영helper배선/UI는 아직 변경 전이며 endpoint만 내부 완료다. 다음은 version1 오류 후 HTTP/프로세스잠금을 유지하는 복구서비스·명시 drain-only·화면 및 영속 claim journal. 기본protocol0, 운영미배포, 실제AI/운영DB변경없음. CR004/005 승인 대기, 전체목표 active.

### 2026-10-01 SRC02/06 Task3l 복구 서비스 대기·명시 저장 결과 전달
- polling/backoff를 runDesktopService로 분리했다. version0 기존 재시도/종료 기준 유지. version1은 unsafe 또는 비재시도 오류에서 sticky pause 후 abort까지 타이머·poll 없이 대기하여 HTTP/프로세스 잠금을 유지한다. 안전한 status분류로 중복 오류 알림을 억제하고 정상tick후 다시 알림 가능하다.
- pauseForRecovery는 stopped와 구분하며 새start/tick을 막는다. beforeClaim/models/identity/claimresponse 이후 paused뿐 아니라 deliveryUnsafe를 검사한다. 상태조회 파일오류가 준비도중 unsafe만 설정하는8개경계RED후보완. 배정요청 응답유실은 retryable이라도 unsafe; 결과전송재시도와구분. asyncstart오류는busy해제전pause, onError거절도안전정리.
- drainPending은 같은복구잠금과settled추적으로 저장결과만전달하고 empty는false. 성공/실패/empty모두pause유지·모델조회/claim/AI0. 실제파일complete/ACK전달, 실패보존, 중복drain거절검증. HTTP연결은아직없음.
- 실제script는단일constant0을bridge/helper/HTTP/service에배선. 종료는abort+stop→settled→HTTP→processlock의finally정리; rawerror로그제거. 운영활성화환경스위치추가없음.
- 검증: 신규서비스/경계33개, 관련100/100, 독립73/73. 최종전체972건중971통과/0실패/1skip(.inno/tmp/task3l-full.log), script구문/diff통과. skip은기존실제Windows symlink권한제한. 실제component통합에서park중HTTP200/port재점유거절/승격후AI0/해제후port재취득확인. fixture종료순서는production script실제프로세스종료증거가아니며script는구문+코드리뷰범위다.
- 메모리pause/unsafe의재시작보존은아직미완료. 다음은drain-only인증HTTP·복구화면과영속claim journal/unknownowner명시해결, legacy정리및활성화검증. 실제AI/운영DB/배포없음, CR004/005승인대기및전체goal active유지.

### 2026-10-01 SRC02/06 Task3m 확인한 파일의 명시 전달 HTTP
- POST /api/desktop/recovery/drain은 정확한 pendingHash/confirm:true만 받는다. 기존 인증·Host·Origin·version1·helper조건에 readPending/bridge.drainPending함수존재를 추가하며 desktopOutboxDrain capability를 별도로 표시한다. 구형 inspect/promote helper는 그대로 지원한다.
- helper.readPending은 bounded readPair 한 번으로 tmp부재/v1phase/해시를 확인하고 내부코드에만 parsed snapshot을 준다. bridge의 같은복구잠금 안에서 그결과를전달하므로 추가무제한 FileOutbox재독없음. callback await후 stopped를identity/network전에검사한다. HTTP는 drained:true만반환하고 성공후추가상태/파일I/O없음. pause/unsafe유지, claim/models/AI0.
- 실제파일/HTTP14개: complete/ACK-only, preview후파일교체·tmp·legacy·손상·missing, 확인·gate·인증·method/path, busy/stopped·중복drain·read중stop, 결과응답유실/ACK응답유실 후보존과재시도, payload미노출·재독0 검증. 외부편집자는공유잠금밖이므로전달중파일교체에대한완전CAS를주장하지않는다.
- RED후신규14/14; 관련103통과/1skip, 독립65통과/1skip. 최종전체986건중985통과/0실패/1skip(.inno/tmp/task3m-full.log), diff통과. skip은기존Windows실제symlink권한제한.
- 다음은 cloud초기화와독립적인로컬복구페이지·private접속링크 및영속claim journal/unknownowner복구다. 기존작업화면만으로는cloud장애시진입불가한문제를계획에기록했다. 기본protocol0, 실제AI/운영DB/배포없음. CR004/005승인대기, 전체goal active.

### 2026-10-01 SRC02/05/06 Task3n A 요청 제어 완료, 화면 통합 진행 중
- public/core/local-recovery.mjs는 http loopback origin 고정, 메모리 토큰·fragment 제거, 고정 endpoint·redirect:error·credentials:omit·no-referrer·timeout을 사용한다. 원문 오류를 노출하지 않는다.
- 안전한 상태/metadata 검증, 정확한 snapshot hash와 독립 확인, mutation/오류/refresh 후 확인 무효화, 중복 요청·dispose generation 차단을 구현했다. busy/stopped이면 status만 조회하고 inspect를 생략한다.
- 기본 RED 후21/21 및 독립21/21. 독립 리뷰에서 onChange busy 알림 중 dispose 재진입 후에도 요청 시작되는 결함을 재현했다. active guard 추가와 refresh/promote/drain3개 RED→GREEN 후 최종24/24, 독립 해당3/3 통과(.inno/tmp/task3n-controller-final.log).
- B의 recovery.html/recovery.mjs/recovery.css/private 접속링크 및 실제 브라우저 통합은 진행 중이다. 전체 suite는 A/B 통합 동결 후1회 실행할 예정이며 이번에 완료했다고 주장하지 않는다.
- 브라우저용 임시 fixture .inno/tmp/recovery-page-preview.mjs를 준비했다. 합성 데이터만 사용하는 Node 서버가127.0.0.1:54169에서 실행 중(tool session86794). 다음 작업에서 실제 프로세스 생존을 먼저 확인하고 중복 시작하지 말 것. 검증 후 탭/viewport/서버/자체 fixture를 정리할 것. 실제AI/운영DB/배포없음, 기본protocol0 유지.

### Task3n 통합 대기 중 — 재시작 hook 재검토
- 현 bridge의 검증된 readBinding 이후/claimRequest 이전 intent 영속화, verifyClaim/workspace확인 이후/execute 이전 owner 영속화가 필요하다. 각 write 실패는 원격요청 또는 runner 진입을 막고, owner write await 후에도 stopped/paused/unsafe를 다시 확인해야 한다.
- 최초 exact-wire outbox.write 성공 후 binding/owner 일치 확인이 journal 정리 후보 경계다. deliver/drain/empty outbox만으로 unknown 또는 불일치 journal을 지우지 않는다. 단일 소형 journal+tmp schema와 명시 해제 계약은 다음 구현에서 구체화한다.
- unknown poll 응답 유실은 기존 task별 예약조회만으로 자동 해제할 수 없다는 제한을 유지한다. 이번 감사는 읽기 전용이며 새 서버 attempt 프로토콜을 추가하지 않았다.

### 2026-10-01 SRC02/05/06 Task3n 로컬 복구 화면 통합
- 독립 recovery.html/mjs/css, 외부 폰트 없는 반응형 화면, 안전 metadata textContent, 명시 조회와 별도 확인, mutation 후 snapshot 초기화 및 상태 확인 버튼 focus를 구현했다. private DESKTOP-ACCESS 복구 링크는 protocol1일 때만 생성하며 실제 constant0 유지.
- 실제 브라우저에서 sourceDelegationVersion과 복구 capability를 혼동해 버튼이 비활성화되는 결함을 발견·수정했다. 복구 gate는 capability를 사용하며 snapshot이 있으면 검사 완료로 표시한다. 독립 리뷰 잔여 finding 없음; 독립 controller24/24.
- 합성 로컬 fixture에서 explicit refresh→임시 반영→snapshot/확인 초기화→refresh→저장 결과 전달→refresh 후 양쪽 파일 없음·pause 유지 확인. token fragment 제거, 결과 원문 비노출, mutation 후 refresh focus 확인. 390x844 및1280x900에서 가로 넘침 없음, 확인 label44px. 모바일은 브라우저 viewport 검증이며 실제 휴대폰 하드웨어 검증은 아니다.
- 전체1010건 중1009통과/0실패/기존Windows symlink권한1skip(.inno/tmp/task3n-full.log), renderer/script node --check 및 git diff --check 통과. 운영 AI/DB 호출 없음.
- 미리보기 프로세스27376 종료, 탭 닫기·viewport reset, 자체 fixture폴더/스크립트 정리 완료. 위 이전 기록의 session86794/포트54169는 더 이상 실행 중이 아니다.
- 다음: 영속 claim journal/unknown owner 및 legacy 결과 명시 복구 계약·구현·실제 재시작 검증 후 활성화. protocol0 유지, 배포 없음. CR004/005 승인 대기; 전체 목표 미완료.

### 2026-10-01 CR-005 승인 및 우선순위
- 사용자 “토큰 최적화 관련 초안 승인할게”를 반영해 CTX-01~06/4단계 계획을 PRD에 편입했다. CR004는 별도 승인 대기다. 현재 문맥조립 첫 단계 우선 구현; SRC 재시작 복구는 보류가 아닌 후속 잔여 작업으로 유지.
- journal 읽기전용 설계 감사: 고정8KiB intent/owner+tmp, 기존 file-outbox atomic writer 재사용, read는 bounded 검증 필요. null poll만 intent정리; 검증된 saved pending/ACK와 binding/task/execution/generation이 맞는 owner만 결과전송·ACK·outbox삭제 전에 정리. unknown/mismatch자동해제 금지. 아직 제품코드 변경 없음.

### 2026-10-01 CR-005 Stage1 공통 문맥 조립·실행 경로 연결
- public/core/task-context.mjs는 최초 await 전 task/version/messages/role/content를 스냅샷하고 원요청·전체이력·checkpoint를 길이로 자르지 않는다. 선두 원요청 echo만 제외하고 이후 동일지시의 순서를 유지한다. 같은 role의 반복본문만 더 짧은 명시 참조로 대체한다.
- 순서·원본id/index·SHA256·task/version/mode manifest와 바이트metrics는 sidecar로 두고 모델본문에 반복 출력하지 않는다. SHA 계산은 packet내 동일본문만 재사용하며 전역/영속캐시 없다. 미관측 input/output/cached tokens는 null이다.
- Codex/로컬Claude/WorkerClaude 3경로가 같은 async 조립기를 사용한다. 요청+대화+checkpoint 96000UTF8byte 예산 초과면 원문보존+completefalse이며 branded ContextRetrievalRequiredError로 AI spawn/fire 전에 중단한다. 모델·자료·임대·callback 지침 보존. 첨부/모델지침을 포함한 전체prompt 예산, Stage2선택조회 및 관측 UI는 아직 미완료.
- 오류는 문맥 추가 조회 필요로 기록하고 자동재시도하지 않는다. Worker는 실제 내부 클래스인 경우만 원격 미실행으로 확정한다. 같은 code를 가진 외부오류는 기존 uncertain_fire 보존.
- 의미 RED→GREEN: packet7/7, adapter34/34(author), failures+dispatch18/18(author), 독립 packet/runner/dispatch/failures33/33. 전체 최초1026중1024pass/1fail/1skip에서 기존 deadline test의 setImmediate 1회 준비 가정이 비동기SHA 준비와 충돌했다. 실제 spawn 신호 대기로 수정 후 전체1026중1025pass/0fail/기존Windows symlink1skip(.inno/tmp/ctx-stage1-final.log). 이후 독립리뷰가 지적한 동일 abort테스트 경쟁도 같은 방식으로 수정하고 관련11/11 재검증. 마지막 변경은 테스트만이며 제품코드 변화 없음.
- Wrangler 기존캐시 dry-run 성공(실제배포아님), 구문/diff검증통과. 합성중복 fixture의 packet범위7726→3992byte(3734감소); 실제토큰/캐시/일반사용절감률 주장이 아니다. 짧은 메시지에서는 표시비용 때문에 savedBytes 음수도 보존한다.
- 다음 Stage2에서 예산초과를 안전한 선택조회/명시상태로 해소해야 장기작업을 자연스럽게 이어가는 사용자요구 충족. 현재는 누락실행 차단 단계이며 전체 CR005 완료 아님. 실제AI/운영DB/배포 없음. journal/unknownowner/legacy복구 및 CR004 미완료 범위 유지.

### 2026-10-01 CR-005 Stage2A 원문 구간 조회 및 MCP 권한 연결
- readTaskContext는 request/checkpoint/선택 message의 UTF8 최대16000byte 조각 또는20개 manifest참조만 반환한다. taskId/version 선검증, text이어읽기 digest필수, 전체원문SHA256/offset/nextOffset/done, 첫await전snapshot을 적용했다. attachment/artifact/fulltask를 반환하지 않는다. UTF8코드포인트 경계·BOM 보존이며 grapheme단위 페이지 보장은 아니다.
- read_task_context MCP는 기존 handlers.readTask/scopedRead와 readable set을 그대로 사용한다. 부모·형제·다른작업·supersededowner거절, reviewchild의batch/완료상태/기존checkpointfilter 유지. 추가권한·새DB·의존성없음.
- 버전 충돌은 권한확인후 정확한 helper conflict만 currentVersion정수 metadata로 반환한다. 버전모를때0 manifest조회로현재버전을얻고다시조회할수있어 read_task전체원문재전송불필요. scope/digest오류를version오류로오인하지않음.
- 검증: helper7/7, author통합32/32, 독립13/13. 최종전체1039중1038통과/0실패/기존Windows symlink1skip(.inno/tmp/ctx-stage2a-full.log). Wrangler기존캐시dry-run과diff통과. 실제AI/운영DB/배포없음.
- 다음 Stage2B: checkpoint.resumeState 후보는 현재목표/제약/승인/완료/미완료/근거와원문id/index/digest coverage를가지고현재상태한개를교체한다. 실제원문digest로검증하며claim/renew가taskversion을바꾸는것과문맥변경을구분해야한다. 출처일치는의미보존증명이아니며모델이승인사실을만들면안된다.
- 실제managed Codex는remote MCP를금지하고있어현재새MCPtool만으로큰문맥을읽을수없다. 실행범위로제한한로컬파일또는읽기전용연결이필요하다. Claude는callback helper안내/검증을연결해야한다. 유효resumeState가없는최초oversize도조회bootstrap 또는명시분할을설계·검증해야한다. 그전Stage1차단유지, CR005전체미완료.

### 2026-10-01 CR-005 Stage2B1 현재 재개 상태의 저장·출처 검증
- context-resume.mjs의 strict 상태는32KiB/48항목/항목당8refs 한도, goal/constraint/decision/completed/pending/evidence와 원요청·원본message참조만 허용한다. checkpoint를다시요약한참조는없다. basis는request/prefixhistory/scope hashes로 task.version/lease변화와 원문변화를구분한다. firstawait전에snapshot고정.
- verify는missing/invalid/stale/source_matched를반환한다. decision은user/request근거만허용하며source_matched는의미상완전성·사용자승인·품질증명이아니다. 첨부는선별metadata/view만scope에포함하고원문저장없음. pending목록은최대20+전체개수+다음인덱스만반환, 원문상태불명이면개수null.
- running checkpoint에optional resumeState를기존owner/CAS/단일taskJSON교체로저장한다. 입력shape만저장전에검증하고실제provenance는조회시검증한다. omitted보존/null필드삭제/새상태교체, taskId다르면거절. MCP새상태저장응답은id/status/version/savedflag만반환하여전체history재전송방지. completed checkpoint의resumeState는finishpath미연결이라부작용전에명시거절.
- read_task_context basis/resume선택자를기존scope/version검증아래추가. basis만 optionalmessageCount를받고irrelevantslice인자는거절한다. resume는검증상태와bounded미처리정보를준다. 기존parent/review권한확대없음.
- 검증: core7/7, author통합27/27, 독립25/25. 최종전체1051중1050pass/0fail/기존Windows symlink1skip(.inno/tmp/ctx-stage2b1-full.log). 기존Wranglerdry-run 및diff검증통과. 실제AI/운영DB/배포없음.
- 다음: 일반runner결과와finishExecution/receipt/outbox에상태전달, managedCodex의실행범위로컬원문조회와Claudecallback안내/실제지원경로검증, 유효상태+미처리원문을이용한문맥선택. 최초oversize와불완전·stale상태도안전하게처리해야한다. 현재prompt는역사를생략하지않으며CR005전체완료아님. SRCjournal/legacy/unknownowner및CR004잔여유지.

### 2026-10-01 CR-005 Stage2B2 일반 결과 전달·완료 저장 연결
- Codex structured output의optional resumeState 객체/null/생략을검증·구분하여runner→실제FileOutbox pending.input→완료요청으로그대로전달한다. task/executionbinding검사, 무효상태를plaintext로조용히버리지않음. receipt스키마/기본0gate변경없으며payload해시에상태포함.
- local/D1 finishExecution은상태preserve/replace/delete를기존owner/CAS/result/artifact/usage/receipt 원자저장과함께반영한다. 완료assistant메시지는기존basis가처리했다고조작하지않고미처리로남긴다. MCP완료상태저장지원·최소ack, 완료후동일state재호출만허용하며변경은거절. v0desktopreplay도동일규칙적용.
- 미지원handoff/delegation/nonpassreview 및retry/waiting_user재전송에state를동반하면sideeffect전거절한다. 독립리뷰P1(allpass로꾸민noncompletionreplay가state를버리고success)과P2(nonpassreview검사가artifact처리뒤)는guard/검증순서와회귀로해결.
- 검증: producer65/65(신규7), store/HTTP52/52(신규17), 독립29/29. 합성CLI·실제파일을사용한응답유실후브리지재생성재전송에서state/null/omitted보존·runner재실행0 확인. 이신규시험은별도OS프로세스강제종료시험이아니다. actualHTTP/receipt변경409/CAS실패부분반영없음도검증.
- 최종전체1075중1074pass/0fail/기존Windows symlink1skip(.inno/tmp/ctx-stage2b2-full.log), 기존Wranglerdry-run/diff통과. 실제AI/운영DB/배포없음.
- 다음 실제managedCodex의실행범위로컬원문조회, Claude callback안내, normal결과와함께재개상태생성, 검증된상태+미처리원문선택및최초oversizebootstrap을연결한다. 현재자동문맥압축·기록생성·history생략은아직없음. 기존SRCjournal/legacy/unknownowner와CR004별도잔여유지.

### 2026-10-01 CR-005 Stage2C 실제 제공자 문맥 조회 연결
- Claude repository callback의 read_task_context 허용 누락을 수정했다. 실제 helper -> scoped Worker -> 버전충돌복구 -> manifest/원문/basis -> 일반완료 resumeState 저장을 합성 transport로 검증했다. prompt는 exact task/version, stdin호출, 0-based index와 UTF-8 paging, 출처/일반완료 상태생성 규칙을 안내한다. capability는 envelope/stdin에만 전달하며 state/산출물에 넣지 않는다.
- managed Codex는 기존 desktop HTTP server의 별도 읽기 전용 경로와 실행별 capability를 사용한다. 메모리 snapshot만 유지하며 첨부원문/산출물/임시 대화파일은 만들지 않는다. fixed Node helper를 실제 subprocess로 실행하여 runner환경 -> HTTP -> basis -> 정상 resumeState 반환을 검증했다. 관리 API 및 다른 작업 조회 거절, abort/최외곽 finally와 늦은 응답 폐기, 상속 INNO_CONTEXT_* 제거를 적용했다.
- local 제한: active/inflight 각1, snapshot4MiB/request4KiB/response128KiB/누적32MiB/조회1024회/helper전체10초. 초과시명시오류, 원문절단없음. main 통합검토에서 snapshot생성을 prompt예산검사 뒤로 이동하여 97KB/4.2MiB 이력도 기존 CONTEXT_RETRIEVAL_REQUIRED·open0·spawn0 유지.
- 검증: cloud36/36/독립16/16, local최종8/8. 전체1086중1085통과/실패0/기존 Windows symlink1skip(.inno/tmp/ctx-stage2c-full.log). 기존 Wrangler dry-run 통과(64assets). 실제 AI호출/운영DB수정/배포없음; receipt 기본0 유지.
- 다음: deployed Codex sandbox/Claude Routine 실제지원경로 검증, 유효 재개상태+필수 원문+미처리 변경을 이용한 문맥선택과 최초oversize처리, 전체prompt예산/관측사용량. 현재 자동history생략/압축의종단완료나실측토큰절감을주장하지않는다. SRCjournal/legacy/unknownowner와CR004별도잔여유지.
- Stage2C 최종 독립 로컬리뷰58/58통과, 수정요청없음. 관리인증격리/원문조회/폐기/상한/사전차단을 검증했다.

### 2026-10-01 CR-005 Stage2D1 선택적 문맥 전달 완료 / Claude 인수인계 준비
- source_matched+동일mode+직접참조+coveredprefix 조건의 과거 assistant만 선택적으로 대체한다. 전체 request/user/system/checkpoint/모든pending과 사용자 직전 제안을 유지하며 중복참조는 남은원문을가리키도록 재구성한다. state/안내/조회표식 포함 실제UTF8가 더작고96KB안일때만 selected_ready이며 complete=false로원문누락을명시한다.
- 실제reader가설정된managedCodex 및capabilityWorkerClaude만 optin. 첫offset0조회부터표식expectedDigest를검증하며내용/버전변경시선택갱신전판단중단. reader없음/eval/standalone/stale등은전문fallback. 필수원문초과는유효state라도open0/spawn0/fire0로차단한다.
- 검증: core14/14(기존사례포함), adapter최종5/5, 독립19/19. 전체1098중1097pass/0fail/기존host symlink1skip(.inno/tmp/ctx-stage2d1-full.log). Wranglerdry-run64assets통과. 실제AI/운영DB수정/배포없음.
- 사용자가 이번작업까지만 마무리하고 Claude Opus5.5에서 전체검토/후속작업할상세handoff를요청했다. 이후제품구현은중단하고 HANDOFF-CLAUDE.md 작성·검증·개발브랜치공유만수행한다. 남은범위는handoff와현재상태참조.

### 2026-10-01 Claude handoff 문서 정리
- docs/HANDOFF-CLAUDE.md에 코드/운영/승인/잔여 H1~H10/완료증거/재개명령/비밀정보 경계/Claude 시작문구를 통합했다. 독립 문서 검토를 거쳐 materials20개와첨부metadata5000개 상한 구분을 정정했다. REQUIREMENTS-STATUS의 오래된CR005승인대기/Task3e및작업순서도현재상태로갱신했다.
- git ls-remote로 main c925a00a3b69f74877bc9d1689dbe99e4dd1d390, Wrangler deployments list로 latest e2a00c32-93a7-4a98-a36b-8eeb0eb38445를읽기전용확인했다. 운영작업/pending/포트/계정잔여량은미조회로명시했다.
- 제품코드 f4a38ab 이후추가제품수정없음. 인계문서와검증된개발브랜치만GitHub공유하고 main/Worker/Pages배포는진행하지않는다. 사용자요청에따라Codex목표는인계완료후일시중지한다.

### 2026-10-01 Claude 독립 총괄 검토 (코드 변경 없음)
- 재검증: 전체 Node 1098건 중 1097pass/0fail/기존 Windows symlink 1skip(.inno/tmp/claude-review-full.log), git diff --check 통과, 기존 캐시 Wrangler 4.135.0 dry-run exit0(handoff의 4.131.1 표기와 다름). git ls-remote main c925a00 불변, 원격 codex/source-release=c3c32c2=로컬 HEAD. receipt gate는 client(scripts/desktop-bridge.mjs:21)·Worker 기본값 모두 0, wrangler 변수 없음. Cloudflare 배포 목록·실행 중 브리지·pending outbox·Pages 자산은 이번에 미조회.
- 운영+개발 공통 P1: (1) lease 만료 후 같은 owner의 fail 기록 경로 없음(worker/store.mjs failExecution vs finishExecution recoverInterrupted) → 409 → 서비스 루프 종료·재시작마다 반복. (2) renew 1회 일시 오류도 실행 abort·결과 폐기(server/desktop-bridge.mjs execute timer). (3) 임시파일 생성 전 outbox 기록 실패가 retryable로 분류되어 결과 유실 후 즉시 다음 claim.
- 개발 전용 릴리스 차단 P1: (4) Worker Claude 선택 전달은 live task를 조회하는데 renew/checkpoint가 version을 올려 안내상 정상 실행 중 원문 조회가 중단됨(worker/store.mjs:505, task-context.mjs:93, task-context-read.mjs:24-27). (5) 96KB 초과 차단 시 사용자 해결 수단 없음(H1).
- P2: 전체 prompt 예산·지표 저장 없음(H2), v0 .tmp 잔존 시 UI 없는 반복 정지·main보다 덜 구체적인 안내, 4MiB snapshot 오류가 문맥 오류로 분류되지 않음, claim 응답 중 종료 시 lease 만료까지 고아 claim. P3: 첫 조회 digest는 안내만, usage source 표기, D1 충돌 오류 유형, 로컬 reservation proxy gate, 문서 불일치(PARALLEL-MASTER/EXECUTION-USAGE/PRD 1절).
- 확인된 성립: 선택 불변식 대부분(첫 조회 digest만 부분), v0/v1 경계 격리, 평가 예산0 거절·claim 원자성, 수동 고정의 가용성 우회 불가. 모델: 모든 경로 serving version null이며 model_policy_availability 운영 writer 없음 → 자동 승격 구조적 불가(CR004 결정 대기와 별개로 기록).
- 작업 순서: WU1 renew 일시 오류·outbox 기록 실패 → WU2 만료 후 fail 기록 → WU3 Claude 선택 조회 digest 결합 → WU4 v0 tmp/4MiB 분류 → WU5 H1 bootstrap 설계·구현 → WU6 H2 → WU7 문서. 이후 H4 journal 등, H3 실제 구독(실행 전 확인), H10 릴리스.

### 2026-10-01 WU1 renew 일시 오류 허용·v0 결과 저장 실패 차단 (운영 반영 전)
- 원인: 데스크톱 claim/renew lease는 120초(heartbeat 15초)인데, renew가 한 번만 실패해도(일시 네트워크 오류 포함) Codex 실행을 중단하고 결과를 버렸다. v0에서는 임시파일 생성 전 outbox 기록 실패가 retryable로 분류되어 결과가 유실되고 즉시 다음 작업을 claim했다. 둘 다 main(c925a00)에도 있다.
- 변경: server/desktop-bridge.mjs — retryableStatus(undefined/408/429/5xx) renew 오류는 무시하고, claim 요청 전송 시각 또는 마지막 성공 renew의 전송 시각부터 (경과+heartbeat)>=lease이면 DESKTOP_LEASE_UNCONFIRMED로 중단·미업로드한다. 확정 거절(4xx)은 즉시 중단(기존 유지), 중단 뒤에는 renew를 더 보내지 않는다. 클라이언트 기한은 서버 lease(서버 now+120초)보다 늦지 않다. v0 outbox 기록 실패 시 메모리 결과를 send로 1회 전달 시도 후 OUTBOX_WRITE_FAILED(409, delivered 표시) latch로 tick/startTask/maintenance를 막고 서비스가 종료된다. 레코드 생성 오류는 기존 동작 유지(디스크 안내로 오인하지 않음). v1 경로는 동일(deliveryUnsafe). lease 값은 public/core/tasks.mjs DESKTOP_EXECUTION_LEASE_MS로 Worker(worker/bridge.mjs claim/renew)와 공유한다. 스크립트 onError는 이 경우 실제 원인 메시지를 출력한다.
- 기존 테스트 변경: desktop-delivery-protocol의 renew 실패 시험은 일시 오류=소유권 상실이라는 이전 가정을 사용했으므로 확정 409로 바꾸고, v1 lease 미확인 변형을 추가했다(시험 목적 유지).
- 검증: 신규 tests/desktop-renewal.test.mjs 15건(RED 확인 후 GREEN), 독립 검증(inno-opus) A1~A4 PASS·P0~P2 없음, P3 지적 중 중단 후 renew 지속·레코드 생성 오류 latch를 수정. 전체 1114건 중 1113pass/0fail/기존 symlink 1skip, git diff --check, Wrangler dry-run(357.01KiB) 통과. 실제 OS 네트워크 단절·실구독 실행은 미실행. renew 자체의 CAS 충돌 409는 WU2에서 처리.

### 2026-10-01 WU2 데스크톱 fail·renew의 complete 정합 (운영 반영 전)
- 원인: CloudBridge.complete는 같은 owner의 자동 lease 만료 일시정지 복구(recoverInterrupted)와 CAS 충돌 3회 재시도를 갖지만 fail에는 둘 다 없었다. 그래서 만료 뒤 도착한 실패 결과나 동시 쓰기와 겹친 실패 결과가 409가 되고 v0 브리지 서비스가 종료·재시작마다 반복 정지했다. renew도 동시 쓰기 CAS 충돌을 확정 거절로 반환해 실행을 중단시켰다(main 동일).
- 변경: worker/store.mjs leaseInterruptedOwner(자동 lease_expiry 일시정지가 최신 변경이고 같은 executionId/generation)를 finishExecution과 공유하고 failExecution에 recoverInterrupted 옵션 추가. worker/bridge.mjs concurrentRetry는 읽은 version보다 새 version을 보고하는 ConflictError(동시 쓰기)만 최대 3회 재시도한다. owner/lease/receipt 충돌은 읽은 version을 보고하므로 즉시 확정. fail은 각 시도에서 기존 idempotent replay 검사를 유지한다. 수동 pause, 일시정지 이후 다른 변경, 다른 owner는 계속 거절한다. 다른 failExecution 호출자(dispatch/orchestration/local store)는 기본 false.
- 의도된 동작 변화: lease 만료로 일시정지된 위임 자식이 실제 실패를 보고하면 이제 failed가 되어 재시도 경로(제한 1회)를 따른다. 만료 전 실패와 같은 결과이며, 이전에는 데스크톱이 영구 정지했다. v1 receipt의 acceptedTransition(lease 만료 일시정지 허용)과 store가 이제 일치한다.
- 검증: 신규 tests/desktop-fail-recovery.test.mjs 7건(RED 3건 확인 후 GREEN). 독립 검증(inno-opus) B1~B4 PASS, B5는 위 P3 동작 변화. 전체 1121건 중 1120pass/0fail/기존 symlink 1skip, git diff --check, Wrangler dry-run(357.59KiB) 통과. 실제 D1·운영 배포 없음.

### 2026-10-01 WU3 Claude 선택 전달의 version-only 충돌 연속성 (운영 반영 전)
- 원인: Worker Claude는 live task를 조회하고, fire 기록·renew_execution·checkpoint 쓰기가 task.version을 올린다. 기존 안내는 version 변경만으로 선택을 무효화/중단하도록 했으므로, 선택된 Claude 실행은 첫 생략 원문 조회(dispatch version은 이미 충돌)에서 선택 이점을 잃었다.
- 변경(안내 계약만): public/core/task-context.mjs 선택 안내, worker/index.mjs reader 안내, server/runners.mjs 로컬 안내. version 충돌 시 같은 section/messageIndex를 currentVersion과 목록의 expectedDigest로 다시 조회하고, contentDigest가 목록 SHA-256과 같을 때만 사용한다. digest 불일치·원문 없음은 계속 선택 무효/원문 재조회. manifest 페이지는 version 혼합 금지, text 페이지는 모든 페이지 contentDigest가 같을 때만 결합. reader 코드는 변경 없음(전체 원문 SHA-256이 expectedDigest와 같을 때만 반환, 이어읽기 digest 필수).
- 검증: 신규 tests/selection-version-continuity.test.mjs 3건 + adapter 1건(RED 확인 후 GREEN). 독립 검증(inno-opus) C1 안전성·C2 version 비의존 PASS, C4 지적(로컬 안내·'task changes' 문구 모순)을 수정. 전체 1125건 중 1124pass/0fail/기존 symlink 1skip, Wrangler dry-run(358.17KiB) 통과. 설계 문서 CONTEXT-EFFICIENCY-IMPLEMENTATION.md에 계약 추가. 실제 구독 모델이 이 안내를 따르는지는 미검증(H3).

### 2026-10-01 WU4 snapshot 불가 시 전문 대체·v0 정지 안내 (운영 반영 전)
- 4MiB 등 로컬 snapshot을 만들 수 없는 task는 이전에는 문맥이 완전해도 일반 413으로 spawn 전에 실패했다. 이제 server/context-access.mjs가 snapshot 생성 실패(크기 초과·표현 불가 데이터)에 CONTEXT_SNAPSHOT_UNAVAILABLE을 붙이고, server/runners.mjs는 이 경우에만 reader 안내·INNO_CONTEXT_* 없이 전문으로 다시 조립한다. 전문이 예산을 넘으면 기존처럼 CONTEXT_RETRIEVAL_REQUIRED로 spawn 0. 접근 종료(401)·중복 활성(409) 등 다른 open 오류는 기존대로 실패. Stage2C의 과대 문맥 open0 순서 유지. 대체 발생을 별도로 기록하지는 않음(H2 관측 범위).
- v0 정지 안내: server/bridge-runtime.mjs deliveryStopMessage. main의 409 안내('Execution changed. Review .inno/desktop-pending.json before resuming.')를 복원하고, .tmp 잔존(OUTBOX_RECOVERY_REQUIRED)은 두 파일을 보존·검토하라고 안내(v1은 로컬 복구 페이지 안내), 그 외 오류는 원인 메시지(200자 이내)를 포함하며 결과가 저장되었다고 단정하지 않는다. 삭제를 권하지 않는다.
- 검증: 신규 adapter 2건·tests/desktop-stop-message.test.mjs 5건(RED 확인 후 GREEN). 독립 검증(inno-opus) D1~D5 PASS, P3 문구·진단 메시지 지적 반영. 전체 1132건 중 1131pass/0fail/기존 symlink 1skip, git diff --check, Wrangler dry-run(358.17KiB) 통과. 실제 데스크톱 브리지 프로세스 실행·실구독 실행은 미실행.

### 2026-10-01 WU5 상한 내 전문 전달 (사용자 결정, 운영 반영 전)
- 사용자 결정(2026-10-01, Claude 세션 질문 응답): 필수 문맥이 96KB 소프트 예산을 넘어도 고정 상한 안이면 잘라내지 않은 전문을 전달하고 예산 초과로 기록·표시, 상한 초과만 차단. coverage 추적 bootstrap은 필수 원문을 결국 모두 읽어야 하므로 토큰 절감이 없고 범위가 커서 채택하지 않음.
- 변경: public/core/task-context.mjs FULL_CONTEXT_HARD_MAX_BYTES=384000(UTF-8 바이트), hardMaxBytes 옵션. readiness full_over_budget(complete=true, 생략 없음, retrievalRequired=false), manifest.budget에 hardMaxBytes·blocked 추가(exceeded는 소프트 예산 초과 의미 유지). 선택 규칙은 그대로(전문보다 작고 96KB 이하). 상한 초과만 blocked→기존 CONTEXT_RETRIEVAL_REQUIRED(spawn/fire 0, 로컬 open 0). 실패 안내는 '작업 이력 전달 상한 초과 / 384KB / 잘라 보내지 않음 / 새 작업으로 분할'로 변경(실행 불가능한 '문맥 조회 또는 분할' 안내 제거).
- 기존 테스트 변경: 96~100KB 입력으로 차단을 확인하던 시험 10건을 상한 초과 입력(400KB, Worker 요청 길이 제한 200000자 때문에 한 곳은 한글 15만 자≈450KB)으로 옮기고, 소프트 예산만 넘는 경우의 전문·완전 전달을 새로 단언했다. 신규 tests/task-context-hard-cap.test.mjs 6건, 두 어댑터 양성 시험 1건.
- 검증: 전체 1139건 중 1138pass/0fail/기존 symlink 1skip, git diff --check, Wrangler dry-run(358.76KiB) 통과. 독립 검증 결과는 아래 줄에 추가. 예산 초과 사실은 manifest에만 있고 아직 저장·화면 표시는 없음(WU6). Claude Routine이 384KB급 fire 본문을 수용하는지는 실구독 미검증(H3).
- WU5 독립 검증(inno-opus): E1~E5 PASS, 코드 결함 없음. 지적 반영: HANDOFF H1·CONTEXT-EFFICIENCY-IMPLEMENTATION 문서 갱신. 남은 P2(추정): 첨부 발췌 최대 600000바이트·안내 포함 전체 전송 크기 검사 없음, 200000자 한글 요청은 생성은 되지만 매 실행 차단(생성 시 경고 없음) → WU6에서 처리.

### 2026-10-03 WU6 (H2) 문맥 전달 관측 저장·화면 (운영 반영 전)
- 신규 public/core/context-delivery.mjs: 실행별 문맥 전달 결과(readiness full_ready/full_over_budget/selected_ready/blocked, contextBytes·originalBytes·selectionSavedBytes·omittedMessages·maxBytes·hardMaxBytes·reader, 전체 promptBytes·materialBytes; 단위 utf8_bytes; inputTokens/cachedTokens는 항상 null). 엄격한 검증기와 한국어 표시 문구(토큰 절감 주장 없음).
- 연결: Codex runner 결과와 차단/실행 오류에 요약 첨부 → 데스크톱 브리지·local http가 검증된 요약만 complete/fail 입력에 싣고(잘못된 요약은 버리고 결과는 유지) → Worker/local store가 소유 provider와 일치할 때만 checkpoint.contextDelivery에 저장, 새 claim에서 초기화. Claude는 Worker routineText가 요약을 만들고 fire 성공 시 leaveExecutionRunning, 상한 초과 차단 시 failExecution에 저장(이후 MCP 완료는 기존 checkpoint 유지). 화면은 작업 상세의 재개 지점 카드에 한 줄(textContent).
- 독립 검증(inno-opus): 모델/MCP·비인증 클라이언트의 관측값 위조 경로 없음(F1), 재전송 중복 없음(F3), 화면 안전(F5) PASS. F2 지적(store의 provider 불일치 예외가 실제 결과를 잃게 할 수 있음)은 store도 잘못된·불일치 관측값을 버리고 결과는 저장하도록 수정. receipt v1 해시는 원본 입력 그대로 사용(gate 0, 별도 실검증 없음).
- 검증: 신규 tests/context-delivery.test.mjs 4, context-delivery-store 12, context-delivery-bridge 3, context-delivery-claude 2, adapter 1, server 3건(RED 확인 후 GREEN). 전체 1164건 중 1163pass/0fail/기존 symlink 1skip, git diff --check, Wrangler dry-run(자산 65개, 363.04KiB) 통과. 실제 브라우저 화면·실구독 실행은 미검증.
- 남김: 요청 하나만으로 384KB를 넘는 작업의 생성 시점 경고는 구현하지 않았다(실행 시 상한 초과 안내로 표시됨). local Claude Routine 실행기(createClaudeRoutineRunner) 성공 경로는 요약을 저장하지 않는다(클라우드 Worker 경로는 저장).

### 2026-10-03 CR-006·CR-007 승인, CR-004 A 결정, WU7 문서 현행화
- 사용자 승인: CR-006 제공자 확장·CR-007 플러그인 관리(docs/PROVIDER-PLUGIN-PROPOSAL.md, PRD 11절), CR-004는 A안(실행 경로 단위 동일 조건 비교, serving version null 유지). 진행 순서: WU7 → 검증된 변경 릴리스(실구독 최소 시험은 실행 전 확인) → CR-006/007·CR-004A. 추가 AI 비교 평가 기본 예산 0 유지.
- WU7(문서만, 코드 대조 후 작성): EXECUTION-USAGE.md를 실제 동작(작업당 usageHistory 100건, 단계·전환·캐시 입력, 화면 최근 50건, Claude는 완료 호출에 넣은 경우만 저장·독립 검증 아님, 문맥 전달 기록)으로 재작성. PARALLEL-MASTER.md의 '원문 첨부 작업 제외' 서술을 원본 협업 버전 1 기준(sourceIds 지정, 일시 조회·비저장, 재연결 대기, URL은 원문 아님)으로 갱신하고 후속 범위에 CR-006 추가. PRD 1절 기준 커밋은 작성 당시 기준임을 명시. HANDOFF에 실제 Wrangler 4.135.0 캐시 경로와 Node 경로 기록. REQUIREMENTS-STATUS 현재 상태 갱신.
- 검증: git diff --check 통과(문서만 변경, 테스트 영향 없음).

### 2026-10-03 릴리스: main·Worker·Pages·데스크톱 반영 및 실구독 최소 시험 통과
- 사전 점검: main c925a00 위 fast-forward(30커밋), D1 테이블 정의 동일(마이그레이션 없음), 운영 클라우드 실행·대기 작업 0, 데스크톱 연결기 미실행·미전송 outbox 없음. 자산 버전 context-delivery-20261003으로 갱신(6125c11).
- 반영: GitHub main=codex/source-release=6125c11. Cloudflare Worker ebc60186-5c94-44e0-b876-df17e97790f9 배포(이전 e2a00c32가 롤백 기준; 이후 Routine 비밀값 갱신으로 새 버전 생성). 배포 후 미인증 /api/state 401, 인증 상태 정상(sourceDelegationVersion 1, desktopDeliveryRecovery false, claudeRoutine true), 새 자산·context-delivery.mjs 제공 확인. GitHub Pages 워크플로 37094878406 success, 공개 Pages에서 새 자산 버전 확인. 메인 체크아웃 E:\Develop\INNO Workspace를 6125c11로 fast-forward(receipt gate 0 유지). Cloudflare 인증은 사용자가 wrangler login으로 수행.
- 발견: 사용자가 데스크톱 앱 Routines 정리 중 INNO용 클라우드 Claude Routine을 삭제해 첫 Claude 시험이 인증 실패(waiting_connection, Claude 미실행)했다. fire 코드·beta 헤더는 이전 운영과 같고 공식 문서와 일치. Claude Code RemoteTrigger로 Routine을 재생성했다: trig_01JqQA1ENd9B2yKpeZVLvx3J, 모델 claude-opus-5-5(사용자 선택), 환경 INNO Workspace(env_01ACAnphaEZ3BodPyeRPTp5p), 저장소 INNO-KAIST/INNO-Workspace, 지침 docs/ROUTINE.md 전문, 도구 Bash/Read/Write/Edit/Glob/Grep/Agent/WebSearch/WebFetch, 자동 부착된 계정 커넥터(Slack·Drive 등) 해제, 일정은 API 전용을 위해 2월 29일 placeholder. API 트리거·토큰은 사용자가 웹에서 발급하고 wrangler secret put으로 CLAUDE_ROUTINE_URL/TOKEN 교체(값은 Claude가 보지 않음).
- 실구독 최소 시험(합성 작업): Claude 2c6261f9… completed(약 23초), 답변 정확 일치, artifact 2, contextDelivery claude/full_ready/186B/prompt 13212B, 사용량 미보고. Codex 5316a8ad… completed(약 23초), 답변 정확 일치, contextDelivery codex/full_ready/184B/prompt 10521B, 사용량 입력 19445(캐시 12416)·출력 23, outbox 정리. 장문·선택 전달·원문 재조회·384KB 전문 경로의 실구독 검증은 아직 없음.
- 남은 소규모 결함: Claude fire가 인증 등 확정 실패로 끝나면 계산된 contextDelivery가 저장되지 않음(차단 경우만 저장). 사용자 요구 추가: Routine 마스터 모델도 근거에 따라 자동 최신화(CR-006 PRV-05에 포함; INNO 서비스는 Routine 설정 권한이 없으므로 근거 기반 추천 → 승인 시 Claude Code 세션이 갱신).
- 다음: CR-006 S1 제공자 레지스트리 추상화 설계·구현 → CR-007 S3 → CR-004A → H4.

### 2026-10-03 CR-006 S1 착수: 설계·계획 문서, WU0 Claude fire 확정 실패의 문맥 전달 기록 (운영 반영 전)
- 설계·계획: docs/superpowers/plans/2026-10-03-provider-registry.md(코드 조사 결과, manifest·레지스트리·어댑터 계약, 리터럴 경계 시험, 적합성 스위트·배정 게이트, WU0~WU7). 저장 구조는 provider를 JSON 본문·usage PK 문자열로만 두므로 스키마 마이그레이션 불필요로 판단(WU2에서 호환성 시험으로 고정).
- WU0: worker/index.mjs fireRoutine이 Routine HTTP 확정 거절(401/403 인증, 429 한도) 시 보낸 본문의 contextDelivery를 오류에 실어 failExecution이 저장한다. 불확실(5xx·fetch 예외·잘못된 성공 응답)은 기존대로 확인 대기, 기록 없음, 재fire 없음. docs/EXECUTION-USAGE.md에 "보낸 문맥" 의미 명시.
- 시험(RED 확인 후 GREEN): tests/context-delivery-claude.test.mjs 4건 추가(401·403, 429, 503 fire 1회, fetch 예외·잘못된 응답). 전체 1175건 중 1174pass/0fail/기존 symlink 1skip(WU1 7건 포함), git diff --check 통과, Wrangler dry-run(자산 65개, 363.09KiB) 통과.
- 독립 검증(inno-opus): E1~E4 PASS, P0/P1 없음. P2 시험 공백(403, fetch 예외, fire 횟수)과 문서 표현 지적을 반영. 남은 한계: 오케스트레이션(자식·검토) 경로의 401/429는 같은 fireRoutine을 쓰는 코드 확인만 있고 별도 시험은 없다. local Claude Routine 실행기는 여전히 문맥 전달 기록을 만들지 않는다(기존 한계).

### 2026-10-03 CR-006 S1 WU1 제공자 manifest·레지스트리 모듈 (운영 반영 전)
- 신규 public/core/providers.mjs(브라우저·서버·Worker 공용 순수 모듈, tasks.mjs만 의존): codex·claude 선언형 manifest v1(auth 구독 종류·paidApi false, execution location/transport, capabilities fileArtifacts·resultCallback·cancellation·usageReport·deliveryReceipts·executionEvidence·evaluationBudget, models 카탈로그 종류, ui 선택지·사용량 URL·가용 플래그)와 검증기·레지스트리(createProviderRegistry, PROVIDER_IDS, isProviderId, assertProviderId, providerManifest/Label/Transport/Capability, providersByTransport). 미등록 오류 문구는 기존과 같은 'provider must be codex or claude'.
- PRV-02/03 강제: 구독 외 인증·paidApi≠false 거부, 인증 종류·capability를 transport가 실제 구현하는 값으로 제한(예: routine_fire는 receipts 0·실행 근거 null·평가 예산 false·확인 필요 중단), 등록은 복제본을 검증해 accessor로 검증과 저장 값을 다르게 할 수 없음, 깊은 동결.
- 시험: tests/providers.test.mjs 8건(RED 확인 후 GREEN). 독립 검증(inno-opus): E1·E4·E5 PASS, P0/P1 없음. P2 반영: 검증 후 복제(TOCTOU)→복제 후 검증, usageUrl 형식, transport별 인증·평가 예산·사용량 보고 제한, 중복 가용 플래그·공백 표시명 거부, Symbol capability 이름, 역할 모델은 CLAUDE_ROLE_MODELS와 대조, 미검증 분기 시험 추가. 지적 사항 기록: Codex의 검토 단계 일시정지 확인은 위임 상태에 따른 것이므로 WU3·WU6에서 capability와 별도로 유지한다.
- 검증: 전체 1182건 중 1181pass/0fail/기존 symlink 1skip, git diff --check, Wrangler dry-run(자산 66개, 370.57KiB) 통과.

### 2026-10-03 CR-006 S1 WU2 저장소·식별자 검증 경계 이전 + 저장 호환성 (운영 반영 전)
- 식별자 검증·열거를 레지스트리로 이전: context-delivery(기록 provider), execution-usage(사용량 기록 필터·요약 반복), delegation(validateAssignments), model-selection(route), provider-handoff(인계 대상), server/mcp(위임·인계·claim_execution 스키마 enum 3곳은 PROVIDER_IDS), server/store·worker/store claimExecution, server/http·worker/index 실행 요청(assertProviderId). 오류 클래스·문구·순서(codex→claude) 동일.
- 저장 구조: provider는 task JSON·usage PK의 일반 문자열 그대로이며 manifest 정보를 저장하지 않는다. D1 마이그레이션 불필요, 이전 Worker로 롤백 시 데이터 변환 불필요(CHECK·enum 제약 없음 확인).
- 시험: tests/provider-storage-compat.test.mjs 6건(특성 시험: D1·SQLite 저장 왕복, 미등록 제공자 거부·제외, MCP enum, Worker·로컬 /run 400 문구, 저장소 직접 claim 거부), tests/provider-boundary.test.mjs(이전 완료 파일 5개에 따옴표 제공자 리터럴 없음; 이전 전 RED 확인). 전체 1189건 중 1188pass/0fail/기존 symlink 1skip, git diff --check, Wrangler dry-run(자산 66개, 371.13KiB) 통과.
- 독립 검증(inno-opus): E1·E2(순환 import 없음)·E3·E5 PASS. E4 P1(계획상 WU2인 provider-handoff 11행 미이전) 수정. P2 반영: 오류 클래스 단언, 같은 제공자 인계 사례로 두 조건 분리, 저장소 수준 거부 직접 시험, SQLite 왕복. 남은 한계: 경계 시험은 따옴표 리터럴만 잡고 객체 키(runners.codex 등)는 잡지 않는다(WU7 최종 범위에서 재검토).

### 2026-10-03 CR-006 S1 WU3 실행기: 전송·능력 기반 분기와 어댑터 계약 (운영 반영 전)
- 레지스트리 술어 추가: usesTransport(id, transport), providerHas(id, capability, value)(미등록·빈 소유자는 false).
- 클라우드(routine_fire): Claude Routine 프롬프트·fire 코드를 worker/index.mjs에서 worker/claude-routine.mjs로 그대로 이동하고 Claude 어댑터({provider, configured, unavailableReason, launch})를 추가. worker/remote-adapters.mjs가 어댑터 표를 만들며 routine_fire manifest마다 어댑터가 정확히 하나인지 검사. worker/dispatch.mjs는 일반 dispatchRemote/runRemoteClaim(기존 dispatchClaude/runClaudeClaim은 호환 래퍼), orchestration은 adapterFor 사용·복구 SQL은 json_each 바인딩. Worker 실행 요청은 transport로 분기, 상태 플래그 claudeRoutine은 manifest ui.availability에서 생성(값 동일).
- 데스크톱(desktop_bridge): CloudBridge claim/enqueue/start가 데스크톱 transport 제공자 목록(json_each 바인딩)을 쓰고, provider를 보내지 않는 기존 데스크톱은 첫 데스크톱 제공자(codex)로 처리. receipt·평가 예산·CLI 실행 근거·lease 만료 복구·일시정지/재claim/복구 확인·fire 확인은 capability/transport로 판단(store, delivery-receipts·reservations, delivery-protocol, execution-deadline, evaluation-claim, execution-evidence, provider-handoff, server/http, desktop-http). CODEX_HANDOFF_POLICY는 Codex 어댑터(server/runners.mjs)로 문구 그대로 이동.
- 시험: tests/provider-transport.test.mjs 6건(특성 시험은 변경 전 GREEN 확인, 원격 어댑터 표는 RED 후 GREEN), 경계 시험에 WU3 파일 16개 추가(RED 후 GREEN). 전체 1190건 중 1189pass/0fail/기존 symlink 1skip, git diff --check, Wrangler dry-run(374.89KiB) 통과.
- 독립 검증(inno-opus): E1 진리표(codex/claude/undefined/null/미등록)·E2 이동 코드 동일·E3 원격 dispatch·E4 SQL 바인딩·E5 상태 플래그·E6 데스크톱 호환 모두 PASS, P0/P1 없음. 새로 거부되는 입력: /api/desktop/:id/start 본문에 codex가 아닌 provider를 넣은 경우(현재 클라이언트는 보내지 않음). S2 전 처리할 P2: 호환 래퍼의 제공자 무관 어댑터, 다수 데스크톱 제공자 시 데스크톱의 실행 가능 제공자 광고 필요, 평가 예산 기본 제공자가 등록 순서에 의존, 상태 플래그 충돌 검사, dispatch의 Claude 어댑터 의존(호환 래퍼 이동), 3개 이상 제공자의 인계 대상 규칙, receipt 없는 데스크톱 제공자, 메시지 속 제공자명. 계획 문서의 server/provider-runners.mjs·가짜 세 번째 제공자는 채택하지 않음으로 갱신.

### 2026-10-03 CR-006 S1 WU4 배정: 선언된 모델 카탈로그 종류 기반 검증 (운영 반영 전)
- providerModels(id) 추가(미등록은 null). CLAUDE_ROLE_MODELS는 Claude manifest의 roles에서 파생(server/model-routing의 중복 Set 제거). validateDelegationResult·ModelCatalog.validate·accountChoices(policy-management)·availabilitySnapshot(allocation-policy)이 제공자 id 대신 account_catalog/built_in_roles 종류로 판단. 오류 문구·ModelCatalog.read() 응답·위임 프롬프트의 역할 목록 JSON은 동일.
- 레지스트리 불변식 추가: account_catalog 제공자는 하나만(현재 계정 카탈로그는 데스크톱이 보고하는 Codex 목록 하나이므로 두 번째 제공자가 그 목록으로 잘못 검증되는 것을 막음; S2에서 제공자별 카탈로그로 확장 시 해제).
- 시험: tests/provider-assignment.test.mjs 3건(변경 전 특성 시험 GREEN 확인 후 리팩터링; 독립 검증 지적으로 provider 누락·effort 불일치·read() 전체 모양·동결되지 않은 복사본·availability 필터 단위 시험 추가), providers 시험에 불변식(RED 후 GREEN)·역할 목록 리터럴 대조, 경계 시험에 WU4 파일 3개와 어댑터 파일 리터럴 개수 고정(server/model-routing.mjs는 Codex app-server 실행 1개). 전체 1200건 중 1199pass/0fail/기존 symlink 1skip, git diff --check 통과.
- 독립 검증(inno-opus): E1 동등성·E2 import 순서(순환 없음, 브라우저는 claude-routing을 불러오지 않음)·E3 CLAUDE_ROLE_MODELS 소비처·E4 누락 없음 PASS, P0/P1 없음. 남은 P2(S2): 위임 자식이 "서로 다른 제공자 2개" 규칙과 메시지에 Codex·Claude 이름이 고정, account_catalog 데이터가 Codex 전용.

### 2026-10-03 CR-006 S1 WU5 화면: manifest 기반 표시 (운영 반영 전)
- 신규 public/provider-ui.mjs(순수 함수: 표시명, 실행기 선택지, 가용 여부=manifest ui.availability 상태 플래그, 원격 실행기 상태 문구, 대기·인계·복구 확인 문구, 사용량 카드 모델). app.mjs·model-policy-ui·source-execution이 이를 사용하고 index.html의 고정 선택지를 제거해 시작 시 레지스트리로 채움(첫 항목 codex가 기본값). 앱 자산 버전 provider-registry-20261003으로 갱신(빈 선택 상자 HTML과 이전 캐시 app.mjs의 조합 방지).
- 동작: codex·claude의 모든 문구·링크·가용 판정은 이전과 같다(특성 시험으로 고정). 잘못 저장된 값의 표시만 달라짐: 이전에는 claude가 아니면 'Codex', codex가 아니면 'Claude'로 표시하던 인계·대기 문구가 실제 값(대소문자 무관) 또는 '제공자 미기재'로 표시되고, 사용량 기록의 null 행은 화면 전체 오류 대신 건너뛴다. 사용량 카드의 manifest 값도 esc() 처리.
- 시험: tests/provider-ui.test.mjs 5건(문구 특성 시험, 모듈 부재 RED 후 GREEN; 독립 검증 지적 반영 사례 추가), 경계 시험에 public/app.mjs·model-policy-ui·source-execution·provider-ui·index.html 추가(RED 후 GREEN). 실제 브라우저(정적 미리보기, 데스크톱·375px): 선택지 2개·기본 codex·사용량 카드 공급사/표시명/공식 링크 확인, 콘솔 오류 없음, 가로 넘침 없음. 전체 1200건 중 1199pass/0fail/기존 symlink 1skip, git diff --check, Wrangler dry-run(자산 67개, 375.39KiB) 통과. 실행 중 데스크톱 연결기(4174/4175 사용)는 건드리지 않고 임시 4180 포트로 확인 후 정리.
- 독립 검증(inno-opus): E1 동일 출력·E2 잘못된 값 차이 수용·E3 초기화 순서·E4 브라우저 모듈 그래프·E5 이스케이프·E6 시험 PASS. P1(자산 버전 미갱신) 수정, P2(미사용 변수, 대소문자 일관성, esc) 반영. 남은 P2: source-execution이 화면 모듈의 providerAvailable을 사용.

### 2026-10-03 CR-006 S1 WU6 공통 적합성 시험 스위트·배정 게이트 (운영 반영 전)
- 신규 tests/helpers/provider-conformance.mjs(9항목: 소유권·세대 위조, 중단 후 재실행한 이전 세대 소유자 거부, 선언한 중단 보장과 실제 프로세스 종료, 결과 재전송 수락·중복 없음, 원본 비보관, 비밀값 비노출(외부로 나가는 본문·명령 인자·환경·저장소), 보고/미보고 사용량(null), 문맥 전달 기록(전송 바이트 일치), 확정 실패 시 문맥 전달 기록), tests/helpers/provider-harnesses.mjs, tests/provider-conformance.test.mjs. 등록된 모든 manifest를 순회하며 하네스가 없으면 실패하고, 각 항목은 의도적 결함 하네스가 해당 단언으로 실패함을 함께 확인한다(13개 결함 변형).
- 하네스: Codex는 실제 데스크톱 연결기(createDesktopBridge·createCloudRequest·파일 outbox·작업공간 바인딩)와 운영 설정의 Codex 실행기(managedDelivery, 실제 실행 폴더) + 가짜 CLI, Claude는 Worker /run → 실제 Routine 어댑터(가짜 fire API) → 저장소 helper(prepareRequest)로 만든 MCP checkpoint_task(프롬프트의 범위 capability 사용)와 확인 복구. 외부 네트워크 금지. 운영 기준 receipt gate 0으로 전체 통과, receipt v1(미활성)도 별도 실행: 응답 유실 → 연결기 재시작 → receipt replay·ACK로 재전송을 검증.
- 발견(H4로 이관): receipt v1에서 사용자가 실행 중인 데스크톱 작업을 멈추면 중단된 실행의 fail 기록이 409로 거절된 채 outbox에 남아 명시적 로컬 폐기 전까지 데스크톱이 새 작업을 시작하지 못한다(v0 운영 경로는 영향 없음). 스위트에 todo로 표시.
- 배정 게이트(PRV-04): manifest conformance {suiteVersion, status passed|pending}, isAssignableProvider·ASSIGNABLE_PROVIDER_IDS. 위임(validateAssignments·validateDelegationResult)·인계 대상·모델 선택 경로·MCP 위임/인계 스키마가 게이트를 사용하고 claim·실행 요청은 등록 제공자 전체 허용. 저장된 정책 상태 읽기(parseState)는 경로를 재검증하지 않으므로 이후 pending 전환이 기존 정책 읽기를 깨지 않음을 확인.
- 독립 검증(inno-opus) 2회: 1차 P1(Codex 하네스가 연결기 우회, 재전송 무의미, 운영과 다른 실행기 설정·argv 미수집) → 하네스 재구성. 2차 R1~R6 PASS, P0/P1 없음. P2 반영: 일시정지와 lease 갱신의 버전 경합 재시도, 연결기 대기 시간 제한, DB보다 연결기 먼저 정리, 위조 전송은 응답 유실 주입 제외·409만 거절로 판정, 환경 미지정 시 상속 환경 기록, 예상 밖 연결기 오류 표면화. 3회 연속 실행 안정(30건 중 29pass, 1todo).

### 2026-10-03 CR-006 S1 WU7 경계 최종화·문서 (운영 반영 전) — S1 완료
- tests/provider-boundary.test.mjs를 public/server/worker 전체 소스 자동 검사로 일반화(새 일반 파일도 자동 포함, 새 파일에 넣은 리터럴 검출 확인). 어댑터 파일은 리터럴 개수 고정: providers.mjs 2(manifest), claude-routing 3, server/runners 9(Codex CLI 실행기·인계 프롬프트·로컬 Claude Routine 실행기), server/model-routing 1(Codex app-server), worker/claude-routine 3, worker/model-discovery 1(공급사 문서 출처 키).
- 문서: docs/PROVIDERS.md(구조, 현재 제공자 표, 새 제공자 추가 절차, 저장·롤백, S2 전 제약), REQUIREMENTS-STATUS(현재 상태·요구 표에 CR-006 행), 계획 문서 갱신.
- S1 최종 검증: 전체 1245건 중 1243pass/0fail/기존 symlink 1skip/1todo(H4), git diff --check, Wrangler dry-run(자산 68개, 392.20KiB) 통과. 이 수치에는 이어서 착수한 CR-007 S3 P1·P2 시험 13건 포함. 커밋 전(사용자 확인 대기).
- S1 단독 커밋 트리 검증(2026-10-05, S3 파일 제외 상태를 별도 폴더로 내보내 실행): 전체 1232건 중 1230pass/0fail/기존 symlink 1skip/1todo(H4), git diff --check, Wrangler dry-run(자산 67개, 376.23KiB) 통과.

### 2026-10-03 CR-007 S3 P1·P2 플러그인 레코드·등록부 (운영 반영 전)
- 계획: docs/superpowers/plans/2026-10-03-plugin-registry.md. 1차 범위는 공식 카탈로그(anthropics/skills의 skills/<이름>, openai/skills의 skills/.curated/<이름>)의 스크립트 없는 Agent Skill. 자동 설치 없음, 사용자 요청으로만 가져오기·승인·비활성·확인 삭제. 저장은 metadata 키(plugin:<id>, plugin_content:<id>), 스키마 변경 없음.
- P1 public/core/plugins.mjs: 출처 판정(40자리 커밋 고정), SKILL.md frontmatter(이름=폴더, YAML 블록 스칼라 거부), 파일 목록·크기 검사(최상위 SKILL.md와 .md/.txt만, 8개·48KB), 내용 해시(정렬 목록의 파일별 SHA-256을 다시 해시), 정적 검토(경고: 셸·네트워크 명령, 외부 URL, 비밀값·환경 파일, 지시 우회 문구, AI 탐지 언급 / 차단(PLG-06): 탐지기를 겨냥한 회피·AI 작성 은폐·사람 작성으로 위장 의도. NFKC·서식 문자 제거·A.I. 정규화, 두 줄에 걸친 문구, 부정문("회피하지 말 것")은 경고), 결과 200개 상한과 생략 수·규칙 버전 기록, 엄격한 레코드 검증, 승인(검토한 해시를 명시, 차단 시 불가)·비활성 전이.
- P2 worker/plugins.mjs + 라우트: GET /api/plugins(본문 텍스트 없음), POST /api/plugins/import|approve|disable|remove. 가져오기는 커밋이 카탈로그 기본 브랜치에 있는지 먼저 확인(포크 네트워크 커밋 차단) → 목록 검사 → 직접 구성한 raw URL로 내려받아 목록의 크기·git blob SHA-1·UTF-8 일치 확인. 승인은 저장 텍스트를 다시 해시해 불일치면 hash_mismatch로 비활성(409). 동일 내용 재가져오기는 상태 유지·손상 사본 복구, 다른 내용은 검토 상태로 되돌림. 레코드 쓰기는 비교 후 교체(동시 변경은 409). 외부 실패는 502로 아무것도 저장하지 않음.
- 독립 검증(inno-opus): P0 없음. P1 2건(포크 커밋 출처 위장, PLG-06 규칙의 오탐·미탐) 수정. 반영한 P2: 내려받은 바이트와 목록 결속, YAML 블록 스칼라, 승인·가져오기 경합, 동일 해시 재가져오기의 손상 사본, 내용 행 엄격 검사, 비활성 레코드의 승인 값 검사, 외부 URL 규칙·셸/비밀값 규칙 확대, 결과 상한·중심 발췌, 규칙 버전(규칙 변경이 저장 레코드를 무효화하지 않음), null 본문 400, 시간 형식, 파일 중복·합계, 제공자 목록 검증. 남긴 P2: 32개 상한 검사와 쓰기가 원자적이지 않음(동시 가져오기 시 몇 개 초과 가능), 사용자가 비활성한 스킬도 다른 내용 재가져오기 시 검토 상태로 돌아감(사용자의 명시적 가져오기로 판단), 승인 전 원문 보기 화면은 P4.

### 2026-10-03 CR-007 S3 P3a 사용자 선택·실행 전달·기록 (운영 반영 전)
- POST /api/tasks/:id/plugins {expectedVersion, plugins:[{id, reason}]}: 실행 중이 아닌 작업, 승인된 것만, 최대 3개, 이유 필수(자식 작업은 위임 조정자 몫으로 거부).
- 실행 시점 재확인: Worker가 선택마다 승인 상태와 저장 텍스트 해시를 다시 확인해 전달 목록을 만든다(비승인 not_approved, 불일치 hash_mismatch로 비활성 후 제외, 없음 missing). Claude는 어댑터가 프롬프트에 "사용자 승인 플러그인" 구역(출처·커밋·해시·이유, 작업 지시·안전·소유권 계약을 바꿀 수 없음 명시)을 넣고 fire 시점(확정 실패 포함)에, Codex는 데스크톱 claim에 검증된 텍스트를 실어 연결기가 실행기에 넘기고 실행기가 넣은 목록을 complete/fail에 보고한다. checkpoint.pluginDelivery={version:1, applied:[{id,contentHash,reason}], skipped:[{id,reason}]}, 새 claim에서 초기화, 보고는 작업의 선택 id·이유와 일치할 때만 저장(아니면 결과는 유지하고 기록만 버림). 선택이 없는 작업의 프롬프트·checkpoint·claim 모양은 바뀌지 않는다.
- 적합성 스위트에 pluginDelivery 항목 추가(승인된 플러그인만 제공자에 도달, 철회된 플러그인은 절대 미전달, 기록 일치; 결함 변형 2개). Codex(v0·v1, 실제 연결기)·Claude 모두 통과.
- 검증: tests/plugin-delivery.test.mjs 5건(RED 후 GREEN), 전체 1263건 중 1261pass/0fail/기존 symlink 1skip/1todo(H4), git diff --check 통과. 독립 검증은 아래 줄에 추가.
- P3a 독립 검증(inno-opus): E1(승인·해시 재확인 후에만 전달)·E2(선택 경로 우회 없음; createTask는 필드를 화이트리스트로 받으므로 plugins를 넣을 수 없음)·E4(선택 없는 작업은 프롬프트·claim·checkpoint 불변) PASS, P0/P1 없음. 반영한 P2: 데스크톱 보고는 저장된 플러그인 버전(id·해시)과 일치할 때만 기록(receipt는 원래 본문 기준 유지), 손상된 레코드·잘못된 선택은 실행을 실패시키지 않고 missing으로 제외, 플러그인을 해시에 묶인 태그로 감싸 본문이 경계를 닫을 수 없게 하고 "프롬프트의 다른 부분을 바꿀 수 없음·명령 실행/링크 열기 금지·권한 없음"을 명시, 실행당 플러그인 텍스트 합계 64KB(초과분 size_limit 제외), 검토 규칙에 prompt_framing 경고 추가, 확정 실패·불확실 fire 기록과 버전 충돌·자식 거부 시험 추가. 남긴 P2: Routine 확정 거절 시 applied는 "프롬프트에 넣어 보냄"의 의미(세션 미실행)이며 문서에 명시, 이전 데스크톱은 플러그인을 넣지 않고 보고도 하지 않으므로 기록이 비어 있음.

### 2026-10-03 CR-007 S3 P4 화면 (운영 반영 전)
- 신규 public/plugin-ui.mjs: 순수 표시 함수(고정 원문 링크 github.com/<저장소>/tree/<커밋>/<경로>, 상태 문구, 검토 결과 행·생략 수, 승인 가능 여부, 실행 기록의 전달 문구, 가져오기·선택 입력 검증)와 대화상자 제어기(목록·검토 결과·검토한 해시로 승인·사용 중지·확인 후 삭제, 공식 카탈로그 가져오기 양식, 현재 작업의 플러그인 선택·이유 저장). 스킬 설명·검토 발췌 등 제3자 텍스트는 textContent로만 표시.
- 연결: client에 listPlugins/importPlugin/approvePlugin/disablePlugin/removePlugin/selectTaskPlugins, Worker 상태에 pluginRegistry 능력, 데스크톱 연결기는 인증된 /api/plugins·/api/plugins/{import,approve,disable,remove}·/api/tasks/:id/plugins만 클라우드로 전달, 실행 화면에 "플러그인" 버튼(클라우드 연결 시), 재개 지점 카드에 플러그인 전달 기록 한 줄, 스타일.
- 시험: tests/plugin-ui.test.mjs 6건(RED 후 GREEN). 실제 브라우저(정적 미리보기 + 실제 대화상자 제어기에 시험용 client, 데스크톱·375px): 설명·발췌의 HTML이 요소로 해석되지 않음(img/script 0, 실행 없음), 차단 스킬은 승인 버튼 없음, 기존 선택 복원, 승인 호출에 검토 해시 전달, 잘못된 커밋은 요청 전 오류, 삭제는 "삭제 확인" 체크 뒤에만 가능(표시 라벨 추가). 미리보기는 임시 4180 포트로 확인 후 정리.
- 전체 1275건 중 1273pass/0fail/기존 symlink 1skip/1todo(H4), git diff --check, Wrangler dry-run(자산 69개, 407.25KiB) 통과. 독립 검증은 아래 줄에 추가.
- P4 독립 검증(inno-opus): E1(제3자 텍스트는 textContent만, 링크는 github.com 고정)·E2(검토 해시로 승인, 차단 스킬 승인 불가, 확인 후 삭제, 자동 설치 없음)·E4(데스크톱 프록시 범위) PASS, P0/P1 없음. 반영한 P2: 원문 링크는 검증된 카탈로그 출처로만 만들고 아니면 숨김, 규칙·제외 사유 라벨 누락(prompt_framing, size_limit)과 hasOwn 조회, 사용 중지가 되돌릴 수 없음을 버튼에 명시, 저장은 클릭 시점의 작업 버전을 쓰고 그사이 선택이 바뀌면 다시 확인 요청, 요청 중 버튼 비활성, 쓰기 성공 뒤 목록 갱신 실패를 따로 안내, 승인되지 않은 기존 선택을 "제외됨"으로 표시, 전달 기록이 잘못돼도 화면이 깨지지 않음, 체크박스·이유 입력·카드별 버튼의 접근 가능한 이름, 작업 후 결과 메시지로 초점 이동. 실제 브라우저 재확인 완료. 앱 자산 버전 plugin-registry-20261003.

### 2026-10-03 CR-007 S3 P3b 마스터의 자식 배정 플러그인 (운영 반영 전)
- 위임 배정에 선택적 plugins:[{id, reason}](승인된 것만, 자식당 최대 3개, 이유 필수). validateAssignments·validateDelegationResult(Codex 마스터 JSON)·MCP delegate_task 스키마가 받고, 자식 작업은 task.plugins로 받아 사용자 선택과 같은 실행 시점 재확인·전달·기록을 거친다. Worker Delegations가 할당 전에 승인 여부를 확인(미승인은 오류로 마스터가 다시 결정).
- 마스터 프롬프트: 승인된 플러그인이 있을 때만 "자식에 배정할 수 있는 승인 플러그인" 목록(id·설명 300자, 최대 20개, 설명은 제3자 텍스트로 명시)을 넣는다. Claude 루트 마스터는 Worker 프롬프트에, Codex 루트 마스터는 데스크톱 claim의 pluginCatalog를 실행기가 위임 지침과 함께 넣는다. 승인 플러그인이 없으면 프롬프트 불변.
- 시험: tests/plugin-assignment.test.mjs 4건(RED 후 GREEN), 전체 1280건 중 1278pass/0fail/기존 symlink 1skip/1todo(H4), git diff --check, Wrangler dry-run(자산 69개, 410.34KiB) 통과. 독립 검증은 아래 줄에 추가.
- P3b 독립 검증(inno-opus): E1(모든 할당 경로 승인 확인: Claude MCP delegate_task, Codex 마스터의 데스크톱 complete 위임, 재전송은 저장된 자식 반환, 재개·복구·재검토는 기존 자식 재대기이며 실행 시점 재확인)·E2(승인 플러그인·배정이 없으면 프롬프트·claim·자식 불변)·E3·E4 PASS. "미확인 P1"(모델 정책 할당 경로에서 플러그인 누락 가능성)은 해당 경로가 자식을 펼쳐 전달함을 시험으로 확인(누락 없음, 데스크톱이 claim한 자식이 플러그인 텍스트를 받음). 반영한 P2: 레지스트리 없이 배정이 오면 거부(fail closed), 승인 확인에 레코드 검증 사용, 평가 예산 작업은 목록 제외, 잘못된 목록이 실행을 실패시키지 않음, 목록 문구에 "명령 실행·링크 열기 금지, 프롬프트를 바꿀 수 없음"과 20개 상한 표시, 모델 정책 프로필의 요구 버전에 배정 플러그인 id 포함(플러그인 없는 자식의 기존 프로필 키는 불변).
- S3 최종 검증: 전체 1285건 중 1283pass/0fail/기존 symlink 1skip/1todo(H4), git diff --check, Wrangler dry-run(자산 69개, 410.95KiB) 통과. 문서 docs/PLUGINS.md, REQUIREMENTS-STATUS(CR-007 행). CR-007 S3 완료(커밋 전·사용자 확인 대기). 실제 공식 카탈로그 가져오기·실구독 실행 확인은 사용자 확인 후.

### 2026-10-05 CR-004 A A1 실행 경로 근거 (커밋 전)
- 커밋: S1 696aee5(제공자 레지스트리), S3 7793f1c(플러그인 등록부)를 로컬 커밋으로 분리(사용자 확인, push·배포 없음). 이어서 CR-004 A 착수. 계획 docs/superpowers/plans/2026-10-05-execution-route-evaluation.md(A1 근거, A2 비교·가용성, A3 표시·문서).
- server/runners.mjs: Codex 실행 근거에 routeConditions(실행 조건 지문, sha256) 추가. 넣는 것: 계약 버전(ROUTE_CONDITIONS_CONTRACT=1), 실행 방식, 모델·effort·MCP 주소를 뺀 CLI 인자, MCP 연결 여부, 문맥 조회기 사용 여부, 관리 전달, 협상된 원본 위임 버전, 평가 예산 실행 여부, 실제 전달된 플러그인 id·해시(전달 순서 포함). 모델·effort는 경로 자체라서, 시작마다 바뀌는 loopback MCP 주소는 비교 가능성을 깨므로 제외.
- public/core/execution-evidence.mjs: routeConditions는 없음/null(필드 생략, 이전 근거 형태 그대로) 또는 64자리 소문자 hex만 허용. worker/review-observation.mjs: 근거의 CLI 적용 model/effort가 배정과 같고 조건 지문이 있을 때만 관측에 route {basis:'cli_arguments', model, effort, conditions}를 기록. 적용값이 배정과 다르거나 저장된 지문 형식이 깨졌으면 not_attributable(execution_evidence_mismatch). 모델 자기보고·serving version은 쓰지 않음(계속 null).
- public/core/model-selection.mjs validObservation: route는 정확한 키, basis, 후보와 같은 model/effort, hex 지문일 때만 저장하고 버전 있는 관측에는 거부. worker/model-policies.mjs 재처리 비교에 route 포함(다른 route는 충돌, route 도입 전에 저장된 행에 route가 붙은 재처리는 같은 실행으로 보고 저장값 유지 — 배포 되돌림 호환).
- 프롬프트 계약 고정: 조건 지문은 프롬프트 문구를 보지 못하므로 tests/execution-route.test.mjs가 표준 자식 프롬프트(플러그인 없음·있음)의 sha256을 계약 버전별로 고정한다(기계별 도우미 경로는 자리표시로 치환). 프롬프트를 바꾸면 계약 버전을 올리고 새 항목을 추가해야 CI가 통과한다.
- 독립 검증(inno-opus): P0/P1 없음, 승인(수정 조건). 반영: P2 프롬프트 문구 변경이 지문에 반영되지 않음(위 고정 시험), P3 저장 지문 형식 검사, 배포 되돌림 시 재처리 충돌, 누락 시험(관리 전달·원본 위임 버전 지문 변화, SQLite 저장, outbox 보존, 이전 행 재처리). 문서화할 한계(A3): Codex CLI 자체 버전 미포함(90일 근거 만료로만 재검토), --ignore-user-config가 전역 지시 파일까지 막는지 미확인, 플러그인 순서가 지문에 포함됨(짝짓지 않는 쪽으로 보수적).
- 검증: tests/execution-route.test.mjs 13건(RED 후 GREEN), 기존 실행 근거 시험 2건 기대값 갱신. A2 포함 전체 1307건 중 1305pass/0fail/기존 symlink 1skip/1todo(H4), git diff --check, Wrangler dry-run(자산 69개, 415.70KiB) 통과.

### 2026-10-05 CR-004 A A2 실행 경로 비교·가용성·배정 (커밋 전)
- public/core/model-selection.mjs: 버전 없는 경로의 근거 = 같은 model/effort의 route 관측. 쌍은 같은 comparisonId·같은 실행 조건일 때만, comparisonId당 한 쌍. route 관측과 route 없는 관측은 짝짓지 않음. 버전 없는 후보는 route 관측이 하나도 없으면 기존 사유 unobserved_model_version으로 보류. 가용성 근거 수준 분리: 버전 있는 경로·기준 경로는 기존 account_catalog 행(버전·능력·문맥), 버전 없는 비기준 경로는 신선한 account_exposure 행(계정 목록 노출만, 능력·문맥 주장 없음).
- 승격: 기존 최소 표본·독립 검토 전부 통과·실측 토큰 감소·지연 비악화에 더해, 이미 승격된 경로가 사용 중이면 그 경로와의 직접 비교 쌍도 같은 기준으로 요구(insufficient_current_route_evidence, 제안 A의 "이미 승격된 모델 간 전환" 조건, 버전 있는 경로에도 적용 — 기존 시험 2건에 직접 비교 쌍 추가). 근거 id·참조는 중복 제거 후 저장하고 비교 대상(comparedWithId)을 남김. 근거 유효성은 저장된 쌍 자체를 다시 확인(나중 관측이 쌍을 밀어내지 못함).
- 철회·배정: 버전 미확인 기준 경로는 가용성 행 없이 복구. 미검증 기준 경로 우회(배정 때 계정 목록으로 재확인)에서 policyVersion===1·activeId===기준 조건을 빼고, 다른 경로 고정이 없으면 허용(버전 있는 기준 경로의 기존 대체 규칙과 같음). 그래서 2단계 철회, 이전 경로 미노출 중 철회·중대 회귀, 승격 경로의 근거 만료·계정 노출 상실 때도 배정이 기준 경로로 간다(이유 active_route_not_current). 고정한 경로는 기다린다. 철회·중대 회귀 기준 경로는 계속 제외.
- worker/allocation-policy.mjs: availabilitySnapshot이 신선한 데스크톱 계정 목록(account_catalog 종류 제공자)에서 account_exposure 행을 만든다(만료 = 보고 시각+2시간, desktop_models 가드가 값·만료를 고정). 버전 없는 선택은 account_exposure 행으로만 확인.
- 독립 검증(inno-opus): 승인(수정 조건). 반영: P1 버전 없는 기준 경로 프로필이 2단계 철회·이전 경로 미노출 때 영구 대기, P2 승격 경로 근거 만료·노출 상실 때 배정 실패(위 우회 확장), P2 버전 있는 후보와 버전 없는 기준 경로 비짝짓기를 의도로 기록·시험, P3 나중 관측의 근거 밀어내기(저장 쌍 재확인). 미반영(도달 불가·기록만): 핵심 함수 직접 호출에서만 생기는 null 버전 account_catalog 기준 대체와 배정 확인 기준 차이(스냅샷이 null 버전 정책 행을 버림), 노출 만료 가드 키가 model_policy_availability인 점(desktop_models 가드로 충분), 프롬프트 해시 표를 계약 증가 없이 고칠 수 있는 절차 위험(시험 주석으로 금지).
- 남은 한계: 사용 중 승격 경로의 근거를 같은 경로로 갱신하는 절차는 없다(already_active, 철회는 영구). 새 비교 사례가 필요하며 추가 비교 예산 0에서는 생기지 않는다.
- 검증: tests/execution-route-policy.test.mjs 14건, model-selection 버전 있는 직접 비교 시험 추가(RED 후 GREEN). 전체 1314건 중 1312pass/0fail/기존 symlink 1skip/1todo(H4), git diff --check, Wrangler dry-run(자산 69개, 416.78KiB) 통과.

### 2026-10-05 CR-004 A A3 표시·문서 (커밋 전) — CR-004 A 완료
- public/model-policy-ui.mjs:
  - CLI 근거가 있는 제공자에는 "이 실행 경로의 관측 결과(실행기가 CLI로 적용한 모델·검토 강도, 동일한 실행 조건, 같은 입력의 독립 검토)" 비교 범위와 한계(내부 버전·다른 작업 동등 품질 미보장, 추가 비교 예산 0이라 승격 검토가 근거 부족으로 보류될 수 있음)를 표시한다.
  - CLI 근거가 없는 제공자(Claude Routine)에는 승격 대상이 아님을 표시한다.
  - 선택된 버전 없는 경로에 "(내부 버전 미확인)" 접미사를 붙인다(CLI 근거 제공자만).
  - 새 사유 라벨: insufficient_current_route_evidence, active_route_not_current, profile_mismatch.
  - 이전 경로 복구가 불가한 철회 안내를 기준 경로 재확인 동작에 맞게 수정했다.
  - 자산 버전 app.mjs?v=execution-route-20261005.
- 문서:
  - PRD MOD-01/03/04/05에 실행 경로 평가의 의미·한계를 반영했다.
  - docs/MODEL-ROUTING.md: 비교 규칙, 가용성 수준, 승격 경로 근거 만료 때 기준 경로 배정, 고정 경로 대기, 한계 목록.
  - REQUIREMENTS-STATUS의 CR-004 A 행과 다음 순서, CHANGE_REQUESTS의 CR-004 상태를 갱신했다.
  - 오래된 "결정 대기" 표기(HANDOFF-CLAUDE H5·표·재개 문구, MODEL-ROUTE-EVIDENCE-PROPOSAL 상태, PROVIDER-PLUGIN-PROPOSAL)와 PROGRESS 재개 지점을 갱신했다.
  - 승격은 사용자의 "승격 검토"로만 요청되므로 새 문구에서 "자동 승격" 표현을 쓰지 않는다.
- 독립 검증(inno-opus): 승인(수정 조건). 반영:
  - P2: 손상된 고정 상태(고정된 기준 경로가 active가 아님)는 우회 불가. 작업군 불일치(profile_mismatch) 대기도 우회 불가.
  - P2: HANDOFF-CLAUDE의 CR-004 미결정 표기.
  - P3: 이전 경로 없는 철회 뒤 사유를 active_route_not_current로 통일(activeId≠기준), 경로 접미사 제공자 제한, 철회 안내와 경로 표시 불일치, 한국어 문구, profile_mismatch 라벨, "자동 승격" 과장 표현.
  - 수정분은 시험으로 확인했고 재검토는 하지 않았다.
- 미반영(기록만):
  - 정책 화면 HTTP 시험에서 active_route_not_current 직접 확인은 없다. 배정과 화면이 같은 함수를 쓰고, 핵심·배정 시험으로 확인했다.
  - 실제 브라우저 확인 없음. 기존 대화상자의 문구 변경이라 렌더링 단위 시험으로 대신했다.
- 검증: tests/model-policy-ui.test.mjs와 tests/execution-route-policy.test.mjs 추가·갱신(RED 후 GREEN). 전체 1315건 중 1313pass/0fail/기존 symlink 1skip/1todo(H4), git diff --check, Wrangler dry-run(자산 69개, 416.84KiB) 통과.
- 한계 요약:
  - 정상 작업만으로는 같은 입력·같은 조건 비교 쌍이 거의 생기지 않고 추가 비교 예산이 0이라, 실제 승격 근거 형성은 확인하지 못했다.
  - 평가 예산 실행은 모델 인자를 적용하지 않아 실행 경로 근거를 만들지 않는다.
  - 내부 버전·Codex CLI 버전·전역 지시 파일 변화는 구분하지 못한다.
  - 사용 중 승격 경로의 근거를 같은 경로로 갱신하는 절차가 없다.

### 2026-10-05 H4-1 사용자 중단 실행의 결과 정리 (커밋 전, receipt gate 0 유지)
- 커밋: CR-004 A를 로컬 커밋 3cbf0e0으로 남겼다(사용자 확인, push·배포 없음). H4 계획은 docs/superpowers/plans/2026-10-05-delivery-journal.md(H4-1~5)에 있다.
- 문제: receipt v1에서 사용자가 실행 중 작업을 멈추면 데스크톱이 막혔다(기존 conformance staleOwner todo).
  1. renew가 409를 받는다.
  2. 실행기가 중단되고 실패 결과(또는 늦은 완료)가 outbox에 pending으로 저장된다.
  3. Worker가 그 전달을 영구히 거절한다. lease 만료 중단만 받기 때문이다.
  4. 데스크톱은 수동 폐기 전까지 새 실행을 못 한다.
- 신규 worker/delivery-discharge.mjs:
  - `ownerPermanentlyRefused`가 영구 거절을 판정한다. owner가 바뀌었거나, 같은 owner인데 running이 아니고 같은 버전의 lease 만료 일시중지도 아닌 경우다.
  - 두 조건을 모두 만족하면 정리한다. 영구 거절이고, 그 owner의 claim 예약이 정확히 남아 있어야 한다. 결과가 수락되면 같은 배치에서 예약이 지워지므로, 예약이 있다는 것은 적용된 결과가 없다는 증거다.
  - 정리는 D1 배치 하나다. 작업 버전·workspace 조건으로 예약을 지우고 `disposition:'discarded'` receipt를 저장한다. assertion으로 되돌림을 보장하고 작업은 바꾸지 않는다.
  - Worker 전달 경로의 ConflictError·ValidationError 뒤에만 시도하고, 응답에 `discarded:true`를 붙인다. 데스크톱에 주는 receipt 필드는 기존과 같다.
  - 재전송은 저장 기록으로 응답하고, ACK가 해제한다. readDeliveryRecord와 ACK 비교는 disposition 키를 허용한다.
- server/desktop-bridge.mjs:
  - v1에서 renew가 확정 거절(409)되면 결과를 저장한 직후 한 번 전달한다. 검증된 receipt와 ACK가 끝나면 unsafe로 멈추지 않는다. 실패하거나 다른 오류면 기존처럼 멈춘다.
  - onDiscarded 알림을 추가했다. scripts/desktop-bridge.mjs가 "중지된 실행의 결과는 적용하지 않고 정리했습니다"를 출력한다.
- 시험:
  - tests/delivery-discharge.test.mjs 8건(RED 후 GREEN): 사용자 일시중지, 일시중지 뒤 늦은 완료, 응답 유실 재전송, 재개(ready)·취소 뒤 늦은 전달, 예약 없음은 확정 불가, 판정 함수.
  - tests/delivery-receipt-http.test.mjs:
    - 소유자 교체 CAS 손실은 폐기로 기대값을 갱신했다.
    - 같은 버전 lease 만료 중단은 결과를 적용한다.
    - running owner의 잘못된 본문은 400이고, receipt 없이 예약을 유지한다.
    - 폐기 뒤 다른 action·다른 본문은 409다.
  - tests/desktop-delivery-protocol.test.mjs: renew 시험을 새 계약에 맞춰 3건으로 나눴다(확정 거절 즉시 정리, 즉시 전달 실패는 차단·drain 유지, 409가 아닌 renew 오류는 기존 차단).
  - tests/provider-conformance.test.mjs: receipts v1 staleOwner todo를 제거했고 통과한다.
- 독립 검증(inno-opus): 승인. P0·P1·P2가 없고 안전 불변식(지금이나 나중에 수락될 수 있는 결과는 폐기하지 않음)이 PASS다. 반영한 P3:
  - 메시지를 중립 표현으로 고쳤다("settled").
  - 일괄 실패 catch의 이유를 주석으로 남겼다.
  - 시험 4건을 추가했다.
  - 되돌림 위험, 첫 본문 고정, lease 만료 중단 뒤 위임·검토 결과의 지연 정리를 계획 문서 한계로 기록했다.
- 검증: 아직 구현 전인 tests/claim-journal.test.mjs(H4-2 RED)를 빼고 전체 1327건 중 1326pass/0fail/기존 symlink 1skip/0todo. git diff --check, Wrangler dry-run(자산 69개, 420.40KiB) 통과.

### 2026-10-05 H4-2 claim journal과 응답 유실 owner 확인 (커밋 전, receipt gate 0 유지)
- 문제: 응답 유실이나 프로세스 종료 때 owner를 모른다. v1 claim 응답을 받기 전이나 실행 도중 프로세스가 죽으면 owner를 모르거나, 결과도 실패 기록도 남지 않는다. 메모리 latch는 재시작하면 사라진다.
- Worker:
  - poll/start는 receipt 프로토콜일 때만 `claimNonce`(64 hex)를 받는다. claim 배치 안에서 예약과 함께 `desktop_claim:<nonce>` 표지를 저장한다. 표지 내용은 claimed, owner, 예약 키다. 일반 INSERT와 assertion을 쓰므로, 이미 쓰였거나 닫힌 nonce면 claim 전체가 되돌려진다. 응답은 nonce를 돌려준다.
  - `POST /api/desktop/claim-status {nonce}`(v1 헤더 필수)는 표지가 없으면 closed 표지를 먼저 넣는다(admission fence). 그 결과 늦게 도착한 같은 nonce의 claim은 실패한다. 응답은 다음 셋 중 하나다.
    - `none`
    - `settled`(예약이 사라짐: 적용·폐기·명시 폐기)
    - `claimed`(owner 포함)
  - 표지 정리: closed 표지와 예약이 사라진 claimed 표지는 24시간 뒤 32개씩 지운다. 예약이 남은 claimed 표지는 지우지 않는다.
  - 배치가 커밋됐는데 오류가 보고되면, 이번 시도의 고유 표지 값으로 커밋을 알아보고 claim을 성공으로 돌려준다. 그 전에는 poll이 이를 "claim 없음"으로 바꿔 owner를 잃을 수 있었다.
- 데스크톱:
  - server/claim-journal-file.mjs는 원자 쓰기 저장소다. 미완료 `.tmp`는 버린다. 요청 전에만 requested를 쓰고, owned는 같은 nonce의 확정 기록을 교체하므로 확정 파일만으로 안전하다. 읽을 수 없는 확정 파일은 보존하고 CLAIM_JOURNAL_INVALID를 낸다.
  - server/desktop-bridge.mjs(`journal`, v1만)의 기록 순서:
    1. 요청 전에 requested(binding, nonce, taskId)를 쓴다.
    2. 검증된 응답이 오면 nonce가 일치하는지 확인하고, claim이 없으면 journal을 지우고, 있으면 owned를 쓴다.
    3. 결과를 outbox에 저장하면 journal을 지운다.
  - tick:
    - 저장 결과를 전달한 뒤 같은 owner의 journal을 지운다(drain도 같다).
    - 남은 journal은 claim-status로 정리한다. none·settled면 지운다. claimed면 owned를 먼저 쓰고, 그 owner의 실패 기록을 outbox에 저장한 뒤 journal을 지우고 전달한다. 실패 기록은 새 종류 `restarted`이고 재시도 가능한 실패다.
    - workspace 불일치나 형식 오류는 자동으로 지우지 않고 멈춘다.
  - journal이 있으면 claim 요청 실패에 메모리 latch를 걸지 않는다. 대신 다음 tick이 정리한다. journal이 있는 동안 직접 시작과 정리는 거절한다.
  - scripts/desktop-bridge.mjs는 v1에서만 .inno/desktop-claim.json을 만든다.
- public/core/failures.mjs: `restarted`(DESKTOP_RESTARTED) 안내를 추가했다. 이전 실행 프로세스가 끝났는지 확인하라고 안내한다.
- 시험(RED 후 GREEN):
  - tests/claim-journal.test.mjs 15건:
    - 의도·owner 기록
    - 빈 poll
    - 응답 유실 해결
    - 도달하지 않은 claim의 fence
    - 실행 중 종료
    - 다른 workspace journal 보존
    - 표지 정리
    - 실패 보고 저장 뒤 정리 전 중단
    - 이미 정리된 owner
    - drain
    - journal 중 시작·정리 거절
    - v0 nonce 거절
    - 커밋 뒤 오류 배치
    - 검사·배치 사이 fence 경쟁
    - 이미 claim한 nonce를 다시 쓴 poll은 claim 없음이 아니라 409
  - tests/claim-journal-file.test.mjs 3건.
- 독립 검증(inno-opus): 승인(수정 조건). P0·P1이 없고, fence와 상태 기계는 PASS다. 반영한 항목:
  - P2: requested 정리 중 중단 시 같은 실패를 두 번 보고해 막힘 → owned 선기록.
  - P2: poll이 커밋된 모호한 claim을 "없음"으로 처리 → 고유 표지로 커밋 인식.
  - P3: 표지 assertion, settled 상태, drain의 journal 정리, `restarted` 안내 문구, 누락 시험.
  - 수정분 재검증 PASS. 남은 P3(R1)도 반영했다. 이미 claim한 nonce가 poll에서 "claim 없음"으로 삼켜지지 않도록 DESKTOP_CLAIM_NONCE_USED로 구분한다. 현재 요청 함수는 재전송하지 않아 도달하지 않는 방어다.
- 검증: 전체 1347건 중 1346pass/0fail/기존 symlink 1skip(H4-3 Worker 판정 시험 2건 포함). git diff --check, Wrangler dry-run(자산 69개, 428.49KiB) 통과.
- 한계:
  - 같은 `.inno`를 쓰는 두 데스크톱 프로세스는 포트 4174 잠금에 의존한다(기존과 같음).
  - 전원 장애 내구성은 보증하지 않는다.
  - 실제 프로세스 강제종료 시험은 H4-4에서 한다.

### 2026-10-05 H4-3 이전 형식(receipt 없는) 결과의 명시 정리 (커밋 전)
- 원칙: receipt 없는 과거 결과를 자동 수락으로 인정하지 않는다. Worker가 지금 적용할 수 있다고 판정한 경우에만 이전 방식으로 보내고, 그 밖에는 지우지 않고 보관한다.
- Worker:
  - worker/legacy-delivery.mjs는 작업 상태만 보고 결과를 판정하는 읽기 전용 모듈이다. 판정값은 다음과 같다.
    - deliverable(같은 v0 owner가 실행 중이거나 같은 버전의 lease 만료 일시중지)
    - already_applied(같은 종류의 결과가 이미 기록됨)
    - owner_replaced
    - not_running
    - receipt_required
    - task_missing
  - `POST /api/desktop/:id/legacy-status`는 v1 헤더가 필요하고 입력 키를 정확히 검사한다.
- 데스크톱:
  - outbox-recovery `readLegacy`는 정확한 해시이고 임시 파일이 없을 때만 legacy 기록을 읽는다.
  - outbox-recovery `archiveLegacy`의 처리 순서:
    1. 잠금을 잡는다.
    2. 다시 읽는다.
    3. Worker를 확인한다(allowed).
    4. 변경이 없는지 다시 확인한다.
    5. 대상 파일이 없는지 다시 확인한다.
    6. 같은 폴더의 `<pending>.legacy-<hash16>.json`으로 이름을 바꾼다. 바이트는 그대로 두고 삭제하지 않는다.
  - 브리지 `deliverLegacy`(복구 잠금, latch 유지)는 deliverable이나 already_applied일 때만 원래 본문을 receipt 헤더 없이 v0로 보낸 뒤 outbox를 비운다. Worker의 4xx 거절은 표시한다.
  - 로컬 API:
    - `/api/desktop/recovery/legacy-status`
    - `/api/desktop/recovery/legacy-deliver`(confirm 필수)
    - `/api/desktop/recovery/legacy-archive`(confirm 필수)
  - deliverable 결과는 보관할 수 없다. 이 프로세스에서 이전 방식 전달이 Worker에 거절됐다면, 추가 확인(afterRefusal)과 함께 보관할 수 있다.
  - 연결 정보를 확인할 수 없는 기록(binding_unverified)은 전달하지 않고 보관만 할 수 있다. 다른 workspace에 묶인 기록은 모든 동작을 거절한다.
- 화면: recovery.html에 "이전 형식 결과 정리"를 추가했다(클라우드 상태 확인, 전달·보관 각각의 확인 체크). local-recovery 제어기는 같은 해시를 다시 확인하고, 모든 응답의 형식을 확인하며, 동작마다 확인을 초기화한다.
- 실제 브라우저 확인: 임시 로컬 서버(임의 포트, 실제 Worker 코드, 실제 연결기·4174/4175와 무관)로 했다.
  - deliverable → 전달, 작업이 완료됐다.
  - 일시중지된 작업 → "적용 불가" 표시 → 보관했고, 디스크에 보관 파일이 있음을 확인했다.
  - 창이 뒤에 있어 스크린샷은 찍지 못했고, 접근성 트리와 DOM 클릭으로 확인했다.
- 독립 검증(inno-opus): 승인(수정 조건). P0·P1이 없다. 반영한 항목:
  - P2: Worker가 계속 거절하는 deliverable 결과가 전달도 보관도 안 되던 문제 → 거절 기록 뒤 추가 확인으로 보관.
  - P3:
    - clear를 await로 바꿨다.
    - 이름 바꾸기 직전 대상을 다시 확인한다.
    - already_applied 문구를 "같은 종류의 결과"로 고쳤다.
    - 잘못된 binding 기록을 보관할 수 있게 했다.
    - 시험을 추가했다: fail 기록의 already_applied, 확인과 전송 사이의 일시중지, 거절 뒤 보관, 임시 파일·오래된 해시, 확인 불가 binding.
- 2차 검증(H4-4와 함께, inno-opus): 승인(수정 조건). 반영한 P2 두 건:
  - 거절 표시 범위: 실제 cloud 응답(`fromResponse`)의 400/409/410/422만 거절로 기록한다. 네트워크·시간 초과·로컬 413·401/403/404/429는 거절이 아니다.
  - binding_unverified 범위: 저장 기록의 binding을 검증할 수 없을 때만 해당한다. 현재 연결 정보 문제는 오류로 처리하고, 보관 사유가 되지 않는다.
- 시험:
  - tests/legacy-delivery.test.mjs 2건
  - tests/legacy-recovery.test.mjs 12건
  - local-recovery 제어기 3건 추가(RED 후 GREEN)
  - desktop-local-drain capability 기대값 갱신

### 2026-10-05 H4-4 실제 프로세스 강제종료·재시작 시험 (커밋 전)
- tests/desktop-process-kill.test.mjs와 tests/helpers/desktop-kill-child.mjs의 구성:
  - 자식 Node 프로세스가 실제 데스크톱 브리지(v1, 파일 outbox, claim journal)를 실행한다.
  - 부모의 임시 HTTP 서버(127.0.0.1 임의 포트)가 실제 Worker 코드를 감싼다.
  - 정해진 지점에서 자식을 SIGKILL(Windows TerminateProcess)로 종료하고, 새 프로세스가 한 번 tick한다.
  - 직접 띄운 자식만 종료한다. 4174/4175와 실제 연결기는 쓰지 않는다.
- 7개 지점:
  - 실행 중 종료 → 다음 프로세스가 `restarted` 실패를 보고한다.
  - 결과 저장 뒤 전송 중 종료 → 재시작 때 complete·ack 한 번씩 보내고, 재실행하지 않는다.
  - Worker가 결과를 적용했지만 응답 전 종료 → 재시작은 저장 receipt 재전송으로 끝나고, 작업은 변하지 않는다.
  - Worker 수락 뒤 ACK 전 종료 → 재시작은 ACK만 보낸다.
  - Worker가 receipt를 해제했지만 ACK 응답 전 종료 → 재시작 ACK는 멱등으로 끝난다.
  - claim 응답 전 종료(Worker는 claim 확정) → nonce로 owner를 확인하고 `restarted`로 보고한다.
  - claim이 Worker에 닿기 전 종료 → nonce를 닫고 claim 없이 끝난다.
- 각 지점에서 종료 직후 디스크 상태(journal·outbox phase)와 재시작 후 정리 상태(예약·receipt 0, 재시작 뒤 요청 순서)를 확인한다. 단순 객체 재생성 시험과 구분한다.
- 검증 반영:
  - 'close' 대기로 출력 누락을 막았다.
  - 시험마다 30초 제한을 두고, 자식이 먼저 끝나면 바로 실패한다.
  - 정리는 자식 종료를 기다린 뒤 재시도 삭제한다.
  - 요청 처리기 예외를 막았다.
  - 세 번 연속 통과했고 임시 폴더는 남지 않았다.
- 남은 시험하지 않은 지점: 임시 파일 쓰기 도중 종료, outbox 저장과 journal 정리 사이 종료(객체 수준 시험만 있음), 재시작 복구 중 재종료, 시작 스크립트 경로(잠금·준비 확인) 자체의 강제종료.
- 검증: 전체 1369건 중 1368pass/0fail/기존 symlink 1skip. git diff --check, Wrangler dry-run(자산 69개, 428.49KiB) 통과.

### 2026-10-05 H4-5 활성화 준비 문서 (활성화하지 않음)
- docs/DELIVERY-ACTIVATION.md에 다음을 정리했다.
  - gate 위치: Worker 기본 0. export default가 v1을 넘기지 않으므로 활성화하려면 설정 경로를 추가해야 한다. 데스크톱은 상수 0이다.
  - 협상 방식, 활성화 전 읽기 점검, 승인 후 순서, 되돌림 조건(outbox·journal·receipt 비우기와 이전 판독기 제약), 한계.
- receipt gate는 0을 유지한다. 실제 전환·배포·연결기 재시작·실구독 시험은 사용자 승인 대기다.
