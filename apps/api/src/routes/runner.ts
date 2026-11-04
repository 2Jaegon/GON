import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FastifyInstance } from "fastify";
import { IDatabase } from "@aso/database";
import { RedeemPairingDTOSchema, GrantPathDTOSchema } from "@aso/contracts";
import { RunnerGateway } from "../services/runner-gateway.js";

function normalizePath(rawPath: string): string {
  if (!rawPath) return "";
  const resolved = path.resolve(rawPath);
  return resolved.replace(/\\+/g, "/");
}

function syncLocalRunnerAllowedPath(dirPath: string) {
  try {
    const cfgPath = path.join(os.homedir(), ".aso-runner", "config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (!cfg.allowedPaths) cfg.allowedPaths = [];
      const normalized = normalizePath(dirPath);
      const cleaned = Array.from(new Set(
        cfg.allowedPaths
          .map((p: string) => normalizePath(p))
          .filter((p: string) => !p.includes("UsersaicamDesktop"))
      ));
      if (!cleaned.includes(normalized)) {
        cleaned.push(normalized);
      }
      cfg.allowedPaths = cleaned;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
    }
  } catch {}
}

export async function runnerRoutes(server: FastifyInstance, options: { db: IDatabase; runnerGateway?: RunnerGateway }) {
  const { db, runnerGateway } = options;

  // Issue pairing code
  server.post("/api/v1/workspaces/:workspaceId/runner-pairings", async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const pairing = await db.runners.createPairingCode(workspaceId, "00000000-0000-0000-0000-000000000001");
    return reply.status(201).send(pairing);
  });

  // Redeem pairing code (called by local runner CLI)
  server.post("/api/v1/runner/pairings/redeem", async (req, reply) => {
    const dto = RedeemPairingDTOSchema.parse(req.body);
    try {
      const device = await db.runners.redeemPairingCode(dto.pairingCode, dto.deviceName, dto.publicKey);
      return reply.status(200).send({
        deviceId: device.id,
        workspaceId: device.workspaceId,
        status: device.status,
        allowedPaths: device.allowedPaths,
        activePath: device.activePath,
        message: "Runner device successfully registered and paired"
      });
    } catch (err: any) {
      return reply.status(400).send({ error: { code: "PAIRING_FAILED", message: err.message } });
    }
  });

  // List runner devices
  server.get("/api/v1/workspaces/:workspaceId/runners", async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const list = await db.runners.listForWorkspace(workspaceId);
    return { items: list };
  });

  // Get allowed workspace paths for a runner device
  server.get("/api/v1/workspaces/:workspaceId/runners/:deviceId/paths", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const device = await db.runners.findById(deviceId);
    if (!device) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }
    const currentCwd = normalizePath(process.cwd());
    const allowed = (device.allowedPaths && device.allowedPaths.length > 0)
      ? Array.from(new Set(device.allowedPaths.map(normalizePath).filter((p: string) => !p.includes("UsersaicamDesktop"))))
      : [currentCwd];
    const active = device.activePath && !device.activePath.includes("UsersaicamDesktop")
      ? normalizePath(device.activePath)
      : (allowed[0] || currentCwd);

    return {
      deviceId: device.id,
      deviceName: device.name,
      allowedPaths: allowed,
      activePath: active
    };
  });

  // Grant / add a workspace directory on the registered runner
  server.post("/api/v1/workspaces/:workspaceId/runners/:deviceId/paths", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const dto = GrantPathDTOSchema.parse(req.body);
    const resolved = normalizePath(dto.path);

    // Sync to local runner agent config
    syncLocalRunnerAllowedPath(resolved);

    const updated = await db.runners.addAllowedPath(deviceId, resolved, dto.setAsActive ?? true);
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }

    return reply.status(200).send({
      deviceId: updated.id,
      deviceName: updated.name,
      allowedPaths: updated.allowedPaths,
      activePath: updated.activePath,
      message: `Granted workspace path: ${resolved}`
    });
  });

  // Set the active workspace directory for runs
  server.post("/api/v1/workspaces/:workspaceId/runners/:deviceId/active-path", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const dto = GrantPathDTOSchema.parse(req.body);
    const resolved = normalizePath(dto.path);

    syncLocalRunnerAllowedPath(resolved);

    const updated = await db.runners.setActivePath(deviceId, resolved);
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }

    return reply.status(200).send({
      deviceId: updated.id,
      deviceName: updated.name,
      allowedPaths: updated.allowedPaths,
      activePath: updated.activePath
    });
  });

  // Remove an allowed workspace directory from a runner
  server.delete("/api/v1/workspaces/:workspaceId/runners/:deviceId/paths", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const { path: dirPath } = (req.body || {}) as { path: string };
    if (!dirPath) {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Path is required" } });
    }
    const clean = normalizePath(dirPath);
    const updated = await db.runners.removeAllowedPath(deviceId, clean);
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }

    // Sync to local runner config
    try {
      const cfgPath = path.join(os.homedir(), ".aso-runner", "config.json");
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (cfg.allowedPaths) {
          cfg.allowedPaths = cfg.allowedPaths.filter((p: string) => normalizePath(p) !== clean);
          fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
        }
      }
    } catch {}

    return reply.status(200).send({
      deviceId: updated.id,
      deviceName: updated.name,
      allowedPaths: updated.allowedPaths,
      activePath: updated.activePath
    });
  });

  // Delete / unregister a runner device
  server.delete("/api/v1/workspaces/:workspaceId/runners/:deviceId", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };

    // Disconnect websocket if connected
    runnerGateway?.disconnectRunner(deviceId);

    // If ~/.aso-runner/config.json matches this deviceId, clean it up
    try {
      const cfgPath = path.join(os.homedir(), ".aso-runner", "config.json");
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (cfg.deviceId === deviceId) {
          fs.unlinkSync(cfgPath);
        }
      }
    } catch {}

    const deleted = await db.runners.delete(deviceId);
    if (!deleted) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }

    return reply.status(200).send({
      success: true,
      deviceId,
      message: "Runner device successfully deleted and unregistered"
    });
  });
}
