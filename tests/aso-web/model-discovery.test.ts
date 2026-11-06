import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CliRunner,
  ModelCatalog,
  discoverModels,
  loadModelCatalog,
  parseAgyModels,
  parseClaudeAuthStatus,
  readCodexPlan
} from "@aso/provider-adapters";
import { createAuthedServer } from "./helpers/auth.js";
import { createDatabase } from "@aso/database";

const AGY =
  "Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n";
const CLAUDE_AUTH = '{"loggedIn":true,"subscriptionType":"pro","orgId":"secret-org"}';
const levels = (...e: string[]) => e.map((effort) => ({ effort, description: effort }));
const CODEX_MODELS = JSON.stringify({
  models: [
    { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", supported_reasoning_levels: levels("low") },
    {
      slug: "gpt-5.6-terra",
      display_name: "GPT-5.6 Terra",
      visibility: "list",
      supported_reasoning_levels: levels("low", "medium", "high", "xhigh", "max", "ultra")
    },
    { slug: "gpt-5.6-luna", display_name: "GPT-5.6 Luna", visibility: "list", supported_reasoning_levels: levels("low", "medium", "high", "warp") }
  ]
});

function fakeJwt(payload: object): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none" })}.${part(payload)}.sig`;
}

describe("readCodexPlan", () => {
  it("reads only chatgpt_plan_type from the codex id token", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-"));
    const file = path.join(dir, "auth.json");
    fs.writeFileSync(file, JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { id_token: fakeJwt({ "https://api.openai.com/auth": { chatgpt_plan_type: "free" } }), access_token: "secret" }
    }));
    expect(readCodexPlan(file)).toBe("free");
  });

  it("returns null when the file is missing or has no ChatGPT token", () => {
    expect(readCodexPlan(path.join(os.tmpdir(), "nope-codex-auth.json"))).toBeNull();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-"));
    const file = path.join(dir, "auth.json");
    fs.writeFileSync(file, JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-x" }));
    expect(readCodexPlan(file)).toBeNull();
  });

  it("ignores a plan claim that is not a short plain plan name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-"));
    const file = path.join(dir, "auth.json");
    const claim = { "https://api.openai.com/auth": { chatgpt_plan_type: "<img src=x>".repeat(5) } };
    fs.writeFileSync(file, JSON.stringify({ tokens: { id_token: fakeJwt(claim) } }));
    expect(readCodexPlan(file)).toBeNull();
  });
});

const catalog: ModelCatalog = {
  claude: {
    source: "x",
    checkedAt: "2026-11-06",
    models: [
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" }
    ]
  },
  codex: { source: "y", checkedAt: "2026-11-06", models: [{ id: "m1", label: "M1" }] }
};

function fakeRunner(outputs: Record<string, string>): CliRunner {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    if (key in outputs) return { stdout: outputs[key], stderr: "" };
    throw new Error(`unexpected cli call: ${key}`);
  };
}

describe("model discovery parsers", () => {
  it("parseAgyModels drops lines without a tab", () => {
    expect(parseAgyModels(AGY)).toEqual([
      { id: "gemini-4-argon-high", label: "Gemini 4 Argon (High)" },
      { id: "claude-opus-5-5-low", label: "Claude Opus 5.5 (Low)" }
    ]);
  });

  it("parseClaudeAuthStatus reads loggedIn and subscriptionType only", () => {
    expect(parseClaudeAuthStatus(CLAUDE_AUTH)).toEqual({ loggedIn: true, subscriptionType: "pro" });
    expect(parseClaudeAuthStatus("not json")).toEqual({ loggedIn: false, subscriptionType: null });
  });

  it("loadModelCatalog reads the repo catalog with claude and codex entries", () => {
    const real = loadModelCatalog();
    expect(real.claude.models.map((m) => m.id)).toEqual(["opus", "sonnet", "haiku"]);
    expect(real.codex.checkedAt).toBe("2026-11-06");
  });
});

describe("discoverModels", () => {
  it("google uses agy models and offers only the effort suffixes agy lists", async () => {
    const r = await discoverModels("google", fakeRunner({ "agy models": AGY }), catalog);
    expect(r).toMatchObject({ plan: null, planVerified: true, efforts: ["low", "high"], source: "agy models" });
    expect(r.models).toHaveLength(2);
    expect(() => new Date(r.refreshedAt).toISOString()).not.toThrow();
  });

  it("google gives each agy model only the effort suffixes listed for its own base", async () => {
    const out = "gemini-x-low\tX (Low)\ngemini-x-high\tX (High)\ngpt-oss-120b-medium\tGPT-OSS (Medium)\n";
    const r = await discoverModels("google", fakeRunner({ "agy models": out }), catalog);
    expect(r.models.map((m) => [m.id, m.efforts])).toEqual([
      ["gemini-x-low", ["low", "high"]],
      ["gemini-x-high", ["low", "high"]],
      ["gpt-oss-120b-medium", ["medium"]]
    ]);
  });

  it("anthropic uses claude auth status plus the catalog", async () => {
    const r = await discoverModels("anthropic", fakeRunner({ "claude auth status": CLAUDE_AUTH }), catalog);
    expect(r).toMatchObject({
      plan: "pro",
      planVerified: true,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      source: "claude auth status + catalog"
    });
    expect(r.models.map((m) => m.id)).toEqual(["opus", "sonnet"]);
  });

  it("openai lists codex debug models with each model's own efforts and drops hidden ones", async () => {
    const r = await discoverModels("openai", fakeRunner({ "codex debug models": CODEX_MODELS }), catalog);
    expect(r).toMatchObject({ plan: null, planVerified: false, source: "codex debug models" });
    expect(r.models).toEqual([
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", efforts: ["low", "medium", "high"] }
    ]);
    expect(r.efforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  });

  it("drops codex model ids that could be read as a CLI flag", async () => {
    const out = JSON.stringify({ models: [
      { slug: "--dangerously-bypass", display_name: "x", visibility: "list", supported_reasoning_levels: levels("low") },
      { slug: "gpt ok", display_name: "y", visibility: "list", supported_reasoning_levels: levels("low") },
      { slug: "gpt-5.6-luna", display_name: "Luna", visibility: "list", supported_reasoning_levels: levels("low") }
    ] });
    const r = await discoverModels("openai", fakeRunner({ "codex debug models": out }), catalog);
    expect(r.models.map((m) => m.id)).toEqual(["gpt-5.6-luna"]);
  });

  it("openai falls back to the catalog when codex debug models fails", async () => {
    const r = await discoverModels("openai", fakeRunner({}), catalog);
    expect(r).toMatchObject({ plan: null, planVerified: false, efforts: ["low", "medium", "high"], source: "catalog 2026-11-06" });
    expect(r.models).toEqual([{ id: "m1", label: "M1" }]);
  });

  it("returns an empty list when the CLI fails instead of inventing models", async () => {
    const r = await discoverModels("google", fakeRunner({}), catalog);
    expect(r.models).toEqual([]);
    const c = await discoverModels("anthropic", fakeRunner({}), catalog);
    expect(c.plan).toBeNull();
    expect(c.planVerified).toBe(false);
  });
});

describe("GET /models", () => {
  it("lists models for connected local connections using the injected runner", async () => {
    const cliRunner = fakeRunner({
      "claude --version": "2.1.0 (Claude Code)",
      "claude auth status": CLAUDE_AUTH,
      "agy --version": "1.0.0",
      "agy models": AGY,
      "codex --version": "codex-cli 1.0.0"
    });
    const db = createDatabase(":memory:");
    const { server } = await createAuthedServer({ db, logger: false, cliRunner });
    const ws = "00000000-0000-7000-8000-000000000002";

    const detect = await server.inject({ method: "POST", url: `/api/v1/workspaces/${ws}/connections/detect-subscriptions` });
    expect(detect.statusCode).toBe(200);

    const res = await server.inject({ method: "GET", url: `/api/v1/workspaces/${ws}/models` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const claude = body.subscription.find((s: any) => s.provider === "anthropic");
    expect(claude.plan).toBe("pro");
    expect(claude.planVerified).toBe(true);
    expect(claude.models.map((m: any) => m.id)).toContain("opus");
    const agy = body.subscription.find((s: any) => s.provider === "google");
    expect(agy.models[0].id).toBe("gemini-4-argon-high");
    const codex = body.subscription.find((s: any) => s.provider === "openai");
    expect(codex.planVerified).toBe(false);
    expect(JSON.stringify(body)).not.toContain("secret-org");
  });
});
