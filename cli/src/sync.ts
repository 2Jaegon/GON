import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getProjectRoot } from './core/env.js';

function computeSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function syncCanonicalSkills(options: { projectRoot?: string; checkOnly?: boolean } = {}): {
  ok: boolean;
  syncedFiles: string[];
  driftFiles: string[];
} {
  const root = getProjectRoot(options.projectRoot);
  const srcDir = path.join(root, 'plugins', 'gon', 'skills', 'gon');
  const destDirs = [
    path.join(root, '.agents', 'skills', 'gon'),
    path.join(root, '.claude', 'skills', 'gon'),
  ];

  if (!fs.existsSync(srcDir)) {
    return { ok: false, syncedFiles: [], driftFiles: [`소스 정본 디렉터리 없음: ${srcDir}`] };
  }

  function getFilesRecursively(dir: string, baseRel = ''): string[] {
    const list: string[] = [];
    if (!fs.existsSync(dir)) return list;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const relPath = baseRel ? `${baseRel}/${ent.name}` : ent.name;
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        list.push(...getFilesRecursively(fullPath, relPath));
      } else if (ent.isFile()) {
        list.push(relPath);
      }
    }
    return list;
  }

  const srcFiles = getFilesRecursively(srcDir);
  const driftFiles: string[] = [];
  const syncedFiles: string[] = [];

  for (const rel of srcFiles) {
    const srcFile = path.join(srcDir, rel);
    const srcHash = computeSha256(srcFile);

    for (const destDir of destDirs) {
      const destFile = path.join(destDir, rel);
      if (fs.existsSync(destFile)) {
        const destHash = computeSha256(destFile);
        if (srcHash !== destHash) {
          driftFiles.push(path.relative(root, destFile).replace(/\\/g, '/'));
        }
      } else {
        driftFiles.push(path.relative(root, destFile).replace(/\\/g, '/'));
      }
    }
  }

  if (options.checkOnly) {
    return {
      ok: driftFiles.length === 0,
      syncedFiles: [],
      driftFiles,
    };
  }

  // Perform actual sync
  for (const rel of srcFiles) {
    const srcFile = path.join(srcDir, rel);
    for (const destDir of destDirs) {
      const destFile = path.join(destDir, rel);
      const targetFolder = path.dirname(destFile);
      if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
      }
      fs.copyFileSync(srcFile, destFile);
      syncedFiles.push(path.relative(root, destFile).replace(/\\/g, '/'));
    }
  }

  return {
    ok: true,
    syncedFiles,
    driftFiles: [],
  };
}

