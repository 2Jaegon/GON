# 이미지 생성 (Image Generation via Catalog & gen-image Wrapper) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans to implement this plan task-by-task.

**Goal:** 사용자의 이미지 요청 시 카탈로그(C1~C13) 기반으로 고품질 영어 프롬프트를 구성하고, `tools/gen-image.mjs` 래퍼로 Antigravity 이미지 생성을 호출하여 결과 이미지를 `<작업폴더>/.gon-images/`에 저장하고 웹 UI에 렌더링한다.

**Architecture:**
- `config/image-prompt-catalog.json`: 13개 카테고리(C1~C13)와 규칙 블록(B1~B20), 제외 목록(C14~C15)을 담은 프롬프트 카탈로그.
- `packages/aso-core/src/image-catalog.ts`: Zod 스키마 및 `loadImageCatalog` 로더.
- `tools/gen-image.mjs`: Antigravity CLI를 호출해 이미지를 생성하고 `.gon-images/`로 복사하는 Node 내장 모듈 전용 래퍼.
- `apps/api/src/routes/runs.ts`: `.gon-images/` 안전 서빙 API (`GET .../runs/:runId/images/:name`).
- `packages/provider-adapters/src/agent-prompt.ts`: 에이전트 시스템 프롬프트 지침 빌더.
- `packages/provider-adapters/src/claude-agent.ts`: `appendSystemPrompt` 인자 지원 및 래퍼 실행 도구 허용.
- `apps/web/public/app.js`: Markdown 내 `![alt](.gon-images/<name>)` 안전 렌더링.

---

### Task 1: 카탈로그와 로더 (`config/image-prompt-catalog.json`, `packages/aso-core`)
- 파일:
  - Create: `config/image-prompt-catalog.json`
  - Create: `packages/aso-core/src/image-catalog.ts`
  - Modify: `packages/aso-core/src/index.ts`
  - Test: `tests/aso-web/image-catalog.test.ts`
- 요구사항:
  - 13개 카테고리 C1~C13 정의 (id, name, triggers, requiredRefs, template, ruleBlocks)
  - 공통 규칙 블록 맵 (B1 피부 리얼리즘, B2 정체성 잠금, B6 앵글 등)
  - 제외 목록 (C14 영상 8개, C15 텍스트 분석 3개)
  - 모든 템플릿은 영어, 금지어(Disney, Spotify, Adidas, CELINE, alo, Starbucks 등 브랜드명, `[출처]`) 없음, `{slot}` 형태
  - `loadImageCatalog(file?: string): ImageCatalog` 함수 제공 및 zod 스키마 검증

### Task 2: 이미지 생성 래퍼 `tools/gen-image.mjs`
- 파일:
  - Create: `tools/gen-image.mjs`
  - Test: `tests/aso-web/gen-image.test.ts`
- 인터페이스:
  - `parseAgyImageResult(stdoutJson: string): { conversationId: string } | null`
  - `findNewestImage(brainDir: string, sinceMs?: number): string | null`
  - `buildAgyImageArgs(prompt: string, emptyDir: string): string[]`
  - `generateImage(opts: { prompt: string; outDir: string; brainBaseDir?: string; runner?: Function }): Promise<{ path: string; via: string }>`
  - CLI: `node tools/gen-image.mjs --out <작업폴더> "<영어 프롬프트>"`
  - stdout: `{"path": ".gon-images/20261106-160000-1.png", "via": "agy"}` (성공 시 exit 0), 실패 시 stderr/stdout에 error 및 exit 1.

### Task 3: 이미지 서빙 API (`GET .../runs/:runId/images/:name`)
- 파일:
  - Modify: `apps/api/src/routes/runs.ts`
  - Test: `tests/aso-web/image-routes.test.ts`
- 인터페이스:
  - `GET /api/v1/workspaces/:workspaceId/runs/:runId/images/:name`
  - `name` 정규식 `^[\w.-]+$` 검증, runContext.cwd의 `.gon-images/` 내부 파일만 서빙
  - 확장자별 Content-Type (png: image/png, jpg/jpeg: image/jpeg, webp: image/webp)
  - 경로 탈출(`..`, `%2e%2e`, 백슬래시, 절대경로, 심볼릭 링크) 차단 및 404/400 반환

### Task 4: 에이전트 시스템 프롬프트 및 지침 연동
- 파일:
  - Create: `packages/provider-adapters/src/agent-prompt.ts`
  - Modify: `packages/provider-adapters/src/claude-agent.ts`
  - Modify: `packages/provider-adapters/src/index.ts`
  - Modify: `apps/api/src/services/agent-service.ts`
  - Test: `tests/aso-web/agent-prompt.test.ts`
- 요구사항:
  - `buildAgentSystemPrompt(opts: { image?: { gonRoot: string; catalogSummary: string } }): string`
  - `AgentRunOptions`에 `appendSystemPrompt?: string` 지원
  - `buildAgentArgs`에 `--append-system-prompt` 인자 추가
  - 자동 허용 목록에 `Bash(node <gonRoot>/tools/gen-image.mjs:*)` 추가 (절대경로 및 슬래시/백슬래시 지원)

### Task 5: 웹 화면 안전 이미지 렌더링 (`renderSafeMarkdown`)
- 파일:
  - Modify: `apps/web/public/app.js`
  - Test: `tests/aso-web/image-markdown.test.ts`
- 요구사항:
  - `![alt](.gon-images/<name>)`만 `<img src="/api/v1/workspaces/<ws>/runs/<runId>/images/<name>" alt="alt" class="agent-generated-img" />`로 변환
  - 외부 URL, `javascript:`, 따옴표 주입 차단

### Task 6: 전체 통합 검증 및 장부 정리
- `npm run build`, `npm test` 전체 검증
- 진행 장부 기록

