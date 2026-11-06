# ASO Web 완성: 로그인 · 구독 기반 모델 선택 · 화면 정리 설계

- 날짜: 2026-11-06
- 범위: `apps/web`, `apps/api`, `apps/local-runner`, `packages/provider-adapters`, `packages/contracts`, `packages/security`
- 제외: Supabase(Postgres) DB 이전 — 별도 설계로 진행

## 1. 의도

사용자가 자기 PC에 설치·로그인한 AI 구독(Claude Code, Antigravity, Codex)과 직접 등록한 API 키로 채팅·작업을 돌리는 웹 앱을 "실제로 쓸 수 있는" 상태로 만든다. 지금은 화면에 보이는 것과 실제 동작이 다르다.

- 로그인이 없다. `/api/v1/me`가 고정 사용자를 돌려준다.
- 모델 선택이 가짜다. 하드코딩 목록이고, `providerPreference` 문자열 부분일치로 Opus·Haiku·GPT-4o가 Gemini로 빠진다. Claude 호출엔 `--model`이 없다.
- API 키 등록이 가짜다. "AES-256 Vault"라고 표시하지만 키를 버린다.
- 쓰지 않는 UI(마이크·음성 모드)와 쓸모없는 UI(프로젝트 드롭다운 — 2026-11-06 삭제 완료)가 보인다.
- 워크스페이스 창에 기기 정보·허가 목록·경로 입력이 섞여 있다.

## 2. 목표 / 비목표 / 반목표

**목표** (이번 범위 = 사용자의 구독 서비스를 연결해서 쓰는 것)
1. 채팅에서 고르는 모델 목록 = 사용자가 구독으로 실제로 쓸 수 있는 모델.
2. 고른 모델과 추론 강도가 실제 호출에 쓰이고, 사용 기록에 실제 모델명이 남는다.
3. 폴더 버튼 하나로 OS 폴더 창을 띄워 작업 폴더를 고르고, AI가 **그 폴더에서** 작업한다.
4. 연결 화면은 구독 AI의 로고와 이름만.
5. 허용된 Google 계정(본인)으로 로그인해야 쓸 수 있다.

**비목표**
- **API 키(BYOK) 연결 — 나중에 구현(사용자 결정 2026-11-06)**. 이번에는 가짜 등록 화면만 걷어낸다(작업 4).
- Supabase/Postgres 이전, 다중 사용자 협업·권한, Mac/Linux 폴더 창, 결제, 러너를 거친 원격 실행.

**반목표 (기술적으로 돌아가도 실패인 것)**
- 모델 선택이 사용자의 구독 요금제나 CLI 전역 설정(`~/.claude`, `~/.codex`, `~/.gemini`)을 바꾸는 것. 모델은 **요청마다 플래그로만** 지정한다.
- 확인 못 한 걸 확인된 것처럼 보이는 것(예: 요금제를 모르는데 "Pro 전용 모델"이라고 표시, 저장 안 했는데 "암호화 저장됨" 표시).
- API 키 원문이 브라우저·로그·응답·이벤트에 다시 나오는 것.
- CLI 자격 증명 파일(`.credentials.json`, `auth.json`)을 직접 읽는 것. 공식 CLI 명령 출력만 쓴다.

## 3. 제약

- `apps/web/public`은 빌드 없는 바닐라 JS다. 프레임워크를 들이지 않는다.
- 새 npm 의존성 없이 Node 내장(`crypto`, `child_process.execFile`, `fetch`)으로 해결한다.
- 서버는 `127.0.0.1`에서 돈다(API :4000, Web :3000).
- 테스트는 `MockProvider`·인메모리 DB로 돌아야 한다(CLI·네트워크 없이).
- 사용자 대화체·문구는 한국어.

## 4. 작업 순서 (사용자 결정)

| # | 작업 | 위험 |
|---|---|---|
| 0 | 보안 선결: 웹 정적 서버 경로 탈출 수정, `.env` gitignore | 높음 |
| 1 | 안 쓰는 UI 정리 + 최근 항목 검색 | 낮음 |
| 2 | 구독 기반 모델 선택 | 중간 |
| 3 | 워크스페이스 선택 단순화 | 중간 |
| 4 | 커넥터 목록 단순화 + 가짜 API 키 화면 제거 | 낮음 |
| 5 | Google 로그인 + 러너 인증 | 높음(인증) |
| 6 | Supabase 이전, API 키 연결 | 범위 밖 |

3·5는 `ecc:security-reviewer` 검토를 통과해야 끝난다.

## 5. 작업별 설계

### 0. 보안 선결
- `apps/web/src/server.ts`: `path.join(PUBLIC_DIR, reqPath)` 결과가 `PUBLIC_DIR` 밖이면 404. 확인된 재현: `curl --path-as-is http://127.0.0.1:3000/../src/server.ts`가 소스를 돌려준다.
- `.gitignore`에 `.env` 추가(`.env.example`은 유지).

### 1. 안 쓰는 UI 정리
- `index.html`의 "음성 입력"(마이크)·"음성 모드" 버튼 삭제.
- 그 밖에 핸들러가 없는 버튼은 **지우지 말고 목록으로 보고**해 사용자가 정한다(예: 사이드바 `skills` 항목은 `onclick`이 없다).

### 1b. 최근 항목 검색 (사용자 요청 2026-11-06)
- 지금 사이드바 "검색" 버튼(`focusSearchInput`)은 채팅 입력창에 포커스만 준다 — 검색이 아니다.
- 바꿀 동작: "검색"을 누르면 사이드바 "최근 항목" 위에 검색 입력칸이 열리고, 입력하는 즉시 최근 항목 목록을 걸러 보여 준다. `Esc` 또는 비우면 원래 목록.
- 대상: 이미 불러온 최근 항목(`loadSidebarRuns`가 받은 세션들)의 제목과 메시지 내용. 서버 검색 API는 만들지 않는다(클라이언트 필터).
- 대소문자 무시, 결과 없으면 "검색 결과가 없어요". 일치한 글자는 강조.

### 2. 구독 기반 모델 선택

**고른 방법: A — CLI에 직접 묻기**
- 고려한 대안: B 고정 목록만(요금제 밖 모델 노출 → 요구와 어긋남), C 모델마다 시험 호출(사용량 소모·느림).

**모델 목록 출처**

| AI | 출처 | 요금제 표시 |
|---|---|---|
| Antigravity | `agy models` 출력(탭 구분: `id<TAB>표시명`) 그대로 | CLI가 준 목록이므로 "확인됨" |
| Claude Code | `claude auth status`(JSON)의 `subscriptionType` + `config/model-catalog.json`의 별칭 `opus`·`sonnet`·`haiku` | `subscriptionType` 표시. Pro도 Opus·Sonnet 사용 가능(출처: code.claude.com/docs/en/model-config, support.claude.com 11940350). 사용 크레딧이 필요한 모델(Mythos 등)은 넣지 않는다 |
| Codex | `config/model-catalog.json`(빌더가 developers.openai.com/codex/models를 2026-11-06 기준으로 조사, 출처 URL·확인 날짜 기록) | 요금제 확인 불가 → "요금제 확인 안 됨" 표시 |

- 결과는 연결(`ProviderConnection.metadata.models`)에 저장하고, "구독 감지"(`detect-subscriptions`) 때 갱신한다.
- 새 엔드포인트 `GET /api/v1/workspaces/:id/models` → `{ subscription: [{connectionId, provider, displayName, plan, planVerified, efforts, models:[{id,label}]}] }`. 나중에 API 키를 붙일 때 `api` 키를 옆에 추가한다(지금은 만들지 않음).

**실행 경로**
- 실행 요청(`CreateRunDTO`)에 `connectionId`, `model`, `effort`(선택)를 명시적으로 추가한다. 서버는 `connectionId`의 공급자와 모델이 그 연결의 목록에 있는지 검증하고, 없으면 400. `providerPreference` 문자열 추측(`provider-registry.ts`의 `includes("sonnet")`)은 제거하고, `connectionId`가 없을 때만 기존 `auto` 동작.
- Claude: `claude -p --model <별칭> [--effort <level>] --output-format json`. **`exec` 셸 문자열을 `execFile` 인자 배열로 바꾼다** — 지금은 따옴표만 이스케이프해 셸 주입 여지가 있다.
- Antigravity: `agy -p … --model <id> [--effort <level>]`.
- Codex: 새 어댑터. 비대화형 실행 명령과 모델 플래그(`-m`)는 빌더가 `codex --help`로 확인.
- 사용 기록 `usage.model`에 실제로 넘긴 모델 id를 쓴다(지금은 늘 `claude-3-7-sonnet`).
- **작업 폴더**: 모든 CLI 호출(채팅·계획·작업)에 `execFile`의 `cwd`로 활성 작업 폴더를 넘긴다. 폴더는 서버가 러너의 허가 목록·활성 경로에서 꺼내 쓰고, 요청 본문의 경로는 믿지 않는다. 활성 폴더가 없거나 허가 목록 밖이면 실행 거부 + "작업 폴더를 먼저 골라 주세요". (같은 PC 전제 — API와 러너가 다른 PC면 동작하지 않음. 러너 경유 실행은 비목표)

**화면**
- 모델 선택 팝오버는 AI별(로고+이름)로 묶고 모델을 나열. "구독" 제목 아래 하나의 구역으로 두고, API 구역은 나중에 추가.
- 추론 강도(Low/Mid/High)는 고른 연결이 `efforts`를 지원할 때만 보인다.
- 선택은 `localStorage`에 기억(뷰어별 편의). 저장된 선택이 목록에 없으면 첫 모델로 되돌린다.
- 연결된 것이 하나도 없으면 "연결된 AI가 없어요 → 연결 화면" 안내.

### 3. 워크스페이스 선택 단순화

**고른 방법: A — 로컬 러너가 OS 폴더 창을 띄운다**
- 고려한 대안: B API 서버가 직접 띄우기(같은 PC일 때만 동작), C 브라우저 창+경로 입력(브라우저는 폴더 이름만 주고 전체 경로를 안 줌 — 현재 방식).

**흐름**
1. 채팅의 폴더 버튼 클릭 → `POST /api/v1/workspaces/:id/runners/:deviceId/pick-folder`.
2. API → 러너에 WebSocket `PICK_FOLDER` 전송 → 러너가 Windows 폴더 창(PowerShell `System.Windows.Forms.FolderBrowserDialog`, `-STA`, `execFile`)을 띄움.
3. 러너 → `PICK_FOLDER_RESULT {path}` 또는 `{cancelled:true}`. 시간 제한 2분.
4. API가 경로를 허가 목록에 추가하고 활성 경로로 지정(사용자가 직접 고른 것 = 허락) → 버튼 라벨이 폴더 이름으로 바뀜.
- 러너가 오프라인이면 "PC의 러너를 켜 주세요" 안내와 러너 화면 링크.
- Windows 외 OS는 러너가 `unsupported` 응답 → 안내 문구.

**화면**
- 기존 워크스페이스 모달 삭제. 버튼은 바로 폴더 창을 띄운다(첨부 버튼과 같은 느낌).
- 연결된 PC 정보·기기 해제·허가 폴더 목록·삭제는 **설정 → 작업 폴더**로 옮긴다.
- `app.js`의 사용자 PC 전용 필터(`!p.includes("UsersaicamDesktop")`)는 제거한다.

### 4. 커넥터 목록 단순화 + 가짜 API 키 화면 제거

**구독 목록**: 설치·연결된 구독 AI만, **로고와 이름만** 보인다. 상세·과금·기능·점검 시각은 화면에서 뺀다. (내 판단: 조치가 필요한 상태만 작은 경고 점으로 표시 — "확인 못 한 걸 숨기지 않는다" 반목표 때문)
- 로고: `apps/web/public/logos/`에 각 사 공식 브랜드 자산(식별 목적)의 SVG.

**API 키**: 이번에는 구현하지 않는다.
- 연결 화면의 "새 API Key 등록" 카드와 "AES-256 Vault"·"암호화되어 안전하게 등록되었습니다" 문구를 삭제한다(키를 실제로 저장하지 않으므로 반목표 위반).
- `POST …/connections/api-key`는 `501 { error: "API 키 연결은 준비 중이에요" }`를 돌려줘 가짜 "연결됨" 카드가 더 생기지 않게 한다. (내 판단)
- 나중 설계 메모(사용자 결정 유지): Cursor식 — AI 회사마다 한 줄(로고·이름·가림 입력·"확인"), 실제 호출로 확인 후 저장, 끝 4자리만 표시, AES-256-GCM 저장, 채팅 모델 선택에서 "구독"/"API" 구역 분리, 처음엔 채팅 전용.

### 5. Google 로그인

side_pj와 같은 방식(Supabase Auth 아님).
1. 로그인 화면: Google Identity Services 버튼(`accounts.google.com/gsi/client`). Client ID는 `GET /api/v1/auth/config`로 받는다.
2. `POST /api/v1/auth/google {credential}` → 서버가 `https://oauth2.googleapis.com/tokeninfo?id_token=…`로 검증: `aud == GOOGLE_CLIENT_ID`, `iss`, `exp`, `email_verified`.
3. **허용 목록 확인**: 검증된 이메일이 `.env`의 `ALLOWED_EMAILS`(쉼표 구분)에 없으면 403 "허용되지 않은 계정이에요". `ALLOWED_EMAILS`가 비어 있으면 서버가 로그인을 전부 거부한다(실수로 모두에게 열리지 않게). 이 PC의 구독 CLI를 쓰는 서비스라 본인만 쓴다 — 그래서 워크스페이스별 멤버 권한 검사는 하지 않는다.
4. 사용자 찾기/만들기(Google `sub` 기준) → 무작위 세션 토큰 발급, DB에는 해시만 저장, `httpOnly; SameSite=Lax` 쿠키.
5. `/api/v1/me`는 세션 사용자, `POST /api/v1/auth/logout`.
6. `/api/v1/**`는 세션 필수. 예외: `auth/*`, `health`, 러너 페어링 교환·WebSocket(아래 러너 인증을 씀).
7. CORS `*` 제거 → `WEB_ORIGIN`만, credentials 허용.
8. 첫 로그인 사용자는 기존 Default Workspace와 기본 프로젝트를 이어받는다(지난 대화 기록 유지). 프로젝트가 0개면 기본 프로젝트를 만든다(`currentProjectId` 빈 값 문제 해소).
- 사용자 할 일: Google Cloud Console의 이 Client ID에 승인된 JavaScript 원본 `http://localhost:3000` 추가.
- `.env`: `GOOGLE_CLIENT_ID`(side_pj 값), `ALLOWED_EMAILS`(사용자가 적음), `SESSION_SECRET`(새로 생성). DB 비밀번호는 넣지 않는다(작업 6).

**러너 인증 (사용자 결정 2026-11-06)**
- 지금: 러너가 고정 문자열 `signature: "device-auth-signature"`를 보내고(`apps/local-runner/src/client.ts:42`), `RunnerGateway`는 아는 `deviceId`면 서명 확인 없이 통과시킨다. 새 `PICK_FOLDER_RESULT`가 허가 목록에 경로를 넣으므로 이 구멍을 막아야 한다.
- 바꿀 것: 페어링 교환(`/runner/pairings/redeem`) 때 서버가 기기마다 무작위 비밀값(32바이트)을 한 번만 발급 → 러너는 로컬 설정 파일에 저장, 서버는 해시가 아닌 검증 가능한 형태로 보관(HMAC 검증에 원문 필요 — 저장 방식은 빌더 재량, 단 응답·로그에 다시 나오지 않게).
- 접속 시 서버의 `CHALLENGE` 난수에 러너가 `HMAC-SHA256(secret, nonce)`로 답하고, 서버는 `timingSafeEqual`로 확인. 실패하면 `AUTH_FAILURE` 후 연결 종료.
- 기존에 페어링된 기기는 다시 페어링해야 한다(안내 문구 표시).

## 6. 검증
- 작업마다 vitest 테스트(API는 `server.inject`, 어댑터는 `execFile`/`fetch` 대역).
  - 1b: 검색어로 제목·내용 필터, 결과 없음, 비우면 복원.
  - 2: 모델 목록 파싱(`agy models`, `claude auth status` 출력 고정값), 목록에 없는 모델 400, 실제 CLI 인자에 `--model`·`cwd` 포함, 활성 폴더 없으면 거부.
  - 3: `PICK_FOLDER` 왕복, 취소, 시간 초과, 러너 오프라인.
  - 4: `api-key` 엔드포인트 501, 연결 화면에 등록 폼 없음.
  - 5: 잘못된 `aud`/만료 토큰 거부, 허용 목록 밖 이메일 403, `ALLOWED_EMAILS` 비면 거부, 세션 없는 요청 401, 로그아웃 후 401, 잘못된 HMAC 러너 거부.
  - 0: `..` 경로 404.
- 화면은 실행 중인 앱에서 직접 확인. 실행 못 한 항목은 unverified로 보고.

## 7. 빌더에게 남긴 것
- Codex 비대화형 실행 명령의 정확한 형태.
- Antigravity 모델 id에 추론 강도가 붙어 있는 것(`…-low/-medium/-high`)을 그대로 나열할지, 기본 이름으로 묶고 강도 선택과 합칠지.
- 설정 화면 안의 "작업 폴더"·"AI 연결"·"계정" 배치.
- 러너 비밀값의 서버 측 보관 형태.

## 8. 내가 정한 것 (사용자 확인용)
- Codex 모델 목록은 빌더가 오늘 기준 공식 문서로 조사(출처·날짜 기록).
- API 키 엔드포인트는 삭제 대신 501.
- 구독 목록에 "조치 필요" 경고 점만 표시.
- 첫 로그인 사용자가 기존 Default Workspace(지난 대화)를 이어받음.
- `ALLOWED_EMAILS`가 비면 로그인 전부 거부.
