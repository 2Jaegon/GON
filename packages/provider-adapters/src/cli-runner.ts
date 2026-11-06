import { ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export type CliRunner = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number; onDelta?: (delta: string, fullText: string) => void }
) => Promise<{ stdout: string; stderr: string }>;

export interface ResolvedCli {
  cmd: string;
  prefixArgs: string[];
}

export interface ResolveCliIo {
  where: (name: string) => Promise<string[]>;
  readShim: (file: string) => string;
}

const defaultIo: ResolveCliIo = {
  where: async (name) => {
    try {
      const { stdout } = await execFileAsync("where", [name], { windowsHide: true, encoding: "utf8" });
      return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  },
  readShim: (file) => readFileSync(file, "utf8")
};

const cache = new Map<string, ResolvedCli>();

/**
 * Windows npm shims (`.cmd`) cannot run via execFile without a shell, and running them through a shell
 * would re-parse the arguments. So find the real target (`.exe`, or `.js` run with node) instead.
 */
export async function resolveCliCommand(
  name: string,
  platform: NodeJS.Platform = process.platform,
  io?: ResolveCliIo
): Promise<ResolvedCli> {
  if (platform !== "win32") return { cmd: name, prefixArgs: [] };
  const useCache = !io;
  const hit = useCache ? cache.get(name) : undefined;
  if (hit) return hit;

  const { where, readShim } = io ?? defaultIo;
  const found = await where(name);
  const resolved = resolveFromWhere(name, found, readShim);
  if (useCache) cache.set(name, resolved);
  return resolved;
}

function resolveFromWhere(name: string, found: string[], readShim: (file: string) => string): ResolvedCli {
  const exe = found.find((f) => /\.exe$/i.test(f));
  if (exe) return { cmd: exe, prefixArgs: [] };

  const shim = found.find((f) => /\.cmd$/i.test(f));
  if (shim) {
    try {
      const lastLine = readShim(shim).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
      const rel = /"%dp0%\\([^"]+)"/i.exec(lastLine)?.[1];
      if (rel) {
        const target = path.win32.join(path.win32.dirname(shim), rel);
        if (/\.exe$/i.test(target)) return { cmd: target, prefixArgs: [] };
        if (/\.js$/i.test(target)) return { cmd: process.execPath, prefixArgs: [target] };
      }
    } catch {
      // unparsable shim: handled below
    }
  }
  // Never fall back to the bare name on Windows: the child's cwd is searched before PATH.
  throw new Error(`CLI not found: ${name}`);
}

const AGY_TEXT_ONLY_NOTE =
  "[중요: 도구(read_file, view_file, run_command 등)를 절대 호출하지 말고 텍스트로만 즉시 답하세요. 전역 규칙(GON.md 등)의 파일 읽기도 생략하세요.]\n\n";

let sharedEmptyChatDir: string | null = null;
function getEmptyChatDir(): string {
  if (!sharedEmptyChatDir || !existsSync(sharedEmptyChatDir)) {
    sharedEmptyChatDir = mkdtempSync(path.join(os.tmpdir(), "gon-chat-empty-"));
  }
  return sharedEmptyChatDir;
}

interface WarmAgyWorker {
  modelKey: string;
  child: ChildProcess;
  alive: boolean;
  stdoutLines: string[];
  stderrChunks: string[];
  onLine: ((line: string) => void) | null;
  onClose: ((code: number | null) => void) | null;
  idleTimer: NodeJS.Timeout;
}

const warmAgyPool = new Map<string, WarmAgyWorker>();

function killWarmWorker(worker: WarmAgyWorker) {
  worker.alive = false;
  clearTimeout(worker.idleTimer);
  try {
    worker.child.kill();
  } catch {
    // ignore
  }
}

function spawnWarmAgyWorker(exePath: string, model?: string): WarmAgyWorker {
  const modelKey = model || "__default__";
  const spawnArgs = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--disable-slash-commands",
    ...(model ? ["--model", model] : []),
    "-p="
  ];
  const child = spawn(exePath, spawnArgs, {
    cwd: getEmptyChatDir(),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  const worker: WarmAgyWorker = {
    modelKey,
    child,
    alive: true,
    stdoutLines: [],
    stderrChunks: [],
    onLine: null,
    onClose: null,
    idleTimer: setTimeout(() => {
      if (warmAgyPool.get(modelKey) === worker) {
        warmAgyPool.delete(modelKey);
      }
      killWarmWorker(worker);
    }, 5 * 60 * 1000)
  };
  worker.idleTimer.unref?.();

  let lineBuf = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    lineBuf += chunk;
    const parts = lineBuf.split(/\r?\n/);
    lineBuf = parts.pop() ?? "";
    for (const ln of parts) {
      const trimmed = ln.trim();
      if (!trimmed) continue;
      if (worker.onLine) {
        worker.onLine(trimmed);
      } else {
        worker.stdoutLines.push(trimmed);
      }
    }
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    worker.stderrChunks.push(chunk);
  });

  const handleExit = (code: number | null) => {
    worker.alive = false;
    clearTimeout(worker.idleTimer);
    if (lineBuf.trim()) {
      const rem = lineBuf.trim();
      lineBuf = "";
      if (worker.onLine) worker.onLine(rem);
      else worker.stdoutLines.push(rem);
    }
    if (warmAgyPool.get(modelKey) === worker) {
      warmAgyPool.delete(modelKey);
    }
    worker.onClose?.(code);
  };

  child.on("close", handleExit);
  child.on("error", () => handleExit(1));

  return worker;
}

/**
 * Pre-warms a standby agy.exe process in the background so the ~5s CLI + Language Server
 * cold boot happens before the user submits a chat prompt.
 */
export function prewarmAgyModel(model?: string): void {
  if (process.env.VITEST) return;
  const modelKey = model || "__default__";
  const existing = warmAgyPool.get(modelKey);
  if (existing && existing.alive) return;

  resolveCliCommand("agy")
    .then((resolved) => {
      const current = warmAgyPool.get(modelKey);
      if (current && current.alive) return;
      const worker = spawnWarmAgyWorker(resolved.cmd, model);
      warmAgyPool.set(modelKey, worker);
    })
    .catch(() => {
      // agy not installed or unavailable
    });
}

process.once("exit", () => {
  for (const w of warmAgyPool.values()) {
    killWarmWorker(w);
  }
  warmAgyPool.clear();
});

async function runAgyFastStream(
  exePath: string,
  model: string | undefined,
  prompt: string,
  timeoutMs: number,
  onDelta?: (delta: string, fullText: string) => void
): Promise<{ stdout: string; stderr: string }> {
  const modelKey = model || "__default__";
  let worker = warmAgyPool.get(modelKey);
  if (worker && worker.alive) {
    warmAgyPool.delete(modelKey);
    clearTimeout(worker.idleTimer);
  } else {
    worker = spawnWarmAgyWorker(exePath, model);
  }

  // Immediately pre-warm the next standby worker for subsequent turns
  prewarmAgyModel(model);

  const fullPrompt = prompt.startsWith("[중요:") ? prompt : `${AGY_TEXT_ONLY_NOTE}${prompt}`;

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    let settled = false;
    let accumulated = "";
    let finalResponse = "";

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killWarmWorker(worker!);
      reject(new Error(`Antigravity CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = (finalResponse || accumulated).trim();
      const errText = worker!.stderrChunks.join("").trim();
      if (!out && code && code !== 0) {
        reject(new Error(errText || `agy exited with code ${code}`));
        return;
      }
      resolve({ stdout: out, stderr: errText });
    };

    const processLine = (line: string) => {
      try {
        const ev = JSON.parse(line);
        if (ev.event === "step_update" && typeof ev.step_update?.text_delta === "string") {
          const delta = ev.step_update.text_delta;
          if (delta) {
            accumulated += delta;
            onDelta?.(delta, accumulated);
          }
        } else if (ev.event === "result") {
          if (typeof ev.result?.response === "string") {
            finalResponse = ev.result.response;
          }
          finish(0);
          killWarmWorker(worker!);
        }
      } catch {
        // non-JSON line
      }
    };

    for (const buffered of worker!.stdoutLines.splice(0)) {
      processLine(buffered);
      if (settled) return;
    }

    worker!.onLine = processLine;
    worker!.onClose = finish;

    try {
      worker!.child.stdin?.write(JSON.stringify({ event: "user", message: { content: fullPrompt } }) + "\n");
      worker!.child.stdin?.end();
    } catch (err) {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    }
  });
}

export const defaultCliRunner: CliRunner = async (cmd, args, opts) => {
  const resolved = await resolveCliCommand(cmd);
  let effectiveArgs = args;
  let effectiveCwd = opts.cwd;

  if (cmd === "agy" && args[0] === "-p") {
    const sepIdx = args.indexOf("--");
    if (sepIdx >= 1 && sepIdx + 1 < args.length) {
      const flags = args.slice(1, sepIdx);
      const modelIdx = flags.indexOf("--model");
      const model = modelIdx !== -1 && modelIdx + 1 < flags.length ? flags[modelIdx + 1] : undefined;
      const prompt = args.slice(sepIdx + 1).join(" ");
      return runAgyFastStream(resolved.cmd, model, prompt, opts.timeoutMs, opts.onDelta);
    }
  } else if (cmd === "claude" && args[0] === "-p") {
    effectiveCwd = getEmptyChatDir();
    const sepIdx = args.indexOf("--");
    if (sepIdx >= 1) {
      const beforeSep = args.slice(0, sepIdx);
      const afterSep = args.slice(sepIdx);
      const fastFlags: string[] = [];
      if (!beforeSep.includes("--tools")) fastFlags.push("--tools", "");
      if (!beforeSep.includes("--strict-mcp-config")) fastFlags.push("--strict-mcp-config");
      if (!beforeSep.includes("--disable-slash-commands")) fastFlags.push("--disable-slash-commands");
      if (!beforeSep.includes("--no-session-persistence")) fastFlags.push("--no-session-persistence");
      if (!beforeSep.includes("--setting-sources")) fastFlags.push("--setting-sources", "");
      if (!beforeSep.includes("--effort")) fastFlags.push("--effort", "low");
      effectiveArgs = [...beforeSep, ...fastFlags, ...afterSep];
    }
  } else if (cmd === "codex" && args[0] === "exec" && args.includes("read-only")) {
    effectiveCwd = getEmptyChatDir();
    const sepIdx = args.indexOf("--");
    if (sepIdx >= 1 && !args.includes("--ephemeral")) {
      effectiveArgs = [...args.slice(0, sepIdx), "--ephemeral", ...args.slice(sepIdx)];
    }
  }

  const pending = execFileAsync(resolved.cmd, [...resolved.prefixArgs, ...effectiveArgs], {
    cwd: effectiveCwd,
    timeout: opts.timeoutMs,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false
  });
  // The CLI must not wait for input on an open stdin pipe during non-interactive calls.
  if (!args.includes("login")) {
    pending.child.stdin?.end();
  }
  const { stdout, stderr } = await pending;
  return { stdout, stderr };
};
