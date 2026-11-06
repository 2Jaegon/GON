# 에이전트 세션 연결: 서비스 채팅이 Claude Code처럼 일하게 하기 설계

- 날짜: 2026-11-06
- 범위: `packages/provider-adapters`(claude 에이전트 실행기), `apps/api`(실행 흐름·승인 API·이벤트), `packages/contracts`(이벤트·승인 스키마), `apps/web/public`(진행 행·승인 카드·배지), `tools/`(이미지 생성 래퍼)
- 이 문서가 `2026-11-06-chat-image-generation-design.md`와 `2026-11-06-grilling-step-design.md`의 분류기·고정 계획 부분을 대체한다. 두 문서의 카탈로그·배지·승인 취지는 여기로 이어진다.

## 1. 의도

사용자 요청: "내가 너(Claude Code)와 일하듯 자연스럽게 대화하고, 구현이 필요하면 스킬을 알아서 불러 쓰는 서비스." 지금은 같은 Claude 모델인데도 서비스 안에서는 일을 못 한다. 원인은 모델이 아니라 호출 방식이다(코드에서 확인).

| | Claude Code | 서비스 안 Claude (현재) |
|---|---|---|
| 도구 | 사용 | 꺼짐 (`--tools ""`) |
| 스킬·슬래시 | 사용 | 꺼짐 (`--disable-slash-commands`) |
| CLAUDE.md·설정·플러그인 | 로드 | 안 읽음 (`--setting-sources ""`) |
| 작업 위치 | 프로젝트 폴더 | 빈 임시 폴더 |
| 대화 기억 | 한 세션 | 매번 새 세션 + 최근 6턴 글자 붙임 |
| 일하는 방식 | 여러 단계 반복 | 한 번 답하고 끝 (45초 제한) |
| 작업 모드 | 실제 구현 | 정해 둔 3개 항목 + "2줄 요약" 요청 |

방향: 사용자가 고른 CLI를 **작업 폴더에서 도구·스킬·플러그인을 모두 켠 채 에이전트 세션으로** 돌리고, 채팅 하나당 세션 하나를 이어가며, 진행 상황을 화면에 흘려 준다. 키워드 분류기와 가짜 계획은 이 경로에서 쓰지 않는다.

## 2. 실측으로 확인한 것 (2026-11-06)

- `claude -p --output-format stream-json --verbose --permission-mode default --allowedTools "Read,Glob,Grep"`에 "파일을 만들어 줘"를 보내면: 이벤트 `system:init`, `assistant`(tool_use), `system:permission_denied`, `user`, `result`가 순서대로 나오고, `result.permission_denials`에 `{tool_name, tool_use_id, tool_input}`(예: Write와 파일 경로·내용)이 담긴다. `result.session_id`가 있다.
- 막힌 도구를 Claude가 Bash 등으로 우회하지 않고 "쓰기를 허용해 달라"고 말로 요청했다.
- 이 CLI는 훅을 그대로 실행한다(`system:hook_started`). 즉 사용자 훅·플러그인(예: claude-mem)이 서비스 세션에도 적용된다.
- `claude --help`에 `--resume`, `--session-id`, `--include-partial-messages`, `--permission-mode`, `--allowedTools`, `--append-system-prompt`가 있다.
- agy `-p`는 `--output-format stream-json`을 지원하고 결과에 `denied_actions`(도구 이름만)가 있다. `generate_image`는 `--settings '{"permissions":{"allow":["generate_image"]}}'`로 허용하면 동작한다(이미지 생성 시험, 약 43초).
- 아직 검증 안 한 것: `codex exec --json`의 이벤트 모양, `--resume`으로 승인 후 이어가기의 실제 동작, 앱 서버에서 Windows로 `--allowedTools` 인자를 넘길 때의 인용.

## 3. 목표 / 비목표 / 반목표

**목표**
1. Claude 연결에서 채팅 하나 = 세션 하나. 다음 메시지는 `--resume <session_id>`로 이어진다.
2. 작업 폴더(이미 고르는 폴더)에서 실행하고, 그 폴더의 CLAUDE.md·스킬·플러그인이 적용된다.
3. 진행을 실시간으로 보여준다: 글자 스트리밍, 도구 사용 행("README.md 읽는 중", "src/a.ts 수정 승인 대기").
4. 승인 규칙: 읽기와 안전한 명령은 자동, 파일 수정·삭제·설치·푸시·그 밖의 명령은 화면에서 승인 후 진행.
5. 이미지 생성(채팅으로 자연스럽게): 에이전트가 프롬프트 규칙 카탈로그로 영어 프롬프트를 쓰고 채팅에서 보여준 뒤, 사용자가 말로 확인하면 생성 래퍼를 실행한다.
6. Grilling: 구현·조사 요청이 모호하면 에이전트가 한 라운드(3~4개, 추천 답 포함)로 묻고, 그동안 `Grilling` 배지를 띄운다.
7. 대기 중 표시: 경과 시간(이미 구현), 에이전트 진행 행.

**비목표 (이번 범위 아님)**
- agy·codex의 에이전트 세션화. Claude 경로가 검증된 뒤 같은 인터페이스로 옮긴다(내 판단). 그때까지 둘은 지금 방식 그대로다.
- 승인 기록의 영구 저장·팀 공유, 여러 폴더 동시 작업.

**반목표 (돌아가도 실패인 것)**
- 사용자 승인 없이 파일 수정·삭제·설치·푸시가 실행되는 것.
- `.env`·자격 증명 파일 같은 비밀 파일을 자동으로 읽는 것.
- 새 경로가 검증되기 전에 기존 채팅·계획 경로를 지우는 것.
- 승인을 "이번 한 번"이 아니라 "항상"으로 몰래 넓히는 것.

## 4. 승인 방식

- 실행 시 `--permission-mode default`와 자동 허용 목록 `--allowedTools`(Read, Glob, Grep, `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git log:*)`, `Bash(ls:*)`, 이미지 래퍼 `Bash(node tools/gen-image.mjs:*)`)를 준다. 비밀 파일은 `--disallowedTools`로 막는다(`Read(.env*)` 등, 세부 목록은 빌더).
- 한 턴이 끝났을 때 `permission_denials`가 있으면 승인이 필요한 것이다. 실행 상태를 `awaiting_approval`로 두고 `agent:approval_needed` 이벤트(도구 이름, 입력 요약)를 보낸다. 화면에 카드: [이번만 허용] [거절].
- [이번만 허용]: 그 도구 호출 하나만 허용 목록에 더해(`Write(<경로>)`, `Bash(<정확한 명령>)`) 같은 세션을 `--resume`하고 "승인했어요. 계속하세요."를 보낸다. [거절]: "거절했어요. 다른 방법을 제안하세요."를 보낸다.
- 위험 표시: 삭제·`git push`·설치 명령은 카드에 빨간 경고를 붙인다.

## 5. 이벤트와 화면

`agent:text`(글자 조각), `agent:tool`(도구 이름·대상·상태), `agent:approval_needed`, `agent:done`(결과·세션 ID·실측 토큰·비용). 기존 `chat:delta`/`chat:response` 화면 코드를 재사용해 글자를 그린다. 도구 행은 답변 위에 접히는 목록으로 보인다.

## 6. 이미지 생성과 Grilling

- **이미지**: `config/image-prompt-catalog.json`에 카테고리별 규칙을 우리 말로 정리한다(원문 복사 금지, 브랜드·선정적 수치·인종 지정은 일반 표현으로). 에이전트에게는 `--append-system-prompt`로 "이미지 요청이면 카탈로그로 영어 프롬프트를 쓰고 사용자에게 보여 확인받은 뒤, `node tools/gen-image.mjs "<프롬프트>"`를 실행하라"는 규칙을 준다. `gen-image.mjs`는 agy를 `generate_image`만 허용한 설정으로 빈 임시 폴더에서 돌리고(제한 180초), 생성 파일을 작업 폴더 `.gon-images/`에 복사해 경로를 출력한다. agy가 없거나 실패하면 Codex로 한 번 대체한다. 채팅은 그 경로의 이미지를 보여준다(작업 폴더 밖 경로는 제공 거부). 참조 사진이 필요한 편집 카테고리는 이번 범위 밖이라 안내만 한다.
- **Grilling**: 에이전트에게 "구현·조사 요청에서 대상이나 완료 기준이 빠졌으면 계획 전에 3~4개를 한 번에 묻고 각 질문에 추천 답을 붙여라"는 규칙을 준다. 배지는 도구 사용 이벤트에서 `Skill`로 grilling 스킬이 불릴 때, 또는 에이전트가 질문 묶음을 시작할 때 띄운다(정확한 감지 방법은 빌더가 실측해 정한다). 단순 질문에는 질문하지 않는다.

## 7. 시간 제한과 에러

45초 제한은 이 경로에서 쓰지 않는다. 대신 "이벤트가 120초 동안 없으면 중단"과 "한 요청 최대 30분"을 둔다. 사용자는 [중단] 버튼으로 끌 수 있다. 에러는 지금 만든 `cliFailureMessage`를 재사용해 시간 초과·권한 거부·출력 초과·종료 코드를 구분해 보여준다.

## 8. 방식 (고려한 것과 고른 것)

| 방식 | 내용 | 득실 |
|---|---|---|
| **A. CLI를 에이전트로 연결 (선택)** | 위 설계 | 저와 거의 같은 동작, 분류기·가짜 계획 제거 / 승인 왕복 화면 작업이 가장 큼 |
| B. 작업 모드에만 도구 켜기 | 현재 구조 유지 | 수정 작음 / 오분류·가짜 계획 그대로 |
| C. Claude Agent SDK 직접 사용 | 서버에서 SDK 호출 | 승인·스트리밍 정밀 제어 / Claude 전용, 의존성 증가, 구독 로그인 호환 미확인 |

사용자가 A와 추천 승인 규칙을 골랐다(2026-11-06).

## 9. 위험

- CLI 훅·플러그인이 서비스 세션에도 돌아 시작이 느리고, 개인 기억(claude-mem)이 답에 섞인다. 시작 시간은 구현 첫 단계에서 실측한다.
- 승인 뒤 `--resume`은 한 턴을 더 쓴다(토큰·시간).
- 도구 허용 문자열의 Windows 인용 오류는 승인 우회가 아니라 "거부"로 실패해야 한다.

## 10. 빌더에게 맡기는 것

안전 명령 목록과 비밀 파일 차단 목록의 세부, 이벤트 payload 모양, 승인 카드·도구 행·배지의 시각 디자인(기존 `style.css` 톤), `RunStatusSchema`에 승인 대기 상태를 맞추는 방식, 카탈로그 JSON 필드와 13개 템플릿 문장. 구현은 먼저 Claude 경로 하나(채팅→도구→승인→이어가기)를 끝까지 통과시키고, 그 위에 이미지와 Grilling을 얹는 순서를 권한다.
