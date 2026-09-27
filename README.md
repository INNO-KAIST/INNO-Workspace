# INNO Workspace

연구와 일반 업무를 독립적으로 수행하고, 작업의 맥락을 이어가는 개인 AI 작업실.

INNO Workspace는 다른 INNO 앱 없이 사용할 수 있는 독립 플랫폼입니다. NanoLab·Prism·RefAtlas·Scheduler·Analytics·Ledger 연결은 필요한 작업에서만 사용하는 선택 기능이며, 설치나 연결을 기본 사용 조건으로 삼지 않습니다. 일반 파일·폴더와 직접 작성한 요청으로도 작업을 시작합니다.

[클라우드 작업실](https://inno-workspace-api.innokaist.workers.dev) · [GitHub Pages 화면](https://inno-kaist.github.io/INNO-Workspace/)

클라우드는 개인 접근 토큰이 필요합니다. AI 실행은 로컬 Codex 또는 별도 연결한 Claude Routine에서 수행합니다.

## 실행

Node.js 24 이상과 ChatGPT 구독으로 로그인한 Codex CLI가 필요합니다. 화면과 로컬 작업 기록만 사용하려면 Codex는 없어도 됩니다.

```sh
node server/index.mjs
```

터미널에 표시되는 로컬 주소를 엽니다. 주소의 `#token=…` 부분은 작업실 접근 비밀입니다. 브라우저가 이를 세션에 저장한 뒤 주소에서 제거합니다. 이 주소를 공유하지 마세요. 서버는 기본적으로 이 컴퓨터의 `127.0.0.1`에서만 접속할 수 있습니다.

Windows에서는 `Start INNO Workspace.cmd`를 실행해도 됩니다. 컴퓨터 종료 후 접근과 다른 기기 동기화에는 아래 클라우드 배포가 필요합니다. `npm run preview`는 UI·이 기기 보관만 사용하는 미리보기입니다.

## 입력 파일은 영구 업로드하지 않습니다

- 파일·폴더·링크를 연결합니다. 브라우저가 보유한 File/디렉터리 핸들은 메모리에만 있습니다.
- 대화·작업 상태에는 파일명, 상대 경로, 크기, 수정 시각 등 참조만 저장됩니다.
- AI 실행 시 연결 자료에서 읽은 텍스트를 일시적으로 실행기에 전달합니다. 애플리케이션 DB나 서버 파일에 원본 내용을 보관하지 않습니다.
- 새로고침·기기 변경·연결 해제 뒤에는 원본 재연결이 필요합니다. PC가 꺼진 상태에서는 그 PC의 원본을 읽을 수 없습니다.
- 생성된 답변·결과물·체크포인트는 작업 기록이므로 저장합니다. 결과에 필요한 인용이나 요약이 포함될 수 있습니다.
- 모델 제공자 자체의 데이터 처리·보관 정책은 각 구독 서비스 정책을 따릅니다. 로컬 Codex 실행은 `--ephemeral`을 사용합니다.

파일 참조는 최대 5,000개이며, 브라우저 텍스트 추출은 문서당 200,000자, 압축 문서/PDF 30 MiB, PDF 100페이지 이내입니다. 스캔 PDF의 OCR과 임의 바이너리 분석은 해당 분석 앱이 필요합니다. 한도 초과를 숨겨 일부만 분석하지 않습니다.

자료 이름/크기/수정 시각에 의한 재연결은 암호학적인 원본 동일성 증명이 아닙니다. 변경된 원본은 다시 연결하고 재분석해야 합니다.

## 동작 범위

| 기능 | 구현 경로 |
|---|---|
| 대화와 작업 생성, 일시정지, 재개, 결정 기록 | 공유 작업 엔진 + 브라우저 또는 SQLite/D1 |
| 기기 간 상태 동기화 | 같은 서버 주소와 접근 토큰 연결, 활성 탭에서 5초 간격 조회 |
| 원본 연결·미리보기 | 브라우저 File APIs, 메모리만 사용; 텍스트·PDF·DOCX·PPTX 조회 |
| 문헌 검색 | RefAtlas JSON을 세션에 연결 후 검색, DOI와 읽기 범위 표시 |
| 광학 분석 결과 조회 | Prism JSON의 분석과 보정 출처 유지 |
| 선택적 외부 앱 연계 | 기존 앱/저장소 링크, RefAtlas·Prism 등의 선택적 JSON 입력. 핵심 실행의 필수 조건 아님 |
| 실제 AI 실행 | 로그인한 로컬 Codex 또는 사용자가 구성한 Claude Routine |
| 에이전트 역할 | 요청별 기본 계획, 사용자 편집, 실행기의 계획 갱신 도구 |
| 결과물 | 실제 생성된 텍스트·Markdown·SVG 및 검증된 파일 다운로드 |
| 구독 사용량 | 실행기가 반환한 토큰 수. 전체 구독 잔여 한도가 없으면 확인 불가 표시 |
| Codex·Claude 연결 도구 | 인증된 `/mcp` 도구: 작업 조회·실행권·체크포인트·계획·산출물 |

양사 전체 대화 동기화, 모든 형식의 완전 자동 분석, 모든 계정의 실시간 구독 잔여량, 무료 무제한 연산은 제공하지 않습니다. 기존 Firebase 실험 DB의 인증 연결·쓰기 기능은 구현 범위에 포함되지 않았으며 원래 앱에서 사용합니다. 역할 목록은 실제 별도 에이전트 실행 완료를 뜻하지 않습니다. 실행 환경이 실제로 제공하는 기능만 사용합니다.

## 구독 실행

### Codex

```sh
codex login
codex login status
node server/index.mjs
```

ChatGPT 구독 인증을 사용합니다. API 키 인증은 실행 가능으로 인정하지 않습니다. 원본이 연결된 작업에서 **작업 실행**을 누르면 실제 Codex 프로세스가 시작됩니다. 실행은 비동기이며 브라우저를 닫아도 로컬 서버와 PC가 켜져 있으면 계속됩니다. 작업별 실행권과 버전 검사로 취소된 실행의 늦은 결과를 차단합니다.

### Claude Routine

[Claude 공식 Routine](https://code.claude.com/docs/en/routines)에서 API trigger를 활성화하고 발급받은 URL·토큰을 서버 환경변수에 설정합니다. 이 토큰은 모델 API 키가 아니라 해당 구독 Routine 실행용입니다. 지원 여부와 실행 한도는 계정에 따라 다릅니다. Routine은 PC 없이 클라우드에서 실행됩니다.

Routine을 시작했다는 응답은 작업 완료가 아닙니다. 실제 결과를 기록하려면 Routine의 전용 환경에 INNO 호스트용 API 자격 증명과 [Routine 지침](docs/ROUTINE.md)을 설정해야 합니다. 추가 크레딧/유료 초과 사용을 활성화하지 마세요.

## 클라우드 배포

[DEPLOYMENT.md](docs/DEPLOYMENT.md)를 따르세요. 무료 플랜 내 Cloudflare Worker/D1이 공통 상태 API와 정적 화면을 제공합니다. GitHub Pages에는 화면만 배포할 수 있으며 자체 AI 실행 서버가 되지는 않습니다. 소스는 GitHub에, 비밀은 서버 설정에, 입력 원본은 사용자가 연결한 위치에 둡니다.

## 개발·검증

```sh
node --test --test-isolation=none tests/*.test.mjs
npm run preview
```

추가 설치 없이 Node의 내장 테스트 러너를 사용합니다. PDF.js와 JSZip의 브라우저 배포 파일은 `public/vendor`에 포함되어 있으며 각 라이선스를 함께 제공합니다. 설치된 시스템 도구·계정에 의존하는 실제 Codex/Claude 실행과 클라우드 배포는 별도의 검증이 필요합니다.

파일 형식 지원과 연결 계약은 [RESEARCH-INTEGRATIONS.md](docs/RESEARCH-INTEGRATIONS.md), 현재 검증 결과는 [VERIFICATION.md](docs/VERIFICATION.md)를 참고하세요.

### 클라우드 작업을 데스크톱 Codex로 실행

[데스크톱 연결 가이드](docs/DESKTOP-BRIDGE.md)를 따라 `Start INNO Cloud Bridge.cmd`를 실행하세요. 첨부 없는 클라우드 작업 또는 데스크톱 화면에서 원본을 재연결한 작업을 Codex로 실행하고, 같은 클라우드 작업에서 결과를 확인할 수 있습니다.

기존 SQLite 또는 JSON 작업 기록은 [기록 통합 안내](docs/RECORD-IMPORT.md)에 따라 원본을 보존하며 클라우드로 가져올 수 있습니다.

모델 배정·검증 정책과 Codex/Claude별 적용 범위는 [MODEL-ROUTING.md](docs/MODEL-ROUTING.md)를 참고하세요.
