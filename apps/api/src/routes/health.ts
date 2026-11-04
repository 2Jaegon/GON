import { FastifyInstance } from "fastify";

export async function healthRoutes(server: FastifyInstance) {
  server.get("/health", async () => {
    return {
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString()
    };
  });
}

