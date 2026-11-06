import { z } from "zod";

export const ProviderNameSchema = z.enum(["openai", "anthropic", "google"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const ConnectionModeSchema = z.enum([
  "LOCAL_NATIVE_CLI",
  "USER_API_KEY",
  "ORG_API_KEY",
  "PARTNER_OAUTH_APPROVED"
]);
export type ConnectionMode = z.infer<typeof ConnectionModeSchema>;

export const ConnectionStatusSchema = z.enum([
  "not_configured",
  "connecting",
  "connected",
  "needs_action",
  "expired",
  "revoked",
  "disabled_by_policy"
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const ProviderCapabilitySchema = z.enum([
  "plan",
  "code",
  "review",
  "tools",
  "structured_output"
]);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const BillingOwnerSchema = z.enum(["user", "organization", "partner_plan"]);
export type BillingOwner = z.infer<typeof BillingOwnerSchema>;

export const LegalGateSchema = z.enum(["approved", "pending", "blocked"]);
export type LegalGate = z.infer<typeof LegalGateSchema>;

export const ProviderConnectionViewSchema = z.object({
  id: z.string().uuid(),
  provider: ProviderNameSchema,
  mode: ConnectionModeSchema,
  status: ConnectionStatusSchema,
  displayName: z.string(),
  capabilities: z.array(ProviderCapabilitySchema),
  billingOwner: BillingOwnerSchema,
  estimatedCostVisible: z.boolean(),
  legalGate: LegalGateSchema,
  lastHealthCheckAt: z.string().datetime().nullable().optional(),
  details: z.string().optional(),
  metadata: z.record(z.any()).optional()
});
export type ProviderConnectionView = z.infer<typeof ProviderConnectionViewSchema>;

export const RegisterApiKeyDTOSchema = z.object({
  provider: ProviderNameSchema,
  apiKey: z.string().min(10).max(512),
  displayName: z.string().optional()
});
export type RegisterApiKeyDTO = z.infer<typeof RegisterApiKeyDTOSchema>;

/** Every level the claude / agy / codex CLIs accept; each connection or model offers a subset. */
export const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]);
export type Effort = z.infer<typeof EffortSchema>;

// `efforts` is set when a model has its own levels (codex); otherwise the connection's levels apply.
export const ModelOptionSchema = z.object({ id: z.string(), label: z.string(), efforts: z.array(EffortSchema).optional() });
export type ModelOption = z.infer<typeof ModelOptionSchema>;

export const ConnectionModelsSchema = z.object({
  plan: z.string().nullable(),
  planVerified: z.boolean(),
  efforts: z.array(EffortSchema),
  models: z.array(ModelOptionSchema),
  source: z.string(),
  refreshedAt: z.string().datetime()
});
export type ConnectionModels = z.infer<typeof ConnectionModelsSchema>;
