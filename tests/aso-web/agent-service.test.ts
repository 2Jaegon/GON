import { describe, it, expect, vi } from "vitest";
import { createDatabase } from "@aso/database";
import { EventBus } from "../../apps/api/src/services/event-bus.js";
import { AgentService } from "../../apps/api/src/services/agent-service.js";
import { AgentRunner, AgentRunOptions, AgentResult, AgentEvent } from "@aso/provider-adapters";
import { Run } from "@aso/contracts";

const WS = "00000000-0000-7000-8000-000000000002";
const PROJECT = "00000000-0000-7000-8000-000000000003";

function createMockRun(db: any, overrides: Partial<Run> = {}): Promise<Run> {
  return db.runs.create({
    workspaceId: WS,
    projectId: PROJECT,
    createdBy: "00000000-0000-0000-0000-000000000001",
    rawRequest: "Hello Claude",
    status: "queued",
    executionMode: "agent",
    runtime: "local",
    providerPreference: "auto",
    budget: {
      maxWallTimeSeconds: 1800,
      maxEstimatedCostUsd: 5,
      maxParallelTasks: 2,
      hardStopOnBudget: true
    },
    runContext: {
      sessionId: "sess-1",
      connectionId: "conn-claude-1",
      cwd: "C:\\work",
      model: "sonnet",
      effort: "low",
      attachments: []
    },
    ...overrides
  });
}

describe("AgentService", () => {
  it("executes a normal run with stream events, records usage, and emits completed", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();
    const publishedEvents: any[] = [];
    const run = await createMockRun(db);
    eventBus.subscribe(run.id, (event) => publishedEvents.push(event));

    const runnerCalls: AgentRunOptions[] = [];
    const fakeRunner: AgentRunner = async (opts, onEvent) => {
      runnerCalls.push(opts);
      onEvent({ kind: "init", sessionId: "claude-s1" });
      onEvent({ kind: "text", delta: "안녕" });
      onEvent({ kind: "text", delta: "하세요!" });
      return {
        sessionId: "claude-s1",
        text: "안녕하세요!",
        isError: false,
        denials: [],
        inputTokens: 10,
        outputTokens: 20,
        cachedInputTokens: 5,
        costUsd: 0.001,
        durationMs: 500
      };
    };

    const service = new AgentService(db, eventBus, fakeRunner);
    await service.start(run);

    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0].cwd).toBe("C:\\work");
    expect(runnerCalls[0].prompt).toBe("Hello Claude");
    expect(runnerCalls[0].model).toBe("sonnet");
    expect(runnerCalls[0].effort).toBe("low");
    expect(runnerCalls[0].resumeSessionId).toBeUndefined();

    // Check updated status in DB
    const updatedRun = await db.runs.findById(run.id);
    expect(updatedRun?.status).toBe("completed");

    // Check emitted events sequence
    const eventTypes = publishedEvents.map((e) => e.eventType);
    expect(eventTypes).toContain("run:classified");
    expect(eventTypes).toContain("chat:delta");
    expect(eventTypes).toContain("agent:done");
    expect(eventTypes).toContain("chat:response");
    expect(eventTypes).toContain("run:completed");

    const classifiedEv = publishedEvents.find((e) => e.eventType === "run:classified");
    expect(classifiedEv.payload).toMatchObject({ mode: "agent" });

    const doneEv = publishedEvents.find((e) => e.eventType === "agent:done");
    expect(doneEv.payload).toMatchObject({
      claudeSessionId: "claude-s1",
      inputTokens: 10,
      outputTokens: 20
    });

    const respEv = publishedEvents.find((e) => e.eventType === "chat:response");
    expect(respEv.payload.text).toBe("안녕하세요!");

    // Check usage record
    const usage = await db.usage.listForRun(run.id);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      provider: "anthropic",
      taskId: "agent",
      source: "claude-code-cli (agent)",
      costConfidence: "measured",
      measuredCostUsd: 0.001,
      inputTokens: 10,
      outputTokens: 20
    });
  });

  it("resumes session when previous agent run in same session and connection exists", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    const fakeRunner: AgentRunner = async (opts) => ({
      sessionId: "claude-s1",
      text: "답변 1",
      isError: false,
      denials: [],
      inputTokens: 5,
      outputTokens: 5,
      cachedInputTokens: 0,
      costUsd: 0,
      durationMs: 100
    });

    const service = new AgentService(db, eventBus, fakeRunner);
    const run1 = await createMockRun(db, { id: "00000000-0000-0000-0000-000000000010" });
    await service.start(run1);

    // Second run with same session & connection
    const runnerCalls: AgentRunOptions[] = [];
    const fakeRunner2: AgentRunner = async (opts) => {
      runnerCalls.push(opts);
      return {
        sessionId: "claude-s1",
        text: "답변 2",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 100
      };
    };

    const service2 = new AgentService(db, eventBus, fakeRunner2);
    const run2 = await createMockRun(db, { id: "00000000-0000-0000-0000-000000000020" });
    await service2.start(run2);

    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0].resumeSessionId).toBe("claude-s1");

    // Third run with DIFFERENT connection -> should NOT resume
    const runnerCalls3: AgentRunOptions[] = [];
    const fakeRunner3: AgentRunner = async (opts) => {
      runnerCalls3.push(opts);
      return {
        sessionId: "claude-s2",
        text: "답변 3",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 100
      };
    };
    const service3 = new AgentService(db, eventBus, fakeRunner3);
    const run3 = await createMockRun(db, {
      id: "00000000-0000-0000-0000-000000000030",
      runContext: {
        sessionId: "sess-1",
        connectionId: "conn-other",
        cwd: "C:\\work"
      }
    });
    await service3.start(run3);

    expect(runnerCalls3).toHaveLength(1);
    expect(runnerCalls3[0].resumeSessionId).toBeUndefined();
  });

  it("falls back to fresh session if resume fails with conversation not found error", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    // Prepare previous run with claude-s1
    const run1 = await createMockRun(db, { id: "00000000-0000-0000-0000-000000000010" });
    await db.runs.updateStatus(run1.id, "completed");
    await db.events.appendEvent(WS, run1.id, "agent:done", { claudeSessionId: "claude-s1" });

    const runnerCalls: AgentRunOptions[] = [];
    const fakeRunner: AgentRunner = async (opts) => {
      runnerCalls.push(opts);
      if (opts.resumeSessionId === "claude-s1") {
        throw new Error("No conversation found with session ID: claude-s1");
      }
      return {
        sessionId: "claude-s2-fresh",
        text: "새로운 세션의 답변입니다.",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 10,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 100
      };
    };

    const service = new AgentService(db, eventBus, fakeRunner);
    const run2 = await createMockRun(db, { id: "00000000-0000-0000-0000-000000000020" });
    await service.start(run2);

    expect(runnerCalls).toHaveLength(2);
    expect(runnerCalls[0].resumeSessionId).toBe("claude-s1");
    expect(runnerCalls[1].resumeSessionId).toBeUndefined();

    const events = await db.events.listForRun(run2.id);
    const respEv = events.find((e: any) => e.eventType === "chat:response");
    expect(respEv.payload.text).toContain("이전 대화를 이어가지 못해 새로 시작했어요\n");
    expect(respEv.payload.text).toContain("새로운 세션의 답변입니다.");
  });

  it("handles permission denials by transitioning to awaiting_approval and redacting secrets", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();
    const publishedEvents: any[] = [];
    const run = await createMockRun(db);
    eventBus.subscribe(run.id, (event) => publishedEvents.push(event));

    const fakeRunner: AgentRunner = async (opts, onEvent) => {
      onEvent({
        kind: "tool",
        id: "t1",
        name: "Write",
        input: { file_path: "C:\\work\\secret.txt", content: "sk-ant-api03-verysecretkey123" }
      });
      return {
        sessionId: "claude-s1",
        text: "파일을 쓰려 했으나 권한이 필요합니다.",
        isError: false,
        denials: [
          {
            toolName: "Write",
            toolUseId: "t1",
            toolInput: { file_path: "C:\\work\\secret.txt", content: "sk-ant-api03-verysecretkey123" }
          },
          {
            toolName: "Bash",
            toolUseId: "t2",
            toolInput: { command: "git push origin main --token=sk-ant-api03-secrettoken123" }
          }
        ],
        inputTokens: 10,
        outputTokens: 10,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 200
      };
    };

    const service = new AgentService(db, eventBus, fakeRunner);
    await service.start(run);

    const updatedRun = await db.runs.findById(run.id);
    expect(updatedRun?.status).toBe("awaiting_approval");

    const approvalEv = publishedEvents.find((e) => e.eventType === "agent:approval_needed");
    expect(approvalEv).toBeDefined();
    expect(approvalEv.payload.claudeSessionId).toBe("claude-s1");
    expect(approvalEv.payload.items).toHaveLength(2);

    const [item1, item2] = approvalEv.payload.items;
    expect(item1.tool).toBe("Write");
    expect(item1.danger).toBe(false);
    expect(item1.rule).toBe("Edit(//c/work/secret.txt)");
    // Secret must not be present in summary or rule
    expect(item1.summary).not.toContain("sk-ant-api03");
    // Write content is never in summary
    expect(item1.summary).toBe("Write: C:\\work\\secret.txt");

    expect(item2.tool).toBe("Bash");
    expect(item2.danger).toBe(true);
    expect(item2.summary).toContain("[REDACTED]");
    expect(item2.summary).not.toContain("sk-ant-api03-secrettoken123");

    // run:completed must NOT be emitted
    expect(publishedEvents.some((e) => e.eventType === "run:completed")).toBe(false);
  });

  it("resolves approval with allow: resumes session with rules and prompt", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    const runnerCalls: AgentRunOptions[] = [];
    const fakeRunner: AgentRunner = async (opts, onEvent) => {
      runnerCalls.push(opts);
      if (runnerCalls.length === 1) {
        return {
          sessionId: "claude-s1",
          text: "권한 대기",
          isError: false,
          denials: [
            {
              toolName: "Bash",
              toolUseId: "t1",
              toolInput: { command: "npm test" }
            }
          ],
          inputTokens: 5,
          outputTokens: 5,
          cachedInputTokens: 0,
          costUsd: 0,
          durationMs: 100
        };
      }
      return {
        sessionId: "claude-s1",
        text: "테스트를 통과했습니다.",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 100
      };
    };

    const run = await createMockRun(db);
    const service = new AgentService(db, eventBus, fakeRunner);
    await service.start(run);

    expect(runnerCalls).toHaveLength(1);

    // Resolve with allow
    const runAwaiting = (await db.runs.findById(run.id))!;
    await service.resolveApproval(runAwaiting, "allow");

    expect(runnerCalls).toHaveLength(2);
    expect(runnerCalls[1].resumeSessionId).toBe("claude-s1");
    expect(runnerCalls[1].prompt).toBe("승인했어요. 계속하세요.");
    expect(runnerCalls[1].extraAllowed).toEqual(["Bash(npm test)"]);

    const finalRun = await db.runs.findById(run.id);
    expect(finalRun?.status).toBe("completed");

    const events = await db.events.listForRun(run.id);
    const resolvedEv = events.find((e: any) => e.eventType === "agent:approval_resolved");
    expect(resolvedEv.payload.decision).toBe("allow");
  });

  it("resolves approval with deny: resumes session with rejection prompt and no extra rules", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    const runnerCalls: AgentRunOptions[] = [];
    const fakeRunner: AgentRunner = async (opts) => {
      runnerCalls.push(opts);
      if (runnerCalls.length === 1) {
        return {
          sessionId: "claude-s1",
          text: "권한 대기",
          isError: false,
          denials: [
            {
              toolName: "Bash",
              toolUseId: "t1",
              toolInput: { command: "rm -rf build" }
            }
          ],
          inputTokens: 5,
          outputTokens: 5,
          cachedInputTokens: 0,
          costUsd: 0,
          durationMs: 100
        };
      }
      return {
        sessionId: "claude-s1",
        text: "다른 방법으로 진행하겠습니다.",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 100
      };
    };

    const run = await createMockRun(db);
    const service = new AgentService(db, eventBus, fakeRunner);
    await service.start(run);

    const runAwaiting = (await db.runs.findById(run.id))!;
    await service.resolveApproval(runAwaiting, "deny");

    expect(runnerCalls).toHaveLength(2);
    expect(runnerCalls[1].resumeSessionId).toBe("claude-s1");
    expect(runnerCalls[1].prompt).toBe("거절했어요. 다른 방법을 제안하세요.");
    expect(runnerCalls[1].extraAllowed).toEqual([]);

    const finalRun = await db.runs.findById(run.id);
    expect(finalRun?.status).toBe("completed");
  });

  it("throws error when resolving approval on a run not awaiting approval", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();
    const service = new AgentService(db, eventBus, vi.fn() as any);

    const run = await createMockRun(db, { status: "completed" });
    await expect(service.resolveApproval(run, "allow")).rejects.toThrow("승인 대기 중인 요청이 없어요");
  });

  it("supersedes previously awaiting approval run in the same session", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    const fakeRunner: AgentRunner = async (opts) => {
      if (opts.prompt === "First prompt") {
        return {
          sessionId: "claude-s1",
          text: "권한 대기",
          isError: false,
          denials: [
            {
              toolName: "Bash",
              toolUseId: "t1",
              toolInput: { command: "git push" }
            }
          ],
          inputTokens: 5,
          outputTokens: 5,
          cachedInputTokens: 0,
          costUsd: 0,
          durationMs: 100
        };
      }
      return {
        sessionId: "claude-s1",
        text: "두번째 실행 완료",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 100
      };
    };

    const service = new AgentService(db, eventBus, fakeRunner);
    const run1 = await createMockRun(db, {
      id: "00000000-0000-0000-0000-000000000001",
      rawRequest: "First prompt"
    });
    await service.start(run1);

    expect((await db.runs.findById(run1.id))?.status).toBe("awaiting_approval");

    // Now start run2 in the same session
    const run2 = await createMockRun(db, {
      id: "00000000-0000-0000-0000-000000000002",
      rawRequest: "Second prompt"
    });
    await service.start(run2);

    // run1 must be cancelled
    const updatedRun1 = await db.runs.findById(run1.id);
    expect(updatedRun1?.status).toBe("cancelled");

    const events1 = await db.events.listForRun(run1.id);
    const resolvedEv = events1.find((e: any) => e.eventType === "agent:approval_resolved");
    expect(resolvedEv.payload).toMatchObject({ decision: "deny", reason: "superseded" });

    // run2 completes
    const updatedRun2 = await db.runs.findById(run2.id);
    expect(updatedRun2?.status).toBe("completed");
  });

  it("cancels an active running agent process and marks run cancelled", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    let runnerSignal: AbortSignal | null = null;
    const fakeRunner: AgentRunner = async (opts, onEvent, signal) => {
      runnerSignal = signal;
      return new Promise<AgentResult>((_, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("중단했어요."));
        });
      });
    };

    const service = new AgentService(db, eventBus, fakeRunner);
    const run = await createMockRun(db);

    const startPromise = service.start(run);

    await new Promise((r) => setTimeout(r, 20));

    expect(runnerSignal).not.toBeNull();
    const cancelled = service.cancel(run.id);
    expect(cancelled).toBe(true);

    await startPromise;

    const updatedRun = await db.runs.findById(run.id);
    expect(updatedRun?.status).toBe("cancelled");

    const events = await db.events.listForRun(run.id);
    expect(events.some((e: any) => e.eventType === "run:cancelled")).toBe(true);

    // Cancel non-running ID returns false
    expect(service.cancel("unknown-id")).toBe(false);
  });

  it("handles text attachments by appending them, and image attachments by prepending a notice", async () => {
    const db = createDatabase(":memory:");
    const eventBus = new EventBus();

    let capturedPrompt = "";
    const fakeRunner: AgentRunner = async (opts) => {
      capturedPrompt = opts.prompt;
      return {
        sessionId: "s1",
        text: "첨부 파일을 확인했습니다.",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 100
      };
    };

    const service = new AgentService(db, eventBus, fakeRunner);
    const run = await createMockRun(db, {
      rawRequest: "이 파일들 좀 봐줘",
      runContext: {
        sessionId: "sess-1",
        connectionId: "conn-1",
        cwd: "C:\\work",
        attachments: [
          { name: "readme.txt", text: "readme content here" },
          { name: "photo.png", dataUrl: "data:image/png;base64,1234" }
        ]
      }
    });

    await service.start(run);

    expect(capturedPrompt).toContain("이 파일들 좀 봐줘\n\n[첨부 파일]:\n--- readme.txt ---\nreadme content here");

    const events = await db.events.listForRun(run.id);
    const respEv = events.find((e: any) => e.eventType === "chat:response");
    expect(respEv.payload.text).toContain("이미지 첨부는 에이전트 경로에서 아직 지원하지 않아요\n");
    expect(respEv.payload.text).toContain("첨부 파일을 확인했습니다.");
  });

  describe("Grilling Detection and Badge Events", () => {
    it("emits agent:grilling { state: 'asking' } when response text starts with [Grilling] and strips marker from output", async () => {
      const db = createDatabase(":memory:");
      const eventBus = new EventBus();

      const fakeRunner: AgentRunner = async (opts, onEvent) => {
        onEvent({ kind: "text", delta: "[Grilling]\n1. 어떤 언어로 구현할까요?" });
        return {
          sessionId: "s1",
          text: "[Grilling]\n1. 어떤 언어로 구현할까요?\n(추천: TypeScript)",
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
      const run = await createMockRun(db, { rawRequest: "로그인 만들어줘" });

      await service.start(run);

      const events = await db.events.listForRun(run.id);
      const grillEv = events.find((e: any) => e.eventType === "agent:grilling");
      expect(grillEv).toBeDefined();
      expect(grillEv.payload).toEqual({ state: "asking" });

      const respEv = events.find((e: any) => e.eventType === "chat:response");
      expect(respEv.payload.text).not.toContain("[Grilling]");
      expect(respEv.payload.text).toContain("1. 어떤 언어로 구현할까요?");
    });

    it("emits agent:grilling { state: 'asking' } when Skill tool with /grill/i is invoked", async () => {
      const db = createDatabase(":memory:");
      const eventBus = new EventBus();

      const fakeRunner: AgentRunner = async (opts, onEvent) => {
        onEvent({
          kind: "tool",
          id: "call-1",
          name: "Skill",
          input: { skill: "mattpocock-skills:grilling", prompt: "refine" }
        });
        return {
          sessionId: "s1",
          text: "몇 가지 명확화 질문을 드릴게요.",
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
      const run = await createMockRun(db, { rawRequest: "테스트 작성해줘" });

      await service.start(run);

      const events = await db.events.listForRun(run.id);
      const grillEv = events.find((e: any) => e.eventType === "agent:grilling");
      expect(grillEv).toBeDefined();
      expect(grillEv.payload).toEqual({ state: "asking" });
    });

    it("does not emit agent:grilling for regular responses", async () => {
      const db = createDatabase(":memory:");
      const eventBus = new EventBus();

      const fakeRunner: AgentRunner = async () => ({
        sessionId: "s1",
        text: "안녕하세요! 무엇을 도와드릴까요?",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 50
      });

      const service = new AgentService(db, eventBus, fakeRunner);
      const run = await createMockRun(db, { rawRequest: "안녕" });

      await service.start(run);

      const events = await db.events.listForRun(run.id);
      expect(events.some((e: any) => e.eventType === "agent:grilling")).toBe(false);
    });

    it("emits agent:grilling { state: 'answered' } on subsequent run when previous run was in asking state", async () => {
      const db = createDatabase(":memory:");
      const eventBus = new EventBus();

      let turn = 0;
      const fakeRunner: AgentRunner = async (opts, onEvent) => {
        turn++;
        if (turn === 1) {
          onEvent({ kind: "text", delta: "[Grilling]\n어떤 방식으로?" });
          return {
            sessionId: "s1",
            text: "[Grilling]\n어떤 방식으로?",
            isError: false,
            denials: [],
            inputTokens: 5,
            outputTokens: 5,
            cachedInputTokens: 0,
            costUsd: 0,
            durationMs: 50
          };
        }
        return {
          sessionId: "s1",
          text: "요구사항이 정리되었으니 구현하겠습니다.",
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
      const run1 = await createMockRun(db, {
        rawRequest: "로그인 만들어줘",
        runContext: { sessionId: "sess-grill", connectionId: "c1", cwd: "C:\\work" }
      });
      await service.start(run1);

      const run2 = await createMockRun(db, {
        rawRequest: "TypeScript로 만들어줘",
        runContext: { sessionId: "sess-grill", connectionId: "c1", cwd: "C:\\work" }
      });
      await service.start(run2);

      const events2 = await db.events.listForRun(run2.id);
      const grillEv2 = events2.find((e: any) => e.eventType === "agent:grilling");
      expect(grillEv2).toBeDefined();
      expect(grillEv2.payload).toEqual({ state: "answered" });
    });
  });
});
