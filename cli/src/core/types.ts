import { z } from 'zod';

export const PhaseSchema = z.enum(['refine', 'plan', 'route', 'approve', 'execute', 'verify']);
export type Phase = z.infer<typeof PhaseSchema>;

export const ModeSchema = z.enum(['fast', 'standard', 'deep']);
export type Mode = z.infer<typeof ModeSchema>;

export const SkillEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.enum(['builtin', 'project', 'user', 'plugin', 'ecc', 'external']),
  uri: z.string(),
  version: z.string().optional(),
  contentHash: z.string().optional(),
  description: z.string(),
  capabilities: z.array(z.string()),
  phases: z.array(PhaseSchema),
  supportedHosts: z.array(z.enum(['claude', 'codex', 'gemini'])),
  triggers: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  conflictsWith: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
  permissionRisk: z.enum(['low', 'medium', 'high']).default('low'),
  approved: z.boolean().default(true),
  invocation: z.enum(['implicit', 'explicit', 'adapter']).default('explicit'),
  estimatedContextTokens: z.number().optional(),
  enabled: z.boolean().default(true),
});
export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export const UsageSchema = z.object({
  source: z.string(),
  input: z.number().nullable(),
  cacheWrite: z.number().nullable(),
  cacheRead: z.number().nullable(),
  output: z.number().nullable(),
  messages: z.number().nullable(),
  cacheReadRatio: z.number().nullable(),
  files: z.number().nullable().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const CostSchema = z.object({
  estimatedUsd: z.number().nullable(),
  source: z.string(),
  note: z.string().optional(),
});
export type Cost = z.infer<typeof CostSchema>;

export const ReportNodeSchema = z.object({
  id: z.string(),
  stage: z.string(),
  status: z.string(),
  durationMs: z.number().nullable(),
});

export const ReportSchema = z.object({
  v: z.literal(1),
  run: z.string(),
  mode: ModeSchema,
  status: z.enum(['done', 'failed', 'running', 'stalled']),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  elapsedMs: z.number().nullable(),
  nodes: z.array(ReportNodeSchema),
  usage: UsageSchema,
  cost: CostSchema,
  generatedAt: z.string(),
});
export type Report = z.infer<typeof ReportSchema>;

export const SkillOutcomeSchema = z.object({
  host: z.string(),
  model: z.string(),
  taskFingerprint: z.string(),
  taskMode: ModeSchema,
  skillIds: z.array(z.string()),
  runId: z.string(),
  verificationPassed: z.boolean(),
  wallTimeMs: z.number(),
  reportedTokens: z.number().nullable().optional(),
  actualCostUsd: z.number().nullable().optional(),
  estimatedCostUsd: z.number().nullable().optional(),
  retries: z.number().default(0),
  defects: z.number().default(0),
});
export type SkillOutcome = z.infer<typeof SkillOutcomeSchema>;

