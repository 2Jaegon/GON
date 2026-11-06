# 에이전트 세션 코어 (Claude) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude 연결 + 작업 폴더가 있는 채팅 메시지를 `claude -p` 에이전트 세션(도구·스킬·플러그인 켬, 세션 이어가기, 승인 카드)으로 처리한다.

**Architecture:** `packages/provider-adapters`에 스트림 실행기·파서·승인 규칙 변환(`claude-agent.ts`)을 두고, `apps/api`의 `AgentService`가 실행 흐름(시작·승인 후 이어가기·중단)을 맡는다. 이벤트는 기존 SSE 이벤트(`chat:delta`, `chat:response`, `run:completed`, `run:failed`)를 재사용하고 `agent:*` 이벤트만 더한다. 화면은 순수 렌더 함수(`agent-ui.js`)와 `app.js` 리스너로 붙인다. 승인 상태는 DB 열 추가 없이 이벤트 기록(`agent:approval_needed`, `agent:done`)에서 읽는다.

**Tech Stack:** TypeScript, Node 내장 `child_process`, fastify, zod, vitest, 바닐라 JS.

**Spec:** `docs/superpowers/specs/2026-11-06-agent-session-design.md` (이미지 생성·Grilling은 이 계획 이후 별도 계획으로 이어진다: 계획 2 = 이미지 래퍼·카탈로그, 계획 3 = Grilling 지침·배지)

## Global Constraints

- 자동 허용 목록(정확히): `Read`, `Glob`, `Grep`, `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git log:*)`, `Bash(ls:*)`. 그 밖의 도구는 화면 승인 후에만 실행한다.
- 금지 목록(`--disallowedTools`, deny가 allow보다 우선): `Read(.env*)`, `Read(**/.env*)`, `Read(**/*.pem)`, `Read(**/id_rsa*)`.
- 권한 모드는 항상 `--permission-mode default`. `--setting-sources`는 넘기지 않는다(사용자·프로젝트·로컬 설정 모두 로드, 확정된 결정).
- 새 경로 진입 조건: 연결이 Claude(`anthropic`) + 작업 폴더가 있음 + 실행 모드가 `auto` 또는 `agent`. 그 밖(agy·codex, 명시적 `chat`/`fast`/`standard`/`deep`, 폴더 없음)은 기존 경로를 그대로 쓴다.
- 이벤트 없음 120초(`idleTimeoutMs=120000`)면 중단, 총 시간 상한은 `run.budget.maxWallTimeSeconds`(기본 1800초).
- 고정 문구: 승인 → `승인했어요. 계속하세요.` / 거절 → `거절했어요. 다른 방법을 제안하세요.` / 이어가기 실패 → `이전 대화를 이어가지 못해 새로 시작했어요`.
- 프로세스는 `shell:false`로 `resolveCliCommand("claude")`가 돌려준 실행 파일로 띄운다. 새 npm 의존성 금지. 화면 문구는 한국어 해요체.

## Review Focus

- 프롬프트가 `-`로 시작하거나 줄바꿈·따옴표를 포함해도 인자 하나로 `--` 뒤에 그대로 간다 (Task 2).
- 도구 입력(명령·경로)에 `<script>`·따옴표가 있어도 승인 카드에서 글자로만 보인다 (Task 6).
- `--resume` ID가 없어졌거나 틀려도 새 세션으로 시작하고 그렇다고 알려 준다 (Task 4).
- 120초 무응답이나 [중단]이면 프로세스가 실제로 종료되고 실행이 `failed`/`cancelled`로 끝난다 (Task 3).
- `command`·`file_path` 같은 필수 입력이 없는 거부 항목은 허용 규칙을 만들지 않는다(허용을 눌러도 그 항목은 계속 거부) (Task 2·4).

---

### Task 1: 계약 — `agent` 모드와 승인 DTO

**Files:**
- Modify: `packages/contracts/src/run.ts` (ExecutionModeSchema에 `"agent"` 추가, `AgentApprovalDTOSchema` 추가)
- Test: `tests/aso-web/contracts.test.ts`

**Interfaces:**
- Produces: `ExecutionModeSchema`가 `"agent"` 허용; `AgentApprovalDTOSchema = z.object({ decision: z.enum(["allow","deny"]) })`, `type AgentApprovalDTO`.

- [ ] **Step 1: Write the failing test** in `contracts.test.ts`: `CreateRunDTOSchema.safeParse({request:"x", executionMode:"agent"}).success === true`; `AgentApprovalDTOSchema.safeParse({decision:"allow"}).success === true`, `{decision:"maybe"}`와 `{}`는 false.
- [ ] **Step 2: Run** `npx vitest run tests/aso-web/contracts.test.ts` — Expected: FAIL (agent 미허용, 스키마 없음).
- [ ] **Step 3: Implement** the enum value and the DTO schema in `run.ts`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): add agent execution mode and approval DTO`.

### Task 2: 실행 인자·스트림 파서·승인 규칙 (순수 함수)

**Files:**
- Create: `packages/provider-adapters/src/claude-agent.ts`, `tests/aso-web/claude-agent.test.ts`, `tests/fixtures/claude-agent-read.jsonl`, `tests/fixtures/claude-agent-denied.jsonl`
- Modify: `packages/provider-adapters/src/index.ts` (`export * from "./claude-agent.js"`)

**Interfaces:**
- Produces (모두 `claude-agent.ts`에서 export):
  - `AGENT_SAFE_TOOLS: string[]`, `AGENT_DENIED_TOOLS: string[]` (Global Constraints의 정확한 값)
  - `interface AgentDenial { toolName: string; toolUseId: string; toolInput: Record<string, unknown> }`
  - `interface AgentResult { sessionId: string | null; text: string; isError: boolean; denials: AgentDenial[]; inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; costUsd: number | null; durationMs: number }`
  - `type AgentEvent = {kind:"init"; sessionId:string} | {kind:"text"; delta:string} | {kind:"tool"; id:string; name:string; input:Record<string,unknown>} | ({kind:"result"} & AgentResult)`
  - `interface AgentRunOptions { prompt: string; cwd: string; model?: string; effort?: Effort; resumeSessionId?: string; extraAllowed?: string[]; idleTimeoutMs?: number; maxWallMs?: number }`
  - `type AgentRunner = (opts: AgentRunOptions, onEvent: (e: AgentEvent) => void, signal: AbortSignal) => Promise<AgentResult>`
  - `buildAgentArgs(o: AgentRunOptions): string[]`
  - `parseAgentLine(line: string): AgentEvent[]` (무시할 줄·깨진 JSON은 `[]`)
  - `denialToRule(d: AgentDenial): string | null`
  - `describeDenial(d: AgentDenial): { tool: string; summary: string; danger: boolean; rule: string | null }`
  - `summarizeTool(name: string, input: Record<string, unknown>): string`
  - `isResumeFailure(message: string): boolean`

- [ ] **Step 1: 실제 CLI로 사전 확인 4가지** (임시 폴더에 `a.txt`를 만들고 실행). 결과를 코드 주석에 한 줄씩 남긴다.
  1. `claude -p "a.txt를 읽고 한 줄로 요약해줘" --model sonnet --effort low --output-format stream-json --verbose --include-partial-messages --permission-mode default --allowedTools Read Glob Grep -- "<프롬프트>"` 로 `--allowedTools` 뒤 여러 인자가 `--`에서 끝나는지(프롬프트가 인자로 먹히지 않는지) 확인.
  2. 같은 명령으로 "b.txt에 안녕을 써줘"를 보내 `result.permission_denials`를 얻는다.
  3. `--allowedTools "Write(<절대경로>)"`가 그 경로 쓰기를 허용하는지 Windows 경로 표기로 시험한다. 안 되면 `denialToRule`의 파일 도구 규칙은 도구 이름만(`Write`)으로 하고 이유를 주석에 쓴다.
  4. `claude -p hi --resume 00000000-0000-4000-8000-000000000000`의 오류 문구를 기록해 `isResumeFailure`의 판별 근거로 쓴다.
- [ ] **Step 2: 픽스처 저장.** 1·2번 출력에서 `system:init`(session_id만), `stream_event`(앞 3개), `assistant`, `result` 줄만 남겨 두 파일로 저장한다. 훅 출력(`system:hook_*`), 이메일·조직 ID, `credential_expires_at`는 반드시 지우고 cwd 경로는 `C:\work`로 바꾼다.
- [ ] **Step 3: Write the failing tests** (`claude-agent.test.ts`):
  - `buildAgentArgs`: 기본 인자 앞부분이 `["-p","--output-format","stream-json","--verbose","--include-partial-messages","--permission-mode","default"]`; `resumeSessionId`가 있으면 `--resume <id>`; `model`/`effort`는 각각 `--model`/`--effort`; `--allowedTools` 뒤에 `AGENT_SAFE_TOOLS` + `extraAllowed`, `--disallowedTools` 뒤에 `AGENT_DENIED_TOOLS`; 마지막 두 요소가 `["--", prompt]`이며 `prompt="--version\n\"x\""`도 그대로. `--setting-sources`가 없어야 한다.
  - `parseAgentLine`: 읽기 픽스처 → `init`(sessionId 비어 있지 않음), `text` 1개 이상, `result`(`isError:false`, `denials:[]`, `text` 비어 있지 않음, `sessionId` 일치); 거부 픽스처 → `result.denials[0].toolName === "Write"`; `parseAgentLine("not json")` → `[]`.
  - `denialToRule`: `{toolName:"Bash", toolInput:{command:"npm test"}}` → `"Bash(npm test)"`; 파일 도구 규칙은 Step 1-3 결과대로; `{toolName:"Bash", toolInput:{}}` → `null`.
  - `describeDenial`: `Bash` `rm -rf build`·`git push origin main`·`npm install x`는 `danger:true`, `npm test`는 `false`; `summary`는 160자 이하.
  - `isResumeFailure`: Step 1-4에서 기록한 실제 문구 → `true`, `"종료 코드 1로 끝났어요."` → `false`.
- [ ] **Step 4: Run** `npx vitest run tests/aso-web/claude-agent.test.ts` — Expected: FAIL (함수 없음).
- [ ] **Step 5: Implement** 위 시그니처대로. `parseAgentLine`은 `type:"system"+subtype:"init"`, `type:"stream_event"`의 `event.delta.text_delta`, `type:"assistant"`의 `message.content[]` 중 `tool_use`, `type:"result"`를 읽는다(필드 이름은 픽스처가 정본). 토큰은 `result.usage.input_tokens`·`output_tokens`·`cache_read_input_tokens`, 비용은 `total_cost_usd`.
- [ ] **Step 6: Run** the same command + `npm run build` — Expected: PASS, exit 0.
- [ ] **Step 7: Commit** `feat(providers): claude agent args, stream parser and approval rules`.

### Task 3: 프로세스 실행기 `runClaudeAgent`

**Files:**
- Modify: `packages/provider-adapters/src/claude-agent.ts`
- Test: `tests/aso-web/claude-agent-runner.test.ts`

**Interfaces:**
- Consumes: Task 2의 타입·`buildAgentArgs`·`parseAgentLine`, `resolveCliCommand`(cli-runner), `cliFailureMessage`.
- Produces: `runClaudeAgent(opts: AgentRunOptions, onEvent: (e: AgentEvent) => void, signal: AbortSignal, deps?: { spawn?: typeof import("node:child_process").spawn; resolve?: typeof resolveCliCommand }): Promise<AgentResult>` — `AgentRunner`에 대입 가능해야 한다.

- [ ] **Step 1: Write the failing tests** (가짜 자식 프로세스: `EventEmitter` + `stdout`/`stderr` `PassThrough` + `stdin.end` 스파이 + `kill` 스파이):
  - stdout에 init·text·result JSON 줄을 흘리면 `onEvent`가 순서대로 호출되고 반환값이 result와 같다. spawn 인자에 `shell:false`, `cwd:opts.cwd`가 있다.
  - 이벤트 없이 `idleTimeoutMs=20`이 지나면 `kill`이 호출되고 `Error("응답이 없어 중단했어요(무응답 시간 초과).")`로 reject.
  - `signal.abort()`하면 `kill` 호출 + `Error("중단했어요.")`로 reject.
  - result 없이 종료 코드 1 + stderr 마지막 줄 `Error: not logged in` → reject 메시지가 `Error: not logged in`.
- [ ] **Step 2: Run** `npx vitest run tests/aso-web/claude-agent-runner.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `runClaudeAgent`: `resolveCliCommand("claude")` → `spawn(cmd, [...prefixArgs, ...buildAgentArgs(opts)], {cwd, windowsHide:true, shell:false, stdio:["pipe","pipe","pipe"]})`, `stdin.end()`, stdout을 줄 단위로 `parseAgentLine`, 줄마다 무응답 타이머(`idleTimeoutMs ?? 120000`) 리셋, 총 시간 타이머(`maxWallMs ?? 1800000`), abort 시 `kill`. 오류 문구는 `cliFailureMessage`(stderr 마지막 줄·종료 코드)를 재사용한다.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(providers): run claude as a streaming agent with idle timeout and abort`.

### Task 4: `AgentService` (시작·승인 후 이어가기·중단)

**Files:**
- Create: `apps/api/src/services/agent-service.ts`
- Modify: `apps/api/src/services/orchestrator-service.ts` (생성자에 `agentRunner?: AgentRunner` 추가, `public readonly agent: AgentService`, `startRun` 맨 앞에 `if (run.executionMode === "agent") return this.agent.start(run);`)
- Test: `tests/aso-web/agent-service.test.ts`

**Interfaces:**
- Consumes: `AgentRunner`·`AgentEvent`·`AgentResult`·`describeDenial`·`isResumeFailure`(provider-adapters), `EventBus`, `IDatabase`.
- Produces:
  - `class AgentService { constructor(db: IDatabase, eventBus: EventBus, runner: AgentRunner = runClaudeAgent); start(run: Run): Promise<void>; resolveApproval(run: Run, decision: "allow"|"deny"): Promise<void>; cancel(runId: string): boolean }`
  - 이벤트(이름·payload): `run:classified {mode:"agent", reason, confidence:1}`, `chat:delta {delta, text, provider:"anthropic"}`(저장 안 함, `eventBus.publish`만), `agent:tool {id, name, summary}`, `agent:approval_needed {requestId, claudeSessionId, items:[{tool, summary, danger, rule}]}`, `agent:approval_resolved {requestId, decision, reason?}`, `agent:done {claudeSessionId, costUsd, inputTokens, outputTokens}`, `chat:response {text, usage}`, `run:completed {output, usage}`, `run:failed {error}`, `run:cancelled {}`.

- [ ] **Step 1: Write the failing tests** (`createDatabase(":memory:")`, 가짜 `AgentRunner`가 받은 `opts`를 기록, run은 `db.runs.create`로 만든다):
  - 정상: 러너가 text 이벤트 2개와 result(`text:"안녕"`, `sessionId:"S1"`)를 내면 이벤트 순서가 `run:classified` → `agent:done`(claudeSessionId "S1") → `chat:response` → `run:completed`, 상태 `completed`, 러너 `opts.cwd`는 `run.runContext.cwd`, `opts.prompt`는 `run.rawRequest`, 사용량 1건 기록(`provider:"anthropic"`).
  - 이어가기: 같은 `sessionId`·같은 `connectionId`의 이전 agent 실행이 `agent:done` "S1"을 남겼으면 새 실행의 `opts.resumeSessionId === "S1"`; `connectionId`가 다르면 `undefined`.
  - 이어가기 실패: 첫 시도(resumeSessionId 있음)가 `isResumeFailure` 문구로 reject하면 `resumeSessionId` 없이 한 번 더 호출하고, `chat:response`의 `text` 맨 앞 줄이 `이전 대화를 이어가지 못해 새로 시작했어요`이며 그 아래에 답이 이어진다.
  - 거부: result에 `denials:[{toolName:"Write", toolUseId:"t1", toolInput:{file_path:"/p/a.txt", content:"x"}}, {toolName:"Bash", toolUseId:"t2", toolInput:{command:"git push"}}]`면 `agent:approval_needed` 1개(items 2개, 둘째 `danger:true`), 상태 `awaiting_approval`, `run:completed` 없음.
  - 허용: `resolveApproval(run,"allow")` → `agent:approval_resolved {decision:"allow"}`, 러너 호출의 `opts.resumeSessionId`는 거부 때 `claudeSessionId`, `opts.extraAllowed`는 items의 `rule`들(null 제외), `opts.prompt === "승인했어요. 계속하세요."`. 규칙이 모두 null이면 거절로 처리.
  - 거절: `opts.prompt === "거절했어요. 다른 방법을 제안하세요."`, `extraAllowed`는 비어 있다. 대기 중이 아닌 실행에 호출하면 `Error("승인 대기 중인 요청이 없어요")`.
  - 대기 중인 이전 실행(같은 세션)이 있을 때 새 `start`는 그 실행을 `cancelled`로 바꾸고 `agent:approval_resolved {decision:"deny", reason:"superseded"}`를 남긴다.
  - 중단: 러너가 `signal`을 받아 대기 중일 때 `cancel(run.id)`가 `true`를 반환하면 상태 `cancelled`와 `run:cancelled`; 없는 ID는 `false`. 러너가 reject하면 `run:failed {error: 메시지}`와 상태 `failed`.
- [ ] **Step 2: Run** `npx vitest run tests/aso-web/agent-service.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `AgentService`. 이어가기 ID는 `db.runs.listForProject(run.projectId)`에서 같은 `runContext.sessionId`·`connectionId`의 `executionMode:"agent"` 실행을 최신순으로 보고, 각 실행의 이벤트에서 `agent:done` 또는 `agent:approval_needed`의 `claudeSessionId`를 찾는다. 승인 대기 상태는 이벤트 기록에서 "해결되지 않은 마지막 `agent:approval_needed`"로 읽는다. 사용량 레코드는 `ClaudeProvider.executeChat`의 레코드와 같은 필드로 `taskId:"agent"`, `source:"claude-code-cli (agent)"`, 토큰이 측정되면 `measuredCostUsd:0`·`costConfidence:"measured"`, 아니면 `null`·`"unavailable"`. 진행 중 `AbortController`는 `Map<runId, AbortController>`에 둔다. 총 시간 상한은 `run.budget.maxWallTimeSeconds * 1000`.
- [ ] **Step 4: Run** the same command + `npm run build` — Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat(api): agent service with resume, approvals and cancel`.

### Task 5: API 경로·서버 연결

**Files:**
- Modify: `apps/api/src/routes/runs.ts` (실행 생성 시 모드 결정, 승인·중단 엔드포인트), `apps/api/src/server.ts` (`ApiServerOptions.agentRunner?: AgentRunner`를 `OrchestratorService`로 전달)
- Test: `tests/aso-web/agent-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 `AgentApprovalDTOSchema`, Task 4 `orchestrator.agent`.
- Produces: `POST /api/v1/workspaces/:workspaceId/runs/:runId/agent/approval` (본문 `{decision}` → `200 {success:true}`, 실패 시 `400 {error:{code:"AGENT_APPROVAL_FAILED", message}}`), `POST /api/v1/workspaces/:workspaceId/runs/:runId/cancel` (→ `200 {success:true}`, 없거나 진행 중 아님 → `404 {error:{code:"RUN_NOT_RUNNING"}}`).

- [ ] **Step 1: Write the failing tests** (`run-model-selection.test.ts`의 `setup`/`pairRunnerWithFolder` 패턴, `createAuthedServer({ agentRunner: fake })`):
  - Claude 연결 + 폴더 + `executionMode` 생략 → 생성된 실행의 `executionMode === "agent"`이고 가짜 러너가 호출되며 SSE 대신 `db.events`에 `run:completed`가 남는다.
  - 같은 조건에서 `executionMode:"chat"` → `executionMode === "chat"`이고 기존 `claude -p --output-format json` 인자 호출(가짜 러너 호출 안 됨).
  - 거부가 있는 결과 → `POST .../agent/approval {decision:"allow"}` → 200, 러너 두 번째 호출의 `extraAllowed`에 규칙; 대기 중이 아닐 때는 400; 잘못된 `decision`은 400.
  - 느린 가짜 러너 + `POST .../cancel` → 200, 상태 `cancelled`; 모르는 `runId`는 404.
- [ ] **Step 2: Run** `npx vitest run tests/aso-web/agent-routes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** 모드 결정은 `if (dto.connectionId)` 블록 안에서 연결이 `anthropic`이고 `cwd`가 있고 `dto.executionMode ?? "auto"`가 `auto`/`agent`일 때만 `"agent"`로 둔다. 엔드포인트는 기존 `plan/approve` 라우트 옆에 둔다.
- [ ] **Step 4: Run** the same command + `npm test` — Expected: PASS, 기존 테스트 전부 통과.
- [ ] **Step 5: Commit** `feat(api): route Claude+folder runs to the agent path with approval and cancel endpoints`.

### Task 6: 화면 — 도구 행·승인 카드·중단

**Files:**
- Create: `apps/web/public/agent-ui.js`
- Modify: `apps/web/public/app.js`, `apps/web/public/index.html` (스크립트 추가, `app.js`·새 파일 `?v=20261106-13`), `apps/web/public/style.css`
- Test: `tests/aso-web/agent-ui.test.ts`

**Interfaces:**
- Produces (`agent-ui.js`, ES 모듈 + `window` 노출): `agentToolRowHtml(ev: {name: string; summary: string}): string`, `agentApprovalCardHtml(runId: string, ev: {requestId: string; items: Array<{tool: string; summary: string; danger: boolean; rule: string|null}>}): string`.
- `app.js`가 부르는 전역: `resolveAgentApproval(runId, decision)` → `POST ${API_URL}/workspaces/${currentWorkspaceId}/runs/${runId}/agent/approval`, `cancelAgentRun(runId)` → `POST .../runs/${runId}/cancel`.

- [ ] **Step 1: Write the failing test** (`session-search.test.ts`와 같은 import 방식): 카드·행 HTML에 `summary`가 `<script>alert(1)</script>`나 `"onclick="x`여도 `<script`와 따옴표가 이스케이프(`&lt;script`, `&quot;`)된다; `danger:true` 항목에 클래스 `danger`가 붙고 `false`엔 없다; `rule:null` 항목은 `자동 승인할 수 없어요` 표시; 카드에 `resolveAgentApproval('<runId>','allow')`와 `'deny'` 버튼이 하나씩; 행에는 도구 이름과 요약이 보인다.
- [ ] **Step 2: Run** `npx vitest run tests/aso-web/agent-ui.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `agent-ui.js`(이스케이프 함수 포함)와 `app.js` 연결:
  - `connectRunSSE`에 `run:classified`(mode `agent`이면 `process-wrap` 숨김 + `agent-steps-<runId>` 컨테이너 표시), `agent:tool`(행 추가), `agent:approval_needed`(카드 표시, 상태 문구 `승인 대기 중`), `agent:approval_resolved`(카드 제거), `run:cancelled`(상태 `중단됨`) 리스너 추가.
  - 턴 마크업에 `<div class="agent-steps hidden" id="agent-steps-${tempId}"></div>`를 응답 영역 위에 넣고, id 이름 바꾸기 목록(`prefixes`)에 `"agent-steps-"` 추가.
  - 진행 중 턴에 [중단] 버튼(→ `cancelAgentRun`). 답이 끝나면 숨긴다.
  - 폴더를 처음 쓸 때(`localStorage` 키 `gon.agent_folders_seen`에 없는 경로) `showToast("이 폴더의 .claude 설정과 훅이 실행돼요", "info")`를 한 번 띄운다.
- [ ] **Step 4: Run** `npx vitest run tests/aso-web/agent-ui.test.ts` + `node --check apps/web/public/app.js` — Expected: PASS, 문법 오류 없음.
- [ ] **Step 5: Commit** `feat(web): agent tool rows, approval card, stop button`.

### Task 7: 실제 Claude로 끝까지 확인 + 문서

**Files:**
- Modify: `CLAUDE.md`(구조 절의 "실행 흐름" 항목에 에이전트 경로 한 줄), `docs/ARCHITECTURE.md`는 해당 절이 있을 때만

- [ ] **Step 1: 전체 검증** — `npm run build` exit 0, `npm test` 실패 0.
- [ ] **Step 2: 서버를 다시 켠다**(사용자가 `npm run dev` 재시작). 임시 폴더를 작업 폴더로 고르고 아래를 화면에서 확인한다.
  1. "이 폴더 파일 목록 알려줘" → 도구 행이 보이고 답이 온다(승인 카드 없음).
  2. "hello.txt에 안녕이라고 써줘" → 승인 카드 → [이번만 허용] → 파일이 생기고 같은 대화로 이어진다.
  3. 같은 요청에서 [거절] → 파일이 없고 Claude가 다른 방법을 제안한다.
  4. "git push 해줘" → 카드에 위험 표시가 뜬다(허용하지 않는다).
  5. 다음 메시지로 "방금 뭐 했지?" → 이전 대화를 기억한다(세션 이어가기).
  6. 긴 작업 중 [중단] → 중단됨 표시, 프로세스가 남지 않는다.
  7. agy 연결로 같은 질문 → 기존 방식으로 답한다.
- [ ] **Step 3: 결과 기록** — 통과·실패 항목과 시작 지연(훅 영향) 시간을 계획 문서 아래 한 줄로 적고, 실패가 있으면 고칠 것을 목록으로 남긴다.
- [ ] **Step 4: Commit** `docs: describe the agent execution path`.
