import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { FastifyInstance } from "fastify";
import type { IDatabase } from "@aso/database";
import { signChallenge, verifyChallenge } from "@aso/execution-protocol";
import { DEV_WORKSPACE_ID } from "../../apps/api/src/server.js";
import { createAuthedServer } from "./helpers/auth.js";

describe("verifyChallenge", () => {
  const secret = "a".repeat(64);
  const nonce = "n".repeat(64);

  it("accepts the signature made with the same secret and nonce", () => {
    expect(verifyChallenge(secret, nonce, signChallenge(secret, nonce))).toBe(true);
  });

  it("rejects a signature from another secret or another nonce", () => {
    expect(verifyChallenge(secret, nonce, signChallenge("b".repeat(64), nonce))).toBe(false);
    expect(verifyChallenge(secret, nonce, signChallenge(secret, "other"))).toBe(false);
  });

  it("rejects a signature with a different length", () => {
    expect(verifyChallenge(secret, nonce, "device-auth-signature")).toBe(false);
    expect(verifyChallenge(secret, nonce, "")).toBe(false);
  });
});

describe("runner HMAC authentication", () => {
  let server: FastifyInstance;
  let db: IDatabase;
  let port: number;
  let deviceId: string;
  let authSecret: string;
  let listBody: string;
  const sockets: WebSocket[] = [];

  async function pair(): Promise<{ deviceId: string; authSecret: string }> {
    const issue = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${DEV_WORKSPACE_ID}/runner-pairings`
    });
    const { pairingCode } = JSON.parse(issue.body);
    const redeem = await server.inject({
      method: "POST",
      url: "/api/v1/runner/pairings/redeem",
      payload: { pairingCode, deviceName: "auth-test", publicKey: "x".repeat(32) }
    });
    expect(redeem.statusCode).toBe(200);
    return JSON.parse(redeem.body);
  }

  // Connect, wait for CHALLENGE, let `respond` build the reply, return the next message and whether the socket closed.
  function handshake(
    respond: (nonce: string) => object
  ): Promise<{ reply: any; closed: boolean }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/runner/ws`);
      sockets.push(ws);
      const timer = setTimeout(() => reject(new Error("handshake timeout")), 4000);
      let reply: any = null;
      ws.on("error", (e) => { clearTimeout(timer); reject(e); });
      ws.on("close", () => { clearTimeout(timer); resolve({ reply, closed: true }); });
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "CHALLENGE") {
          ws.send(JSON.stringify({
            type: "AUTH_REQUEST",
            timestamp: new Date().toISOString(),
            payload: respond(msg.payload.nonce)
          }));
        } else {
          reply = msg;
          if (msg.type === "AUTH_SUCCESS") {
            clearTimeout(timer);
            resolve({ reply, closed: false });
          }
        }
      });
    });
  }

  beforeAll(async () => {
    const app = await createAuthedServer({ logger: false });
    server = app.server;
    db = app.db;
    await server.listen({ port: 0, host: "127.0.0.1" });
    port = (server.server.address() as { port: number }).port;
    ({ deviceId, authSecret } = await pair());
    const list = await server.inject({ method: "GET", url: `/api/v1/workspaces/${DEV_WORKSPACE_ID}/runners` });
    listBody = list.body;
  }, 15000);

  afterAll(async () => {
    for (const ws of sockets) ws.terminate();
    await server.close();
  });

  it("returns authSecret once on redeem and never from the runner list", () => {
    expect(authSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(listBody).toContain(deviceId);
    expect(listBody).not.toContain(authSecret);
    expect(listBody).not.toContain("authSecret");
  });

  it("does not leak authSecret from path, active-path or delete routes", async () => {
    const base = `/api/v1/workspaces/${DEV_WORKSPACE_ID}/runners/${deviceId}`;
    const responses = [
      await server.inject({ method: "GET", url: `${base}/paths` }),
      await server.inject({ method: "POST", url: `${base}/paths`, payload: { path: process.cwd() } }),
      await server.inject({ method: "POST", url: `${base}/active-path`, payload: { path: process.cwd() } }),
      await server.inject({ method: "DELETE", url: `${base}/paths`, payload: { path: process.cwd() } })
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(authSecret);
    }
  });

  it("accepts a correct HMAC signature", async () => {
    const { reply } = await handshake((nonce) => ({
      deviceId, nonce, signature: signChallenge(authSecret, nonce)
    }));
    expect(reply.type).toBe("AUTH_SUCCESS");
  });

  it("rejects the old fixed signature and closes", async () => {
    const { reply, closed } = await handshake((nonce) => ({
      deviceId, nonce, signature: "device-auth-signature"
    }));
    expect(reply.type).toBe("AUTH_FAILURE");
    expect(closed).toBe(true);
    expect(JSON.stringify(reply)).not.toContain(authSecret);
  });

  it("rejects a signature over a different nonce", async () => {
    const { reply, closed } = await handshake((nonce) => ({
      deviceId, nonce, signature: signChallenge(authSecret, "some-other-nonce")
    }));
    expect(reply.type).toBe("AUTH_FAILURE");
    expect(closed).toBe(true);
  });

  it("rejects a payload nonce that was not issued to this connection", async () => {
    const forged = "f".repeat(64);
    const { reply, closed } = await handshake(() => ({
      deviceId, nonce: forged, signature: signChallenge(authSecret, forged)
    }));
    expect(reply.type).toBe("AUTH_FAILURE");
    expect(closed).toBe(true);
  });

  it("asks old devices without authSecret to pair again", async () => {
    const old = await pair();
    // strip the secret to simulate a device registered before HMAC auth
    const device = await db.runners.findById(old.deviceId);
    expect(device).not.toBeNull();
    delete (device as any).authSecret;
    const { reply, closed } = await handshake((nonce) => ({
      deviceId: old.deviceId, nonce, signature: signChallenge(old.authSecret, nonce)
    }));
    expect(reply.type).toBe("AUTH_FAILURE");
    expect(reply.payload.error).toContain("다시 페어링해 주세요");
    expect(closed).toBe(true);
  });
});
