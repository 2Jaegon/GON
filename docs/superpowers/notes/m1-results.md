# Gon M1 측정 및 검증 기록

## Task 0 기준선

- 검증 명령:
  - `claude plugin validate . --strict` → `Validation passed` (종료 코드 0)
  - `claude plugin validate plugins/gon --strict` → `Validation passed` (종료 코드 0, directory 프로필 참고 경고: `ICON_MISSING`)
- 구성 요소 및 추정 토큰 비용 (`claude --plugin-dir plugins/gon plugin details gon`):
  - Source: `gon@inline` (version `0.1.0`)
  - Component inventory: Skills (1) `gon`, Agents (0), Hooks (0), MCP servers (0), LSP servers (0)
  - Projected token cost (Always-on): `~68 tok` added to every session (`gon` always-on `~70`, on-invoke `< 20`)
- 호출 이름 확인:
  - Claude Code 플러그인 스킬 명명 규칙(`plugin:skill`, 예: `skill-creator:skill-creator`)에 따라 전체 이름은 `gon:gon`이며 단축 호출 `/gon` 및 `/gon:gon` 표기를 모두 안내·허용한다. (대화형 세션 내 자동완성 표기는 추후 Claude Code 대화형 세션에서 최종 확인)

## Task 7 환경 확인 (위험한 가정 5)
- (a) 셸 `node` PATH 확인: `node --version` → `v24.18.0` 정상 인식 확인.
- (b) 스킬 폴더 기준 상대 경로 해석 및 서버 기동 확인: `plugins/gon/skills/gon/../../viewer/server.mjs`를 `path.resolve`로 풀어 실행했을 때 `Open: http://127.0.0.1:<port>/?t=<token>` 한 줄 출력 정상 확인.
- (c) 플러그인 캐시/폴더 읽기 권한 창 여부: 대화형 `--plugin-dir` 세션에서의 실제 권한 창 발생 여부는 사용자 대화형 세션(Task 10)에서 최종 확인 예정(미확인).

## Task 8 토큰 비용 추정 (`claude --plugin-dir plugins/gon plugin details gon`)
- Component inventory: Skills (1) `gon`, Agents (1) `gon-expert`, Hooks (0), MCP servers (0), LSP servers (0)
- Projected token cost (Always-on): `~196 tok` added to every session
- Per-component (rounded):
  - `gon`: always-on `~100 tok`, on-invoke `~2.5k tok`
  - `gon-expert`: always-on `~90 tok`, on-invoke `~530 tok`

## Task 10 세션 기록 경로 확인 및 측정 도구 (`measure-usage.mjs`)
- Claude Code 세션 기록 위치(실제 파일 구조 확인):
  - 프로젝트 슬러그 폴더: `~/.claude/projects/<project-slug>/` (경로 구분자 `:`, `\`, `/`와 언더스코어 `_`, 한글 등 비ASCII 문자를 모두 `-`로 치환한 형태)
  - 메인 세션 기록: `~/.claude/projects/<project-slug>/<session-uuid>.jsonl`
  - 서브에이전트 기록: `~/.claude/projects/<project-slug>/<session-uuid>/subagents/agent-<agent-id>.jsonl`
  - 합산 명령: `node tools/measure-usage.mjs ~/.claude/projects/<project-slug>/<session-uuid>.jsonl ~/.claude/projects/<project-slug>/<session-uuid>/subagents`
- 깊이별 대화형 실측 표 (Task 10 Steps 3~7 대화형 세션에서 사용자 승인 클릭과 함께 측정 예정):

| 구분 | 입력 (`input`) | 캐시 쓰기 (`cacheWrite`) | 캐시 읽기 (`cacheRead`) | 출력 (`output`) | 메시지 수 | 캐시 읽기 비율 (`cacheReadRatio`) | 단계 누락률 | 파싱 성공률 |
|---|---|---|---|---|---|---|---|---|
| 빠름 (`quick`) | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 |
| 보통 (`normal`, §5.9 준수) | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 |
| 보통 (`normal`, §5.9 위반 변형) | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 |
| 깊게 (`deep`) | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 | 미측정 |



