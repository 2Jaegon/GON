import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getHomeDir, getProjectRoot } from './core/env.js';
import { syncCanonicalSkills } from './sync.js';

export interface DoctorReport {
  clis: {
    claude: { installed: boolean; version?: string };
    codex: { installed: boolean; version?: string };
    gemini: { installed: boolean; version?: string };
  };
  claudeSettings: {
    found: boolean;
    enabledPlugins: string[];
    eccHooksEnabled: boolean;
    eccHookProfile: string;
    hookEvents: string[];
  };
  skillsDrift: string[];
  recommendations: string[];
}

export type VersionRunner = (cmd: string) => Promise<string | null>;

export async function defaultVersionRunner(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const exe = isWin ? 'cmd.exe' : cmd;
    const args = isWin ? ['/d', '/s', '/c', `${cmd} --version`] : ['--version'];

    const child = spawn(exe, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    });

    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim().split(/\r?\n/)[0]);
      } else {
        resolve(null);
      }
    });
  });
}

export async function runDoctor(
  options: { projectRoot?: string; homeDir?: string; runner?: VersionRunner } = {}
): Promise<DoctorReport> {
  const root = getProjectRoot(options.projectRoot);
  const home = options.homeDir || getHomeDir();
  const runner = options.runner || defaultVersionRunner;

  const [claudeVer, codexVer, geminiVer] = await Promise.all([
    runner('claude'),
    runner('codex'),
    runner('gemini'),
  ]);

  const report: DoctorReport = {
    clis: {
      claude: { installed: Boolean(claudeVer), version: claudeVer || undefined },
      codex: { installed: Boolean(codexVer), version: codexVer || undefined },
      gemini: { installed: Boolean(geminiVer), version: geminiVer || undefined },
    },
    claudeSettings: {
      found: false,
      enabledPlugins: [],
      eccHooksEnabled: false,
      eccHookProfile: 'unknown',
      hookEvents: [],
    },
    skillsDrift: [],
    recommendations: [],
  };

  // Inspect Claude settings
  const settingsPath = path.join(home, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    report.claudeSettings.found = true;
    try {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (data.enabledPlugins && typeof data.enabledPlugins === 'object') {
        report.claudeSettings.enabledPlugins = Object.keys(data.enabledPlugins).filter(
          (k) => data.enabledPlugins[k] === true
        );
      }

      const eccCfg = data.pluginConfigs?.['ecc@ecc']?.options;
      if (eccCfg) {
        report.claudeSettings.eccHooksEnabled = eccCfg.hooks_enabled === true;
        report.claudeSettings.eccHookProfile = eccCfg.hook_profile || 'unknown';
      }

      if (data.hooks && typeof data.hooks === 'object') {
        report.claudeSettings.hookEvents = Object.keys(data.hooks);
      }
    } catch {}
  }

  // Check sync drift
  const syncCheck = syncCanonicalSkills({ projectRoot: root, checkOnly: true });
  report.skillsDrift = syncCheck.driftFiles;

  // Recommendations (Print only, never edit user settings)
  if (report.claudeSettings.eccHooksEnabled || report.claudeSettings.eccHookProfile === 'strict') {
    report.recommendations.push(
      '토큰 절감 권고: ECC 플러그인의 전역 훅(hook_profile: "strict")이 켜져 있습니다. 매 도구 호출마다 프롬프트가 과도하게 소비되므로, ~/.claude/settings.json에서 "hooks_enabled": false 로 설정하고 specialist 스킬로만 활용하는 것을 권장합니다.'
    );
  }

  const enabled = report.claudeSettings.enabledPlugins;
  const hasMultiplePlanners =
    enabled.some((p) => p.includes('ecc')) && enabled.some((p) => p.includes('superpowers'));
  if (hasMultiplePlanners) {
    report.recommendations.push(
      '오케스트레이터 중복 주의: superpowers와 ecc가 동시 활성화되어 있습니다. 최상위 작업 지휘는 Gon(/gon) 단일 플래너로 일원화하고, 각 플러그인의 자체 planner 호출은 피하십시오.'
    );
  }

  if (report.skillsDrift.length > 0) {
    report.recommendations.push(
      `스킬 동기화 필요: .agents/skills/gon에 불일치 파일(${report.skillsDrift.length}개)이 있습니다. "gon skills sync"를 실행하십시오.`
    );
  }

  return report;
}
