import fs from 'node:fs';
import path from 'node:path';
import { SkillEntry } from '../core/types.js';
import { getProjectRoot } from '../core/env.js';
import { discoverLocalSkills } from './discover.js';
import { enrichWithCatalog } from './catalog.js';
import { resolveConflicts } from './conflicts.js';

interface RegistryCacheData {
  version: number;
  timestamp: string;
  skills: SkillEntry[];
  warnings: string[];
}

export function getOrBuildRegistry(options: { projectRoot?: string; forceRefresh?: boolean } = {}): {
  skills: SkillEntry[];
  warnings: string[];
} {
  const root = getProjectRoot(options.projectRoot);
  const gonDir = path.join(root, '.gon');
  const cachePath = path.join(gonDir, 'registry-cache.json');

  if (!options.forceRefresh && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as RegistryCacheData;
      if (cached.version === 1 && Array.isArray(cached.skills)) {
        return { skills: cached.skills, warnings: cached.warnings || [] };
      }
    } catch {}
  }

  const raw = discoverLocalSkills({ projectRoot: root });
  const enriched = enrichWithCatalog(raw, root);
  const { skills, warnings } = resolveConflicts(enriched, root);

  try {
    if (!fs.existsSync(gonDir)) {
      fs.mkdirSync(gonDir, { recursive: true });
    }
    const data: RegistryCacheData = {
      version: 1,
      timestamp: new Date().toISOString(),
      skills,
      warnings,
    };
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {}

  return { skills, warnings };
}

