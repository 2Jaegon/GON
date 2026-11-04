# Gon (ASO) 구조와 계약

설계 근거는 [ASO_SPEC.md](ASO_SPEC.md)이다. 이 파일은 이 저장소가 **실제로 따르는 계약**만 적는다. 명세와 다르게 결정한 것은 "결정" 줄에 남긴다.

## 1. 구성

| 경로 | 역할 | 의존성 |
|---|---|---|
| `plugins/gon/skills/gon/` | **정본 스킬** (Mode N). `/gon`으로 호출 | 없음 (문서) |
| `plugins/gon/agents/gon-expert.md` | 실행 워커 (spec 5.3 계약) | 없음 |
| `plugins/gon/viewer/` | 그래프·지표 뷰어 (Node 내장 모듈만) | 없음 |
| `cli/` | `gon` CLI (TypeScript → `cli/dist`) | zod, commander / dev: typescript, vitest, @types/node |
| `config/` | 설정·정책·잠금·가격표 (설계 데이터) | — |
| `.gon/` | 실행 기록 (gitignore) | — |
| `.agents/skills/gon/` | Codex·Gemini용 복사본. `gon skills sync`가 생성하고 SHA-256으로 검증 | — |

- 결정: 플러그인 폴더(`plugins/gon`)는 외부 의존성 0개를 유지한다. 플러그인 캐시에는 `npm install`이 돌지 않기 때문이다. `gon` CLI는 선택 도구이고, 없어도 스킬은 동작한다.
- 결정: 명세의 `aso` → `gon`, `.aso/` → `.gon/`, `adaptive-orchestrator` → `gon`.

## 2. 실행 기록 `events.jsonl` v2

`.gon/<run_id>/events.jsonl`, 한 줄에 JSON 하나. `run_id` = `^\d{8}-\d{4}-[0-9a-f]{4}$`. 기록은 지휘자(메인 AI)만 쓴다.

| ev | 필드 |
|---|---|
| `run.start` (첫 줄, 한 번) | `v:2`, `t`, `run`, `req`(≤2000), `tool`, `mode`: `fast`\|`standard`\|`deep`, `mode_reason`(선택, ≤500) |
| `node` | `t`, `id`(`^[a-z0-9][a-z0-9_-]{0,63}$`, `main` 금지), `status`: `running`\|`done`\|`failed`\|`skipped`. 첫 줄에는 `from`(부모 id 배열 또는 `["main"]`)과 `stage`가 필요하다. 선택 필드: `sum`, `out`(평평한 `.md` 이름), `role`, `via`(`subagent`\|`inline`), `fallback`(bool), `files`(string[]), `skills`(string[]) |
| `run.end` (한 번) | `t`, `status`: `done`\|`failed` |

- v2 `stage`: `refine` \| `plan` \| `route` \| `approve` \| `execute` \| `verify`
- v1 호환: `v:1` 기록(`depth`: quick/normal/deep, v1 stage 집합)도 계속 읽고 검증한다. 화면과 보고에서는 `quick→fast`, `normal→standard`, `deep→deep`으로 바꿔 보여 준다.
- 토큰 수는 events에 쓰지 않는다. 모델이 토큰 수를 짐작해서 적지 않게 하려는 것이다. 지표는 `gon report`가 만든다.

## 3. 지표 `report.json` v1

`gon report <run_id>`가 `.gon/<run_id>/report.json`을 쓴다. 뷰어는 이 파일이 있으면 읽어서 보여 준다.

```json
{
  "v": 1,
  "run": "20261104-0952-ab12",
  "mode": "standard",
  "status": "done",
  "startedAt": "2026-11-04T00:52:00Z",
  "endedAt": "2026-11-04T01:04:42Z",
  "elapsedMs": 762000,
  "nodes": [{ "id": "plan", "stage": "plan", "status": "done", "durationMs": 41000 }],
  "usage": {
    "source": "claude-session-log",
    "input": 1234, "cacheWrite": 40000, "cacheRead": 310000, "output": 8100,
    "messages": 37, "cacheReadRatio": 0.88, "files": 2
  },
  "cost": { "estimatedUsd": null, "source": "unknown", "note": "환산 비용이며 실제 청구액이 아님" },
  "generatedAt": "2026-11-04T01:05:00Z"
}
```

- `status`: `done` | `failed` | `running`. `elapsedMs`는 `run.end`가 없으면 `null`이다.
- `usage.source`: `claude-session-log` | `codex-session-log` | `unknown`. `unknown`이면 숫자 칸은 모두 `null`이다(0 금지).
- 세션 로그 범위:
  - Claude: `~/.claude/projects/*/**/*.jsonl` 중 `cwd`가 프로젝트 루트와 같고 `timestamp`가 [run.start, run.end(없으면 지금)] 안에 있는 줄만 센다. `message.id` 기준으로 중복을 지우고 마지막 값을 쓴다. 하위 에이전트 로그도 포함한다.
  - Codex: `~/.codex/sessions/**/rollout-*.jsonl`의 `token_count` 누적값 차이를 쓴다. `input`은 `input_tokens - cached_input_tokens`이다.
  - 홈 폴더 전체는 재귀 탐색하지 않는다.
- `cost.estimatedUsd`는 `config/pricing-snapshot.json`에 해당 모델 단가가 있을 때만 계산한다. 없으면 `null` + `unknown`이다.

## 4. `gon` CLI 명령

| 명령 | 출력 |
|---|---|
| `gon doctor [--json]` | CLI 3종 버전, 켜진 플러그인, ECC 훅 프로필, 중복 스킬, 정본·복사본 해시, 권고. 확인 못 한 항목은 `UNKNOWN`. 파일은 쓰지 않는다 |
| `gon skills list [--json]` | 색인된 스킬: id, 출처, 단계, 위험, 승인 |
| `gon skills inspect <id>` | 경로, sha256, 충돌, 사전조건 |
| `gon skills route --phase <p> [--caps a,b] [--mode m] [--stack s]` | 선택된 스킬과 점수, 제외 사유 (JSON) |
| `gon skills sync [--check]` | 정본 → `.agents/skills/gon/` 복사 + 해시 검증 |
| `gon classify "<요청>" [--files n]` | `{mode, reason, signals}` (규칙 기반) |
| `gon report <run_id\|latest> [--host claude\|codex] [--json]` | 사람이 읽는 요약 + `report.json` |
| `gon statusline` | stdin으로 Claude Code 상태줄 JSON을 받아 한 줄 출력 |

종료 코드: 0 = 정상, 1 = 사용법 오류, 2 = 대상 없음·검증 실패.

## 5. 상태줄

프로젝트 `.claude/settings.json`의 `statusLine.command` = `node cli/dist/cli.js statusline`(먼저 `npm run build`가 필요하다).

출력 예: `⏱ 12m04s · in 1.2k · cw 40k · cr 310k · out 8.1k · $0.42 (CC 집계) · ▶ gon standard 3m10s`

- `$`는 Claude Code가 넘겨 준 `cost.total_cost_usd`이다. Gon이 계산한 값이 아니다.
- 토큰은 `transcript_path` 로그를 합산한 값이다. 로그를 읽지 못하면 `context_window.total_*_tokens`를 쓰고, 그것도 없으면 `tok ?`로 표시한다.
- `▶`는 진행 중인 최신 `.gon` 실행이 있을 때만 나온다.

