import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase, IDatabase } from "@aso/database";
import { CliRunner, AgentRunner, AgentRunOptions } from "@aso/provider-adapters";
import { createAuthedServer } from "./helpers/auth.js";

const WS = "00000000-0000-7000-8000-000000000002";
const PROJECT = "00000000-0000-7000-8000-000000000003";
const CLAUDE_AUTH = '{"loggedIn":true,"subscriptionType":"pro"}';
const CLAUDE_REPLY = JSON.stringify({ result: "채팅 응답", usage: { input_tokens: 3, output_tokens: 4 } });

interface Call {
  cmd: string;
  args: string[];
}

function recordingRunner(calls: Call[]): CliRunner {
  return async (cmd, args) => {
    calls.push({ cmd, args });
    const key = [cmd, ...args].join(" ");
    if (key === "claude --version") return { stdout: "2.1.0 (Claude Code)", stderr: "" };
    if (key === "claude auth status") return { stdout: CLAUDE_AUTH, stderr: "" };
    if (cmd === "claude" && args[0] === "-p") return { stdout: CLAUDE_REPLY, stderr: "" };
    throw new Error(`unexpected cli call: ${key}`);
  };
}

async function pairRunnerWithFolder(server: any, folder: string): Promise<string> {
  const pair = await server.inject({ method: "POST", url: `/api/v1/workspaces/${WS}/runner-pairings` });
  const { pairingCode } = JSON.parse(pair.body);
  const redeem = await server.inject({
    method: "POST",
    url: "/api/v1/runner/pairings/redeem",
    payload: { pairingCode, deviceName: "test-pc", publicKey: "-----BEGIN PUBLIC KEY-----abcdefgh-----END PUBLIC KEY-----" }
  });
  const { deviceId } = JSON.parse(redeem.body);
  const grant = await server.inject({
    method: "POST",
    url: `/api/v1/workspaces/${WS}/runners/${deviceId}/paths`,
    payload: { path: folder, setAsActive: true }
  });
  expect(grant.statusCode).toBe(200);
  return deviceId;
}

function tmpFolder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aso-agent-routes-"));
}

async function waitForStatus(db: IDatabase, runId: string, statuses: string[]) {
  for (let i = 0; i < 100; i++) {
    const run = await db.runs.findById(runId);
    if (run && statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 20));
  }
  return db.runs.findById(runId);
}

describe("Agent API Routes & Server Integration", () => {
  it("routes Claude connection + workspace folder + omitted executionMode to agent mode", async () => {
    const calls: Call[] = [];
    const agentCalls: AgentRunOptions[] = [];
    const fakeAgentRunner: AgentRunner = async (opts) => {
      agentCalls.push(opts);
      return {
        sessionId: "s1",
        text: "에이전트 답변",
        isError: false,
        denials: [],
        inputTokens: 10,
        outputTokens: 20,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 200
      };
    };

    const db = createDatabase(":memory:");
    const { server } = await createAuthedServer({
      db,
      logger: false,
      cliRunner: recordingRunner(calls),
      agentRunner: fakeAgentRunner
    });

    const folder = tmpFolder();
    await pairRunnerWithFolder(server, folder);

    const detect = await server.inject({ method: "POST", url: `/api/v1/workspaces/${WS}/connections/detect-subscriptions` });
    const claude = JSON.parse(detect.body).items.find((c: any) => c.provider === "anthropic");

    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/projects/${PROJECT}/runs`,
      payload: {
        request: "안녕 에이전트",
        connectionId: claude.id
        // executionMode omitted -> defaults to auto, routes to agent
      }
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.executionMode).toBe("agent");

    // Wait for agent run to complete
    const finalRun = await waitForStatus(db, body.id, ["completed", "failed"]);
    expect(finalRun?.status).toBe("completed");

    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0].prompt).toBe("안녕 에이전트");
    expect(agentCalls[0].cwd).toBe(folder);

    // Verify events recorded
    const events = await db.events.listForRun(body.id);
    expect(events.some((e: any) => e.eventType === "run:completed")).toBe(true);
  });

  it("routes to chat mode when executionMode is explicitly 'chat'", async () => {
    const calls: Call[] = [];
    const agentCalls: AgentRunOptions[] = [];
    const fakeAgentRunner: AgentRunner = async (opts) => {
      agentCalls.push(opts);
      return {
        sessionId: "s1",
        text: "에이전트 답변",
        isError: false,
        denials: [],
        inputTokens: 10,
        outputTokens: 20,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 200
      };
    };

    const db = createDatabase(":memory:");
    const { server } = await createAuthedServer({
      db,
      logger: false,
      cliRunner: recordingRunner(calls),
      agentRunner: fakeAgentRunner
    });

    const folder = tmpFolder();
    await pairRunnerWithFolder(server, folder);

    const detect = await server.inject({ method: "POST", url: `/api/v1/workspaces/${WS}/connections/detect-subscriptions` });
    const claude = JSON.parse(detect.body).items.find((c: any) => c.provider === "anthropic");

    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/projects/${PROJECT}/runs`,
      payload: {
        request: "안녕 챗",
        connectionId: claude.id,
        executionMode: "chat"
      }
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.executionMode).toBe("chat");

    const finalRun = await waitForStatus(db, body.id, ["completed", "failed"]);
    expect(finalRun?.status).toBe("completed");

    // Agent runner should NOT be called
    expect(agentCalls).toHaveLength(0);
    // CLI runner should have handled claude -p
    expect(calls.some((c) => c.cmd === "claude" && c.args.includes("-p"))).toBe(true);
  });

  it("handles approval allow/deny endpoints and rejects invalid requests", async () => {
    const calls: Call[] = [];
    const agentCalls: AgentRunOptions[] = [];
    const fakeAgentRunner: AgentRunner = async (opts) => {
      agentCalls.push(opts);
      if (agentCalls.length === 1) {
        return {
          sessionId: "s1",
          text: "권한 필요",
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
        sessionId: "s1",
        text: "승인 후 완료",
        isError: false,
        denials: [],
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 100
      };
    };

    const db = createDatabase(":memory:");
    const { server } = await createAuthedServer({
      db,
      logger: false,
      cliRunner: recordingRunner(calls),
      agentRunner: fakeAgentRunner
    });

    const folder = tmpFolder();
    await pairRunnerWithFolder(server, folder);

    const detect = await server.inject({ method: "POST", url: `/api/v1/workspaces/${WS}/connections/detect-subscriptions` });
    const claude = JSON.parse(detect.body).items.find((c: any) => c.provider === "anthropic");

    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/projects/${PROJECT}/runs`,
      payload: {
        request: "테스트 돌려줘",
        connectionId: claude.id
      }
    });

    const body = JSON.parse(res.body);
    const awaitingRun = await waitForStatus(db, body.id, ["awaiting_approval"]);
    expect(awaitingRun?.status).toBe("awaiting_approval");

    // Invalid decision body -> 400
    const badDecision = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/runs/${body.id}/agent/approval`,
      payload: { decision: "maybe" }
    });
    expect(badDecision.statusCode).toBe(400);

    // Non-existent run -> 404
    const notFound = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/runs/00000000-0000-0000-0000-000000000999/agent/approval`,
      payload: { decision: "allow" }
    });
    expect(notFound.statusCode).toBe(404);

    // Valid allow -> 200
    const allowRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/runs/${body.id}/agent/approval`,
      payload: { decision: "allow" }
    });
    expect(allowRes.statusCode).toBe(200);
    expect(JSON.parse(allowRes.body)).toEqual({ success: true });

    // Verify runner second call
    const completedRun = await waitForStatus(db, body.id, ["completed"]);
    expect(completedRun?.status).toBe("completed");
    expect(agentCalls).toHaveLength(2);
    expect(agentCalls[1].extraAllowed).toEqual(["Bash(npm test)"]);

    // Resolving again when already completed -> 400
    const redundant = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/runs/${body.id}/agent/approval`,
      payload: { decision: "allow" }
    });
    expect(redundant.statusCode).toBe(400);
  });

  it("cancels a running agent run via POST /cancel", async () => {
    const calls: Call[] = [];
    const fakeAgentRunner: AgentRunner = async (opts, onEvent, signal) => {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("중단했어요."));
        });
      });
    };

    const db = createDatabase(":memory:");
    const { server } = await createAuthedServer({
      db,
      logger: false,
      cliRunner: recordingRunner(calls),
      agentRunner: fakeAgentRunner
    });

    const folder = tmpFolder();
    await pairRunnerWithFolder(server, folder);

    const detect = await server.inject({ method: "POST", url: `/api/v1/workspaces/${WS}/connections/detect-subscriptions` });
    const claude = JSON.parse(detect.body).items.find((c: any) => c.provider === "anthropic");

    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/projects/${PROJECT}/runs`,
      payload: {
        request: "오래 걸리는 작업",
        connectionId: claude.id
      }
    });

    const body = JSON.parse(res.body);
    // Wait until run is running
    await waitForStatus(db, body.id, ["running"]);

    // Cancel running run
    const cancelRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/runs/${body.id}/cancel`
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(JSON.parse(cancelRes.body)).toEqual({ success: true });

    const cancelledRun = await waitForStatus(db, body.id, ["cancelled"]);
    expect(cancelledRun?.status).toBe("cancelled");

    // Cancel unknown runId -> 404
    const notFoundCancel = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${WS}/runs/00000000-0000-0000-0000-000000000999/cancel`
    });
    expect(notFoundCancel.statusCode).toBe(404);
  });
});

