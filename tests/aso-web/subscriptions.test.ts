import { describe, it, expect, beforeEach } from "vitest";
import { SubscriptionDetector, ProviderRegistry, CliRunner } from "@aso/provider-adapters";
import { createAuthedServer } from "./helpers/auth.js";
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
    const { server } = await createAuthedServer({ db, logger: false, cliRunner });

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

  it("POST /connections/api-key returns 501 and does not create any USER_API_KEY connection", async () => {
    const db = createDatabase(":memory:");
    const { server } = await createAuthedServer({ db, logger: false, cliRunner });
    const wsId = "00000000-0000-7000-8000-000000000002";

    const res = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${wsId}/connections/api-key`,
      payload: {
        provider: "anthropic",
        apiKey: "sk-ant-fake-key-12345"
      }
    });

    expect(res.statusCode).toBe(501);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("NOT_IMPLEMENTED");
    expect(body.error?.message).toContain("API 키 연결은 준비 중이에요");

    const getRes = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${wsId}/connections`
    });
    const getBody = JSON.parse(getRes.body);
    expect(getBody.items.some((item: any) => item.mode === "USER_API_KEY")).toBe(false);
  });

  it("POST /connections/:provider/login and logout trigger CLI OAuth commands and sync state", async () => {
    const calls: string[] = [];
    let loggedIn = false;
    const authRunner: CliRunner = async (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      calls.push(key);
      if (args[0] === "--version") return { stdout: "2.1.0", stderr: "" };
      if (key === "claude auth login --claudeai") {
        loggedIn = true;
        return { stdout: "Logged in", stderr: "" };
      }
      if (key === "claude auth status") {
        return {
          stdout: JSON.stringify({ loggedIn, subscriptionType: loggedIn ? "pro" : null }),
          stderr: ""
        };
      }
      if (key === "claude auth logout") {
        loggedIn = false;
        return { stdout: "Logged out", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    const db = createDatabase(":memory:");
    const { server } = await createAuthedServer({ db, logger: false, cliRunner: authRunner });
    const wsId = "00000000-0000-7000-8000-000000000002";

    const loginRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${wsId}/connections/anthropic/login`
    });
    expect(loginRes.statusCode).toBe(200);
    expect(calls).toContain("claude auth login --claudeai");
    const loginBody = JSON.parse(loginRes.body);
    expect(loginBody.success).toBe(true);
    const claudeConn = loginBody.items.find((c: any) => c.provider === "anthropic");
    expect(claudeConn.status).toBe("connected");

    const logoutRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${wsId}/connections/anthropic/logout`
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(calls).toContain("claude auth logout");
    const logoutBody = JSON.parse(logoutRes.body);
    const claudeAfterLogout = logoutBody.items.find((c: any) => c.provider === "anthropic");
    expect(claudeAfterLogout.status).toBe("needs_action");
  });

  it("GET /models auto-syncs local subscriptions even when /connections was not called first", async () => {
    const db = createDatabase(":memory:");
    const { server } = await createAuthedServer({ db, logger: false, cliRunner });
    const wsId = "00000000-0000-7000-8000-000000000002";

    const res = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${wsId}/models`
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.subscription)).toBe(true);
    expect(body.subscription.length).toBeGreaterThan(0);
  });
});

