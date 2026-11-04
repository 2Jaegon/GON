import { FastifyInstance } from "fastify";
import { IDatabase } from "@aso/database";
import { z } from "zod";

const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  plan: z.enum(["free", "pro", "team"]).default("free")
});

export async function workspaceRoutes(server: FastifyInstance, options: { db: IDatabase }) {
  const { db } = options;

  server.get("/api/v1/workspaces", async (req) => {
    // Return all workspaces for dev session
    const list = await db.workspaces.listForUser("dev-user");
    return { items: list };
  });

  server.post("/api/v1/workspaces", async (req, reply) => {
    const parsed = CreateWorkspaceSchema.parse(req.body);
    const ws = await db.workspaces.create({
      name: parsed.name,
      ownerId: "00000000-0000-0000-0000-000000000001",
      plan: parsed.plan,
      retentionDays: 30
    });
    return reply.status(201).send(ws);
  });

  server.get("/api/v1/workspaces/:workspaceId", async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const ws = await db.workspaces.findById(workspaceId);
    if (!ws) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Workspace not found" } });
    }
    return ws;
  });
}

