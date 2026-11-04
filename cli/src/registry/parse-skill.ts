import fs from 'node:fs';
import crypto from 'node:crypto';

export interface ParsedSkillMetadata {
  name: string;
  description: string;
  sha256: string;
}

export function parseSkillFile(filePath: string): ParsedSkillMetadata | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;

    const fullContent = fs.readFileSync(filePath);
    const sha256 = crypto.createHash('sha256').update(fullContent).digest('hex');

    // Read frontmatter from first 8KB
    const headText = fullContent.subarray(0, 8192).toString('utf8');
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(headText);

    let name = '';
    let description = '';

    if (fmMatch) {
      const yaml = fmMatch[1];
      const nameMatch = /^name:\s*(.+)$/m.exec(yaml);
      if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');

      const descMatch = /^description:\s*(.+)$/m.exec(yaml);
      if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    if (!name) {
      // fallback to parent folder name
      const parts = filePath.split(/[/\\]/);
      name = parts[parts.length - 2] || 'unknown';
    }

    return { name, description, sha256 };
  } catch {
    return null;
  }
}

