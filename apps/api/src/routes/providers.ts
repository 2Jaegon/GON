import crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { IDatabase } from "@aso/database";
import { RegisterApiKeyDTOSchema, ProviderConnectionView } from "@aso/contracts";
import { redactSecrets } from "@aso/security";
import { SubscriptionDetector } from "@aso/provider-adapters";

export async function providerRoutes(server: FastifyInstance, options: { db: IDatabase }) {
  const { db } = options;
  const detector = new SubscriptionDetector();

  // Helper to ensure default local subscriptions are synced
  async function syncLocalSubscriptions(workspaceId: string): Promise<ProviderConnectionView[]> {
    const existing = await db.providers.listForWorkspace(workspaceId);
    const hasLocalNative = existing.some((c) => c.mode === "LOCAL_NATIVE_CLI");

    if (!hasLocalNative) {
      const detected = await detector.scanSubscriptions(workspaceId);
      for (const d of detected) {
        if (d.installed) {
          await db.providers.create(d.connectionView);
        }
      }
      return db.providers.listForWorkspace(workspaceId);
    }
    return existing;
  }

  // List connections (with auto-sync of local user subscriptions)
  server.get("/api/v1/workspaces/:workspaceId/connections", async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const connections = await syncLocalSubscriptions(workspaceId);
    return { items: connections };
  });

  // Explicitly detect/refresh local user subscriptions (Claude, Antigravity/Gemini, Codex)
  server.post("/api/v1/workspaces/:workspaceId/connections/detect-subscriptions", async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const detected = await detector.scanSubscriptions(workspaceId);
    for (const d of detected) {
      if (d.installed) {
        const existing = await db.providers.findById(d.connectionView.id);
        if (!existing) {
          await db.providers.create(d.connectionView);
        } else {
          await db.providers.updateStatus(d.connectionView.id, d.connectionView.status);
        }
      }
    }
    const connections = await db.providers.listForWorkspace(workspaceId);
    return {
      items: connections,
      detected: detected.map((d) => ({
        provider: d.provider,
        installed: d.installed,
        version: d.version,
        authenticated: d.authenticated,
        quotaWarning: d.quotaWarning
      }))
    };
  });

  // Register BYOK API Key
  server.post("/api/v1/workspaces/:workspaceId/connections/api-key", async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const dto = RegisterApiKeyDTOSchema.parse(req.body);

    redactSecrets(dto.apiKey);

    const connection: ProviderConnectionView = {
      id: crypto.randomUUID(),
      provider: dto.provider,
      mode: "USER_API_KEY",
      status: "connected",
      displayName: dto.displayName || `${dto.provider.toUpperCase()} (BYOK API Key)`,
      capabilities: ["plan", "code", "review", "tools", "structured_output"],
      billingOwner: "user",
      estimatedCostVisible: true,
      legalGate: "approved",
      lastHealthCheckAt: new Date().toISOString(),
      details: "Configured via user API key"
    };

    await db.providers.create(connection);
    return reply.status(201).send(connection);
  });

  // Health check for a provider connection
  server.post("/api/v1/workspaces/:workspaceId/connections/:connectionId/health-check", async (req, reply) => {
    const { workspaceId, connectionId } = req.params as { workspaceId: string; connectionId: string };
    const conn = await db.providers.findById(connectionId);
    if (!conn) {
      return reply.status(404).send({ error: { message: "Provider connection not found" } });
    }

    if (conn.mode === "LOCAL_NATIVE_CLI") {
      const probe = await detector.probeHealth(conn.provider);
      await db.providers.updateStatus(connectionId, probe.status);
      return {
        id: connectionId,
        status: probe.status,
        lastHealthCheckAt: new Date().toISOString(),
        details: probe.details,
        quotaWarning: probe.quotaWarning
      };
    }

    return {
      id: connectionId,
      status: conn.status,
      lastHealthCheckAt: new Date().toISOString()
    };
  });

  server.get("/api/v1/workspaces/:workspaceId/providers/capabilities", async () => {
    return {
      providers: {
        openai: ["plan", "code", "review", "tools", "structured_output"],
        anthropic: ["plan", "code", "review", "tools", "structured_output"],
        google: ["plan", "code", "review", "tools"]
      }
    };
  });

  server.get("/api/v1/workspaces/:workspaceId/providers/legal-gates", async () => {
    return {
      gates: {
        openai: { byokApi: "approved", localNative: "approved", partnerOAuth: "blocked" },
        anthropic: { byokApi: "approved", localNative: "approved", partnerOAuth: "blocked" },
        google: { byokApi: "approved", localNative: "approved", partnerOAuth: "blocked" }
      }
    };
  });
}
