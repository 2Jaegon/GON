#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import { runDoctor } from './doctor.js';
import { getOrBuildRegistry } from './registry/cache.js';
import { routeSkills } from './core/router.js';
import { syncCanonicalSkills } from './sync.js';
import { classifyMode } from './core/classifier.js';
import { generateRunReport } from './observability/report.js';
import { generateStatusLine } from './statusline.js';
import { redactSecrets } from './security/redaction.js';
import { PhaseSchema, ModeSchema } from './core/types.js';

const program = new Command();
program
  .name('gon')
  .description('Gon: Adaptive Skill Orchestrator CLI')
  .version('0.2.0');

// 1. doctor
program
  .command('doctor')
  .description('개발 환경, 설치된 CLI, 전역 훅 충돌 및 스킬 동기화 상태 진단')
  .option('--json', 'JSON 포맷으로 출력')
  .action(async (opts) => {
    try {
      const report = await runDoctor();
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('=== Gon 시스템 환경 진단 (Doctor) ===\n');
        console.log('[설치된 CLI]');
        console.log(`- Claude Code: ${report.clis.claude.installed ? `설치됨 (${report.clis.claude.version})` : '미설치 (UNKNOWN)'}`);
        console.log(`- Codex CLI:   ${report.clis.codex.installed ? `설치됨 (${report.clis.codex.version})` : '미설치 (UNKNOWN)'}`);
        console.log(`- Gemini CLI:  ${report.clis.gemini.installed ? `설치됨 (${report.clis.gemini.version})` : '미설치 (UNKNOWN)'}`);

        console.log('\n[Claude Code 설정]');
        console.log(`- settings.json: ${report.claudeSettings.found ? '발견됨' : '미발견'}`);
        console.log(`- 켜진 플러그인: ${report.claudeSettings.enabledPlugins.join(', ') || '없음'}`);
        console.log(`- ECC 훅 상태:   ${report.claudeSettings.eccHooksEnabled ? `활성화됨 (profile: ${report.claudeSettings.eccHookProfile})` : '비활성화됨'}`);

        console.log('\n[정본 동기화]');
        if (report.skillsDrift.length === 0) {
          console.log('- .agents/skills/gon 정본과 일치함');
        } else {
          console.log(`- 정본 불일치 파일 ${report.skillsDrift.length}건: ${report.skillsDrift.join(', ')}`);
        }

        if (report.recommendations.length > 0) {
          console.log('\n[권고 사항]');
          for (const rec of report.recommendations) {
            console.log(`💡 ${rec}`);
          }
        }
      }
      process.exit(0);
    } catch (err: any) {
      console.error(`진단 중 오류 발생: ${err?.message || err}`);
      process.exit(2);
    }
  });

// 2. skills
const skillsCmd = program.command('skills').description('스킬 레지스트리 조회, 라우팅 및 동기화');

skillsCmd
  .command('list')
  .description('색인된 로컬/플러그인 스킬 목록 조회')
  .option('--json', 'JSON 포맷으로 출력')
  .action((opts) => {
    try {
      const { skills } = getOrBuildRegistry();
      if (opts.json) {
        console.log(JSON.stringify(skills, null, 2));
      } else {
        console.log(`총 ${skills.length}개 스킬이 색인되어 있습니다:\n`);
        for (const sk of skills) {
          const phases = sk.phases.join(',');
          const caps = sk.capabilities.join(',');
          console.log(`- ${sk.id.padEnd(30)} [${sk.source}] (phases: ${phases}) -> caps: ${caps}`);
        }
      }
      process.exit(0);
    } catch (err: any) {
      console.error(`스킬 목록 조회 실패: ${err?.message || err}`);
      process.exit(2);
    }
  });

skillsCmd
  .command('inspect <skillId>')
  .description('스킬 상세 정보 조회')
  .option('--json', 'JSON 포맷으로 출력')
  .action((skillId, opts) => {
    try {
      const { skills } = getOrBuildRegistry();
      const target = skills.find((s) => s.id === skillId || s.name === skillId);
      if (!target) {
        console.error(`스킬을 찾을 수 없습니다: ${skillId}`);
        process.exit(2);
      }
      if (opts.json) {
        console.log(JSON.stringify(target, null, 2));
      } else {
        console.log(`ID:           ${target.id}`);
        console.log(`이름:         ${target.name}`);
        console.log(`출처:         ${target.source}`);
        console.log(`경로:         ${target.uri}`);
        console.log(`SHA-256:      ${target.contentHash || 'N/A'}`);
        console.log(`단계(phases): ${target.phases.join(', ')}`);
        console.log(`역량(caps):   ${target.capabilities.join(', ')}`);
        console.log(`권한 위험도:  ${target.permissionRisk}`);
        console.log(`설명:         ${target.description}`);
      }
      process.exit(0);
    } catch (err: any) {
      console.error(`스킬 조회 실패: ${err?.message || err}`);
      process.exit(2);
    }
  });

skillsCmd
  .command('route')
  .description('작업 단계 및 필요 역량에 맞는 최소 스킬 선별')
  .requiredOption('--phase <phase>', '작업 단계 (refine, plan, route, approve, execute, verify)')
  .option('--caps <capabilities>', '필요 역량 (콤마로 구분)')
  .option('--mode <mode>', '실행 모드 (fast, standard, deep)', 'standard')
  .option('--stack <stack>', '기술 스택')
  .option('--json', 'JSON 포맷으로 출력')
  .action((opts) => {
    try {
      const phaseParse = PhaseSchema.safeParse(opts.phase);
      if (!phaseParse.success) {
        console.error(`잘못된 단계 이름입니다: ${opts.phase}`);
        process.exit(1);
      }
      const modeParse = ModeSchema.safeParse(opts.mode);
      if (!modeParse.success) {
        console.error(`잘못된 모드 이름입니다: ${opts.mode}`);
        process.exit(1);
      }

      const caps = opts.caps ? opts.caps.split(',').map((s: string) => s.trim()) : [];
      const { skills } = getOrBuildRegistry();
      const res = routeSkills(skills, {
        phase: phaseParse.data,
        capabilities: caps,
        mode: modeParse.data,
        stack: opts.stack,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`=== 단계 [${opts.phase}] 스킬 라우팅 결과 (모드: ${opts.mode}) ===\n`);
        console.log(`선택된 스킬 (${res.selected.length}개):`);
        for (const s of res.selected) {
          console.log(`  ✓ ${s.id} (${s.description})`);
        }
        if (res.capabilityMissing) {
          console.log(`\n⚠️ 미보유 역량 발견: ${res.discoveryRecommendation}`);
        }
      }
      process.exit(0);
    } catch (err: any) {
      console.error(`스킬 라우팅 실패: ${err?.message || err}`);
      process.exit(2);
    }
  });

skillsCmd
  .command('sync')
  .description('plugins/gon/skills/gon 정본 스킬을 .agents/skills/gon 복사본과 동기화')
  .option('--check', '실제 복사하지 않고 불일치 여부만 확인')
  .action((opts) => {
    try {
      const res = syncCanonicalSkills({ checkOnly: Boolean(opts.check) });
      if (opts.check) {
        if (!res.ok) {
          console.error(`스킬 불일치 발견 (${res.driftFiles.length}건): ${res.driftFiles.join(', ')}`);
          process.exit(2);
        } else {
          console.log('스킬 정본과 복사본이 완전히 일치합니다.');
          process.exit(0);
        }
      } else {
        console.log(`동기화 완료 (${res.syncedFiles.length}개 파일):`);
        for (const f of res.syncedFiles) {
          console.log(`  -> ${f}`);
        }
        process.exit(0);
      }
    } catch (err: any) {
      console.error(`동기화 실패: ${err?.message || err}`);
      process.exit(2);
    }
  });

// 3. classify
program
  .command('classify <request>')
  .description('사용자 요청의 위험도 및 범위에 따른 FAST / STANDARD / DEEP 모드 판정')
  .option('--files <count>', '예상 변경 파일 수', '1')
  .option('--json', 'JSON 포맷으로 출력')
  .action((request, opts) => {
    try {
      const files = parseInt(opts.files, 10) || 1;
      const res = classifyMode(request, { files });
      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`판정 모드: ${res.mode.toUpperCase()}`);
        console.log(`판정 근거: ${res.reason}`);
        if (res.signals.length > 0) {
          console.log(`감지된 신호: ${res.signals.join(', ')}`);
        }
      }
      process.exit(0);
    } catch (err: any) {
      console.error(`분류 실패: ${err?.message || err}`);
      process.exit(2);
    }
  });

// 4. report
program
  .command('report <targetRun>')
  .description('실행 기록(.gon/<run_id>/events.jsonl) 분석, 경과 시간/토큰/비용 측정 및 report.json 생성')
  .option('--host <host>', '로그를 탐색할 호스트 CLI (claude, codex)', 'claude')
  .option('--json', 'JSON 포맷으로 출력')
  .action((targetRun, opts) => {
    try {
      const res = generateRunReport(targetRun, { host: opts.host });
      if (!res) {
        console.error(`실행 기록을 찾거나 읽을 수 없습니다: ${targetRun}`);
        process.exit(2);
      }
      if (opts.json) {
        console.log(JSON.stringify(res.report, null, 2));
      } else {
        console.log(redactSecrets(res.summaryText));
      }
      process.exit(0);
    } catch (err: any) {
      console.error(`보고서 생성 실패: ${err?.message || err}`);
      process.exit(2);
    }
  });

// 5. statusline
program
  .command('statusline')
  .description('Claude Code statusLine 표준입력(stdin) JSON을 받아 실시간 상태줄 한 줄 출력')
  .action(() => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (input += chunk));
    process.stdin.on('end', () => {
      try {
        const line = generateStatusLine(input);
        console.log(redactSecrets(line));
      } catch {
        console.log('⏱ 0s · tok ? · $0.00 (CC 집계)');
      }
      process.exit(0);
    });
  });

program.parse(process.argv);

