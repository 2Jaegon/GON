import { WebSocket } from "ws";
import { RunnerLocalConfig } from "./config.js";
import { JobExecutor } from "./executor.js";
import { RunnerMessage } from "@aso/execution-protocol";

export class RunnerClient {
  private ws: WebSocket | null = null;
  private executor: JobExecutor;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(private config: RunnerLocalConfig) {
    this.executor = new JobExecutor(config.secretKey, config.allowedPaths);
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.serverUrl.replace(/^http/, "ws") + "/api/v1/runner/ws";
      console.log(`[Runner] Connecting to ${wsUrl}...`);

      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        console.log("[Runner] Connected to server, awaiting challenge...");
      });

      this.ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString()) as RunnerMessage;

          if (msg.type === "CHALLENGE") {
            const { nonce } = msg.payload;
            console.log("[Runner] Received challenge, responding with device auth...");

            // Authenticate with server
            const authMsg: RunnerMessage = {
              type: "AUTH_REQUEST",
              deviceId: this.config.deviceId,
              timestamp: new Date().toISOString(),
              payload: {
                deviceId: this.config.deviceId,
                nonce,
                signature: "device-auth-signature"
              }
            };
            this.ws?.send(JSON.stringify(authMsg));
          } else if (msg.type === "AUTH_SUCCESS") {
            console.log(`[Runner] Authenticated successfully as device ${this.config.deviceId}`);
            this.startHeartbeat();
            resolve();
          } else if (msg.type === "JOB_DISPATCH") {
            const { contract } = msg.payload;
            console.log(`[Runner] Dispatched job ${contract.jobId}: ${contract.command}`);

            const result = await this.executor.executeContract(contract, (chunk, stream) => {
              this.ws?.send(JSON.stringify({
                type: "JOB_PROGRESS",
                deviceId: this.config.deviceId,
                timestamp: new Date().toISOString(),
                payload: {
                  jobId: contract.jobId,
                  runId: contract.runId,
                  taskId: contract.taskId,
                  chunk,
                  stream
                }
              }));
            });

            this.ws?.send(JSON.stringify({
              type: "JOB_RESULT",
              deviceId: this.config.deviceId,
              timestamp: new Date().toISOString(),
              payload: { result }
            }));
          }
        } catch (err) {
          console.error("[Runner] Error handling message:", err);
        }
      });

      this.ws.on("error", (err) => {
        console.error("[Runner] WebSocket error:", err);
        reject(err);
      });

      this.ws.on("close", () => {
        console.log("[Runner] Disconnected from server");
        this.stopHeartbeat();
      });
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "HEARTBEAT",
          deviceId: this.config.deviceId,
          timestamp: new Date().toISOString(),
          payload: {
            deviceId: this.config.deviceId,
            status: "idle",
            uptimeSeconds: Math.floor(process.uptime())
          }
        }));
      }
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public disconnect(): void {
    this.stopHeartbeat();
    this.ws?.close();
  }
}

