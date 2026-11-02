import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseEvents, buildRun } from '../plugins/gon/viewer/events.mjs';
import { layoutRuns } from '../plugins/gon/viewer/graph-layout.mjs';

const FIXTURES = path.resolve('tests/fixtures');

function loadFixtureRun(name, idOverride) {
  const raw = fs.readFileSync(path.join(FIXTURES, name, 'events.jsonl'), 'utf8');
  const { events } = parseEvents(raw);
  const runId = idOverride || events[0]?.run || name;
  return buildRun(runId, events);
}

test('places main at x=0 and each request starts a lane left to right', () => {
  const run = loadFixtureRun('good-run');
  const layout = layoutRuns([run]);
  const main = layout.nodes.find((n) => n.key === 'main');
  assert.ok(main);
  assert.equal(main.x, 0);
  assert.equal(main.node, null);
  for (const n of layout.nodes) {
    if (n.key !== 'main') {
      assert.ok(n.x > main.x, `node ${n.key} should be to the right of main`);
    }
  }
});

test('column equals longest path from main in good-run', () => {
  const run = loadFixtureRun('good-run');
  const layout = layoutRuns([run]);
  const byId = new Map(layout.nodes.filter((n) => n.runId === run.id).map((n) => [n.id, n]));
  assert.ok(byId.get('interview').x < byId.get('plan').x);
  assert.ok(byId.get('plan').x < byId.get('check').x);
  assert.ok(byId.get('check').x < byId.get('compose').x);
  assert.ok(byId.get('compose').x < byId.get('fe').x);
  assert.ok(byId.get('fe').x < byId.get('lead').x);
});

test('parallel nodes with the same parents get distinct y in the same column', () => {
  const run = loadFixtureRun('good-run');
  const layout = layoutRuns([run]);
  const byId = new Map(layout.nodes.filter((n) => n.runId === run.id).map((n) => [n.id, n]));
  const fe = byId.get('fe');
  const be = byId.get('be');
  const qa = byId.get('qa');
  assert.equal(fe.x, be.x);
  assert.equal(be.x, qa.x);
  const ys = new Set([fe.y, be.y, qa.y]);
  assert.equal(ys.size, 3);
});

test('lanes are ordered by run id ascending and never overlap', () => {
  const r2 = loadFixtureRun('good-run', '20261102-1500-bbbb');
  const r1 = loadFixtureRun('retry-run', '20261102-1400-aaaa');
  const layout = layoutRuns([r2, r1]);
  const r1Nodes = layout.nodes.filter((n) => n.runId === r1.id);
  const r2Nodes = layout.nodes.filter((n) => n.runId === r2.id);
  const r1MaxY = Math.max(...r1Nodes.map((n) => n.y));
  const r2MinY = Math.min(...r2Nodes.map((n) => n.y));
  assert.ok(r1MaxY < r2MinY, `lane r1 max y (${r1MaxY}) must be above lane r2 min y (${r2MinY})`);
});

test('ended runs are dim, running runs are not', () => {
  const ended = loadFixtureRun('good-run', '20261102-1400-aaaa');
  const running = loadFixtureRun('cycle-run', '20261102-1500-bbbb'); // cycle-run has no run.end
  const layout = layoutRuns([ended, running]);
  for (const n of layout.nodes.filter((n) => n.runId === ended.id)) {
    assert.equal(n.dim, true);
  }
  for (const n of layout.nodes.filter((n) => n.runId === running.id)) {
    assert.equal(n.dim, false);
  }
  for (const e of layout.edges.filter((e) => e.to.startsWith(ended.id + '/'))) {
    assert.equal(e.dim, true);
  }
  for (const e of layout.edges.filter((e) => e.to.startsWith(running.id + '/'))) {
    assert.equal(e.dim, false);
  }
});

test('is deterministic', () => {
  const r1 = loadFixtureRun('good-run', '20261102-1400-aaaa');
  const r2 = loadFixtureRun('retry-run', '20261102-1500-bbbb');
  const first = layoutRuns([r2, r1]);
  const second = layoutRuns([r2, r1]);
  assert.deepStrictEqual(first, second);
});

test('handles zero runs and a run with only run.start', () => {
  const emptyLayout = layoutRuns([]);
  assert.equal(emptyLayout.nodes.length, 1);
  assert.equal(emptyLayout.nodes[0].key, 'main');
  assert.equal(emptyLayout.edges.length, 0);

  const startOnlyRun = buildRun('20261102-1430-a1b2', [
    { v: 1, t: '2026-11-02T14:30:00+09:00', ev: 'run.start', run: '20261102-1430-a1b2', req: '빈 실행', tool: 'claude-code', depth: 'quick' },
  ]);
  const startOnlyLayout = layoutRuns([startOnlyRun]);
  assert.equal(startOnlyLayout.nodes.length, 1);
  assert.equal(startOnlyLayout.nodes[0].key, 'main');
});

test('terminates on cyclic or dangling from', () => {
  const cycleRun = loadFixtureRun('cycle-run');
  const partialRun = loadFixtureRun('partial-run');
  const layout = layoutRuns([cycleRun, partialRun]);
  assert.ok(layout.nodes.length > 1);
  assert.ok(layout.edges.length > 0);
});

test('handles 50 runs within 1 second', () => {
  const base = loadFixtureRun('good-run');
  const runs = [];
  for (let i = 0; i < 50; i += 1) {
    const id = `20261102-14${String(i).padStart(2, '0')}-a1b2`;
    runs.push({ ...base, id });
  }
  const t0 = performance.now();
  const layout = layoutRuns(runs);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 1000, `Expected < 1000ms, took ${elapsed.toFixed(1)}ms`);
  assert.equal(layout.nodes.length, 1 + 50 * base.nodes.length);
});
