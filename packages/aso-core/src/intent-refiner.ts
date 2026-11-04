import { RunRequirements } from "@aso/contracts";

export class IntentRefiner {
  public refine(request: string): RunRequirements {
    const trimmed = request.trim();

    const goals: string[] = [];
    const assumptions: string[] = [];
    const constraints: string[] = [];
    const acceptanceCriteria: string[] = [];

    // Primary Goal
    goals.push(`핵심 요구사항 달성: ${trimmed}`);

    // Standard engineering constraints
    constraints.push("기존 코드베이스의 코딩 스타일 및 타입 선언을 보존할 것");
    constraints.push("하위 호환성을 유지하고 불필요한 의존성을 추가하지 않을 것");
    constraints.push("비밀정보(API 키, 토큰)를 절대 코드나 로그에 노출하지 않을 것");

    // Standard assumptions
    assumptions.push("Node.js LTS 및 TypeScript 환경에서 테스트가 검증됨");
    assumptions.push("로컬 파일 시스템 권한 내에서만 안전하게 수정 수행");

    // Acceptance criteria derived from intent
    acceptanceCriteria.push("요청된 기능 구현 및 모든 관련 파일 변경 완료");
    acceptanceCriteria.push("TypeScript 타입 검사(tsc) 100% 통과");
    acceptanceCriteria.push("단위 및 통합 테스트 실행 시 회귀 결함 없이 통과");

    if (/api|엔드포인트|서버|fastify|express/i.test(trimmed)) {
      goals.push("REST API 엔드포인트 정의 및 Zod 스키마 유효성 검증");
      acceptanceCriteria.push("새로운 API 엔드포인트에 대한 요청/응답 검증 테스트 통과");
    }

    if (/ui|화면|페이지|웹|컴포넌트|react|next/i.test(trimmed)) {
      goals.push("사용자 반응형 인터페이스 및 접근성 가이드라인 준수");
      acceptanceCriteria.push("UI 렌더링 및 사용자 인터랙션 동작 검증");
    }

    return {
      goals,
      assumptions,
      constraints,
      acceptanceCriteria
    };
  }
}

