import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "node:http";
import { IDatabase } from "@aso/database";
import { generateNonce, verifyChallenge, RunnerMessage } from "@aso/execution-protocol";

export class RunnerGateway {
  private wss: WebSocketServer | null = null;
  private connectedRunners = new Map<string, { ws: WebSocket; deviceId: string }>();

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
          }
        } catch (err) {
          // ignore malformed message
        }
      });

      ws.on("close", async () => {
        if (authenticatedDeviceId) {
          this.connectedRunners.delete(authenticatedDeviceId);
          await this.db.runners.updateStatus(authenticatedDeviceId, "offline");
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
}

