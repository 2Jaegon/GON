import fs from "node:fs";
import path from "node:path";
import { createApiServer } from "./server.js";

// Load .env file if present
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(envPath);
  }
} catch {
  // ignore
}

const PORT = parseInt(process.env.PORT || "4000", 10);
const HOST = process.env.HOST || "127.0.0.1";

async function main() {
  const { server } = await createApiServer({ logger: true });

  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`[ASO API] Server listening at http://${HOST}:${PORT}`);
  } catch (err) {
    console.error("[ASO API] Startup error:", err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test") {
  main();
}

export * from "./server.js";

