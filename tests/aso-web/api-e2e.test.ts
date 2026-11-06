import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAuthedServer } from "./helpers/auth.js";
import { FastifyInstance } from "fastify";

describe("ASO Web API End-to-End Integration", () => {
  let server: FastifyInstance;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    const app = await createAuthedServer({ logger: false });
    server = app.server;
    await server.ready();

    // Fetch seeded workspace
    const wsRes = await server.inject({ method: "GET", url: "/api/v1/workspaces" });
    const wsData = JSON.parse(wsRes.body);
    expect(wsData.items.length).toBeGreaterThan(0);
    workspaceId = wsData.items[0].id;

    // Fetch seeded project
    const projRes = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspaceId}/projects`
    });
    const projData = JSON.parse(projRes.body);
    expect(projData.items.length).toBeGreaterThan(0);
    projectId = projData.items[0].id;
  });

  afterAll(async () => {
    await server.close();
  });

  it("GET /health returns 200 and status ok", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
  });

  it("GET /api/v1/me returns current authenticated developer", async () => {
    const res = await server.inject({ method: "GET", url: "/api/v1/me" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.email).toBe("owner@test.local");
    expect(body.role).toBe("owner");
  });

  it("POST /api/v1/workspaces/:w/connections/api-key returns 501 NOT_IMPLEMENTED", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspaceId}/connections/api-key`,
      payload: {
        provider: "openai",
        apiKey: "sk-openai-test-key-1234567890abcdef"
      }
    });
    expect(res.statusCode).toBe(501);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("NOT_IMPLEMENTED");
    expect(body.error?.message).toContain("API 키 연결은 준비 중이에요");
    expect(JSON.stringify(body)).not.toContain("sk-openai-test-key");
  });

  it("issues and redeems local runner pairing code", async () => {
    // 1. Issue code
    const issueRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspaceId}/runner-pairings`
    });
    expect(issueRes.statusCode).toBe(201);
    const pairing = JSON.parse(issueRes.body);
    expect(pairing.pairingCode).toMatch(/^PAIR-/);

    // 2. Redeem code
    const redeemRes = await server.inject({
      method: "POST",
      url: "/api/v1/runner/pairings/redeem",
      payload: {
        pairingCode: pairing.pairingCode,
        deviceName: "MacBook-Pro-Local",
        publicKey: "ed25519-public-key-example-string-long"
      }
    });
    expect(redeemRes.statusCode).toBe(200);
    const redeemed = JSON.parse(redeemRes.body);
    expect(redeemed.deviceId).toBeDefined();
    expect(redeemed.workspaceId).toBe(workspaceId);

    // 3. Verify in runner list
    const listRes = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspaceId}/runners`
    });
    const list = JSON.parse(listRes.body);
    expect(list.items.some((r: any) => r.id === redeemed.deviceId)).toBe(true);
  });

  it("creates a Run, refines intent, creates plan, and executes with MockProvider", async () => {
    // 1. Create Run with Idempotency-Key
    const createRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspaceId}/projects/${projectId}/runs`,
      headers: { "idempotency-key": "idemp-key-test-001" },
      payload: {
        request: "금융 공시 요약 및 검색 API 엔드포인트 추가",
        executionMode: "standard",
        options: { requirePlanApproval: true }
      }
    });

    expect(createRes.statusCode).toBe(201);
    const runInfo = JSON.parse(createRes.body);
    expect(runInfo.runId).toBeDefined();
    expect(runInfo.status).toBe("queued");

    // Test Idempotency: duplicate request returns identical 201 response
    const dupRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspaceId}/projects/${projectId}/runs`,
      headers: { "idempotency-key": "idemp-key-test-001" },
      payload: {
        request: "금융 공시 요약 및 검색 API 엔드포인트 추가",
        executionMode: "standard"
      }
    });
    expect(dupRes.statusCode).toBe(201);
    expect(JSON.parse(dupRes.body).runId).toBe(runInfo.runId);

    // Wait a brief tick for background orchestration (intent refinement & plan creation)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 2. Check Requirements
    const reqRes = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspaceId}/runs/${runInfo.runId}/requirements`
    });
    expect(reqRes.statusCode).toBe(200);
    const reqs = JSON.parse(reqRes.body);
    expect(reqs.goals.length).toBeGreaterThan(0);

    // 3. Check Plan
    const planRes = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspaceId}/runs/${runInfo.runId}/plan`
    });
    expect(planRes.statusCode).toBe(200);
    const plan = JSON.parse(planRes.body);
    expect(plan.approvalStatus).toBe("draft");
    expect(plan.tasks.length).toBe(3);

    // 4. Approve Plan to trigger execution
    const approveRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspaceId}/runs/${runInfo.runId}/plan/approve`
    });
    expect(approveRes.statusCode).toBe(200);

    // Wait for plan execution to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 5. Verify Run is completed
    const finalRunRes = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspaceId}/runs/${runInfo.runId}`
    });
    const finalRun = JSON.parse(finalRunRes.body);
    expect(finalRun.status).toBe("completed");

    // 6. Check Usage Ledger
    const usageRes = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspaceId}/runs/${runInfo.runId}/usage`
    });
    expect(usageRes.statusCode).toBe(200);
    const usageData = JSON.parse(usageRes.body);
    expect(usageData.aggregate.inputTokens).toBeGreaterThan(0);
    expect(usageData.aggregate.outputTokens).toBeGreaterThan(0);
    expect(usageData.aggregate.totalCostUsd).toBeGreaterThan(0);

    // 7. Check Artifacts
    const artifactRes = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspaceId}/runs/${runInfo.runId}/artifacts`
    });
    expect(artifactRes.statusCode).toBe(200);
    const artifacts = JSON.parse(artifactRes.body);
    expect(artifacts.items.length).toBeGreaterThan(0);
  });
});

