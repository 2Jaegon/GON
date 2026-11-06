import { describe, it, expect, afterEach } from "vitest";
import { createAuthedServer } from "./helpers/auth.js";
import type { FastifyInstance } from "fastify";
import path from "node:path";

describe("Skills Catalog API (GET /api/v1/skills)", () => {
  let server: FastifyInstance | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("returns skills list from default catalog including mattpocock-skills:grilling", async () => {
    const authed = await createAuthedServer();
    server = authed.server;

    const res = await authed.inject({
      method: "GET",
      url: "/api/v1/skills",
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);

    const grilling = data.items.find((item: { id: string }) => item.id === "mattpocock-skills:grilling");
    expect(grilling).toBeDefined();
    expect(grilling.name).toBe("grilling");
    expect(grilling.source).toBe("mattpocock-skills");
    expect(typeof grilling.description).toBe("string");
  });

  it("returns empty items array when catalog file is missing or invalid", async () => {
    const authed = await createAuthedServer({
      skillCatalogPath: path.resolve(process.cwd(), "config/non-existent-catalog.json"),
    });
    server = authed.server;

    const res = await authed.inject({
      method: "GET",
      url: "/api/v1/skills",
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data).toEqual({ items: [] });
  });
});

