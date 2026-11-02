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
