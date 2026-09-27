# User development workspace preference

The user explicitly requested on 2026-09-13 that development performed through this desktop app use `E:\Develop` instead of `C:\Users\WonJeong Yu\Documents`.

- Create new development projects and their working files under `E:\Develop\<project-name>`.
- Keep project source, generated development artifacts, and project-local temporary files inside that project directory where practical.
- Do not start a new development project under Documents merely because it is the current working directory.
- This location preference does not itself authorize deleting or relocating existing projects. Coordinate any necessary migration with the user's task and preserve existing work.

This Windows path preference applies to desktop development only. In Claude cloud routines or other non-Windows runtimes, use the checked-out repository and runtime-provided working directory; do not create or reference an E: drive.

# Independent platform requirement

The user clarified on 2026-09-21 that INNO Workspace must be a complete, independent platform. NanoLab, Prism, RefAtlas, Scheduler, Analytics, and Ledger are optional tools or data sources, used only when useful for a particular request.

- Do not require another INNO app, its installation, account, database, file schema, or connection for core task creation, execution, orchestration, history, or artifact handling.
- Master planning starts from the user's objective and available evidence, not a fixed NanoLab/Prism workflow.
- Keep app-specific adapters separate from the core. Missing or failed optional connections must not block unrelated work.
- Accept ordinary connected files and general requests without requiring an app-specific export.
- Describe existing integrations as optional conveniences. Do not silently remove them or migrate their data.
- Include an all-optional-integrations-disconnected scenario in core end-to-end verification.

## 검증 명령

2026-09-23 사용자 승인. 새 스택 추가 시 변경요청 승인 후 갱신한다.

### Node / JavaScript
- npm test (node --test --test-isolation=none tests/*.test.mjs)
- 변경 항목별 node --test --test-isolation=none tests/<해당 테스트>.test.mjs
- Windows TEMP/TMP는 이 작업 트리의 .inno/tmp 사용.
### Python
- 번들 Python 실행파일 -B tests/test_verify_deliverable.py (관련 변경 또는 릴리스 검증 시; CI의 python3 명령과 동등)
### Cloudflare
- npx --no-install wrangler deploy --dry-run --outdir .inno/deploy-check (기존 설치 사용, 없으면 설치를 자동 진행하지 않음)
- 실제 배포 npm run deploy는 위 검증 및 운영 작업 상태 확인 후 기존 승인 범위에서 수행.
### 공통 / 사용자 흐름
- git diff --check
- 데스크톱·모바일 브라우저: 재연결, 중복 클릭/새로고침, 부모 중단, 계정 전환, 모든 선택 연동 해제.
- 배포 후 인증 거절·상태 조회·정적 자산·필요 최소 구독 실행 결과 회수 확인. 운영 비밀값 출력 금지.

## 프로젝트 구조 요점

- public/: 브라우저 UI와 공통 모듈
- server/: Node 로컬 서버·구독 실행기·데스크톱 브리지
- worker/: Cloudflare Worker/D1·MCP·협업 상태
- tests/: Node 및 Python 검증
- scripts/: 실행·미리보기·산출물 검증 도구
- docs/: PRD, PROGRESS, 변경요청, 설계와 검증 근거
- .inno/: 로컬 실행 자료·임시파일·비밀정보. 비밀값 출력/커밋 금지.
