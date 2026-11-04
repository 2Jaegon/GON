import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir, getProjectRoot } from '../core/env.js';
import { Usage } from '../core/types.js';

function normalizePath(p: string): string {
  return path.resolve(p).toLowerCase().replace(/\\/g, '/');
}

export function measureCodexUsageForWindow(
  startTimeIso: string,
  endTimeIso?: string,
  options: { projectRoot?: string; homeDir?: string } = {}
): Usage {
  const unknownUsage: Usage = {
    source: 'unknown',
    input: null,
    cacheWrite: null,
    cacheRead: null,
    output: null,
    messages: null,
    cacheReadRatio: null,
    files: null,
  };

  const root = getProjectRoot(options.projectRoot);
  const home = options.homeDir || getHomeDir();
  const sessionsDir = path.join(home, '.codex', 'sessions');

  if (!fs.existsSync(sessionsDir)) return unknownUsage;

  const startMs = Date.parse(startTimeIso);
  const endMs = endTimeIso ? Date.parse(endTimeIso) : Date.now();
  if (Number.isNaN(startMs)) return unknownUsage;

  const normRoot = normalizePath(root);
  let totalInput = 0;
  let totalCacheWrite = 0;
  let totalCacheRead = 0;
  let totalOutput = 0;
  let eventCount = 0;
  let matchedFiles = 0;

  function scanDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isSymbolicLink()) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          scanDir(full);
        } else if (ent.isFile() && ent.name.startsWith('rollout-') && ent.name.endsWith('.jsonl')) {
          processCodexFile(full);
        }
      }
    } catch {}
  }

  function processCodexFile(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < startMs - 60000) return;

      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      let sessionCwdMatches = false;

      let baselineUsage: any = null;
      let finalUsage: any = null;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed.type === 'session_meta' && parsed.payload?.cwd) {
            if (normalizePath(parsed.payload.cwd) === normRoot) {
              sessionCwdMatches = true;
            }
          }

          if (parsed.type === 'event_msg' && parsed.payload?.type === 'token_count') {
            const tMs = parsed.timestamp ? Date.parse(parsed.timestamp) : 0;
            const usageInfo = parsed.payload.info?.total_token_usage;
            if (!usageInfo) continue;

            if (tMs <= startMs) {
              baselineUsage = usageInfo;
            }
            if (tMs >= startMs && tMs <= endMs + 5000) {
              finalUsage = usageInfo;
              eventCount += 1;
            }
          }
        } catch {}
      }

      if (sessionCwdMatches && finalUsage) {
        matchedFiles += 1;
        const bIn = Number(baselineUsage?.input_tokens) || 0;
        const bCached = Number(baselineUsage?.cached_input_tokens) || 0;
        const bWrite = Number(baselineUsage?.cache_write_input_tokens) || 0;
        const bOut = Number(baselineUsage?.output_tokens) || 0;

        const fIn = Number(finalUsage.input_tokens) || 0;
        const fCached = Number(finalUsage.cached_input_tokens) || 0;
        const fWrite = Number(finalUsage.cache_write_input_tokens) || 0;
        const fOut = Number(finalUsage.output_tokens) || 0;

        const deltaTotalIn = Math.max(0, fIn - bIn);
        const deltaCached = Math.max(0, fCached - bCached);
        const deltaWrite = Math.max(0, fWrite - bWrite);
        const deltaOut = Math.max(0, fOut - bOut);

        const deltaRawIn = Math.max(0, deltaTotalIn - deltaCached);

        totalInput += deltaRawIn;
        totalCacheRead += deltaCached;
        totalCacheWrite += deltaWrite;
        totalOutput += deltaOut;
      }
    } catch {}
  }

  scanDir(sessionsDir);

  if (matchedFiles === 0 && eventCount === 0) return unknownUsage;

  const totalInAll = totalInput + totalCacheWrite + totalCacheRead;
  const ratio = totalInAll > 0 ? totalCacheRead / totalInAll : 0;

  return {
    source: 'codex-session-log',
    input: totalInput,
    cacheWrite: totalCacheWrite,
    cacheRead: totalCacheRead,
    output: totalOutput,
    messages: eventCount,
    cacheReadRatio: ratio,
    files: matchedFiles,
  };
}

