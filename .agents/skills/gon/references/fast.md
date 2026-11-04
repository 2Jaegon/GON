# FAST 모드 실행 지침

단순 수정(오타, 주석, 문구, 단일 함수 버그 등 수정 파일 2개 이하, 저위험 작업)에 적용한다.

## 실행 절차
1. **시작 기록**: `.gon/<run_id>/events.jsonl`에 `run.start`를 기록한다 (`mode: "fast"`).
2. **요구 구체화 (`refine`)**:
   - 별도의 `brief.md` 파일 생성 없이 체크리스트 1~3개로 목표와 변경할 파일을 즉시 정리한다.
   - node 이벤트 기록: `id: "fast-plan"`, `stage: "refine"`, `sum: "<목표 요약>"`.
3. **직접 실행 (`execute`)**:
   - 서브에이전트 없이 지휘자가 직접 인라인(`via: "inline"`)으로 파일을 수정한다.
   - 계획 승인 절차는 생략한다. 단, 파일 삭제나 외부 전송 작업이 필요해지면 즉시 중단하고 사용자 승인을 구한다.
   - node 이벤트 기록: `id: "fast-exec"`, `stage: "execute"`, `status: "done"`, `files: ["<수정 파일>"]`.
4. **검증 (`verify`)**:
   - 변경한 파일의 관련 테스트를 실행하고 `git diff`로 의도치 않은 변경이 없는지 확인한다.
   - node 이벤트 기록: `id: "fast-verify"`, `stage: "verify"`, `status: "done"`.
5. **종료 및 보고**:
   - `run.end`를 기록하고 변경 파일, 실행한 테스트 결과, 경과 시간을 보고한다.
   - `node cli/dist/cli.js report <run_id>` 실행 결과를 보고 마지막 줄에 첨부한다.

