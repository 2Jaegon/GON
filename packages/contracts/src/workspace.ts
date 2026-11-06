import { z } from "zod";

export const RoleSchema = z.enum(["owner", "admin", "developer", "viewer"]);
export type Role = z.infer<typeof RoleSchema>;

export const WorkspacePlanSchema = z.enum(["free", "pro", "team"]);
export type WorkspacePlan = z.infer<typeof WorkspacePlanSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable().optional(),
  googleSub: z.string().optional(),
  createdAt: z.string().datetime(),
  disabledAt: z.string().datetime().nullable().optional()
});
export type User = z.infer<typeof UserSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  ownerId: z.string().uuid(),
  plan: WorkspacePlanSchema.default("free"),
  retentionDays: z.number().int().min(1).max(3650).default(30),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional()
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceMemberStatusSchema = z.enum(["invited", "active", "suspended"]);
export type WorkspaceMemberStatus = z.infer<typeof WorkspaceMemberStatusSchema>;

export const WorkspaceMemberSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  role: RoleSchema,
  status: WorkspaceMemberStatusSchema.default("active")
});
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

