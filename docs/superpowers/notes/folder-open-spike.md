# Task 6 스파이크: `file://` 폴더 직접 열기 (`folder-open-spike.md`)

## 1. 목적
Node가 없는 PC에서 사용자가 `plugins/gon/viewer/index.html`을 `file://` 주소로 직접 열어 `<script type="module">`과 `showDirectoryPicker`로 `.gon/` 폴더를 읽을 수 있는지 확인한다.

## 2. 확인 결과 (실패 — `folderSource` 추가하지 않음)
1. **ES 모듈 CORS 차단 (명세·구조상 불가)**:
   - `viewer/index.html`은 `<script type="module" src="/app.js">`로 `events.mjs`, `graph-layout.mjs`, `md-safe.mjs`를 불러온다.
   - HTML 표준 및 Chromium(Chrome·Edge) 보안 정책상 `file://` 문서는 불투명 출처(`Origin: null`)를 가지며, `<script type="module">`은 CORS 모드로 요청되므로 `file://`에서 다른 로컬 `.mjs` 파일을 불러올 때 CORS 오류(`Cross origin requests are only supported for protocol schemes: http, https...`)로 차단된다.
   - 또한 서버용 정적 경로(`/style.css`, `/app.js`)는 `file://`에서 드라이브 루트(`file:///C:/app.js`)를 가리키게 된다.
2. **샌드박스 실행 환경 한계 기록**:
   - 이 세션의 샌드박스 셸에서는 `chrome.exe` GUI 프로세스가 즉시 종료(종료 코드 0)되어 대화형 브라우저 창에서의 `showDirectoryPicker` 클릭은 직접 실행하지 못했다(추후 Claude Code 컨트롤러 세션에서 `chrome-devtools` MCP로 재확인 가능).
3. **결정 (계획서 Task 6 Step 3 준수)**:
   - 억지로 단일 파일 번들이나 인라인 스크립트로 합치면 Task 5의 정적 보안 제약(`index.html` 인라인 스크립트 금지, CSP `script-src 'self'`)과 충돌하므로 코드를 추가하지 않는다.
   - 그래프 화면은 로컬 Node 서버(`node server.mjs --gon-dir <path>`)를 통해 열도록 안내한다(Claude Code 자체가 Node 런타임을 포함·요구하므로 Claude Code 사용 환경에는 Node가 존재함).
