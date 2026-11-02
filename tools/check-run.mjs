#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEvents, buildRun, validateRun } from '../plugins/gon/viewer/events.mjs';

const SECRET_PATTERNS = [
  { name: 'OpenAI/API key (sk-)', re: /\bsk-[A-Za-z0-9_-]{8,}/ },
  { name: 'AWS Access Key (AKIA)', re: /\bAKIA[0-9A-Z]{12,}/ },
  { name: 'Private Key (-----BEGIN)', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Password assignment (password=)', re: /password\s*=\s*\S+/i },
];

function isSafeRelPath(rel) {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  if (rel.includes('\0') || rel.includes('\\') || rel.includes(':')) return false;
  if (path.isAbsolute(rel) || rel.startsWith('/')) return false;
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false;
  return true;
}

export function checkRunDir(runDir) {
  const errors = [];
  const warnings = [];
  const resolvedRunDir = path.resolve(runDir);
  const runId = path.basename(resolvedRunDir);
  const eventsPath = path.join(resolvedRunDir, 'events.jsonl');

  if (!fs.existsSync(eventsPath)) {
    return { ok: false, errors: [`Missing events.jsonl in ${resolvedRunDir}`], warnings };
  }

  function inspectFileBytes(filePath, label) {
    let buf;
    try {
      buf = fs.readFileSync(filePath);
    } catch (err) {
      errors.push(`${label}: failed to read file (${err.message})`);
      return '';
    }
    if (buf.includes(0x00)) {
      errors.push(`${label}: contains NUL byte (0x00)`);
    }
    const text = buf.toString('utf8');
    if (text.includes('\uFFFD')) {
      errors.push(`${label}: contains replacement character U+FFFD (broken encoding)`);
    }
    for (const pat of SECRET_PATTERNS) {
      if (pat.re.test(text)) {
        warnings.push(`WARN: ${label} matches secret pattern "${pat.name}"`);
      }
    }
    return text;
  }

  const eventsText = inspectFileBytes(eventsPath, 'events.jsonl');
  const { events, skipped } = parseEvents(eventsText);
  if (skipped > 0) {
    errors.push(`events.jsonl: ${skipped} broken line(s) skipped`);
  }

  const validation = validateRun(events, { runId });
  errors.push(...validation.errors);

  const run = buildRun(runId, events);
  for (const node of run.nodes) {
    if (node.out !== undefined) {
      if (!isSafeRelPath(node.out) || !node.out.endsWith('.md')) {
        errors.push(`node "${node.id}": out "${node.out}" must be a relative .md path inside runDir`);
      } else {
        const outFull = path.resolve(resolvedRunDir, node.out);
        const rel = path.relative(resolvedRunDir, outFull);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          errors.push(`node "${node.id}": out "${node.out}" escapes runDir`);
        } else if (fs.existsSync(outFull)) {
          inspectFileBytes(outFull, node.out);
        } else {
          errors.push(`node "${node.id}": out file "${node.out}" does not exist`);
        }
      }
    }
    if (Array.isArray(node.files)) {
      for (const f of node.files) {
        if (!isSafeRelPath(f)) {
          errors.push(`node "${node.id}": unsafe relative path in files: "${f}"`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node tools/check-run.mjs <runDir>');
    process.exit(1);
  }
  let result;
  try {
    result = checkRunDir(target);
  } catch (err) {
    console.error(`ERROR: check-run failed: ${err?.message || 'unknown error'}`);
    process.exit(1);
  }
  for (const w of result.warnings) {
    console.log(w);
  }
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`ERROR: ${err}`);
    }
    process.exit(1);
  }
  console.log(`OK: ${path.basename(path.resolve(target))}`);
}
