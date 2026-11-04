import fs from 'node:fs';
import path from 'node:path';
import { SkillEntry, Phase } from '../core/types.js';
import { getProjectRoot } from '../core/env.js';

export function enrichWithCatalog(
  rawSkills: Array<{
    id: string;
    name: string;
    source: 'builtin' | 'project' | 'user' | 'plugin' | 'ecc' | 'external';
    uri: string;
    description: string;
    contentHash: string;
  }>,
  projectRoot?: string
): SkillEntry[] {
  const root = getProjectRoot(projectRoot);
  const catalogPath = path.join(root, 'config', 'skill-catalog.json');
  let overrides: Record<string, Partial<SkillEntry>> = {};

  if (fs.existsSync(catalogPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      if (data?.skills && typeof data.skills === 'object') {
        overrides = data.skills;
      }
    } catch {}
  }

  return rawSkills.map((raw) => {
    const override = overrides[raw.id] || overrides[raw.name] || {};

    const capabilities: string[] = override.capabilities || [];
    if (capabilities.length === 0) {
      const descLower = (raw.description + ' ' + raw.name).toLowerCase();
      if (/sec|auth|audit|vulnerab/i.test(descLower)) capabilities.push('security');
      if (/api|rest|graphql|contract/i.test(descLower)) capabilities.push('api-design');
      if (/test|verify|spec|e2e/i.test(descLower)) capabilities.push('verification');
      if (/review|lint|quality/i.test(descLower)) capabilities.push('code-review');
      if (/plan|design|architect/i.test(descLower)) capabilities.push('planning');
      if (/search|discover|find/i.test(descLower)) capabilities.push('discovery');
      if (capabilities.length === 0) capabilities.push('general');
    }

    const phases: Phase[] = override.phases || [];
    if (phases.length === 0) {
      const descLower = (raw.description + ' ' + raw.name).toLowerCase();
      if (/plan|brainstorm|architect/i.test(descLower)) phases.push('plan');
      if (/test|verify|audit|review/i.test(descLower)) phases.push('verify');
      if (/grill|interview|clarify|refine/i.test(descLower)) phases.push('refine');
      if (/discover|search|find/i.test(descLower)) phases.push('route');
      if (phases.length === 0) phases.push('execute');
    }

    let estimatedTokens = 500;
    try {
      if (fs.existsSync(raw.uri)) {
        const sz = fs.statSync(raw.uri).size;
        estimatedTokens = Math.max(100, Math.round(sz / 4));
      }
    } catch {}

    const entry: SkillEntry = {
      id: raw.id,
      name: raw.name,
      source: raw.id.startsWith('ecc:') ? 'ecc' : raw.source,
      uri: raw.uri,
      contentHash: raw.contentHash,
      description: raw.description,
      capabilities,
      phases,
      supportedHosts: override.supportedHosts || ['claude', 'codex', 'gemini'],
      triggers: override.triggers || [],
      exclusions: override.exclusions || [],
      conflictsWith: override.conflictsWith || [],
      prerequisites: override.prerequisites || [],
      permissionRisk: override.permissionRisk || 'low',
      approved: override.approved !== undefined ? override.approved : true,
      invocation: override.invocation || 'explicit',
      estimatedContextTokens: estimatedTokens,
      enabled: override.enabled !== undefined ? override.enabled : true,
    };

    return entry;
  });
}

