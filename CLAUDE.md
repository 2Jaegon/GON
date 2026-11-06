# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Project Agent Guidance (Gon - Adaptive Skill Orchestrator)

이 저장소는 **Gon(Adaptive Skill Orchestrator)** 프로젝트입니다.
개발 및 코드 변경 작업 시 아래 단일 최상위 오케스트레이션 규칙을 따릅니다.

## 핵심 규칙
1. **단일 최상위 지휘자**: 오케스트레이션 및 작업 계획의 최종 권한은 Gon(/gon)에게 있습니다. Superpowers나 ECC의 별도 planner를 최상위 관리자로 중복 실행하지 않습니다.
2. **적응형 실행 모드**: 작업 범위와 위험도에 따라 FAST / STANDARD / DEEP을 적용합니다.
   - **FAST**: 경량 수정(오타/주석/단순버그). 별도 장문 계획이나 서브에이전트 없이 단일 인라인 실행.
   - **STANDARD**: 일반적인 기능 구현. 경량 DAG + 1~2개 필수 전문 스킬 + 계획 승인 1회.
   - **DEEP**: 고위험/대규모 리팩터링/인증/보안. 상세 DAG + 계약/위험대장 + 격리 실행 + 강화된 검증.
3. **스킬 선별 로딩**: 스킬 본문은 필요한 단계에서만 지연 로딩합니다. 모든 스킬을 상시 주입하지 않습니다.
4. **ECC 전문화**: ECC는 보안, API 설계, DB 등 특정 기술 영역의 전문 지침(specialist)으로만 선별 편입하며, 전역 훅/메모리/오케스트레이터로 사용하지 않습니다.
5. **검증 중심**: 실제로 실행되어 통과한 테스트만 pass로 보고하며, 미실행 항목은 unverified로 둡니다.
6. **토큰 및 시간 계측**: 실측된 토큰과 시간만 기록하며, 측정 불가 시 `unknown`/`null`로 표기합니다(추측값 0 입력 금지).
7. 세부 계약은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)(실제 따르는 계약: `events.jsonl` v2, `report.json`, CLI 명령·종료 코드), 설계 근거는 [docs/ASO_SPEC.md](docs/ASO_SPEC.md)를 참조합니다.

## Graphify 규칙
- `graphify-out/graph.json`이 존재할 때 다중 모듈 간 의존성이나 구조적 질문이 있는 경우에만 `graphify query`를 활용합니다.
- 단순/국소적 코드 수정에는 불필요하게 graphify를 호출하지 않습니다.

## 빠른 명령어
- 빌드: `npm run build` — `packages/*` → `apps/*` → `cli` 순서로 `tsc` 실행(순서가 의존 관계). CLI만: `npm run build:cli`
  - 별도 lint 스크립트는 없고, `npm run typecheck`도 `build`와 같습니다(타입 검사 = 빌드).
- 테스트: `npm test` = `test:viewer`(node:test, `tests/*.test.mjs`) + `vitest run`(`tests/cli`, `tests/aso-web`)
  - 묶음별: `npm run test:viewer`, `npm run test:cli`, `npm run test:aso-web`
  - 파일 하나: `npx vitest run tests/cli/router.test.ts` / `node --test tests/skill-lint.test.mjs`
  - 이름으로: `npx vitest run -t "<테스트 이름>"`
- vitest는 `@aso/*`를 `packages/*/src`로 alias하므로 테스트에는 빌드가 필요 없습니다. `node cli/dist/...`나 `npm start`는 빌드가 먼저 필요합니다.
- 진단/동기화: `node cli/dist/cli.js doctor`, `node cli/dist/cli.js skills sync [--check]`
- 웹앱 실행: `npm run build` 후 `npm run dev` (API :4000 + Web :3000, `scripts/start-all.js`가 `dist/`를 띄우고 루트 `.env`를 읽음 — 키 목록은 `.env.example`)

## 구조 (세 갈래)
1. **Gon 스킬팩** — 배포되는 Claude Code 플러그인(`.claude-plugin/marketplace.json`)
   - `plugins/gon/skills/gon/`이 **정본**입니다. `SKILL.md` + `cards/`(refine·plan·approve·verify) + `references/`(fast·standard·deep·routing) + `tools/`(호스트별 차이).
   - `.agents/skills/gon/`, `.claude/skills/gon/`은 `gon skills sync`가 만드는 **복사본**(SHA-256 검증). 직접 고치지 말고 정본을 고친 뒤 sync합니다.
   - `plugins/gon/viewer/`: `.gon/<run_id>/events.jsonl`을 읽는 로컬 읽기 전용 그래프 뷰어. `events.mjs`의 `validateRun`이 기록 계약을 검증합니다.
   - `tests/skill-lint.test.mjs`가 카드·레퍼런스 이름, frontmatter, 예시 실행 기록을 검사하므로 스킬 파일 구조를 바꾸면 이 테스트도 함께 맞춥니다.
2. **`gon` CLI** (`cli/src`, 선택 도구) — `registry/`(스킬 탐색·카탈로그·충돌), `core/`(classifier·router), `observability/`(세션 로그 → 토큰·비용 `report.json`), `statusline.ts`. 정책·카탈로그·가격표 데이터는 `config/`에 있습니다.
3. **ASO Web 앱** (npm workspaces 모노레포, 설계는 [docs/ASO_WEB_APP_SPEC.md](docs/ASO_WEB_APP_SPEC.md), 결정·가정은 [docs/DECISIONS.md](docs/DECISIONS.md))
   - `packages/`: `contracts`(zod 스키마) → `security` → `database` → `aso-core` → `execution-protocol` → `provider-adapters`
   - `apps/`: `api`(fastify), `web`, `worker`, `local-runner`(`aso-runner` bin)
   - `apps/web/src/server.ts`는 정적 파일 서버일 뿐이고, UI는 `apps/web/public/`의 빌드 없는 바닐라 JS(`app.js`, `index.html`, `style.css`)입니다. UI 수정은 `public/`을 직접 고칩니다.
   - 실행 흐름: `apps/api/src/services/orchestrator-service.ts`가 `@aso/core`(IntentRefiner → TaskClassifier → DAGPlanner → SkillRouter)로 계획을 세우고, `ProviderRegistry`가 claude·codex·agy CLI 어댑터(`CliRunner`로 실행)를 고릅니다. `auto`는 테스트(`VITEST`/`NODE_ENV=test`)에서 `MockProvider`, 그 외엔 agy입니다. `local-runner`는 WebSocket `/api/v1/runner/ws`(`runner-gateway.ts`)로 붙어 서명된 작업 계약을 `@aso/execution-protocol`로 검증하고, `@aso/security`(경로 가드·명령 위험도·비밀값 마스킹)를 거쳐 실행합니다.
   - 저장소: `@aso/database`의 `MemoryDatabase`는 `NODE_ENV=test`일 때만 순수 인메모리이고, 그 외에는 `.aso/db.json`(또는 `ASO_DB_FILE`)에 세션·실행 기록을 저장합니다. `DATABASE_URL`은 Supabase 사용자 조회(`apps/api/src/auth/supabase-users.ts`)에만 쓰이며, Postgres/Redis/MinIO(`infra/compose.yaml`)는 필수가 아닙니다.

## 코드 작성 원칙 (Ponytail + Karpathy)
- 문제를 해결하는 가장 작고 단순한 diff를 작성하며, 요구받지 않은 불필요한 추상화·옵션(YAGNI)을 금지합니다.
- `plugins/gon/`은 Node 내장 모듈만 사용합니다(외부 의존성 0개 — 플러그인 캐시에서는 `npm install`이 돌지 않음). CLI 패키지는 `cli/`에만 둡니다.
