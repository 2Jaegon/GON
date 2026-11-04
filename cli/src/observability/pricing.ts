import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from '../core/env.js';
import { Usage, Cost } from '../core/types.js';

interface ModelPrice {
  inputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
  outputPerMillion: number;
}

export function estimateCost(usage: Usage, modelId?: string, projectRoot?: string): Cost {
  const root = getProjectRoot(projectRoot);
  const pricingPath = path.join(root, 'config', 'pricing-snapshot.json');

  const unknownCost: Cost = {
    estimatedUsd: null,
    source: 'unknown',
    note: '단가 정보 없음(환산 비용 미집계)',
  };

  if (!fs.existsSync(pricingPath)) return unknownCost;
  if (!usage || usage.input === null || usage.output === null) return unknownCost;

  try {
    const data = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
    const models: Record<string, ModelPrice> = data?.models || {};

    const modelKey = modelId || Object.keys(models)[0];
    if (!modelKey || !models[modelKey]) return unknownCost;

    const p = models[modelKey];
    const cost =
      ((usage.input || 0) / 1e6) * p.inputPerMillion +
      ((usage.cacheWrite || 0) / 1e6) * p.cacheWritePerMillion +
      ((usage.cacheRead || 0) / 1e6) * p.cacheReadPerMillion +
      ((usage.output || 0) / 1e6) * p.outputPerMillion;

    return {
      estimatedUsd: Number(cost.toFixed(4)),
      source: 'pricing_estimate',
      note: `모델: ${modelKey} 기준 추정 환산 비용 (실제 청구액과 다를 수 있음)`,
    };
  } catch {
    return unknownCost;
  }
}

