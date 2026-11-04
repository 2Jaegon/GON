import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir, getProjectRoot } from '../core/env.js';
import { parseSkillFile } from './parse-skill.js';
import { SkillEntry } from '../core/types.js';

interface RawDiscoveredSkill {
  id: string;
  name: string;
  source: 'builtin' | 'project' | 'user' | 'plugin' | 'ecc' | 'external';
  uri: string;
  description: string;
  contentHash: string;
}

export function discoverLocalSkills(options: { projectRoot?: string; homeDir?: string } = {}): RawDiscoveredSkill[] {
  const root = getProjectRoot(options.projectRoot);
  const home = options.homeDir || getHomeDir();
  const results: RawDiscoveredSkill[] = [];

  function scanSkillsDir(baseDir: string, source: 'project' | 'user' | 'plugin', prefix = ''): void {
    if (!fs.existsSync(baseDir)) return;
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
        const skillPath = path.join(baseDir, ent.name, 'SKILL.md');
        if (fs.existsSync(skillPath)) {
          const parsed = parseSkillFile(skillPath);
          if (parsed) {
            const id = prefix ? `${prefix}${parsed.name}` : parsed.name;
            results.push({
              id,
              name: parsed.name,
              source,
              uri: skillPath,
              description: parsed.description,
              contentHash: parsed.sha256,
            });
          }
        }
      }
    } catch {
      // ignore unreadable
    }
  }

  // 1. Project skills
  scanSkillsDir(path.join(root, '.claude', 'skills'), 'project');
  scanSkillsDir(path.join(root, '.agents', 'skills'), 'project');
  scanSkillsDir(path.join(root, '.gemini', 'skills'), 'project');

  // Plugins in project
  const projectPluginsDir = path.join(root, 'plugins');
  if (fs.existsSync(projectPluginsDir)) {
    try {
      const pEntries = fs.readdirSync(projectPluginsDir, { withFileTypes: true });
      for (const pEnt of pEntries) {
        if (!pEnt.isDirectory() || pEnt.isSymbolicLink()) continue;
        const pluginSkills = path.join(projectPluginsDir, pEnt.name, 'skills');
        scanSkillsDir(pluginSkills, 'project', `${pEnt.name}:`);
      }
    } catch {}
  }

  // 2. User skills
  scanSkillsDir(path.join(home, '.claude', 'skills'), 'user');
  scanSkillsDir(path.join(home, '.agents', 'skills'), 'user');
  scanSkillsDir(path.join(home, '.gemini', 'skills'), 'user');

  // 3. Installed Claude plugins
  const installedPluginsPath = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (fs.existsSync(installedPluginsPath)) {
    try {
      const content = fs.readFileSync(installedPluginsPath, 'utf8');
      const data = JSON.parse(content);
      // Installed plugins can be an object or array
      const pluginsObj = data.plugins || data;
      if (typeof pluginsObj === 'object' && pluginsObj !== null) {
        for (const [pluginKey, pluginInfo] of Object.entries(pluginsObj)) {
          const info = pluginInfo as any;
          const installPath = info?.installPath || info?.path;
          if (typeof installPath === 'string' && fs.existsSync(installPath)) {
            const pluginShortName = pluginKey.split('@')[0];
            const skillsDir = path.join(installPath, 'skills');
            scanSkillsDir(skillsDir, 'plugin', `${pluginShortName}:`);
          }
        }
      }
    } catch {
      // ignore plugin json read errors
    }
  }

  return results;
}

