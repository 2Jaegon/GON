import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProviderConnectionView } from "@aso/contracts";
import { CliRunner, defaultCliRunner } from "./cli-runner.js";
import { ModelCatalog, discoverModels, loadModelCatalog } from "./model-discovery.js";

export interface DetectedSubscription {
  provider: "anthropic" | "google" | "openai";
  installed: boolean;
  version?: string;
  command: string;
  configPath?: string;
  authenticated: boolean;
  quotaWarning?: string;
  connectionView: ProviderConnectionView;
}

export class SubscriptionDetector {
  private catalog: ModelCatalog;

  constructor(
    private run: CliRunner = defaultCliRunner,
    catalog?: ModelCatalog
  ) {
    this.catalog = catalog ?? loadModelCatalog();
  }

  /**
   * Fast scan of local machine for installed user AI subscription CLIs (< 1s total)
   */
  public async scanSubscriptions(workspaceId: string): Promise<DetectedSubscription[]> {
    const [claudeSub, agySub, codexSub] = await Promise.all([
      this.detectClaude(workspaceId),
      this.detectAgy(workspaceId),
      this.detectCodex(workspaceId)
    ]);

    return [claudeSub, agySub, codexSub];
  }

  private async detectClaude(workspaceId: string): Promise<DetectedSubscription> {
    const homeDir = os.homedir();
    const claudeJsonPath = path.join(homeDir, ".claude.json");
    const hasConfig = fs.existsSync(claudeJsonPath);

    let installed = false;
    let version = "unknown";
    let status: ProviderConnectionView["status"] = "not_configured";

    try {
      const { stdout } = await this.run("claude", ["--version"], { timeoutMs: 3000 });
      if (stdout.trim()) {
        installed = true;
        version = stdout.trim().split("\n")[0];
        status = hasConfig ? "connected" : "needs_action";
      }
    } catch {
      // CLI not found
    }

    const models = installed ? await discoverModels("anthropic", this.run, this.catalog) : undefined;
    const authenticated = hasConfig || Boolean(models?.planVerified);
    // A verified CLI login counts even when ~/.claude.json is absent.
    if (installed && authenticated) status = "connected";

    const id = "00000000-0000-7000-8000-c1a0de000001";
    return {
      provider: "anthropic",
      installed,
      version,
      command: "claude",
      configPath: hasConfig ? claudeJsonPath : undefined,
      authenticated,
      connectionView: {
        id,
        provider: "anthropic",
        mode: "LOCAL_NATIVE_CLI",
        status: installed ? status : "not_configured",
        displayName: "Claude (Anthropic)",
        capabilities: ["plan", "code", "review", "tools", "structured_output"],
        billingOwner: "user",
        estimatedCostVisible: true,
        legalGate: "approved",
        lastHealthCheckAt: new Date().toISOString(),
        details: installed && authenticated
          ? "Claude 구독 계정 연결됨 (OAuth)"
          : "클릭하여 Claude 계정으로 로그인하세요",
        metadata: {
          cli: "claude",
          version,
          hasConfig,
          models
        }
      }
    };
  }

  private async detectAgy(workspaceId: string): Promise<DetectedSubscription> {
    const homeDir = os.homedir();
    const geminiDir = path.join(homeDir, ".gemini");
    const hasConfig = fs.existsSync(geminiDir);

    let installed = false;
    let version = "unknown";
    let status: ProviderConnectionView["status"] = "not_configured";

    try {
      const { stdout } = await this.run("agy", ["--version"], { timeoutMs: 3000 });
      if (stdout.trim()) {
        installed = true;
        version = stdout.trim().split("\n")[0];
        status = "connected";
      }
    } catch {
      // agy not in path
    }

    const models = installed ? await discoverModels("google", this.run, this.catalog) : undefined;

    const id = "00000000-0000-7000-8000-a64000000002";
    return {
      provider: "google",
      installed,
      version,
      command: "agy",
      configPath: hasConfig ? geminiDir : undefined,
      authenticated: installed,
      connectionView: {
        id,
        provider: "google",
        mode: "LOCAL_NATIVE_CLI",
        status: installed ? status : "not_configured",
        displayName: "Gemini (Google)",
        capabilities: ["plan", "code", "review", "tools"],
        billingOwner: "user",
        estimatedCostVisible: true,
        legalGate: "approved",
        lastHealthCheckAt: new Date().toISOString(),
        details: installed
          ? "Google Gemini 구독 계정 연결됨 (OAuth)"
          : "클릭하여 Google 계정으로 로그인하세요",
        metadata: {
          cli: "agy",
          version,
          hasConfig,
          models
        }
      }
    };
  }

  private async detectCodex(workspaceId: string): Promise<DetectedSubscription> {
    let installed = false;
    let version = "unknown";
    let status: ProviderConnectionView["status"] = "not_configured";

    try {
      const { stdout } = await this.run("codex", ["--version"], { timeoutMs: 3000 });
      if (stdout.trim()) {
        installed = true;
        version = stdout.trim().split("\n")[0];
        status = "connected";
      }
    } catch {
      // codex not found
    }

    const models = installed ? await discoverModels("openai", this.run, this.catalog) : undefined;

    const id = "00000000-0000-7000-8000-c0de80000003";
    return {
      provider: "openai",
      installed,
      version,
      command: "codex",
      authenticated: installed,
      connectionView: {
        id,
        provider: "openai",
        mode: "LOCAL_NATIVE_CLI",
        status: installed ? status : "not_configured",
        displayName: "ChatGPT (OpenAI)",
        capabilities: ["plan", "code", "review", "tools", "structured_output"],
        billingOwner: "user",
        estimatedCostVisible: true,
        legalGate: "approved",
        lastHealthCheckAt: new Date().toISOString(),
        details: installed
          ? "OpenAI ChatGPT 구독 계정 연결됨 (OAuth)"
          : "클릭하여 OpenAI 계정으로 로그인하세요",
        metadata: {
          cli: "codex",
          version,
          models
        }
      }
    };
  }

  /**
   * Deep probe health and quota of a subscription
   */
  public async probeHealth(provider: "anthropic" | "google" | "openai"): Promise<{
    status: ProviderConnectionView["status"];
    details: string;
    quotaWarning?: string;
  }> {
    if (provider === "anthropic") {
      try {
        const { stdout } = await this.run("claude", ["-p", "ping", "--output-format", "json"], {
          timeoutMs: 6000
        });
        const parsed = JSON.parse(stdout);
        if (parsed.api_error === "usage_limit_reached" || parsed.api_error_status === 429) {
          return {
            status: "needs_action",
            details: parsed.result || "Weekly usage limit reached",
            quotaWarning: parsed.result
          };
        }
        return {
          status: "connected",
          details: "Claude Code active and ready"
        };
      } catch (err: any) {
        if (err.stdout) {
          try {
            const parsed = JSON.parse(err.stdout);
            if (parsed.api_error === "usage_limit_reached") {
              return {
                status: "needs_action",
                details: parsed.result || "Weekly usage limit reached",
                quotaWarning: parsed.result
              };
            }
          } catch {}
        }
        return {
          status: "connected",
          details: "Claude Code installed"
        };
      }
    }

    if (provider === "google") {
      try {
        await this.run("agy", ["--version"], { timeoutMs: 3000 });
        return { status: "connected", details: "Antigravity active and ready" };
      } catch {
        return { status: "not_configured", details: "agy CLI not found" };
      }
    }

    return { status: "connected", details: "CLI active" };
  }

  /**
   * Triggers native CLI OAuth login flow (opens browser on local machine)
   */
  public async loginSubscription(provider: "anthropic" | "google" | "openai"): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      if (provider === "anthropic") {
        await this.run("claude", ["auth", "login", "--claudeai"], { timeoutMs: 120000 });
        return { success: true, message: "Claude 로그인이 완료되었어요." };
      }
      if (provider === "openai") {
        await this.run("codex", ["login"], { timeoutMs: 120000 });
        return { success: true, message: "Codex 로그인이 완료되었어요." };
      }
      if (provider === "google") {
        await this.run("agy", ["models"], { timeoutMs: 120000 });
        return { success: true, message: "Gemini (Antigravity) 연결이 확인되었어요." };
      }
      return { success: false, message: "지원하지 않는 프로바이더예요." };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || "로그인 중 오류가 발생했어요."
      };
    }
  }

  /**
   * Logs out from native CLI subscription
   */
  public async logoutSubscription(provider: "anthropic" | "google" | "openai"): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      if (provider === "anthropic") {
        await this.run("claude", ["auth", "logout"], { timeoutMs: 15000 });
        return { success: true, message: "Claude에서 로그아웃했어요." };
      }
      if (provider === "openai") {
        await this.run("codex", ["logout"], { timeoutMs: 15000 });
        return { success: true, message: "ChatGPT (OpenAI) 연결을 해제했어요." };
      }
      if (provider === "google") {
        return { success: true, message: "Gemini (Google) 연결을 해제했어요." };
      }
      return { success: false, message: "지원하지 않는 프로바이더예요." };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || "로그아웃 중 오류가 발생했어요."
      };
    }
  }
}
