import { ExecutionMode } from "@aso/contracts";

export interface SkillSelection {
  skillId: string;
  name: string;
  reason: string;
  mandatory: boolean;
}

export class SkillRouter {
  public route(mode: ExecutionMode, taskTitle: string, capabilityNeeds: string[]): SkillSelection[] {
    const selected: SkillSelection[] = [];

    // Always include Ponytail principle (YAGNI, minimal diffs) for implementation
    if (capabilityNeeds.includes("code")) {
      selected.push({
        skillId: "ponytail",
        name: "ponytail",
        reason: "YAGNI 원칙 및 최소 diff 유지",
        mandatory: true
      });
    }

    // Graphify for complex multi-module or deep tasks
    if (mode === "deep" || /아키텍처|의존성|모노레포|리팩토링/i.test(taskTitle)) {
      selected.push({
        skillId: "graphify",
        name: "graphify",
        reason: "복합 코드베이스 지식 그래프 및 의존성 관계 분석",
        mandatory: false
      });
    }

    // Testing / verification
    if (capabilityNeeds.includes("review") || /테스트|검증/i.test(taskTitle)) {
      selected.push({
        skillId: "karpathy",
        name: "andrej-karpathy-skills",
        reason: "간결한 엔지니어링 및 철저한 테스트 검증 원칙",
        mandatory: false
      });
    }

    // UI Mockup, Faux Product UI, Motion & Frontend Design (Benji Taylor Stageshow)
    if (capabilityNeeds.includes("ui") || capabilityNeeds.includes("design") || /ui|ux|mockup|디자인|모션|데모|프론트엔드|컴포넌트|화면/i.test(taskTitle)) {
      selected.push({
        skillId: "stageshow",
        name: "stageshow",
        reason: "실제 제품 수준의 세련된 Faux UI, 인터랙티브 데모 및 디자인 시스템 가이드 (Benji Taylor)",
        mandatory: false
      });
    }

    return selected;
  }
}

