import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir, getProjectRoot } from '../core/env.js';
import { Usage } from '../core/types.js';

function normalizePath(p: string): string {
  return path.resolve(p).toLowerCase().replace(/\\/g, '/');
}

export function parseJsonlUsage(lines: string[]): {
  byMsgId: Map<string, { input: number; cacheWrite: number; cacheRead: number; output: number }>;
} {
  const byMsgId = new Map<string, { input: number; cacheWrite: number; cacheRead: number; output: number }>();
  let anonIndex = 0;

  for (const rawLine of lines) {
    const cleaned = rawLine.replace(/^\uFEFF+/, '').trim();
    if (!cleaned) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;

    const usage = parsed.message?.usage || parsed.usage;
    if (!usage || typeof usage !== 'object') continue;

    const msgId = parsed.message?.id || parsed.id || parsed.uuid || `__anon_${(anonIndex += 1)}`;
    byMsgId.set(String(msgId), {
      input: Number(usage.input_tokens) || 0,
      cacheWrite: Number(usage.cache_creation_input_tokens) || 0,
      cacheRead: Number(usage.cache_read_input_tokens) || 0,
      output: Number(usage.output_tokens) || 0,
    });
  }

  return { byMsgId };
}

export function sumTranscriptFile(filePath: string): Usage | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const { byMsgId } = parseJsonlUsage(content.split(/\r?\n/));
    if (byMsgId.size === 0) return null;

    let input = 0;
    let cacheWrite = 0;
    let cacheRead = 0;
    let output = 0;

    for (const u of byMsgId.values()) {
      input += u.input;
      cacheWrite += u.cacheWrite;
      cacheRead += u.cacheRead;
      output += u.output;
    }

    const messages = byMsgId.size;
    const totalInput = input + cacheWrite + cacheRead;
    const cacheReadRatio = totalInput > 0 ? cacheRead / totalInput : 0;

    return {
      source: 'claude-session-log',
      input,
      cacheWrite,
      cacheRead,
      output,
      messages,
      cacheReadRatio,
      files: 1,
    };
  } catch {
    return null;
  }
}

export function measureClaudeUsageForWindow(
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
  const projectsDir = path.join(home, '.claude', 'projects');

  if (!fs.existsSync(projectsDir)) return unknownUsage;

  const startMs = Date.parse(startTimeIso);
  const endMs = endTimeIso ? Date.parse(endTimeIso) : Date.now();
  if (Number.isNaN(startMs)) return unknownUsage;

  const normRoot = normalizePath(root);
  const byMsgId = new Map<string, { input: number; cacheWrite: number; cacheRead: number; output: number }>();
  let matchedFilesCount = 0;

  function scanDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isSymbolicLink()) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          scanDir(full);
        } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
          processFile(full);
        }
      }
    } catch {}
  }

  function processFile(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      // If file was not modified after start time minus 1 min, skip
      if (stat.mtimeMs < startMs - 60000) return;

      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      let fileMatches = false;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim());
          // Check cwd match if present
          const lineCwd = parsed.cwd || parsed.workspace?.project_dir;
          if (lineCwd && normalizePath(lineCwd) !== normRoot) {
            continue;
          }

          // Check timestamp window if present
          const lineTs = parsed.timestamp || parsed.t;
          if (lineTs) {
            const tMs = Date.parse(lineTs);
            if (!Number.isNaN(tMs) && (tMs < startMs || tMs > endMs + 5000)) {
              continue;
            }
          }

          const usage = parsed.message?.usage || parsed.usage;
          if (!usage) continue;

          const msgId = parsed.message?.id || parsed.id || parsed.uuid;
          if (!msgId) continue;

          byMsgId.set(String(msgId), {
            input: Number(usage.input_tokens) || 0,
            cacheWrite: Number(usage.cache_creation_input_tokens) || 0,
            cacheRead: Number(usage.cache_read_input_tokens) || 0,
            output: Number(usage.output_tokens) || 0,
          });
          fileMatches = true;
        } catch {}
      }

      if (fileMatches) matchedFilesCount += 1;
    } catch {}
  }

  scanDir(projectsDir);

  if (byMsgId.size === 0) return unknownUsage;

  let input = 0;
  let cacheWrite = 0;
  let cacheRead = 0;
  let output = 0;

  for (const u of byMsgId.values()) {
    input += u.input;
    cacheWrite += u.cacheWrite;
    cacheRead += u.cacheRead;
    output += u.output;
  }

  const messages = byMsgId.size;
  const totalInput = input + cacheWrite + cacheRead;
  const cacheReadRatio = totalInput > 0 ? cacheRead / totalInput : 0;

  return {
    source: 'claude-session-log',
    input,
    cacheWrite,
    cacheRead,
    output,
    messages,
    cacheReadRatio,
    files: matchedFilesCount,
  };
}

