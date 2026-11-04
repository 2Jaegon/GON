import crypto from "node:crypto";
import { RunRequirements, RunTask, ExecutionMode } from "@aso/contracts";

export class DAGPlanner {
  public plan(runId: string, requirements: RunRequirements, mode: ExecutionMode): RunTask[] {
    const tasks: RunTask[] = [];

    if (mode === "chat") {
      tasks.push({
        id: crypto.randomUUID(),
        runId,
        taskKey: "task-chat",
        title: "직접 대화 응답",
        state: "pending",
        dependencies: [],
        fileScope: [],
        capabilityRequirements: ["chat"],
        attempt: 0
      });
      return tasks;
    }

    if (mode === "fast") {
      // Single compact task
      tasks.push({
        id: crypto.randomUUID(),
        runId,
        taskKey: "task-fast-implement",
        title: "직접 구현 및 즉시 검증",
        state: "pending",
        dependencies: [],
        fileScope: [],
        capabilityRequirements: ["code", "review"],
        attempt: 0
      });
      return tasks;
    }

    // Standard / Deep workflow
    // 1. Core Implementation / Contracts
    const task1Id = crypto.randomUUID();
    tasks.push({
      id: task1Id,
      runId,
      taskKey: "task-contracts-core",
      title: "타입 계약 및 핵심 로직 구현",
      state: "pending",
      dependencies: [],
      fileScope: ["packages/contracts/**", "packages/core/**"],
      capabilityRequirements: ["code", "structured_output"],
      attempt: 0
    });

    // 2. Integration / API / UI
    const task2Id = crypto.randomUUID();
    tasks.push({
      id: task2Id,
      runId,
      taskKey: "task-integration",
      title: "기능 연동 및 엔드포인트/UI 통합",
      state: "pending",
      dependencies: ["task-contracts-core"],
      fileScope: ["apps/**"],
      capabilityRequirements: ["code", "tools"],
      attempt: 0
    });

    // 3. Verification & Testing
    tasks.push({
      id: crypto.randomUUID(),
      runId,
      taskKey: "task-verification",
      title: "종합 테스트 및 회귀 검증",
      state: "pending",
      dependencies: ["task-integration"],
      fileScope: ["tests/**"],
      capabilityRequirements: ["review", "tools"],
      attempt: 0
    });

    if (mode === "deep") {
      // 4. Extra Deep Review / Security Scan
      tasks.push({
        id: crypto.randomUUID(),
        runId,
        taskKey: "task-deep-audit",
        title: "심층 보안 검사 및 성능 프로파일링",
        state: "pending",
        dependencies: ["task-verification"],
        fileScope: ["docs/**", "tests/**"],
        capabilityRequirements: ["review"],
        attempt: 0
      });
    }

    this.validateNoCycles(tasks);
    return tasks;
  }

  public validateNoCycles(tasks: RunTask[]): void {
    const adj = new Map<string, string[]>();
    for (const t of tasks) {
      adj.set(t.taskKey, t.dependencies);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    const checkCycle = (key: string): boolean => {
      visited.add(key);
      recStack.add(key);

      const deps = adj.get(key) || [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (checkCycle(dep)) return true;
        } else if (recStack.has(dep)) {
          return true; // Cycle detected
        }
      }

      recStack.delete(key);
      return false;
    };

    for (const key of adj.keys()) {
      if (!visited.has(key)) {
        if (checkCycle(key)) {
          throw new Error(`Cycle detected in Task DAG involving task '${key}'`);
        }
      }
    }
  }
}

