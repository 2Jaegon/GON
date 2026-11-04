import crypto from "node:crypto";

export type CommandRiskLevel = "safe" | "moderate" | "destructive" | "forbidden";

const FORBIDDEN_COMMAND_PATTERNS = [
  /rm\s+-rf\s+[\/\\]/i,
  /format\s+[a-z]:/i,
  /drop\s+database/i,
  /mkfs/i,
  /:(){ :\|:& };:/,
  /shutdown/i,
  /del\s+\/[sfq]\s+c:\\/i
];

const SAFE_COMMAND_PREFIXES = [
  "npm test",
  "npm run",
  "pnpm test",
  "vitest",
  "node --test",
  "git status",
  "git diff",
  "git log",
  "tsc",
  "eslint"
];

export function assessCommandRisk(command: string): { risk: CommandRiskLevel; requiresApproval: boolean; reason?: string } {
  const trimmed = command.trim();

  for (const pattern of FORBIDDEN_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        risk: "forbidden",
        requiresApproval: true,
        reason: "Matched catastrophic destruction pattern"
      };
    }
  }

  for (const prefix of SAFE_COMMAND_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return {
        risk: "safe",
        requiresApproval: false
      };
    }
  }

  if (/rm\s+|del\s+|git\s+push|git\s+reset|chmod|chown/i.test(trimmed)) {
    return {
      risk: "destructive",
      requiresApproval: true,
      reason: "Potentially destructive file or repository command"
    };
  }

  return {
    risk: "moderate",
    requiresApproval: true,
    reason: "General command requiring user confirmation"
  };
}

export function computeCommandDigest(command: string, args: string[] = []): string {
  const full = [command, ...args].join(" ");
  return crypto.createHash("sha256").update(full).digest("hex");
}

