#!/usr/bin/env node
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { loadRunnerConfig, saveRunnerConfig, getConfigFilePath } from "./config.js";
import { RunnerClient } from "./client.js";

const program = new Command();

program
  .name("aso-runner")
  .description("ASO Local Runner Agent for secure on-device task execution")
  .version("0.1.0");

program
  .command("pair <code>")
  .description("Pair this local device with an ASO Web workspace using a pairing code")
  .option("-s, --server <url>", "ASO API server URL", "http://127.0.0.1:4000")
  .option("-n, --name <name>", "Device name", `${os.hostname()}-${os.platform()}`)
  .action(async (code, options) => {
    try {
      console.log(`[Pairing] Redeeming code ${code} with server ${options.server}...`);
      const keyPair = crypto.generateKeyPairSync("ed25519");
      const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

      const response = await fetch(`${options.server}/api/v1/runner/pairings/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairingCode: code,
          deviceName: options.name,
          publicKey
        })
      });

      if (!response.ok) {
        const errJson = await response.json();
        console.error("[Pairing Error]:", errJson.error?.message || response.statusText);
        process.exit(1);
      }

      const data = await response.json();
      const secretKey = crypto.randomBytes(32).toString("hex");

      saveRunnerConfig({
        deviceId: data.deviceId,
        workspaceId: data.workspaceId,
        deviceName: options.name,
        secretKey,
        serverUrl: options.server,
        allowedPaths: [process.cwd()]
      });

      console.log(`✔ Successfully paired! Device ID: ${data.deviceId}`);
      console.log(`✔ Config saved to ${getConfigFilePath()}`);
      console.log(`✔ Granted workspace path: ${process.cwd()}`);
    } catch (err: any) {
      console.error("[Pairing Failed]:", err.message);
      process.exit(1);
    }
  });

program
  .command("grant <dir>")
  .description("Authorize a local directory path for task execution")
  .action((dir) => {
    const cfg = loadRunnerConfig();
    if (!cfg) {
      console.error("Runner is not paired yet. Run 'aso-runner pair <code>' first.");
      process.exit(1);
    }
    const resolved = path.resolve(dir);
    if (!cfg.allowedPaths.includes(resolved)) {
      cfg.allowedPaths.push(resolved);
      saveRunnerConfig(cfg);
      console.log(`✔ Granted access to path: ${resolved}`);
    } else {
      console.log(`Path already granted: ${resolved}`);
    }
  });

program
  .command("start")
  .description("Start the runner and connect to ASO Web API")
  .option("-s, --server <url>", "Override server URL")
  .action(async (options) => {
    let cfg = loadRunnerConfig();
    if (!cfg) {
      // In development, create auto-paired local config if missing
      console.log("[Notice] No pairing found. Auto-configuring dev local runner...");
      cfg = {
        deviceId: crypto.randomUUID(),
        workspaceId: "00000000-0000-0000-0000-000000000002",
        deviceName: `${os.hostname()}-dev`,
        secretKey: "dev-runner-secret-key-32-bytes",
        serverUrl: options.server || "http://127.0.0.1:4000",
        allowedPaths: [process.cwd()]
      };
      saveRunnerConfig(cfg);
    }

    if (options.server) {
      cfg.serverUrl = options.server;
    }

    console.log(`[ASO Runner] Starting device: ${cfg.deviceName} (${cfg.deviceId})`);
    console.log(`[ASO Runner] Allowed paths: ${cfg.allowedPaths.join(", ")}`);

    const client = new RunnerClient(cfg);
    try {
      await client.connect();
    } catch (err: any) {
      console.error("[ASO Runner] Connection failed:", err.message);
    }
  });

program
  .command("status")
  .description("Show local runner pairing and configuration status")
  .action(() => {
    const cfg = loadRunnerConfig();
    if (!cfg) {
      console.log("Status: Not paired");
      return;
    }
    console.log("Status: Paired");
    console.log(`Device ID: ${cfg.deviceId}`);
    console.log(`Device Name: ${cfg.deviceName}`);
    console.log(`Server URL: ${cfg.serverUrl}`);
    console.log(`Allowed Paths:`);
    for (const p of cfg.allowedPaths) {
      console.log(`  - ${p}`);
    }
  });

program.parse(process.argv);

