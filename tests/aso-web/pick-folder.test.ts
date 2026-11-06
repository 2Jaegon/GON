import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { FastifyInstance } from "fastify";
import type { IDatabase } from "@aso/database";
import { signChallenge } from "@aso/execution-protocol";
import { createApiServer, DEV_WORKSPACE_ID } from "../../apps/api/src/server.js";
import { pickFolder } from "../../apps/local-runner/src/folder-picker.js";

describe("pickFolder helper", () => {
  it("returns picked path when powershell returns a path on win32", async () => {
    const fakeRun = async () => ({
      stdout: "C:\\Users\\aicam\\Desktop\\수업_AX_W\\gon\r\n",
      stderr: "",
      exitCode: 0
    });
    const result = await pickFolder(fakeRun, "win32");
    expect(result).toEqual({ path: "C:\\Users\\aicam\\Desktop\\수업_AX_W\\gon" });
  });

  it("returns cancelled when powershell outputs empty or whitespace", async () => {
    const fakeRun = async () => ({ stdout: "  \r\n", stderr: "", exitCode: 0 });
    const result = await pickFolder(fakeRun, "win32");
    expect(result).toEqual({ cancelled: true });
  });

  it("returns unsupported on non-win32 platforms without invoking runner", async () => {
    let called = false;
    const fakeRun = async () => {
      called = true;
      return { stdout: "/home/user", stderr: "", exitCode: 0 };
    };
    const result = await pickFolder(fakeRun, "linux");
    expect(result).toEqual({ unsupported: true });
    expect(called).toBe(false);
  });
});

describe("PICK_FOLDER end-to-end route and gateway", () => {
  let server: FastifyInstance;
  let db: IDatabase;
  let runnerGateway: any;
  let port: number;
  let deviceId: string;
  let authSecret: string;
  const sockets: WebSocket[] = [];

  async function pairDevice(): Promise<{ deviceId: string; authSecret: string }> {
    const issue = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${DEV_WORKSPACE_ID}/runner-pairings`
    });
    const { pairingCode } = JSON.parse(issue.body);
    const redeem = await server.inject({
      method: "POST",
      url: "/api/v1/runner/pairings/redeem",
      payload: { pairingCode, deviceName: "pick-test-device", publicKey: "p".repeat(32) }
    });
    return JSON.parse(redeem.body);
  }

  function connectAndAuth(devId: string, secret: string, onMessage?: (msg: any, ws: WebSocket) => void): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/runner/ws`);
      sockets.push(ws);
      ws.on("error", reject);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "CHALLENGE") {
          ws.send(JSON.stringify({
            type: "AUTH_REQUEST",
            timestamp: new Date().toISOString(),
            payload: {
              deviceId: devId,
              nonce: msg.payload.nonce,
              signature: signChallenge(secret, msg.payload.nonce)
            }
          }));
        } else if (msg.type === "AUTH_SUCCESS") {
          resolve(ws);
        } else if (onMessage) {
          onMessage(msg, ws);
        }
      });
    });
  }

  beforeAll(async () => {
    const app = await createApiServer({ logger: false });
    server = app.server;
    db = app.db;
    runnerGateway = app.runnerGateway;
    await server.listen({ port: 0, host: "127.0.0.1" });
    port = (server.server.address() as { port: number }).port;
    ({ deviceId, authSecret } = await pairDevice());
  }, 15000);

  afterAll(async () => {
    for (const ws of sockets) ws.terminate();
    await server.close();
  });

  it("returns 409 RUNNER_OFFLINE when device is not connected", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${DEV_WORKSPACE_ID}/runners/${deviceId}/pick-folder`
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("RUNNER_OFFLINE");
    expect(body.error?.message).toContain("PC의 러너를 켜 주세요");
  });

  it("returns 404 when runner device does not exist or workspace does not match", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000999";
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${DEV_WORKSPACE_ID}/runners/${fakeId}/pick-folder`
    });
    expect(res.statusCode).toBe(404);
  });

  it("successfully picks folder when runner responds with path", async () => {
    const pickedPath = "C:\\Users\\aicam\\Desktop\\수업_AX_W\\gon";
    const ws = await connectAndAuth(deviceId, authSecret, (msg, socket) => {
      if (msg.type === "PICK_FOLDER") {
        socket.send(JSON.stringify({
          type: "PICK_FOLDER_RESULT",
          deviceId,
          timestamp: new Date().toISOString(),
          payload: {
            requestId: msg.payload.requestId,
            path: pickedPath
          }
        }));
      }
    });

    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${DEV_WORKSPACE_ID}/runners/${deviceId}/pick-folder`
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const expectedNormalized = pickedPath.replace(/\\+/g, "/");
    expect(body.activePath).toBe(expectedNormalized);
    expect(body.allowedPaths).toContain(expectedNormalized);

    ws.close();
  });

  it("returns timeout status when gateway times out waiting for runner", async () => {
    // Keep socket open but never reply to PICK_FOLDER
    const ws = await connectAndAuth(deviceId, authSecret, () => { });
    const res = await runnerGateway.requestFolderPick(deviceId, 50);
    expect(res).toEqual({ status: "timeout" });
    ws.close();
  });

  it("returns 409 quickly when runner disconnects while waiting for folder pick", async () => {
    const ws = await connectAndAuth(deviceId, authSecret, (msg, socket) => {
      if (msg.type === "PICK_FOLDER") {
        // Close socket immediately instead of responding
        socket.close();
      }
    });

    const start = Date.now();
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${DEV_WORKSPACE_ID}/runners/${deviceId}/pick-folder`
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("RUNNER_OFFLINE");
  });
});
