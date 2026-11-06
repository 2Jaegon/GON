# Gon 인수인계 마스터 플랜 (Claude → Gemini) — 2026-11-06

이 문서만 읽고 이어서 작업할 수 있게 쓴 문서예요. 사용자(저장소 주인)가 토큰이 부족해 남은 구현을 Gemini(agy)에게 넘깁니다. **이 문서가 이 저장소의 이번 작업에 한해 `GEMINI.md`·`AGENTS.md`의 일반 지침보다 우선합니다.** 설계·계획은 사용자가 이미 승인했으므로 "계획 승인해 주세요"를 다시 묻지 않고 진행하되, 7절의 "멈추고 물어볼 일"은 반드시 지키세요.

읽는 순서: (1) 이 문서 → (2) `docs/superpowers/specs/2026-11-06-agent-session-design.md`(설계, 승인됨) → (3) `docs/superpowers/plans/2026-11-06-agent-session-core.md`(계획 1, 작업 단위 단계) → (4) `git log --oneline -20`과 `.superpowers/sdd/2026-11-06-agent-session-core/progress.md`(진행 장부, git에는 없음) → (5) 필요할 때 `CLAUDE.md`(저장소 구조·명령).

---

## 1. 사용자가 원하는 것 (한 줄과 배경)

"서비스(ASO 웹 앱)의 채팅이, 내가 Claude Code와 일하듯 자연스럽게 대화하면서 필요하면 스킬을 알아서 불러 구현까지 하는 것." 지금은 같은 Claude 모델인데도 서비스 안에서는 일을 못 합니다. 원인(코드로 확인): `packages/provider-adapters/src/cli-runner.ts`가 chat 호출에 `--tools ""`, `--disable-slash-commands`, `--setting-sources ""`, 빈 임시 폴더, `--effort low`, 45초 제한을 붙이고, 매번 새 세션에 최근 6턴만 글자로 붙입니다. "작업" 모드는 `packages/aso-core`의 키워드 분류기와 정해진 3개 항목 계획(`DAGPlanner`)이 "코드 변경 요약을 2줄로"만 시킵니다.

해결 방향(사용자 승인, "A 방식"): 사용자가 고른 CLI를 **작업 폴더에서 도구·스킬·플러그인을 모두 켠 에이전트 세션**으로 돌리고, 채팅 하나당 세션 하나를 이어가며(`--resume`), 진행을 화면에 흘리고, 위험한 동작은 화면 승인 카드로 받습니다. 그 위에 이미지 생성과 Grilling(질문 단계)을 얹습니다.

사용자 선호(메모리·지침에서 확인): 한국어 해요체로 짧게. 한 응답에서 같은 말을 반복하지 않기. 시스템을 바꾸는 작업(설치·삭제·설정 변경)은 미리 보여주고 확인받기. 응답 끝에 사용한 스킬/에이전트 표와 "결정할 것"(없으면 "결정할 것 없음")을 붙이기(Claude용 지침이라 Gemini는 간단히 따라도 됨). 모호하면 질문을 한 번에 묶고 각 질문에 추천 답을 붙이기.

## 2. 현재 상태 스냅샷 (2026-11-06 작성 시점)

브랜치 `feat/aso`(main에서 분기, 푸시 안 함). 최근 커밋(오래된 순):
- `64eb835` 모델별 추론 강도(low~ultra), Codex 강도 전달, 플랜 표시 정정
- `4e1854e` 화면 강도 버튼·플랜 표시·대기 시간 표시(`wait-status.js`)
- `2ecab9e` 실패 원인 메시지 구분(`cliFailureMessage`, `agyResultError`, `agyTimeoutMessage`), Claude 작업 제한 120초
- `f855112`, `7fe7c49`, `066cf5f` 설계 문서·계획 문서
- `242e3ff` 계획 1의 **작업 1 완료**(계약: `"agent"` 실행 모드, `AgentApprovalDTOSchema`)

계획 1(`2026-11-06-agent-session-core.md`)의 **작업 2는 진행 중**(실제 CLI 사전 확인 4가지는 끝났고 결과는 3절에 있음. 파서·인자 빌더 코드는 아직 안 썼음). 작업 3~7 미착수. **먼저 `git log`와 장부의 `Task <N>: complete` 줄을 보고 어디까지 됐는지 확인하세요**(이 스냅샷보다 진행됐을 수 있음).

검증 기준선(작성 시점): `npm run build` 성공, `npm test` = vitest 155개 통과 + node:test 91개 통과(2 건너뜀). 새 작업을 시작하기 전에 `npm test`가 이 상태인지 확인하세요.

서버: 사용자가 `npm run dev`(API :4000 + Web :3000)를 띄워 둔 상태이며 **옛 빌드로 돌고 있습니다**. 코드를 고친 뒤 화면에서 확인하려면 사용자가 서버를 끄고 다시 켜야 합니다(에이전트가 프로세스를 종료하는 건 권한 분류기가 거부했음. 재시작은 사용자에게 요청하세요).

## 3. 실측으로 확인한 사실 (추측 아님, 2026-11-06 이 PC에서)

### 3-1. Claude CLI (`claude`, 헤드리스 `-p`)
- 명령 모양: `claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode default --allowedTools Read Glob Grep --disallowedTools "Read(.env*)" -- "<프롬프트>"` 가 동작합니다. `--allowedTools`는 가변 인자인데 **`--`가 끝을 정해 주므로 프롬프트가 도구 이름으로 먹히지 않습니다**(확인함).
- 스트림 줄(JSON 한 줄씩, `type` 기준): `system`(subtype `init`: `session_id`, `cwd`, `tools`, …; `hook_started`/`hook_response`: 사용자 훅 출력이니 **저장·표시하지 말 것**; `status`), `rate_limit_event`, `stream_event`, `assistant`, `user`, `result`.
- 글자 조각: `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"…"}}}`. 같은 `content_block_delta`라도 `delta.type`이 `input_json_delta`(도구 입력 조각)면 무시합니다.
- 도구 사용: `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_…","name":"Read","input":{"file_path":"…"}}]}}`. 도구 결과는 `type:"user"`의 `message.content[]`에 `tool_result`(`tool_use_id`)로 옵니다(이 모양은 계획의 `tool_done` 이벤트용으로 구현 중 실제 줄을 한 번 확인할 것).
- 결과: `{"type":"result","subtype":"success","result":"<최종 글>","session_id":"…","is_error":false,"usage":{"input_tokens":…,"cache_creation_input_tokens":…,"cache_read_input_tokens":…,"output_tokens":…},"total_cost_usd":0.16,"duration_ms":12099,"permission_denials":[{"tool_name":"Write","tool_use_id":"…","tool_input":{"file_path":"C:\\…\\b.txt","content":"안녕\n"}}]}`. 권한이 막히면 에러가 아니라 이 `permission_denials`에 담기고 Claude는 말로 "허용해 달라"고 요청하며 Bash로 우회하지 않았습니다.
- 이어가기: `--resume <session_id>`. **없는 ID**는 종료 코드 1, stdout 비어 있음, stderr `No conversation found with session ID: <id>`. 판별식 `/No conversation found/i`.
- **파일 도구 허용 규칙(중요, 실측)**: `Write(<절대경로>)`는 역슬래시·`C:/`·`//c/` 세 표기 모두, `Write(./상대)`도 **허용되지 않았습니다**. 되는 것: `Edit(//c/Users/…/파일)`(드라이브 소문자 + 슬래시), `Edit(./상대)`, 이름만 쓴 `Write`. 그래서 파일 쓰기 승인 규칙은 `Edit(//<드라이브 소문자>/<슬래시 경로>)`로 만듭니다(예: `C:\Users\a\b.txt` → `Edit(//c/Users/a/b.txt)`). Edit 규칙이 Write도 포함하는 것을 확인했습니다.
- `Bash(<정확한 명령>)` 규칙 문법과 `--disallowedTools "Read(.env*)"`가 실제로 막는지는 **아직 시험 안 함**(4-2의 확인 단계에서 시험).
- 사용자 훅·플러그인(claude-mem 등)이 헤드리스에서도 실행됩니다(시작 지연·개인 기억이 답에 섞임). 사용자의 전역 `CLAUDE.md`도 적용돼서 답 끝에 스킬 표가 붙을 수 있습니다(설정 소스를 모두 읽기로 한 확정 결정의 결과).

### 3-2. agy (Antigravity, `agy`)
- 헤드리스는 `agy --model <id> -p "<프롬프트>"`(프롬프트를 `-p` 값으로 붙임). `agy -p --model x -- "prompt"`처럼 `-p` 뒤에 플래그를 두면 오류("-p took --model as its prompt"). 앱 안에서는 `defaultCliRunner`가 `args[0]==="-p"`를 가로채 stream-json 워커 경로로 돌리므로 앱 코드의 `agyArgs` 모양은 그대로 둡니다.
- `agy models`가 모델 id 목록(`gemini-4-argon-low/medium/high`, `gemini-3.8-flash-*`, `claude-opus-5-5-*`, `claude-sonnet-5-5-*`, `gpt-oss-120b-medium`)을 탭 구분으로 줍니다. 플랜·구독 이름을 알려 주는 명령은 없습니다(로그의 `userTier`도 빈 값).
- **헤드리스는 권한이 필요한 도구를 자동 거부**합니다. 결과에 `denied_actions:[{action,display_name}]`(이름만, 입력 없음)와 stderr 문구가 남고 응답이 빈 문자열로 끝납니다. 과거 빈 응답의 원인은 `~/.gemini/GEMINI.md`의 side_pj `@…GON.md` 블록이었고 **제거해 두었습니다(백업 `~/.gemini/GEMINI.md.bak-20261106-144206`). 같은 블록을 다시 넣지 마세요.**
- 이미지: 도구 목록에 `generate_image`가 있고, `agy --model gemini-3.8-flash-low --output-format json --settings '{"permissions":{"allow":["generate_image"]}}' -p "<이미지 만들기 지시>"`가 약 43초에 JPG를 만들었습니다. 파일은 `~/.gemini/antigravity-cli/brain/<conversation_id>/<이름>.jpg`(응답 JSON의 `conversation_id`)에 저장되고 응답 본문에도 경로가 찍힙니다.
- `--output-format stream-json`/`--input-format stream-json`을 지원합니다(앱의 워커가 이미 사용). 시작에 약 5초 걸립니다.

### 3-3. Codex (`codex`)
- 비대화 실행 `codex exec --skip-git-repo-check -s read-only -m <model> -c model_reasoning_effort=<low|medium|high|xhigh|max|ultra> -- "<프롬프트>"`. `codex debug models`가 모델 목록 JSON(모델별 `supported_reasoning_levels`)을 줍니다. 이 PC에서 `gpt-5.6-terra`(ultra까지), `gpt-5.6-luna`(max까지)가 보입니다.
- 로그인은 ChatGPT 계정이며 `~/.codex/auth.json`의 토큰 클레임으로 보면 플랜은 `free`입니다. **그 파일의 토큰 값은 출력·로그·저장 금지**(코드의 `readCodexPlan`은 플랜 문자열 하나만 꺼냄).
- `codex features list`에서 `image_generation`은 stable/true. **실제로 이미지를 만들어 보지는 않았고** 저장 위치는 모릅니다(무료 한도를 아끼려고 시험 안 함). `exec`에 `-i/--image`(입력 이미지)와 `--json`, `-o`가 있습니다.

### 3-4. 이 PC·저장소 환경
- Windows 10, Git Bash와 PowerShell. 경로에 한글이 있음(`수업_AX_W`). Node 24. 훅·MCP·플러그인이 많이 설치돼 있어 Claude Code 쪽은 시작이 느립니다.
- 저장소 규칙은 `CLAUDE.md`를 따릅니다: 빌드 `npm run build`(순서 의존), 테스트 `npm test`, 파일 하나 `npx vitest run <경로>`, vitest는 `@aso/*`를 소스로 alias하므로 테스트에 빌드 불필요(서버 실행엔 필요). `plugins/gon/`은 Node 내장 모듈만(외부 의존성 0).
- 영속 저장: `MemoryDatabase`는 `NODE_ENV=test`가 아니면 `.aso/db.json`(git 무시)에 저장. 이벤트 기록(`db.events`)이 곧 실행 이력입니다.

## 4. 결정 사항 (사용자 확정 + 제가 정한 것)

사용자 확정: A 방식(CLI를 에이전트 세션으로), 승인 규칙(읽기·안전한 명령 자동, 수정·삭제·설치·푸시·그 밖의 명령은 화면 승인), 설정 소스는 사용자·프로젝트·로컬 모두 읽기 + `--permission-mode default` 강제 + 금지 목록 + 폴더 첫 사용 시 안내, 이미지는 Gemini(`generate_image`) 기본·Codex 대체·프롬프트 확인 후 생성, Grilling은 모호한 구현·조사 요청에서만 3~4개 묶음 질문(추천 답 포함)·배지 표시, Notion 작성은 **철회**(하지 말 것).

제가 정한 것(사용자가 고치면 바뀜, 설계 문서 11절 참고): 진입 조건은 "Claude 연결 + 작업 폴더 + 실행 모드 `auto`/`agent`"일 때만 새 경로(명시적 chat/fast/standard/deep·agy·codex·폴더 없음은 기존 경로), 세션 ID는 이벤트 기록(`agent:done`/`agent:approval_needed`)에서 읽음, 승인은 한 카드에 묶어 [모두 허용]/[거절], 대기 중 새 메시지는 거절로 간주, 글자 스트리밍은 기존 `chat:delta` 재사용.

## 5. 계획 1 보정 사항 (계획 파일보다 이 절이 우선)

계획 파일 `2026-11-06-agent-session-core.md`의 단계는 그대로 따르되 아래를 반영하세요. (계획 파일 끝에도 같은 보정 목록을 덧붙여 둠.)

1. **작업 2 — 파일 도구 규칙**: `denialToRule`은 `Write`·`Edit`·`MultiEdit`·`NotebookEdit` 거부를 `Edit(//<소문자 드라이브>/<슬래시 경로>)`로 만든다. `tool_input.file_path`(노트북은 `notebook_path`)가 없으면 `null`. `Bash`는 `Bash(<command 그대로>)`, `command`가 없으면 `null`. 그 밖의 도구는 도구 이름이 아니라 `null`(자동 승인 불가, 카드에는 [거절]만 의미 있음로 표시). 테스트 값 예: `{toolName:"Write", toolInput:{file_path:"C:\\Users\\a\\b.txt"}}` → `"Edit(//c/Users/a/b.txt)"`.
2. **작업 2 — `AgentEvent`에 `{kind:"tool_done"; id:string}` 추가**, `parseAgentLine`이 `type:"user"` 줄의 `tool_result` 항목마다 하나씩 내보낸다(`id = tool_use_id`).
3. **작업 2 — `isResumeFailure`** = `/No conversation found/i.test(message)`. 이 문구는 러너가 stderr 마지막 줄로 만든 오류 메시지에 그대로 들어온다.
4. **작업 2 — `AGENT_DENIED_TOOLS`**에 `AskUserQuestion`·`EnterPlanMode`·`ExitPlanMode` 추가 후보: 헤드리스에서 이 도구들은 항상 거부되어 승인 카드 잡음이 되고 Grilling 질문을 막을 수 있다. 실제 CLI로 "질문 도구가 막히면 Claude가 글로 묻는지" 한 번 시험한 뒤 넣을지 정한다(넣으면 장부에 Ruling).
5. **작업 2 — 사전 확인 추가**: (a) 임시 폴더에 `.env`를 만들고 "`.env` 읽어 줘"를 `--disallowedTools "Read(.env*)" "Read(**/.env*)"`로 실행해 실제로 막히는지, (b) `Bash(git status:*)` 허용 시 `git status`가 카드 없이 도는지와 `Bash(<정확한 명령>)`이 그 명령만 허용하는지 확인한다. 막히지 않으면 금지 목록 문법을 고치고 장부에 적는다. 픽스처는 이미 확인한 모양으로 직접 만들어도 된다(훅 출력·이메일·조직 ID·`credential_expires_at` 제거, cwd는 `C:\work`로).
6. **작업 3 — 무응답 타이머**: 도구 호출이 진행 중인 동안(`tool` 이벤트 후 대응하는 `tool_done` 전)에는 무응답 타이머를 멈춘다(이미지 래퍼가 45~180초 동안 이벤트를 안 내기 때문). 총 시간 상한 타이머는 항상 동작. 테스트: tool_use 후 `idleTimeoutMs`보다 오래 조용해도 kill 안 됨, tool_done 후 조용하면 kill.
7. **작업 4 — 비밀 보호**: 이벤트로 저장·전송하는 `summary`와 승인 항목은 `@aso/security`의 `redactSecrets(input: string): string`을 거친다. `Write`/`Edit` 내용은 저장하지 않고 경로만 보여 준다. 테스트: 명령에 `sk-…`/토큰 모양 문자열이 있으면 이벤트 payload에서 가려진다.
8. **작업 4 — 첨부**: 실행의 `runContext.attachments` 중 텍스트(`text`)는 프롬프트 뒤에 `[첨부 파일]` 블록으로 붙이고(Codex 어댑터와 같은 모양), 이미지 첨부가 있으면 답 맨 앞에 "이미지 첨부는 에이전트 경로에서 아직 지원하지 않아요" 한 줄을 붙인다.
9. **작업 5 — 서버 재시작 후 이어가기**: 첫 메시지는 `--resume` 없음. 두 번째부터 이전 `agent:done`에서 세션 ID를 읽는다. `OrchestratorService`가 만든 `AgentService` 하나를 라우트가 공유한다(`orchestrator.agent`).
10. **작업 6 — 화면**: 도구 행은 이벤트 한 줄당 한 행, 같은 `id`의 `tool_done`이 오면 체크 표시. 승인 카드의 버튼 문구는 `이번만 허용`·`거절`, 위험 항목은 빨간 테두리와 "되돌리기 어려운 작업이에요" 문구. 문구는 해요체.
11. **작업 7 — 확인 항목** 7가지는 계획대로이고, 8번으로 "`.env`를 읽어 달라고 하면 막힌다"를 추가한다.

## 6. 앞으로 할 일 전체 (큐)

진행 장부를 확인해 완료된 건 건너뛰세요. 각 계획은 사용자가 이미 승인한 설계의 일부이므로 새 설계 질문 없이 진행하되 아래 "열린 질문"이 막히면 물어보세요.

### 계획 1 — 에이전트 세션 코어(Claude) : 작업 2~7 (파일 `2026-11-06-agent-session-core.md`)
단계별 RED→GREEN은 그 파일 그대로. 작업 2 뒤와 작업 5 뒤에 **검토 게이트**(새 에이전트/모델 하나로 코드 검토. 서브에이전트가 없으면 `git diff <BASE>..HEAD`를 스스로 점검 목록으로 읽고 장부에 `self-review`라고 적기)를 둡니다. 작업 7 뒤 전체 브랜치 검토 + 보안 검토(승인 우회, XSS, 경로 탈출, 비밀 노출)를 한 번 합니다.

### 계획 2 — 이미지 생성 (계획 1 완료 후, 설계 6절 + 이 절)
참고 자료: `docs/superpowers/notes/2026-11-06-image-prompt-analysis.md`(102개 프롬프트를 분석해 **직접 다시 쓴** 카테고리·슬롯·규칙 블록·템플릿). 원본 `.txt`(사용자 폴더 `C:\Users\aicam\Downloads\이미지_프롬프트\프롬프트`)는 **저장소에 복사하지 않습니다**(일부에 외부 블로그 출처 표기가 있음). 브랜드·IP 이름(Disney, Spotify, Adidas, CELINE, alo, Starbucks 등), 선정적 신체 수치, 인종 지정은 템플릿에서 일반 표현으로 바꿉니다.
- **P2-1 카탈로그**: `config/image-prompt-catalog.json`(13개 이미지 카테고리 C1~C13: id, 이름, 트리거 단어, 필요한 참조 사진 수·역할, 템플릿(영어, `{슬롯}` 자리표시), 쓰는 규칙 블록 id) + 공통 규칙 블록 맵(피부 리얼리즘, 정체성 잠금, 앵글 문장 사전 등) + 로더 `packages/aso-core/src/image-catalog.ts`의 `loadImageCatalog(file?: string)`와 zod 스키마. 영상용·빈 파일·텍스트 분석용은 제외 목록으로 둔다. 테스트: 스키마 통과, 13개 id 존재, 모든 템플릿이 영어이고 금지어 목록(위 브랜드들)이 없음, `[출처]` 문자열 없음, 슬롯 자리표시가 `{…}` 형식.
- **P2-2 래퍼 `tools/gen-image.mjs`**(Node 내장 모듈만): 사용: `node tools/gen-image.mjs --out <작업폴더> "<영어 프롬프트>"`. agy를 `generate_image`만 허용하는 `--settings`와 `--output-format json`으로, **빈 임시 폴더에서** 실행(제한 180초). 응답 JSON의 `conversation_id`로 `~/.gemini/antigravity-cli/brain/<id>/`에서 새 이미지(jpg/png/webp)를 찾아 `<작업폴더>/.gon-images/<yyyymmdd-hhmmss>-1.<확장자>`로 복사하고 stdout에 `{"path":"…","via":"agy"}` 한 줄을 출력. 실패하면 `{"error":"…"}`와 종료 코드 1. 순수 함수(`parseAgyImageResult`, `findNewestImage`, `buildAgyImageArgs`)를 export하고 `main`은 `import.meta.url` 가드. 테스트는 임시 폴더와 가짜 실행기로. Codex 대체는 **먼저 한 번 실제로 시험**(무료 한도를 쓰니 사용자에게 허락 받고, 그 전에는 구현하지 말고 "agy만 지원, Codex 대체는 보류"로 두고 장부에 기록).
- **P2-3 이미지 제공 API**: `GET /api/v1/workspaces/:workspaceId/runs/:runId/images/:name`. `name`은 `^[\w.-]+$`만, 실행의 `runContext.cwd`/`.gon-images/` 안 파일만 서빙, 확장자별 Content-Type, 그 밖은 404. 테스트: `../x`, `%2e%2e%2f`, 절대 경로, 백슬래시, 없는 파일, 심볼릭 링크 탈출.
- **P2-4 에이전트 지침**: `AgentRunOptions`에 `appendSystemPrompt?: string`을 더하고 `buildAgentArgs`가 `--append-system-prompt <글>`을 `--`보다 앞에 둔다. 지침 문구 빌더 `buildAgentSystemPrompt(opts:{image?:{gonRoot:string; catalogSummary:string}})`(새 파일 `packages/provider-adapters/src/agent-prompt.ts`): "이미지 요청이면 카탈로그에서 카테고리를 골라 영어 프롬프트를 쓰고(그림 속 한국어 글자는 따옴표로 그대로), 사용자에게 프롬프트를 보여 확인받은 뒤 `node <gonRoot>/tools/gen-image.mjs --out <cwd> "<프롬프트>"`를 실행하고, 결과 경로를 `![이미지](.gon-images/<파일>)`로 답하라. 참조 사진이 필요한 카테고리는 아직 지원하지 않는다고 안내하라." 허용 목록에 래퍼 실행을 더한다: `Bash(node <gonRoot 절대경로>/tools/gen-image.mjs:*)`(Windows 경로 표기가 규칙에서 먹히는지 실제 CLI로 확인하고 안 되면 슬래시/`//c/` 표기 순으로 시험, 결과를 장부에).
- **P2-5 화면**: `renderSafeMarkdown`이 `![alt](.gon-images/<이름>)`만 `<img src="/api/v1/workspaces/<ws>/runs/<runId>/images/<이름>">`로 바꾼다(그 밖의 이미지 URL은 글자로 둠, 속성 이스케이프). 테스트: 허용 형식만 변환, `javascript:`·외부 URL·`"` 포함 이름은 변환 안 됨.
- **P2-6 실제 확인**: "강아지 이미지 생성해줘" → 에이전트가 영어 프롬프트를 보여 주고 확인을 묻는다 → "응" → 이미지가 채팅에 보인다(약 45초, 무응답 타이머 중지 덕분에 끊기지 않음). 이미지 파일이 `<작업폴더>/.gon-images/`에 있다.

### 계획 3 — Grilling (계획 1 완료 후, 계획 2와 독립)
설계: `2026-11-06-grilling-step-design.md`(분류기·고정 계획 부분은 에이전트 설계로 대체됨. 취지·판별 기준·배지는 유효).
- **P3-1 지침**: `buildAgentSystemPrompt`에 `grilling: boolean` 추가. 문구: "구현·조사 요청에서 대상이나 완료 기준이 빠져 있고 아래 중 둘 이상이면 계획 전에 한 번에 3~4개를 묻고 각 질문에 추천 답을 붙여라: 요청이 짧음(공백 제외 25자 미만), 대상(파일·화면·API·기능) 없음, 완료 기준 없음, '알아서/좋게/적당히/대충' 같은 위임 표현. 단순 질문·인사·명확한 요청에는 묻지 마라. 질문 묶음 메시지는 첫 줄을 `[Grilling]`으로 시작하고 도구 `AskUserQuestion`은 쓰지 마라(글로 물어라)."
- **P3-2 배지 감지**: 서버가 (a) `Skill` 도구 사용에서 `input.skill`이 `/grill/i`에 맞거나 (b) 답 글자가 `[Grilling]`으로 시작하면 `agent:grilling {state:"asking"}` 이벤트를 낸다. 표시용 글자에서는 `[Grilling]` 줄을 지운다. 다음 사용자 메시지가 이어지면 `agent:grilling {state:"answered"}`. 테스트: 두 감지 경로, 마커 제거, 일반 답에는 이벤트 없음.
- **P3-3 화면**: 답변 말풍선 위 칩 `Grilling · 요구사항 다듬는 중`(asking) → `Grilling 완료`(answered). 순수 함수 `grillingBadgeHtml(state: "asking"|"answered"): string`을 `agent-ui.js`에 두고 이스케이프·문구 테스트. [모두 추천대로] 버튼은 질문 텍스트에 "추천"이 있는 답을 채팅 입력에 채워 주는 방식(서버 변경 없음)으로 선택 구현.
- **P3-4 건너뛰기**: 입력창 옆 체크 "이번 요청은 질문 없이 바로" → 실행 DTO `options.skipGrilling?: boolean` → 지침에서 grilling 문구 제외. 계약·API·화면 테스트.
- **P3-5 실제 확인**: "로그인 만들어줘" → 질문 묶음+배지, "ㅎㅇ" → 질문 없음, 명확한 요청 → 질문 없음, 건너뛰기 체크 → 질문 없음.

### 계획 4 — 나머지 연결과 정리 (선택, 사용자와 확인하며)
- agy·codex도 에이전트 세션화(agy `--continue`/`--conversation`, codex `exec resume`/`--json`). 먼저 실제 CLI로 이벤트 모양을 실측하고 `AgentRunner` 인터페이스를 재사용. agy 승인은 `denied_actions`가 이름만 주므로 `--settings permissions.allow`로 도구 단위 허용.
- 모든 연결이 새 경로로 옮겨진 뒤에만 키워드 분류기·3항목 고정 계획·`buildConversationalPrompt`를 제거(반목표: 검증 전에 기존 경로 삭제 금지).
- 기존 채팅 경로의 agy 제한(대화 35초/작업 25초)과 Gemini 콜드 스타트(약 5초)는 새 경로로 옮기면서 해소.

### 부가 정리(언제든)
- `CLAUDE.md` 구조 절에 에이전트 경로 한 줄(계획 1 작업 7).
- 알려진 미해결: 브라우저에서 대기 시간 숫자가 올라가는 것과 강도 버튼 6개가 팝오버에 들어가는지는 눈으로 확인하지 못함.

## 7. 작업 방식과 안전선

**TDD**: 모든 코드는 실패하는 테스트를 먼저 쓰고 실패를 눈으로 확인한 뒤 구현합니다. 한 작업이 끝나면 `npm run build`와 `npm test`를 돌려 둘 다 통과해야 합니다. 완료를 말하기 전에 실제 명령 출력을 확인하세요(추측으로 "통과" 금지, 안 돌린 건 `unverified`).

**커밋**: 작업 하나(또는 의미 단위)마다 커밋, 메시지는 `feat(scope): …`/`fix(scope): …`/`docs: …` 영어 한 줄 + 필요 시 본문. `git add`는 파일을 하나씩 지정(`git add -A` 금지). `.aso/`, `.superpowers/`, `.env`는 이미 git 무시 대상이며 절대 커밋하지 않습니다.

**실행 환경 함정(실제로 겪음)**:
- `node -e '…'`를 bash 작은따옴표로 쓸 때 문자열 안의 `\n`·`\t`가 실제 줄바꿈으로 바뀌어 파일이 깨진 적이 두 번 있습니다. 이스케이프가 든 문자열을 고칠 때는 파일 편집 도구로 직접 고치세요.
- bash 스크립트는 Git Bash에서 돌고, PowerShell 7이 아닌 5.1이라 `&&`가 없습니다. 임시 폴더는 `mktemp -d`.
- 작업 폴더 경로에 한글·공백이 있으니 항상 따옴표로 감쌉니다.
- 서버 프로세스를 대신 종료하려 하지 말고 사용자에게 재시작을 요청하세요.

**진행 기록**: `.superpowers/sdd/2026-11-06-agent-session-core/progress.md` 맨 윗줄은 `# SDD ledger — plan: docs/superpowers/plans/2026-11-06-agent-session-core.md`. 작업이 끝날 때 `Task <N>: complete (commits <base7>..<head7>, tests: <명령> → <결과>)` 한 줄을 추가하고, 계획과 다르게 한 결정은 `Task <N>: Ruling: <무엇을> — <이유> — <틀렸을 때 비용>`으로 남깁니다. 이 장부는 git에 없으니 의미 있는 결정은 커밋 메시지와 이 문서 갱신에도 반영하세요. 계획 2·3은 각자 `docs/superpowers/plans/`에 새 계획 파일로 쪼개 쓰고(작업 단위·정확한 시그니처·테스트 값) 같은 방식으로 장부를 만듭니다.

**멈추고 사용자에게 물을 일**(이 넷만): ① 되돌릴 수 없거나 파괴적인 작업(파일·브랜치 삭제, 강제 푸시, 이력 재작성) ② 보안에 민감한 동작(승인 규칙 완화, 비밀 파일 읽기 허용, 토큰·키 출력) ③ 저장소 밖에 영향이 가는 일(푸시, 배포, Notion 등 외부 서비스 쓰기, 전역 설정 파일 `~/.claude`·`~/.gemini`·`~/.codex` 수정, 서버 프로세스 종료) ④ 계획이 완전히 깨져서 어느 길이든 추측뿐인 경우. 그 외 모호함은 스스로 정하고 장부에 `Ruling`으로 남깁니다.

**하지 말 것**: 푸시 금지(사용자가 요청할 때만). Notion 작성 금지(철회됨). `~/.gemini/GEMINI.md`에 side_pj 블록 복원 금지. 원본 이미지 프롬프트 `.txt` 복사 금지. 요구받지 않은 추상화·옵션 추가 금지(`CLAUDE.md`의 Ponytail/YAGNI 원칙). 사용자 토큰·OAuth 파일 내용을 출력하거나 기록하는 것 금지. 기존 경로(agy·codex·명시적 chat/fast/standard/deep)를 검증 전에 지우는 것 금지.

## 8. 위험 목록과 대응

| 위험 | 대응 |
|---|---|
| 승인 없이 파일 수정·삭제·푸시가 실행됨 | `--permission-mode default` 강제, 자동 허용은 정해진 목록만, 허용 규칙은 한 번(턴)만 확장, 금지 목록(deny가 allow보다 우선), 작업 7 확인 항목 4·8 |
| 사용자 `~/.claude` 설정의 허용 규칙·훅이 승인을 약하게 함 | 모드 강제 + 금지 목록 + 폴더 첫 사용 안내 + 검토 게이트의 보안 점검 |
| 승인 카드·도구 행에 임의 문자열이 그대로 들어가 XSS | 모든 HTML 조립 함수에서 이스케이프, 테스트로 고정(`<script`, 따옴표, `onclick=`) |
| 이미지 제공 API가 작업 폴더 밖 파일을 내려줌 | 이름 정규식 + 해석된 경로가 `.gon-images/` 안인지 확인 + 심볼릭 링크 거부 테스트 |
| 도구 입력의 비밀(토큰·키)이 이벤트·`.aso/db.json`에 저장됨 | `redactSecrets` 통과, 파일 내용 미저장, 요약 160자 제한 |
| 이미지 생성 중(45~180초) 무응답으로 프로세스가 죽임 | 도구 진행 중 무응답 타이머 정지(5절 6항), 총 시간 상한만 유지 |
| 훅·플러그인으로 시작이 느리고 개인 기억이 답에 섞임 | 작업 7에서 시작 지연을 실측해 기록, 필요하면 사용자와 설정 소스 재논의 |
| `--resume` 실패·서버 재시작 | 새 세션으로 시작하고 알림, 세션 ID는 이벤트 기록에서 복원 |
| Windows 경로·인용 문제로 규칙이 안 먹음 | 규칙 문법은 3-1의 실측 결과를 따르고, 안 먹으면 "거부"로 실패(허용으로 새지 않게) |
| Codex 무료 한도 소진 | Codex 이미지 시험은 사용자 허락 후에만, 생성은 확인 후에만 |
| 테스트가 실제 `~/.codex/auth.json`·실제 CLI에 의존 | 가짜 실행기를 주입, `defaultCliRunner`일 때만 실제 파일 읽기(기존 `SubscriptionDetector` 패턴) |

## 9. 완료 기준 (계획별)

- 계획 1: `npm run build` 성공, `npm test` 전부 통과, 작업 7의 확인 8가지를 사용자 화면에서 통과(또는 실패 항목을 장부에 기록), 새 사람 눈 검토 게이트 두 번 + 최종 검토 반영.
- 계획 2: 카탈로그 테스트, 래퍼·제공 API 테스트 통과, 실제로 "강아지 이미지 생성해줘"에서 이미지 1장이 채팅에 보임, 원본 프롬프트 파일이 저장소에 없음.
- 계획 3: 배지 감지·표시 테스트 통과, 질문이 필요한 요청에만 질문, 건너뛰기 동작.
- 모든 계획: 알려진 미검증 항목은 `unverified`로 명시, 사용자에게 보고할 때 "한 일 / 검증한 것 / 검증 못 한 것 / 결정할 것"을 짧게.

## 10. 사용자에게 아직 확인이 필요한 것

- 서버 재시작(사용자가 직접).
- Codex 이미지 생성 시험 허락(무료 한도 사용).
- 계획 4(agy·codex 에이전트 세션화)를 할지 여부와 시점.
- 지금까지의 커밋을 원격에 푸시할지(요청 전에는 하지 않음).
