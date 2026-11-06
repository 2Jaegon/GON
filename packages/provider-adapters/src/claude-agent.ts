import { Effort } from "./types.js";

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
