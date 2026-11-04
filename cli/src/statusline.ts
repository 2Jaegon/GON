import fs from 'node:fs';
import path from 'node:path';
import { sumTranscriptFile } from './observability/usage-claude.js';
import { findLatestRunId } from './observability/report.js';

function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return '0s';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min === 0) return `${remSec}s`;
  return `${min}m${remSec.toString().padStart(2, '0')}s`;
}

export function generateStatusLine(inputJson: string): string {
  try {
    const data = JSON.parse(inputJson || '{}');

    // 1. Elapsed duration
    const durationMs = Number(data.cost?.total_duration_ms) || 0;
    const durStr = `⏱ ${formatDuration(durationMs)}`;

    // 2. Token usage
    let tokenStr = 'tok ?';
    const transcriptPath = data.transcript_path;
    if (transcriptPath && typeof transcriptPath === 'string' && fs.existsSync(transcriptPath)) {
      const u = sumTranscriptFile(transcriptPath);
      if (u && u.input !== null) {
        tokenStr = `in ${formatTokens(u.input)} · cw ${formatTokens(u.cacheWrite)} · cr ${formatTokens(u.cacheRead)} · out ${formatTokens(u.output)}`;
      }
    } else if (data.context_window) {
      const inTok = data.context_window.total_input_tokens;
      const outTok = data.context_window.total_output_tokens;
      if (typeof inTok === 'number' || typeof outTok === 'number') {
        tokenStr = `in ${formatTokens(inTok)} · out ${formatTokens(outTok)}`;
      }
    }

    // 3. Cost from Claude Code
    const costUsd = data.cost?.total_cost_usd;
    const costStr = typeof costUsd === 'number' ? `$${costUsd.toFixed(2)} (CC 집계)` : '$0.00 (CC 집계)';

    // 4. Active Gon run badge
    let gonBadge = '';
    const projDir = data.workspace?.project_dir || data.cwd || process.cwd();
    const latestRun = findLatestRunId(projDir);
    if (latestRun) {
      try {
        const eventsPath = path.join(projDir, '.gon', latestRun, 'events.jsonl');
        if (fs.existsSync(eventsPath)) {
          const lines = fs.readFileSync(eventsPath, 'utf8').split(/\r?\n/);
          let startedAt = '';
          let ended = false;
          let mode = 'standard';
          let lastMs = 0;

          for (const l of lines) {
            if (!l.trim()) continue;
            try {
              const ev = JSON.parse(l.trim());
              if (ev.ev === 'run.start') {
                startedAt = ev.t;
                mode = ev.mode || (ev.depth === 'quick' ? 'fast' : ev.depth === 'deep' ? 'deep' : 'standard');
              }
              if (ev.ev === 'run.end') ended = true;
              if (ev.t) {
                const tMs = Date.parse(ev.t);
                if (!Number.isNaN(tMs) && tMs > lastMs) lastMs = tMs;
              }
            } catch {}
          }

          const now = Date.now();
          if (!ended && startedAt && (now - lastMs < 10 * 60 * 1000)) {
            const startMs = Date.parse(startedAt);
            const runElapsed = Math.max(0, now - startMs);
            gonBadge = ` · ▶ gon ${mode} ${formatDuration(runElapsed)}`;
          }
        }
      } catch {}
    }

    return `${durStr} · ${tokenStr} · ${costStr}${gonBadge}`;
  } catch {
    return '⏱ 0s · tok ? · $0.00 (CC 집계)';
  }
}

