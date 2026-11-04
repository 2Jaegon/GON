import { z } from "zod";

export const SourceTypeSchema = z.enum(["local", "github", "new"]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const ExecutionRuntimeSchema = z.enum(["local", "cloud"]);
export type ExecutionRuntime = z.infer<typeof ExecutionRuntimeSchema>;

export const ExecutionPolicySchema = z.object({
  allowNetwork: z.boolean().default(false),
  allowGitPush: z.boolean().default(false),
  allowDeployment: z.boolean().default(false),
  requireApprovalForDestructiveActions: z.boolean().default(true)
});
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  sourceType: SourceTypeSchema,
  repositoryRef: z.string().nullable().optional(),
  defaultRuntime: ExecutionRuntimeSchema.default("local"),
  defaultProvider: z.string().default("auto"),
  executionPolicy: ExecutionPolicySchema.default({}),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional()
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectDTOSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  source: z.object({
    type: SourceTypeSchema,
    githubInstallationId: z.string().optional(),
    repositoryFullName: z.string().optional(),
    branch: z.string().optional(),
    localPath: z.string().optional()
  }),
  defaultRuntime: ExecutionRuntimeSchema.default("local"),
  defaultProvider: z.string().default("auto"),
  executionPolicy: ExecutionPolicySchema.optional()
});
export type CreateProjectDTO = z.infer<typeof CreateProjectDTOSchema>;

