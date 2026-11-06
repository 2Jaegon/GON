#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import child_process from "node:child_process";
import { fileURLToPath } from "node:url";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function buildAgyImageArgs(prompt, tempDir) {
  const args = ["-p", prompt, "--dangerously-skip-permissions"];
  if (tempDir) {
    args.push("--add-dir", tempDir);
  }
  return args;
}

export function parseAgyImageResult(stdoutJson) {
  if (!stdoutJson || typeof stdoutJson !== "string") {
    return null;
  }

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(stdoutJson);
    const convId = parsed.conversationId || parsed.conversation_id;
    if (convId) {
      return { conversationId: String(convId) };
    }
  } catch {
    // Might be multi-line stream
  }

  const lines = stdoutJson.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed);
      const convId = obj.conversationId || obj.conversation_id;
      if (convId) {
        return { conversationId: String(convId) };
      }
    } catch {
      // ignore non-json line
    }
  }

  return null;
}

export function findNewestImage(dirPath, sinceMs = 0) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  let newestFile = null;
  let newestMtime = sinceMs;

  function traverse(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs >= newestMtime) {
              newestMtime = stat.mtimeMs;
              newestFile = fullPath;
            }
          } catch {
            // ignore unreadable files
          }
        }
      }
    }
  }

  traverse(dirPath);
  return newestFile;
}

function formatTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

async function defaultAgyRunner(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = child_process.spawn(cmd, args, {
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command ${cmd} exited with code ${code}: ${stderr || stdout}`));
      } else {
        resolve({ stdout, stderr, exitCode: code });
      }
    });
  });
}

export async function generateImage(opts) {
  const { prompt, outDir, brainBaseDir, runner } = opts;
  if (!prompt || typeof prompt !== "string") {
    throw new Error("Prompt is required for image generation");
  }
  if (!outDir || typeof outDir !== "string") {
    throw new Error("outDir is required for image generation");
  }

  const runFn = runner || defaultAgyRunner;
  const brainDir = brainBaseDir || path.join(os.homedir(), ".gemini", "antigravity", "brain");
  const startTime = Date.now();

  const agyArgs = buildAgyImageArgs(prompt);
  const result = await runFn("agy", agyArgs);

  const parsed = parseAgyImageResult(result.stdout || "");
  let searchDir = brainDir;
  if (parsed && parsed.conversationId) {
    const candidateConvDir = path.join(brainDir, parsed.conversationId);
    if (fs.existsSync(candidateConvDir)) {
      searchDir = candidateConvDir;
    }
  }

  const newestImage = findNewestImage(searchDir, startTime - 5000);
  if (!newestImage) {
    throw new Error(`No generated image found in ${searchDir}`);
  }

  const ext = path.extname(newestImage).toLowerCase() || ".png";
  const fileName = `${formatTimestamp(new Date())}-1${ext}`;
  const gonImagesDir = path.join(outDir, ".gon-images");

  if (!fs.existsSync(gonImagesDir)) {
    fs.mkdirSync(gonImagesDir, { recursive: true });
  }

  const targetPath = path.join(gonImagesDir, fileName);
  fs.copyFileSync(newestImage, targetPath);

  return {
    path: `.gon-images/${fileName}`,
    via: "agy",
  };
}

// CLI entry point
const isDirectCall = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectCall) {
  (async () => {
    try {
      const args = process.argv.slice(2);
      let outDir = process.cwd();
      let prompt = "";

      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--out" && args[i + 1]) {
          outDir = path.resolve(args[i + 1]);
          i++;
        } else if (!prompt) {
          prompt = args[i];
        }
      }

      if (!prompt) {
        console.error("Usage: node tools/gen-image.mjs [--out <dir>] <prompt>");
        process.exit(1);
      }

      const res = await generateImage({ prompt, outDir });
      console.log(JSON.stringify(res));
      process.exit(0);
    } catch (err) {
      console.error(JSON.stringify({ error: err.message || String(err) }));
      process.exit(1);
    }
  })();
}
