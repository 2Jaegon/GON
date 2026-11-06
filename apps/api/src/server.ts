import Fastify, { FastifyInstance } from "fastify";
import type { CliRunner } from "@aso/provider-adapters";
import { IDatabase, createDatabase } from "@aso/database";
import { EventBus } from "./services/event-bus.js";
import { OrchestratorService } from "./services/orchestrator-service.js";
import { RunnerGateway } from "./services/runner-gateway.js";
import { healthRoutes } from "./routes/health.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { projectRoutes } from "./routes/projects.js";
import { runRoutes } from "./routes/runs.js";
import { providerRoutes } from "./routes/providers.js";
import { runnerRoutes } from "./routes/runner.js";

export const DEV_USER_ID = "00000000-0000-7000-8000-000000000001";
export const DEV_WORKSPACE_ID = "00000000-0000-7000-8000-000000000002";
export const DEV_PROJECT_ID = "00000000-0000-7000-8000-000000000003";

export interface ApiServerOptions {
  db?: IDatabase;
  logger?: boolean;
  cliRunner?: CliRunner;
}

export async function createApiServer(options: ApiServerOptions = {}): Promise<{
  server: FastifyInstance;
  db: IDatabase;
  runnerGateway: RunnerGateway;
}> {
  const server = Fastify({
    logger: options.logger ?? false
  });

  const db = options.db || createDatabase();
  const eventBus = new EventBus();
  const orchestrator = new OrchestratorService(db, eventBus, options.cliRunner);
  const runnerGateway = new RunnerGateway(db);

  // Seed default workspace and sample project for dev ease
  const existingUser = await db.users.findById(DEV_USER_ID);
  if (!existingUser) {
    const user = await db.users.create({
      id: DEV_USER_ID,
      email: "developer@aso.local",
      displayName: "Default Developer"
    } as any);
    const ws = await db.workspaces.create({
      id: DEV_WORKSPACE_ID,
      name: "Default Workspace",
      ownerId: user.id,
      plan: "free",
      retentionDays: 30
    } as any);
    await db.projects.create(ws.id, user.id, {
      id: DEV_PROJECT_ID,
      name: "Sample Project",
      description: "Default local development project",
      source: { type: "local", localPath: process.cwd() },
      defaultRuntime: "local",
      defaultProvider: "auto"
    });
  }

  // CORS headers
  server.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization,Idempotency-Key,Last-Event-ID");
    if (req.method === "OPTIONS") {
      reply.status(204).send();
    }
  });

  // Auth /me endpoint
  server.get("/api/v1/me", async () => {
    return {
      id: "00000000-0000-0000-0000-000000000001",
      email: "developer@aso.local",
      displayName: "Default Developer",
      role: "owner"
    };
  });

  // Register routes
  await server.register(healthRoutes);
  await server.register(workspaceRoutes, { db });
  await server.register(projectRoutes, { db });
  await server.register(runRoutes, { db, orchestrator, eventBus });
  await server.register(providerRoutes, { db, cliRunner: options.cliRunner });
  await server.register(runnerRoutes, { db, runnerGateway });

  // Attach WebSocket to server once ready
  server.addHook("onReady", async () => {
    runnerGateway.attach(server.server);
  });

  return { server, db, runnerGateway };
}
