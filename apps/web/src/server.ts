import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "../public");

const PORT = parseInt(process.env.WEB_PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";

export async function createWebServer() {
  const server = Fastify({ logger: false });

  server.get("/*", async (req, reply) => {
    let reqPath = req.url.split("?")[0];
    if (reqPath === "/" || reqPath === "") {
      reqPath = "/index.html";
    }

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(reqPath);
    } catch {
      return reply.code(404).send("Not Found");
    }

    if (decodedPath.includes("\\") || decodedPath.includes("\0")) {
      return reply.code(404).send("Not Found");
    }

    const filePath = path.resolve(PUBLIC_DIR, "." + decodedPath);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
      return reply.code(404).send("Not Found");
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      const fallback = path.join(PUBLIC_DIR, "index.html");
      const html = fs.readFileSync(fallback, "utf8");
      return reply.type("text/html; charset=utf-8").send(html);
    }

    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath);

    if (ext === ".html") reply.type("text/html; charset=utf-8");
    else if (ext === ".css") reply.type("text/css; charset=utf-8");
    else if (ext === ".js") reply.type("application/javascript; charset=utf-8");
    else if (ext === ".json") reply.type("application/json; charset=utf-8");
    else if (ext === ".svg") reply.type("image/svg+xml");

    return reply.send(content);
  });

  return server;
}

if (process.env.NODE_ENV !== "test") {
  const server = await createWebServer();
  await server.listen({ port: PORT, host: HOST });
  console.log(`[ASO Web] UI running at http://${HOST}:${PORT}`);
}

