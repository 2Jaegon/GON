import fs from "node:fs";
import path from "node:path";
import { IDatabase } from "@aso/database";

const same = (a: string, b: string) => path.resolve(a) === path.resolve(b);

/** The first runner's active folder that is still granted and exists on disk, as an OS path. */
export async function resolveActiveWorkspacePath(db: IDatabase, workspaceId: string): Promise<string | null> {
  for (const runner of await db.runners.listForWorkspace(workspaceId)) {
    const active = runner.activePath;
    if (!active || !runner.allowedPaths.some((p) => same(p, active))) continue;
    const resolved = path.resolve(active);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}
