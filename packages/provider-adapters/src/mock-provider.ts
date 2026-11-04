import { IProviderAdapter, TaskExecutionContext, TaskExecutionResult, ChatExecutionContext, ChatExecutionResult } from "./types.js";

export class MockProvider implements IProviderAdapter {
  public readonly name = "mock-provider";

  public async execute(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const { task, runId, workspaceId, onEvent } = context;

    // 1. Emit start event
    if (onEvent) {
      await onEvent("task:started", {
        runId,
        taskId: task.id,
        taskKey: task.taskKey,
        title: task.title
      });
    }

    // 2. Emit progress event
    if (onEvent) {
      await onEvent("task:progress", {
        runId,
        taskId: task.id,
        message: `Analyzing dependencies and preparing code generation for '${task.title}'`
      });
    }

    // 3. Mock file diff
    const filesChanged = [
      {
        path: `src/features/${task.taskKey}.ts`,
        diff: `@@ -0,0 +1,15 @@\n+// Implementation for ${task.title}\n+export function runFeature(): boolean {\n+  return true;\n+}\n`
      }
    ];

    if (onEvent) {
      await onEvent("task:diff_generated", {
        runId,
        taskId: task.id,
        files: filesChanged.map((f) => f.path)
      });
    }

    // 4. Mock test run
    const testResults = {
      passed: true,
      total: 3,
      passedCount: 3,
      output: `✓ tests/${task.taskKey}.test.ts (3 tests) 15ms\nAll 3 tests passed.`
    };

    if (onEvent) {
      await onEvent("task:test_completed", {
        runId,
        taskId: task.id,
        results: testResults
      });
    }

    // 5. Usage record
    const usage = {
      workspaceId,
      runId,
      taskId: task.id,
      provider: "mock",
      model: "mock-v1",
      connectionMode: "USER_API_KEY" as const,
      inputTokens: 850,
      outputTokens: 320,
      cachedInputTokens: 500,
      cacheWriteTokens: 0,
      durationMs: 380,
      measuredCostUsd: 0.0035,
      costConfidence: "measured" as const,
      source: "mock-fixture"
    };

    if (onEvent) {
      await onEvent("task:completed", {
        runId,
        taskId: task.id,
        usage
      });
    }

    return {
      success: true,
      output: `Task '${task.title}' successfully completed by MockProvider`,
      filesChanged,
      testResults,
      usage
    };
  }

  public async executeChat(context: ChatExecutionContext): Promise<ChatExecutionResult> {
    const { prompt, workspaceId, runId } = context;
    const output = `안녕하세요! AI 비서 Gon입니다. 무엇을 도와드릴까요?`;
    return {
      output,
      usage: {
        workspaceId,
        runId,
        taskId: "chat",
        provider: "mock",
        model: "mock-v1",
        connectionMode: "USER_API_KEY",
        inputTokens: Math.ceil(prompt.length * 1.2),
        outputTokens: 40,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 120,
        measuredCostUsd: 0,
        costConfidence: "measured",
        source: "mock-fixture"
      }
    };
  }
}
