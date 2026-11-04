# STANDARD 모드 실행 지침

일반적인 기능 구현, 모듈 개선 등 명확한 범위의 다단계 작업(기본값)에 적용한다.

## 실행 절차
1. **시작 기록**: `.gon/<run_id>/events.jsonl`에 `run.start`를 기록한다 (`mode: "standard"`).
2. **구체화 (`refine`)**:
   - 목표, 산출물, 제약사항, 가정, 수용 기준을 정리하여 `.gon/<run_id>/brief.md`에 작성한다.
   - 질문은 결과에 영향을 주는 치명적 모호성(blocking)이 있을 때만 1회 최대 5개 이내로 묶어 묻는다.
   - node 이벤트 기록: `id: "refine"`, `stage: "refine"`, `status: "done"`, `out: "brief.md"`.
3. **기획 (`plan`)**:
   - 작업 DAG(작업 id, 제목, 의존성 `dependsOn`, 수정 범위 `writeScope`, 수용 기준, 검증 명령)를 수립하여 `.gon/<run_id>/plan.md`에 작성한다.
   - node 이벤트 기록: `id: "plan"`, `stage: "plan"`, `status: "done"`, `out: "plan.md"`.
4. **스킬 선별 (`route`)**:
   - 각 작업에 필요한 최소 전문 스킬(1~3개)을 [references/routing.md](routing.md) 또는 `gon skills route`로 결정한다.
   - 충돌 스킬 및 불필요한 스킬 본문 로딩을 차단한다.
5. **계획 승인 (`approve`)**:
   - 사용자에게 기획 내용, 수정 대상 파일, 검증 명령을 명확히 제시하고 승인을 요청한다.
   - 사용자가 명시적으로 승인 메시지를 보낸 후에만 6단계로 진행한다.
   - node 이벤트 기록: `id: "approve"`, `stage: "approve"`, `status: "done"`.
6. **실행 (`execute`)**:
   - 기본적으로 단일 실행을 권장하며, 상호 독립적이고 `writeScope`가 완전히 분리된 작업에 한해 최대 2개의 `gon:gon-expert` 서브에이전트를 한 번의 메시지로 병렬 호출한다.
   - node 이벤트 기록: `id: "<작업id>"`, `stage: "execute"`, `role: "<역할>"`, `via: "subagent"`, `files: [...]`.
7. **독립 검증 (`verify`)**:
   - 작업 착수 전 캡처한 기준선(`baseline.txt`)과 최종 변경 사항을 대조하고, 단위/통합 테스트를 실행하여 `.gon/<run_id>/verify.md`에 기록한다.
   - node 이벤트 기록: `id: "verify"`, `stage: "verify"`, `status: "done"`, `out: "verify.md"`.
8. **종료 및 보고**:
   - `run.end`를 기록하고 `node cli/dist/cli.js report <run_id>` 요약을 최종 보고에 포함한다.

