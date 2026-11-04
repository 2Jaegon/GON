import fs from 'node:fs';
import path from 'node:path';
import { SkillEntry, Phase, Mode } from './types.js';
import { getProjectRoot } from './env.js';

export interface RouteQuery {
  phase: Phase;
  capabilities?: string[];
  stack?: string;
  mode?: Mode;
  projectRoot?: string;
}

export interface RouteResult {
  selected: SkillEntry[];
  excluded: Array<{ id: string; reason: string }>;
  capabilityMissing: boolean;
  discoveryRecommendation?: string;
}

function getPastSuccessPrior(skillId: string, outcomesPath: string): number {
  if (!fs.existsSync(outcomesPath)) return 0.5;
  try {
    const lines = fs.readFileSync(outcomesPath, 'utf8').split(/\r?\n/);
    let total = 0;
    let passed = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      if (Array.isArray(data.skillIds) && data.skillIds.includes(skillId)) {
        total += 1;
        if (data.verificationPassed) passed += 1;
      }
    }
    if (total < 3) return 0.5;
    return passed / total;
  } catch {
    return 0.5;
  }
}

export function routeSkills(skills: SkillEntry[], query: RouteQuery): RouteResult {
  const root = getProjectRoot(query.projectRoot);
  const outcomesPath = path.join(root, '.gon', 'outcomes.jsonl');
  const mode = query.mode || 'standard';
  const targetCaps = (query.capabilities || []).map((c) => c.toLowerCase());

  const maxSelected = mode === 'fast' ? 1 : mode === 'standard' ? 3 : 4;

  const excluded: Array<{ id: string; reason: string }> = [];
  const scored: Array<{ skill: SkillEntry; score: number }> = [];

  for (const sk of skills) {
    if (!sk.enabled) {
      excluded.push({ id: sk.id, reason: '비활성화됨 (disabled)' });
      continue;
    }
    if (!sk.approved) {
      excluded.push({ id: sk.id, reason: '사용자 미승인 (unapproved)' });
      continue;
    }
    if (sk.permissionRisk === 'high') {
      excluded.push({ id: sk.id, reason: '위험 권한 요구 (permissionRisk high)' });
      continue;
    }
    if (!sk.phases.includes(query.phase)) {
      excluded.push({ id: sk.id, reason: `요청 단계 불일치 (${query.phase} not in ${sk.phases.join(',')})` });
      continue;
    }

    // Capability match
    const matchingCaps = targetCaps.filter((c) => sk.capabilities.some((sc) => sc.toLowerCase().includes(c)));
    const capMatchScore = targetCaps.length > 0 ? matchingCaps.length / targetCaps.length : 0.5;

    // Stack match
    const stackMatchScore = query.stack && sk.description.toLowerCase().includes(query.stack.toLowerCase()) ? 1.0 : 0.0;

    // Past success
    const pastSuccess = getPastSuccessPrior(sk.id, outcomesPath);

    // Context cost penalty: 500 tokens = ~0.1, 2000 tokens = ~0.4
    const contextTokens = sk.estimatedContextTokens || 500;
    const contextPenalty = Math.min(1.0, contextTokens / 2500);

    // Score formula (spec 4.2)
    const score =
      0.35 * capMatchScore +
      0.25 * 1.0 + // phase matched
      0.15 * stackMatchScore +
      0.15 * pastSuccess +
      0.10 * (sk.triggers.length > 0 ? 1.0 : 0.0) -
      0.15 * contextPenalty;

    scored.push({ skill: sk, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const selected: SkillEntry[] = [];
  for (const item of scored) {
    if (selected.length < maxSelected) {
      selected.push(item.skill);
    } else {
      excluded.push({ id: item.skill.id, reason: `모드별 한도 초과 (max: ${maxSelected})` });
    }
  }

  // Capability missing check
  let capabilityMissing = false;
  let discoveryRecommendation: string | undefined;

  if (targetCaps.length > 0) {
    const coveredCaps = new Set<string>();
    for (const sk of selected) {
      for (const sc of sk.capabilities) {
        coveredCaps.add(sc.toLowerCase());
      }
    }
    const missing = targetCaps.filter((tc) => !Array.from(coveredCaps).some((cc) => cc.includes(tc)));
    if (missing.length > 0) {
      capabilityMissing = true;
      discoveryRecommendation = `find-skills (필요 역량 "${missing.join(', ')}" 미보유; 후보 탐색만 지원, 자동 설치 없음)`;
    }
  }

  return {
    selected,
    excluded,
    capabilityMissing,
    discoveryRecommendation,
  };
}

