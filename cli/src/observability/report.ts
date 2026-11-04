import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from '../core/env.js';
import { Report, SkillOutcome, Mode } from '../core/types.js';
import { measureClaudeUsageForWindow } from './usage-claude.js';
import { measureCodexUsageForWindow } from './usage-codex.js';
import { estimateCost } from './pricing.js';

function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '진행 중';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min === 0) return `${remSec}s`;
  return `${min}m${remSec.toString().padStart(2, '0')}s`;
}

export function findLatestRunId(projectRoot?: string): string | null {
  const root = getProjectRoot(projectRoot);
  const gonDir = path.join(root, '.gon');
  if (!fs.existsSync(gonDir)) return null;
  try {
    const entries = fs.readdirSync(gonDir, { withFileTypes: true });
    const runDirs = entries
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && /^\d{8}-\d{4}-[0-9a-f]{4}$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a));
    return runDirs[0] || null;
  } catch {
    return null;
  }
}

export function generateRunReport(
  targetRun: string,
  options: { host?: 'claude' | 'codex'; projectRoot?: string; homeDir?: string } = {}
): { report: Report; summaryText: string } | null {
  const root = getProjectRoot(options.projectRoot);
  const runId = targetRun === 'latest' ? findLatestRunId(root) : targetRun;
  if (!runId) return null;

  const runDir = path.join(root, '.gon', runId);
  const eventsPath = path.join(runDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return null;

  const lines = fs.readFileSync(eventsPath, 'utf8').split(/\r?\n/);
  const events: any[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      events.push(JSON.parse(l.trim()));
    } catch {}
  }
  if (events.length === 0) return null;

  let mode: Mode = 'standard';
  let status: 'done' | 'failed' | 'running' | 'stalled' = 'running';
  let startedAt = '';
  let endedAt: string | null = null;
  const nodeMap = new Map<string, { id: string; stage: string; status: string; startMs: number; endMs: number | null }>();
  const allSkills = new Set<string>();

  for (const ev of events) {
    if (ev.ev === 'run.start') {
      startedAt = ev.t || '';
      if (ev.mode === 'fast' || ev.depth === 'quick') mode = 'fast';
      else if (ev.mode === 'deep' || ev.depth === 'deep') mode = 'deep';
      else mode = 'standard';
    } else if (ev.ev === 'run.end') {
      endedAt = ev.t || null;
      status = ev.status === 'failed' ? 'failed' : 'done';
    } else if (ev.ev === 'node' && ev.id) {
      const tMs = ev.t ? Date.parse(ev.t) : 0;
      let node = nodeMap.get(ev.id);
      if (!node) {
        node = {
          id: ev.id,
          stage: ev.stage || '',
          status: ev.status || 'running',
          startMs: tMs,
          endMs: null,
        };
        nodeMap.set(ev.id, node);
      } else {
        if (ev.stage) node.stage = ev.stage;
        if (ev.status) node.status = ev.status;
      }
      if (['done', 'failed', 'skipped'].includes(ev.status)) {
        node.endMs = tMs;
      }
      if (Array.isArray(ev.skills)) {
        for (const s of ev.skills) allSkills.add(s);
      }
    }
  }

  const startMs = startedAt ? Date.parse(startedAt) : 0;
  const endMs = endedAt ? Date.parse(endedAt) : null;
  const elapsedMs = startMs && endMs ? Math.max(0, endMs - startMs) : null;

  const nodes = Array.from(nodeMap.values()).map((n) => ({
    id: n.id,
    stage: n.stage,
    status: n.status,
    durationMs: n.endMs && n.startMs ? Math.max(0, n.endMs - n.startMs) : null,
  }));

  const host = options.host || 'claude';
  const usage =
    host === 'codex'
      ? measureCodexUsageForWindow(startedAt, endedAt || undefined, { projectRoot: root, homeDir: options.homeDir })
      : measureClaudeUsageForWindow(startedAt, endedAt || undefined, { projectRoot: root, homeDir: options.homeDir });

  const cost = estimateCost(usage, undefined, root);

  const report: Report = {
    v: 1,
    run: runId,
    mode,
    status,
    startedAt,
    endedAt,
    elapsedMs,
    nodes,
    usage,
    cost,
    generatedAt: new Date().toISOString(),
  };

  // Save report.json
  try {
    const reportPath = path.join(runDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  } catch {}

  // Append SkillOutcome if run ended
  if (status === 'done' || status === 'failed') {
    try {
      const outcomesPath = path.join(root, '.gon', 'outcomes.jsonl');
      let alreadyRecorded = false;
      if (fs.existsSync(outcomesPath)) {
        const outLines = fs.readFileSync(outcomesPath, 'utf8').split(/\r?\n/);
        for (const ol of outLines) {
          if (!ol.trim()) continue;
          try {
            if (JSON.parse(ol).runId === runId) {
              alreadyRecorded = true;
              break;
            }
          } catch {}
        }
      }
      if (!alreadyRecorded) {
        const outcome: SkillOutcome = {
          host,
          model: 'unknown',
          taskFingerprint: runId,
          taskMode: mode,
          skillIds: Array.from(allSkills),
          runId,
          verificationPassed: status === 'done',
          wallTimeMs: elapsedMs || 0,
          reportedTokens: usage.input !== null && usage.output !== null ? (usage.input || 0) + (usage.output || 0) : null,
          actualCostUsd: null,
          estimatedCostUsd: cost.estimatedUsd,
          retries: 0,
          defects: status === 'failed' ? 1 : 0,
        };
        fs.appendFileSync(outcomesPath, JSON.stringify(outcome) + '\n', 'utf8');
      }
    } catch {}
  }

  // Build human-friendly summary text
  const durationStr = formatDuration(elapsedMs);
  let usageStr = '';
  if (usage.source !== 'unknown' && usage.input !== null) {
    usageStr = `in ${formatTokens(usage.input)} · cw ${formatTokens(usage.cacheWrite)} · cr ${formatTokens(usage.cacheRead)} · out ${formatTokens(usage.output)} (${usage.source})`;
  } else {
    usageStr = '토큰 unknown (세션 로그 미검출)';
  }

  const costStr = cost.estimatedUsd !== null ? `$${cost.estimatedUsd}` : '비용 unknown';
  const summaryText = `⏱ ${durationStr} · ${usageStr} · ${costStr}`;

  return { report, summaryText };
}

