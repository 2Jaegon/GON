import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { startServer } from '../plugins/gon/viewer/server.mjs';

const FIXTURES = path.resolve('tests/fixtures');

const EXPECTED_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function rawTcpHttp(port, rawRequestText) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(rawRequestText);
    });
    const chunks = [];
    sock.on('data', (c) => chunks.push(c));
    sock.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})/.exec(text);
      resolve({
        status: statusMatch ? Number(statusMatch[1]) : 0,
        raw: text,
      });
    });
    sock.on('error', reject);
  });
}

function makeTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gon 서버 테스트-'));
  const gonDir = path.join(root, '.gon');
  fs.mkdirSync(gonDir, { recursive: true });
  return {
    root,
    gonDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function copyGoodRun(gonDir, runId = '20261102-1430-a1b2') {
  const dest = path.join(gonDir, runId);
  fs.cpSync(path.join(FIXTURES, 'good-run'), dest, { recursive: true });
  return dest;
}

function rawRequest(port, { method = 'GET', path: reqPath = '/', headers = {}, setDefaultHost = true } = {}) {
  return new Promise((resolve, reject) => {
    const finalHeaders = { ...headers };
    if (setDefaultHost && !Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'host')) {
      finalHeaders.Host = `127.0.0.1:${port}`;
    }
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: reqPath,
        headers: finalHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function assertSecurityHeaders(headers) {
  assert.equal(headers['content-security-policy'], EXPECTED_CSP);
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['cross-origin-resource-policy'], 'same-origin');
  for (const key of Object.keys(headers)) {
    assert.ok(!key.toLowerCase().startsWith('access-control-'), `Unexpected CORS header: ${key}`);
  }
}

test('serves run list and run detail from a gon dir with Korean and space in path', async () => {
  const ws = makeTempWorkspace();
  try {
    copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const listRes = await rawRequest(srv.port, {
        path: '/api/runs',
        headers: { 'x-gon-token': srv.token },
      });
      assert.equal(listRes.status, 200);
      assertSecurityHeaders(listRes.headers);
      const runs = JSON.parse(listRes.body);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].id, '20261102-1430-a1b2');
      assert.equal(runs[0].status, 'done');
      assert.equal(runs[0].nodeCount, 8);

      const detailRes = await rawRequest(srv.port, {
        path: '/api/runs/20261102-1430-a1b2',
        headers: { 'x-gon-token': srv.token },
      });
      assert.equal(detailRes.status, 200);
      const detail = JSON.parse(detailRes.body);
      assert.equal(detail.run.id, '20261102-1430-a1b2');
      assert.equal(detail.status, 'done');
      assert.equal(detail.skipped, 0);

      const fileRes = await rawRequest(srv.port, {
        path: '/api/runs/20261102-1430-a1b2/file?path=brief.md',
        headers: { 'x-gon-token': srv.token },
      });
      assert.equal(fileRes.status, 200);
      assert.match(fileRes.headers['content-type'], /^text\/plain;\s*charset=utf-8$/i);
      assert.match(fileRes.body, /요구사항 요약/);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('returns empty array when .gon dir is missing, empty, or has non-run folders', async () => {
  const ws = makeTempWorkspace();
  try {
    const missingDir = path.join(ws.root, 'non-existent-gon');
    const srv1 = await startServer({ gonDir: missingDir });
    try {
      const res1 = await rawRequest(srv1.port, {
        path: '/api/runs',
        headers: { 'x-gon-token': srv1.token },
      });
      assert.equal(res1.status, 200);
      assert.deepEqual(JSON.parse(res1.body), []);
    } finally {
      await srv1.close();
    }

    fs.mkdirSync(path.join(ws.gonDir, 'not-a-run'), { recursive: true });
    fs.writeFileSync(path.join(ws.gonDir, 'random.txt'), 'hi', 'utf8');
    const srv2 = await startServer({ gonDir: ws.gonDir });
    try {
      const res2 = await rawRequest(srv2.port, {
        path: '/api/runs',
        headers: { 'x-gon-token': srv2.token },
      });
      assert.equal(res2.status, 200);
      assert.deepEqual(JSON.parse(res2.body), []);
    } finally {
      await srv2.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('rejects /api without token, with wrong token, with empty token at start, with duplicated or query token, all 403 without body leak', async () => {
  const ws = makeTempWorkspace();
  try {
    copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    await assert.rejects(() => startServer({ gonDir: ws.gonDir, token: '' }));
    await assert.rejects(() => startServer({ gonDir: ws.gonDir, token: '   ' }));

    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const noTok = await rawRequest(srv.port, { path: '/api/runs' });
      assert.equal(noTok.status, 403);
      assertSecurityHeaders(noTok.headers);
      assert.doesNotMatch(noTok.body, /20261102/);

      const wrongTok = await rawRequest(srv.port, {
        path: '/api/runs',
        headers: { 'x-gon-token': 'wrong-token-value' },
      });
      assert.equal(wrongTok.status, 403);

      const queryTok = await rawRequest(srv.port, {
        path: `/api/runs?t=${srv.token}`,
      });
      assert.equal(queryTok.status, 403);

      const queryPlusHeaderTok = await rawRequest(srv.port, {
        path: `/api/runs?t=${srv.token}`,
        headers: { 'x-gon-token': srv.token },
      });
      assert.equal(queryPlusHeaderTok.status, 403);

      const dupTok = await rawRequest(srv.port, {
        path: '/api/runs',
        headers: { 'x-gon-token': [srv.token, srv.token] },
      });
      assert.equal(dupTok.status, 403);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('rejects Host variants and allows localhost:<port> case-insensitively', async () => {
  const ws = makeTempWorkspace();
  try {
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const badHosts = [
        '127.0.0.1.evil.com',
        `127.0.0.1.evil.com:${srv.port}`,
        `localhost:${srv.port + 1}`,
        `evil.com#@127.0.0.1:${srv.port}`,
        `[::1]:${srv.port}`,
      ];
      for (const h of badHosts) {
        const res = await rawRequest(srv.port, {
          path: '/api/runs',
          headers: { Host: h, 'x-gon-token': srv.token },
        });
        assert.equal(res.status, 403, `Expected 403 for Host "${h}", got ${res.status}`);
      }

      // Missing Host header over raw TCP
      const noHostRes = await rawTcpHttp(
        srv.port,
        `GET /api/runs HTTP/1.0\r\nx-gon-token: ${srv.token}\r\nConnection: close\r\n\r\n`,
      );
      assert.ok(noHostRes.status >= 400 && noHostRes.status < 500, `Expected 4xx for missing Host, got ${noHostRes.status}`);

      // Duplicate Host header over raw TCP
      const dupHost = await rawTcpHttp(
        srv.port,
        `GET /api/runs HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nHost: 127.0.0.1:${srv.port}\r\nx-gon-token: ${srv.token}\r\nConnection: close\r\n\r\n`,
      );
      assert.ok(dupHost.status >= 400 && dupHost.status < 500, `Expected 4xx for duplicate Host, got ${dupHost.status}`);

      const okLocalhost = await rawRequest(srv.port, {
        path: '/api/runs',
        headers: { Host: `LoCaLhOsT:${srv.port}`, 'x-gon-token': srv.token },
      });
      assert.equal(okLocalhost.status, 200);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('rejects cross-origin requests and never sets Access-Control-Allow-Origin', async () => {
  const ws = makeTempWorkspace();
  try {
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const evilOrigin = await rawRequest(srv.port, {
        path: '/api/runs',
        headers: {
          'x-gon-token': srv.token,
          Origin: 'https://evil.example.com',
        },
      });
      assert.equal(evilOrigin.status, 403);
      assertSecurityHeaders(evilOrigin.headers);

      const crossSite = await rawRequest(srv.port, {
        path: '/api/runs',
        headers: {
          'x-gon-token': srv.token,
          'Sec-Fetch-Site': 'cross-site',
        },
      });
      assert.equal(crossSite.status, 403);
      assertSecurityHeaders(crossSite.headers);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('rejects :id that is not a listed run id', async () => {
  const ws = makeTempWorkspace();
  try {
    copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    fs.mkdirSync(path.join(ws.gonDir, '20261102-1430-a1b2-evil'), { recursive: true });
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const badIds = [
        '..',
        '%2e%2e',
        'a/b',
        '',
        '20261102-1430-a1b2-evil',
        '20261102-1430-9999',
      ];
      for (const id of badIds) {
        const res = await rawRequest(srv.port, {
          path: `/api/runs/${id}`,
          headers: { 'x-gon-token': srv.token },
        });
        assert.ok(res.status >= 400 && res.status < 500, `Expected 4xx for id "${id}", got ${res.status}`);
      }
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('rejects path escapes on /api/runs/:id/file', async () => {
  const ws = makeTempWorkspace();
  try {
    const runDir = copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    const secretOutside = path.join(ws.root, 'secret.md');
    fs.writeFileSync(secretOutside, 'TOP_SECRET_OUTSIDE_CONTENT', 'utf8');
    fs.writeFileSync(path.join(runDir, '.env'), 'SECRET_ENV_KEY=12345', 'utf8');

    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const badPaths = [
        '../secret.md',
        '..\\secret.md',
        '%2e%2e%2fsecret.md',
        '%252e%252e%252fsecret.md',
        encodeURIComponent(secretOutside),
        '\\\\localhost\\c$\\secret.md',
        '//localhost/c$/secret.md',
        'C:secret.md',
        'brief.md::$DATA',
        'x:s.md',
        'CON.md',
        'NUL.md',
        'brief.md.',
        'brief.md%20',
        'BRIEF~1.MD',
        'brief.md%00',
        '.env',
        'events.jsonl',
      ];

      for (const p of badPaths) {
        const res = await rawRequest(srv.port, {
          path: `/api/runs/20261102-1430-a1b2/file?path=${p}`,
          headers: { 'x-gon-token': srv.token },
        });
        assert.ok(res.status >= 400 && res.status < 500, `Expected 4xx for path="${p}", got ${res.status}`);
        assert.doesNotMatch(res.body, /TOP_SECRET_OUTSIDE_CONTENT/);
        assert.doesNotMatch(res.body, /SECRET_ENV_KEY/);
        assert.doesNotMatch(res.body, /"ev":"run\.start"/);
      }

      // Raw NUL byte in TCP request
      const rawNul = await rawTcpHttp(
        srv.port,
        `GET /api/runs/20261102-1430-a1b2/file?path=brief\x00.md HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nx-gon-token: ${srv.token}\r\nConnection: close\r\n\r\n`,
      );
      assert.ok(rawNul.status >= 400 && rawNul.status < 500);

      // Verify server still responds normally after all escape attempts
      const okRes = await rawRequest(srv.port, {
        path: '/api/runs/20261102-1430-a1b2/file?path=brief.md',
        headers: { 'x-gon-token': srv.token },
      });
      assert.equal(okRes.status, 200);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('rejects links pointing outside (3 junction types: .md file link, run folder link, .gon link)', async () => {
  const ws = makeTempWorkspace();
  try {
    const outsideDir = path.join(ws.root, 'outside-dir');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'leak.md'), 'OUTSIDE_JUNCTION_SECRET', 'utf8');
    fs.cpSync(path.join(FIXTURES, 'good-run'), outsideDir, { recursive: true });

    const runDir = copyGoodRun(ws.gonDir, '20261102-1430-a1b2');

    // 1. Subdirectory junction inside run folder pointing to outsideDir. Since SAFE_OUT_RE allows no
    //    sub-folders, `linked/leak.md` is now rejected by the regex; the flat-name link guard is covered by
    //    the 'link guard' tests below.
    const subJunction = path.join(runDir, 'linked');
    fs.symlinkSync(outsideDir, subJunction, 'junction');

    // 2. Run folder junction inside .gon pointing to outsideDir
    const runJunctionId = '20261102-1500-beef';
    const runJunction = path.join(ws.gonDir, runJunctionId);
    fs.symlinkSync(outsideDir, runJunction, 'junction');

    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      // Case 1: sub-folder path through a junction (stopped by SAFE_OUT_RE before the link guard)
      const res1 = await rawRequest(srv.port, {
        path: '/api/runs/20261102-1430-a1b2/file?path=linked/leak.md',
        headers: { 'x-gon-token': srv.token },
      });
      assert.ok(res1.status >= 400 && res1.status < 500, `Expected 4xx for junction .md, got ${res1.status}`);
      assert.doesNotMatch(res1.body, /OUTSIDE_JUNCTION_SECRET/);

      // Case 2: run folder junction
      const listRes = await rawRequest(srv.port, {
        path: '/api/runs',
        headers: { 'x-gon-token': srv.token },
      });
      const listedIds = JSON.parse(listRes.body).map((r) => r.id);
      assert.ok(!listedIds.includes(runJunctionId), 'Junction run folder must not be listed');

      const res2 = await rawRequest(srv.port, {
        path: `/api/runs/${runJunctionId}`,
        headers: { 'x-gon-token': srv.token },
      });
      assert.ok(res2.status >= 400 && res2.status < 500);
    } finally {
      await srv.close();
    }

    // 3. .gon itself is a junction pointing to outsideDir
    const gonJunction = path.join(ws.root, '.gon-link');
    fs.symlinkSync(outsideDir, gonJunction, 'junction');
    const srv3 = await startServer({ gonDir: gonJunction });
    try {
      const res3 = await rawRequest(srv3.port, {
        path: '/api/runs',
        headers: { 'x-gon-token': srv3.token },
      });
      assert.ok(res3.status >= 400 && res3.status < 500, `Expected 4xx when .gon itself is a junction, got ${res3.status}`);
    } finally {
      await srv3.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('reads at most 1MB+1 bytes and rejects larger files', async () => {
  const ws = makeTempWorkspace();
  try {
    const runDir = copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    const exact1MB = path.join(runDir, 'exact.md');
    const over1MB = path.join(runDir, 'over.md');
    fs.writeFileSync(exact1MB, 'a'.repeat(1024 * 1024), 'utf8');
    fs.writeFileSync(over1MB, 'a'.repeat(1024 * 1024 + 1), 'utf8');

    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const okRes = await rawRequest(srv.port, {
        path: '/api/runs/20261102-1430-a1b2/file?path=exact.md',
        headers: { 'x-gon-token': srv.token },
      });
      assert.equal(okRes.status, 200);
      assert.equal(okRes.body.length, 1024 * 1024);

      const bigRes = await rawRequest(srv.port, {
        path: '/api/runs/20261102-1430-a1b2/file?path=over.md',
        headers: { 'x-gon-token': srv.token },
      });
      assert.ok(bigRes.status >= 400 && bigRes.status < 500, `Expected 4xx for >1MB file, got ${bigRes.status}`);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('serves only the fixed static files and rejects non-GET methods with 405 and exact security headers', async () => {
  const ws = makeTempWorkspace();
  try {
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const allowedStatic = ['/', '/app.js', '/style.css', '/events.mjs', '/graph-layout.mjs', '/md-safe.mjs'];
      for (const p of allowedStatic) {
        const res = await rawRequest(srv.port, { path: p });
        assert.equal(res.status, 200, `Expected 200 for ${p}`);
        assertSecurityHeaders(res.headers);
        if (p.endsWith('.mjs') || p.endsWith('.js')) {
          assert.match(res.headers['content-type'], /^text\/javascript;\s*charset=utf-8$/i);
        }
      }

      const forbiddenStatic = [
        '/server.mjs',
        '/../package.json',
        '/app.js/',
        '/%61pp.js',
        '//app.js',
        '/APP.JS',
        '/app.js::$DATA',
        '/app.js%00',
      ];
      for (const p of forbiddenStatic) {
        const res = await rawRequest(srv.port, { path: p });
        assert.equal(res.status, 404, `Expected 404 for ${p}, got ${res.status}`);
        assertSecurityHeaders(res.headers);
      }

      for (const method of ['HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE']) {
        const res = await rawRequest(srv.port, { method, path: '/' });
        assert.equal(res.status, 405, `Expected 405 for ${method}`);
        assertSecurityHeaders(res.headers);
      }
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('binds to 127.0.0.1 only, rejects EADDRINUSE, CLI rejects --host and exits 2 on port conflict, never logs token', async () => {
  const ws = makeTempWorkspace();
  try {
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      assert.equal(srv.server.address().address, '127.0.0.1');

      // Port conflict via startServer
      await assert.rejects(
        () => startServer({ gonDir: ws.gonDir, port: srv.port }),
        (err) => err && err.code === 'EADDRINUSE',
      );

      // CLI --host rejection
      const cliPath = path.resolve('plugins/gon/viewer/server.mjs');
      const hostRun = spawnSync(process.execPath, [cliPath, '--gon-dir', ws.gonDir, '--host', '0.0.0.0'], {
        encoding: 'utf8',
      });
      assert.notEqual(hostRun.status, 0);

      // CLI port conflict -> exit code 2
      const conflictRun = spawnSync(process.execPath, [cliPath, '--gon-dir', ws.gonDir, '--port', String(srv.port)], {
        encoding: 'utf8',
      });
      assert.equal(conflictRun.status, 2);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('SSE emits change within 1.5s after events.jsonl is appended, sends heartbeat, caps connections at 8, no leak after 50 cycles, close() finishes while SSE client is open', async () => {
  const ws = makeTempWorkspace();
  try {
    const runDir = copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    const srv = await startServer({ gonDir: ws.gonDir, pollMs: 100, pingMs: 150 });
    try {
      // 1. 50 connect/disconnect cycles
      for (let i = 0; i < 50; i += 1) {
        await new Promise((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: srv.port,
              path: '/api/stream',
              headers: { Host: `127.0.0.1:${srv.port}`, 'x-gon-token': srv.token },
            },
            (res) => {
              assert.equal(res.statusCode, 200);
              res.destroy();
              resolve();
            },
          );
          req.on('error', (err) => {
            if (err.code === 'ECONNRESET') resolve();
            else reject(err);
          });
          req.end();
        });
      }

      // 2. Cap connections at 8
      const openReqs = [];
      for (let i = 0; i < 8; i += 1) {
        const res = await new Promise((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: srv.port,
              path: '/api/stream',
              headers: { Host: `127.0.0.1:${srv.port}`, 'x-gon-token': srv.token },
            },
            (r) => resolve(r),
          );
          req.on('error', reject);
          req.end();
          openReqs.push(req);
        });
        assert.equal(res.statusCode, 200);
      }

      const ninth = await rawRequest(srv.port, {
        path: '/api/stream',
        headers: { 'x-gon-token': srv.token },
      });
      assert.equal(ninth.status, 429);

      // Close 7 of the 8 connections, keep 1 open to test heartbeat, change event, and close()
      for (let i = 1; i < openReqs.length; i += 1) {
        openReqs[i].destroy();
      }

      // Wait briefly for close events to propagate, then open a listener for change & ping
      await new Promise((r) => setTimeout(r, 50));

      const streamDataPromise = new Promise((resolve, reject) => {
        let buf = '';
        const req = http.request(
          {
            host: '127.0.0.1',
            port: srv.port,
            path: '/api/stream',
            headers: { Host: `127.0.0.1:${srv.port}`, 'x-gon-token': srv.token },
          },
          (res) => {
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              buf += chunk;
              if (buf.includes(': ping') && buf.includes('event: change') && buf.includes('20261102-1430-a1b2')) {
                resolve(buf);
              }
            });
          },
        );
        req.on('error', (err) => {
          if (err.code !== 'ECONNRESET') reject(err);
        });
        req.end();
        openReqs.push(req);
      });

      setTimeout(() => {
        fs.appendFileSync(
          path.join(runDir, 'events.jsonl'),
          '{"t":"2026-11-02T14:40:00+09:00","ev":"node","id":"lead","status":"done","sum":"재검증 완료"}\n',
          'utf8',
        );
      }, 80);

      const received = await streamDataPromise;
      assert.match(received, /: ping/);
      assert.match(received, /event: change/);
    } finally {
      // close() must finish promptly even while SSE clients are still open!
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('/api/runs stays 200 with the good run listed when another run has a deeply nested (depth 100k) record line', async () => {
  const ws = makeTempWorkspace();
  try {
    copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    const badDir = path.join(ws.gonDir, '20261102-1431-dead');
    fs.mkdirSync(badDir);
    const deep = '['.repeat(100000) + ']'.repeat(100000);
    fs.writeFileSync(
      path.join(badDir, 'events.jsonl'),
      '{"v":1,"t":"2026-11-02T14:31:00+09:00","ev":"run.start","run":"20261102-1431-dead","req":"r","tool":"claude-code","depth":"quick"}\n' +
        `{"t":"2026-11-02T14:31:01+09:00","ev":"node","id":"n1","from":${deep},"stage":"grill","status":"running"}\n`,
      'utf8',
    );
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const listRes = await rawRequest(srv.port, { path: '/api/runs', headers: { 'x-gon-token': srv.token } });
      assert.equal(listRes.status, 200);
      const runs = JSON.parse(listRes.body);
      assert.ok(runs.some((r) => r.id === '20261102-1430-a1b2' && r.status === 'done'), listRes.body);

      const detailRes = await rawRequest(srv.port, { path: '/api/runs/20261102-1431-dead', headers: { 'x-gon-token': srv.token } });
      assert.notEqual(detailRes.status, 500);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('rejects hard links (nlink > 1) to files outside the run folder, for .md files and for events.jsonl', async () => {
  const ws = makeTempWorkspace();
  try {
    const runDir = copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    const outsideSecret = path.join(ws.root, 'outside-secret.md');
    fs.writeFileSync(outsideSecret, 'HARDLINK_OUTSIDE_SECRET', 'utf8');
    // No skip: if the hard link cannot be created, the test fails.
    fs.linkSync(outsideSecret, path.join(runDir, 'leak.md'));

    const linkedRunId = '20261102-1431-beef';
    fs.mkdirSync(path.join(ws.gonDir, linkedRunId));
    const outsideEvents = path.join(ws.root, 'outside-events.jsonl');
    fs.copyFileSync(path.join(FIXTURES, 'good-run', 'events.jsonl'), outsideEvents);
    fs.linkSync(outsideEvents, path.join(ws.gonDir, linkedRunId, 'events.jsonl'));

    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const fileRes = await rawRequest(srv.port, {
        path: '/api/runs/20261102-1430-a1b2/file?path=leak.md',
        headers: { 'x-gon-token': srv.token },
      });
      assert.equal(fileRes.status, 400);
      assert.doesNotMatch(fileRes.body, /HARDLINK_OUTSIDE_SECRET/);

      const listRes = await rawRequest(srv.port, { path: '/api/runs', headers: { 'x-gon-token': srv.token } });
      const ids = JSON.parse(listRes.body).map((r) => r.id);
      assert.deepEqual(ids, ['20261102-1430-a1b2']);

      const detailRes = await rawRequest(srv.port, { path: `/api/runs/${linkedRunId}`, headers: { 'x-gon-token': srv.token } });
      assert.equal(detailRes.status, 404);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('an events.jsonl over 4MB is left out of the list and its detail is 413, keeping responses small', async () => {
  const ws = makeTempWorkspace();
  try {
    copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    const bigId = '20261102-1432-b16b';
    fs.mkdirSync(path.join(ws.gonDir, bigId));
    const start = `{"v":1,"t":"2026-11-02T14:32:00+09:00","ev":"run.start","run":"${bigId}","req":"big","tool":"claude-code","depth":"quick"}\n`;
    const node = `{"t":"2026-11-02T14:32:01+09:00","ev":"node","id":"n1","from":["main"],"stage":"grill","status":"done","sum":"${'x'.repeat(4 * 1024 * 1024)}"}\n`;
    fs.writeFileSync(path.join(ws.gonDir, bigId, 'events.jsonl'), start + node, 'utf8');

    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const listRes = await rawRequest(srv.port, { path: '/api/runs', headers: { 'x-gon-token': srv.token } });
      assert.equal(listRes.status, 200);
      assert.ok(listRes.body.length < 64 * 1024, `list body is ${listRes.body.length} bytes`);
      assert.deepEqual(JSON.parse(listRes.body).map((r) => r.id), ['20261102-1430-a1b2']);

      const detailRes = await rawRequest(srv.port, { path: `/api/runs/${bigId}`, headers: { 'x-gon-token': srv.token } });
      assert.equal(detailRes.status, 413);
      assert.ok(detailRes.body.length < 1024, `detail body is ${detailRes.body.length} bytes`);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

async function getFile(srv, name) {
  return rawRequest(srv.port, {
    path: `/api/runs/20261102-1430-a1b2/file?path=${encodeURIComponent(name)}`,
    headers: { 'x-gon-token': srv.token },
  });
}

// Creates a file symlink; returns false only when Windows refuses it for lack of privilege.
function trySymlinkFile(target, link) {
  try {
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'ENOTSUP')) return false;
    throw err;
  }
}

test('link guard: a junction named j.md pointing to an outside folder is rejected with 400', async () => {
  const ws = makeTempWorkspace();
  try {
    const runDir = copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    const outsideDir = path.join(ws.root, 'outside-dir');
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'secret.md'), 'JUNCTION_MD_SECRET', 'utf8');
    // No privilege needed for a junction; if creation fails the test fails.
    fs.symlinkSync(outsideDir, path.join(runDir, 'j.md'), 'junction');
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const res = await getFile(srv, 'j.md');
      assert.equal(res.status, 400);
      assert.doesNotMatch(res.body, /JUNCTION_MD_SECRET/);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('link guard: a file symlink sym.md pointing to an outside secret is rejected with 400 (skips only on EPERM)', async (t) => {
  const ws = makeTempWorkspace();
  try {
    const runDir = copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    const secret = path.join(ws.root, 'outside-secret.md');
    fs.writeFileSync(secret, 'SYMLINK_MD_SECRET', 'utf8');
    if (!trySymlinkFile(secret, path.join(runDir, 'sym.md'))) {
      t.skip('file symlinks need Developer Mode or admin on this Windows machine (EPERM)');
      return;
    }
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const res = await getFile(srv, 'sym.md');
      assert.equal(res.status, 400);
      assert.doesNotMatch(res.body, /SYMLINK_MD_SECRET/);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('link guard: a symlink alias.md pointing to brief.md in the same run folder is rejected with 400 (skips only on EPERM)', async (t) => {
  const ws = makeTempWorkspace();
  try {
    const runDir = copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    // Target stays inside the run folder, so only the link guard (not realpath + relative) can reject it.
    if (!trySymlinkFile(path.join(runDir, 'brief.md'), path.join(runDir, 'alias.md'))) {
      t.skip('file symlinks need Developer Mode or admin on this Windows machine (EPERM)');
      return;
    }
    const srv = await startServer({ gonDir: ws.gonDir });
    try {
      const res = await getFile(srv, 'alias.md');
      assert.equal(res.status, 400);
      assert.doesNotMatch(res.body, /요구사항 요약/);
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('/api/runs does not hide a run when building its summary throws: the error surfaces as 500', async () => {
  const ws = makeTempWorkspace();
  try {
    const runDir = copyGoodRun(ws.gonDir, '20261102-1430-a1b2');
    // Drop run.end so runStatus has to compute stalled/running (it then calls Date.parse).
    const evPath = path.join(runDir, 'events.jsonl');
    const lines = fs.readFileSync(evPath, 'utf8').split('\n').filter((l) => l.trim() && !l.includes('"run.end"'));
    fs.writeFileSync(evPath, lines.join('\n') + '\n', 'utf8');
    const srv = await startServer({ gonDir: ws.gonDir });
    // Simulate a regression inside runStatus (it calls Date.parse) without a hook in shipped code.
    const originalParse = Date.parse;
    try {
      Date.parse = () => {
        throw new Error('injected runStatus failure');
      };
      const res = await rawRequest(srv.port, { path: '/api/runs', headers: { 'x-gon-token': srv.token } });
      assert.equal(res.status, 500, `a broken summary must not turn into a silently shorter list: ${res.body}`);
    } finally {
      Date.parse = originalParse;
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});
