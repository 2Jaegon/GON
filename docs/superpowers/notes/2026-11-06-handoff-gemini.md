# 인수인계: ASO Web 완성 작업 (Claude → Gemini)

작성 2026-11-06. 이 문서만 읽고 이어서 작업할 수 있게 쓴다. 사용자와는 한국어 대화체(~요)로 짧게 말한다.

## 0. 먼저 읽을 것 (순서대로)
1. 이 문서
2. 설계(구속력 있음): `docs/superpowers/specs/2026-11-06-aso-web-completion-design.md`
3. 계획(작업별 인터페이스·테스트): `docs/superpowers/plans/2026-11-06-aso-web-completion.md`
4. `CLAUDE.md`의 "빠른 명령어"·"구조" 절(명령과 구조는 Gemini에도 그대로 적용)
- 계획 전체를 한 번에 읽지 말고, 지금 할 Task 절만 읽는다. 설계와 계획이 다르면 **설계가 이긴다**. 둘 다 다르면 아래 7절 결정 사항이 이긴다.

## 1. 목표 (한 줄)
사용자의 구독 CLI(Claude Code·Antigravity·Codex)를 고른 모델·폴더로 실제 실행하고, 허용된 Google 계정만 쓰게 하며, 가짜·불필요 UI를 걷어낸다. API 키(BYOK) 연결은 **이번 범위 아님**.

## 2. 현재 상태
- 브랜치 `feat/aso`. 커밋 기준 Task 1~8 완료·리뷰 통과(`git log`의 `6dbd11f..66a71bb`).
- 테스트: `npm test` 통과(마지막 확인 vitest 19 files / 97 tests + viewer 통과).
- 개발 서버: `npm run dev`로 :4000(API)·:3000(Web) 실행 중일 수 있음. API 코드를 바꾸면 `npm run build` 후 서버 재시작해야 화면에 반영된다(웹 정적 파일은 즉시 반영).
- **Task 9 상태 불확실**: Claude가 하위 에이전트로 Task 9(러너 HMAC 인증)를 진행하던 중 인계됐다.
  - `git log --oneline -3`에 `fix(runner): authenticate runners with HMAC challenge`가 있으면 → 코드는 들어온 것. 아래 4절 체크리스트로 **검토만** 하고 Task 10으로.
  - 없으면 → `git status`로 반쯤 된 변경이 있는지 보고, 있으면 검토 후 완성, 없으면 Task 9를 처음부터.

## 3. 남은 작업 (계획의 Task 번호)
| Task | 내용 | 위험 |
|---|---|---|
| 9 | 러너 HMAC 인증(페어링 때 `authSecret` 1회 발급, 접속마다 HMAC 서명 확인) | 높음 |
| 10 | `PICK_FOLDER`: 러너가 Windows 폴더 창을 띄워 작업 폴더 선택 | 중간 |
| 11 | 워크스페이스 화면 단순화(폴더 버튼 = 바로 OS 창, 관리는 설정으로) | 중간 |
| 12 | 연결 화면: 구독 AI 로고+이름만, 가짜 API 키 화면 제거(엔드포인트 501) | 낮음 |
| 13 | Google 로그인 서버(허용 이메일, 세션 쿠키, CORS) | 높음 |
| 14 | 로그인 화면 | 중간 |
| 15 | 스킬 카탈로그 화면을 `config/skill-catalog.json`에서 | 낮음 |
| 16 | 마무리 검증(빌드, 전체 테스트, 보안 검토, 브라우저 끝까지 1회) | — |

## 4. 작업 방법 (Task마다 반복)
1. 계획에서 그 Task 절만 읽는다(Files / Interfaces / Steps).
2. **실패하는 테스트 먼저** 쓰고 실행해 실패를 확인 → 구현 → 통과 확인. 실패·통과 출력을 남긴다.
3. `npm test` 한 번, 바꾼 패키지는 `npx tsc --noEmit -p <패키지>`.
4. 스스로 검토(체크리스트):
   - 계획·설계 요구를 빠짐없이? 요구 안 한 기능은 안 넣었나?
   - 비밀값(세션 토큰, `authSecret`)이 응답·로그·이벤트에 다시 안 나오나?
   - 사용자 문자열을 HTML에 넣을 때 `escapeHtml`?
   - CLI는 `execFile` 인자 배열 + `shell:false`, 프롬프트는 맨 뒤 `"--"` 다음?
   - 테스트가 실제 CLI·네트워크 없이 도나(가짜 `CliRunner`/`fetch`)?
5. 계획의 커밋 메시지로 커밋. 줄바꿈 LF 유지.
6. 실행해서 통과한 것만 "통과"로 보고, 못 한 건 unverified.
- 보안 작업(9·10·13)은 끝나면 diff를 다시 한 번 "공격자 입장"으로 읽는다.

## 5. 지켜야 할 규칙 (계획의 Global Constraints 요약)
- 새 npm 의존성 금지(Node 내장만). 웹은 바닐라 JS.
- 모델은 요청마다 플래그로만. CLI 전역 설정·자격 증명 파일(`.credentials.json`, `auth.json`)은 읽지도 쓰지도 않는다.
- 가짜 답변·지어낸 숫자 금지. 측정 못 한 토큰은 0 + `costConfidence: "unavailable"`.
- 화면 문구 한국어 대화체.

## 6. 이미 만들어진 인터페이스 (다음 Task가 씀)
- `packages/provider-adapters`: `CliRunner`, `defaultCliRunner`(npm `.cmd` 래퍼를 실제 `.exe`/`node x.js`로 풀어 실행, 못 찾으면 `CLI not found` 오류), `resolveCliCommand`, `Effort`, `ProviderCallError`, `ProviderRegistry(run?)`·`forConnection(provider)`, `ClaudeProvider`/`AgyProvider`/`CodexProvider(run?)`, `discoverModels`, `parseAgyModels`, `parseClaudeAuthStatus`, `loadModelCatalog`.
- API: `createApiServer({ db?, logger?, cliRunner? })`. `GET /api/v1/workspaces/:id/models`. 실행 생성 본문 `connectionId`·`model`·`effort`, 400 코드 `CONNECTION_NOT_FOUND`/`MODEL_NOT_AVAILABLE`/`EFFORT_NOT_SUPPORTED`/`NO_WORKSPACE_FOLDER`.
- `apps/api/src/services/workspace-path.ts` `resolveActiveWorkspacePath(db, workspaceId)` — 실행 시점에도 다시 확인함.
- 러너 페어링은 이제 `allowedPaths: []`, `activePath: null`로 시작(서버 폴더 자동 지정 제거).
- 웹: `apps/web/public/session-search.js`(`filterSessions`, `highlightMatch`), 로고 `apps/web/public/logos/{anthropic,google,openai}.svg`(임시 글자 로고), 웹 서버가 `.svg`를 `image/svg+xml`로 보냄.

## 7. 내려진 결정 (계획보다 우선)
- 프롬프트는 항상 마지막 인자, 바로 앞에 `"--"`. agy: `["-p","--model",m,"--",prompt]`(agy는 Go flag 방식이라 프롬프트 뒤 옵션은 무시됨), codex: `["exec","--skip-git-repo-check","-s",<read-only|workspace-write>,("-m",m),"--",prompt]`.
- AI 표시 이름: anthropic→Claude, google/antigravity→Gemini, openai→Codex.
- Task 10의 `pickFolder`는 local-runner 안에 자체 `execFile` 래퍼를 둔다(provider-adapters 의존 추가 금지). PowerShell 출력은 UTF-8로(한글 경로: `C:\Users\aicam\Desktop\수업_AX_W\…`).
- Task 11: `GET …/runners/:id/paths`가 허가 폴더가 없을 때 `process.cwd()`를 "현재 폴더"처럼 보여 주는 표시용 대체값도 없앤다(오해 소지).
- Task 12: 로고 파일은 Task 8에서 이미 만듦 — 다시 만들지 말고 재사용.
- Task 13: 기존 테스트 중 `createApiServer`를 쓰는 **모든** 테스트를 `createAuthedServer` 도우미로 바꾼다. `ALLOWED_EMAILS`가 비면 로그인 전부 거부. 워크스페이스 목록은 전부 반환(단일 소유자).
- Task 15: 사이드바 "스킬" 버튼은 이미 위임 핸들러(`app.js`의 `.nav-item` 리스너)로 연결돼 있음 — `onclick` 추가 불필요, 확인만.

## 8. 남겨 둔 작은 문제 (Task 16에서 고칠지 판단)
- 최근 항목 검색: 접힌 "최근 항목"을 검색 시 자동으로 펼치지 않음.
- 모델 목록: `/models` 실패 시 "연결된 AI가 없어요"로 잘못 안내, 선택값이 없을 때 `"null"` 문자열 저장, Gemini 묶음에 "요금제 확인 안 됨"(실제론 목록 확인됨).
- agy/codex `execute()`의 `filesChanged`가 지어낸 예시 diff(가짜 금지 원칙 위반) — 빈 배열로.
- `loadModelCatalog`가 파일 없을 때 경고 없이 빈 목록. Claude 연결 `authenticated` 표시 불일치.
- 정적 서버: `%5c`·깨진 인코딩 회귀 테스트 추가.
- 연결이 워크스페이스별로 나뉘지 않음(데이터 모델 한계, 단일 소유자라 당장은 무해).

## 9. 사용자에게 받아야 할 것 (Task 14 확인 전)
- Google Cloud Console의 Client ID에 승인된 JavaScript 원본 `http://localhost:3000` 추가.
- `.env`(git 무시됨)에 `GOOGLE_CLIENT_ID`(side_pj 값), `ALLOWED_EMAILS`(본인 이메일), `SESSION_SECRET`(새로 생성). **DB 비밀번호는 넣지 않는다**(대화에 노출됐으니 Supabase 비밀번호 교체 권고 — 사용자에게 다시 상기).

## 10. 범위 밖 (다음 설계로)
- Supabase(Postgres) 이전, API 키 연결(Cursor식, 채팅 전용), 웹에서 작업 전 grilling식 질문 라운드, 러너 경유 원격 실행, Mac/Linux 폴더 창, 공식 로고 파일 교체.
