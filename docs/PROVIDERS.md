# 제공자 레지스트리와 새 제공자 추가 절차 (CR-006 S1·S2)

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
| claude-code (S2 시범, 적합성 pending) | 구독 CLI | desktop_bridge (local) | 데스크톱 complete, receipt v1 | 프로세스 종료 | 실행기 보고 | 내장 역할 별칭(haiku/sonnet/opus) |

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

## 5. 여러 데스크톱 제공자 (CR-006 S2a) 와 남은 제약
- **해소(S2a):** 연결기는 제공자별 실행기 표를 갖고, poll에 지금 실행할 수 있는 제공자(`providers`)와 준비 안 된 제공자·사유(`notReadyProviders`)를 보낸다. Worker는 그 제공자의 작업만 내주고(receipt v1이면 receipt를 지원하는 제공자만), 연결기는 claim의 제공자와 같은 실행기에서만 실행한다(없으면 "실행기 사용 불가"로 실패 기록). 직접 실행도 고른 제공자를 Worker에 보내며, 이 PC에서 준비되지 않은 제공자는 409로 거절한다.
- **호환:** 아무것도 알리지 않는 예전 연결기는 첫 데스크톱 제공자(Codex)만 받는다. 그래서 Codex는 제공자 목록의 첫 데스크톱 제공자로 남아야 한다(시험으로 고정). 모르는 제공자 id·사유는 건너뛰고 poll은 계속된다. 새 연결기의 준비 상태 보고를 예전 Worker가 400으로 거절하면 예전 형식으로 다시 보낸다.
- **배포 순서:** 실행기가 둘 이상인 연결기는 새 Worker를 먼저 배포한 뒤에 켠다. 예전 Worker는 `providers`를 무시하고 Codex 작업을 내주기 때문이다(Codex 로그인이 없으면 그 작업은 인증 대기로 남는다).
- **화면:** 연결 앱의 AI 실행기 카드와 실행기 상태 문구는 제공자별 준비 상태를 보인다. 보고된 적 있는 데스크톱 제공자는 서버 상태 플래그(예: `localClaudeCode`)가 켜진다. 적합성 pending 제공자는 실행기 선택에서 "(준비 중)"으로 고를 수 없고, 사용량 카드는 기록이 생긴 뒤에만 보인다. "하나 이상은 켜 둠"은 배정 가능한 제공자 기준이다.

남은 제약:
- 계정 카탈로그는 데스크톱이 보고하는 Codex 목록 하나이므로 `account_catalog` 제공자는 하나만 등록할 수 있다(레지스트리 불변식).
- 위임은 2~4개 자식, 제공자 조합 자유(H7)로 이미 일반화됐다. 다만 MCP 도구 설명·Codex 프롬프트·라우팅 문구에 Codex·Claude 이름이 남아 있다. 인계는 "다른 제공자"로의 최대 두 번이다. 시범 중인 claude-code는 배정 대상이 아니므로 아직 영향이 없다.
- 평가 예산 기본 제공자가 등록 순서에 의존한다(첫 evaluationBudget 제공자). receipt v1이 없는 데스크톱 제공자는 receipt v1 poll에서 제외된다(S2a).
- 호환 래퍼(`dispatchClaude`/`runClaudeClaim`, 오케스트레이션의 hasRoutine/fire)는 제공자를 구분하지 않는다. 상태 플래그 이름 충돌 검사가 없다.
- 일부 오류 문구(예: 'Only remote Claude executions require fire confirmation')는 기존 문구 유지를 위해 제공자 이름을 담고 있다.
- 적합성 스위트의 데스크톱 하네스(Codex·claude-code 공통)는 실제 데스크톱 연결기(`server/desktop-bridge.mjs`, 파일 outbox, 작업공간 바인딩)를 거친다. 운영 기준인 receipt gate 0으로 전체를 검증하고, 아직 운영에서 켜지 않은 receipt v1로도 실행한다. v1에서 사용자가 실행 중인 데스크톱 작업을 멈추면 중단된 실행의 실패 기록이 거절된 채 outbox에 남아 명시적 로컬 폐기 전까지 데스크톱이 새 작업을 시작하지 못한다. 이 항목은 H4(receipt 운영 활성화)에서 해결하며 스위트에는 todo로 표시된다.
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

## 7. Claude Code CLI 시범 (CR-006 S2)
설계·결정: docs/superpowers/plans/2026-10-07-claude-code-provider.md. 기존 Claude 구독만 쓰고 API 키·유료 경로는 쓰지 않는다.
- **실행기**(`server/claude-code-runner.mjs`): CLI는 `INNO_CLAUDE_CLI`(절대 경로; 지정하면 다른 곳을 찾지 않음) → PATH의 절대 경로 항목(따옴표 제거)의 `claude.exe` → Claude 데스크톱 앱에 들어 있는 가장 새 판 순서로 찾는다(셸 스크립트 shim은 쓰지 않음).
- **준비 상태:** CLI 도움말에 아래 격리 옵션이 모두 있고 `claude auth status --json`의 `authMethod`가 `claude.ai`(구독)일 때만 준비됨. 아니면 사유 `claude_cli`(없음·옵션 부족) 또는 `claude_login`. 준비됨은 5분, 준비 안 됨은 1분 동안 다시 확인하지 않는다. 확인 프로세스는 15초 안에 끝나지 않으면 멈추고(준비 안 됨), 동시에 들어온 확인은 하나로 합친다.
- **실행 인자:** `-p --output-format stream-json --verbose --no-session-persistence --safe-mode --restricted --strict-mcp-config --disable-slash-commands --tools Read,Write,Edit,Glob,Grep --allowedTools Read(./**),Edit(./**) --permission-mode dontAsk`. 승인 규칙도 실행 폴더 안으로만 한정해, 폴더 밖 접근 차단이 `--restricted` 하나에만 기대지 않게 했다. 프롬프트는 표준 입력. `--bare`는 구독 로그인을 쓸 수 없어 쓰지 않는다.
  - `--safe-mode`: CLAUDE.md, 스킬, 설치된 플러그인, hook, MCP 서버, 사용자 정의 명령 끔(인증·모델·기본 도구·권한은 정상). 실행 폴더가 저장소 안이어도 개발용 CLAUDE.md를 읽지 않게 하기 위함.
  - `--restricted`: 명령·코드 실행 도구와 WebFetch 제거, 사용자·프로젝트·로컬 설정 파일 무시, 파일 도구를 작업 폴더로 제한, 권한 우회 거부.
  - 허용 목록 밖 도구 요청은 묻지 않고 거절(`dontAsk`).
- **환경:** `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_OAUTH_TOKEN`과 기존 API 변수를 지운다. 첫 이벤트는 반드시 system/init이어야 하고(그 전에 다른 이벤트가 오면 중단), 인증 출처가 정확히 `none`(구독)·권한 모드가 정확히 `dontAsk`·도구가 허용 목록 안·MCP 서버 없음이 아니면 즉시 프로세스를 끝낸다. 인증 출처가 다른 값이면 인증 대기, 필드가 없으면 일반 실패로 분류한다.
- **추가 사용량(overage) 방지:** 실행 중 rate_limit 이벤트가 추가 유료 사용(`isUsingOverage`)이나 구독 한도 거절(`status: rejected`)을 알리면 즉시 멈추고 한도 대기로 둔다. 이 이벤트의 형식은 실구독 시험에서 확인한다. 실구독 시험 전에 계정의 추가 사용량이 꺼져 있는지 사용자가 확인한다.
- **결과:** 마지막 result 이벤트의 글을 답으로 쓰고(JSON 형식이면 summary·artifacts), 결과 파일은 실행 폴더 안의 것만 받는다(Codex와 같은 10MB 상한). 토큰은 입력(캐시 쓰기·읽기 포함)·캐시 읽기·출력으로 기록한다. 로그인 필요·만료·OAuth 인증 오류는 인증 대기, 사용량 한도는 한도 대기로 분류한다. 분류에는 오류 결과의 글과 stderr만 쓰고, 정상 답의 내용은 읽지 않는다. 결과를 전달한 실행 폴더는 통째로 지운다(그 안에 쓴 파일이 저장소에 남지 않게). 실패한 실행은 Codex처럼 빈 폴더만 지운다.
- **시범 범위:** 최상위 작업만. 하위·검토·평가 예산·이미지 실행, 위임·인계, 원문 문맥 도우미(셸 필요)는 하지 않는다. 문맥은 전문 전달이고 상한을 넘으면 실행 전에 멈춘다.
- **알려진 한계:** 관리자(managed) 설정은 `--restricted`에서도 적용된다. 개인 PC에서 관리자 권한으로 API 주소·제공자·hook을 바꿔 두었다면 막지 못한다. 격리 옵션의 실제 동작(Glob·Grep 범위 포함)과 init 이벤트 필드는 도움말과 문서 기준이며 실구독 시험에서 확인한다.
- **켜기:** 시범 동안 연결기는 `INNO_CLAUDE_CODE=1`일 때만 이 실행기를 넣는다. 적합성 스위트(10항목, receipt v0·v1)는 통과했지만 manifest는 `pending`이다. 사용자가 CLI에 로그인(`claude auth login`)하고 실구독 최소 시험을 확인한 뒤 `passed`로 올리고 기본으로 켠다.
