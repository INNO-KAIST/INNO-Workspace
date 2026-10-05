# H4 결과 전달 복구의 재시작 안전성 — 설계·작업 계획

> 실행 방식: 작업 단위마다 TDD(RED 확인) → 구현 → inno-opus 독립 검증 → 전체 테스트·`git diff --check`·Wrangler dry-run → docs/PROGRESS.md 기록. 커밋·push·배포·실구독 시험·receipt 운영 활성화는 사용자 확인 후.

**근거:** docs/HANDOFF-CLAUDE.md H4(남은 핵심 1~5, journal 설계 메모), PRD SRC-02·05·06, REL-01. 계획 docs/superpowers/plans/2026-09-28-delivery-receipts.md의 receipt v1 위에 쌓는다.

**전역 제약:**
- receipt 프로토콜 기본값은 0으로 유지한다(scripts/desktop-bridge.mjs, worker createWorker).
- 이 계획은 v1 경로만 바꾸고 v0 동작은 그대로 둔다.
- 실행 중인 실제 데스크톱 연결기(포트 4174/4175)는 건드리지 않는다. 시험은 임시 디렉터리와 임시 포트를 쓰고, 직접 띄운 자식 프로세스만 종료한다.
- 추정 owner로 해제하지 않고, 시간 경과만으로 해제하지 않는다. 빈 outbox를 자동으로 비우지 않는다.
- Windows 전원 장애 내구성은 보증하지 않는다(프로세스 재시작 시험과 구분).

## 작업 단위

### H4-1 사용자 중단 실행의 결과 정리 (receipt v1 차단 해결)
**문제:** receipt v1에서 사용자가 실행 중 작업을 멈추면 다음 순서로 데스크톱이 막힌다(conformance staleOwner todo).
1. renew가 409를 받는다.
2. 실행기가 중단되고, 실패 결과가 outbox에 pending으로 저장된다.
3. 재시작 뒤 전달하면 Worker가 거절한다. lease 만료 중단만 받기 때문이다.
4. 결과가 영구 pending으로 남아 새 실행이 막힌다.

v0은 저장 전에 버려서 막히지 않았다.

**설계(Worker가 확정한 폐기 receipt):**
- 대상: v1 complete/fail 전달이 ConflictError로 거절됐고, 아래 조건을 모두 만족할 때.
  1. 그 owner(workspace·task·execution·generation)의 claim 예약이 아직 있다. 결과가 수락되면 예약이 지워지므로, 예약이 남아 있다는 것은 이 owner의 결과가 한 번도 적용되지 않았다는 뜻이다.
  2. 작업이 그 owner의 결과를 앞으로도 받을 수 없다. 영구 거절 조건은 다음 중 하나다.
     - owner가 바뀜(새 claim·위임 대체).
     - 같은 owner인데 상태가 running이 아니고, 같은 버전의 lease 만료 일시중지도 아님. 해당 상태: 사용자 일시중지, 취소, 재개 대기, 실패 등.
- 처리: D1 배치 하나로 예약을 지우고 `desktop_receipt:<id>`에 저장한다(필드는 기존과 같고 `disposition:'discarded'`를 추가). 작업 버전이 그대로일 때만 실행하고, 수락 receipt와 같은 assertion으로 원자성을 지킨다.
  - 작업은 바꾸지 않는다.
  - 응답은 `{deliveryReceipt, discarded:true}`다. receipt 객체 자체는 기존 필드만 담는다.
  - 재전송하면 저장된 receipt를 돌려준다(discarded 표시 포함).
  - ACK는 기존처럼 receipt를 해제한다.
- 데스크톱:
  - renew가 확정 거절(409)로 끝난 실행은 결과를 outbox에 저장한 직후 한 번 전달을 시도한다.
  - 검증된 receipt(수락 또는 폐기)와 ACK까지 끝나면 unsafe로 멈추지 않고 계속한다.
  - 실패하면 기존처럼 멈추고 복구를 기다린다.
  - 폐기 응답은 "중지된 실행의 결과는 적용하지 않음"으로 표시한다.
- 결과 내용: 사용자가 멈춘 실행의 결과는 v0과 같이 적용하지 않는다. 별도 보관은 비범위다.
- 검증에서 남긴 한계:
  - **되돌림 위험:** 폐기 receipt가 남은 상태에서 Worker를 3cbf0e0 이전으로 되돌리면 이전 판독기가 disposition 키를 거부한다. 그러면 재전송은 409, ACK는 해제 실패가 된다. 수동 정리가 필요하다. 운영 v1은 꺼져 있다.
  - **첫 본문 고정:** 처음 도착한 본문의 digest로 폐기를 확정한다. 같은 owner의 다른 본문이나 다른 action은 409로 남는다. 이는 두 outbox가 생기거나 오류가 있을 때만 일어난다.
  - **lease 만료 중단 뒤 위임·검토 결과:** 영구 거절이 아니므로 폐기하지 않는다. 사용자가 재개하거나 취소한 뒤에 정리된다(기존 동작).

### H4-2 claim journal과 응답 유실 owner 확인
**문제:** 응답 유실이나 프로세스 종료 때 owner를 모른다.
- claim 요청을 보낸 뒤 응답을 받기 전에 프로세스가 죽거나 응답이 유실되면, 데스크톱은 어떤 작업이 자기에게 배정됐는지 모른다.
- 실행 중에 죽고 outbox가 비어 있으면 결과도 실패 기록도 없다. 남는 것은 lease 만료뿐이다.
- 메모리 latch(deliveryUnsafe)는 재시작하면 사라진다.

**설계:**
- journal 파일 `.inno/desktop-claim.json`(v1만). 원자 쓰기: temp → fsync → rename, 0600.
  - claim 전: `{version:1, phase:'requested', binding, nonce, path, taskId?}`. nonce는 32바이트 무작위다. journal 쓰기에 실패하면 요청을 보내지 않는다.
  - 검증된 claim 뒤: `{phase:'owned', binding, nonce, taskId, executionId, generation}`.
  - 결과 기록(outbox pending)이 같은 owner로 저장되면 journal을 지운다. claim이 없으면(빈 poll) 지운다.
- Worker:
  - poll/start 요청의 `claimNonce`(v1, 64 hex)를 claim 예약 값에 저장한다. claim 응답은 nonce를 돌려주고, checkedClaim이 일치를 확인한다.
  - 새 라우트 `POST /api/desktop/claim-status {nonce}`(v1)가 nonce를 닫는다. 닫힘 표지를 남겨, 늦게 도착한 같은 nonce의 claim은 거절된다(admission fence). 응답은 다음 둘 중 하나다.
    - `{state:'none'}`
    - `{state:'claimed', taskId, executionId, generation}`
- 시작 시 조정(첫 tick·startTask 전):
  - journal이 `requested`이면 claim-status를 묻는다. 결과가 none이면 journal을 지운다. claimed이면 owned로 승격한다.
  - journal이 `owned`이고 같은 owner의 outbox 기록이 있으면 journal만 지운다.
  - journal이 `owned`이고 outbox가 비어 있으면 그 owner의 실패 기록(`desktop_restarted`, 재시도 가능)을 outbox에 저장하고 journal을 지운 뒤 일반 전달 절차를 따른다. Worker는 다음과 같이 처리한다.
    - running이면 실패로 수락한다.
    - lease 만료로 일시중지된 상태면 수락한다.
    - 사용자 중단이면 H4-1에 따라 폐기한다.
  - binding 불일치, 형식 오류, 상태 조회 실패: unsafe로 멈추고 명시 복구를 기다린다. 자동으로 지우지 않는다.

### H4-3 legacy outbox 명시 조정
- 대상: receipt 없는 v0 기록. outbox-recovery는 이를 `legacy`로 분류한다.
- Worker: `POST /api/desktop/:id/legacy-status {executionId, generation, action}`가 다음 중 하나를 판정한다.
  - `accepted`: 같은 owner로 이미 반영된 상태.
  - `deliverable`: 같은 owner가 v0으로 running.
  - `stale`: 영구 거절.
  - `unknown`: 작업 없음 등.
- 로컬 복구 API·화면의 처리:
  - 해시로 결속한 확인 입력으로만 조치한다.
  - accepted·stale이면 보관 사본을 남긴 뒤 폐기한다.
  - deliverable이면 v0 전달 후 비운다.
  - unknown이면 보존하고 안내한다.
- receipt 없는 결과를 자동 수락으로 인정하지 않는다.

### H4-4 실제 프로세스 강제종료·재시작 시험
- 시험 전용 자식 스크립트를 실행한다. 구성: createDesktopBridge(v1) + 파일 outbox + journal + 가짜 실행기. 실제 Worker 코드(createWorker + TestD1)를 부모 프로세스의 임시 HTTP 서버로 띄운다.
- 지점별로 자식을 강제종료(Windows TerminateProcess)하고 재시작한 뒤 최종 작업 상태, outbox·journal 정리, 중복 실행 없음을 확인한다.
  - claim 응답 직전
  - claim 직후(실행 중)
  - outbox 저장 직후
  - receipt 수신 후 ACK 전
- 단순 객체 재생성 시험과 구분해 기록한다.

### 진행 상태 (2026-10-05)
- H4-1~H4-4를 구현하고 단위마다 독립 검증했다(커밋 전). H4-5는 docs/DELIVERY-ACTIVATION.md만 작성했다. 세부·한계는 docs/PROGRESS.md 2026-10-05 기록에 있다.
- 설계 대비 변경:
  - claim-status에 `settled`를 추가했다(예약이 사라진 claim).
  - 커밋 뒤 오류가 난 claim 배치는 고유 표지로 알아본다.
  - 이미 claim한 nonce의 재사용은 poll에서도 오류로 처리한다.
  - 이전 형식 결과는 Worker 거절이 기록되면 추가 확인으로 보관할 수 있다.
  - 연결 정보를 확인할 수 없는 기록은 보관만 할 수 있다.
  - 실제 강제종료 지점은 7개다.

### H4-5 활성화 준비(활성화는 하지 않음)
- 양측 capability 확인, 대기 업무·예약·outbox 영향 점검 절차, 롤백 계획을 문서화한다.
- 실제 gate 0→1 전환과 운영 시험은 사용자 승인 뒤에 한다.
