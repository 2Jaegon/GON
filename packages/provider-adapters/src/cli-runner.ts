import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export type CliRunner = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number }
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

export const defaultCliRunner: CliRunner = async (cmd, args, opts) => {
  const resolved = await resolveCliCommand(cmd);
  const pending = execFileAsync(resolved.cmd, [...resolved.prefixArgs, ...args], {
    cwd: opts.cwd,
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
