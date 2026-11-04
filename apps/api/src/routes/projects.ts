import { FastifyInstance } from "fastify";
import { IDatabase } from "@aso/database";
import { CreateProjectDTOSchema } from "@aso/contracts";

export async function projectRoutes(server: FastifyInstance, options: { db: IDatabase }) {
  const { db } = options;

  server.get("/api/v1/workspaces/:workspaceId/projects", async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const projects = await db.projects.listForWorkspace(workspaceId);
    return { items: projects };
  });

  server.post("/api/v1/workspaces/:workspaceId/projects", async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const dto = CreateProjectDTOSchema.parse(req.body);
    const project = await db.projects.create(workspaceId, "00000000-0000-0000-0000-000000000001", dto);
    return reply.status(201).send(project);
  });

  server.get("/api/v1/workspaces/:workspaceId/projects/:projectId", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await db.projects.findById(projectId);
    if (!project) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Project not found" } });
    }
    return project;
  });
}

