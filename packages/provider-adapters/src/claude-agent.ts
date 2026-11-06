import { spawn } from "node:child_process";
import { Effort } from "./types.js";
import { cliFailureMessage, resolveCliCommand } from "./cli-runner.js";

export const AGENT_SAFE_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(ls:*)"
];

export const AGENT_DENIED_TOOLS = [
  "Read(.env*)",
  "Read(**/.env*)",
  "Read(**/*.pem)",
  "Read(**/id_rsa*)"
];

export interface AgentDenial {
  toolName: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
}

export interface AgentResult {
  sessionId: string | null;
  text: string;
  isError: boolean;
  denials: AgentDenial[];
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
}

export type AgentEvent =
  | { kind: "init"; sessionId: string }
  | { kind: "text"; delta: string }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown> }
  | { kind: "tool_done"; id: string }
  | ({ kind: "result" } & AgentResult);

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  model?: string;
  effort?: Effort;
  resumeSessionId?: string;
  extraAllowed?: string[];
  idleTimeoutMs?: number;
  maxWallMs?: number;
}

export function buildAgentArgs(o: AgentRunOptions): string[] {
  const allowed = [...AGENT_SAFE_TOOLS, ...(o.extraAllowed ?? [])];
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "default"
  ];

  if (o.resumeSessionId) {
    args.push("--resume", o.resumeSessionId);
  }
  if (o.model) {
    args.push("--model", o.model);
  }
  if (o.effort) {
    args.push("--effort", o.effort);
  }

  args.push("--allowedTools", ...allowed);
  args.push("--disallowedTools", ...AGENT_DENIED_TOOLS);
  args.push("--", o.prompt);

  return args;
}

export function parseAgentLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];

  if (parsed.type === "system" && parsed.subtype === "init") {
    return [{ kind: "init", sessionId: String(parsed.session_id || "") }];
  }

  if (parsed.type === "stream_event") {
    const ev = parsed.event;
    if (ev?.type === "content_block_delta" && ev?.delta?.type === "text_delta") {
      const deltaText = ev.delta.text;
      if (typeof deltaText === "string" && deltaText.length > 0) {
        return [{ kind: "text", delta: deltaText }];
      }
    }
    return [];
  }

  if (parsed.type === "assistant" && Array.isArray(parsed.message?.content)) {
    const events: AgentEvent[] = [];
    for (const item of parsed.message.content) {
      if (item.type === "tool_use" && item.name) {
        events.push({
          kind: "tool",
          id: String(item.id || ""),
          name: String(item.name),
          input: item.input && typeof item.input === "object" ? item.input : {}
        });
      }
    }
    return events;
  }

  if (parsed.type === "user" && Array.isArray(parsed.message?.content)) {
    const events: AgentEvent[] = [];
    for (const item of parsed.message.content) {
      if (item.type === "tool_result" && item.tool_use_id) {
        events.push({
          kind: "tool_done",
          id: String(item.tool_use_id)
        });
      }
    }
    return events;
  }

  if (parsed.type === "result") {
    const rawDenials = Array.isArray(parsed.permission_denials) ? parsed.permission_denials : [];
    const denials: AgentDenial[] = rawDenials.map((d: any) => ({
      toolName: String(d.tool_name || ""),
      toolUseId: String(d.tool_use_id || ""),
      toolInput: d.tool_input && typeof d.tool_input === "object" ? d.tool_input : {}
    }));

    return [
      {
        kind: "result",
        sessionId: parsed.session_id ? String(parsed.session_id) : null,
        text: typeof parsed.result === "string" ? parsed.result : "",
        isError: Boolean(parsed.is_error),
        denials,
        inputTokens: parsed.usage?.input_tokens ?? null,
        outputTokens: parsed.usage?.output_tokens ?? null,
        cachedInputTokens: parsed.usage?.cache_read_input_tokens ?? null,
        costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null,
        durationMs: typeof parsed.duration_ms === "number" ? parsed.duration_ms : 0
      }
    ];
  }

  return [];
}

export function denialToRule(d: AgentDenial): string | null {
  if (d.toolName === "Bash") {
    const cmd = typeof d.toolInput.command === "string" ? d.toolInput.command.trim() : "";
    return cmd ? `Bash(${cmd})` : null;
  }

  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(d.toolName)) {
    let rawPath =
      typeof d.toolInput.file_path === "string"
        ? d.toolInput.file_path.trim()
        : typeof d.toolInput.notebook_path === "string"
        ? d.toolInput.notebook_path.trim()
        : "";

    if (!rawPath) return null;

    let normalized = rawPath.replace(/\\/g, "/");
    const winDriveMatch = normalized.match(/^([a-zA-Z]):\/(.*)$/);
    if (winDriveMatch) {
      const driveLetter = winDriveMatch[1].toLowerCase();
      const rest = winDriveMatch[2];
      return `Edit(//${driveLetter}/${rest})`;
    }

    return `Edit(${normalized})`;
  }

  return null;
}

export function summarizeTool(name: string, input: Record<string, unknown>): string {
  let summary = "";
  if (name === "Bash") {
    summary = `Bash: ${String(input.command || "")}`;
  } else if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(name)) {
    const filePath = String(input.file_path || input.notebook_path || "");
    summary = `${name}: ${filePath}`;
  } else {
    summary = `${name}: ${JSON.stringify(input)}`;
  }

  return summary.length > 160 ? summary.slice(0, 157) + "..." : summary;
}

export function describeDenial(d: AgentDenial): {
  tool: string;
  summary: string;
  danger: boolean;
  rule: string | null;
} {
  const summary = summarizeTool(d.toolName, d.toolInput);
  const rule = denialToRule(d);

  let danger = false;
  if (d.toolName === "Bash") {
    const cmd = String(d.toolInput.command || "");
    danger = /rm\s+-rf|git\s+push|npm\s+i(nstall)?\b|yarn\s+add\b|pnpm\s+add\b|docker\s+rm|drop\s+table/i.test(cmd);
  }

  return {
    tool: d.toolName,
    summary,
    danger,
    rule
  };
}

export function isResumeFailure(message: string): boolean {
  return /No conversation found/i.test(message);
}

export type AgentRunner = (
  opts: AgentRunOptions,
  onEvent: (e: AgentEvent) => void,
  signal: AbortSignal
) => Promise<AgentResult>;

export async function runClaudeAgent(
  opts: AgentRunOptions,
  onEvent: (e: AgentEvent) => void,
  signal: AbortSignal,
  deps?: {
    spawn?: typeof import("node:child_process").spawn;
    resolve?: typeof resolveCliCommand;
  }
): Promise<AgentResult> {
  const resolved = deps?.resolve ? await deps.resolve("claude") : await resolveCliCommand("claude");
  const spawnFn = deps?.spawn ?? spawn;
  const args = [...resolved.prefixArgs, ...buildAgentArgs(opts)];

  return new Promise<AgentResult>((resolve, reject) => {
    let settled = false;
    let finalResult: AgentResult | null = null;
    let activeToolCount = 0;
    let stdoutBuf = "";
    let stderrBuf = "";
    let idleTimer: NodeJS.Timeout | null = null;
    let wallTimer: NodeJS.Timeout | null = null;

    const idleTimeoutMs = opts.idleTimeoutMs ?? 120000;
    const maxWallMs = opts.maxWallMs ?? 1800000;

    const cleanup = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (wallTimer) {
        clearTimeout(wallTimer);
        wallTimer = null;
      }
      signal.removeEventListener("abort", onAbort);
    };

    const doReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const doResolve = (res: AgentResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    };

    const resetIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (activeToolCount > 0) {
        return;
      }
      idleTimer = setTimeout(() => {
        doReject(new Error("응답이 없어 중단했어요(무응답 시간 초과)."));
        child.kill();
      }, idleTimeoutMs);
      idleTimer.unref?.();
    };

    const onAbort = () => {
      doReject(new Error("중단했어요."));
      child.kill();
    };

    if (signal.aborted) {
      doReject(new Error("중단했어요."));
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });

    wallTimer = setTimeout(() => {
      doReject(new Error("최대 실행 시간(30분)을 초과해 중단했어요."));
      child.kill();
    }, maxWallMs);
    wallTimer.unref?.();

    const child = spawnFn(resolved.cmd, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    child.stdin?.end();

    resetIdleTimer();

    const processLine = (line: string) => {
      const events = parseAgentLine(line);
      for (const ev of events) {
        if (ev.kind === "tool") {
          activeToolCount++;
        } else if (ev.kind === "tool_done") {
          activeToolCount = Math.max(0, activeToolCount - 1);
        } else if (ev.kind === "result") {
          finalResult = ev;
        }
        onEvent(ev);
      }
      resetIdleTimer();
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrBuf += chunk;
    });

    child.on("error", (err) => {
      doReject(err);
    });

    child.on("close", (code) => {
      if (stdoutBuf.trim()) {
        processLine(stdoutBuf.trim());
        stdoutBuf = "";
      }

      if (finalResult) {
        doResolve(finalResult);
        return;
      }

      if (code !== 0) {
        const msg = cliFailureMessage({ stderr: stderrBuf, code }, idleTimeoutMs);
        doReject(new Error(msg));
        return;
      }

      doReject(new Error("결과를 받지 못하고 프로세스가 종료됐어요."));
    });
  });
}
