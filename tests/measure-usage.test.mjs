import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sumUsage } from '../tools/measure-usage.mjs';

const USAGE_FIXTURES = path.resolve('tests/fixtures/session-usage');

test('sumUsage dedupes repeated message ids across files', () => {
  const mainText = fs.readFileSync(path.join(USAGE_FIXTURES, 'main.jsonl'), 'utf8');
  const subText = fs.readFileSync(path.join(USAGE_FIXTURES, 'subagent.jsonl'), 'utf8');
  const res = sumUsage([mainText, subText]);
  // Unique message ids: msg_01AAA (100, 200, 700, 50), msg_02BBB (50, 50, 400, 30), msg_sub_01 (50, 150, 300, 40)
  assert.equal(res.messages, 3);
  assert.equal(res.input, 200);
  assert.equal(res.cacheWrite, 400);
  assert.equal(res.cacheRead, 1400);
  assert.equal(res.output, 120);
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
  assert.equal(parsed.output, 120);
  assert.equal(parsed.cacheReadRatio, 0.7);
});
