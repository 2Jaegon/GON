import { describe, it, expect } from "vitest";
import { CreateRunDTOSchema } from "@aso/contracts";
import { createDatabase } from "@aso/database";
import { EventBus } from "../../apps/api/src/services/event-bus.js";
import { AgentService } from "../../apps/api/src/services/agent-service.js";
import { AgentRunner, AgentRunOptions } from "@aso/provider-adapters";
import { createAuthedServer } from "./helpers/auth.js";

const WS = "00000000-0000-7000-8000-000000000002";
const PROJECT = "00000000-0000-7000-8000-000000000003";

describe("Grilling Skip Option (skipGrilling DTO, API, and Agent Injection)", () => {
  it("CreateRunDTOSchema validates skipGrilling and options.skipGrilling", () => {
    const dto1 = CreateRunDTOSchema.parse({
      request: "로그인 만들어줘",
      skipGrilling: true
    });
    expect(dto1.skipGrilling).toBe(true);

    const dto2 = CreateRunDTOSchema.parse({
      request: "로그인 만들어줘",
      options: { skipGrilling: true }
    });
    expect(dto2.options?.skipGrilling).toBe(true);
  });

  it("POST /api/v1/workspaces/:ws/projects/:proj/runs persists skipGrilling in runContext", async () => {
    const db = createDatabase(":memory:");
    const server = await createAuthedServer({ db });

    try {
      const res = await server.inject({
        method: "POST",
        url: `/api/v1/workspaces/${WS}/projects/${PROJECT}/runs`,
        payload: {
          request: "로그인 만들어줘",
          skipGrilling: true
        }
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      const run = await db.runs.findById(body.id);
      expect(run).toBeDefined();
      expect(run?.runContext?.skipGrilling).toBe(true);
    } finally {
      if (server?.server) await server.server.close();
    }
  });

  it("AgentService passes prompt with grilling omitted when skipGrilling is true", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    let capturedOpts: AgentRunOptions | null = null;
    const fakeRunner: AgentRunner = async (opts) => {
      capturedOpts = opts;
      return {
        sessionId: "s1",
        text: "로그인 구현을 바로 시작하겠습니다.",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 50
      };
    };

    const service = new AgentService(db, eventBus, fakeRunner);
    const run = await db.runs.create({
      workspaceId: WS,
      projectId: PROJECT,
      createdBy: "00000000-0000-0000-0000-000000000001",
      rawRequest: "로그인 만들어줘",
      status: "queued",
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
        sessionId: "session-skip",
        attachments: [],
        skipGrilling: true,
        cwd: "C:/fake/cwd"
      }
    });

    await service.start(run);

    expect(capturedOpts).not.toBeNull();
    expect(capturedOpts!.appendSystemPrompt).toBeDefined();
    expect(capturedOpts!.appendSystemPrompt).not.toContain("[Grilling]");
  });

  it("AgentService includes grilling in system prompt when skipGrilling is false or omitted", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    let capturedOpts: AgentRunOptions | null = null;
    const fakeRunner: AgentRunner = async (opts) => {
      capturedOpts = opts;
      return {
        sessionId: "s1",
        text: "[Grilling]\n1. 질문",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 50
      };
    };

    const service = new AgentService(db, eventBus, fakeRunner);
    const run = await db.runs.create({
      workspaceId: WS,
      projectId: PROJECT,
      createdBy: "00000000-0000-0000-0000-000000000001",
      rawRequest: "로그인 만들어줘",
      status: "queued",
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
        sessionId: "session-noskip",
        attachments: [],
        cwd: "C:/fake/cwd"
      }
    });

    await service.start(run);

    expect(capturedOpts).not.toBeNull();
    expect(capturedOpts!.appendSystemPrompt).toBeDefined();
    expect(capturedOpts!.appendSystemPrompt).toContain("[Grilling]");
  });
});

