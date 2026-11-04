import { describe, it, expect } from 'vitest';
import { routeSkills } from '../../cli/src/core/router.js';
import { SkillEntry } from '../../cli/src/core/types.js';

describe('routeSkills', () => {
  const dummySkills: SkillEntry[] = [
    {
      id: 'gon:gon',
      name: 'gon',
      source: 'project',
      uri: '/fake/SKILL.md',
      description: 'Single top-level orchestrator',
      capabilities: ['orchestration'],
      phases: ['refine', 'plan', 'route', 'approve', 'execute', 'verify'],
      supportedHosts: ['claude'],
      triggers: [],
      exclusions: [],
      conflictsWith: [],
      prerequisites: [],
      permissionRisk: 'low',
      approved: true,
      invocation: 'explicit',
      estimatedContextTokens: 200,
      enabled: true,
    },
    {
      id: 'ecc:security-review',
      name: 'security-review',
      source: 'ecc',
      uri: '/fake/ecc/SKILL.md',
      description: 'Security audit',
      capabilities: ['security'],
      phases: ['verify'],
      supportedHosts: ['claude'],
      triggers: [],
      exclusions: [],
      conflictsWith: [],
      prerequisites: [],
      permissionRisk: 'low',
      approved: true,
      invocation: 'explicit',
      estimatedContextTokens: 600,
      enabled: true,
    },
    {
      id: 'ecc:high-risk-tool',
      name: 'high-risk',
      source: 'ecc',
      uri: '/fake/risk/SKILL.md',
      description: 'High risk capability',
      capabilities: ['security'],
      phases: ['verify'],
      supportedHosts: ['claude'],
      triggers: [],
      exclusions: [],
      conflictsWith: [],
      prerequisites: [],
      permissionRisk: 'high',
      approved: true,
      invocation: 'explicit',
      estimatedContextTokens: 600,
      enabled: true,
    },
  ];

  it('filters by phase and selects appropriate skill', () => {
    const res = routeSkills(dummySkills, {
      phase: 'verify',
      capabilities: ['security'],
      mode: 'standard',
    });
    expect(res.selected.some((s) => s.id === 'ecc:security-review')).toBe(true);
    expect(res.capabilityMissing).toBe(false);
  });

  it('blocks permissionRisk high skills regardless of score', () => {
    const res = routeSkills(dummySkills, {
      phase: 'verify',
      capabilities: ['security'],
      mode: 'standard',
    });
    expect(res.selected.some((s) => s.id === 'ecc:high-risk-tool')).toBe(false);
    expect(res.excluded.some((e) => e.id === 'ecc:high-risk-tool')).toBe(true);
  });

  it('caps fast mode at 1 skill', () => {
    const res = routeSkills(dummySkills, {
      phase: 'verify',
      mode: 'fast',
    });
    expect(res.selected.length).toBeLessThanOrEqual(1);
  });

  it('flags capabilityMissing when required capability has no candidate', () => {
    const res = routeSkills(dummySkills, {
      phase: 'plan',
      capabilities: ['quantum-computing'],
      mode: 'standard',
    });
    expect(res.capabilityMissing).toBe(true);
    expect(res.discoveryRecommendation).toContain('find-skills');
  });
});

