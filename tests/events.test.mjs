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

test('buildRun is safe for ids like __proto__ and constructor', () => {
  const events = [
    { v: 1, t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-a1b2', req: 'test', tool: 'claude-code', depth: 'quick' },
    { t: '2026-11-02T14:30:01+09:00', ev: 'node', id: '__proto__', from: ['main'], stage: 'grill', status: 'done', sum: 'pollute?' },
    { t: '2026-11-02T14:30:02+09:00', ev: 'node', id: 'constructor', from: ['main'], stage: 'plan', status: 'done', sum: 'ctor' },
  ];
  const run = buildRun('20261102-1430-a1b2', events);
  assert.equal(({}).sum, undefined);
  assert.equal(run.nodes.length, 2);
  assert.equal(run.nodes[0].id, '__proto__');
  assert.equal(run.nodes[1].id, 'constructor');
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
