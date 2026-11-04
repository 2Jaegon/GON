import fs from 'node:fs';
import path from 'node:path';
import { SkillEntry } from '../core/types.js';
import { getProjectRoot } from '../core/env.js';

export interface ConflictResolutionResult {
  skills: SkillEntry[];
  warnings: string[];
}

export function resolveConflicts(skills: SkillEntry[], projectRoot?: string): ConflictResolutionResult {
  const root = getProjectRoot(projectRoot);
  const conflictRulesPath = path.join(root, 'config', 'policies', 'conflict-rules.json');
  const warnings: string[] = [];

  let prohibitedSkills: string[] = ['ecc:master-planner', 'ecc:orchestrator', 'ecc:council'];
  if (fs.existsSync(conflictRulesPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(conflictRulesPath, 'utf8'));
      if (Array.isArray(data.prohibitedSkills)) {
        prohibitedSkills = data.prohibitedSkills;
      }
    } catch {}
  }

  // Deduplicate by name/id keeping project > user > plugin
  const sourcePriority: Record<string, number> = {
    project: 3,
    user: 2,
    plugin: 1,
    builtin: 0,
    ecc: 0,
    external: 0,
  };

  const byId = new Map<string, SkillEntry>();

  for (const sk of skills) {
    // Check prohibited
    if (prohibitedSkills.some((p) => sk.id === p || (p.endsWith('*') && sk.id.startsWith(p.slice(0, -1))))) {
      warnings.push(`스킬 "${sk.id}"는 정책상 비활성화 대상(prohibited)이므로 제외되었습니다.`);
      continue;
    }

    const existing = byId.get(sk.id);
    if (!existing) {
      byId.set(sk.id, sk);
    } else {
      const pExisting = sourcePriority[existing.source] || 0;
      const pCurrent = sourcePriority[sk.source] || 0;
      if (pCurrent > pExisting) {
        warnings.push(`중복 스킬 "${sk.id}": ${sk.source} 우선순위 적용 (${existing.source} 대체)`);
        byId.set(sk.id, sk);
      } else {
        warnings.push(`중복 스킬 "${sk.id}": 기존 ${existing.source} 유지 (${sk.source} 무시)`);
      }
    }
  }

  return {
    skills: Array.from(byId.values()),
    warnings,
  };
}

