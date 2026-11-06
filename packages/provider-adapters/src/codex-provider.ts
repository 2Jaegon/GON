import { CliRunner, defaultCliRunner } from "./cli-runner.js";
import {
  ChatExecutionContext,
  ChatExecutionResult,
  Effort,
  IProviderAdapter,
  ProviderCallError,
  TaskExecutionContext,
  TaskExecutionResult
} from "./types.js";

type Sandbox = "read-only" | "workspace-write";

function codexArgs(prompt: string, sandbox: Sandbox, model?: string, effort?: Effort): string[] {
  return [
    "exec", "--skip-git-repo-check", "-s", sandbox,
    ...(model ? ["-m", model] : []),
    // Unquoted on purpose: codex reads a value that is not valid TOML as a literal string, and no shell quoting is needed.
    ...(effort ? ["-c", `model_reasoning_effort=${effort}`] : []),
    // "--" keeps a prompt that looks like a flag from being parsed as one.
    "--", prompt
  ];
}

function unmeasuredUsage(workspaceId: string, runId: string, taskId: string, model: string | undefined, durationMs: number) {
  return {
    workspaceId,
    runId,
    taskId,
    provider: "openai",
    model: model ?? null,
    connectionMode: "LOCAL_NATIVE_CLI" as const,
    // codex exec does not report tokens, and the schema needs integers: 0 plus "unavailable" says "not measured".
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    durationMs,
    measuredCostUsd: null,
    costConfidence: "unavailable" as const,
    source: "codex-cli (tokens not measured)"
  };
}

export class CodexProvider implements IProviderAdapter {
  public readonly name = "codex-provider";

  constructor(private readonly run: CliRunner = defaultCliRunner) {}

  private async call(prompt: string, sandbox: Sandbox, timeoutMs: number, model?: string, cwd?: string, effort?: Effort): Promise<string> {
    let stdout: string;
    try {
      ({ stdout } = await this.run("codex", codexArgs(prompt, sandbox, model, effort), { cwd, timeoutMs }));
    } catch (err: any) {
      throw new ProviderCallError("Codex", err?.message ?? String(err));
    }
    const text = stdout.trim();
    if (!text) throw new ProviderCallError("Codex", "빈 응답이 돌아왔어요.");
    return text;
  }

  public async executeChat(context: ChatExecutionContext): Promise<ChatExecutionResult> {
    const { prompt, workspaceId, runId, model, effort, cwd, context: runCtx } = context;

    let fullPrompt = prompt;
    const attachments = runCtx?.attachments as Array<{ name: string; text?: string }> | undefined;
    const textAttachments = attachments?.filter((a) => a.text) ?? [];
    if (textAttachments.length > 0) {
      fullPrompt += "\n\n[첨부 파일]:\n" + textAttachments.map((a) => `--- ${a.name} ---\n${a.text}`).join("\n");
    }

    const startTime = Date.now();
    const output = await this.call(fullPrompt, "read-only", 120000, model, cwd, effort);
    return { output, usage: unmeasuredUsage(workspaceId, runId, "chat", model, Date.now() - startTime) };
  }

  public async execute(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const { task, runId, workspaceId, model, effort, cwd, onEvent } = context;

    if (onEvent) {
      await onEvent("task:started", { runId, taskId: task.id, taskKey: task.taskKey, title: task.title });
      await onEvent("task:progress", { runId, taskId: task.id, message: `Executing task with Codex: '${task.title}'` });
    }

    const startTime = Date.now();
    const taskPrompt = `작업: ${task.title}\n요구역량: ${task.capabilityRequirements.join(", ")}\n코드 변경 요약을 2줄 이내로 제시해줘.`;
    const output = await this.call(taskPrompt, "workspace-write", 300000, model, cwd, effort);

    const filesChanged: Array<{ path: string; diff: string }> = [];
    const usage = unmeasuredUsage(workspaceId, runId, task.id, model, Date.now() - startTime);

    if (onEvent) {
      await onEvent("task:completed", { runId, taskId: task.id, usage });
    }

    return { success: true, output, filesChanged, usage };
  }
}
