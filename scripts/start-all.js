import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

console.log("=== ASO Web & API Server Starting ===");

const apiProcess = spawn(process.execPath, [path.join(rootDir, "apps/api/dist/index.js")], {
  stdio: "inherit",
  env: { ...process.env, PORT: "4000", HOST: "127.0.0.1" }
});

const webProcess = spawn(process.execPath, [path.join(rootDir, "apps/web/dist/server.js")], {
  stdio: "inherit",
  env: { ...process.env, WEB_PORT: "3000", HOST: "127.0.0.1" }
});

const cleanExit = () => {
  apiProcess.kill();
  webProcess.kill();
  process.exit();
};

process.on("SIGINT", cleanExit);
process.on("SIGTERM", cleanExit);

