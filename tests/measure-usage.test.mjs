import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { sumUsage } from '../tools/measure-usage.mjs';

const USAGE_FIXTURES = path.resolve('tests/fixtures/session-usage');

test('sumUsage dedupes repeated message ids across files', () => {
  const mainText = fs.readFileSync(path.join(USAGE_FIXTURES, 'main.jsonl'), 'utf8');
  const subText = fs.readFileSync(path.join(USAGE_FIXTURES, 'subagent.jsonl'), 'utf8');
  const res = sumUsage([mainText, subText]);
  // msg_01AAA appears 3 times with output 10 (first), 50 (max), 20 (last, in subagent.jsonl).
  // Totals: last-wins 20+30+40=90, first-wins 80, max 120 -> the rule is last-wins.
  assert.equal(res.messages, 3);
  assert.equal(res.input, 200);
  assert.equal(res.cacheWrite, 400);
  assert.equal(res.cacheRead, 1400);
  assert.equal(res.output, 90);
  assert.equal(res.cacheReadRatio, 1400 / 2000);
});

test('computes ratio per spec formula (100 input, 200 write, 700 read -> 0.7)', () => {
  const line = JSON.stringify({
    message: {
      id: 'msg_ratio',
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 700,
        output_tokens: 25,
      },
    },
  });
  const res = sumUsage([line]);
  assert.equal(res.input, 100);
  assert.equal(res.cacheWrite, 200);
  assert.equal(res.cacheRead, 700);
  assert.equal(res.output, 25);
  assert.equal(res.messages, 1);
  assert.equal(res.cacheReadRatio, 0.7);
});

test('returns zeros and ratio 0 for empty input', () => {
  assert.deepEqual(sumUsage([]), {
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    messages: 0,
    cacheReadRatio: 0,
  });
  assert.deepEqual(sumUsage(['', '   \n  ']), {
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    messages: 0,
    cacheReadRatio: 0,
  });
});

test('ignores lines without usage', () => {
  const text = [
    '{"type":"user","message":{"role":"user","content":"hi"}}',
    '{"type":"system","subtype":"init"}',
    'not-json-at-all',
  ].join('\n');
  const res = sumUsage([text]);
  assert.equal(res.messages, 0);
  assert.equal(res.cacheReadRatio, 0);
});

test('counts subagent file usage in addition to main via CLI directory recursion', () => {
  const cli = path.resolve('tools/measure-usage.mjs');
  const out = execFileSync(process.execPath, [cli, USAGE_FIXTURES], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.messages, 3);
  assert.equal(parsed.input, 200);
  assert.equal(parsed.cacheWrite, 400);
  assert.equal(parsed.cacheRead, 1400);
  assert.equal(parsed.output, 90);
  assert.equal(parsed.cacheReadRatio, 0.7);
});

test('CLI dedupes across two files found by recursing a folder and ignores non-.jsonl files', () => {
  const cli = path.resolve('tools/measure-usage.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gon-usage-'));
  try {
    fs.mkdirSync(path.join(tmp, 'a', 'z'), { recursive: true });
    fs.copyFileSync(path.join(USAGE_FIXTURES, 'main.jsonl'), path.join(tmp, 'a', '1-main.jsonl'));
    fs.copyFileSync(path.join(USAGE_FIXTURES, 'subagent.jsonl'), path.join(tmp, 'a', 'z', 'subagent.jsonl'));
    fs.writeFileSync(path.join(tmp, 'a', 'notes.txt'), fs.readFileSync(path.join(USAGE_FIXTURES, 'subagent.jsonl')));
    const parsed = JSON.parse(execFileSync(process.execPath, [cli, tmp], { encoding: 'utf8' }));
    assert.equal(parsed.messages, 3);
    assert.equal(parsed.output, 90);
    assert.equal(parsed.cacheRead, 1400);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI exits 2 with a stderr message, and prints no JSON, for a missing path, a link, a non-.jsonl file or a folder without .jsonl', () => {
  const cli = path.resolve('tools/measure-usage.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gon-usage-bad-'));
  try {
    const txt = path.join(tmp, 'usage.txt');
    fs.writeFileSync(txt, fs.readFileSync(path.join(USAGE_FIXTURES, 'main.jsonl')));
    const emptyDir = path.join(tmp, 'empty');
    fs.mkdirSync(emptyDir);
    const link = path.join(tmp, 'link');
    fs.symlinkSync(USAGE_FIXTURES, link, 'junction');

    for (const target of [path.join(tmp, 'missing.jsonl'), link, txt, emptyDir]) {
      const res = spawnSync(process.execPath, [cli, target], { encoding: 'utf8' });
      assert.equal(res.status, 2, `${target}: expected exit 2, got ${res.status}`);
      assert.match(res.stderr, /\S/, `${target}: expected a stderr message`);
      assert.equal(res.stdout.trim(), '', `${target}: must not print JSON`);
    }
    // A bad target among good ones still fails.
    const mixed = spawnSync(process.execPath, [cli, USAGE_FIXTURES, path.join(tmp, 'missing.jsonl')], { encoding: 'utf8' });
    assert.equal(mixed.status, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
