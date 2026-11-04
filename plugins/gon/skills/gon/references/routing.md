# 스킬 라우팅 및 대체 카드 표 (`references/routing.md`)

각 단계를 수행할 때 이 표의 해당 단계 행만 참조한다. 우선 담당 스킬이 설치되어 있으면 그 방법론(HOW)만 빌리고, 없으면 내장 대체 카드를 읽어 진행하며 기록 줄에 `"fallback": true`를 남긴다.

| 단계 (`stage`) | 기본 노드 `id` | 우선 담당 스킬 | 내장 대체 카드 | 비고 |
|---|---|---|---|---|
| 질문 접수 | `main` | 지휘자 직접 | — | `run.start` 기록 |
| `refine` | `refine` | `mattpocock-skills:grilling` | [../cards/refine.md](../cards/refine.md) | 모호성 해소 및 `brief.md` 확정 |
| `plan` | `plan` | `superpowers:brainstorming` | [../cards/plan.md](../cards/plan.md) | DAG, writeScope, `plan.md` 수립 |
| `route` | `route` | 지휘자 / `gon skills route` | — | 작업별 최소 전문 스킬 배정 |
| `approve` | `approve` | 지휘자 직접 | [../cards/approve.md](../cards/approve.md) | 사용자 명시적 승인 메시지 확인 |
| `execute` | 작업별 id | 항상 `gon:gon-expert` | — | 다른 실행 스킬로 넘기지 않음 |
| `verify` | `verify` | `superpowers:verification-before-completion` | [../cards/verify.md](../cards/verify.md) | 기준선 대조, 테스트, `verify.md` |

## 전문 스킬 선별 (필요 시에만 편입)
- 보안 점검: `ecc:security-review` (DEEP 모드 또는 인증/권한 변경 시)
- API 설계: `ecc:api-design` (신규 계약 또는 DTO 정의 시)
- 코드베이스 구조 탐색: `graphify` (다중 패키지 구조 분석 시 조건부)
- 과거 결정/세션 기억: `claude-mem` (과거 결정 언급 또는 작업 재개 시)

## 절대 배제 규칙
- ECC의 `master-planner`, `orchestrator`, `council`, `memory`는 Gon의 단일 지휘 및 캐시 보존을 위해 절대 로드하지 않는다.

