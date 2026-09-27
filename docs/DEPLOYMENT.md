# 무료 클라우드 배포

이 저장소의 소유자용 Worker/D1은 2026-09-13 배포 및 인증·저장을 검증했습니다. 다른 계정에 배포할 때는 wrangler.jsonc의 D1 ID와 이름, CORS 주소를 본인 환경으로 변경하세요.

이 문서는 소스의 배포 절차입니다. 절차가 있다는 사실만으로 클라우드 계정 연결이 완료되는 것은 아닙니다.

## 1. Cloudflare Worker + D1

Cloudflare Free 계정으로 로그인합니다. `wrangler.jsonc`는 정적 화면과 API를 같은 주소로 배포합니다. 원본 첨부 저장용 R2/S3 버킷은 만들지 않습니다.

```sh
npx wrangler login
npx wrangler d1 create inno-workspace
```

반환된 database ID를 `wrangler.jsonc`의 D1 `database_id`에 입력합니다. 실제 ID를 넣기 전에는 배포할 수 없습니다.

```sh
npx wrangler d1 migrations apply inno-workspace --remote
npx wrangler secret put ACCESS_TOKEN
```

접근 토큰은 임의의 긴 비밀 문자열로 생성해 비밀번호 관리자에 보관합니다. 모델 API 키를 사용하지 않습니다. 클라우드 서버는 이 토큰을 아는 단일 소유자 작업실을 위한 설계입니다. 연구실 다중 사용자 권한 모델을 대신하지 않습니다.

Claude Routine이 해당 구독 계정에서 활성화된 경우:

```sh
npx wrangler secret put CLAUDE_ROUTINE_TOKEN
npx wrangler secret put CLAUDE_ROUTINE_URL
npx wrangler deploy
```

출력된 Worker URL을 열고 **작업실 연결**에 같은 URL과 ACCESS_TOKEN을 입력합니다. 휴대폰과 데스크톱에서 같은 주소·토큰으로 접속하면 작업 상태를 공유합니다. 파일 내용은 공유하지 않으며 해당 기기에서 필요한 원본을 다시 연결합니다.

무료 플랜 한도 내에서 운영합니다. Worker/D1의 현재 한도는 공식 콘솔과 문서에서 확인하세요. 저장량·읽기·요청 한도 초과 시 지연/오류가 발생할 수 있으며 앱은 유료 플랜이나 모델 API로 전환하지 않습니다.

## 2. GitHub Pages 화면 배포

공개 저장소의 Settings → Pages → Source를 **GitHub Actions**로 선택하면 `.github/workflows/pages.yml`을 사용할 수 있습니다. 생성되는 주소는 정적 화면입니다. AI 실행과 다른 기기 동기화를 위해서는 위 Worker URL을 설정해야 합니다.

Pages 화면에서 Worker API에 접속할 경우 Worker의 `CORS_ORIGINS` 환경변수에 해당 Pages origin을 등록합니다. 예: `https://inno-kaist.github.io` (경로 제외). 임의 origin을 모두 허용하지 않습니다.

비공개 저장소는 GitHub 계정 플랜에 따라 Pages 가용성이 다릅니다. 무료가 아닌 요금제로 자동 전환하지 않습니다.

## 3. 배포 후 확인

원본 협업 capability는 Worker 환경변수 `INNO_SOURCE_DELEGATION_VERSION`의 정확한 문자열 `1`로만 켜집니다. 미설정·그 밖의 값은 버전 0입니다. 2026-09-27 검증 릴리스의 wrangler.jsonc에는 이 변수를 문자열 1로 명시합니다. 실제 혼합 제공자 검증 완료 여부는 PROGRESS.md에서 확인합니다. 검증된 릴리스에서 데스크톱 연결기의 같은 게이트를 먼저 준비하고, 운영 활성화 시 Worker 환경에 별도로 적용한 뒤 인증된 `/api/state`의 `capabilities.sourceDelegationVersion`을 확인합니다. 되돌릴 때 Worker 변수를 제거하거나 `0`으로 변경하고 재배포한 뒤 같은 상태가 0인지 확인합니다. 현재 실행 중인 작업의 소유권과 저장된 결과를 확인한 다음 데스크톱 연결기도 환경변수를 제거하고 재시작합니다. 요청 본문으로 capability를 활성화할 수 없습니다.

1. 로그인하지 않은 `/api/state` 요청이 401로 거부되는지 확인합니다.
2. 두 기기에서 같은 작업의 메시지와 일시정지 상태가 동기화되는지 확인합니다.
3. 파일 연결을 해제하거나 페이지를 새로 연 후 원본 재연결 안내가 나오는지 확인합니다.
4. 실제 Routine 작업을 시작하고, MCP로 체크포인트·최종 결과가 기록되는지 확인합니다.
5. 취소·사용량 한도·네트워크 중단을 성공으로 표시하지 않는지 확인합니다.

로컬 전용 모드의 DB와 클라우드 DB는 별개입니다. 데스크톱 연결기를 실행하면 클라우드의 Codex 작업을 처리하고 결과를 같은 클라우드 작업에 돌려줍니다. PC 종료 시 데스크톱 Codex는 실행할 수 없으며, 원본이 필요한 작업은 접근 가능한 기기에서 재연결해야 합니다.
