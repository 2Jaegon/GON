import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAuthedServer } from "./helpers/auth.js";
import { createDatabase, IDatabase } from "@aso/database";

const WS = "00000000-0000-7000-8000-000000000002";
const PROJECT = "00000000-0000-7000-8000-000000000003";

describe("Image Serving API (GET /api/v1/workspaces/:workspaceId/runs/:runId/images/:name)", () => {
  let tmpDir: string;
  let gonImagesDir: string;
  let db: IDatabase;
  let server: any;
  let testRun: any;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aso-img-routes-"));
    gonImagesDir = path.join(tmpDir, ".gon-images");
    fs.mkdirSync(gonImagesDir, { recursive: true });

    db = createDatabase();
    server = await createAuthedServer({ db });

    testRun = await db.runs.create({
      workspaceId: WS,
      projectId: PROJECT,
      createdBy: "00000000-0000-0000-0000-000000000001",
      rawRequest: "generate an image",
      status: "completed",
      executionMode: "agent",
      runtime: "local",
      providerPreference: "auto",
      budget: {
        maxWallTimeSeconds: 60,
        maxEstimatedCostUsd: 1,
        maxParallelTasks: 1,
        hardStopOnBudget: true
      },
      runContext: {
        sessionId: "session-1",
        attachments: [],
        cwd: tmpDir
      }
    });
  });

  afterEach(async () => {
    if (server?.server) await server.server.close();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("serves PNG, JPG, and WEBP images from .gon-images with proper Content-Type headers", async () => {
    const pngPath = path.join(gonImagesDir, "test-pic.png");
    const jpgPath = path.join(gonImagesDir, "test-pic.jpg");
    const webpPath = path.join(gonImagesDir, "test-pic.webp");

    fs.writeFileSync(pngPath, Buffer.from("fake-png-data"));
    fs.writeFileSync(jpgPath, Buffer.from("fake-jpg-data"));
    fs.writeFileSync(webpPath, Buffer.from("fake-webp-data"));

    // GET png
    const res1 = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${WS}/runs/${testRun.id}/images/test-pic.png`
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.headers["content-type"]).toBe("image/png");
    expect(res1.rawPayload.toString()).toBe("fake-png-data");

    // GET jpg
    const res2 = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${WS}/runs/${testRun.id}/images/test-pic.jpg`
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers["content-type"]).toBe("image/jpeg");
    expect(res2.rawPayload.toString()).toBe("fake-jpg-data");

    // GET webp
    const res3 = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${WS}/runs/${testRun.id}/images/test-pic.webp`
    });
    expect(res3.statusCode).toBe(200);
    expect(res3.headers["content-type"]).toBe("image/webp");
    expect(res3.rawPayload.toString()).toBe("fake-webp-data");
  });

  it("rejects path traversal attempts with 400 or 404", async () => {
    const secretPath = path.join(tmpDir, "secret.png");
    fs.writeFileSync(secretPath, "secret");

    const res1 = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${WS}/runs/${testRun.id}/images/..%2fsecret.png`
    });
    expect([400, 404]).toContain(res1.statusCode);

    const res2 = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${WS}/runs/${testRun.id}/images/..%5csecret.png`
    });
    expect([400, 404]).toContain(res2.statusCode);
  });

  it("rejects unsupported extensions with 400", async () => {
    const txtPath = path.join(gonImagesDir, "test.txt");
    fs.writeFileSync(txtPath, "text file");

    const res = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${WS}/runs/${testRun.id}/images/test.txt`
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for non-existent image or non-existent run", async () => {
    // Non-existent image
    const res1 = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${WS}/runs/${testRun.id}/images/missing.png`
    });
    expect(res1.statusCode).toBe(404);

    // Non-existent run
    const res2 = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${WS}/runs/00000000-0000-0000-0000-000000000099/images/test.png`
    });
    expect(res2.statusCode).toBe(404);
  });
});
