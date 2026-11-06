import { CliRunner, defaultCliRunner } from "./cli-runner.js";
import {
  Effort,
  IProviderAdapter,
  TaskExecutionContext,
  TaskExecutionResult,
  ChatExecutionContext,
  ChatExecutionResult,
  ProviderCallError
} from "./types.js";

function claudeArgs(prompt: string, model?: string, effort?: Effort): string[] {
  return [
    "-p", "--output-format", "json",
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
    // `-p` is a boolean switch: "--" keeps a prompt that looks like a flag from being parsed as one.
    "--", prompt
  ];
}

export class ClaudeProvider implements IProviderAdapter {
  public readonly name = "claude-provider";

  constructor(private readonly run: CliRunner = defaultCliRunner) {}

  /**
   * Executes conversational chat turn via Claude Code CLI (Anthropic subscription)
   */
  public async executeChat(context: ChatExecutionContext): Promise<ChatExecutionResult> {
    const { prompt, workspaceId, runId, model, effort, cwd, context: runCtx } = context;

    let fullPrompt = prompt;
    const attachments = runCtx?.attachments as Array<{ name: string; text?: string }> | undefined;
    if (attachments && attachments.length > 0) {
      const textAttachments = attachments.filter((a) => a.text);
      if (textAttachments.length > 0) {
        fullPrompt += "\n\n[첨부 파일]:\n" + textAttachments.map((a) => `--- ${a.name} ---\n${a.text}`).join("\n");
      }
    }

    const startTime = Date.now();

    try {
      const { stdout } = await this.run("claude", claudeArgs(fullPrompt, model, effort), { cwd, timeoutMs: 45000 });

      const parsed = JSON.parse(stdout.trim());
      const durationMs = Date.now() - startTime;

      // Handle weekly rate limit or API error
      if (parsed.is_error && parsed.api_error === "usage_limit_reached") {
        const quotaMsg = parsed.result || "주간 사용량 한도에 도달했습니다.";
        return {
          output: `⚠️ [Claude 사용량 안내] ${quotaMsg}\n\n현재 Claude Code의 주간 한도에 도달하여, 연결된 Google Antigravity(Gemini) 또는 백업 프로바이더를 통해 계속 작업하실 수 있습니다.`,
          usage: {
            workspaceId,
            runId,
            taskId: "chat",
            provider: "anthropic",
            model: model ?? null,
            connectionMode: "LOCAL_NATIVE_CLI",
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            durationMs,
            measuredCostUsd: 0,
            costConfidence: "measured",
            source: "claude-code-rate-limit"
          }
        };
      }

      const outputText = parsed.result || "답변을 수신했습니다.";
      const measured = parsed.usage?.input_tokens != null || parsed.usage?.output_tokens != null;
      const inputTokens = parsed.usage?.input_tokens ?? 0;
      const outputTokens = parsed.usage?.output_tokens ?? 0;
      const cachedTokens = parsed.usage?.cache_read_input_tokens ?? 0;

      return {
        output: outputText,
        usage: {
          workspaceId,
          runId,
          taskId: "chat",
          provider: "anthropic",
          model: model ?? null,
          connectionMode: "LOCAL_NATIVE_CLI",
          inputTokens,
          outputTokens,
          cachedInputTokens: cachedTokens,
          cacheWriteTokens: 0,
          durationMs,
          measuredCostUsd: measured ? 0 : null,
          costConfidence: measured ? "measured" : "unavailable",
          source: measured ? "claude-code-cli" : "claude-code-cli (tokens not measured)"
        }
      };
    } catch (err: any) {
      // If error output contains json from claude (non-zero exit code due to rate limit)
      if (err.stdout) {
        try {
          const parsed = JSON.parse(err.stdout.trim());
          if (parsed.api_error === "usage_limit_reached" || parsed.api_error_status === 429) {
            return {
              output: `⚠️ [Claude 주간 한도 도달] ${parsed.result}\n(대체 프로바이더인 Google Antigravity/Gemini로 즉시 전환하여 진행할 수 있습니다.)`,
              usage: {
                workspaceId,
                runId,
                taskId: "chat",
                provider: "anthropic",
                model: model ?? null,
                connectionMode: "LOCAL_NATIVE_CLI",
                inputTokens: 0,
                outputTokens: 0,
                cachedInputTokens: 0,
                cacheWriteTokens: 0,
                durationMs: Date.now() - startTime,
                measuredCostUsd: 0,
                costConfidence: "measured",
                source: "claude-rate-limit"
              }
            };
          }
        } catch {
          // not json
        }
      }

      throw new ProviderCallError("Claude", err.message);
    }
  }

  /**
   * Executes structured DAG plan task via Claude Code
   */
  public async execute(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const { task, runId, workspaceId, model, effort, cwd, onEvent } = context;

    if (onEvent) {
      await onEvent("task:started", {
        runId,
        taskId: task.id,
        taskKey: task.taskKey,
        title: task.title
      });
      await onEvent("task:progress", {
        runId,
        taskId: task.id,
        message: `Executing task with Claude Code: '${task.title}'`
      });
    }

    const startTime = Date.now();
    let parsed: any;
    try {
      const taskPrompt = `작업: ${task.title}\n요구역량: ${task.capabilityRequirements.join(", ")}\n코드 변경 요약을 2줄 이내로 제시해줘.`;
      // Tasks run in the project folder with its hooks and rules; 30s killed real sonnet/high runs (2026-11-06).
      const { stdout } = await this.run("claude", claudeArgs(taskPrompt, model, effort), { cwd, timeoutMs: 120000 });
      parsed = JSON.parse(stdout.trim());
    } catch (err: any) {
      // A rate-limited CLI exits non-zero but still prints its reason as JSON on stdout.
      let reason: string | undefined;
      try {
        reason = JSON.parse(String(err?.stdout ?? "").trim()).result;
      } catch {
        // not json
      }
      throw new ProviderCallError("Claude", reason || err?.message || String(err));
    }
    if (parsed.is_error) {
      throw new ProviderCallError("Claude", parsed.result || parsed.api_error || "알 수 없는 오류가 났어요.");
    }
    const outputText = typeof parsed.result === "string" ? parsed.result.trim() : "";
    if (!outputText) throw new ProviderCallError("Claude", "빈 응답이 돌아왔어요.");

    // Tokens come from the CLI when it reports them; otherwise they are "not measured", never invented.
    const measured = parsed.usage?.input_tokens != null || parsed.usage?.output_tokens != null;
    const usage = {
      workspaceId,
      runId,
      taskId: task.id,
      provider: "anthropic",
      model: model ?? null,
      connectionMode: "LOCAL_NATIVE_CLI" as const,
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      cachedInputTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: 0,
      durationMs: Date.now() - startTime,
      measuredCostUsd: measured ? 0 : null, // subscription: no API billing
      costConfidence: measured ? ("measured" as const) : ("unavailable" as const),
      source: measured ? "claude-code-cli" : "claude-code-cli (tokens not measured)"
    };

    if (onEvent) {
      await onEvent("task:completed", { runId, taskId: task.id, usage });
    }

    return { success: true, output: outputText, filesChanged: [], usage };
  }
}
