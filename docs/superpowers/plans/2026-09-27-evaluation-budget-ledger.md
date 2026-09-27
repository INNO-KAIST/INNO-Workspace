# Comparison execution budget ledger Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** MOD-06 추가 비교 실행의 기본 0회·횟수·시간 한도를 중복/경합/재개에도 보존하는 내부 예약 기록을 구축한다.
**Architecture:** 비교 job별 불변 한도와 실행별 예약/정산을 순수 상태 전이로 표현하고 D1/SQLite CAS에 보존한다. 이 단계는 내부 기반이며 실제 비교 작업 생성·claim/runner·UI 연결 완료를 뜻하지 않는다.
**Tech Stack:** 기존 JavaScript, Node, SQLite, Cloudflare D1. 추가 도구 없음.
**Spec:** docs/PRD.md MOD-06, MOD-03/04의 검증 근거 제약.

## Global Constraints
- 추가 유료 API 금지. 기존 구독. 기본 추가 평가 예산 0회.
- 정상 작업 사용량과 추가 평가를 구분. 미보고 시간/토큰을 0으로 처리하지 않는다.
- 실행 불확실 시 예약을 돌려주거나 재시작하지 않는다. 원문 별도 영구 저장 금지.
- Claude Routine 공개 fire API는 text 입력과 session 반환만 문서화한다. 시간 제한/원격 종료 보장은 확인되지 않았다: https://platform.claude.com/docs/en/api/claude-code/routines-fire (2026-09-27 확인).
- 기존 2-child 위임은 Codex+Claude 독립 업무 분담이다. 동일 입력 기준선/후보 비교를 대신하는 것으로 사용하지 않는다.

## Review Focus
- 마지막 1회 잔여 예산을 두 실행기가 동시에 사용하려는 경우 단 하나만 예약.
- 서버 재시작/응답 유실 뒤 동일 실행 재전송은 추가 차감 없음. 다른 내용으로 ID 재사용은 충돌.
- 확인되지 않은 종료나 executor 자기보고로 남은 시간을 부풀리지 않음.
- 예산 감소·시계 역행·기간 초과를 정상 완료/환불로 위장하지 않음.
- 비정상 저장 상태/무제한 job 및 예약 누적을 제한하며 활성 예약을 자동 삭제하지 않음.

## Task 1: 순수 예약 및 정산 계약
Files: public/core/evaluation-budget.mjs, tests/evaluation-budget.test.mjs.
- [x] RED: 기본 maxExecutions=0/totalDurationMs=0 예약 거절; 1회·100ms 한도에서 두 번째 ID 거절.
- [x] 구현: createEvaluationBudget({jobId,maxExecutions=0,totalDurationMs=0}), reserveEvaluation(state,{executionId,generation,phase,maxDurationMs},{now}), settleEvaluation(state,{executionId,generation,elapsedMs},{now}). phase는 master/baseline/candidate/review/retry/handoff. 한도 최대100회/86,400,000ms, 예약은 1ms 이상·남은 시간 이하.
- [x] 횟수는 예약마다 소비하고 반환하지 않는다. 예약마다 최악 시간 전체를 선점. 동일 실행/세대/phase/시간 한도 재전송은 변경 없음; 내용 불일치는 거절. 예약 시각과 종료 예정 시각 기록. 정산은 신뢰된 종료 후 실제 경과 시간으로만, 알려진 0은 허용하되 null은 정산 불가. 한도 초과 실행은 overrun을 보존하고 이후 예약을 차단한다.
- [x] GREEN: 경계값/시계 역행/overflow/중복/완료 후 재전송/초과 실행/누락 종료/총합 회귀. 관측 시간은 토큰 비용이나 모델 품질 증거가 아니다.

## Task 2: D1/SQLite 영구 기록
Files: worker/evaluation-budgets.mjs, server/evaluation-budgets.mjs, tests/evaluation-budgets.test.mjs.
- [x] RED: 동일 job 생성 재전송/다른 한도 충돌, 마지막 잔여 동시예약 한 건만 성공, 디스크 재시작 후 예약 유지.
- [x] 구현: 내부 create/read/reserve/settle 메서드, expectedStateVersion CAS. job 한도 불변; 32 job/상태256KiB/예약100건 상한. 원문이나 임의 평가 점수 저장 금지. settle은 생성자 verifyCompletion 콜백으로 실제 실행 종료 근거를 받아 정산하고 요청의 elapsedMs/품질 플래그를 수용하지 않는다.
- [x] raw 상태+합계+ID 유일성 검증. read에는 now가 아닌 저장 상태만 사용. revision 증가와 예산 기록은 원자 처리. 종료 미확인 예약은 시간 만료만으로 해제하지 않는다.
- [x] GREEN: D1/SQLite parity, CAS stale, 종료 verifier 없음/불확실 거절, 용량 한도, 실제 SQLite close/reopen, 기존 정책 metadata 영향 없음.

## Integration obligations (다음 하위 단계의 필수 범위)
- 비교 작업 생성 API는 고정 입력/평가 기준/기준선과 후보를 저장하고 서버 소유 budget jobId를 부여한다. 일반 작업/import/model출력의 jobId 위조를 거절한다.
- 실제 claimExecution과 예산 reserve는 하나의 transaction/CAS로 결합해야 한다. 별도 reserve 후 claim하는 두 커밋 방식은 금지. 위 내부 ledger 단독 API를 외부 실행 허가로 쓰지 않는다.
- 모든 추가 AI 실행(마스터·기준선·후보·검토·재시도·handoff)은 실행 전 예약한다. 예산 소비는 Token 정확 계측이 아니며 횟수/보수적 시간 한도이다.
- Codex 종료 타이머/실제 프로세스 close/실행기 capability handshake 및 시작 시한 확인을 연결한다. 시작 불확실·정지 미확인은 예약 보존하고 다음 실행을 막는다.
- Claude 시간 종료 capability 미확인 경로는 비교 시작 보류. 단순 시작 허용 기간을 총 실행시간 한도로 바꾸어 주장하지 않는다. 범위 변경이 필요하면 CHANGE_REQUESTS로 사용자 결정에 올린다.
- 비교 완료는 동일 입력·기준·실행 소유권으로 독립 검토 근거에 연결한다. 실제 모델 버전 미확인 시 승격 금지 유지. UI에 예산·소모·예약·초과·보류 이유 제공. 이 연결 전 MOD06 완료/활성화/배포 금지.

## Verification
승인 명령 node --test --test-isolation=none tests/evaluation-budget.test.mjs tests/evaluation-budgets.test.mjs, 그 뒤 전체 tests/*.test.mjs 및 기존 Wrangler dry-run. TEMP/TMP=.inno/tmp. 메인 통합과 별도 리뷰, 실제 AI 없이 fixture. 확인 후 PROGRESS 기록 및 개발 브랜치 커밋.


## Task 3: 실행권과 예산의 단일 원자 결합 (내부 기반 완료)
Files: worker/store.mjs, server/store.mjs, public/core/evaluation-claim.mjs (공통 계약), public/core/delegation.mjs 좁은 우회 방지, 전용 atomic-claim 테스트.
- [x] internal attachEvaluationBudget(taskId,{jobId,phase,maxDurationMs,expectedVersion})는 신선한 ready 작업을 기존 원장에 결합한다. task→불변 job 한 개, job→여러 phase 작업 가능. 일반 create/import는 표식 위조 불가.
- [x] claimExecution의 기존 소유권/제공자/부모 검사를 유지한다. 묶인 작업은 Codex와 executionBudgetVersion=1이 필요하며 현재 운영 실행 경로는 해당 능력을 아직 보고하지 않는다. provider/시간예산 면제 입력을 허용하지 않는다.
- [x] 실제 생성 executionId/generation으로 reserveEvaluation을 계산하고 checkpoint에 서버 생성 jobId/phase/maxDurationMs/deadlineAtMs 보존. ledger와 task의 읽은 상태를 모두 CAS 검사. D1 단일 batch, SQLite BEGIN IMMEDIATE transaction으로 task owner·ledger·revision을 저장.
- [x] 마지막1회에 두 작업 경합, task/ledger 각각 중간 변경, SQL 실패, 재시작, 같은 요청재전송/구버전 충돌을 검사해 단독 차감/단독실행권이 없음을 입증.
- [x] 비교 작업의 기존 일반2-child 위임은 거절한다. 마커 없는 자식의 구독 실행으로 예산을 우회하지 않는다. 같은 task의 재개는 표식을 유지하고 다음 claim에서 이전 종료 정산을 요구한다. 일반 handoff는 전용 비교 전환 구현 전 거절한다. 전용 비교 workflow를 대체하지 않는다.
- [x] 대상 테스트·독립검토·전체 회귀·dry-run 후 기록. 실제 runner/세션 종료 검증 및 capability handshake 이전에는 외부 API/UI에서 비교 작업을 시작하지 않는다.

## Task 4: Codex 실행 기한과 로컬 종료 관측 (내부 실행기 완료)
승인 MOD06의 실제 실행기 연결을 위한 필수 작업. 로컬 프로세스 close는 하위 프로세스 전체 또는 원격 추론 중단 증거가 아니므로 capability 광고/정산 근거로 승격하지 않는다.
- [x] server/runners.mjs와 필요 시 server/execution-deadline.mjs에 서버 claim checkpoint의 job/phase/owner/maxDuration/deadline를 검증하는 내부 기한 처리 연결. bound 실행은 명시적 내부 budget version1 요청만 허용. 기한이 지났거나 일관성 없는 claim은 spawn 전에 거절.
- [x] 준비 작업 중 소모된 시간도 계산하고 spawn 직전 재검사. monotonic 경과시간과 서버 deadline 잔여시간을 이용해 실행 제한, 타이머/abort listener 정리. 타이머 발화는 종료 증거 아님; close까지 Promise/desktop busy 유지. kill 실패/throw는 close를 대신하지 않는다.
- [x] 결과나 오류에 로컬 관측만 엄격히 제한해 첨부(시작 여부, 본체 close 여부, 경과시간, deadline 초과 등). 모델 출력에서 종료 근거를 읽지 않는다. unknown elapsed를 0으로 만들지 않는다. 이 관측만으로 ledger 정산하지 않는다.
- [x] 예산 bound 실행에서 multi_agent/MCP/일반 delegation/handoff를 비활성하고 반환 우회 거절. 일반 실행 동작 유지. runner capability 광고·HTTP/MCP claim 허용·자동 정산은 전체 process containment 계약 검증 전 활성화하지 않는다.
- [x] 테스트 먼저 실패 관측: pre-spawn expired/mismatch, 준비 중 만료, timeout close 지연과 kill 실패, abort/normal close cleanup, process error, 결과 위조, 일반 실행 비회귀. synthetic child와 실제 Node 비AI fixture로 로컬 timeout/close 검증; 실제 Codex 호출 금지.
- [x] 독립 리뷰 후 전체 Node/dry-run/기록. 이후 Windows process containment 및 durable trusted receipt→atomic settlement→전용 comparison job/UI 순서로 연결한다. 새 언어/런타임 추가가 필요하면 CHANGE_REQUESTS 절차를 따른다.
