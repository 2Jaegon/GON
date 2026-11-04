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
7. 세부 계약 및 아키텍처는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)와 [docs/ASO_SPEC.md](docs/ASO_SPEC.md)를 참조합니다.

## Graphify 규칙
- `graphify-out/graph.json`이 존재할 때 다중 모듈 간 의존성이나 구조적 질문이 있는 경우에만 `graphify query`를 활용합니다.
- 단순/국소적 코드 수정에는 불필요하게 graphify를 호출하지 않습니다.

## 빠른 명령어
- 빌드: `npm run build` (TypeScript 컴파일 -> cli/dist/)
- 테스트: `npm test` (전체 106개 테스트) 또는 `npm run test:cli`, `npm run test:viewer`
- 진단/동기화: `node cli/dist/cli.js doctor`, `node cli/dist/cli.js skills sync`

## 코드 작성 원칙 (Ponytail + Karpathy)
- 문제를 해결하는 가장 작고 단순한 diff를 작성하며, 요구받지 않은 불필요한 추상화·옵션(YAGNI)을 금지합니다.
- `plugins/gon/`은 Node 내장 모듈만 사용하며(외부 의존성 0개), CLI 패키지는 `cli/`에만 둡니다.
