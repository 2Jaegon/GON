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
import { skillsRoutes } from "./routes/skills.js";
import { authRoutes, AuthConfig } from "./auth/routes.js";
import { GoogleIdentity } from "./auth/google.js";
import { parseCookies, hashSessionToken, SESSION_COOKIE_NAME } from "./auth/session.js";

export const DEV_USER_ID = "00000000-0000-7000-8000-000000000001";
export const DEV_WORKSPACE_ID = "00000000-0000-7000-8000-000000000002";
export const DEV_PROJECT_ID = "00000000-0000-7000-8000-000000000003";

export interface ApiServerOptions {
  db?: IDatabase;
  logger?: boolean;
  cliRunner?: CliRunner;
  skillCatalogPath?: string;
  auth?: {
    googleClientId?: string;
    allowedEmails?: string[];
    verifyIdToken?: (credential: string) => Promise<GoogleIdentity>;
  };
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

  const googleClientId = options.auth?.googleClientId || process.env.GOOGLE_CLIENT_ID || "";
  const rawAllowed = options.auth?.allowedEmails !== undefined
    ? options.auth.allowedEmails
    : (process.env.ALLOWED_EMAILS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

  const authConfig: AuthConfig = {
    googleClientId,
    allowedEmails: rawAllowed,
    verifyIdToken: options.auth?.verifyIdToken
  };

  const webOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";

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

  // CORS and Session Authentication Gate
  server.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", webOrigin);
    reply.header("Access-Control-Allow-Credentials", "true");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization,Idempotency-Key,Last-Event-ID,Cookie");

    if (req.method === "OPTIONS") {
      return reply.status(204).send();
    }

    const url = req.url.split("?")[0];
    if (url.startsWith("/api/v1/")) {
      // Excluded routes from session check
      if (
        url.startsWith("/api/v1/auth/") ||
        url === "/api/v1/runner/pairings/redeem" ||
        url === "/api/v1/runner/ws"
      ) {
        return;
      }

      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE_NAME];
      if (!token) {
        return reply.status(401).send({
          error: { code: "UNAUTHENTICATED", message: "로그인이 필요해요" }
        });
      }

      const tokenHash = hashSessionToken(token);
      const session = await db.sessions.findByTokenHash(tokenHash);
      if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
        return reply.status(401).send({
          error: { code: "UNAUTHENTICATED", message: "세션이 만료되었거나 올바르지 않아요" }
        });
      }

      const user = await db.users.findById(session.userId);
      if (!user) {
        return reply.status(401).send({
          error: { code: "UNAUTHENTICATED", message: "사용자를 찾을 수 없어요" }
        });
      }

      (req as any).user = user;
    }
  });

  // Auth /me endpoint
  server.get("/api/v1/me", async (req, reply) => {
    const user = (req as any).user;
    if (!user) {
      return reply.status(401).send({
        error: { code: "UNAUTHENTICATED", message: "로그인이 필요해요" }
      });
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName || user.email.split("@")[0],
      role: "owner"
    };
  });

  // Register routes
  await server.register(authRoutes, { db, authConfig });
  await server.register(healthRoutes);
  await server.register(workspaceRoutes, { db });
  await server.register(projectRoutes, { db });
  await server.register(runRoutes, { db, orchestrator, eventBus });
  await server.register(providerRoutes, { db, cliRunner: options.cliRunner });
  await server.register(runnerRoutes, { db, runnerGateway });
  await server.register(skillsRoutes, { catalogPath: options.skillCatalogPath });

  // Attach WebSocket to server once ready
  server.addHook("onReady", async () => {
    runnerGateway.attach(server.server);
  });

  return { server, db, runnerGateway };
}
