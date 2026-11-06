import { CliRunner, defaultCliRunner } from "./cli-runner.js";
import {
  ChatExecutionContext,
  ChatExecutionResult,
  IProviderAdapter,
  ProviderCallError,
  TaskExecutionContext,
  TaskExecutionResult
} from "./types.js";

function agyArgs(prompt: string, model?: string): string[] {
  return [
    // agy is a Go `flag` CLI: `-p` is a boolean, flags must come before the positional prompt,
    // and "--" keeps a prompt that looks like a flag from being parsed as one.
    // Effort is part of the model id (`...-low/-medium/-high`), so no effort flag.
    "-p",
    ...(model ? ["--model", model] : []),
    "--", prompt
  ];
}

function unmeasuredUsage(workspaceId: string, runId: string, taskId: string, model: string | undefined, durationMs: number) {
  return {
    workspaceId,
    runId,
    taskId,
    provider: "antigravity",
    model: model ?? null,
    connectionMode: "LOCAL_NATIVE_CLI" as const,
    // agy -p does not report tokens, and the schema needs integers: 0 plus "unavailable" says "not measured".
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    durationMs,
    measuredCostUsd: null,
    costConfidence: "unavailable" as const,
    source: "agy-cli (tokens not measured)"
  };
}

export class AgyProvider implements IProviderAdapter {
  public readonly name = "agy-provider";

  constructor(private readonly run: CliRunner = defaultCliRunner) {}

  private async call(
    prompt: string,
    timeoutMs: number,
    model?: string,
    cwd?: string,
    onDelta?: (delta: string, fullText: string) => void
  ): Promise<string> {
    let stdout: string;
    try {
      const opts = onDelta ? { cwd, timeoutMs, onDelta } : { cwd, timeoutMs };
      ({ stdout } = await this.run("agy", agyArgs(prompt, model), opts));
    } catch (err: any) {
      throw new ProviderCallError("Antigravity", err?.message ?? String(err));
    }
    const text = stdout.trim();
    if (!text) throw new ProviderCallError("Antigravity", "빈 응답이 돌아왔어요.");
    return text;
  }

  /**
   * Executes a direct conversational chat turn via the agy CLI
   */
  public async executeChat(context: ChatExecutionContext): Promise<ChatExecutionResult> {
    const { prompt, model, cwd, workspaceId, runId, context: runCtx, onEvent } = context;

    let fullPrompt = prompt;
    const attachments = runCtx?.attachments as Array<{ name: string; text?: string }> | undefined;
    const textAttachments = attachments?.filter((a) => a.text) ?? [];
    if (textAttachments.length > 0) {
      fullPrompt += "\n\n[첨부된 파일 내용]:\n" + textAttachments.map((a) => `--- ${a.name} ---\n${a.text}`).join("\n");
    }

    const startTime = Date.now();
    const onDelta = onEvent
      ? (delta: string, text: string) => {
          void onEvent("chat:delta", { delta, text, provider: "antigravity" });
        }
      : undefined;
    const output = await this.call(fullPrompt, 35000, model, cwd, onDelta);
    return { output, usage: unmeasuredUsage(workspaceId, runId, "chat", model, Date.now() - startTime) };
  }

  /**
   * Executes a task in the DAG plan via the agy CLI
   */
  public async execute(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const { task, runId, workspaceId, model, cwd, onEvent } = context;

    if (onEvent) {
      await onEvent("task:started", { runId, taskId: task.id, taskKey: task.taskKey, title: task.title });
      await onEvent("task:progress", { runId, taskId: task.id, message: `Executing task with agy: '${task.title}'` });
    }

    const startTime = Date.now();
    const taskPrompt = `작업 제목: ${task.title}\n핵심 요구역량: ${task.capabilityRequirements.join(", ")}\n이 작업의 코드 변경 요약을 2줄 이내로 간결히 제시해줘.`;
    const output = await this.call(taskPrompt, 25000, model, cwd);

    const filesChanged: Array<{ path: string; diff: string }> = [];
    const usage = unmeasuredUsage(workspaceId, runId, task.id, model, Date.now() - startTime);

    if (onEvent) {
      await onEvent("task:completed", { runId, taskId: task.id, usage });
    }

    return { success: true, output, filesChanged, usage };
  }
}
