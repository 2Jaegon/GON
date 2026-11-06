import { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import path from "node:path";

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  source: string;
}

export interface SkillsRouteOptions {
  catalogPath?: string;
}

export const skillsRoutes: FastifyPluginAsync<SkillsRouteOptions> = async (server, opts) => {
  const catalogPath = opts.catalogPath || path.resolve(process.cwd(), "config/skill-catalog.json");

  server.get("/api/v1/skills", async (_request, reply) => {
    try {
      if (!fs.existsSync(catalogPath)) {
        server.log.warn(`Skill catalog file not found at ${catalogPath}`);
        return reply.send({ items: [] });
      }

      const content = fs.readFileSync(catalogPath, "utf-8");
      const parsed = JSON.parse(content);
      const rawSkills = parsed.skills || {};

      const items: SkillItem[] = Object.entries(rawSkills).map(([id, entry]: [string, any]) => {
        const parts = id.split(":");
        const source = entry?.source || (parts.length > 1 ? parts[0] : "builtin");
        const name = entry?.name || (parts.length > 1 ? parts.slice(1).join(":") : id);
        let description = entry?.description || "";
        if (!description && Array.isArray(entry?.capabilities)) {
          description = entry.capabilities.join(", ");
        }

        return {
          id,
          name,
          description,
          source,
        };
      });

      return reply.send({ items });
    } catch (err: any) {
      server.log.warn(`Failed to read or parse skill catalog: ${err.message}`);
      return reply.send({ items: [] });
    }
  });
};

