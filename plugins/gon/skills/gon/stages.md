# Gon 7단계 담당 스킬 및 대체 카드 표 (`stages.md`)

각 단계에 들어갈 때 해당 행만 참조한다. 우선 담당 스킬이 있으면 그 방법만 빌리고, 산출물 경로·승인 게이트·다음 단계는 SKILL.md §4의 Gon 규칙을 따른다. 우선 담당 스킬이 없으면 멈추지 않고 대체 카드를 읽고 진행하며, 기록 줄에 `"fallback":true`를 남긴다.

| # | 단계 (`stage`) | 기본 노드 `id` | 우선 담당 스킬 (Claude Code 표기) | 내장 대체 카드 / 에이전트 | 산출물 예 |
|---|---|---|---|---|---|
| 1 | 질문 접수 | `main` (가상 루트) | 지휘자 직접 (`run.start` 기록) | — | `events.jsonl` |
| 2 | `grill` | `interview` | `mattpocock-skills:grilling` (또는 `grilling`) | [cards/grill.md](cards/grill.md) | `brief.md` |
| 3 | `plan` | `plan` | `superpowers:brainstorming` | [cards/plan.md](cards/plan.md) | `plan.md` |
| 4 | `check` | `check` | `mattpocock-skills:grilling` (선택: `ecc:council`) | [cards/check.md](cards/check.md) | 사용자 승인 메시지 |
| 5 | `compose` | `compose` | `superpowers:writing-plans` | [cards/compose.md](cards/compose.md) | `compose.md` |
| 6 | `execute` | 역할별 (`fe`, `be`, `qa` 등) | 항상 `gon:gon-expert` (다른 실행 스킬로 넘기지 않음) | — ([../../agents/gon-expert.md](../../agents/gon-expert.md)) | 프로젝트 코드 + `<id>.md` |
| 7 | `lead` | `lead` | `superpowers:verification-before-completion` | [cards/lead.md](cards/lead.md) | `lead.md` + `run.end` |

## 단계별 주의사항
- `check` 단계: 계획과 기존 파일 덮어쓰기·삭제 목록을 보여 준 뒤 사용자의 승인 응답을 기다린다.
- `compose` 단계: 전문가들이 동시에 수정할 파일이 절대 겹치지 않게 나눈다.
- `execute` 단계: 도구별 병렬 호출 방법은 [tools/claude.md](tools/claude.md)를 따른다.
