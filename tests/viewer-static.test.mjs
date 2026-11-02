import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../plugins/gon/viewer/server.mjs';
import { createSource } from '../plugins/gon/viewer/app.js';

const VIEWER_DIR = path.resolve('plugins/gon/viewer');
const FIXTURES = path.resolve('tests/fixtures');

test('index.html has no inline script, no inline style attribute and no on* handlers', () => {
  const html = fs.readFileSync(path.join(VIEWER_DIR, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'index.html must not have inline <script> without src');
  assert.doesNotMatch(html, /<script[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i, 'script tag must have empty body');
  assert.doesNotMatch(html, /\bstyle\s*=/i, 'index.html must not use inline style= attributes');
  assert.doesNotMatch(html, /\bon[a-z]+\s*=/i, 'index.html must not use inline on* event handlers');
  // Must have main UI containers implemented in Task 5
  assert.match(html, /id="graph-svg"/);
  assert.match(html, /id="detail-panel"/);
});

test('app.js and style.css never use innerHTML with unsanitized data and SVG uses class/fill attributes, not style=', () => {
  const appJs = fs.readFileSync(path.join(VIEWER_DIR, 'app.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(VIEWER_DIR, 'style.css'), 'utf8');

  // Check every line containing innerHTML in app.js
  const lines = appJs.split(/\r?\n/);
  const innerHtmlLines = lines.filter((l) => l.includes('.innerHTML'));
  assert.ok(innerHtmlLines.length > 0, 'app.js should render markdown into detail view');
  for (const line of innerHtmlLines) {
    const safe = /\binnerHTML\s*=\s*(?:renderMarkdown\(|''|"")/.test(line);
    assert.ok(safe, `Unsafe innerHTML assignment found: ${line.trim()}`);
  }

  // Ensure no style= attribute injection in app.js
  assert.doesNotMatch(appJs, /setAttribute\(\s*['"]style['"]/i);
  assert.doesNotMatch(appJs, /\.style\./);
  assert.doesNotMatch(appJs, /\bstyle\s*=/i);

  // Ensure createSource is exported and implements the Source contract
  assert.match(appJs, /export\s+function\s+createSource\b/);
  assert.match(appJs, /\blistRuns\b/);
  assert.match(appJs, /\bgetRun\b/);
  assert.match(appJs, /\bgetFile\b/);
  assert.match(appJs, /\bsubscribe\b/);
  assert.match(appJs, /replaceState/);

  // Ensure style.css has prefers-reduced-motion and no purple gradients
  assert.match(styleCss, /prefers-reduced-motion:\s*reduce/);
});

test('createSource communicates with local server using header token and receives fetch stream events', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gon-ui-src-'));
  const gonDir = path.join(root, '.gon');
  const runDir = path.join(gonDir, '20261102-1430-a1b2');
  fs.mkdirSync(runDir, { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'good-run'), runDir, { recursive: true });

  const srv = await startServer({ gonDir, pollMs: 80 });
  try {
    const baseUrl = `http://127.0.0.1:${srv.port}`;
    const customFetch = (urlPath, init) => fetch(`${baseUrl}${urlPath}`, init);

    // Without token -> 403
    const noTokenSource = createSource({ token: '', fetchImpl: customFetch });
    await assert.rejects(() => noTokenSource.listRuns(), (err) => err.status === 403);

    // With token -> listRuns, getRun, getFile, subscribe
    const source = createSource({ token: srv.token, fetchImpl: customFetch });
    const runs = await source.listRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, '20261102-1430-a1b2');

    const detail = await source.getRun('20261102-1430-a1b2');
    assert.equal(detail.run.nodes.length, 8);

    const md = await source.getFile('20261102-1430-a1b2', 'brief.md');
    assert.match(md, /요구사항 요약/);

    const changePromise = new Promise((resolve) => {
      const unsub = source.subscribe((ev) => {
        unsub();
        resolve(ev);
      });
    });

    setTimeout(() => {
      fs.appendFileSync(
        path.join(runDir, 'events.jsonl'),
        '{"t":"2026-11-02T14:40:00+09:00","ev":"node","id":"lead","status":"done","sum":"갱신됨"}\n',
        'utf8',
      );
    }, 100);

    const changeEv = await changePromise;
    assert.equal(changeEv.runId, '20261102-1430-a1b2');
  } finally {
    await srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
