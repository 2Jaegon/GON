import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  AgyProvider,
  ClaudeProvider,
  CodexProvider,
  MockProvider,
  ProviderCallError,
  ProviderRegistry,
  type CliRunner
} from "@aso/provider-adapters";

const RID = randomUUID();
const WID = randomUUID();

function fakeRunner(stdout: string) {
  const calls: Array<{ cmd: string; args: string[]; opts: { cwd?: string; timeoutMs: number } }> = [];
  const run: CliRunner = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { stdout, stderr: "" };
  };
  return { run, calls };
}

const failingRunner: CliRunner = async () => {
  throw new Error("boom");
};

const task = () => ({ id: randomUUID(), taskKey: "t-1", title: "T", capabilityRequirements: ["code"] }) as any;

describe("AgyProvider", () => {
  it("passes model as a flag before '--' and the prompt last, with cwd", async () => {
    const { run, calls } = fakeRunner("  hello \n");
    const r = await new AgyProvider(run).executeChat({
      runId: RID,
      workspaceId: WID,
      prompt: "hi there",
      model: "gemini-4-argon-high",
      cwd: "C:\\x\\수업"
    });
    expect(calls[0].cmd).toBe("agy");
    expect(calls[0].args).toEqual(["-p", "--model", "gemini-4-argon-high", "--", "hi there"]);
    expect(calls[0].opts.cwd).toBe("C:\\x\\수업");
    expect(r.output).toBe("hello");
    expect(r.usage.provider).toBe("antigravity");
    expect(r.usage.model).toBe("gemini-4-argon-high");
  });

  it("omits --model when no model is given and reports null model", async () => {
    const { run, calls } = fakeRunner("ok");
    const r = await new AgyProvider(run).executeChat({ runId: RID, workspaceId: WID, prompt: "x" });
    expect(calls[0].args).toEqual(["-p", "--", "x"]);
    expect(r.usage.model).toBeNull();
  });

  it("keeps a flag-like prompt after '--'", async () => {
    const { run, calls } = fakeRunner("ok");
    await new AgyProvider(run).executeChat({ runId: RID, workspaceId: WID, prompt: "--version", model: "m" });
    expect(calls[0].args).toEqual(["-p", "--model", "m", "--", "--version"]);
  });

  it("does not report invented token counts", async () => {
    const { run } = fakeRunner("ok");
    const r = await new AgyProvider(run).executeChat({ runId: RID, workspaceId: WID, prompt: "x" });
    expect(r.usage.inputTokens).toBe(0);
    expect(r.usage.outputTokens).toBe(0);
    expect(r.usage.costConfidence).toBe("unavailable");
  });

  it("throws ProviderCallError when the CLI fails", async () => {
    const err = await new AgyProvider(failingRunner)
      .executeChat({ runId: RID, workspaceId: WID, prompt: "ㅎㅇ" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderCallError);
    expect(err.message).toBe("Antigravity 호출에 실패했어요: boom");
    expect(err.message).not.toContain("Gon");
  });

  it("throws ProviderCallError on empty output", async () => {
    const { run } = fakeRunner("   \n");
    const err = await new AgyProvider(run)
      .executeChat({ runId: RID, workspaceId: WID, prompt: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderCallError);
    expect(err.message).toContain("Antigravity 호출에 실패했어요");
    expect(err.message).not.toContain("Gon");
  });

  it("execute() uses the runner with model, cwd and '--' before the prompt", async () => {
    const { run, calls } = fakeRunner("done");
    const r = await new AgyProvider(run).execute({
      runId: RID,
      workspaceId: WID,
      task: task(),
      model: "gemini-4-argon-low",
      cwd: "C:\\proj"
    });
    expect(calls[0].args.slice(0, 4)).toEqual(["-p", "--model", "gemini-4-argon-low", "--"]);
    expect(calls[0].args).toHaveLength(5);
    expect(calls[0].opts.cwd).toBe("C:\\proj");
    expect(r.output).toBe("done");
    expect(r.usage.model).toBe("gemini-4-argon-low");
  });

  it("execute() throws ProviderCallError when the CLI fails", async () => {
    await expect(new AgyProvider(failingRunner).execute({ runId: RID, workspaceId: WID, task: task() })).rejects.toBeInstanceOf(
      ProviderCallError
    );
  });
});

describe("CodexProvider", () => {
  it("builds the read-only chat args with model, prompt last after '--'", async () => {
    const { run, calls } = fakeRunner("answer\n");
    const p = new CodexProvider(run);
    expect(p.name).toBe("codex-provider");
    const r = await p.executeChat({
      runId: RID,
      workspaceId: WID,
      prompt: "hello",
      model: "gpt-5-codex",
      cwd: "C:\\x"
    });
    expect(calls[0].cmd).toBe("codex");
    expect(calls[0].args).toEqual(["exec", "--skip-git-repo-check", "-s", "read-only", "-m", "gpt-5-codex", "--", "hello"]);
    expect(calls[0].opts.cwd).toBe("C:\\x");
    expect(r.output).toBe("answer");
    expect(r.usage).toMatchObject({
      provider: "openai",
      connectionMode: "LOCAL_NATIVE_CLI",
      model: "gpt-5-codex",
      inputTokens: 0,
      outputTokens: 0,
      costConfidence: "unavailable",
      measuredCostUsd: null,
      source: "codex-cli (tokens not measured)"
    });
  });

  it("omits -m without a model and reports null model", async () => {
    const { run, calls } = fakeRunner("a");
    const r = await new CodexProvider(run).executeChat({ runId: RID, workspaceId: WID, prompt: "x" });
    expect(calls[0].args).toEqual(["exec", "--skip-git-repo-check", "-s", "read-only", "--", "x"]);
    expect(r.usage.model).toBeNull();
  });

  it("keeps a flag-like prompt after '--'", async () => {
    const { run, calls } = fakeRunner("a");
    await new CodexProvider(run).executeChat({ runId: RID, workspaceId: WID, prompt: "--version" });
    expect(calls[0].args[calls[0].args.length - 2]).toBe("--");
    expect(calls[0].args[calls[0].args.length - 1]).toBe("--version");
  });

  it("execute() uses workspace-write and never the bypass flag", async () => {
    const { run, calls } = fakeRunner("done");
    const r = await new CodexProvider(run).execute({
      runId: RID,
      workspaceId: WID,
      task: task(),
      model: "m",
      cwd: "C:\\proj"
    });
    expect(calls[0].args.slice(0, 6)).toEqual(["exec", "--skip-git-repo-check", "-s", "workspace-write", "-m", "m"]);
    expect(calls[0].args[6]).toBe("--");
    expect(calls[0].opts.cwd).toBe("C:\\proj");
    expect(r.output).toBe("done");
    expect(r.usage.provider).toBe("openai");
  });

  it("never passes a 'dangerously' flag", async () => {
    const { run, calls } = fakeRunner("a");
    const p = new CodexProvider(run);
    await p.executeChat({ runId: RID, workspaceId: WID, prompt: "x", model: "m" });
    await p.execute({ runId: RID, workspaceId: WID, task: task() });
    for (const c of calls) for (const a of c.args) expect(a).not.toContain("dangerously");
  });

  it("throws ProviderCallError when the CLI fails or prints nothing", async () => {
    const e1 = await new CodexProvider(failingRunner).executeChat({ runId: RID, workspaceId: WID, prompt: "x" }).catch((e) => e);
    expect(e1).toBeInstanceOf(ProviderCallError);
    expect(e1.message).toBe("Codex 호출에 실패했어요: boom");
    const { run } = fakeRunner("");
    const e2 = await new CodexProvider(run).executeChat({ runId: RID, workspaceId: WID, prompt: "x" }).catch((e) => e);
    expect(e2).toBeInstanceOf(ProviderCallError);
    expect(e2.message).toContain("Codex 호출에 실패했어요");
  });
});

describe("ClaudeProvider failure", () => {
  it("throws ProviderCallError with the Claude message for non-rate-limit failures", async () => {
    const err = await new ClaudeProvider(failingRunner).executeChat({ runId: RID, workspaceId: WID, prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderCallError);
    expect(err.message).toBe("Claude 호출에 실패했어요: boom");
  });
});

describe("ProviderRegistry.forConnection", () => {
  it("maps connection providers to adapters", () => {
    const registry = new ProviderRegistry(async () => ({ stdout: "", stderr: "" }));
    expect(registry.forConnection("anthropic")).toBeInstanceOf(ClaudeProvider);
    expect(registry.forConnection("google")).toBeInstanceOf(AgyProvider);
    expect(registry.forConnection("openai")).toBeInstanceOf(CodexProvider);
  });

  it("passes the same runner to all three adapters", async () => {
    const { run, calls } = fakeRunner('{"result":"r"}');
    const registry = new ProviderRegistry(run);
    for (const p of ["anthropic", "google", "openai"] as const) {
      await registry.forConnection(p).executeChat!({ runId: RID, workspaceId: WID, prompt: "x" });
    }
    expect(calls.map((c) => c.cmd)).toEqual(["claude", "agy", "codex"]);
  });
});

describe("neutral wording", () => {
  it("mock greeting has no Gon persona", async () => {
    const r = await new MockProvider().executeChat({ runId: RID, workspaceId: WID, prompt: "hi" });
    expect(r.output).not.toMatch(/Gon|비서/);
  });
});
