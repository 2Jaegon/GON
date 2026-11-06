import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import {
  buildAgentSystemPrompt,
  buildAgentArgs,
  AgentRunner,
  AgentRunOptions
} from "@aso/provider-adapters";
import { createDatabase } from "@aso/database";
import { AgentService } from "../../apps/api/src/services/agent-service.js";
import { EventBus } from "../../apps/api/src/services/event-bus.js";

describe("Agent System Prompt & Image Generation Instructions", () => {
  it("buildAgentSystemPrompt returns default system prompt when no options provided", () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe("string");
  });

  it("buildAgentSystemPrompt includes gen-image tool instructions, catalog guidelines, and safe markdown syntax", () => {
    const gonRoot = "C:/path/to/gon";
    const prompt = buildAgentSystemPrompt({
      image: {
        gonRoot
      }
    });

    expect(prompt).toContain("gen-image.mjs");
    expect(prompt).toContain(".gon-images");
    expect(prompt).toContain("English");
    expect(prompt).toContain("brand");
  });

  it("buildAgentArgs includes --append-system-prompt when appendSystemPrompt is provided", () => {
    const customPrompt = "You are an expert AI orchestrator.";
    const args = buildAgentArgs({
      prompt: "make a picture",
      cwd: "C:/work",
      appendSystemPrompt: customPrompt
    });

    expect(args).toContain("--append-system-prompt");
    const idx = args.indexOf("--append-system-prompt");
    expect(args[idx + 1]).toBe(customPrompt);
    // ensure it appears before the positional prompt separator '--'
    const dashDashIdx = args.indexOf("--");
    expect(idx).toBeLessThan(dashDashIdx);
  });

  it("buildAgentArgs automatically includes gen-image.mjs in allowedTools when appendSystemPrompt has image instructions", () => {
    const prompt = buildAgentSystemPrompt({ image: { gonRoot: "C:/gon" } });
    const args = buildAgentArgs({
      prompt: "make a picture",
      cwd: "C:/work",
      appendSystemPrompt: prompt
    });

    const allowedIdx = args.indexOf("--allowedTools");
    const disallowedIdx = args.indexOf("--disallowedTools");
    const allowed = args.slice(allowedIdx + 1, disallowedIdx);
    expect(allowed.some((t) => t.includes("gen-image.mjs"))).toBe(true);
  });

  it("AgentService passes appendSystemPrompt containing gen-image.mjs to runner on start", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    let capturedOpts: AgentRunOptions | null = null;
    const fakeRunner: AgentRunner = async (opts) => {
      capturedOpts = opts;
      return {
        sessionId: "claude-session-123",
        text: "response",
        isError: false,
        denials: [],
        inputTokens: 10,
        outputTokens: 10,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 50
      };
    };

    const service = new AgentService(db, eventBus, fakeRunner);
    const run = await db.runs.create({
      workspaceId: "00000000-0000-7000-8000-000000000002",
      projectId: "00000000-0000-7000-8000-000000000003",
      createdBy: "00000000-0000-0000-0000-000000000001",
      rawRequest: "Generate a picture of a cat in cafe",
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
        sessionId: "session-cat",
        attachments: [],
        cwd: "C:/fake/cwd"
      }
    });

    await service.start(run);

    expect(capturedOpts).not.toBeNull();
    expect(capturedOpts!.appendSystemPrompt).toBeDefined();
    expect(capturedOpts!.appendSystemPrompt).toContain("gen-image.mjs");
  });
});
