import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { ClaudeProvider, resolveCliCommand } from "@aso/provider-adapters";

const RID = randomUUID();
const WID = randomUUID();

const CLAUDE_SHIM = `"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*`;
const CODEX_SHIM = `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*`;
const NPM = "C:\\Users\\aicam\\AppData\\Roaming\\npm";

describe("ClaudeProvider", () => {
  it("passes model, effort and cwd as separate args", async () => {
    const calls: any[] = [];
    const p = new ClaudeProvider(async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { stdout: '{"result":"hi"}', stderr: "" };
    });
    const r = await p.executeChat({
      runId: RID,
      workspaceId: WID,
      prompt: 'a "b" & c | $(d)\nnext',
      model: "opus",
      effort: "high",
      cwd: "C:\\x\\수업"
    });
    expect(calls[0].cmd).toBe("claude");
    expect(calls[0].args).toEqual(["-p", "--output-format", "json", "--model", "opus", "--effort", "high", "--", 'a "b" & c | $(d)\nnext']);
    expect(calls[0].opts.cwd).toBe("C:\\x\\수업");
    expect(r.output).toBe("hi");
    expect(r.usage.model).toBe("opus");
  });

  it("omits model/effort flags and reports null model when not given", async () => {
    const calls: any[] = [];
    const p = new ClaudeProvider(async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { stdout: '{"result":"hi"}', stderr: "" };
    });
    const r = await p.executeChat({ runId: RID, workspaceId: WID, prompt: "x" });
    expect(calls[0].args).toEqual(["-p", "--output-format", "json", "--", "x"]);
    expect(r.usage.model).toBeNull();
  });

  it("keeps a flag-like prompt after '--' so it is never parsed as an option", async () => {
    const calls: any[] = [];
    const p = new ClaudeProvider(async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { stdout: '{"result":"hi"}', stderr: "" };
    });
    await p.executeChat({ runId: RID, workspaceId: WID, prompt: "--version", model: "opus" });
    const args: string[] = calls[0].args;
    const sep = args.indexOf("--");
    expect(args[sep + 1]).toBe("--version");
    expect(args.slice(0, sep)).not.toContain("--version");
    expect(args[args.length - 1]).toBe("--version");
  });

  it("still maps usage_limit_reached errors carrying stdout", async () => {
    const p = new ClaudeProvider(async () => {
      const err: any = new Error("exit 1");
      err.stdout = JSON.stringify({ is_error: true, api_error: "usage_limit_reached", result: "한도" });
      throw err;
    });
    const r = await p.executeChat({ runId: RID, workspaceId: WID, prompt: "x", model: "opus" });
    expect(r.output).toContain("한도");
    expect(r.usage.source).toBe("claude-rate-limit");
    expect(r.usage.model).toBe("opus");
  });

  it("execute() uses the runner with model, effort and cwd", async () => {
    const calls: any[] = [];
    const p = new ClaudeProvider(async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { stdout: '{"result":"done"}', stderr: "" };
    });
    const r = await p.execute({
      runId: RID,
      workspaceId: WID,
      task: { id: randomUUID(), taskKey: "t-1", title: "T", capabilityRequirements: ["code"] } as any,
      model: "sonnet",
      effort: "low",
      cwd: "C:\\proj"
    });
    expect(calls[0].cmd).toBe("claude");
    expect(calls[0].args.slice(0, -1)).toEqual(["-p", "--output-format", "json", "--model", "sonnet", "--effort", "low", "--"]);
    expect(calls[0].opts.cwd).toBe("C:\\proj");
    expect(r.output).toBe("done");
    expect(r.usage.model).toBe("sonnet");
  });
});

describe("resolveCliCommand", () => {
  it("returns the name unchanged on non-win32", async () => {
    expect(await resolveCliCommand("claude", "linux")).toEqual({ cmd: "claude", prefixArgs: [] });
  });

  it("prefers a .exe found by where", async () => {
    const r = await resolveCliCommand("agy", "win32", { where: async () => ["C:\\bin\\agy.exe"], readShim: () => "" });
    expect(r).toEqual({ cmd: "C:\\bin\\agy.exe", prefixArgs: [] });
  });

  it("resolves a .cmd shim pointing to a .exe", async () => {
    const r = await resolveCliCommand("claude", "win32", {
      where: async () => [`${NPM}\\claude`, `${NPM}\\claude.cmd`],
      readShim: (p) => (p === `${NPM}\\claude.cmd` ? `@ECHO off\r\n${CLAUDE_SHIM}\r\n` : "")
    });
    expect(r).toEqual({ cmd: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`, prefixArgs: [] });
  });

  it("resolves a .cmd shim pointing to a .js via node", async () => {
    const r = await resolveCliCommand("codex", "win32", {
      where: async () => [`${NPM}\\codex`, `${NPM}\\codex.cmd`],
      readShim: () => `@ECHO off\r\n${CODEX_SHIM}\r\n`
    });
    expect(r.cmd).toBe(process.execPath);
    expect(r.prefixArgs).toEqual([`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`]);
  });

  it("throws on win32 when nothing resolves, and does not cache the failure", async () => {
    const empty = { where: async () => [] as string[], readShim: () => "" };
    await expect(resolveCliCommand("nope-cli", "win32", empty)).rejects.toThrow("CLI not found: nope-cli");
    const unparsable = { where: async () => [`${NPM}\\x.cmd`], readShim: () => "@echo off\r\nsomething else\r\n" };
    await expect(resolveCliCommand("x", "win32", unparsable)).rejects.toThrow("CLI not found: x");
  });
});
