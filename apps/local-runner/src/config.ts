import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface RunnerLocalConfig {
  deviceId: string;
  workspaceId: string;
  deviceName: string;
  secretKey: string;
  serverUrl: string;
  allowedPaths: string[];
}

export function getConfigDir(): string {
  return path.join(os.homedir(), ".aso-runner");
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function loadRunnerConfig(): RunnerLocalConfig | null {
  const file = getConfigFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function saveRunnerConfig(cfg: RunnerLocalConfig): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getConfigFilePath(), JSON.stringify(cfg, null, 2), "utf8");
}

