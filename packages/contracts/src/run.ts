import { z } from "zod";
import { ExecutionRuntimeSchema } from "./project.js";
import { ConnectionModeSchema } from "./provider.js";

export const RunStatusSchema = z.enum([
  "queued",
  "refining",
  "planning",
  "awaiting_approval",
  "running",
  "verifying",
  "completed",
  "failed",
  "cancelled",
  "paused"
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ExecutionModeSchema = z.enum(["chat", "fast", "standard", "deep", "auto"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const RunBudgetSchema = z.object({
  maxWallTimeSeconds: z.number().int().positive().default(1800),
  maxEstimatedCostUsd: z.number().positive().default(5),
  maxParallelTasks: z.number().int().positive().default(2),
  hardStopOnBudget: z.boolean().default(true)
});
export type RunBudget = z.infer<typeof RunBudgetSchema>;

export const RunRequirementsSchema = z.object({
  goals: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([])
});
export type RunRequirements = z.infer<typeof RunRequirementsSchema>;

export const TaskStateSchema = z.enum([
  "pending",
  "ready",
  "running",
  "completed",
  "failed",
  "skipped"
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const RunTaskSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  taskKey: z.string(),
  title: z.string(),
  state: TaskStateSchema.default("pending"),
  dependencies: z.array(z.string()).default([]),
  fileScope: z.array(z.string()).default([]),
  capabilityRequirements: z.array(z.string()).default([]),
  assignedProvider: z.string().optional(),
  assignedRunnerId: z.string().uuid().optional(),
  attempt: z.number().int().default(0),
  result: z.any().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  finishedAt: z.string().datetime().nullable().optional()
});
export type RunTask = z.infer<typeof RunTaskSchema>;

export const RunPlanSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  version: z.number().int().positive().default(1),
  tasks: z.array(RunTaskSchema),
  approvalStatus: z.enum(["draft", "approved", "rejected"]).default("draft"),
  createdAt: z.string().datetime()
});
export type RunPlan = z.infer<typeof RunPlanSchema>;

export const RunSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  createdBy: z.string().uuid(),
  rawRequest: z.string().min(1),
  status: RunStatusSchema.default("queued"),
  executionMode: ExecutionModeSchema.default("auto"),
  runtime: ExecutionRuntimeSchema.default("local"),
  providerPreference: z.string().default("auto"),
  budget: RunBudgetSchema.default({}),
  runContext: z.record(z.any()).default({}),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  cancelledAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime()
});
export type Run = z.infer<typeof RunSchema>;

export const RunEventSchema = z.object({
  id: z.union([z.number().int(), z.string()]),
  workspaceId: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  eventType: z.string(),
  payload: z.record(z.any()).default({}),
  recordedAt: z.string().datetime()
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const ApprovalStateSchema = z.enum(["pending", "approved", "rejected", "expired"]);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  requestedBy: z.string(),
  commandDigest: z.string(),
  scope: z.record(z.any()).default({}),
  reason: z.string(),
  state: ApprovalStateSchema.default("pending"),
  decidedBy: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime()
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const CostConfidenceSchema = z.enum(["measured", "estimated", "unavailable"]);
export type CostConfidence = z.infer<typeof CostConfidenceSchema>;

export const UsageRecordSchema = z.object({
  id: z.union([z.number().int(), z.string()]),
  workspaceId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  provider: z.string(),
  model: z.string().nullable().optional(),
  connectionMode: ConnectionModeSchema,
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().nonnegative().default(0),
  measuredCostUsd: z.number().nullable().default(null),
  costConfidence: CostConfidenceSchema.default("unavailable"),
  source: z.string(),
  recordedAt: z.string().datetime()
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

export const ArtifactTypeSchema = z.enum(["diff", "test_report", "plan", "summary", "file"]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactRecordSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  runId: z.string().uuid(),
  artifactType: ArtifactTypeSchema,
  storageKey: z.string(),
  sha256: z.string(),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  deleteAfter: z.string().datetime().nullable().optional()
});
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;

export const CreateRunDTOSchema = z.object({
  request: z.string().min(1),
  sessionId: z.string().optional(),
  workspacePath: z.string().optional(),
  runtime: ExecutionRuntimeSchema.default("local"),
  executionMode: ExecutionModeSchema.default("auto"),
  providerPreference: z.string().default("auto"),
  connectionId: z.string().uuid().optional(),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
  budget: RunBudgetSchema.partial().optional(),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        size: z.number().int().nonnegative(),
        type: z.string().optional(),
        dataUrl: z.string().optional(),
        text: z.string().optional()
      })
    )
    .optional(),
  options: z
    .object({
      requirePlanApproval: z.boolean().default(true),
      allowExternalSkills: z.boolean().default(false),
      createPullRequest: z.boolean().default(false)
    })
    .optional()
});
export type CreateRunDTO = z.infer<typeof CreateRunDTOSchema>;

