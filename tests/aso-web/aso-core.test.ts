import { describe, it, expect } from "vitest";
import { TaskClassifier, IntentRefiner, DAGPlanner, SkillRouter } from "@aso/core";

describe("ASO Core Orchestration Engine", () => {
  it("classifies user requests accurately into CHAT, FAST, STANDARD, DEEP", () => {
    const classifier = new TaskClassifier();

    const chat1 = classifier.classify("ㅎㅇ");
    expect(chat1.mode).toBe("chat");

    const chat2 = classifier.classify("안녕하세요");
    expect(chat2.mode).toBe("chat");

    const chat3 = classifier.classify("너 누구야?");
    expect(chat3.mode).toBe("chat");

    const fast = classifier.classify("단순 오타 수정 및 버전 확인");
    expect(fast.mode).toBe("fast");

    const deep = classifier.classify("전체 모노레포 아키텍처 전면 개편 및 마이그레이션");
    expect(deep.mode).toBe("deep");

    const standard = classifier.classify("금융 공시 검색 컴포넌트 추가 및 API 엔드포인트 연동");
    expect(standard.mode).toBe("standard");
  });

  it("refines raw user request into structured requirements", () => {
    const refiner = new IntentRefiner();
    const refined = refiner.refine("금융 공시 검색 및 요약 페이지 추가해줘");

    expect(refined.goals.length).toBeGreaterThan(0);
    expect(refined.constraints.length).toBeGreaterThan(0);
    expect(refined.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(refined.acceptanceCriteria.some((c) => c.includes("TypeScript"))).toBe(true);
  });

  it("plans acyclic DAG tasks for FAST and STANDARD workflows", () => {
    const planner = new DAGPlanner();
    const requirements = {
      goals: ["공시 요약"],
      assumptions: [],
      constraints: [],
      acceptanceCriteria: ["테스트 통과"]
    };

    const fastTasks = planner.plan("run-1", requirements, "fast");
    expect(fastTasks.length).toBe(1);

    const standardTasks = planner.plan("run-2", requirements, "standard");
    expect(standardTasks.length).toBe(3);
    expect(standardTasks[0].dependencies).toEqual([]);
    expect(standardTasks[1].dependencies).toContain(standardTasks[0].taskKey);
  });

  it("detects and throws on cyclic task dependencies", () => {
    const planner = new DAGPlanner();
    const cyclicTasks: any[] = [
      { taskKey: "a", dependencies: ["b"] },
      { taskKey: "b", dependencies: ["c"] },
      { taskKey: "c", dependencies: ["a"] }
    ];
    expect(() => planner.validateNoCycles(cyclicTasks)).toThrow(/Cycle detected/);
  });

  it("routes appropriate skills without overloading contexts", () => {
    const router = new SkillRouter();

    const codingSkills = router.route("standard", "API 구현", ["code"]);
    expect(codingSkills.some((s) => s.skillId === "ponytail")).toBe(true);

    const deepSkills = router.route("deep", "전체 아키텍처 의존성 분석", ["code", "review"]);
    expect(deepSkills.some((s) => s.skillId === "graphify")).toBe(true);
  });
});

