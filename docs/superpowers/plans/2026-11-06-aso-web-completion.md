# ASO Web 완성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자의 구독 CLI(Claude Code·Antigravity·Codex)를 고른 모델·폴더로 실제 실행하고, 허용된 Google 계정만 쓰게 하며, 가짜·불필요 UI를 걷어낸다.

**Architecture:** 모든 CLI 호출을 주입 가능한 `CliRunner`(`execFile` 래퍼)로 모으고, 모델 목록은 연결(`ProviderConnection.metadata.models`)에 저장해 `/models`로 내보낸다. 실행 요청은 `connectionId`·`model`·`effort`를 명시하고 서버가 활성 작업 폴더를 `cwd`로 넘긴다. 폴더 선택은 HMAC 인증된 러너가 WebSocket으로 OS 창을 띄운다. 로그인은 Google ID 토큰 검증 + httpOnly 세션 쿠키.

**Tech Stack:** Node 22, TypeScript, Fastify 5, ws, zod, vitest, 바닐라 JS(`apps/web/public`).

**Spec:** `docs/superpowers/specs/2026-11-06-aso-web-completion-design.md`

## Global Constraints

- 새 npm 의존성 금지. Node 내장(`crypto`, `child_process.execFile`, `fetch`)만.
- `apps/web/public`은 빌드 없는 바닐라 JS. 프레임워크 금지.
- CLI 호출은 전부 `execFile` 인자 배열. 셸 문자열(`exec`) 금지.
- 모델은 요청마다 플래그로만 지정. CLI 전역 설정(`~/.claude`, `~/.codex`, `~/.gemini`)을 쓰거나 바꾸지 않는다.
- CLI 자격 증명 파일(`.credentials.json`, `auth.json`)을 읽지 않는다. 공식 CLI 명령 출력만.
- 비밀값(세션 토큰, 러너 `authSecret`)은 응답·로그·이벤트에 다시 나오지 않는다(발급 응답 1회 제외).
- 화면 문구는 한국어 대화체(~요).
- 확인 못 한 걸 확인된 것처럼 표시하지 않는다(Codex 요금제 → "요금제 확인 안 됨").
- 테스트는 실제 CLI·네트워크 없이 돈다(가짜 `CliRunner`, 가짜 `fetch`).
- 작업 순서 조정: 러너 인증(Task 9)을 폴더 선택(Task 10) 앞에 둔다 — `PICK_FOLDER_RESULT`가 허가 목록에 경로를 넣기 때문.

## Review Focus

1. **한글·공백이 든 Windows 경로** (이 저장소 자체가 `C:\Users\aicam\Desktop\수업_AX_W\…`): 폴더 창 결과와 `cwd`가 깨지지 않아야 한다 → Task 10에 UTF-8 한글 경로 파싱 테스트.
2. **따옴표·`&`·`|`·`$()`·줄바꿈이 든 프롬프트**: 그대로 한 인자로 전달돼야 한다. 특히 Windows npm `.cmd` 래퍼(`claude`, `codex`)는 셸 없이 실행할 수 없어 셸로 돌리기 쉬운데, 그러면 인자가 다시 해석된다 → Task 4에 인자 보존 테스트 + 래퍼 대상 해석 테스트.
3. **지난번에 고른 모델이 더 이상 없음**(CLI 제거·요금제 변경): 서버는 400, 화면은 첫 모델로 되돌림 → Task 7 400 테스트, Task 8 브라우저 확인 단계.
4. **쓰는 중 세션 만료**: 조용히 깨지지 말고 로그인 화면으로 → Task 13 만료 401 테스트, Task 14 401 처리.
5. **폴더 창이 떠 있는 동안 러너 연결 끊김**: 2분 기다리지 말고 바로 "offline" → Task 10 테스트.

---

### Task 1: 보안 선결 — 정적 서버 경로 탈출 차단, `.env` 무시

**Files:**
- Modify: `apps/web/src/server.ts:17-28`
- Modify: `.gitignore`
- Test: `tests/aso-web/web-static.test.ts` (Create)

**Interfaces:**
- Produces: `createWebServer()` 시그니처 그대로.

- [ ] **Step 1: 실패 테스트**

```ts
// NODE_ENV=test 상태에서 import (listen 안 함)
it("rejects paths that escape public/", async () => {
  const s = await createWebServer();
  const res = await s.inject({ method: "GET", url: "/../src/server.ts" });
  expect(res.statusCode).toBe(404);
  expect(res.body).not.toContain("import fs");
});
it("still serves index.html at /", async () => {
  const res = await (await createWebServer()).inject({ method: "GET", url: "/" });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("text/html");
});
```

- [ ] **Step 2:** `npx vitest run tests/aso-web/web-static.test.ts` → 첫 테스트 FAIL(200, 소스 노출).
- [ ] **Step 3:** `path.resolve(PUBLIC_DIR, "." + decodeURIComponent(reqPath))`가 `PUBLIC_DIR + path.sep`로 시작하지 않으면 404 `Not Found`. 디코드 실패도 404. `.gitignore`에 `.env` 한 줄(`.env.example`은 무시하지 않음).
- [ ] **Step 4:** 테스트 PASS. `git check-ignore .env` 출력이 `.env`.
- [ ] **Step 5: Commit** `fix(web): block path traversal in static server; ignore .env`

---

### Task 2: 안 쓰는 UI 정리

**Files:**
- Modify: `apps/web/public/index.html:265-283` (마이크·음성 모드 버튼)

- [ ] **Step 1:** `title="음성 입력"`, `title="음성 모드"` 버튼 두 개와 그 주석을 지운다.
- [ ] **Step 2:** 검증: `grep -c "음성" apps/web/public/index.html` → `0`. `node --check apps/web/public/app.js` 통과.
- [ ] **Step 3:** `onclick`도 `addEventListener` 대상(id)도 없는 `<button>`을 index.html에서 찾아 목록(줄 번호·라벨)으로 작업 보고에 남긴다. **지우지 않는다.**
- [ ] **Step 4: Commit** `chore(web): remove unused voice buttons`

---

### Task 3: 최근 항목 검색

**Files:**
- Create: `apps/web/public/session-search.js`
- Modify: `apps/web/public/index.html` (사이드바 검색칸, `<script type="module" src="/session-search.js">`)
- Modify: `apps/web/public/app.js:1073` (`focusSearchInput`), `renderSidebarSessions` 호출부
- Test: `tests/aso-web/session-search.test.ts`

**Interfaces:**
- Produces (ESM export + `window`에 같은 이름으로 할당):
  - `filterSessions(sessions: Session[], query: string): Session[]` — `Session = { id, title, runs: { rawRequest: string }[] }`. 대상 = `title` + 각 `runs[].rawRequest`. 대소문자 무시, 앞뒤 공백 제거, 빈 질의면 원본 그대로.
  - `highlightMatch(text: string, query: string): string` — HTML 이스케이프 후 일치 부분을 `<mark>`로 감싼 문자열.

- [ ] **Step 1: 실패 테스트**

```ts
const s = [
  { id: "a", title: "로그인 화면", runs: [{ rawRequest: "로그인 화면 만들어줘" }] },
  { id: "b", title: "모델 선택", runs: [{ rawRequest: "Opus로 바꿔줘" }] },
];
it("matches title", () => expect(filterSessions(s, "로그인").map(x => x.id)).toEqual(["a"]));
it("matches message body, case-insensitive", () => expect(filterSessions(s, "opus").map(x => x.id)).toEqual(["b"]));
it("empty query returns all", () => expect(filterSessions(s, "  ")).toHaveLength(2));
it("no match returns empty", () => expect(filterSessions(s, "없는말")).toEqual([]));
it("highlight escapes html", () => expect(highlightMatch("<b>Opus</b>", "opus")).toBe("&lt;b&gt;<mark>Opus</mark>&lt;/b&gt;"));
```

- [ ] **Step 2:** 실행 → FAIL(모듈 없음).
- [ ] **Step 3:** `session-search.js` 구현. 정규식 특수문자는 이스케이프.
- [ ] **Step 4:** 테스트 PASS.
- [ ] **Step 5:** 화면 연결: "검색" 버튼이 "최근 항목" 위 `<input id="sidebar-search-input">`을 열고 포커스. `input` 이벤트마다 마지막으로 불러온 세션(`gon.sessions_cache`와 같은 배열)을 `filterSessions`로 걸러 렌더, 제목은 `highlightMatch`. 결과 0개면 "검색 결과가 없어요". `Esc` 또는 빈 값이면 원래 목록 + 입력칸 닫기.
- [ ] **Step 6:** 브라우저(실행 중인 :3000)에서 검색어 입력 → 목록이 줄어듦, `Esc` → 복원 확인.
- [ ] **Step 7: Commit** `feat(web): search recent items`

---

### Task 4: `CliRunner` 도입 + Claude 어댑터 (모델·강도·cwd, 셸 주입 제거)

**Files:**
- Create: `packages/provider-adapters/src/cli-runner.ts`
- Modify: `packages/provider-adapters/src/types.ts`, `claude-provider.ts`, `index.ts`
- Test: `tests/aso-web/claude-provider.test.ts`

**Interfaces:**
- Produces:
  - `type CliRunner = (cmd: string, args: string[], opts: { cwd?: string; timeoutMs: number }) => Promise<{ stdout: string; stderr: string }>`
  - `export const defaultCliRunner: CliRunner` — `execFile`(`windowsHide: true`, `encoding: "utf8"`, `maxBuffer: 10MB`, **`shell: false`**). 실행 전 `resolveCliCommand`로 실제 실행 파일을 찾는다.
  - `resolveCliCommand(name: string, platform = process.platform): Promise<{ cmd: string; prefixArgs: string[] }>` — win32에서 `where <name>` 결과에 `.exe`가 있으면 그것, 없고 `.cmd` 래퍼만 있으면 래퍼 마지막 줄의 `"%dp0%\…"` 대상을 래퍼 폴더 기준으로 풀어서 `.exe`면 `{cmd: exe, prefixArgs: []}`, `.js`면 `{cmd: process.execPath, prefixArgs: [js]}`. 그 밖의 OS는 `{cmd: name, prefixArgs: []}`. 결과는 이름별로 캐시. (실측 2026-11-06: `claude.cmd` → `node_modules\@anthropic-ai\claude-code\bin\claude.exe`, `codex.cmd` → `node_modules\@openai\codex\bin\codex.js`, `agy` → `agy.exe`) — `.cmd`를 셸로 실행하면 인자가 다시 셸 해석되므로 금지.
  - `type Effort = "low" | "medium" | "high"`
  - `ChatExecutionContext`에 `cwd?: string; effort?: Effort` 추가. `TaskExecutionContext`에 `model?: string; effort?: Effort; cwd?: string` 추가.
  - `new ClaudeProvider(run: CliRunner = defaultCliRunner)`
- 인자 규칙: `["-p", prompt, "--output-format", "json", ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])]`, `cwd`는 opts로.
- `usage.model` = 넘긴 `model`(없으면 `null`).

- [ ] **Step 1: 실패 테스트** (가짜 runner가 받은 인자를 기록, `{"result":"hi","usage":{...}}` 반환)

```ts
it("passes model, effort and cwd as separate args", async () => {
  const calls: any[] = [];
  const p = new ClaudeProvider(async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { stdout: '{"result":"hi"}', stderr: "" }; });
  const r = await p.executeChat({ runId: RID, workspaceId: WID, prompt: 'a "b" & c | $(d)\nnext', model: "opus", effort: "high", cwd: "C:\\x\\수업" });
  expect(calls[0].cmd).toBe("claude");
  expect(calls[0].args).toEqual(["-p", 'a "b" & c | $(d)\nnext', "--output-format", "json", "--model", "opus", "--effort", "high"]);
  expect(calls[0].opts.cwd).toBe("C:\\x\\수업");
  expect(r.usage.model).toBe("opus");
});
```

  + `resolveCliCommand` 테스트: 고정 래퍼 텍스트(위 두 줄)와 가짜 `where` 출력으로 `.exe` 대상 / `.js` 대상(`cmd === process.execPath`) / `"linux"`면 이름 그대로.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** 구현. 기존 사용량 한도(`usage_limit_reached`) 처리 동작은 유지. `exec`·`< NUL`·따옴표 이스케이프 코드 삭제. `execute()`(작업 실행)도 같은 runner·인자 규칙 사용.
- [ ] **Step 4:** PASS + `npm run test:aso-web` 기존 테스트 통과.
- [ ] **Step 5: Commit** `fix(providers): run claude via execFile with model, effort and cwd`

---

### Task 5: Antigravity 어댑터 정리 + Codex 어댑터

**Files:**
- Modify: `packages/provider-adapters/src/agy-provider.ts`
- Create: `packages/provider-adapters/src/codex-provider.ts`
- Modify: `packages/provider-adapters/src/provider-registry.ts`, `index.ts`
- Test: `tests/aso-web/agy-codex-provider.test.ts`

**Interfaces:**
- Consumes: `CliRunner`, `Effort` (Task 4).
- Produces:
  - `new AgyProvider(run?: CliRunner)` — 인자 `["-p", prompt, "--model", model]`. 강도는 모델 id에 이미 붙어 있으므로(`…-low/-medium/-high`) `--effort`를 넘기지 않는다. 기본 모델 하드코딩(`gemini-3.8-flash-low`)은 model 미지정 때만.
  - `new CodexProvider(run?: CliRunner)` — `name = "codex-provider"`. 채팅: `["exec", "--skip-git-repo-check", "-s", "read-only", ...(model ? ["-m", model] : []), prompt]`; 작업 실행: `-s workspace-write`. `--dangerously-bypass-approvals-and-sandbox` 절대 금지. 출력 = stdout trim. `usage.provider = "openai"`, `connectionMode = "LOCAL_NATIVE_CLI"`. 토큰은 측정할 수 없고 스키마가 정수를 요구하므로 토큰 칸은 0, 대신 `costConfidence: "unavailable"`, `measuredCostUsd: null`, `source: "codex-cli (tokens not measured)"`로 측정 안 됨을 명시(길이로 추정하지 않는다).
  - **가짜 답변 제거(사용자 요청 2026-11-06: "비서 에이전트 Gon" 말투 없애고 연결한 AI가 답하는 그대로)**: `agy-provider.ts`의 `fallbackReplies`(미리 쓴 "AI 비서 Gon입니다" 답변·지어낸 토큰 수)와 빈 출력 때의 인사말을 삭제한다. CLI 실패·빈 출력은 `ProviderCallError(provider: string, message: string)`를 던지고, Orchestrator가 `run:failed`로 `"<AI 이름> 호출에 실패했어요: <이유>"`를 남긴다(세 어댑터 공통). 프롬프트에 Gon 페르소나를 덧붙이지 않는다. `mock-provider.ts`의 인사말도 Gon을 빼고 중립 문구로.
  - `ProviderRegistry.forConnection(provider: ProviderName): IProviderAdapter` — `anthropic→claude`, `google→agy`, `openai→codex`.
  - `new ProviderRegistry(run?: CliRunner)` — 세 어댑터에 같은 runner 전달.

- [ ] **Step 1: 실패 테스트**: agy 인자에 `--model gemini-4-argon-high`, cwd 전달 / codex 채팅 인자가 위 배열과 같고 `--dangerously` 문자열이 어디에도 없음 / `forConnection("openai")`가 `CodexProvider` / agy runner가 throw하거나 빈 stdout이면 `executeChat`이 `ProviderCallError`를 던짐(응답 문자열에 "Gon" 없음) / `grep -rn "비서\|Gon입니다" packages apps` 결과 없음.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(providers): add codex adapter and connection-based resolution`

---

### Task 6: 모델 목록 수집 + `GET /models`

**Files:**
- Create: `packages/provider-adapters/src/model-discovery.ts`
- Create: `config/model-catalog.json`
- Modify: `packages/provider-adapters/src/subscription-detector.ts`, `packages/contracts/src/provider.ts`
- Modify: `apps/api/src/routes/providers.ts`, `apps/api/src/server.ts` (`ApiServerOptions.cliRunner?: CliRunner`)
- Test: `tests/aso-web/model-discovery.test.ts`

**Interfaces:**
- Produces (contracts):
  - `ModelOptionSchema = z.object({ id: z.string(), label: z.string() })`
  - `ConnectionModelsSchema = z.object({ plan: z.string().nullable(), planVerified: z.boolean(), efforts: z.array(z.enum(["low","medium","high"])), models: z.array(ModelOptionSchema), source: z.string(), refreshedAt: z.string().datetime() })` — `metadata.models`에 저장.
- Produces (provider-adapters):
  - `parseAgyModels(stdout: string): ModelOption[]` — `Fetching…` 같은 탭 없는 줄은 버림, `id<TAB>label`.
  - `parseClaudeAuthStatus(stdout: string): { loggedIn: boolean; subscriptionType: string | null }`
  - `loadModelCatalog(file = path.resolve(process.cwd(), "config/model-catalog.json")): ModelCatalog`
  - `discoverModels(provider: ProviderName, run: CliRunner, catalog: ModelCatalog): Promise<ConnectionModels>`
    - google: `agy models` → `planVerified: true`, `plan: null`, `efforts: []`, `source: "agy models"`
    - anthropic: `claude auth status` → `plan: subscriptionType`, `planVerified: subscriptionType !== null`, models = 카탈로그 `claude.models`, `efforts: ["low","medium","high"]`, `source: "claude auth status + catalog"`
    - openai: 카탈로그 `codex.models`, `plan: null`, `planVerified: false`, `efforts: []`, `source: "catalog <checkedAt>"`
    - CLI 실패 → `models: []`(목록을 지어내지 않음)
  - `SubscriptionDetector(run?: CliRunner, catalog?)` — 설치 감지 때 `connectionView.metadata.models = await discoverModels(...)`.
- `config/model-catalog.json`:
  ```json
  { "claude": { "source": "https://code.claude.com/docs/en/model-config", "checkedAt": "2026-11-06",
                "models": [{"id":"opus","label":"Opus"},{"id":"sonnet","label":"Sonnet"},{"id":"haiku","label":"Haiku"}] },
    "codex":  { "source": "https://developers.openai.com/codex/models", "checkedAt": "2026-11-06", "models": [] } }
  ```
  `codex.models`는 빌더가 그 페이지를 열어 `-m`에 넣는 정확한 id와 표시명으로 채운다(지어내지 않는다; 확인 못 하면 빈 배열로 두고 보고).
- Route: `GET /api/v1/workspaces/:workspaceId/models` → `{ subscription: Array<{ connectionId, provider, displayName, plan, planVerified, efforts, models }> }` — `mode === "LOCAL_NATIVE_CLI"`이고 `status === "connected"`인 연결만. `detect-subscriptions`는 기존 연결도 `metadata.models` 갱신(`db.providers`에 `updateMetadata(id, metadata)` 추가).

- [ ] **Step 1: 실패 테스트**: 실제 출력 고정값으로 파서 테스트

```ts
const AGY = "Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n";
expect(parseAgyModels(AGY)).toEqual([{ id: "gemini-4-argon-high", label: "Gemini 4 Argon (High)" }, { id: "claude-opus-5-5-low", label: "Claude Opus 5.5 (Low)" }]);
expect(parseClaudeAuthStatus('{"loggedIn":true,"subscriptionType":"pro"}')).toEqual({ loggedIn: true, subscriptionType: "pro" });
```
  + `discoverModels("openai", …)`가 `planVerified: false` / agy runner가 throw하면 `models: []` / `createApiServer({ cliRunner: fake })` 후 `detect-subscriptions` → `GET /models`에 anthropic `plan: "pro"`와 `opus` 포함.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(api): discover subscription models per connection`

---

### Task 7: 실행 요청에 연결·모델·강도, 작업 폴더를 `cwd`로

**Files:**
- Modify: `packages/contracts/src/run.ts` (`CreateRunDTOSchema`)
- Create: `apps/api/src/services/workspace-path.ts`
- Modify: `apps/api/src/routes/runs.ts:20-60`, `apps/api/src/services/orchestrator-service.ts`
- Modify: `packages/provider-adapters/src/provider-registry.ts` (`includes("sonnet")` 문자열 추측 삭제, `auto`/`mock`만 남김)
- Test: `tests/aso-web/run-model-selection.test.ts`

**Interfaces:**
- Consumes: `forConnection` (Task 5), `metadata.models` (Task 6).
- Produces:
  - `CreateRunDTOSchema`에 `connectionId: z.string().uuid().optional()`, `model: z.string().optional()`, `effort: z.enum(["low","medium","high"]).optional()`. `runContext`에 `{ connectionId, model, effort, cwd }` 저장. 요청 본문의 `workspacePath`는 더 이상 실행에 쓰지 않는다.
  - `resolveActiveWorkspacePath(db: IDatabase, workspaceId: string): Promise<string | null>` — 워크스페이스의 러너 중 `activePath`가 그 기기 `allowedPaths`에 있고 디스크에 존재하는 첫 경로(OS 경로 형태로 반환).
- 검증(`connectionId`가 있을 때만; 없으면 기존 `auto` 동작 유지 — 기존 테스트가 MockProvider로 돎):
  - 연결 없음 → 400 `CONNECTION_NOT_FOUND`
  - `model`이 `metadata.models.models[].id`에 없음 → 400 `MODEL_NOT_AVAILABLE` "이 구독에서 쓸 수 없는 모델이에요"
  - `effort`가 연결 `efforts`에 없음 → 400 `EFFORT_NOT_SUPPORTED`
  - 활성 폴더 없음 → 400 `NO_WORKSPACE_FOLDER` "작업 폴더를 먼저 골라 주세요"
- Orchestrator: `runContext.connectionId`가 있으면 `forConnection(conn.provider)`를 채팅·`executePlan` 모두에 쓰고 `model`·`effort`·`cwd`를 컨텍스트로 넘긴다. `approvePlanAndExecute`도 같은 값을 `runContext`에서 다시 읽는다(지금은 provider를 잃어버림).

- [ ] **Step 1: 실패 테스트** (`createApiServer({ cliRunner: fake })`, 연결은 detect로 만들고 러너는 redeem + `paths` grant로 tmp 폴더 지정)
  - 목록에 없는 모델 → 400 `MODEL_NOT_AVAILABLE`
  - 활성 폴더 없는 워크스페이스 → 400 `NO_WORKSPACE_FOLDER`
  - 정상 요청 → 가짜 runner가 받은 호출이 `cmd: "claude"`, args에 `--model sonnet`, `opts.cwd` = 지정한 tmp 폴더, 기록된 `usage.model === "sonnet"`
  - `connectionId` 없는 기존 요청은 그대로 201
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS + `npm test` 전체 통과.
- [ ] **Step 5: Commit** `feat(api): run with selected subscription model in the active folder`

---

### Task 8: 채팅 모델 선택 화면

**Files:**
- Modify: `apps/web/public/index.html:285-350` (하드코딩 `<li>` 삭제, 빈 `<ul id="popover-model-list">`만 남김)
- Modify: `apps/web/public/app.js` (`selectModelItem`, `selectModelEffort`, run 생성 본문 `:1839` 부근)

**Interfaces:**
- Consumes: `GET /models` (Task 6), `CreateRunDTO` 새 필드 (Task 7).
- 상태: `localStorage` 키 `gon.model_selection` = `{ connectionId, model, effort }`. 목록에 없으면 첫 연결의 첫 모델로 교체.
- 렌더: "구독" 제목 아래 AI별 묶음(로고 `/logos/<provider>.svg` + `displayName`, 요금제가 `planVerified`면 `plan`, 아니면 "요금제 확인 안 됨"), 그 아래 모델. 강도 버튼 줄은 선택 연결의 `efforts`가 비어 있으면 숨김. 버튼 라벨 = 모델 label(+ 강도).
- 연결 0개 → 팝오버에 "연결된 AI가 없어요" + 연결 화면으로 가는 버튼.
- 실행 요청 본문에 `connectionId`·`model`·`effort`를 넣고 `providerPreference`는 보내지 않는다. 400 응답은 `error.message`를 토스트로.
- **답변 표시(사용자 요청 2026-11-06)**: 답변 말풍선의 아바타(`app.js:1760`, `:2302`의 `/logo.webp` "Gon")를 그 답을 낸 AI의 로고(`/logos/<usage.provider 기준>.svg`)와 이름으로 바꾼다. 대기 문구(`app.js:1808` "Gon이 답변을 작성하고 있습니다...")는 `"<선택한 AI 이름>가 답변을 쓰고 있어요…"`. 지난 대화는 `chat:response` 이벤트의 `usage.provider`로 로고를 고른다. 앱 이름·사이드바 브랜드 "Gon"은 그대로 둔다.

- [ ] **Step 1:** 구현.
- [ ] **Step 2:** `node --check apps/web/public/app.js`.
- [ ] **Step 3:** 브라우저 확인: 답변 말풍선에 그 AI의 로고·이름이 나오고 "Gon" 문구가 없음, 팝오버에 실제 구독 모델만 나옴(하드코딩 "Claude 3.7 Sonnet" 없음), Claude 선택 시 강도 줄 보임·Antigravity 선택 시 숨김, `localStorage`의 `gon.model_selection.model`을 없는 값으로 바꾸고 새로고침 → 첫 모델로 돌아옴, 채팅 1회 전송 후 사용량 화면에 고른 모델명.
- [ ] **Step 4: Commit** `feat(web): subscription-based model picker`

---

### Task 9: 러너 HMAC 인증

**Files:**
- Modify: `packages/execution-protocol/src/crypto.ts`, `packages/contracts/src/runner.ts`
- Modify: `packages/database/src/memory-database.ts:304-326` (`redeemPairingCode`)
- Modify: `apps/api/src/routes/runner.ts`, `apps/api/src/services/runner-gateway.ts`
- Modify: `apps/local-runner/src/client.ts:30-45`, `apps/local-runner/src/cli.ts:20-60`, `apps/local-runner/src/config.ts`
- Test: `tests/aso-web/runner-auth.test.ts`

**Interfaces:**
- Produces:
  - `signChallenge(secret: string, nonce: string): string` — `HMAC-SHA256` hex.
  - `verifyChallenge(secret: string, nonce: string, signature: string): boolean` — 길이 다르면 false, 아니면 `timingSafeEqual`.
  - `RunnerDeviceSchema`에 `authSecret: z.string().optional()`. `toRunnerView(device: RunnerDevice): Omit<RunnerDevice, "authSecret">` — runner 라우트의 모든 응답이 이걸 거친다.
  - redeem이 `crypto.randomBytes(32).toString("hex")`를 저장하고 응답 `authSecret`에 **한 번만** 담는다.
  - `RunnerLocalConfig`에 `authSecret: string`. 페어링 CLI가 응답값을 저장. 설정에 없으면 접속하지 않고 "다시 페어링해 주세요: aso-runner pair <코드>" 출력.
  - Gateway: `AUTH_REQUEST.payload.nonce`가 이 연결에 보낸 nonce와 같고 `verifyChallenge`가 참일 때만 성공. 그 밖은 `AUTH_FAILURE`(`authSecret` 없는 옛 기기는 `"다시 페어링해 주세요"`) 후 `close`.

- [ ] **Step 1: 실패 테스트**: `verifyChallenge` 참/거짓/길이 다름 / redeem 응답에 `authSecret` 있고 `GET …/runners` 응답 문자열에는 그 값이 없음 / 실제 `listen(0)` 서버에 `ws`로 접속해 올바른 서명 → `AUTH_SUCCESS`, `"device-auth-signature"` → `AUTH_FAILURE` + close, 다른 nonce 서명 → `AUTH_FAILURE`.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5: Commit** `fix(runner): authenticate runners with HMAC challenge`

---

### Task 10: `PICK_FOLDER` — 러너가 OS 폴더 창을 띄움

**Files:**
- Modify: `packages/execution-protocol/src/messages.ts`
- Create: `apps/local-runner/src/folder-picker.ts`
- Modify: `apps/local-runner/src/client.ts`, `apps/api/src/services/runner-gateway.ts`, `apps/api/src/routes/runner.ts`
- Test: `tests/aso-web/pick-folder.test.ts`

**Interfaces:**
- Consumes: 인증된 연결 맵(Task 9).
- Produces:
  - 메시지 타입 `"PICK_FOLDER"` `{ requestId: string }`, `"PICK_FOLDER_RESULT"` `{ requestId: string; path?: string; cancelled?: boolean; unsupported?: boolean }`.
  - `pickFolder(run: CliRunner = defaultCliRunner, platform = process.platform): Promise<{ path: string } | { cancelled: true } | { unsupported: true }>` — win32만: `powershell -NoProfile -STA -Command <script>`. 스크립트는 `[Console]::OutputEncoding=[Text.Encoding]::UTF8`, `System.Windows.Forms.FolderBrowserDialog`, OK면 `SelectedPath` 출력, 아니면 빈 출력. 빈 출력 → cancelled.
  - `RunnerGateway.requestFolderPick(deviceId: string, timeoutMs = 120_000): Promise<{ status: "picked"; path: string } | { status: "cancelled" | "unsupported" | "timeout" | "offline" }>` — 미접속이면 즉시 `offline`, 기다리는 중 소켓이 닫히면 즉시 `offline`.
  - `POST /api/v1/workspaces/:workspaceId/runners/:deviceId/pick-folder` → picked: `addAllowedPath(deviceId, path, true)` 후 200 `{ activePath, allowedPaths }`; cancelled: 200 `{ cancelled: true }`; offline: 409 `RUNNER_OFFLINE` "PC의 러너를 켜 주세요"; unsupported: 422 "이 OS에서는 아직 폴더 창을 못 띄워요"; timeout: 504.
  - 기기가 그 워크스페이스 소속이 아니면 404.

- [ ] **Step 1: 실패 테스트**
  - `pickFolder(fakeRun→"C:\\Users\\aicam\\Desktop\\수업_AX_W\\gon\r\n", "win32")` → `{ path: "C:\\Users\\aicam\\Desktop\\수업_AX_W\\gon" }`; 빈 출력 → cancelled; `"linux"` → unsupported(runner 호출 없음).
  - ws 가짜 러너(인증 후 `PICK_FOLDER`에 경로로 답함) → 라우트 200, `activePath` 일치.
  - 가짜 러너가 답하지 않고 소켓을 닫음 → 2분이 아니라 1초 안에 409.
  - 러너 미접속 → 409. `timeoutMs` 50으로 줄인 gateway 단위 테스트 → `timeout`.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 수동 확인(Windows): 러너 실행 후 라우트 호출 → 실제 폴더 창이 뜨고 고른 한글 경로가 응답에 그대로.
- [ ] **Step 6: Commit** `feat(runner): pick workspace folder with native dialog`

---

### Task 11: 워크스페이스 화면 단순화

**Files:**
- Modify: `apps/web/public/index.html:643-718` (워크스페이스 모달 삭제), 설정 모달(`:578`)에 "작업 폴더" 구역 추가
- Modify: `apps/web/public/app.js` (`openWorkspaceFolderModal` → `pickWorkspaceFolder`, 모달 관련 함수 삭제, `UsersaicamDesktop` 필터 삭제)
- Modify: `apps/api/src/routes/runner.ts` (`UsersaicamDesktop` 필터 3곳 삭제)

**Interfaces:**
- Consumes: `pick-folder` 라우트 (Task 10).
- `pickWorkspaceFolder()`: 버튼 비활성+"폴더 고르는 중…" → 응답 picked면 라벨을 폴더 이름으로, cancelled면 원래대로, 409면 토스트 "PC의 러너를 켜 주세요" + 러너 화면 이동 버튼, 422/504는 메시지 토스트.
- 설정 → 작업 폴더: 연결된 PC(이름·온라인 여부·기기 해제), 허가 폴더 목록(삭제), "폴더 추가"(= `pickWorkspaceFolder`). 기존 API 그대로 사용.

- [ ] **Step 1:** 구현. **Step 2:** `grep -rn "UsersaicamDesktop" apps` → 결과 없음. `node --check` 통과. `npm run test:aso-web` 통과(`desktop-workspace.test.ts` 포함).
- [ ] **Step 3:** 브라우저: 폴더 버튼 → 모달 없이 OS 창 → 라벨 변경. 러너 끈 상태 → 안내 토스트. 설정 → 작업 폴더에서 삭제 동작.
- [ ] **Step 4: Commit** `feat(web): one-click workspace folder picker; manage folders in settings`

---

### Task 12: 연결 화면 정리 + 가짜 API 키 제거

**Files:**
- Modify: `apps/web/public/index.html:397-430` (API Key 카드·"BYOK Vault" 문구 삭제, 제목 "AI 구독 연결")
- Modify: `apps/web/public/app.js:2392-2467` (`registerApiKey` 삭제, `loadConnections` 렌더 단순화)
- Create: `apps/web/public/logos/anthropic.svg`, `google.svg`, `openai.svg`
- Modify: `apps/api/src/routes/providers.ts:63-85`
- Test: `tests/aso-web/subscriptions.test.ts` (추가)

**Interfaces:**
- `POST …/connections/api-key` → 501 `{ error: { code: "NOT_IMPLEMENTED", message: "API 키 연결은 준비 중이에요" } }`, DB에 아무것도 만들지 않음.
- 카드 = 로고 + `displayName`만. `status === "needs_action"`이면 작은 경고 점(`title`에 `details`). "구독 감지" 버튼은 유지.
- 로고는 각 사 공식 브랜드 자산에서 가져온 SVG(출처 URL을 파일 주석에).

- [ ] **Step 1: 실패 테스트**: api-key POST → 501, 이후 `GET /connections`에 `USER_API_KEY` 없음.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS. `grep -c "AES-256\|BYOK" apps/web/public/index.html` → 0.
- [ ] **Step 5:** 브라우저: 연결 화면에 로고+이름만.
- [ ] **Step 6: Commit** `feat(web): logo-only subscription list; drop fake API key form`

---

### Task 13: Google 로그인 — 서버

**Files:**
- Create: `apps/api/src/auth/google.ts`, `apps/api/src/auth/session.ts`, `apps/api/src/auth/routes.ts`
- Modify: `packages/contracts/src/workspace.ts` (`UserSchema.googleSub?`), `packages/database/src/types.ts` + `memory-database.ts` (`users.findByGoogleSub`, `sessions` 저장소)
- Modify: `apps/api/src/server.ts` (CORS, 인증 훅, `/me`), `apps/api/src/routes/runs.ts` (`createdBy` = 세션 사용자)
- Modify: `.env.example` (`GOOGLE_CLIENT_ID=`, `ALLOWED_EMAILS=`, `WEB_ORIGIN=http://localhost:3000`)
- Create: `tests/aso-web/helpers/auth.ts`; Modify: 기존 `createApiServer` 사용 테스트 3개
- Test: `tests/aso-web/auth.test.ts`

**Interfaces:**
- Produces:
  - `type GoogleIdentity = { sub: string; email: string; name: string | null }`
  - `verifyGoogleIdToken(credential: string, clientId: string, fetchFn: typeof fetch = fetch): Promise<GoogleIdentity>` — `https://oauth2.googleapis.com/tokeninfo?id_token=` 호출, `aud === clientId`, `iss ∈ {accounts.google.com, https://accounts.google.com}`, `exp*1000 > Date.now()`, `email_verified === "true"`. 실패 시 `AuthError`.
  - `ISessionRepository { create(userId: string, tokenHash: string, expiresAt: string): Promise<void>; findByTokenHash(h: string): Promise<{ userId: string; expiresAt: string } | null>; delete(h: string): Promise<void> }` — `IDatabase.sessions`.
  - 세션 토큰 = `randomBytes(32)` base64url, 저장은 SHA-256 hex, 7일. 쿠키 `aso_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`(쿠키 파싱은 직접 — 의존성 금지).
  - `ApiServerOptions.auth?: { googleClientId: string; allowedEmails: string[]; verifyIdToken?: (cred: string) => Promise<GoogleIdentity> }` — 기본값은 env(`GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS` 쉼표 분리·소문자·trim).
  - 라우트: `GET /api/v1/auth/config` → `{ googleClientId }`; `POST /api/v1/auth/google {credential}` → 200 `{ user }` + Set-Cookie / 401 검증 실패 / 403 `EMAIL_NOT_ALLOWED` "허용되지 않은 계정이에요"(허용 목록이 비어도 403); `POST /api/v1/auth/logout` → 세션 삭제 + 쿠키 만료; `GET /api/v1/me` → 세션 사용자.
  - `onRequest` 훅: `/api/v1/` 아래는 세션 필수(401 `UNAUTHENTICATED`), 예외 `/api/v1/auth/`, `/api/v1/runner/pairings/redeem`, `/api/v1/runner/ws`. `/health`는 원래 밖. `req.user` 설정.
  - CORS: `Access-Control-Allow-Origin = WEB_ORIGIN`(기본 `http://localhost:3000`), `Access-Control-Allow-Credentials: true`. `*` 삭제.
  - 로그인 성공 시 사용자의 워크스페이스에 프로젝트가 0개면 기본 프로젝트 생성. 워크스페이스 목록은 지금처럼 전부 반환(단일 소유자 — 기존 Default Workspace를 그대로 이어받음).
  - `helpers/auth.ts`: `createAuthedServer(opts?) → { server, db, inject(opts) }` — 가짜 `verifyIdToken`과 `allowedEmails: ["owner@test.local"]`로 로그인해 쿠키를 붙여 주는 `inject`.

- [ ] **Step 1: 실패 테스트** (`verifyGoogleIdToken`은 가짜 `fetchFn`으로)
  - `aud` 다름 / `exp` 지남 / `email_verified: "false"` → throw
  - 허용 목록 밖 이메일 → 403, 허용 목록 비었을 때 → 403
  - 쿠키 없이 `GET /api/v1/workspaces` → 401; 로그인 후 → 200; 로그아웃 후 같은 쿠키 → 401
  - 만료 시각이 지난 세션 → 401
  - `Set-Cookie`에 `HttpOnly`, `SameSite=Lax`; 응답 본문 어디에도 토큰 원문 없음
  - `OPTIONS` 응답의 Allow-Origin이 `*`가 아님
- [ ] **Step 2:** FAIL. **Step 3:** 구현 + 기존 테스트를 `createAuthedServer`로 전환. **Step 4:** `npm test` 전체 PASS.
- [ ] **Step 5: Commit** `feat(api): google sign-in with allow-list and session cookie`

---

### Task 14: 로그인 화면

**Files:**
- Modify: `apps/web/public/index.html` (로그인 화면 섹션), `apps/web/public/app.js`, `apps/web/public/style.css`

**Interfaces:**
- Consumes: Task 13 라우트.
- `apiFetch(url, opts)` = `fetch(url, { ...opts, credentials: "include" })` — `app.js`의 모든 `${API_URL}` 호출을 교체. `EventSource`는 `{ withCredentials: true }`.
- 시작 시 `GET /me` → 401이면 로그인 화면만 표시(나머지 초기화 중단). 어떤 API든 401이면 로그인 화면으로.
- 로그인 화면: `GET /auth/config`의 Client ID로 GIS 버튼 렌더(`https://accounts.google.com/gsi/client`), 콜백 credential을 `POST /auth/google`. 403이면 "허용되지 않은 계정이에요", Client ID 없으면 "GOOGLE_CLIENT_ID를 .env에 넣어 주세요".
- 프로필 메뉴에 "로그아웃".

- [ ] **Step 1:** 구현. **Step 2:** `node --check`.
- [ ] **Step 3:** 사용자 준비물 확인 후 브라우저 확인: (a) Google Console에 `http://localhost:3000` 원본 추가, (b) `.env`에 `GOOGLE_CLIENT_ID`·`ALLOWED_EMAILS`. 로그인 → 앱 진입 → 로그아웃 → 로그인 화면. 허용 안 된 계정 → 안내 문구. 준비물이 없으면 이 단계는 unverified로 보고.
- [ ] **Step 4: Commit** `feat(web): login screen with Google sign-in`

---

### Task 15: 스킬 카탈로그 화면을 `config/skill-catalog.json`에서 (사용자 요청 2026-11-06)

**Files:**
- Create: `apps/api/src/routes/skills.ts`; Modify: `apps/api/src/server.ts` (등록)
- Modify: `apps/web/public/index.html:484-540` (하드코딩 카드 6개 삭제, 빈 `<div class="skills-grid" id="skills-grid">`), 사이드바 `data-tab="skills"` 버튼에 `onclick="switchNavTab('skills')"`
- Modify: `apps/web/public/app.js` (`loadSkills()` — 탭 열 때 호출)
- Test: `tests/aso-web/skills-catalog.test.ts`

**Interfaces:**
- `GET /api/v1/skills` → `{ items: Array<{ id: string; name: string; description: string; source: string }> }` — `config/skill-catalog.json`을 매 요청 읽어서 변환(빌더가 파일의 실제 필드 이름에 맞춰 매핑). 파일이 없거나 깨졌으면 500이 아니라 `{ items: [] }` + 서버 로그.
- 화면: 카드 = `name` + `description` + `source` 배지. 0개면 "등록된 스킬이 없어요".

- [ ] **Step 1: 실패 테스트**: `GET /api/v1/skills` 응답에 `id === "mattpocock-skills:grilling"` 포함 / 카탈로그 경로를 없는 파일로 주면 `items: []`.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** 브라우저: 사이드바 "스킬" → grilling·superpowers 카드가 보임.
- [ ] **Step 6: Commit** `feat(web): skill catalog from config`

후속(이 계획 밖, 별도 설계): 웹에서 작업 요청 시 계획 전에 grilling식 질문(추천 답 포함) 라운드 — 사용자 결정 2026-11-06.

---

### Task 16: 마무리 검증

- [ ] **Step 1:** `npm run build` 성공, `npm test` 전체 통과(숫자 그대로 보고).
- [ ] **Step 2:** `ecc:security-reviewer`로 Task 1·4·9·10·13 변경 검토 → 지적 사항 수정.
- [ ] **Step 3:** 브라우저 끝까지 한 번: 로그인 → 폴더 선택 → 모델 선택 → 채팅 → 최근 항목 검색 → 로그아웃. 못 한 단계는 unverified.
- [ ] **Step 4:** Task 2에서 모은 "핸들러 없는 버튼" 목록을 사용자에게 보고.
