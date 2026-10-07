# 제공자 레지스트리와 새 제공자 추가 절차 (CR-006 S1)

작성일: 2026-10-03. 근거: docs/PROVIDER-PLUGIN-PROPOSAL.md PRV-01~04, 설계·작업 기록 docs/superpowers/plans/2026-10-03-provider-registry.md.

## 1. 구조
- **manifest**(`public/core/providers.mjs`): 제공자마다 선언형 데이터 하나. 브라우저·로컬 서버·Worker가 같은 모듈을 쓴다. 일반 코드는 제공자 id를 비교하지 않고 레지스트리에 transport·capability·모델 카탈로그·배정 가능 여부를 묻는다.
- **transport**: `desktop_bridge`(로컬 PC 필요, lease, 프로세스 종료로 중단) 또는 `routine_fire`(클라우드 fire, 외부 부작용 전 durable claim, 불확실하면 확인 필요). 검증기는 transport가 실제로 구현하는 capability만 허용한다.
- **어댑터**: 제공자 고유 코드(CLI 실행·이벤트 해석, 클라우드 fire 요청·응답, 프롬프트)는 어댑터 파일에만 둔다.
- **적합성 스위트**(`tests/helpers/provider-conformance.mjs`): 등록된 모든 manifest에 대해 실제 어댑터·실제 Worker 진입점·실제 저장소로 실행하고 외부 프로세스/API만 가짜로 둔다.
- **배정 게이트**: `conformance.status`가 `passed`이고 현재 스위트 버전일 때만 위임·인계·모델 선택·MCP 위임/인계 스키마에 나타난다. 실행 요청과 claim은 등록된 제공자면 가능하다.

## 2. 현재 등록된 제공자
| id | 인증 | transport | 결과 전달 | 중단 | 사용량 | 모델 카탈로그 |
|---|---|---|---|---|---|---|
| codex | 구독 CLI | desktop_bridge (local) | 데스크톱 complete, receipt v1 | 프로세스 종료 | 실행기 보고 | 데스크톱 계정 카탈로그 |
| claude | 구독 클라우드 Routine | routine_fire (cloud) | MCP checkpoint_task | 확인 필요 | 선택적 자기보고 | 내장 역할 별칭(haiku/sonnet/opus) |

## 3. 새 제공자 추가 절차
1. **사전 확인**: 사용자가 구독 중인 서비스의 공식 CLI/에이전트가 구독 로그인으로 프로그램 실행을 지원하고, 이용약관이 자동 실행을 허용하는지 확인한다. API 키·유료 과금 경로는 등록할 수 없다(검증기가 `auth.kind`와 `paidApi`로 거부).
2. **manifest 추가**: `PROVIDER_MANIFESTS`에 추가하고 `conformance: {suiteVersion: 1, status: 'pending'}`으로 시작한다. 이 상태에서는 배정 후보가 아니다.
3. **어댑터 구현**
   - desktop_bridge: 로컬 실행기 `{available(), run({task, materials, executionId, generation, signal})}`(예: `server/runners.mjs`의 `createCodexRunner`)를 만들고 `server/index.mjs`의 `runners` 표와 데스크톱 연결기에 연결한다.
   - routine_fire: Worker 어댑터 `{provider, configured, unavailableReason, launch(claim, {materials})}`(예: `worker/claude-routine.mjs`)를 만들고 `worker/remote-adapters.mjs`의 `REMOTE_ADAPTER_FACTORIES`에 등록한다. 등록이 빠지면 Worker의 요청 처리가 모두 오류가 되므로 `tests/provider-transport.test.mjs`가 먼저 잡는다.
4. **적합성 하네스**: `tests/helpers/provider-harnesses.mjs`의 `PROVIDER_HARNESSES`에 추가한다(외부 프로세스/API만 가짜). `tests/provider-conformance.test.mjs`가 자동으로 9개 항목을 실행한다: 소유권·세대(위조 소유자), 이전 세대 소유자(중단 후 재실행), 중단(선언한 보장 수준과 실제 프로세스 종료), 결과 재전송 수락·중복 없음, 원본 비보관, 비밀값 비노출(외부로 나가는 본문·명령 인자·환경·저장소), 보고/미보고 사용량(미보고는 null), 문맥 전달 기록, 확정 실패 시 문맥 전달 기록. 하네스가 없으면 시험이 실패하고, 각 항목은 의도적 결함 하네스가 실패함을 함께 확인한다.
5. **경계 시험**: 일반 코드에 따옴표로 쓴 제공자 id가 있으면 `tests/provider-boundary.test.mjs`가 실패한다. 어댑터 파일은 같은 시험의 `ADAPTER_LITERALS`에 파일과 리터럴 개수를 사유와 함께 등록한다.
6. **승격**: 스위트가 통과하면 `status: 'passed'`로 바꾼다. 실구독 최소 시험은 실행 전에 사용자 확인을 받는다.

## 4. 저장 구조
provider는 task JSON 본문과 `usage` 테이블 키의 일반 문자열이다. manifest 정보는 저장하지 않는다. S1은 D1 스키마를 바꾸지 않았고 이전 Worker로 롤백해도 데이터 변환이 필요 없다. 새 제공자 값을 실제로 쓰기 시작한 뒤의 롤백은 이전 코드가 그 값을 거부·제외하므로 별도 검토가 필요하다.

## 5. S2 전에 풀어야 할 현재 제약
- 계정 카탈로그는 데스크톱이 보고하는 Codex 목록 하나이므로 `account_catalog` 제공자는 하나만 등록할 수 있다(레지스트리 불변식).
- 위임은 "서로 다른 제공자 정확히 2개"이고 오류 문구·프롬프트에 Codex·Claude 이름이 있다. 3개 이상이면 조합 규칙과 문구를 일반화해야 한다. 인계 대상 규칙도 같다.
- 데스크톱 제공자가 둘 이상이면 데스크톱이 실행 가능한 제공자를 알리고 claim이 이를 따라야 한다(현재는 provider를 보내지 않는 데스크톱을 첫 데스크톱 제공자로 처리).
- 평가 예산 기본 제공자가 등록 순서에 의존한다. receipt v1이 없는 데스크톱 제공자는 버전 협상 claim이 거부된다.
- 호환 래퍼(`dispatchClaude`/`runClaudeClaim`, 오케스트레이션의 hasRoutine/fire)는 제공자를 구분하지 않는다. 상태 플래그 이름 충돌 검사가 없다.
- 일부 오류 문구(예: 'Only remote Claude executions require fire confirmation')는 기존 문구 유지를 위해 제공자 이름을 담고 있다.
- 적합성 스위트의 Codex 하네스는 실제 데스크톱 연결기(`server/desktop-bridge.mjs`, 파일 outbox, 작업공간 바인딩)를 거친다. 운영 기준인 receipt gate 0으로 전체를 검증하고, 아직 운영에서 켜지 않은 receipt v1로도 실행한다. v1에서 사용자가 실행 중인 데스크톱 작업을 멈추면 중단된 실행의 실패 기록이 거절된 채 outbox에 남아 명시적 로컬 폐기 전까지 데스크톱이 새 작업을 시작하지 못한다. 이 항목은 H4(receipt 운영 활성화)에서 해결하며 스위트에는 todo로 표시된다.
- 로컬 서버 모드(`server/index.mjs`, 데스크톱 연결기 없이 이 PC 서버가 직접 실행)와 데스크톱의 원문 문맥 조회(`contextAccess`)는 스위트 범위 밖이며 기존 개별 시험이 검증한다.

## 6. Claude Routine 모델 최신화 (PRV-05)

INNO 서비스에는 클라우드 Routine 설정 권한이 없다. 그래서 서비스는 근거를 모아 추천하고 사람의 교체 요청을 기록할 뿐이며, Routine 변경은 Claude Code 세션이 한다.

- 근거: Worker `GET /api/routine-model`이 세 가지를 함께 본다. Claude Code 세션이 기록한 현재 Routine 모델(`routine_model`), 공식 모델 문서의 별칭과 대상 모델(`/api/model-discovery`, 후보 근거일 뿐 계정 가용성 아님), 최근 30일 Claude 실행 결과.
- 판단(public/core/routine-model.mjs): 기록이 없으면 `unknown`이다. 공식 문서의 같은 계열 별칭(예: opus)이 더 새 판을 가리키면 `candidate`(추천)이고, 같으면 `keep`이다. 다른 계열(sonnet·fable 등)은 목록에만 보이고 추천하지 않는다(품질·가용성 근거 없음, MOD-03·04). 공식 문서 확인이 만료·실패하면 새 후보를 판단하지 않는다. 실패가 많아도 모델 교체 근거로 쓰지 않고 연결·한도 확인을 안내한다.
- 요청: 연결 앱 화면의 "Claude Routine 모델"에서 공식 별칭 하나를 골라 교체를 요청한다(`POST /api/routine-model/request`). 요청 취소는 `POST /api/routine-model/request/withdraw`.
- 반영(Claude Code 세션):
  1. `GET /api/routine-model`로 대기 중인 요청을 확인한다.
  2. 사용자에게 채팅으로 다시 확인받는다. 화면 요청만으로는 바꾸지 않는다.
  3. RemoteTrigger로 Routine(trig_01JqQA1ENd9B2yKpeZVLvx3J)의 모델을 바꾼다.
  4. `POST /api/routine-model/record {model, label, appliedRequestId}`로 기록한다. 이 경로는 Worker에만 있고 데스크톱 화면 프록시에는 없다.
  5. 다음 Claude 실행이 정상으로 끝나는지 확인한다.
- 처음 기록: 2026-10-05 Routine 재생성 때 모델 claude-opus-5-5(Opus 5.5)였다(PROGRESS 기록).
