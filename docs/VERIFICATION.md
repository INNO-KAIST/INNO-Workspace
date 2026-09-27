# 검증 기록 — 2026-09-13

- `node --test --test-isolation=none tests/*.test.mjs`: **65/65 통과**, 실패 0.
- 실제 ChatGPT 구독 로그인 → Node API → Codex 실행 → `INNO_SMOKE_OK` 응답 → 완료 체크포인트와 `final.md` 저장을 확인했습니다. 추가 실행에서 실제 `smoke.svg` 파일 생성과 파일 내용 수집도 통과했습니다. API 키를 사용하지 않았습니다.
- 테스트 실행 자료와 SQLite는 Git에서 제외한 `.inno` 아래에만 있습니다. 제공된 연구 폴더는 수정하거나 게시하지 않았습니다.
- 데스크톱 1440×960, 모바일 390×844 브라우저에서 수평 넘침 없음, 작업 생성·링크 연결·일시정지·역할 편집·재접속 기록 유지 확인.
- 동시 탭 생성/수정 충돌, SQLite/D1 CAS, 취소 후 늦은 결과 차단, 원본 내용 미저장, 안전한 파일 경로, 추출 한도와 UTF-8 경계 회귀 테스트 포함.
- Office 파서는 실제 ZIP 라이브러리로 검증했습니다. PDF 파서 연결은 주입된 테스트 계약으로 검증했으며 실제 모든 PDF 글꼴/레이아웃을 보증하지 않습니다.
- 2026-09-14 Claude Routine 실계정 왕복 실행 검증 성공. 생성 파일 2개와 최종 assistant 답변, completed 상태를 INNO API에서 확인했습니다. PC를 실제로 종료한 실험은 수행하지 않았습니다.
- GitHub Pages 공개 UI HTTP 200 확인. Cloudflare Worker 배포 후 비인증 상태 조회 401, 인증 상태 조회 200, D1 작업 생성·일시정지·재조회 성공 (`CLOUD_DURABLE_TASK_PASS`). 같은 API를 사용하는 기기끼리 상태를 공유합니다.
- 배포 서버: https://inno-workspace-api.innokaist.workers.dev . 2026-09-14 확인: cloud=true, localCodex=false, claudeRoutine=true.

검토 결과: [FINAL-REVIEW.md](FINAL-REVIEW.md). 운영 범위 및 한도: [BACKEND-REPORT.md](BACKEND-REPORT.md).

## 2026-09-14 데스크톱 연결 1차

- 전체 테스트 81개 통과. 경쟁 실행·재전송·취소·자료 변경·만료·프로세스 잠금·HTTP 인증 경로 검증.
- 실제 ChatGPT 구독 Codex 왕복 성공: 작업 602bf79f-9723-430b-9c6a-ec731e957925, 답변 INNO_CODEX_CLOUD_OK, final.md, completed 상태를 클라우드 API에서 확인.
- 첨부 없는 클라우드 작업 지원. 원본 재연결, 기존 로컬 기록 이전, 장기 단절 복구는 후속 범위.

## 2026-09-14 원본 재연결과 저장 결과 복구

- 전체 테스트 90개 통과. 인증·Origin·Host 제한, 원본 비전송, 경합, 만료 복구와 사용자 수정 차단을 확인했습니다.
- 실제 Codex 자료 실행: 작업 6cfde061-21e4-4697-aead-280f4b1e5a1e 완료, 답변 전력 단위: 와트(W), source-summary.md 생성. 원본 확인용 문자열이 클라우드 작업에 없음을 검사했습니다.
- 메모리 전용 UI fixture에서 실제 파일 선택 → 연결됨 표시 → 실행 → assistant 답변과 파일 표시를 확인했습니다. 실계정 AI 검증은 위 API 왕복과 별도로 수행했습니다.
- 장기 단절 복구는 시간 이동·경합 회귀 테스트로 검증했으며 실제 PC 종료 실험은 하지 않았습니다.

## 2026-09-14 기록 가져오기
- 실제 로컬 SQLite 조회 결과 이전 대상 0개. 사용자 기록을 불필요하게 복제하지 않았습니다.
- 실서버 검증 작업 912ad111-80fc-4b89-a02b-bf050c4c5a61: 첫 가져오기 created, 반복 skipped, 변경된 같은 ID conflict 확인. 결과 파일 보존 및 첨부 원본 확인 문자열 비저장 확인.
- 메모리 전용 UI에서 기존 로컬 기록 선택 → 체크 → 가져오기 → 가져옴 1 표시 확인.

## 2026-09-14 Interruption recovery

- 111 Node tests passed using node --test --test-isolation=none tests/*.test.mjs.
- Red-first regressions: Codex nonzero quota event, safe Claude 401/429, SQLite/D1 checkpoint preservation, native network errors, result retry without duplicate AI invocation.
- Independent review identified unavailable-runner checkpoint overwrite and coded-network bypass; both fixed and rechecked.
- Browser fixture: saved progress and separate quota guidance visible; fixture server and tab removed afterward.
- Worker deployed version 2f552957-4c29-497a-8df4-77e31baeb7df.
- Live authenticated synthetic task 4c69c65c-ea55-489e-b046-a28f014a4e08 verified checkpoint preservation, failure delivery idempotency, diagnostic exclusion, explicit resume; task cancelled afterward. AI invocations: zero.
- Desktop bridge restarted while idle. Real quota exhaustion and autonomous quota-reset resumption were not tested or claimed; automatic AI replay remains disabled.

## 2026-09-14 Bounded runtime output

- 121 tests passed. New cases cover 10,000 tool events, final answer and usage retention, split Korean JSONL, bounded diagnostic suffix, oversized single record, earlier actionable errors, first terminal failure, abort during overflow termination, and empty-only directory cleanup.
- Independent review found failure-selection and overflow/abort ordering regressions; both corrected and rechecked.
- Worker deployed version ad42c9b0-ae56-4baf-8ed5-64d5a592a9f4; desktop bridge restarted while idle.
- Real Codex subscription smoke task 262e7544-77a4-4fe4-9237-b05c80eb7251 completed with exact answer resource-check-ok, one persisted artifact, and zero remaining run folders for this task.
- The event collector retained under 500 characters in the synthetic long-stream test. This is a retained-output assertion, not an end-to-end speed or total process memory benchmark.
- Nonempty run directories remain intact. Child-process and tool memory/disk consumption are not globally capped by this change.

## 2026-09-20 Startup port conflict

122 tests pass. Real second launch at occupied4174 printed actionable guidance without a raw stack trace; existing authenticated desktop state remained HTTP200, idle and without pending output. Independent review found no material issues.4175 conflict closes only the lock newly acquired by that failed startup. No incumbent processes are terminated.

## 2026-09-20 Run storage management

-128 tests pass, including completed-run selection, metadata changes, junction exclusion, prevalidation of all targets, maintenance exclusion, pending-result protection, authentication and explicit deletion confirmation.
-Independent review found no material issues. Read-only inventory was subsequently placed under the same maintenance lock so it cannot delay an active runner heartbeat.
-Browser fixture verified usage/selection totals, protected items, file list expansion, confirmation-gated delete button, and confirmation reset when selection changes. No UI deletion was performed; filesystem removal tests used temporary fixtures only.
-Worker deployed version2b895cca-4fa7-4fae-b33b-7dddab01be11; idle desktop bridge restarted. Live read-only storage endpoint returned0 bytes,2 entries,2 completed eligible folders. User data deleted:0.
-Temporary UI server/script/tab removed after verification.

## 2026-09-21 Conditional state sync

- 134 tests pass, including retained task array on unchanged response, fresh connection metadata, out-of-order responses, overlapping revision responses, skipped SQLite/D1 task reads, and desktop cursor forwarding.
- Independent review found no material issues.
- Worker deployed version 3c5649b0-ca26-4eb4-9b59-03764ada6122; idle desktop bridge restarted.
- Live read-only check: cloud full13346 bytes versus unchanged188 bytes; desktop full13473 bytes versus unchanged315 bytes. Dynamic capabilities/presence/local status retained. These are response-body measurements for the current unchanged dataset, not overall speed or request-count benchmarks. No AI calls or user task mutations needed.

## 2026-09-21 — 선택 문헌 비교

- 전체 테스트 137개 통과(문헌 패킷·범위·재연결 식별·크기 검증 3개 추가).
- 격리된 메모리 서버 브라우저: 문헌 두 편 선택 → 초안/임시 자료 연결 → 작업 기록 확인.
- 실제 Codex 구독 실행: 가상 문헌 두 편으로 comparison.md, ideas.md, review.md 3개 저장. 작업 ID: 56a20cbf-9910-4076-a29e-d4488d9ef906. 실제 논문 연구 검증은 아님.
- 출력의 P1/P2, 10/20 W, 300/350 K, 반복 3/2회 및 조건 차이 한계 확인. 요청·대화·첨부 메타데이터에 가상 원문 미포함 확인.
- 검토 에이전트 호출 실패 후 작성 에이전트 자기검토로 완료; 독립 검토 성공으로 간주하지 않음. 자동 산출물 품질 판정은 후속 단계.
- Cloudflare 배포 ab370574-3142-45e5-ad2a-c25f5715ae30 및 배포된 모듈 응답 확인.

## 2026-09-21 — 문헌 결과 점검

- 5개 새 테스트: 정상/누락/빈 내용/중복/범위 밖 번호/선택 문헌 누락/이전 실행 제외/손상된 목록/base64/검토 실패(요약 포함).
- 실제 저장된 가상 문헌 결과를 임시 읽기 화면에서 확인: 문헌 결과 확인 필요와 검토 실패 경고 표시, 수정 요청 준비 클릭 후 초안만 생성. AI 재실행 없음.
- 코드 검토에서 발견한 실행 요약 실패 누락을 재현하고 수정함.
- 최종 전체 테스트 142개 통과, 구문 및 diff 검사 통과. Cloudflare 14c25d9e-a8c6-4a73-9769-e861c8513562 배포 및 최신 모듈 확인.

## 2026-09-21 — 별도 문헌 검토

- 전체 테스트 145개 통과, app 구문 및 diff 검사 통과. 자료 해시 불일치/이전 결과/누락/크기 초과를 차단하고 원문과 결과 내용이 요청에 저장되지 않음을 테스트.
- 화면에서 별도 검토 버튼과 원문 재연결 안내 확인. 코드 검토의 작업 유형 오인 및 자료 미연결 오류 안내 문제 수정.
- 실제 Codex 구독 검토: 원래 가상 작업 56a20cbf-9910-4076-a29e-d4488d9ef906 → 별도 작업 5fd5d991-4a80-4263-9e6f-c53f0e93bc3b. claims.md/review.md 실제 저장 확인. 약 5분 29초 소요. 재실행 없이 단일 검토 실행.
- claims.md의 수치/온도/반복 및 제안 구분, review.md의 한계와 수정안 확인. AI 판정의 전수 의미 검증이나 실제 문헌 검증을 의미하지 않음. 하위 호출 미사용은 실행의 자기보고이며 별도 도구 감사 증거는 보관하지 않음.
- 이전 하위 검토 호출의 상세 오류 원인은 미확정. 별도 실행 경로를 통한 복구를 검증했으며 기존 도구 오류를 수정했다고 주장하지 않음.
- Cloudflare 9cf63a0e-fcf9-44d4-8ec5-53672d75b919 배포 및 최신 모듈 응답 확인.

## 2026-09-21 — 합성·측정·분석 연결

- 전체 테스트 151개 통과. 실제 NanoLab serial/src.serial, Ledger lotId/Run/file, Prism native scalar 출력 필드에 맞춘 어댑터 테스트.
- 중복/누락/파일명 불일치, 계정·blob 필드 제외, 같은 크기 다른 연결표의 내용 해시, PA 하한·해상도·파워 단위 보존 확인.
- 가상 데이터 브라우저 화면에서 Run 선택 → 연결 확인 → 작업 준비 콜백 전달 확인. 실제 사용자 실험 자료나 실제 Firebase 계정 연동 검증은 아님.
- 로컬 Ledger HTML 원본 백업 후 내보내기 추가 및 인라인 스크립트 구문 검사 통과. 실제 로그인 상태의 내보내기 클릭은 미검증.
- 검토에서 발견한 첨부 충돌·파일 읽기/초기화 경합·Prism 필드 누락 수정. 입력 원본의 별도 영구 저장 및 추가 AI 실행 없음.
- Cloudflare b2d6e32d-0996-4911-9073-81a5ea923ad6 배포 및 최신 연결 모듈 응답 확인.

## 2026-09-21 — Ledger 없는 직접 연결

- 전체 테스트 152개 통과. Ledger 없이 시료·실험 ID로 연결, 기존 Run ID와 분리, 잘못된 시료/빈 실험 ID 차단 확인.
- 가상 자료 브라우저에서 NanoLab/Prism 두 파일만으로 시료 선택 → 연결 확인 → 작업 준비 전달 확인. 기본 화면에서 Ledger 필수 입력이 없음.
- 이전 JS 캐시로 구형 화면이 표시되는 문제를 확인하고 변경 모듈·스타일·진입점 주소를 갱신, 새 화면 확인.
- 코드 검토에서 추가 주요 문제 없음. 실제 사용자 연구 파일 검증은 아님.
- Cloudflare 614537d9-61cd-48d7-a278-f1a694e25ee4 배포 및 최신 진입점/모듈 확인.

## 2026-09-21 — 실행 사용량

- 전체 테스트 156개 통과. SQLite/D1 결과와 원자적 사용량 저장, outbox 재전송, 잘못된 카운터 제외, 취소된 실행의 늦은 사용량 차단 확인.
- 데스크톱 유휴·미전달 결과 없음 확인 후 브리지 재시작. 실제 구독 실행 255e6435-edb0-4c10-8d5f-f0dea413f26d 완료: 입력 14921, 출력 7 관측값 저장.
- 브라우저 사용량 화면에서 해당 값과 구독 잔여량 확인 불가가 분리 표시되는 것을 확인. 추가 실행 없음.
- Cloudflare 6c4639b6-9369-4042-9484-1f7d7bfb9b5d 배포. 후속 로컬 http 소유권 검증 수정은 Worker 번들 변경 없음.

## 2026-09-21 — 마스터 우선 모델 배정

- 전체 테스트 161개 통과. 지원 모델 조회 캐시/실패 fallback, 네이티브 동시 제한, 보고서 whitelist/크기·개수 경계, 최종 답변 파일 유지, Node/Worker Claude 계약 전달 검증.
- 실제 설치된 Codex model/list에서 Astra/Sol/Terra/Luna 지원 확인. 합성 letter-count 작업에서 네이티브 하위 호출 대기 이벤트와 4 반환 확인. Luna/low 선택은 실행기 자기보고이며 이벤트가 실제 모델 ID를 별도 제공하지 않아 runtimeVerified=false 유지.
- 이 테스트는 위임 기능 시험이며 토큰 절감률·연구 품질 동등성 검증이 아님. 짧은 작업에 위임하는 비용 때문에 기본 정책은 직접 처리.
- 리뷰에서 발견한 final.md 누락 및 배정 보고서로 인한 용량 초과 회귀 수정. Claude 실제 클라우드 실행은 별도 확인 필요.

- Cloudflare 86746fc8-db04-4a81-bc79-5410512b2d64 배포, 유휴 데스크톱 브리지 갱신 완료.
- Claude 실제 구독 Routine 합성 작업 b610ee6b-38a5-4a48-8112-b7ef2a652e81 완료. 위임 전 배정 체크포인트 → final.md → inno-model-routing.json → completed 반환 확인. 보고서는 inno-haiku 호출 및 4 반환을 자기보고하며 실제 서빙 모델 버전은 관측되지 않아 observedModel=null, runtimeVerified=false를 유지함. 연구 품질·절감률 검증은 아님.

## 2026-09-21 — 제공자 간 순차 인계

- 전체 테스트 169개 통과. 실행권 이전/늦은 결과 차단, 최대 2회 인계, 원문 첨부 차단, Claude 중복 시작 방지, 인계 직후 사용자 편집 경합, 제공자별 대기열, 생성 파일 안전한 전달, 자동 임대 만료 복구를 확인.
- 코드 검토에서 발견한 생성 파일 누락, 단절 후 outbox 정체, 인계 직후 사용자 편집에 따른 Claude 대기 정체 수정.
- 순차 인계이며 병렬 하위 작업 트리/자동 병합은 아님. 실제 구독 간 인계 검증은 배포 후 별도 기록.

- 최종 전체 테스트 170개 통과. Claude 콜백 도구 허용 목록의 handoff_task 누락도 테스트 후 수정.
- Cloudflare 6132eda7-99ed-4d7f-9948-f11da9a1d815 배포, 데스크톱 연결기 유휴 확인 후 갱신.
- 실제 구독 작업 ffd78d78-ed46-45c5-b532-7d19e212f177: Claude가 handoff-draft.txt를 저장하고 1회 인계 → Codex가 inno-handoff-001.txt를 읽어 정확한 내용과 20바이트를 확인 → 같은 작업에서 HANDOFF_OK: 4로 완료. 원문 첨부/웹 검색/하위 에이전트 없이 생성 파일 전달 시험.
- 역방향 Codex→Claude 자동 시작은 Worker 통합 테스트로 검증; 이번 실계정 시험은 Claude→Codex 방향에 한정. 인계 이력 UI는 구문 검사했으며 이번 단계에서 브라우저 시각 검증은 수행하지 않음.

## 2026-09-21 — 병렬 마스터 배포 후보

- 전체 Node 테스트 285개 통과. 실제 D1 계약을 SQLite로 실행해 원자적 배정, 완료 결과 보존, 검토 근거, 중복 콜백, 소유권 변경, 범위 제한, 모델 목록, 명시적 복구를 검증했다.
- 독립 코드 검토에서 원격 요청 응답 유실, 중단 후 중복 재실행, 만료된 실행의 직접 재획득, 불필요한 취소 작업 스캔, 배정 응답의 결과 노출, 수동 복구 예산 충돌을 찾아 수정했다.
- 가상 자료로 데스크톱 및 390x844 모바일 부모/하위 작업 화면, 실패 작업만 재시도, 완료 결과 유지, 종료 확인 체크 전 복구 버튼 비활성 및 확인 후 복구를 브라우저에서 확인했다. 실제 휴대폰 하드웨어·제스처 전수 검증은 아니다.
- 현재 두 하위 작업(Codex/Claude 각 하나), 원문 없는 배정에 한정한다. Claude 루틴 마스터 비용과 모델/사용량 관측 한계를 표시한다. 배포 및 실제 구독 검증은 다음 기록으로 구분한다.

## 2026-09-21 자료 부분 조회 로컬 검증

- source-views 분리 작업 폴더에서 전체 Node 회귀 테스트 312/312 통과(약 4초).
- UTF-8 문자 경계/BOM/바이트 합계, PDF 선택 페이지와 총 페이지, 해시 변경·범위 불일치 거부, 원문 미보관, 재연결 선택 보존, 비동기 미리보기 무효화 검증.
- 브라우저: 791KB 합성 텍스트의 510000–510022 구간을 선택하고 SELECTED_EVIDENCE_ONLY를 확인. 입력 변경 시 이전 저장 비활성화, 다시 미리보기 후 저장 확인. 390×844 세로 화면 확인.
- 실제 구독 실행·운영 배포 미실시. 병렬 마스터 릴리스와 기본 main 반영은 별도 승인 대기. 테스트 수는 운영 배포 또는 실제 모델 품질의 증거가 아님.

## 2026-09-21 산출물 제작 기준 공통화 (로컬)

Codex 및 Claude Routine 실행 프롬프트에 같은 deliveryPolicy를 연결했다. 문서/지원서/분석 Figure/발표자료/문헌별 사실·근거·편집 가능성·렌더링 검사 항목을 제공하며 최신 사용자 형식을 우선한다. 하위 고정 과업에는 전체 부모 산출물 의무를 강제하지 않는다. 실패와 미실시 검사를 구분하고 도구 부재를 숨기지 않도록 지시한다.

검증: 전체315/315, 추가 전송 경로 포함34/34 통과. 이는 프롬프트 전달의 증거이며 실제 문서 생성·렌더링·내용 품질 검증 완료의 증거가 아니다. 다음 작업은 결과물별 검사 증거 계약, 저장 및 UI 표시, 실제 생성 파일과 렌더링 결과를 사용한 검증이다. 운영 배포는 아직 하지 않았다.

## 2026-09-21 결과 파일별 AI 검사 기록 (로컬)

결과 artifact에 선택적 checks 배열을 추가했다. 항목은 check/status(pass,fail,not_run)/evidence이며 최대20개, 총30KB로 제한한다. 미확인 권위 필드는 버리고 비어 있는 근거는 거절한다. Codex 구조화 응답 및 생성 파일 materialization, Claude artifact_task schema, SQLite/D1 완료 저장, 작업 artifact action 및 가져오기에 연결했다. 결과 목록에서 AI 보고 요약과 펼침 근거를 표시한다. 기록 없는 기존 파일은 검사 기록 없음으로 표시한다.

전체320/320 테스트 통과. 추가 Codex 응답 및 양쪽 저장소/내보내기 테스트34/34 통과. 브라우저 시각 검증과 실제 DOCX/PPTX/PDF 렌더링 증거 대조는 아직 하지 않았다. AI의 자기 보고는 독립 검증 또는 품질 인증으로 취급하지 않는다. 운영 배포 미실시.

## 2026-09-21 Office 결과 컨테이너 검사 보강 (로컬)

기존 Office 검사는 PK 시작 문자만 확인해 위장된 짧은 데이터를 통과시켰다. 공통 검사로 DOCX/PPTX/XLSX의 ZIP 종료 목차·파일 개수·범위·로컬 헤더 일치·중복/위험 경로·필수 패키지 부분을 확인한다. 암호화/다중 디스크/ZIP64 및 과도한 선언 해제 크기는 현재 지원하지 않는다. 컨테이너 검사는 압축 해제나 렌더링 없이 수행한다.

Codex 결과 회수, 작업 artifact action, SQLite/D1 완료 처리에 적용. 잘못된 파일은 완료 상태 저장 전에 거절한다. 전체322/322 및 추가 양쪽 저장소 거절 시나리오 포함33/33 검증 통과. 기존 PK-only 테스트 데이터는 실제 ZIP 목차가 있는 합성 패키지로 교체했다. 합성 패키지 테스트는 실제 Office 앱 렌더링 증거가 아니다.

검사 범위 밖: 압축 본문 CRC/내용, XML 의미와 관계 그래프, Office 호환성 및 실제 페이지·슬라이드 렌더링. PDF/PNG 검사는 기존 헤더 수준이며 추가 작업이 필요하다. 운영 배포 미실시.

## 2026-09-21 관측 사용량 이력 (로컬)

checkpoint.usageHistory에 작업별 최근100회 완료 실행을 보관한다. provider/executionId/generation으로 중복을 제거하며 기존 마지막 usage를 첫 이력으로 승계한다. 다음 완료에 사용량이 없으면 이전 관측값을 보존하고 새 기록은 null로 저장한다. 화면은 하위 작업 포함 제공자별 보관 관측 합계, 입력/출력 미보고 건수 및 최근50회 기록을 표시한다. 작업 가져오기는 실행 권한을 복원하지 않고 정제된 이력만 유지한다.

전체326/326 및 이후 양쪽 저장소 연속 실행/가져오기 관련11/11 통과. 화면 시각 검증은 후속이다. 숫자는 보관된 완료 실행의 보고 합계로, 전체 수명 누적·구독 잔여량·실시간 스트리밍이 아니다. 실패/중단 및 마스터 위임 전 단계 등 사용량 미전달 경로는 여전히 추가 구현이 필요하다. 최근100회 초과 자료를 이력에 무한 축적하지 않는다. 운영 배포 미실시.

## 2026-09-21 마스터 전환 사용량 보존

위임 allocation, 검토 실패 후 bounded retry, 순차 provider handoff에서 실행 소유권을 해제하기 전에 원 제공자의 관측 usageHistory를 저장한다. 데스크톱 complete→delegate 변환에서 누락되던 usage를 전달한다. 동일 allocation/retry 재전송은 이력을 추가하지 않는다. Claude 도구 스키마는 실제 보고된 값만 선택적으로 허용하며 추정을 금지한다. 화면 문구도 완료·전환 기록으로 정정했다.

전체330/330 통과. 원 제공자 귀속 및 재전송 중복 방지 검증 포함. 사용자 결정 대기·실패·중단 사용량, 실행 중 스트리밍 및 제공자 자체 미보고 수치는 후속이다. 운영 배포 미실시.

## 2026-09-21 실패·결정 대기 사용량 보존

Codex 실패 이벤트가 실제 반환한 카운트를 안전한 오류 객체에 보존한다. 정상 이벤트 뒤 결과 검증이 실패해도 이미 관측한 사용량을 전달한다. 로컬 HTTP와 데스크톱 outbox는 정제된 카운트만 전달하며 진단 텍스트/임의 필드는 제외한다. SQLite/D1 failExecution 및 requestDecision에서 소유권 검증 후 이력을 저장한다. Claude 결정 도구는 관측값 선택 입력을 허용한다.

전체332/332, 이후 실행기·outbox·저장소 관련50/50 통과. 늦은 이전 실행 실패가 새 소유자의 이력을 변경하지 못함을 검증했다. 강제 중단/출력 제한으로 collector가 결과를 반환하지 않은 경우, 미보고 Claude 사용량 및 실행 중 스트리밍은 여전히 제공되지 않는다. 사용자 결정 대기 화면과 사용량 화면 브라우저 검증은 후속이다. 운영 배포 미실시.

## 2026-09-21 검사 근거·사용량 화면 브라우저 검증

외부 앱/AI 실행기를 연결하지 않은 로컬 미리보기4186에서 합성 작업 JSON을 실제 파일 선택으로 가져왔다. 결과 목록의 AI 보고(통과1/실패1/미실시1), 근거 펼침, 독립 인증 아님 안내를 확인했다. 사용량 화면에 Codex1200/300, Claude미보고가 0 대신 확인 불가 및 미보고1회로 표시됐다.

390×844에서 사용량 합계와 기록 카드, 상세 패널의 검사 근거를 스크롤하며 시각 확인했다. 문서/body너비390으로 가로 넘침 없음. 콘솔error없음. 닫힌 모바일 drawer가 접근성 트리에 남는 결함을 발견하여 visibility로 숨기도록 수정했다. 새로고침 후 닫힌 메뉴/상세 버튼들이 접근성 트리에서 제외되고 열면 다시 노출되는 것 확인. 실제 휴대폰 하드웨어 제스처·전체 스크린리더 여정 검증은 아님. 합성 결과이므로 실제 AI 문서 품질의 증거가 아님.

## 2026-09-21 実행 가능한 산출물 검사 도구

scripts/verify-deliverable.py 추가: Office CRC/XML 검사 및 선택적 PDF 렌더링. Codex/Claude 프롬프트에 경로와 사용법 연결. Python4/4,Node332/332통과. 합성1pagePDF 실제 렌더링 및 이미지 확인(텍스트/12.5값,잘림없음). 처음 실행에서 PdfPage context-manager 비지원 발견 후 명시적close로 수정하고 회귀 테스트 추가.

Office 실제 렌더러 미확인으로 page/slide검사는 not_run. 실행기 자동 강제 검사나 실제 문서 전체 품질 보장은 아님. 자세한 실행조건·한계는 DELIVERABLE-VERIFICATION.md참조. 운영 배포 미실시.

## 2026-09-21 실제 Codex 구독 PDF 통합 시험

새 API 없이 설치된 Codex 구독 CLI로 외부 자료 없는 합성1pagePDF 요청을 실행했다. 하위 에이전트·웹·설치·원본 읽기를 금지한 한정 시험이다. 실제 실행기 완료 및 report.pdf 회수, Office/PDF검증helper실행,검사3개 반환 확인. 회수 base64와 디스크PDF바이트가 동일함을 비교했다. 메모리SQLite완료 경로를 통과하며 checks와usage가 보존됨을 확인했다. 생성 미리보기를 별도로 열어 제목/합성표시/Expected numeric value:12.5가 잘림없이 보이는 것을 직접 확인했다.

실행기 보고:inputTokens88024,outputTokens848. 캐시·청구·계정차감 정보는 이번 보고에 없으므로 실비 또는 토큰 절약 효과로 해석하지 않는다. 작은 작업 대비 입력 보고가 커서 반복 문맥·캐시 계측·라우팅 효율 검토가 필요하다. 동일AI작업을 반복 호출하지 않았다.

생성물과원시결과는gitignored .inno/live-deliverable에만 보관. 운영DB/Worker변경없음. Claude클라우드·양제공자 병렬실행·실제 연구문서/발표자료 품질까지 검증한 것이 아니다. 기본main/운영배포 승인대기는 별도 유지.

### 2026-09-21 — cached input observation

- Preserve Codex `cached_input_tokens` through bounded event collection, successful/failed runner results, normalized execution usage, SQLite/D1 checkpoints and retained history.
- Optional `cachedInputTokens` is a reported subset of total input, never added to it. Reject negative/unsafe or greater-than-known-input values; missing reports remain unknown. The shared MCP contract accepts this normalized count for either provider, without inventing a Claude report or assuming provider-native field semantics.
- Usage UI shows cached observations and missing-record counts. This is not billing, subscription balance, or proof of savings.
- Official event reference: https://learn.chatgpt.com/docs/non-interactive-mode (JSON stream example). Ephemeral runs deliberately do not retain session rollouts; the prior 88,024-input-token PDF smoke cannot be retrospectively split into cached/noncached counts.
- Verification: 336/336 Node tests pass, including collection, runner success/failure and both persistence backends. No additional AI execution, paid API call, production migration or deployment. Cached UI layout has not received a new browser visual check.

### 2026-09-21 — abort ownership lifetime

- Reproduced: ordinary cancellation resolved the runner immediately after SIGTERM request, before the child close event. The desktop bridge could therefore drop busy ownership while its previous process remained alive.
- Fix: ordinary abort now retains the runner until close, matching output-limit teardown. A failed termination signal for an existing PID also does not prove exit and cannot release the slot. No timer declares an unobserved process dead.
- Verification: 339/339 Node tests pass. Tests cover ordinary abort, signal error, and an integrated bridge/runner lease-loss sequence that rejects a second claim until child close and never delivers stale output.
- Scope: deterministic process-event tests, not a live AI kill or OS descendant-process guarantee. A child that never exits keeps the slot busy and requires operational investigation; this intentionally avoids overlapping execution. Original desktop process and deployment were not changed.

### 2026-09-21 — acknowledged writes and reconnect

- Reproduced: successful task create/action followed by a failed refresh rejected the whole client operation. The composer retained its original request despite confirmed server storage, inviting duplicate creation on retry.
- Client now applies acknowledged task/version immediately, fences earlier refresh responses, and treats subsequent read failure as a sync warning. Reconnection clears the warning. Unacknowledged writes still fail; no client-side task is invented.
- UI distinguishes a latest-state lookup failure from a claim that all changes were unsaved.
- Verification: 344/344 Node tests pass. Two real HTTP clients against the local server demonstrate create acknowledgment + simulated read outage, concurrent direction from the second client, stale-version rejection, reconnect and convergence, with exactly one create.
- Scope: this is not two physical devices or mobile gesture verification. Loss of the POST response itself remains ambiguous and needs idempotent request handling; no automatic offline submission queue was added. Production unchanged.

### 2026-09-21 — idempotent creation after lost response

- Optional UUID requestId maps to a deterministic task ID. Creation stores a hash of normalized initial prompt/title/type/attachment metadata, not a second raw payload. SQLite transaction and D1 atomic insert-on-conflict ensure a replay returns the current task without incrementing revision; changed payload with the same key conflicts. No new database table or migration is needed.
- Browser retains at most 16 unresolved hash/UUID pairs in sessionStorage scoped by a hash of endpoint and credentials. No source bytes, prompt text or token are stored. Confirmed results clear the pair; definite rejection clears it; network uncertainty or malformed acknowledgment retains it. Without storage, the fallback is memory-only.
- Verification: 352/352 Node tests. Real local HTTP commit followed by deliberate response loss, client reconstruction and retry yields exactly one stored task. SQLite/D1 replay after a later message preserves the current version. D1 concurrent test serializes fake batch execution to match atomic transaction behavior. Invalid key, mismatched content, ledger cap, credential isolation and malformed acknowledgment are covered.
- Limits: same tab/storage + endpoint/auth + equivalent normalized create content. Tab/storage loss or changed content is not covered. Task deletion/import does not preserve this identity protocol. Existing clients without requestId retain previous create semantics. Backend must be upgraded before new frontend; production deployment remains pending approval. No live Cloudflare mutation or AI call was needed.

### 2026-09-21 — required source completeness and collaboration design

- Found and reproduced: an ordinary attachment without a saved selected view could be omitted from materials and pass the common execution verifier. Selected views were already checked.
- The common verifier now requires each local attachment path/name exactly once, rejects extra material and ambiguous required names, and preserves selected coverage/hash checks. Root calls that explicitly provide transient materials without attachment metadata keep their existing behavior; this is not an authorization expansion for child/review runners.
- Verification: 354/354 Node tests pass, including missing/duplicate/extra source cases and a real runner-boundary test asserting no Codex spawn on omission. No live AI or production mutation.
- Source-backed delegation is still disabled. Its cross-layer design and task sequence are in docs/superpowers/specs/2026-09-21-transient-source-delegation.md and docs/superpowers/plans/2026-09-21-transient-source-delegation.md. Only Task 1 prerequisite is implemented. The plan explicitly includes provider routing, source-aware queue scanning, reviewInputs, reconnect UI, ambiguous launch handling and actual mixed-provider verification.

### 2026-09-21 — gated source assignment contract

- Internal sourceDelegationVersion=1 permits validated child sourceIds referencing parent attachment metadata. Default-off validation, model-result parsing and MCP advertisement remain source-free; request payload cannot enable the server option. No production constructor currently opts in.
- Copy only sanitized selected references into child attachments, preserve selected view hashes, and record selected IDs in review metadata. Reject unknown/duplicate IDs, ambiguous paths, URL references, excessive sources, injected materials and sourceBound executions without reconnectable references.
- D1 allocation/replay and injected transaction failure are verified. Failure leaves no child or parent transition. Entire Node suite: 361/361 pass.
- Planning correction: managed allocation lives in D1; standalone SQLite store does not currently implement this coordinator. D1 tests use SQLite as an emulator; this does not imply standalone SQLite delegation support.
- This is not an enabled source collaboration feature. Source-aware queue scanning, direct child/review execution, planner instructions, reconnect UI and live provider verification remain in Tasks 3-5. No source-bearing job was dispatched or deployed.

### 2026-09-21 — source-aware dispatch and gated direct execution

- Automatic Claude dispatch returns source-dependent queued children/reviews unchanged. Desktop query excludes attachments before LIMIT, so such tasks neither consume a lease nor block later source-free work. No synthetic retry/epoch transition is created for missing originals.
- Internal sourceDelegationVersion=1 permits direct queued source child/review starts through existing owner/provider/epoch checks. Both runner adapters accept sources only with this gate and declared attachments. The default runtime remains off.
- Ordinary roots with attachments added after queueing remain queued; their UI run button and direct desktop start allow reconnection rather than leaving them locked. This intentionally replaces the old automatic waiting_connection transition.
- Direct Codex review already hydrates child generated artifacts; the new test verifies that endpoint with originals required. Claude review uses its manifest and scoped read_task for child generated files; the transient original is included only in its execution prompt.
- Verification: 371/371 Node tests. Worker requests use mocked Routine responses and runner process events, not actual AI. Missing sources prevent fire, replayed stale launch cannot fire again, source text is absent from stored task state, and generated evidence remains available for both review transports.
- Remaining: planner/source-capability wiring, source-specific ambiguous-start recovery and browser source coordinator/reconnect UI, actual provider journey and release approval. No operational deployment or live source transfer performed.

### 2026-09-21 — source-aware master policy and server capability

- Both master prompts can now describe source-scoped assignments when internal version 1 is enabled and reconnectable parent references are valid. Only sanitized reference metadata is listed; unsupported/URL references keep the direct-work policy. Existing source-free fallback remains default.
- Codex result validation preserves selected IDs and resolves them against parent references before returning a delivery result. Unknown IDs fail before outbox delivery. Worker runtime forwards its internal version into allocation, Routine prompt and MCP schema, and reports it in /api/state capabilities.
- Verification: 376/376 Node tests. A mocked Codex master returns scoped assignments without original text in the returned result; unknown IDs reject. Mocked Claude root prompts and state capability agree at versions 0 and 1. No actual AI call or deployment.
- Server capability alone does not establish desktop-runner compatibility. Desktop capability intersection, browser coordination, ambiguous-start and source-specific pause recovery tests remain before activation. Default constructors stay at version 0.

### 2026-09-21 — desktop source capability intersection

- Codex runner exposes its configured supported source version. The desktop bridge reports that value on direct start, disregarding browser-supplied overrides. Cloud start intersects it with server support and rejects source child/review claims before ownership changes if incompatible.
- The execution receives only the common version. Missing/legacy capability falls back to 0; an enabled local runner cannot infer server support. Ordinary root source execution remains supported without source delegation.
- Local /api/state exposes desktopSourceDelegationVersion as the intersection for the upcoming browser coordinator, while preserving independent server support metadata for Claude.
- Verification: 382/382 Node tests, including all four local/server version combinations, a browser override attempt, a source child left queued after incompatibility rejection, runner downgrade rejection and actual local HTTP capability responses.
- No deployment or production process restart. Default source-delegation configuration remains off; browser coordinator/reconnect and source-specific ambiguous-start recovery still pending.

### 2026-09-21 — shared browser material preparation

- Extracted source preparation from the ordinary run handler into prepareTaskMaterials. It snapshots reference metadata, checks connection/count before reads, verifies task currency before/after async operations, keeps the 600,000 UTF-8 byte budget and 20-file limit, and validates exact saved views before returning transient materials.
- Ordinary run now also rejects a task-version or client change during source reading, not only switching the selected task. No source cache, archive or durable outbox is introduced.
- Verification: 388/388 Node tests. Actual File objects prove exact selected byte-window extraction and rejection of same-size changed content. Delayed file reads/extraction prove stale material is not returned. Source references are unchanged and limits reject before unnecessary reads.
- This is the shared input path, not the completed browser coordinator. Child/review readiness, parent epoch checks, automatic dispatch, ambiguous acknowledgments and reconnection UI remain pending. No new browser visual check or live AI run performed.

### 2026-09-21 — source coordinator core checkpoint (paused at user request)

- Added sourceExecutionReadiness and an in-memory SourceExecutionCoordinator. Provider comes from the stored child assignment or master review. Required source connections and capability intersections gate reads.
- Snapshot checks fence task version, parent version/phase/epoch, and authenticated client identity. A fresh state read is required immediately before submission. One invocation runs at a time.
- An attempted POST is held after ambiguous acknowledgment; repeated ticks do not automatically retry it. Source errors are held until explicit reconnect. Retained records contain identifiers, versions and status only, never extracted text or exception messages. The queue of retained records is bounded at 100 and fails closed at capacity.
- Verification: 397/397 Node tests, including 9 coordinator unit tests for reconnection readiness, duplicate refresh, parent pause/epoch change, client change, lost acknowledgment, fresh server pause, review provider selection, cleanup and avoiding repeated failed reads.
- This module is deliberately NOT wired into the browser yet. Remaining work: UI/reconnect integration, account-switch lifecycle, safe explicit recovery, reload/tab-loss behavior and real HTTP race/recovery tests. In-memory uncertainty holds alone do not establish reload safety. Default source delegation remains disabled. No main push, deployment, browser journey or new live AI run.
- User requested stopping after this substep due to weekly token usage. Resume subsequent work Sunday afternoon (2026-09-27, Korea); exact time or manual resumption awaits reply. Do not start the next substep before then.

### 2026-09-23 — durable source coordinator lifecycle

Account-scoped hashed journal keys retain bounded metadata only. Short Web Locks serialize updates across tabs. Unavailable/corrupt storage and duplicate task IDs fail closed. Reconnect only clears source extraction failures; explicit recovery requires fresh authoritative version advancement, released ownership and readiness. Client/session changes invalidate extraction. Independent Sol 6.0 verification found and confirmed the duplicate-ID repair; latest full Node suite 411/411 passes. UI integration and real HTTP race/browser journeys remain W2/W3; this does not claim complete source collaboration or enable its default gate.

### 2026-09-23 — source reconnection UI

W2 connects source readiness/status to browser refresh, preserves locked assignment descriptors/views on reconnection, and invalidates file/directory picks across task/account changes. Account change clears original-file sessions. Default source gate remains off. Independent Sol 6.0 review found no blocking issue; full Node 418/418 passed before final text-only UX changes, then related 7/7 and app syntax/diff checks passed.

Local browser evidence used loopback Worker routing with memory TestD1 and mocked Claude fire: parent showed missing sources and assigned models; matching file reconnected without changing scope; Claude child reached running/version3; reload preserved running state and requested local-original reconnection. 390x844 detail panel showed readable reconnect cards/buttons; no console errors. Test-only tab/server were closed and viewport reset. This does not prove full mixed-provider completion, real-provider execution, race recovery or production deployment; those remain W3.

### 2026-09-27 — source HTTP ownership/recovery integration

Added seven cases across source-collaboration-http and source-bridge-recovery tests using loopback HTTP, actual Worker routes/bridge, memory TestD1, and mock model execution. Evidence covers disjoint source references, Claude transient source text, required master source names and generated review inputs, deterministic same-version pre-CAS contention, parent-pause invalidation, lost start acknowledgment/coordinator recreation, explicit recovery preserving completed siblings, accepted completion response loss with retained outbox replay and a single runner invocation. Seeded expired source leases additionally require explicit recovery and reject obsolete owner writes afterward.

Independent review verified the first six cases and full424/424; main added the bounded expired-state case and verified full425/425. Python artifact checker4/4 and Wrangler dry-run passed after organization migration integration. Default source delegation stays disabled; no production deployment. These tests do not establish live model quality, real desktop original rereading, filesystem outbox persistence, process-restart durability, or natural elapsed-time expiry. The in-memory box test is named retained outbox replay accordingly. Active deployment checkout must be based on current rewritten origin/main; do not force-push historical branch ancestry.

### 2026-09-27 — real file outbox process boundary

Extracted the existing production file outbox unchanged into server/file-outbox.mjs. Two actual Node child processes share that module: the first retains a generated completion and exits; the second retries transmission without runner execution or polling. Failed delivery keeps the file, successful delivery deletes it, and malformed JSON blocks execution while preserving the file. Final complete Node suite: 427/427 (.inno/w3-outbox-tests.log); targeted final check: 2/2; diff check passes.

This establishes normal process restart replay. It does not establish power-loss/fsync durability, nor does the mocked transport establish server acceptance; the earlier HTTP bridge test covers accepted completion with lost response separately. Live subscription source review and release verification remain pending. Default source delegation is still disabled and production has not been updated for this milestone.

### 2026-09-27 — bounded live Codex source review

One real ChatGPT-subscription execution through createCodexRunner completed successfully (session 50939, exit 0). The account catalog reported its configured default gpt-6-astra; the test did not hard-code a model. Two synthetic original materials contained 37.2 mW and 8.4 ms, while completed-child summaries/artifacts contained conflicting 42.0 mW and 6.1 ms. The task prompt and acceptance criteria did not contain the correct values. The returned summary and review-findings.txt correctly used both originals and identified both child errors; two exact review criteria passed. Main read the resulting JSON independently.

Evidence: .inno/source-live-review.mjs and .inno/tmp/source-live-review/result.json (local synthetic fixtures, not published). Reported usage: input 36,970, output 716, cached input 30,592 tokens; cached input is not added again to input. No paid API, production DB mutation, or other INNO integration was used. This proves original-material consumption by the real master runner, not real Claude execution or end-to-end cloud mixed-provider delivery. Identical child summaries and file contents mean the artifact's file-only contribution is not independently isolated. No repeat AI execution was performed.
