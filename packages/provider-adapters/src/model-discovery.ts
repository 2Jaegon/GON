import fs from "node:fs";
import path from "node:path";
import { ConnectionModels, ModelOption, ProviderName } from "@aso/contracts";
import { CliRunner } from "./cli-runner.js";

export interface ModelCatalogEntry {
  source: string;
  checkedAt: string;
  models: ModelOption[];
}

export interface ModelCatalog {
  claude: ModelCatalogEntry;
  codex: ModelCatalogEntry;
}

const TIMEOUT_MS = 8000;

export function parseAgyModels(stdout: string): ModelOption[] {
  const models: ModelOption[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const id = line.slice(0, tab).trim();
    const label = line.slice(tab + 1).trim();
    if (id && label) models.push({ id, label });
  }
  return models;
}

export function parseClaudeAuthStatus(stdout: string): { loggedIn: boolean; subscriptionType: string | null } {
  try {
    const parsed = JSON.parse(stdout);
    return {
      loggedIn: parsed?.loggedIn === true,
      subscriptionType: typeof parsed?.subscriptionType === "string" ? parsed.subscriptionType : null
    };
  } catch {
    return { loggedIn: false, subscriptionType: null };
  }
}

export function loadModelCatalog(file = path.resolve(process.cwd(), "config/model-catalog.json")): ModelCatalog {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ModelCatalog;
  } catch (err: any) {
    console.warn(`[model-discovery] Failed to load model catalog at ${file}: ${err?.message || err}`);
    const empty = { source: "", checkedAt: "unknown", models: [] };
    return { claude: empty, codex: empty };
  }
}

/** Never calls a model: only `agy models` and `claude auth status`, plus the checked-in catalog. */
export async function discoverModels(
  provider: ProviderName,
  run: CliRunner,
  catalog: ModelCatalog
): Promise<ConnectionModels> {
  const refreshedAt = new Date().toISOString();
  const base: ConnectionModels = {
    plan: null,
    planVerified: false,
    efforts: [],
    models: [],
    source: "",
    refreshedAt
  };

  if (provider === "google") {
    try {
      const { stdout } = await run("agy", ["models"], { timeoutMs: TIMEOUT_MS });
      return { ...base, planVerified: true, models: parseAgyModels(stdout), source: "agy models" };
    } catch {
      return { ...base, source: "agy models" };
    }
  }

  if (provider === "anthropic") {
    const source = "claude auth status + catalog";
    try {
      const { stdout } = await run("claude", ["auth", "status"], { timeoutMs: TIMEOUT_MS });
      const { subscriptionType } = parseClaudeAuthStatus(stdout);
      return {
        plan: subscriptionType,
        planVerified: subscriptionType !== null,
        efforts: ["low", "medium", "high"],
        models: catalog.claude.models,
        source,
        refreshedAt
      };
    } catch {
      return { ...base, source };
    }
  }

  return { ...base, models: catalog.codex.models, source: `catalog ${catalog.codex.checkedAt}` };
}
