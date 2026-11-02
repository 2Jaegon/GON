#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function sumUsage(texts) {
  const empty = {
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    messages: 0,
    cacheReadRatio: 0,
  };
  if (!Array.isArray(texts) || texts.length === 0) {
    return empty;
  }

  const byMsgId = new Map();
  let anonIndex = 0;

  for (const text of texts) {
    if (typeof text !== 'string' || !text) continue;
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const cleaned = rawLine.replace(/^\uFEFF+/, '').trim();
      if (!cleaned) continue;
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;

      const usage = parsed.message?.usage || parsed.usage;
      if (!usage || typeof usage !== 'object') continue;

      const hasTokenField =
        typeof usage.input_tokens === 'number' ||
        typeof usage.cache_creation_input_tokens === 'number' ||
        typeof usage.cache_read_input_tokens === 'number' ||
        typeof usage.output_tokens === 'number';
      if (!hasTokenField) continue;

      const msgId =
        parsed.message?.id ||
        parsed.id ||
        parsed.uuid ||
        `__anon_${(anonIndex += 1)}`;

      byMsgId.set(String(msgId), {
        input: Number(usage.input_tokens) || 0,
        cacheWrite: Number(usage.cache_creation_input_tokens) || 0,
        cacheRead: Number(usage.cache_read_input_tokens) || 0,
        output: Number(usage.output_tokens) || 0,
      });
    }
  }

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
    input,
    cacheWrite,
    cacheRead,
    output,
    messages,
    cacheReadRatio,
  };
}

function collectJsonlFiles(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) return [];
  const st = fs.lstatSync(resolved);
  if (st.isSymbolicLink()) return [];
  if (st.isFile()) {
    return resolved.endsWith('.jsonl') ? [resolved] : [];
  }
  if (st.isDirectory()) {
    const out = [];
    // Sorted so that last-wins dedupe across files does not depend on readdir order.
    const entries = fs.readdirSync(resolved, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      out.push(...collectJsonlFiles(path.join(resolved, entry.name)));
    }
    return out;
  }
  return [];
}

function describeBadTarget(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) return 'path not found';
  const st = fs.lstatSync(resolved);
  if (st.isSymbolicLink()) return 'links are not followed';
  if (st.isFile() && !resolved.endsWith('.jsonl')) return 'not a .jsonl file';
  if (!st.isFile() && !st.isDirectory()) return 'not a file or folder';
  return null;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error('Usage: node tools/measure-usage.mjs <file-or-dir>...');
    process.exit(1);
  }
  // A bad target must fail loudly: all-zero JSON with exit 0 would look like a real measurement.
  const files = [];
  for (const t of targets) {
    const problem = describeBadTarget(t);
    if (problem) {
      console.error(`Error: ${t}: ${problem}`);
      process.exit(2);
    }
    const found = collectJsonlFiles(t);
    if (found.length === 0) {
      console.error(`Error: ${t}: no .jsonl files found`);
      process.exit(2);
    }
    files.push(...found);
  }
  const texts = files.map((f) => fs.readFileSync(f, 'utf8'));
  const summary = sumUsage(texts);
  console.log(JSON.stringify(summary, null, 2));
}
