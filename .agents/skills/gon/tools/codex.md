# Codex CLI 실행 안내 (`tools/codex.md`)

- Codex 환경에서는 정본에서 동기화된 `.agents/skills/gon/` 스킬을 사용한다.
- 동기화는 `gon skills sync` (또는 `node cli/dist/cli.js skills sync`) 명령으로 수행한다.
- 비대화식 자동 승인 플래그(예: `--yolo`)는 임의로 사용하지 않으며, 안전 정책을 준수한다.
- 하위 작업 실행 시 동일한 워커 계약(배정된 파일만 수정, events.jsonl 미수정)을 따른다.

