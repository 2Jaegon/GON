import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ProviderConnectionView } from "@aso/contracts";

const execAsync = promisify(exec);

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
      const { stdout } = await execAsync("claude --version", { timeout: 3000 });
      if (stdout.trim()) {
        installed = true;
        version = stdout.trim().split("\n")[0];
        status = hasConfig ? "connected" : "needs_action";
      }
    } catch {
      // CLI not found
    }

    const id = "00000000-0000-7000-8000-c1a0de000001";
    return {
      provider: "anthropic",
      installed,
      version,
      command: "claude",
      configPath: hasConfig ? claudeJsonPath : undefined,
      authenticated: hasConfig,
      connectionView: {
        id,
        provider: "anthropic",
        mode: "LOCAL_NATIVE_CLI",
        status: installed ? status : "not_configured",
        displayName: "Anthropic Claude Code (Subscription)",
        capabilities: ["plan", "code", "review", "tools", "structured_output"],
        billingOwner: "user",
        estimatedCostVisible: true,
        legalGate: "approved",
        lastHealthCheckAt: new Date().toISOString(),
        details: installed
          ? `${version} · Local Native OAuth · Ready`
          : "Claude Code CLI is not installed",
        metadata: {
          cli: "claude",
          version,
          hasConfig
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
      const { stdout } = await execAsync("agy --version", { timeout: 3000 });
      if (stdout.trim()) {
        installed = true;
        version = stdout.trim().split("\n")[0];
        status = "connected";
      }
    } catch {
      // agy not in path
    }

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
        displayName: "Google Antigravity / Gemini (Subscription)",
        capabilities: ["plan", "code", "review", "tools"],
        billingOwner: "user",
        estimatedCostVisible: true,
        legalGate: "approved",
        lastHealthCheckAt: new Date().toISOString(),
        details: installed
          ? `agy v${version} · Google Native OAuth · Ready`
          : "Antigravity CLI is not installed",
        metadata: {
          cli: "agy",
          version,
          hasConfig
        }
      }
    };
  }

  private async detectCodex(workspaceId: string): Promise<DetectedSubscription> {
    let installed = false;
    let version = "unknown";
    let status: ProviderConnectionView["status"] = "not_configured";

    try {
      const { stdout } = await execAsync("codex --version", { timeout: 3000 });
      if (stdout.trim()) {
        installed = true;
        version = stdout.trim().split("\n")[0];
        status = "connected";
      }
    } catch {
      // codex not found
    }

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
        displayName: "OpenAI Codex CLI (Subscription)",
        capabilities: ["plan", "code", "review", "tools", "structured_output"],
        billingOwner: "user",
        estimatedCostVisible: true,
        legalGate: "approved",
        lastHealthCheckAt: new Date().toISOString(),
        details: installed
          ? `${version} · OpenAI Native CLI · Ready`
          : "Codex CLI is not installed",
        metadata: {
          cli: "codex",
          version
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
        const { stdout } = await execAsync('claude -p "ping" --output-format json < NUL', {
          timeout: 6000
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
        await execAsync("agy --version", { timeout: 3000 });
        return { status: "connected", details: "Antigravity active and ready" };
      } catch {
        return { status: "not_configured", details: "agy CLI not found" };
      }
    }

    return { status: "connected", details: "CLI active" };
  }
}
