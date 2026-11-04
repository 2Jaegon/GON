import { IProviderAdapter } from "./types.js";
import { MockProvider } from "./mock-provider.js";
import { AgyProvider } from "./agy-provider.js";
import { ClaudeProvider } from "./claude-provider.js";

export class ProviderRegistry {
  private mockProvider = new MockProvider();
  private agyProvider = new AgyProvider();
  private claudeProvider = new ClaudeProvider();

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

    if (pref === "claude" || pref === "anthropic" || pref.includes("sonnet") || pref.includes("claude-code")) {
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
