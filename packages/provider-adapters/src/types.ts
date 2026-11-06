import { RunTask, UsageRecord } from "@aso/contracts";

export type Effort = "low" | "medium" | "high";

export interface TaskExecutionContext {
  runId: string;
  workspaceId: string;
  task: RunTask;
  projectPath?: string;
  model?: string;
  effort?: Effort;
  cwd?: string;
  onEvent?: (eventType: string, payload: Record<string, any>) => Promise<void>;
}

export interface TaskExecutionResult {
  success: boolean;
  output: string;
  filesChanged: Array<{ path: string; diff: string }>;
  testResults?: { passed: boolean; total: number; passedCount: number; output: string };
  usage: Omit<UsageRecord, "id" | "recordedAt">;
}

export interface ChatExecutionContext {
  runId: string;
  workspaceId: string;
  prompt: string;
  model?: string;
  cwd?: string;
  effort?: Effort;
  context?: Record<string, any>;
  onEvent?: (eventType: string, payload: Record<string, any>) => Promise<void>;
}

export interface ChatExecutionResult {
  output: string;
  usage: Omit<UsageRecord, "id" | "recordedAt">;
}

export interface IProviderAdapter {
  readonly name: string;
  execute(context: TaskExecutionContext): Promise<TaskExecutionResult>;
  executeChat?(context: ChatExecutionContext): Promise<ChatExecutionResult>;
}

