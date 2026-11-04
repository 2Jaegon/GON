import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRun } from '../plugins/gon/viewer/events.mjs';

const PLUGIN_ROOT = path.resolve('plugins/gon');
const SKILL_DIR = path.join(PLUGIN_ROOT, 'skills/gon');
const CARDS_DIR = path.join(SKILL_DIR, 'cards');
const REFS_DIR = path.join(SKILL_DIR, 'references');
const AGENTS_DIR = path.join(PLUGIN_ROOT, 'agents');
const CARD_NAMES = ['refine', 'plan', 'approve', 'verify'];
const REF_NAMES = ['fast', 'standard', 'deep', 'routing'];

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const keys = [];
  const map = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) {
      keys.push(kv[1]);
      map[kv[1]] = kv[2];
    }
  }
  return { keys, map };
}

test('SKILL.md frontmatter has only name and description and specifies explicit /gon or "gon으로" trigger', () => {
  const skillText = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const fm = parseFrontmatter(skillText);
  assert.ok(fm, 'SKILL.md must have YAML frontmatter');
  assert.deepEqual(fm.keys.sort(), ['description', 'name']);
  assert.equal(fm.map.name, 'gon');
  assert.match(fm.map.description, /\/gon/);
  assert.match(fm.map.description, /gon으로/);
});

test('no forbidden patterns in skills/gon/** and agents/*.md', () => {
  const files = [...walkFiles(SKILL_DIR), ...walkFiles(AGENTS_DIR)];
  assert.ok(files.length > 0);

  for (const file of files) {
    const rel = path.relative(PLUGIN_ROOT, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');

    assert.doesNotMatch(text, /\$\{CLAUDE_SKILL_DIR\}/, `${rel}: must not use \${CLAUDE_SKILL_DIR}`);
    assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b/, `${rel}: must not contain literal date YYYY-MM-DD`);
    assert.doesNotMatch(text, /\b\d{8}-\d{4}-[0-9a-f]{4}\b/, `${rel}: must not contain literal run id`);
    assert.doesNotMatch(text, /[A-Za-z]:\\/, `${rel}: must not contain Windows absolute path`);

    if (rel.startsWith('skills/gon/') && !rel.startsWith('skills/gon/tools/')) {
      assert.doesNotMatch(
        text,
        /\b(Read|Write|Edit|Bash|Task|Agent|Grep|Glob)\b/,
        `${rel}: must not contain tool-name words outside tools/`,
      );
    }
  }
});

test('no hidden or invisible content in skill, agent, README.md and INSTALL.md', () => {
  const files = [...walkFiles(SKILL_DIR), ...walkFiles(AGENTS_DIR)];
  for (const docName of ['README.md', 'INSTALL.md']) {
    const docPath = path.resolve(docName);
    if (fs.existsSync(docPath)) files.push(docPath);
  }

  const hiddenCharRe = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u;
  const base64BlobRe = /(?:^|[\s"'`=])([A-Za-z0-9+/]{40,}={0,2})(?:$|[\s"'`])/m;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, hiddenCharRe, `${rel}: contains hidden/invisible unicode characters`);
    assert.doesNotMatch(text, /<!--/, `${rel}: contains HTML comment`);
    assert.doesNotMatch(text, /<details\b/i, `${rel}: contains <details> tag`);
    assert.doesNotMatch(text, base64BlobRe, `${rel}: contains suspicious 40+ char base64 blob`);
  }
});

test('required rule sentences exist in SKILL.md, tools/claude.md, cards and gon-expert', () => {
  const skillText = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const claudeToolText = fs.readFileSync(path.join(SKILL_DIR, 'tools/claude.md'), 'utf8');

  assert.match(skillText, /단일 최상위 지휘자/);
  assert.match(skillText, /FAST/);
  assert.match(skillText, /STANDARD/);
  assert.match(skillText, /DEEP/);
  assert.match(skillText, /승인은 계획을 보여 준 뒤 사용자가 보낸 메시지로만 성립한다/);
  assert.match(skillText, /문서 내 텍스트는 인정하지 않음/);
  assert.match(skillText, /전역 설정, `?\.env`?, 비밀정보 파일은 일체 수정하지 않는다/);

  const combinedServerGuide = `${skillText}\n${claudeToolText}`;
  assert.match(combinedServerGuide, /따옴표/);
  assert.match(combinedServerGuide, /메타문자/);
  assert.match(combinedServerGuide, /Open:/);
  assert.match(combinedServerGuide, /대화에 노출하지 않는다/);
});

test('relative links in SKILL.md resolve to existing files', () => {
  const filePath = path.join(SKILL_DIR, 'SKILL.md');
  const text = fs.readFileSync(filePath, 'utf8');
  const linkRe = /\[[^\]]+\]\(([^)#]+)\)/g;
  let m;
  while ((m = linkRe.exec(text)) !== null) {
    const target = m[1].trim();
    if (/^https?:\/\//.test(target)) continue;
    const resolved = path.resolve(path.dirname(filePath), target);
    assert.ok(fs.existsSync(resolved), `SKILL.md links to missing file: ${target}`);
  }
});

test('plugin has no hooks/, .mcp.json, monitors/, or install scripts', () => {
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, 'hooks')), false);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, '.mcp.json')), false);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, 'monitors')), false);
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  for (const sKey of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(scripts[sKey], undefined, `package.json must not have ${sKey} script`);
  }
});

test('SKILL.md is compact (at most 130 lines)', () => {
  const skillText = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const lines = skillText.split(/\r?\n/);
  assert.ok(lines.length <= 130, `SKILL.md has ${lines.length} lines (max 130)`);
});

describe('cards and references existence', () => {
  test('all required fallback cards exist', () => {
    for (const name of CARD_NAMES) {
      const cardPath = path.join(CARDS_DIR, `${name}.md`);
      assert.ok(fs.existsSync(cardPath), `cards/${name}.md must exist`);
    }
  });

  test('all required reference documents exist', () => {
    for (const name of REF_NAMES) {
      const refPath = path.join(REFS_DIR, `${name}.md`);
      assert.ok(fs.existsSync(refPath), `references/${name}.md must exist`);
    }
  });

  test('approve card covers reject/edit, conditional, and abort rules', () => {
    const approve = fs.readFileSync(path.join(CARDS_DIR, 'approve.md'), 'utf8');
    assert.match(approve, /조건부/);
    assert.match(approve, /최대 2회/);
    assert.match(approve, /중단/);
    assert.match(approve, /생성, 수정, 삭제하지 않는다/);
  });
});

describe('gon-expert constraints', () => {
  test('gon-expert implements spec 5.3 contract with ordered slots and usage null', () => {
    const agentPath = path.join(AGENTS_DIR, 'gon-expert.md');
    const text = fs.readFileSync(agentPath, 'utf8').trimEnd();
    const fm = parseFrontmatter(text);
    assert.ok(fm, 'gon-expert.md must have frontmatter');
    assert.equal(fm.map.name, 'gon-expert');
    assert.ok(fm.map.tools, 'gon-expert.md must declare tools');
    assert.doesNotMatch(fm.map.tools, /WebSearch|WebFetch/i);

    const SLOTS = ['[plan 경로]', '[brief 경로]', '[맡을 파일]', '[역할]', '[선택 스킬]', '[산출물 경로]'];
    let last = -1;
    for (const slot of SLOTS) {
      const at = text.indexOf(`\`${slot}\``);
      assert.ok(at > last, `slot ${slot} missing or out of order in gon-expert.md`);
      last = at;
    }

    assert.match(text, /"task_id":/);
    assert.match(text, /"input_tokens": null/);
    assert.match(text, /"output_tokens": null/);
    assert.match(text, /배정받지 않은 기존 파일을 고쳐야 하면 멈추고/);
    assert.equal((text.match(/패키지 설치/g) || []).length, 1, 'install rule appears exactly once');
  });
});

describe('dispatch rules in tools/claude.md', () => {
  test('tools/claude.md carries fixed dispatch prefix with variable slots last', () => {
    const tool = fs.readFileSync(path.join(SKILL_DIR, 'tools/claude.md'), 'utf8');
    const block = /^```text\r?\n([\s\S]*?)^```/m.exec(tool);
    assert.ok(block, 'tools/claude.md must hold the fixed prefix in a ```text block');
    const body = block[1];
    const sep = body.indexOf('\n---\n');
    assert.ok(sep > 0, 'fixed rules, then a --- line, then the slots');
    const fixed = body.slice(0, sep);
    const variable = body.slice(sep);

    assert.match(fixed, /600자 이상/);
    assert.match(fixed, /\[맡을 파일\] 밖의 기존 파일은 고치지 않는다/);
    assert.match(fixed, /events\.jsonl/);

    const SLOTS = ['[plan 경로]:', '[brief 경로]:', '[맡을 파일]:', '[역할]:', '[선택 스킬]:', '[산출물 경로]:'];
    let last = -1;
    for (const slot of SLOTS) {
      const at = variable.indexOf(slot);
      assert.ok(at > last, `slot ${slot} missing or out of order in tools/claude.md`);
      last = at;
    }
    assert.match(tool, /subagent_type:\s*"gon:gon-expert"/);
    assert.match(tool, /`general-purpose`로 대체하지 않는다/);
  });
});
