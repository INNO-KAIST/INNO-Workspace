# 데스크톱 결과 전달 receipt(v1) 활성화 준비

작성일: 2026-10-05. 상태: **2026-10-05 운영 활성화 완료**(Worker 72489b7a, 데스크톱 사용자 환경변수 설정·재시작, 실구독 완료·일시중지 정리 확인; docs/PROGRESS.md). 아래는 준비 당시 기록과 끄는 방법이다. 2026-10-05 사용자가 활성화 진행을 승인했다. 켜는 경로는 아래 1절이다. 운영 설정 변경(Worker 환경값, 데스크톱 사용자 환경변수)과 연결기 재시작은 사용자가 직접 하거나 권한을 허용한 뒤에 한다(H4-5, docs/HANDOFF-CLAUDE.md H4).

## 1. gate와 협상
- 공통 판정: public/core/delivery-receipt-gate.mjs `deliveryReceiptVersionFromEnvironment`. 환경값 `INNO_DESKTOP_RECEIPT_VERSION`이 정확히 문자열 `1`일 때만 1이고, 없거나 그 밖의 값이면 0이다(`sourceDelegationVersion`과 같은 방식).
- Worker: `export default`가 요청의 env로 원본 위임과 receipt 조합에 맞는 Worker를 고른다(worker/index.mjs `configuredWorker`). 켜려면 `wrangler.jsonc`의 `vars`에 `"INNO_DESKTOP_RECEIPT_VERSION": "1"`을 추가하고 배포한다. 켜진 Worker도 receipt 헤더가 없는 v0 데스크톱 요청은 그대로 받는다(tests/delivery-receipt-gate.test.mjs).
- 데스크톱: scripts/desktop-bridge.mjs가 프로세스 환경변수 `INNO_DESKTOP_RECEIPT_VERSION`을 읽는다. 원본 위임처럼 Windows 사용자 환경변수로 설정한다. 시작 창에 `Delivery receipts: on|off`가 표시된다. v1일 때만 claim journal(.inno/desktop-claim.json), 로컬 복구 화면(recovery.html), 결과 폐기 정리, 이전 형식 결과 정리가 동작한다.
- 협상:
  - 데스크톱 요청 헤더 `x-inno-delivery-receipt-version: 1`과 `x-inno-workspace-id`.
  - Worker 상태 응답 capability `desktopDeliveryRecovery`.
  - claim 응답의 `deliveryReceiptVersion:1`과 `claimNonce` 확인(server/delivery-protocol.mjs `checkedClaim`).
  - v1 claim의 작업 checkpoint에 `deliveryReceiptVersion:1`이 남는다.
  - Worker가 v0이면 v1 헤더를 거절한다(400). 그러면 데스크톱은 claim하지 않는다.

## 2. 활성화 전 점검(읽기만)
1. 코드 기준: main/Worker/Pages/데스크톱이 같은 커밋인지 확인한다. 커밋 3cbf0e0 이후 H4-1~H4-4 변경이 포함돼야 한다.
2. 데스크톱 outbox:
   - `.inno/desktop-pending.json`과 `.tmp`의 존재를 확인한다.
   - v0 형식(version 없음) 기록이 있으면 v1 전환 뒤 이전 형식 결과 정리(H4-3)로 처리해야 한다. 가능하면 전환 전에 v0 연결기로 전달을 끝낸다.
3. Worker metadata 개수: `desktop_reservation:*`, `desktop_receipt:*`, `desktop_claim:*`. 예약과 receipt를 합한 상한은 1024다. v0 운영에서는 모두 0이어야 정상이다.
4. 실행 중 데스크톱 작업: v0로 claim된 running 작업은 끝나거나 멈춘 뒤에 전환한다. v0 owner 결과는 v0 경로로만 받는다.
5. 데스크톱 연결기 하나만 돌고 있는지 확인한다(포트 4174 잠금). 같은 `.inno`를 두 프로세스가 쓰지 않아야 한다.

## 3. 활성화 순서(승인 후)
1. `wrangler.jsonc` `vars`에 `"INNO_DESKTOP_RECEIPT_VERSION": "1"`을 추가하고 Worker를 배포한다. v0 데스크톱 요청은 그대로 동작한다(헤더가 없으면 v0 경로).
2. Worker 상태의 `desktopDeliveryRecovery:true`를 확인한다.
3. 데스크톱:
   1. 연결기가 쉬고 있을 때 "Start INNO Cloud Bridge" 창을 Ctrl+C로 종료한다.
   2. 메인 체크아웃을 같은 커밋으로 맞춘다.
   3. Windows 사용자 환경변수를 설정한다(`setx INNO_DESKTOP_RECEIPT_VERSION 1`). setx는 이후 새로 시작하는 프로그램에만 적용된다. 이미 열려 있던 터미널에서 실행하면 꺼진 채로 시작되므로, 탐색기에서 .cmd를 더블클릭해 실행한다.
   4. `Start INNO Cloud Bridge.cmd`를 다시 실행한다. 창에 `Delivery receipts: on`이 보여야 한다.
4. 최소 확인. 실구독 시험은 실행 전에 확인을 받는다.
   1. 완료 결과 전달, ACK, outbox 정리.
   2. 실행 중 사용자 일시중지가 폐기 receipt로 정리되고, 다음 실행이 가능한지.
   3. 로컬 복구 화면 상태 조회.
   4. 같은 작업의 재실행.
5. 문제가 생기면 4절의 되돌림을 따른다.

## 4. 되돌림
- 끄는 순서: 데스크톱을 먼저 끄고 Worker를 나중에 끈다.
  1. 둘 다 켜진 상태에서 데스크톱 outbox와 claim journal을 비운다. 전달과 ACK를 끝내고, 남은 예약은 클라우드 복구 화면에서 정리한다. 이 화면과 복구 경로는 Worker가 켜져 있을 때만 동작한다.
  2. 데스크톱을 끈다. 연결기를 종료하고 `setx INNO_DESKTOP_RECEIPT_VERSION 0`을 실행한다. "0"은 꺼짐이다. `reg delete`는 Windows에 변경을 알리지 않아 다시 실행해도 켜진 채로 남을 수 있으므로 쓰지 않는다. 그 뒤 .cmd를 다시 실행해 `Delivery receipts: off.`를 확인한다.
  3. 마지막으로 Worker를 끈다. `wrangler.jsonc`의 `INNO_DESKTOP_RECEIPT_VERSION`을 지우거나 `"0"`으로 바꿔 재배포하고, `desktopDeliveryRecovery:false`를 확인한다. Worker를 먼저 끄면 v1 연결기의 complete·ACK가 모두 400으로 거절되고, v0 연결기는 v1 기록을 보내지 않아 결과가 묶인다.
- 아래 조건(outbox·journal·`desktop_receipt:*` 0)은 Worker를 끄기 전과 Worker 코드를 되돌리기 전 모두에 적용된다.
- 데스크톱만 v0로 되돌릴 때:
  - v1 outbox 기록(pending/ack_pending)을 v0 브리지는 보내지 않는다(형식 거절). 되돌리기 전에 v1로 전달·ACK를 끝내 outbox와 claim journal이 비어 있는지 확인한다.
  - journal이 남았으면 v1에서 tick이 정리한 뒤 되돌린다.
- Worker를 이전 버전으로 되돌릴 때:
  - 3cbf0e0 이전 판독기는 `disposition` 키가 있는 폐기 receipt를 거절한다.
  - nonce 표지(`desktop_claim:*`)와 legacy-status 경로도 모른다.
  - 되돌리기 전에 데스크톱 outbox·journal이 비어 있고, `desktop_receipt:*`가 0인지 확인한다.
  - 남은 `desktop_claim:*`는 무해하다. 이전 코드는 읽지 않는다.
- 예약만 남은 경우: 클라우드 복구 화면의 명시 폐기(`delivery-recovery-ui`)로 정리한다. 실행 중인 작업이나 receipt가 있으면 거절된다.

## 5. 한계
- 실제 프로세스 강제종료·재시작 시험(tests/desktop-process-kill.test.mjs)은 같은 PC의 프로세스 종료만 확인한다. 다음은 확인하지 않는다.
  - Windows 전원 장애에서 디렉터리 항목의 내구성
  - OS 로그인 자동 시작
  - 서비스 종료 신호
- 사용자가 멈춘 실행의 결과는 v0과 같이 적용하지 않는다.
- 이전 형식 결과는 자동으로 수락하지 않는다.
- claim 응답 유실로 확인된 owner는 결과 없이 `restarted` 실패로 기록된다. 재실행은 사용자가 선택한다.
