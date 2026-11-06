import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "node:http";
import { IDatabase } from "@aso/database";
import { generateNonce, verifyChallenge, RunnerMessage } from "@aso/execution-protocol";

export type FolderPickOutcome =
  | { status: "picked"; path: string }
  | { status: "cancelled" | "unsupported" | "timeout" | "offline" };

export class RunnerGateway {
  private wss: WebSocketServer | null = null;
  private connectedRunners = new Map<string, { ws: WebSocket; deviceId: string }>();
  private pendingFolderPicks = new Map<
    string,
    {
      deviceId: string;
      resolve: (outcome: FolderPickOutcome) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(private db: IDatabase) {}

  public attach(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ server: httpServer, path: "/api/v1/runner/ws" });

    this.wss.on("connection", (ws) => {
      let authenticatedDeviceId: string | null = null;
      const nonce = generateNonce();

      // 1. Send challenge to new connection
      const challengeMsg: RunnerMessage = {
        type: "CHALLENGE",
        timestamp: new Date().toISOString(),
        payload: { nonce, expiresAt: new Date(Date.now() + 60000).toISOString() }
      };
      ws.send(JSON.stringify(challengeMsg));

      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString()) as RunnerMessage;

          if (msg.type === "AUTH_REQUEST") {
            const { deviceId, nonce: echoedNonce, signature } = msg.payload;
            const reject = (error: string) => {
              ws.send(JSON.stringify({ type: "AUTH_FAILURE", payload: { error } }));
              ws.close();
            };
            const device = await this.db.runners.findById(deviceId);
            if (!device) return reject("Unknown device");
            if (!device.authSecret) return reject("인증 정보가 없는 기기예요. 다시 페어링해 주세요.");
            if (
              echoedNonce !== nonce ||
              typeof signature !== "string" ||
              !verifyChallenge(device.authSecret, nonce, signature)
            ) {
              return reject("Authentication failed");
            }

            authenticatedDeviceId = deviceId;
            this.connectedRunners.set(deviceId, { ws, deviceId });
            await this.db.runners.updateStatus(deviceId, "online");

            ws.send(JSON.stringify({
              type: "AUTH_SUCCESS",
              timestamp: new Date().toISOString(),
              payload: { deviceId, workspaceId: device.workspaceId }
            }));
          } else if (msg.type === "HEARTBEAT" && authenticatedDeviceId) {
            await this.db.runners.updateStatus(authenticatedDeviceId, "online");
          } else if (msg.type === "PICK_FOLDER_RESULT" && authenticatedDeviceId) {
            const { requestId, path, cancelled, unsupported } = (msg.payload || {}) as {
              requestId?: string;
              path?: string;
              cancelled?: boolean;
              unsupported?: boolean;
            };
            if (requestId && this.pendingFolderPicks.has(requestId)) {
              const pending = this.pendingFolderPicks.get(requestId)!;
              clearTimeout(pending.timer);
              this.pendingFolderPicks.delete(requestId);
              if (typeof path === "string" && path.trim().length > 0) {
                pending.resolve({ status: "picked", path: path.trim() });
              } else if (unsupported) {
                pending.resolve({ status: "unsupported" });
              } else {
                pending.resolve({ status: "cancelled" });
              }
            }
          }
        } catch (err) {
          // ignore malformed message
        }
      });

      ws.on("close", async () => {
        if (authenticatedDeviceId) {
          this.connectedRunners.delete(authenticatedDeviceId);
          await this.db.runners.updateStatus(authenticatedDeviceId, "offline");

          for (const [reqId, pending] of this.pendingFolderPicks.entries()) {
            if (pending.deviceId === authenticatedDeviceId) {
              clearTimeout(pending.timer);
              this.pendingFolderPicks.delete(reqId);
              pending.resolve({ status: "offline" });
            }
          }
        }
      });
    });
  }

  public getConnectedCount(): number {
    return this.connectedRunners.size;
  }

  public disconnectRunner(deviceId: string): void {
    const conn = this.connectedRunners.get(deviceId);
    if (conn) {
      try {
        conn.ws.close(1000, "Runner device unregistered");
      } catch {}
      this.connectedRunners.delete(deviceId);
    }
  }

  public requestFolderPick(
    deviceId: string,
    timeoutMs = 120_000
  ): Promise<FolderPickOutcome> {
    const conn = this.connectedRunners.get(deviceId);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ status: "offline" });
    }

    const requestId = crypto.randomUUID();
    return new Promise<FolderPickOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingFolderPicks.delete(requestId);
        resolve({ status: "timeout" });
      }, timeoutMs);

      this.pendingFolderPicks.set(requestId, {
        deviceId,
        resolve,
        timer
      });

      try {
        conn.ws.send(JSON.stringify({
          type: "PICK_FOLDER",
          timestamp: new Date().toISOString(),
          payload: { requestId }
        }));
      } catch (err) {
        clearTimeout(timer);
        this.pendingFolderPicks.delete(requestId);
        resolve({ status: "offline" });
      }
    });
  }
}

