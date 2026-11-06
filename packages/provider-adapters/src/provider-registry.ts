import { CliRunner, defaultCliRunner } from "./cli-runner.js";
import { IProviderAdapter } from "./types.js";
import { MockProvider } from "./mock-provider.js";
import { AgyProvider } from "./agy-provider.js";
import { ClaudeProvider } from "./claude-provider.js";
import { CodexProvider } from "./codex-provider.js";

export class ProviderRegistry {
  private mockProvider = new MockProvider();
  private agyProvider: AgyProvider;
  private claudeProvider: ClaudeProvider;
  private codexProvider: CodexProvider;

  constructor(run: CliRunner = defaultCliRunner) {
    this.agyProvider = new AgyProvider(run);
    this.claudeProvider = new ClaudeProvider(run);
    this.codexProvider = new CodexProvider(run);
  }

  /** Picks the adapter for a saved connection's provider. */
  public forConnection(provider: "anthropic" | "google" | "openai"): IProviderAdapter {
    switch (provider) {
      case "anthropic":
        return this.claudeProvider;
      case "google":
        return this.agyProvider;
      case "openai":
        return this.codexProvider;
    }
  }

  public get(name: "mock" | "agy" | "claude"): IProviderAdapter {
    switch (name) {
      case "claude":
        return this.claudeProvider;
      case "mock":
        return this.mockProvider;
      case "agy":
      default:
        return this.agyProvider;
    }
  }

  /**
   * Resolves provider based on user preference and environment
   */
  public resolve(preference?: string): IProviderAdapter {
    const pref = (preference || "auto").toLowerCase();

    if (pref === "mock") {
      return this.mockProvider;
    }

    if (pref === "claude" || pref === "anthropic") {
      return this.claudeProvider;
    }

    if (pref === "agy" || pref === "gemini" || pref === "antigravity" || pref === "google") {
      return this.agyProvider;
    }

    // When preference is "auto", in tests return mock, otherwise return agy
    if (process.env.VITEST || process.env.NODE_ENV === "test") {
      return this.mockProvider;
    }

    return this.agyProvider;
  }
}
