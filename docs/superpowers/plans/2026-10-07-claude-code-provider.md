# CR-006 S2 이 PC의 Claude Code CLI 제공자 시범 — 설계와 단계 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 이 PC에 설치된 Claude Code CLI를 기존 Claude 구독 로그인으로 실행하는 두 번째 데스크톱 제공자 `claude-code`를 추가한다. 연결한 원본 파일 작업을 Codex뿐 아니라 Claude로도 할 수 있게 한다. 기존 Codex(데스크톱)와 Claude Routine(클라우드)은 그대로 둔다.

**사용자 결정(2026-10-07):** 새 제공자 시범은 "이 PC의 Claude Code CLI"로 한다. 기존 구독만 쓰고, 유료 API·overage는 쓰지 않는다. 실구독 시험은 실행 전에 확인을 받는다.

**결정 1~3(2026-10-07 사용자 선택, 모두 권장안):** 도구는 실행 폴더 파일만(Read·Write·Edit·Glob·Grep, 셸·웹·MCP 없음), 모델은 계정 기본값 + 작업별 별칭 선택, S2a~S2c 구현과 가짜 프로세스 시험을 진행하고 S2d 실구독 시험 직전에 이용 조건·CLI 로그인을 다시 확인.

## 1. 조사 결과 요약
- **CLI:** PATH에는 없다. 데스크톱 앱 안의 `%APPDATA%\Claude\claude-code\<버전>\<해시>\claude.exe`(현재 2.1.286)가 있지만 앱이 업데이트되면 경로가 바뀐다. 단독 실행 시 `claude auth status --json` 결과는 `authMethod=none`(로그인 안 됨). 사용자가 한 번 `claude auth login`(브라우저 구독 로그인)을 해야 한다. `ANTHROPIC_API_KEY`는 이 PC 환경에 없다.
- **공식 문서(code.claude.com headless·cli-reference·authentication):** `-p` 비대화형 실행, `--output-format stream-json --verbose`(결과·`usage` 입력·출력·캐시 토큰·`is_error`), 프롬프트는 표준 입력, `--no-session-persistence`, `--permission-mode dontAsk` + `--allowedTools`/`--disallowedTools`, `--strict-mcp-config`, `--setting-sources`, `--disable-slash-commands`, `--model` 별칭(opus·sonnet·haiku·fable). `--bare`는 구독 로그인을 쓸 수 없으므로 **쓰지 않는다**. 인증 우선순위에서 `ANTHROPIC_API_KEY`·`ANTHROPIC_AUTH_TOKEN`이 구독보다 앞서므로 실행 환경에서 반드시 지운다(기존 `withoutApiEnvironment`가 이미 지움). 로그인 확인은 `claude auth status --json`의 `authMethod`(구독은 `claude.ai`), 사용량을 쓰지 않는다.
- **이용 조건:** 문서는 본인 환경에서의 스크립트·CI 실행을 안내한다. 다른 사람에게 claude.ai 로그인을 제공하는 제품은 별도 승인 대상이다. 이 시범은 사용자 본인 PC·본인 구독·본인 작업에만 쓴다. 약관 원문 판단은 사용자 몫(결정 3).

## 2. 범위
**시범에서 하는 것**
- 제공자 `claude-code`(transport `desktop_bridge`, auth `subscription_cli`, 모델 `built_in_roles`, receipt v1, 실행 근거 `null`, 평가 예산 없음, 이미지 입력 없음).
- 연결기가 실행할 수 있는 제공자와 각 제공자의 준비 상태를 Worker에 알리고, Worker는 그 제공자의 작업만 내준다. 예전 연결기(목록 없음)는 지금처럼 Codex만 받는다.
- Claude CLI 실행기: CLI 찾기(설정값 `INNO_CLAUDE_CLI` → PATH → 데스크톱 앱 번들의 가장 새 판), 로그인 확인(`claude.ai`만 허용, API 키 방식 거부), 실행 폴더에서 표준 입력 프롬프트로 실행, stream-json 해석(결과·토큰), 오류 분류(로그인·한도·연결), 프로세스 트리 종료, 결과 파일 수집(Codex와 같은 10MB 상한).
- 프롬프트는 Codex와 같은 구성(프로젝트 지침, 문맥, 원본 자료, 플러그인, 전달 규칙)을 공유하고, 제공자 이름만 바꾼다.
- 화면: 실행기 선택에 "Claude · 이 PC(Claude Code)", 제공자 카드·준비 상태(로그인 필요), 사용량 카드.
- 적합성 시험 하네스(10항목)와 경계 시험 갱신. 통과 + 실구독 최소 시험 뒤에만 배정 후보(`passed`).

**시범에서 하지 않는 것(문서에 한계로 남김)**
- `claude-code`가 직접 하위 작업을 나누거나 인계하기(MCP 도구 없음). 마스터가 `claude-code` 자식을 배정하는 것은 S2 뒤 별도 검토.
- 원문 문맥 도우미(셸 필요). 전문 전달만 하고, 상한(384KB)을 넘으면 실행 전에 멈춘다(Claude Routine과 같은 처리).
- 이미지 입력, CR-004 실행 경로 평가 근거, 평가 예산 실행.

## 3. 결정 1~3
- **결정 1 — 도구 권한(권장: 실행 폴더 파일만).** Windows에는 Claude Code의 OS 샌드박스가 없다. 권장안은 `Read,Write,Edit,Glob,Grep`만 허용하고 셸·웹·MCP를 막는 것이다(`--permission-mode dontAsk`, 허용 목록 밖 요청은 자동 거절). 분석 코드 실행이 필요한 작업은 Codex에 맡긴다. 셸 허용은 PC 전체에 명령을 실행할 수 있어 권하지 않는다.
- **결정 2 — 모델(권장: 계정 기본값).** 지정이 없으면 CLI 계정 기본 모델을 쓰고, 사용자가 작업에서 별칭(opus·sonnet·haiku)을 고를 수 있게 한다. Claude Routine과 같은 구독 한도를 나눠 쓴다.
- **결정 3 — 이용 조건 확인.** 본인 PC·본인 구독·본인 작업에 한한 자동 실행을 사용자가 이용 조건상 받아들일 수 있다고 판단하는지. 실구독 시험 전까지는 구현과 가짜 프로세스 시험만 한다.

## 4. 단계
각 단계는 시험 먼저(RED) → 구현 → 독립 검토(inno-opus) → 전체 시험·`git diff --check`·Wrangler dry-run → PROGRESS 기록 순서. 커밋·배포·실구독 시험은 사용자 확인 뒤.

### S2a 여러 데스크톱 제공자 경계 (Codex만으로 먼저 안전하게)
- 제공자 id 리터럴 경계 시험을 새 id까지 잡도록 일반화(`tests/provider-boundary.test.mjs`).
- 연결기 → Worker: poll/start/presence에 `providers: [{id, ready, reason}]`. Worker는 목록에 있고 준비된 제공자의 대기 작업만 claim하고, 없으면 지금처럼 첫 데스크톱 제공자(Codex)만. 다른 제공자 작업을 Codex 실행기로 돌리는 경로를 막는다(연결기도 claim의 provider와 실행기를 대조해 다르면 실행하지 않음).
- 준비 상태 사유 허용 목록에 `claude_login` 추가, presence를 제공자별로.
- receipt v1 poll에서 한 작업의 거절이 전체 poll을 막지 않게(`worker/bridge.mjs` claim 루프).
- 시험: 예전 연결기 호환, 제공자 목록 claim 필터, 준비 안 된 제공자 제외, 다른 제공자 작업 실행 거부.

### S2b Claude CLI 실행기
- `server/claude-cli.mjs`: CLI 찾기·버전·로그인 확인, 실행 인자 구성, stream-json 해석, 오류 분류, 결과 수집(Codex 실행기의 공통 부분은 함수로 나눠 함께 씀).
- `scripts/desktop-bridge.mjs`: 실행기 표 `{codex, 'claude-code'}`, 제공자별 준비 상태.
- manifest 추가(`conformance.status:'pending'`), 하네스·적합성 10항목, 경계 시험의 어댑터 리터럴 등록.
- 시험: 가짜 프로세스로 인자·환경(API 변수 제거)·표준 입력·결과·토큰·오류(로그인·한도)·중단·결과 파일.

### S2c 화면·문구·문서
- 실행기 선택·제공자 카드·준비 상태·사용량. "Codex"로 고정된 안내 문구를 제공자 이름으로.
- `docs/PROVIDERS.md` 5절 갱신(해소한 제약·남은 제약), REQUIREMENTS-STATUS.

### S2d 실구독 최소 시험과 승격 (사용자 확인 후)
- 사용자가 CLI 로그인 → `auth status`로 `claude.ai` 확인 → 짧은 작업 1회(원본 파일 1개 요약) → 결과·토큰 기록·실행 폴더 정리 확인 → `passed`로 승격 → 반영(Worker·Pages·연결기 재시작).
- 결과(2026-10-08): 요약 1회(7초, 근거 3개 원문 확인, 원문 속 폴더 밖 지시는 모델이 거절) + 추가 1회(사용자 요청으로 폴더 밖 Read·Grep·Write를 실제로 시도 → `--restricted`가 3건 모두 거절, 폴더 안 쓰기만 성공). 승격 시 `assignment: 'top_level'`을 manifest에 더해 위임 하위 작업·인계 대상에서 제외했다. 시험 중 발견: MSIX 설치의 CLI 경로(앱 밖에서 안 보임)와 Claude Code 터미널 세션 변수 유입 → 함께 수정.

## 5. 위험과 완화
- **API 과금:** 실행 환경에서 API 변수를 지우고, 실행 전 `auth status`의 방식이 `claude.ai`가 아니면 시작하지 않는다.
- **권한 확대:** 허용 목록 밖 도구는 자동 거절(`dontAsk`), 설정·MCP·슬래시 명령을 읽지 않음(`--setting-sources` 비움, `--strict-mcp-config`, `--disable-slash-commands`), 세션 저장 안 함.
- **잘못된 실행기:** 연결기와 Worker 양쪽에서 provider를 대조한다.
- **구독 한도 공유:** 한도 오류는 `waiting_quota`로 멈추고 자동 재시도하지 않는다(기존 규칙).
- **CLI 경로 변경:** 실행 때마다 다시 찾고, 못 찾으면 준비 상태 "Claude Code CLI 없음"으로 알린다.
