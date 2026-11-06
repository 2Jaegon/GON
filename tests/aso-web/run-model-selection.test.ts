import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliRunner } from "@aso/provider-adapters";
import { createDatabase, IDatabase } from "@aso/database";
import { createAuthedServer } from "./helpers/auth.js";
import { resolveActiveWorkspacePath } from "../../apps/api/src/services/workspace-path.js";

const WS = "00000000-0000-7000-8000-000000000002";
const PROJECT = "00000000-0000-7000-8000-000000000003";
const CLAUDE_AUTH = '{"loggedIn":true,"subscriptionType":"pro"}';
const CLAUDE_REPLY = JSON.stringify({ result: "안녕하세요", usage: { input_tokens: 3, output_tokens: 4 } });

interface Call {
  cmd: string;
  args: string[];
  opts?: { cwd?: string; timeoutMs?: number };
}

function recordingRunner(calls: Call[], failPrompt = false): CliRunner {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const key = [cmd, ...args].join(" ");
    if (key === "claude --version") return { stdout: "2.1.0 (Claude Code)", stderr: "" };
    if (key === "claude auth status") return { stdout: CLAUDE_AUTH, stderr: "" };
    if (cmd === "claude" && args[0] === "-p" && failPrompt) throw new Error("claude crashed");
    if (cmd === "claude" && args[0] === "-p") return { stdout: CLAUDE_REPLY, stderr: "" };
    throw new Error(`unexpected cli call: ${key}`);
  };
}

async function setup(calls: Call[] = [], failPrompt = false) {
  const db = createDatabase(":memory:");
  const { server } = await createAuthedServer({ db, logger: false, cliRunner: recordingRunner(calls, failPrompt) });
  const detect = await server.inject({ method: "POST", url: `/api/v1/workspaces/${WS}/connections/detect-subscriptions` });
  const claude = JSON.parse(detect.body).items.find((c: any) => c.provider === "anthropic");
  return { db, server, connectionId: claude.id as string };
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "aso-run-"));
}

function postRun(server: any, payload: Record<string, unknown>) {
  return server.inject({
    method: "POST",
    url: `/api/v1/workspaces/${WS}/projects/${PROJECT}/runs`,
    payload: { request: "안녕", executionMode: "chat", ...payload }
  });
}

async function waitForStatus(db: IDatabase, runId: string, statuses: string[]) {
  for (let i = 0; i < 100; i++) {
    const run = await db.runs.findById(runId);
    if (run && statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`run ${runId} never reached ${statuses.join("/")}`);
}

describe("run with a selected subscription model", () => {
  it("rejects a model that is not in the connection list", async () => {
    const { server, connectionId } = await setup();
    await pairRunnerWithFolder(server, tmpFolder());
    const res = await postRun(server, { connectionId, model: "gpt-nope" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toEqual({
      code: "MODEL_NOT_AVAILABLE",
      message: "이 구독에서 쓸 수 없는 모델이에요"
    });
  });

  it("rejects an unknown connection", async () => {
    const { server } = await setup();
    await pairRunnerWithFolder(server, tmpFolder());
    const res = await postRun(server, { connectionId: "11111111-1111-4111-8111-111111111111" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("CONNECTION_NOT_FOUND");
  });

  it("rejects an effort the connection does not support", async () => {
    const { db, server, connectionId } = await setup();
    await db.providers.updateMetadata(connectionId, {
      models: {
        plan: "pro",
        planVerified: true,
        efforts: [],
        models: [{ id: "sonnet", label: "Sonnet" }],
        source: "x",
        refreshedAt: new Date().toISOString()
      }
    });
    await pairRunnerWithFolder(server, tmpFolder());
    const res = await postRun(server, { connectionId, model: "sonnet", effort: "high" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("EFFORT_NOT_SUPPORTED");
  });

  it("requires an active workspace folder", async () => {
    const { server, connectionId } = await setup();
    const res = await postRun(server, { connectionId, model: "sonnet" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toEqual({
      code: "NO_WORKSPACE_FOLDER",
      message: "작업 폴더를 먼저 골라 주세요"
    });
  });

  it("runs claude with the chosen model, effort and the active folder as cwd", async () => {
    const calls: Call[] = [];
    const { db, server, connectionId } = await setup(calls);
    const folder = tmpFolder();
    await pairRunnerWithFolder(server, folder);

    const res = await postRun(server, {
      connectionId,
      model: "sonnet",
      effort: "low",
      workspacePath: "C:/should/not/be/used"
    });
    expect(res.statusCode).toBe(201);
    const { runId } = JSON.parse(res.body);
    const run = await waitForStatus(db, runId, ["completed", "failed"]);
    expect(run.status).toBe("completed");

    const call = calls.find((c) => c.cmd === "claude" && c.args[0] === "-p")!;
    expect(call.args.slice(0, -1)).toEqual(["-p", "--output-format", "json", "--model", "sonnet", "--effort", "low", "--"]);
    expect(call.opts?.cwd).toBe(path.resolve(folder));
    expect(run.runContext).toMatchObject({ connectionId, model: "sonnet", effort: "low", cwd: path.resolve(folder) });

    const usage = await db.usage.listForRun(runId);
    expect(usage[0].model).toBe("sonnet");
  });

  it("keeps the old behaviour when no connectionId is sent", async () => {
    const { server } = await setup();
    const res = await postRun(server, { providerPreference: "mock" });
    expect(res.statusCode).toBe(201);
  });

  it("requires a folder the user chose, not the server's own default, after pairing", async () => {
    const { server, connectionId } = await setup();
    const pair = await server.inject({ method: "POST", url: `/api/v1/workspaces/${WS}/runner-pairings` });
    await server.inject({
      method: "POST",
      url: "/api/v1/runner/pairings/redeem",
      payload: {
        pairingCode: JSON.parse(pair.body).pairingCode,
        deviceName: "test-pc",
        publicKey: "-----BEGIN PUBLIC KEY-----abcdefgh-----END PUBLIC KEY-----"
      }
    });
    const res = await postRun(server, { connectionId, model: "sonnet" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("NO_WORKSPACE_FOLDER");
  });

  async function awaitingApprovalRun(server: any, db: IDatabase, connectionId: string): Promise<string> {
    const res = await postRun(server, {
      connectionId,
      model: "sonnet",
      executionMode: "standard",
      options: { requirePlanApproval: true }
    });
    expect(res.statusCode).toBe(201);
    const { runId } = JSON.parse(res.body);
    await waitForStatus(db, runId, ["awaiting_approval"]);
    return runId;
  }

  async function expectFailedWithEvent(server: any, db: IDatabase, runId: string) {
    await server.inject({ method: "POST", url: `/api/v1/workspaces/${WS}/runs/${runId}/plan/approve` });
    const run = await db.runs.findById(runId);
    expect(run?.status).toBe("failed");
    expect(run?.completedAt).toBeTruthy();
    const events = await db.events.listForRun(runId);
    expect(events.some((e) => e.eventType === "run:failed")).toBe(true);
  }

  it("marks the run failed with run:failed when the provider fails after approval", async () => {
    const calls: Call[] = [];
    const { db, server, connectionId } = await setup(calls, true);
    await pairRunnerWithFolder(server, tmpFolder());
    const runId = await awaitingApprovalRun(server, db, connectionId);

    await expectFailedWithEvent(server, db, runId);
    expect(calls.some((c) => c.cmd === "claude" && c.args[0] === "-p")).toBe(true);
    const events = await db.events.listForRun(runId);
    expect(events.find((e) => e.eventType === "run:failed")?.payload.error).toContain("Claude 호출에 실패했어요");
  });

  it("fails an approval-gated run whose folder was revoked in the meantime", async () => {
    const calls: Call[] = [];
    const { db, server, connectionId } = await setup(calls);
    const folder = tmpFolder();
    const deviceId = await pairRunnerWithFolder(server, folder);
    const runId = await awaitingApprovalRun(server, db, connectionId);

    const revoke = await server.inject({
      method: "DELETE",
      url: `/api/v1/workspaces/${WS}/runners/${deviceId}/paths`,
      payload: { path: folder }
    });
    expect(revoke.statusCode).toBe(200);

    await expectFailedWithEvent(server, db, runId);
    expect(calls.some((c) => c.cmd === "claude" && c.args[0] === "-p")).toBe(false);
  });

  it("includes prior session conversation history on subsequent turns in the same session", async () => {
    const calls: Call[] = [];
    const { db, server, connectionId } = await setup(calls);
    await pairRunnerWithFolder(server, tmpFolder());

    const sessionId = "sess-multi-turn-test";
    const first = await postRun(server, {
      connectionId,
      model: "sonnet",
      sessionId,
      request: "첫 번째 질문이야"
    });
    expect(first.statusCode).toBe(201);
    const firstRunId = JSON.parse(first.body).runId;
    await waitForStatus(db, firstRunId, ["completed", "failed"]);

    const second = await postRun(server, {
      connectionId,
      model: "sonnet",
      sessionId,
      request: "방금 내가 뭐라고 물어봤지?"
    });
    expect(second.statusCode).toBe(201);
    const secondRunId = JSON.parse(second.body).runId;
    await waitForStatus(db, secondRunId, ["completed", "failed"]);

    const chatCalls = calls.filter((c) => c.cmd === "claude" && c.args[0] === "-p");
    expect(chatCalls.length).toBe(2);
    expect(chatCalls[0].args[chatCalls[0].args.length - 1]).toBe("첫 번째 질문이야");
    const secondPrompt = chatCalls[1].args[chatCalls[1].args.length - 1];
    expect(secondPrompt).toContain("[이전 대화 기록]");
    expect(secondPrompt).toContain("사용자: 첫 번째 질문이야");
    expect(secondPrompt).toContain("AI: 안녕하세요");
    expect(secondPrompt).toContain("[현재 질문]\n방금 내가 뭐라고 물어봤지?");
  });
});

describe("resolveActiveWorkspacePath", () => {
  it("returns the active folder as an OS path, or null when it is missing from disk", async () => {
    const { db, server } = await setup();
    expect(await resolveActiveWorkspacePath(db, WS)).toBeNull();

    const folder = tmpFolder();
    await pairRunnerWithFolder(server, folder);
    expect(await resolveActiveWorkspacePath(db, WS)).toBe(path.resolve(folder));

    fs.rmSync(folder, { recursive: true });
    expect(await resolveActiveWorkspacePath(db, WS)).toBeNull();
  });
});
