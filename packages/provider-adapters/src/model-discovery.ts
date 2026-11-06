import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConnectionModels, Effort, EffortSchema, ModelOption, ProviderName } from "@aso/contracts";
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

const EFFORTS = EffortSchema.options;
const isEffort = (e: unknown): e is Effort => EFFORTS.includes(e as Effort);
/** Keeps the canonical low → ultra order no matter how the CLI listed them. */
const orderEfforts = (found: Iterable<string>): Effort[] => {
  const set = new Set(found);
  return EFFORTS.filter((e) => set.has(e));
};

/**
 * agy encodes effort in the model id (`...-low/-medium/-high`), so each model offers the suffixes
 * listed for its own base (`gpt-oss-120b-medium` alone offers only medium).
 */
function withAgyEfforts(models: ModelOption[]): ModelOption[] {
  const split = (id: string) => {
    const m = id.match(/^(.*)-([a-z]+)$/);
    return m && isEffort(m[2]) ? { base: m[1], effort: m[2] } : { base: id, effort: "" };
  };
  const byBase = new Map<string, string[]>();
  for (const m of models) {
    const { base, effort } = split(m.id);
    byBase.set(base, [...(byBase.get(base) ?? []), effort]);
  }
  return models.map((m) => ({ ...m, efforts: orderEfforts(byBase.get(split(m.id).base) ?? []) }));
}

// A model id becomes a CLI argument, so it must look like an id and never like a flag.
const SAFE_MODEL_ID = /^[A-Za-z0-9][\w.:-]*$/;

/** `codex debug models` JSON → listed models with their own effort levels; hidden models and unknown levels are dropped. */
export function parseCodexModels(stdout: string): ModelOption[] {
  const parsed = JSON.parse(stdout);
  return (parsed?.models ?? [])
    .filter((m: any) => m?.visibility === "list" && typeof m.slug === "string" && SAFE_MODEL_ID.test(m.slug))
    .map((m: any) => ({
      id: m.slug,
      label: typeof m.display_name === "string" ? m.display_name : m.slug,
      efforts: orderEfforts((m.supported_reasoning_levels ?? []).map((l: any) => l?.effort).filter(isEffort))
    }));
}

/** Reads only `chatgpt_plan_type` from the codex id token; never returns or logs the tokens themselves. */
export function readCodexPlan(file = path.join(os.homedir(), ".codex", "auth.json")): string | null {
  try {
    const idToken = JSON.parse(fs.readFileSync(file, "utf8"))?.tokens?.id_token;
    if (typeof idToken !== "string") return null;
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    const plan = claims?.["https://api.openai.com/auth"]?.chatgpt_plan_type;
    // The token is not signature-checked, so accept only a short plain plan name for the label.
    return typeof plan === "string" && /^[a-z_]{1,32}$/.test(plan) ? plan : null;
  } catch {
    return null;
  }
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

/** Never calls a model: only `agy models`, `claude auth status` and `codex debug models`, plus the checked-in catalog. */
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
      const models = withAgyEfforts(parseAgyModels(stdout));
      return { ...base, planVerified: true, efforts: orderEfforts(models.flatMap((m) => m.efforts ?? [])), models, source: "agy models" };
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
        // `claude --help`: --effort <level> (low, medium, high, xhigh, max)
        efforts: ["low", "medium", "high", "xhigh", "max"],
        models: catalog.claude.models,
        source,
        refreshedAt
      };
    } catch {
      return { ...base, source };
    }
  }

  try {
    const { stdout } = await run("codex", ["debug", "models"], { timeoutMs: TIMEOUT_MS });
    const models = parseCodexModels(stdout);
    if (models.length > 0) {
      return { ...base, efforts: orderEfforts(models.flatMap((m) => m.efforts ?? [])), models, source: "codex debug models" };
    }
  } catch {
    // older codex or unexpected output: fall back to the checked-in catalog
  }
  // codex accepted low/medium/high before per-model levels existed, so the fallback keeps offering them.
  return { ...base, efforts: ["low", "medium", "high"], models: catalog.codex.models, source: `catalog ${catalog.codex.checkedAt}` };
}
