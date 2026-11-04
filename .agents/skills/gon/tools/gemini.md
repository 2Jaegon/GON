# Gemini CLI 실행 안내 (`tools/gemini.md`)

- Gemini 환경에서는 정본에서 동기화된 `.agents/skills/gon/` (또는 `.gemini/skills/gon/`) 스킬을 사용한다.
- 동기화는 `gon skills sync` (또는 `node cli/dist/cli.js skills sync`) 명령으로 수행한다.
- 비대화식 자동 승인 플래그(예: `--dangerously-skip-permissions`)는 임의로 사용하지 않는다.
- 토큰 및 사용량 필드가 보고되지 않는 경우 임의 추측값을 넣지 않고 `unknown`으로 기록한다.

