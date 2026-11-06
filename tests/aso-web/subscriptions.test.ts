import { describe, it, expect, beforeEach } from "vitest";
import { SubscriptionDetector, ProviderRegistry, CliRunner } from "@aso/provider-adapters";
import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase } from "@aso/database";

const cliRunner: CliRunner = async (cmd, args) => {
  if (args[0] === "--version") return { stdout: "1.0.0", stderr: "" };
  throw new Error(`unexpected cli call: ${cmd} ${args.join(" ")}`);
};

describe("Subscription Connection & Provider Routing", () => {
  it("SubscriptionDetector scans and returns local subscription CLIs", async () => {
    const detector = new SubscriptionDetector(cliRunner);
    const subs = await detector.scanSubscriptions("00000000-0000-7000-8000-000000000002");

    expect(Array.isArray(subs)).toBe(true);
    expect(subs.length).toBe(3);

    const claude = subs.find((s) => s.provider === "anthropic");
    const agy = subs.find((s) => s.provider === "google");
    const codex = subs.find((s) => s.provider === "openai");

    expect(claude).toBeDefined();
    expect(agy).toBeDefined();
    expect(codex).toBeDefined();

    // Verify properties
    expect(claude?.connectionView.mode).toBe("LOCAL_NATIVE_CLI");
    expect(claude?.connectionView.billingOwner).toBe("user");
    expect(agy?.connectionView.mode).toBe("LOCAL_NATIVE_CLI");
  });

  it("ProviderRegistry resolves providers by preference", () => {
    const registry = new ProviderRegistry();

    const claudeProvider = registry.resolve("claude");
    expect(claudeProvider.name).toBe("claude-provider");

    const agyProvider = registry.resolve("agy");
    expect(agyProvider.name).toBe("agy-provider");

    const autoProvider = registry.resolve("auto");
    expect(autoProvider).toBeDefined();
  });

  it("API automatically populates and returns local user subscriptions on /connections", async () => {
    const db = createDatabase(":memory:");
    const { server } = await createApiServer({ db, logger: false, cliRunner });

    const res = await server.inject({
      method: "GET",
      url: "/api/v1/workspaces/00000000-0000-7000-8000-000000000002/connections"
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);

    const hasNativeCli = body.items.some((item: any) => item.mode === "LOCAL_NATIVE_CLI");
    expect(hasNativeCli).toBe(true);
  });
});

