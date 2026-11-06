import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { FastifyInstance } from "fastify";
import { IDatabase } from "@aso/database";
import { RedeemPairingDTOSchema, GrantPathDTOSchema, toRunnerView } from "@aso/contracts";
import { RunnerGateway } from "../services/runner-gateway.js";

export type LocalFolderPickResult =
  | { path: string }
  | { cancelled: true }
  | { unsupported: true };

const POWERSHELL_LOCAL_FOLDER_PICKER_SCRIPT = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
  "Add-Type -AssemblyName System.Windows.Forms;",
  "[System.Windows.Forms.Application]::EnableVisualStyles();",
  "$top = New-Object System.Windows.Forms.Form;",
  "$top.TopMost = $true;",
  "$top.StartPosition = 'CenterScreen';",
  "$top.Width = 1; $top.Height = 1;",
  "$top.ShowInTaskbar = $false;",
  "$top.Opacity = 0;",
  "$top.Show();",
  "$top.Activate();",
  "$f = New-Object System.Windows.Forms.FolderBrowserDialog;",
  "$f.ShowNewFolderButton = $true;",
  "if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {",
  "  Write-Output $f.SelectedPath",
  "}",
  "$top.Close();"
].join(" ");

export function defaultLocalFolderPicker(): Promise<LocalFolderPickResult> {
  if (process.platform !== "win32") {
    return Promise.resolve({ unsupported: true });
  }
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", POWERSHELL_LOCAL_FOLDER_PICKER_SCRIPT],
      { encoding: "utf8", windowsHide: false },
      (_err, stdout) => {
        const out = (stdout || "").trim();
        if (!out) {
          resolve({ cancelled: true });
        } else {
          resolve({ path: out });
        }
      }
    );
  });
}

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
      ));
      if (!cleaned.includes(normalized)) {
        cleaned.push(normalized);
      }
      cfg.allowedPaths = cleaned;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
    }
  } catch {}
}

export async function runnerRoutes(
  server: FastifyInstance,
  options: {
    db: IDatabase;
    runnerGateway?: RunnerGateway;
    localFolderPicker?: () => Promise<LocalFolderPickResult>;
  }
) {
  const { db, runnerGateway } = options;
  const pickLocal = options.localFolderPicker || defaultLocalFolderPicker;

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
        authSecret: device.authSecret,
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
    return { items: list.map(toRunnerView) };
  });

  // Get allowed workspace paths for a runner device
  server.get("/api/v1/workspaces/:workspaceId/runners/:deviceId/paths", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const found = await db.runners.findById(deviceId);
    if (!found) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }
    const device = toRunnerView(found);
    const allowed = (device.allowedPaths && device.allowedPaths.length > 0)
      ? Array.from(new Set(device.allowedPaths.map(normalizePath)))
      : [];
    const active = device.activePath
      ? normalizePath(device.activePath)
      : (allowed[0] || null);

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

    const updatedDevice = await db.runners.addAllowedPath(deviceId, resolved, dto.setAsActive ?? true);
    if (!updatedDevice) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }
    const updated = toRunnerView(updatedDevice);

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

    const updatedDevice = await db.runners.setActivePath(deviceId, resolved);
    if (!updatedDevice) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }
    const updated = toRunnerView(updatedDevice);

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
    const updatedDevice = await db.runners.removeAllowedPath(deviceId, clean);
    if (!updatedDevice) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }
    const updated = toRunnerView(updatedDevice);

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

  // Pick folder from runner device via OS native dialog
  server.post("/api/v1/workspaces/:workspaceId/runners/:deviceId/pick-folder", async (req, reply) => {
    const { workspaceId, deviceId } = req.params as { workspaceId: string; deviceId: string };
    const device = await db.runners.findById(deviceId);
    if (!device || device.workspaceId !== workspaceId) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Runner device not found" } });
    }

    if (!runnerGateway) {
      return reply.status(409).send({ error: { code: "RUNNER_OFFLINE", message: "PC의 러너를 켜 주세요" } });
    }

    const outcome = await runnerGateway.requestFolderPick(deviceId);
    if (outcome.status === "picked") {
      const cleanPath = normalizePath(outcome.path);
      syncLocalRunnerAllowedPath(cleanPath);
      const updatedDevice = await db.runners.addAllowedPath(deviceId, cleanPath, true);
      const updated = updatedDevice ? toRunnerView(updatedDevice) : null;
      return reply.status(200).send({
        activePath: cleanPath,
        allowedPaths: updated ? updated.allowedPaths : [cleanPath]
      });
    }

    if (outcome.status === "cancelled") {
      return reply.status(200).send({ cancelled: true });
    }

    if (outcome.status === "offline") {
      return reply.status(409).send({ error: { code: "RUNNER_OFFLINE", message: "PC의 러너를 켜 주세요" } });
    }

    if (outcome.status === "unsupported") {
      return reply.status(422).send({ error: { code: "UNSUPPORTED_PLATFORM", message: "이 OS에서는 아직 폴더 창을 못 띄워요" } });
    }

    return reply.status(504).send({ error: { code: "TIMEOUT", message: "폴더 선택 시간이 초과되었어요" } });
  });

  // Pick folder directly on local host machine (auto-provisions local host runner if none exists)
  server.post("/api/v1/workspaces/:workspaceId/pick-local-folder", async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const result = await pickLocal();

    if ("unsupported" in result) {
      return reply.status(422).send({ error: { code: "UNSUPPORTED_PLATFORM", message: "이 OS에서는 아직 폴더 창을 못 띄워요" } });
    }

    if ("cancelled" in result) {
      return reply.status(200).send({ cancelled: true });
    }

    const cleanPath = normalizePath(result.path);
    syncLocalRunnerAllowedPath(cleanPath);

    let list = await db.runners.listForWorkspace(workspaceId);
    let targetDevice = list[0];
    if (!targetDevice) {
      const pairing = await db.runners.createPairingCode(workspaceId, (req as any).user?.id || "00000000-0000-0000-0000-000000000001");
      targetDevice = await db.runners.redeemPairingCode(
        pairing.pairingCode,
        `${os.hostname() || "Local-PC"} (로컬 호스트)`,
        "local-host-native-runner-key"
      );
      await db.runners.updateStatus(targetDevice.id, "online");
    }

    const updatedDevice = await db.runners.addAllowedPath(targetDevice.id, cleanPath, true);
    const updated = updatedDevice ? toRunnerView(updatedDevice) : toRunnerView(targetDevice);

    return reply.status(200).send({
      device: updated,
      activePath: cleanPath,
      allowedPaths: updated.allowedPaths || [cleanPath]
    });
  });

  // Browse local directories on host machine for built-in Web Folder Explorer
  server.get("/api/v1/workspaces/:workspaceId/local-dirs", async (req, reply) => {
    const query = (req.query || {}) as { path?: string };
    const home = os.homedir();
    const cwd = process.cwd();
    const rawTarget = (query.path || "").trim() || cwd || home;

    let resolvedTarget: string;
    try {
      resolvedTarget = path.resolve(rawTarget);
      if (!fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isDirectory()) {
        return reply.status(400).send({
          error: { code: "INVALID_DIRECTORY", message: "존재하지 않는 폴더 경로예요." }
        });
      }
    } catch {
      return reply.status(400).send({
        error: { code: "INVALID_DIRECTORY", message: "폴더 경로를 읽을 수 없어요." }
      });
    }

    const currentNormalized = normalizePath(resolvedTarget);
    const parentResolved = path.dirname(resolvedTarget);
    const parentNormalized = parentResolved !== resolvedTarget ? normalizePath(parentResolved) : null;

    const directories: { name: string; path: string }[] = [];
    try {
      const entries = fs.readdirSync(resolvedTarget, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith("$") || entry.name === "System Volume Information") continue;
        const fullPath = normalizePath(path.join(resolvedTarget, entry.name));
        directories.push({ name: entry.name, path: fullPath });
      }
      directories.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    } catch {
      // ignore permission errors on individual folders
    }

    const candidateShortcuts = [
      { label: "현재 프로젝트", path: cwd },
      { label: "바탕화면", path: path.join(home, "Desktop") },
      { label: "문서", path: path.join(home, "Documents") },
      { label: "다운로드", path: path.join(home, "Downloads") },
      { label: "홈 폴더", path: home }
    ];

    const shortcuts = candidateShortcuts
      .filter((s) => {
        try {
          return fs.existsSync(s.path) && fs.statSync(s.path).isDirectory();
        } catch {
          return false;
        }
      })
      .map((s) => ({ label: s.label, path: normalizePath(s.path) }));

    return reply.status(200).send({
      currentPath: currentNormalized,
      parentPath: parentNormalized,
      directories,
      shortcuts
    });
  });

  // Select a local directory directly by path (auto-provisions local host runner if none exists)
  server.post("/api/v1/workspaces/:workspaceId/select-local-folder", async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = (req.body || {}) as { path?: string };
    const rawPath = (body.path || "").trim();

    if (!rawPath) {
      return reply.status(400).send({
        error: { code: "BAD_REQUEST", message: "폴더 경로를 입력해 주세요." }
      });
    }

    let resolvedPath: string;
    try {
      resolvedPath = path.resolve(rawPath);
      if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        return reply.status(400).send({
          error: { code: "INVALID_DIRECTORY", message: "해당 경로의 폴더를 찾을 수 없어요." }
        });
      }
    } catch {
      return reply.status(400).send({
        error: { code: "INVALID_DIRECTORY", message: "유효하지 않은 폴더 경로예요." }
      });
    }

    const cleanPath = normalizePath(resolvedPath);
    syncLocalRunnerAllowedPath(cleanPath);

    const list = await db.runners.listForWorkspace(workspaceId);
    let targetDevice = list[0];
    if (!targetDevice) {
      const pairing = await db.runners.createPairingCode(
        workspaceId,
        (req as any).user?.id || "00000000-0000-0000-0000-000000000001"
      );
      targetDevice = await db.runners.redeemPairingCode(
        pairing.pairingCode,
        `${os.hostname() || "Local-PC"} (로컬 호스트)`,
        "local-host-native-runner-key"
      );
      await db.runners.updateStatus(targetDevice.id, "online");
    }

    const updatedDevice = await db.runners.addAllowedPath(targetDevice.id, cleanPath, true);
    const updated = updatedDevice ? toRunnerView(updatedDevice) : toRunnerView(targetDevice);

    return reply.status(200).send({
      device: updated,
      activePath: cleanPath,
      allowedPaths: updated.allowedPaths || [cleanPath]
    });
  });
}
