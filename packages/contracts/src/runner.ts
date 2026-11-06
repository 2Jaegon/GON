import { z } from "zod";

export const RunnerStatusSchema = z.enum(["online", "offline", "revoked"]);
export type RunnerStatus = z.infer<typeof RunnerStatusSchema>;

export const RunnerDeviceSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  publicKey: z.string(),
  authSecret: z.string().optional(),
  status: RunnerStatusSchema.default("offline"),
  allowedPaths: z.array(z.string()).default([]),
  activePath: z.string().nullable().optional(),
  lastSeenAt: z.string().datetime().nullable().optional(),
  revokedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime()
});
export type RunnerDevice = z.infer<typeof RunnerDeviceSchema>;

export function toRunnerView(device: RunnerDevice): Omit<RunnerDevice, "authSecret"> {
  const { authSecret: _authSecret, ...view } = device;
  return view;
}

export const RunnerPairingCodeSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  pairingCode: z.string(),
  expiresAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable().optional(),
  attemptCount: z.number().int().default(0),
  instructions: z.string().optional()
});
export type RunnerPairingCode = z.infer<typeof RunnerPairingCodeSchema>;

export const RedeemPairingDTOSchema = z.object({
  pairingCode: z.string().min(4).max(64),
  deviceName: z.string().min(1).max(100),
  publicKey: z.string().min(16)
});
export type RedeemPairingDTO = z.infer<typeof RedeemPairingDTOSchema>;

export const GrantPathDTOSchema = z.object({
  path: z.string().min(1),
  setAsActive: z.boolean().default(true)
});
export type GrantPathDTO = z.infer<typeof GrantPathDTOSchema>;

export const SignedJobContractSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  targetDir: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  timeoutMs: z.number().int().positive().default(60000),
  signature: z.string(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});
export type SignedJobContract = z.infer<typeof SignedJobContractSchema>;

export const RunnerTaskResultSchema = z.object({
  jobId: z.string().uuid(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
  filesChanged: z.array(z.string()).default([]),
  error: z.string().nullable().optional()
});
export type RunnerTaskResult = z.infer<typeof RunnerTaskResultSchema>;

