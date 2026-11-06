import { describe, it, expect } from "vitest";
import {
  CliRunner,
  ModelCatalog,
  discoverModels,
  loadModelCatalog,
  parseAgyModels,
  parseClaudeAuthStatus
} from "@aso/provider-adapters";
import { createAuthedServer } from "./helpers/auth.js";
import { createDatabase } from "@aso/database";

const AGY =
  "Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n";
const CLAUDE_AUTH = '{"loggedIn":true,"subscriptionType":"pro","orgId":"secret-org"}';

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
  it("google uses agy models", async () => {
    const r = await discoverModels("google", fakeRunner({ "agy models": AGY }), catalog);
    expect(r).toMatchObject({ plan: null, planVerified: true, efforts: [], source: "agy models" });
    expect(r.models).toHaveLength(2);
    expect(() => new Date(r.refreshedAt).toISOString()).not.toThrow();
  });

  it("anthropic uses claude auth status plus the catalog", async () => {
    const r = await discoverModels("anthropic", fakeRunner({ "claude auth status": CLAUDE_AUTH }), catalog);
    expect(r).toMatchObject({
      plan: "pro",
      planVerified: true,
      efforts: ["low", "medium", "high"],
      source: "claude auth status + catalog"
    });
    expect(r.models.map((m) => m.id)).toEqual(["opus", "sonnet"]);
  });

  it("openai uses the catalog and never verifies the plan", async () => {
    const r = await discoverModels("openai", fakeRunner({}), catalog);
    expect(r).toMatchObject({ plan: null, planVerified: false, efforts: [], source: "catalog 2026-11-06" });
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
