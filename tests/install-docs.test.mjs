import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_COMMANDS = new Set([
  'claude plugin marketplace add 2Jaegon/Gon',
  'claude plugin install gon@gon',
  'claude plugin uninstall gon@gon',
]);

test('INSTALL.md exists and contains only allowlisted commands and URLs', () => {
  const installPath = path.resolve('INSTALL.md');
  assert.ok(fs.existsSync(installPath), 'INSTALL.md must exist');
  const text = fs.readFileSync(installPath, 'utf8');

  // Forbidden tools/commands/words
  const forbiddenRe = /\b(curl|wget|iex|irm|Invoke-Expression|npx|main)\b|\|\s*(sh|bash)\b/i;
  assert.doesNotMatch(text, forbiddenRe, 'INSTALL.md must not contain curl/wget/iex/irm/npx/main or pipe to shell');

  // Check all URLs
  const urlMatches = text.match(/https?:\/\/[^\s)`"'>]+/g) || [];
  for (const u of urlMatches) {
    assert.equal(u, 'https://github.com/2Jaegon/Gon', `Disallowed URL in INSTALL.md: ${u}`);
  }

  // Check all owner/repo patterns
  const repoMatches = text.match(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/g) || [];
  for (const r of repoMatches) {
    if (r === 'github.com/2Jaegon') continue;
    assert.equal(r, '2Jaegon/Gon', `Disallowed owner/repo in INSTALL.md: ${r}`);
  }

  // Check all fenced code block lines
  const codeBlockRe = /```[a-z]*\r?\n([\s\S]*?)```/g;
  let m;
  const seenCommands = [];
  while ((m = codeBlockRe.exec(text)) !== null) {
    const lines = m[1]
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      assert.ok(ALLOWED_COMMANDS.has(line), `Disallowed command line in INSTALL.md: "${line}"`);
      seenCommands.push(line);
    }
  }
  assert.ok(seenCommands.includes('claude plugin marketplace add 2Jaegon/Gon'));
  assert.ok(seenCommands.includes('claude plugin install gon@gon'));
  assert.ok(seenCommands.includes('claude plugin uninstall gon@gon'));
});

test('INSTALL.md instructs the AI to compare the commands with README, show them, and wait for approval before running', () => {
  const text = fs.readFileSync(path.resolve('INSTALL.md'), 'utf8');
  assert.match(text, /README\.md/);
  assert.match(text, /대조|비교/);
  assert.match(text, /보여\s*주/);
  assert.match(text, /승인/);
});

test('README.md shows the exact two install lines, the uninstall line, and /reload-plugins or restart notice', () => {
  const text = fs.readFileSync(path.resolve('README.md'), 'utf8');
  assert.match(text, /claude plugin marketplace add 2Jaegon\/Gon/);
  assert.match(text, /claude plugin install gon@gon/);
  assert.match(text, /claude plugin uninstall gon@gon/);
  assert.match(text, /\/reload-plugins/);
  assert.match(text, /재시작/);
});

test('onboarding.md covers all required onboarding topics and never mentions bypassing approval modes', () => {
  const onboardingPath = path.resolve('plugins/gon/skills/gon/onboarding.md');
  const text = fs.readFileSync(onboardingPath, 'utf8');

  // Recommended skills check without auto-install
  assert.match(text, /grilling/);
  assert.match(text, /superpowers/);
  assert.match(text, /자동\s*설치하지\s*않/);

  // Optional skills as notice only
  assert.match(text, /find-skills/);
  assert.match(text, /ECC/);

  // .gon/ creation consent & .gitignore with default add
  assert.match(text, /\.gon\//);
  assert.match(text, /동의/);
  assert.match(text, /\.gitignore/);
  assert.match(text, /기본.*추가|추가.*기본/);

  // Graph viewer question, approval prompts notice, first test request
  assert.match(text, /그래프/);
  assert.match(text, /승인\s*창/);
  assert.match(text, /시험\s*요청|첫\s*요청/);

  // Never mentions bypassing approval modes
  assert.doesNotMatch(text, /우회/);
  assert.doesNotMatch(text, /--dangerously/i);
});

test('C4 onboarding never invents install commands for third-party skills and asks for the official link', () => {
  const text = fs.readFileSync(path.resolve('plugins/gon/skills/gon/onboarding.md'), 'utf8');
  assert.doesNotMatch(text, /\bnpx\b/);
  assert.doesNotMatch(text, /claude\s+plugin\s+(install|marketplace\s+add)/);
  assert.doesNotMatch(text, /\/plugin\s+(install|marketplace)/);
  assert.doesNotMatch(text, /공식 설치 명령만 안내/);
  assert.match(text, /설치 명령을 지어내지 않는다/);
  assert.match(text, /공식 링크를 사용자에게 받/);
});
