import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect } from "vitest";
import { createWebServer } from "../../apps/web/src/server.js";

// inject()는 `..`를 정규화해 버리므로, 실제 소켓으로 원본 경로를 그대로 보낸다.
async function rawGet(path: string) {
  const server = await createWebServer();
  await server.listen({ port: 0, host: "127.0.0.1" });
  const { port } = server.server.address() as AddressInfo;
  try {
    return await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    await server.close();
  }
}

describe("ASO Web static server", () => {
  it("rejects paths that escape public/", async () => {
    const res = await rawGet("/../src/server.ts");
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("import fs");
  });

  it("rejects percent-encoded paths that escape public/", async () => {
    const res = await rawGet("/%2e%2e/src/server.ts");
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("import fs");
  });

  it("still serves index.html at /", async () => {
    const s = await createWebServer();
    const res = await s.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });
});
