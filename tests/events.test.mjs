import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  RUN_ID_RE,
  NODE_ID_RE,
  DEPTHS,
  STAGES,
  parseEvents,
  buildRun,
  validateRun,
  runStatus,
} from '../plugins/gon/viewer/events.mjs';

const FIXTURES = path.resolve('tests/fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name, 'events.jsonl'), 'utf8');
}

test('parseEvents skips broken lines and counts them', () => {
  const input = [
    '{"v":1,"t":"2026-11-02T14:30:00+09:00","ev":"run.start","run":"20261102-1430-a1b2","req":"요청","tool":"claude-code","depth":"normal"}',
    '{not-json',
    '{"t":"2026-11-02T14:36:05+09:00","ev":"run.end","status":"done"}',
  ].join('\n');
  const res = parseEvents(input);
  assert.equal(res.events.length, 2);
  assert.equal(res.skipped, 1);
});

test('parseEvents tolerates CRLF, BOM at start and in the middle of the file, and a truncated last line', () => {
  const raw = readFixture('crlf-bom-truncated');
  assert.ok(raw.includes('\r\n'));
  assert.equal(raw.charCodeAt(0), 0xfeff);
  const res = parseEvents(raw);
  assert.equal(res.events.length, 2);
  assert.equal(res.skipped, 1);
  assert.equal(res.events[0].ev, 'run.start');
  assert.equal(res.events[1].id, 'interview');
});

test('parseEvents returns empty for empty or whitespace-only text', () => {
  assert.deepEqual(parseEvents(''), { events: [], skipped: 0 });
  assert.deepEqual(parseEvents('   \r\n  \n\t  '), { events: [], skipped: 0 });
});

test('buildRun merges lines by id, later values win, keeps first from', () => {
  const { events } = parseEvents(readFixture('good-run'));
  const run = buildRun('20261102-1430-a1b2', events);
  assert.equal(run.id, '20261102-1430-a1b2');
  assert.equal(run.req, '동네 반찬 구독 앱 만들고 싶어');
  assert.equal(run.depth, 'normal');
  assert.equal(run.endStatus, 'done');
  assert.equal(run.nodes.length, 8);

  const fe = run.nodes.find((n) => n.id === 'fe');
  assert.ok(fe);
  assert.deepEqual(fe.from, ['compose']);
  assert.equal(fe.stage, 'execute');
  assert.equal(fe.role, 'frontend');
  assert.equal(fe.status, 'done');
  assert.equal(fe.sum, '화면 5개, 주문 3단계 구현');
  assert.equal(fe.out, 'fe.md');
  assert.equal(fe.via, 'subagent');
  assert.deepEqual(fe.files, ['src/app.js', 'src/style.css']);
  assert.equal(fe.startedAt, '2026-11-02T14:33:35+09:00');
  assert.equal(fe.endedAt, '2026-11-02T14:35:00+09:00');

  const interview = run.nodes.find((n) => n.id === 'interview');
  assert.equal(interview.fallback, true);

  const qa = run.nodes.find((n) => n.id === 'qa');
  assert.equal(qa.via, 'inline');
});

test('buildRun keeps retry ids separate', () => {
  const { events } = parseEvents(readFixture('retry-run'));
  const run = buildRun('20261102-1430-b2c3', events);
  const fe = run.nodes.find((n) => n.id === 'fe');
  const fe2 = run.nodes.find((n) => n.id === 'fe-2');
  assert.ok(fe);
  assert.ok(fe2);
  assert.equal(fe.status, 'failed');
  assert.equal(fe2.status, 'done');
  assert.deepEqual(fe2.from, ['fe']);
});

test('buildRun is safe for ids like __proto__ and constructor (__proto__ fails NODE_ID_RE and is dropped)', () => {
  const events = [
    { v: 1, t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-a1b2', req: 'test', tool: 'claude-code', depth: 'quick' },
    { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: '__proto__', from: ['main'], stage: 'grill', status: 'done', sum: 'pollute?' },
    { t: '2026-11-02T14:30:02+09:00', ev: 'node', id: 'constructor', from: ['main'], stage: 'plan', status: 'done', sum: 'ctor' },
  ];
  const run = buildRun('20261102-1430-a1b2', events);
  assert.equal(({}).sum, undefined);
  assert.equal(run.nodes.length, 1);
  assert.equal(run.nodes[0].id, 'constructor');
});

const DEEP_DEPTH = 100000;
const DEEP_ARRAY_JSON = '['.repeat(DEEP_DEPTH) + ']'.repeat(DEEP_DEPTH);
const HOSTILE_START = '{"v":1,"t":"2026-11-02T14:30:00+09:00","ev":"run.start","run":"20261102-1430-a1b2","req":"r","tool":"claude-code","depth":"quick"}';
function hostileNodeLines() {
  return [
    `{"t":"2026-11-02T14:30:01+09:00","ev":"node","id":"n1","from":${DEEP_ARRAY_JSON},"stage":"grill","status":"running"}`,
    `{"t":"2026-11-02T14:30:02+09:00","ev":"node","id":${DEEP_ARRAY_JSON},"from":["main"],"stage":${DEEP_ARRAY_JSON},"status":${DEEP_ARRAY_JSON},"via":${DEEP_ARRAY_JSON}}`,
    `{"t":${DEEP_ARRAY_JSON},"ev":${DEEP_ARRAY_JSON},"run":${DEEP_ARRAY_JSON}}`,
    `{"v":1,"t":"2026-11-02T14:30:03+09:00","ev":"run.start","run":${DEEP_ARRAY_JSON},"depth":${DEEP_ARRAY_JSON}}`,
  ];
}

test('buildRun never throws on deeply nested values (depth 100k) and keeps only valid node refs in from and id', () => {
  const { events } = parseEvents([HOSTILE_START, ...hostileNodeLines()].join('\n'));
  assert.equal(events.length, 5);
  let run;
  assert.doesNotThrow(() => {
    run = buildRun('20261102-1430-a1b2', events);
  });
  assert.deepEqual(run.nodes.map((n) => n.id), ['n1']);
  assert.deepEqual(run.nodes[0].from, []);

  const mixed = buildRun('20261102-1430-a1b2', [
    { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'n2', from: ['main', 7, ['a'], 'Bad Id', 'x'.repeat(65), 'ok-1'], stage: 'plan', status: 'done' },
    { t: '2026-11-02T14:30:02+09:00', ev: 'node', id: 'n3', from: Array.from({ length: 40 }, (_, i) => `p${i}`), stage: 'plan', status: 'done' },
    { t: '2026-11-02T14:30:03+09:00', ev: 'node', id: 'Bad Id', from: ['main'], stage: 'plan', status: 'done' },
  ]);
  assert.deepEqual(mixed.nodes.map((n) => n.id), ['n2', 'n3']);
  assert.deepEqual(mixed.nodes[0].from, ['main', 'ok-1']);
  assert.ok(mixed.nodes[1].from.length <= 32, `from must be capped at 32, got ${mixed.nodes[1].from.length}`);
});

test('validateRun never throws on deeply nested values (depth 100k) and rejects them', () => {
  const { events } = parseEvents([HOSTILE_START, ...hostileNodeLines()].join('\n'));
  let res;
  assert.doesNotThrow(() => {
    res = validateRun(events, { runId: '20261102-1430-a1b2' });
  });
  assert.equal(res.ok, false);

  const tooMany = validateRun([
    JSON.parse(HOSTILE_START),
    { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'n1', from: Array.from({ length: 33 }, () => 'main'), stage: 'grill', status: 'running' },
  ]);
  assert.equal(tooMany.ok, false, 'from longer than 32 must be rejected');
});

test('validateRun requires t to be an ISO-8601 timestamp with time and offset', () => {
  const start = (t) => ({ v: 1, t, ev: 'run.start', run: '20261102-1430-a1b2', req: 'r', tool: 'claude-code', depth: 'quick' });
  for (const bad of ['1', '2026', '2026-11-02', 'Mon Nov 02 2026', '2026-11-02 14:30:00', '2026-11-02T14:30:00', '2026-13-02T14:30:00Z']) {
    assert.equal(validateRun([start(bad)]).ok, false, `t=${bad} must be rejected`);
  }
  for (const good of ['2026-11-02T14:30:00+09:00', '2026-11-02T05:30:00.123Z', '2026-11-02T05:30:00Z']) {
    const res = validateRun([start(good)]);
    assert.equal(res.ok, true, `t=${good}: ${res.errors.join('; ')}`);
  }
});

test('validateRun rejects the reserved node id main', () => {
  const res = validateRun([
    { v: 1, t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-a1b2', req: 'r', tool: 'claude-code', depth: 'quick' },
    { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'a', from: ['main'], stage: 'grill', status: 'done' },
    { t: '2026-11-02T14:30:02+09:00', ev: 'node', id: 'main', from: ['a'], stage: 'plan', status: 'done' },
  ]);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /main/.test(e) && /reserved/.test(e)), res.errors.join('; '));
});

function reverseChainEvents(n, lastParent = 'main') {
  const events = [{ v: 1, t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-a1b2', req: 'r', tool: 'claude-code', depth: 'deep' }];
  for (let i = 0; i < n; i += 1) {
    events.push({ t: '2026-11-02T14:30:01+09:00', ev: 'node', id: `n${i}`, from: [i === n - 1 ? lastParent : `n${i + 1}`], stage: 'execute', status: 'done' });
  }
  return events;
}

test('validateRun handles a 10,000-node chain written in reverse order without stack overflow, and still finds a long cycle', () => {
  let res;
  assert.doesNotThrow(() => {
    res = validateRun(reverseChainEvents(10000), { runId: '20261102-1430-a1b2' });
  });
  assert.equal(res.ok, true, res.errors.slice(0, 3).join('; '));

  let cyc;
  assert.doesNotThrow(() => {
    cyc = validateRun(reverseChainEvents(10000, 'n0'), { runId: '20261102-1430-a1b2' });
  });
  assert.equal(cyc.ok, false);
  assert.ok(cyc.errors.some((e) => /cycle/.test(e)), cyc.errors.slice(0, 3).join('; '));
});

test('check-run gives a normal result, not a crash, for a 10,000-node reverse chain', async () => {
  const { spawnSync } = await import('node:child_process');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gon-check-chain-'));
  try {
    const runDir = path.join(tmpRoot, '20261102-1430-a1b2');
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), reverseChainEvents(10000).map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    const res = spawnSync(process.execPath, [path.resolve('tools/check-run.mjs'), runDir], { encoding: 'utf8' });
    assert.doesNotMatch(res.stderr, /RangeError|Maximum call stack|\n\s+at /);
    assert.equal(res.status, 0, `stderr: ${res.stderr.slice(0, 300)}`);
    assert.match(res.stdout, /^OK: 20261102-1430-a1b2/m);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('validateRun accepts good-run', () => {
  const { events } = parseEvents(readFixture('good-run'));
  const res = validateRun(events, { runId: '20261102-1430-a1b2' });
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.deepEqual(res.errors, []);
});

test('validateRun rejects partial-run with undeclared from', () => {
  const { events } = parseEvents(readFixture('partial-run'));
  const res = validateRun(events, { runId: '20261102-1430-a1b2' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('plan') || e.includes('compose')));
});

test('validateRun rejects unknown status, unknown ev, unknown stage, depth outside DEPTHS, via outside subagent|inline, non-boolean fallback, files that is not string[], bad node id, from cycle or self reference, over-long sum (>2000자)', () => {
  const baseStart = { v: 1, t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-a1b2', req: 'test', tool: 'claude-code', depth: 'normal' };

  assert.equal(validateRun([{ ...baseStart, depth: 'ultra' }]).ok, false);
  assert.equal(validateRun([baseStart, { t: '2026-11-02T14:30:01+09:00', ev: 'unknown' }]).ok, false);
  assert.equal(validateRun([baseStart, { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'n1', from: ['main'], stage: 'grill', status: 'paused' }]).ok, false);
  assert.equal(validateRun([baseStart, { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'n1', from: ['main'], stage: 'deploy', status: 'running' }]).ok, false);
  assert.equal(validateRun([baseStart, { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'n1', from: ['main'], stage: 'execute', status: 'running', via: 'magic' }]).ok, false);
  assert.equal(validateRun([baseStart, { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'n1', from: ['main'], stage: 'grill', status: 'running', fallback: 'yes' }]).ok, false);
  assert.equal(validateRun([baseStart, { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'n1', from: ['main'], stage: 'execute', status: 'done', files: [123] }]).ok, false);
  assert.equal(validateRun([baseStart, { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'BAD_ID', from: ['main'], stage: 'grill', status: 'running' }]).ok, false);
  assert.equal(validateRun([baseStart, { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'n1', from: ['n1'], stage: 'grill', status: 'running' }]).ok, false);
  assert.equal(validateRun([baseStart, { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: 'n1', from: ['main'], stage: 'grill', status: 'done', sum: '가'.repeat(2001) }]).ok, false);

  const { events: cycleEvents } = parseEvents(readFixture('cycle-run'));
  assert.equal(validateRun(cycleEvents).ok, false);
});

test('validateRun requires v:1 on run.start and rejects a run field that differs from opts.runId', () => {
  const noV = [{ t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-a1b2', req: 'test', tool: 'claude-code', depth: 'normal' }];
  assert.equal(validateRun(noV).ok, false);

  const withV = [{ v: 1, t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-a1b2', req: 'test', tool: 'claude-code', depth: 'normal' }];
  assert.equal(validateRun(withV, { runId: '20261102-1430-ffff' }).ok, false);
});

test('runStatus returns stalled at 10+ minutes of running without run.end, running at 9 minutes, done and failed from run.end', () => {
  const startIso = '2026-11-02T14:30:00.000Z';
  const startMs = Date.parse(startIso);
  const eventsRunning = [
    { v: 1, t: startIso, ev: 'run.start', run: '20261102-1430-a1b2', req: 'test', tool: 'claude-code', depth: 'normal' },
    { t: startIso, ev: 'node', id: 'interview', from: ['main'], stage: 'grill', status: 'running' },
  ];
  const run = buildRun('20261102-1430-a1b2', eventsRunning);
  assert.equal(runStatus(run, startMs + 9 * 60 * 1000), 'running');
  assert.equal(runStatus(run, startMs + 10 * 60 * 1000), 'stalled');

  const runDone = buildRun('20261102-1430-a1b2', [
    ...eventsRunning,
    { t: '2026-11-02T14:35:00.000Z', ev: 'run.end', status: 'done' },
  ]);
  assert.equal(runStatus(runDone, startMs + 60 * 60 * 1000), 'done');

  const runFailed = buildRun('20261102-1430-a1b2', [
    ...eventsRunning,
    { t: '2026-11-02T14:35:00.000Z', ev: 'run.end', status: 'failed' },
  ]);
  assert.equal(runStatus(runFailed, startMs + 60 * 60 * 1000), 'failed');
});

test('check-run CLI validates good-run, rejects broken/FFFD runs, and warns on secret patterns', () => {
  const cli = path.resolve('tools/check-run.mjs');
  const goodDir = path.join(FIXTURES, 'good-run');
  // Copy good-run into a temp folder named 20261102-1430-a1b2
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gon-check-'));
  try {
    const validRunDir = path.join(tmpRoot, '20261102-1430-a1b2');
    fs.cpSync(goodDir, validRunDir, { recursive: true });
    const out = execFileSync(process.execPath, [cli, validRunDir], { encoding: 'utf8' });
    assert.match(out, /OK/i);

    // Broken run (partial-run) -> exit 1
    const brokenDir = path.join(tmpRoot, '20261102-1430-a1b2-broken');
    fs.cpSync(path.join(FIXTURES, 'partial-run'), brokenDir, { recursive: true });
    assert.throws(() => {
      execFileSync(process.execPath, [cli, brokenDir], { encoding: 'utf8', stdio: 'pipe' });
    });

    // Broken Hangul (U+FFFD) -> exit 1
    const fffdDir = path.join(tmpRoot, '20261102-1430-e5f6');
    fs.mkdirSync(fffdDir, { recursive: true });
    fs.writeFileSync(
      path.join(fffdDir, 'events.jsonl'),
      JSON.stringify({ v: 1, t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-e5f6', req: '깨진글자\uFFFD', tool: 'claude-code', depth: 'quick' }) + '\n',
      'utf8',
    );
    assert.throws(() => {
      execFileSync(process.execPath, [cli, fffdDir], { encoding: 'utf8', stdio: 'pipe' });
    });

    // Secret trace -> exit 0 + warning
    const secretDir = path.join(tmpRoot, '20261102-1430-f7a8');
    fs.mkdirSync(secretDir, { recursive: true });
    fs.writeFileSync(
      path.join(secretDir, 'events.jsonl'),
      JSON.stringify({ v: 1, t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-f7a8', req: '키 노출 password=mysecret', tool: 'claude-code', depth: 'quick' }) + '\n',
      'utf8',
    );
    const warnOut = execFileSync(process.execPath, [cli, secretDir], { encoding: 'utf8' });
    assert.match(warnOut, /WARN/i);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('check-run exits 1 with ERROR lines, not a stack trace, on deeply nested values (depth 100k)', async () => {
  const { spawnSync } = await import('node:child_process');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gon-check-deep-'));
  try {
    const runDir = path.join(tmpRoot, '20261102-1430-a1b2');
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), [HOSTILE_START, ...hostileNodeLines()].join('\n') + '\n', 'utf8');
    const res = spawnSync(process.execPath, [path.resolve('tools/check-run.mjs'), runDir], { encoding: 'utf8' });
    assert.equal(res.status, 1, `expected exit 1, got ${res.status}; stderr: ${res.stderr.slice(0, 300)}`);
    assert.match(res.stderr, /^ERROR: /m);
    assert.doesNotMatch(res.stderr, /RangeError|\n\s+at /);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('one out-path rule: only events.mjs defines SAFE_OUT_RE; server, app and check-run import it', async () => {
  const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
  const eventsSrc = read('plugins/gon/viewer/events.mjs');
  assert.match(eventsSrc, /^export const SAFE_OUT_RE = \//m);
  for (const p of ['plugins/gon/viewer/server.mjs', 'plugins/gon/viewer/app.js', 'tools/check-run.mjs']) {
    const src = read(p);
    assert.doesNotMatch(src, /SAFE_OUT_RE\s*=/, `${p} must not define its own SAFE_OUT_RE`);
    assert.doesNotMatch(src, /\\\.md\$\//, `${p} must not contain another .md path regex literal`);
    assert.match(src, /import\s*\{[^}]*\bSAFE_OUT_RE\b[^}]*\}\s*from\s*'[^']*events\.mjs'/, `${p} must import SAFE_OUT_RE from events.mjs`);
  }

  const { SAFE_OUT_RE } = await import('../plugins/gon/viewer/events.mjs');
  for (const ok of ['brief.md', '한글 산출물.md', 'fe-2_v1.md']) assert.ok(SAFE_OUT_RE.test(ok), ok);
  for (const bad of ['sub/a.md', '../a.md', 'a.txt', 'a(1).md', 'C:a.md', '日本.md']) assert.ok(!SAFE_OUT_RE.test(bad), bad);
});

test('shared modules have no import and no node: usage', () => {
  const sharedFiles = [
    'plugins/gon/viewer/events.mjs',
    'plugins/gon/viewer/graph-layout.mjs',
    'plugins/gon/viewer/md-safe.mjs',
  ];
  for (const rel of sharedFiles) {
    const full = path.resolve(rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    assert.doesNotMatch(src, /^\s*import\b/m, `${rel} must not contain import statements`);
    assert.doesNotMatch(src, /['"`]node:[a-z0-9_/-]+/i, `${rel} must not reference node: builtins`);
    assert.doesNotMatch(src, /\b(process|Buffer)\b/, `${rel} must not reference process or Buffer`);
  }
});
