import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from '../plugins/gon/viewer/md-safe.mjs';

test('escapes <script>, <img onerror> and event-handler attributes', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> <div onclick="evil()">hi</div>');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<div/i);
  assert.doesNotMatch(html, /<[a-z][^>]*\bon\w+\s*=/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;div onclick=&quot;evil\(\)&quot;&gt;hi&lt;\/div&gt;/);
});

test('drops javascript:, vbscript:, data:text/html and protocol-relative links, including JaVaScRiPt:, &#106;avascript:, leading control characters and tab/newline inside the scheme', () => {
  const cases = [
    '[click](javascript:alert(1))',
    '[click](vbscript:msgbox(1))',
    '[click](data:text/html,<script>alert(1)</script>)',
    '[click](//evil.example.com/a)',
    '[click](JaVaScRiPt:alert(1))',
    '[click](&#106;avascript:alert(1))',
    '[click](\x01\x02javascript:alert(1))',
    '[click](java\tscript:alert(1))',
    '[click](java\nscript:alert(1))',
  ];
  for (const input of cases) {
    const out = renderMarkdown(input);
    assert.doesNotMatch(out, /<a\b/i, `Expected no <a> tag for ${JSON.stringify(input)}, got: ${out}`);
    assert.doesNotMatch(out, /javascript:/i);
    assert.doesNotMatch(out, /vbscript:/i);
    assert.doesNotMatch(out, /data:text\/html/i);
  }
});

test('keeps https links with rel noopener noreferrer and shows the real host', () => {
  const out = renderMarkdown('참고 [공식 문서](https://docs.example.com/guide?a=1&b=2)');
  assert.match(out, /<a href="https:\/\/docs\.example\.com\/guide\?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">공식 문서<\/a>/);
  assert.match(out, /docs\.example\.com/);
});

test('neutralizes quote injection like [a](https://x.com" onmouseover="alert(1))', () => {
  const out = renderMarkdown('[a](https://x.com" onmouseover="alert(1))');
  assert.doesNotMatch(out, /onmouseover=/i);
  assert.doesNotMatch(out, /<a[^>]*onmouseover/i);
});

test('does not render image syntax as an image tag', () => {
  const out = renderMarkdown('![추적 이미지](https://tracker.example.com/pixel.png)');
  assert.doesNotMatch(out, /<img\b/i);
  assert.doesNotMatch(out, /<a\b/i);
  assert.match(out, /!\[추적 이미지\]/);
});

test('handles nested emphasis, quotes and lists without crashing and renders an unterminated code fence as text', () => {
  const md = [
    '# 제목 1',
    '## 제목 2',
    '> 인용문 **굵게 *기울임* 중첩** `인라인 코드`',
    '- 항목 1',
    '- 항목 2',
    '1. 번호 1',
    '2. 번호 2',
    '```js',
    'const x = "<script>";',
  ].join('\n');
  const out = renderMarkdown(md);
  assert.match(out, /<h1>제목 1<\/h1>/);
  assert.match(out, /<h2>제목 2<\/h2>/);
  assert.match(out, /<blockquote>/);
  assert.match(out, /<ul>/);
  assert.match(out, /<ol>/);
  assert.match(out, /<pre><code>/);
  assert.match(out, /&lt;script&gt;/);
});

test('finishes 1MB of text within 1 second and 100000 repetitions of "[a](" within 1 second', () => {
  const bigText = '가나다라마바사 **굵게** `코드` 일반 문장입니다.\n'.repeat(30000);
  assert.ok(Buffer.byteLength(bigText, 'utf8') >= 1024 * 1024);

  const t0 = performance.now();
  const out1 = renderMarkdown(bigText);
  const elapsed1 = performance.now() - t0;
  assert.ok(out1.length > 0);
  assert.ok(elapsed1 < 1000, `1MB markdown took ${elapsed1.toFixed(1)}ms`);

  const pathological = '[a]('.repeat(100000);
  const t1 = performance.now();
  const out2 = renderMarkdown(pathological);
  const elapsed2 = performance.now() - t1;
  assert.ok(out2.length > 0);
  assert.ok(elapsed2 < 1000, `100k "[a](" took ${elapsed2.toFixed(1)}ms`);
});

test('returns escaped original text when rendering throws', () => {
  // Make the renderer fail from the outside (no test hook in shipped code): String.prototype.split throws.
  const originalSplit = String.prototype.split;
  let out;
  String.prototype.split = function splitThatThrows() {
    throw new Error('injected failure');
  };
  try {
    out = renderMarkdown('<script>alert("fallback")</script>');
  } finally {
    String.prototype.split = originalSplit;
  }
  assert.equal(out, '<pre>&lt;script&gt;alert(&quot;fallback&quot;)&lt;/script&gt;</pre>');
});

test('md-safe.mjs ships no test-only switch', () => {
  const src = fs.readFileSync(path.resolve('plugins/gon/viewer/md-safe.mjs'), 'utf8');
  assert.doesNotMatch(src, /_forceThrow|opts\._/);
});

test('a link followed by a parenthetical keeps both the link and the rest of the text', () => {
  const out = renderMarkdown('See [docs](https://a.com/x) for more (v2) details.');
  assert.match(out, /<a href="https:\/\/a\.com\/x" rel="noopener noreferrer" target="_blank">docs<\/a>/);
  assert.match(out, / for more \(v2\) details\./);
});

test('a URL with one level of balanced parentheses stays one link', () => {
  const out = renderMarkdown('[w](https://a.com/a_(b)) end');
  assert.match(out, /<a href="https:\/\/a\.com\/a_\(b\)" rel="noopener noreferrer" target="_blank">w<\/a>/);
  assert.match(out, / end<\/p>$/);
});

test('link parsing stays fast on 100000 repetitions of "[a](" followed by ")" and of "[a](x(" ', () => {
  for (const input of ['[a]('.repeat(100000) + ')', '[a](x('.repeat(100000) + '))', `[a](${'x'.repeat(1999)} `.repeat(500) + ')']) {
    const t0 = performance.now();
    const out = renderMarkdown(input);
    const elapsed = performance.now() - t0;
    assert.ok(out.length > 0);
    assert.ok(elapsed < 1000, `took ${elapsed.toFixed(1)}ms`);
  }
});

test('renders unicode, emoji and U+202E unchanged as text while stripping bidi/control chars from displayed link host', () => {
  const out = renderMarkdown('한글 🚀 이모지 \u202E 텍스트 [링크](https://example.com/path)');
  assert.match(out, /한글 🚀 이모지 \u202E 텍스트/);
  assert.match(out, /\(example\.com\)/);
});
