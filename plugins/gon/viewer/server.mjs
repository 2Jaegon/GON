#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RUN_ID_RE, SAFE_OUT_RE, parseEvents, buildRun, runStatus } from './events.mjs';

const VIEWER_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_EVENTS_BYTES = 4 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const MAX_SSE_CLIENTS = 8;

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const STATIC_MAP = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
  ['/events.mjs', { file: 'events.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/graph-layout.mjs', { file: 'graph-layout.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/md-safe.mjs', { file: 'md-safe.mjs', type: 'text/javascript; charset=utf-8' }],
]);

const WIN_RESERVED_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const ENCODED_TRAVERSAL_RE = /%(?:2e|2f|5c|00|25)/i;

function getSingleRawHeader(rawHeaders, lowerName) {
  let found = null;
  let count = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === lowerName) {
      count += 1;
      found = rawHeaders[i + 1];
    }
  }
  return { count, value: found };
}

function sendResponse(res, status, contentType, body = '') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Content-Length': String(buf.length),
  });
  res.end(buf);
}

function sendJson(res, status, data) {
  sendResponse(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

const STATUS_TEXT = { 400: 'Bad Request', 413: 'Payload Too Large' };

// Reads a regular, single-link file of at most maxBytes, re-checking the cap while reading
// so a file that grows mid-read is still rejected. Returns { status: 200, buf } or { status }.
function readBoundedFile(filePath, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const st = fs.fstatSync(fd);
    // nlink > 1: a hard link can point at a file outside the run folder (no reparse point to detect).
    if (!st.isFile() || st.nlink > 1) return { status: 400 };
    if (st.size > maxBytes) return { status: 413 };
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1));
    const parts = [];
    let total = 0;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, total);
      if (n === 0) break;
      total += n;
      if (total > maxBytes) return { status: 413 };
      parts.push(Buffer.from(chunk.subarray(0, n)));
    }
    return { status: 200, buf: Buffer.concat(parts, total) };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close error
      }
    }
  }
}

function sendStatus(res, status) {
  sendResponse(res, status, 'text/plain; charset=utf-8', STATUS_TEXT[status] || 'Error');
}

function isLinkOrJunction(targetPath) {
  const st = fs.lstatSync(targetPath);
  if (st.isSymbolicLink()) return true;
  const parentReal = fs.realpathSync(path.dirname(targetPath));
  const targetReal = fs.realpathSync(targetPath);
  return targetReal !== path.join(parentReal, path.basename(targetPath));
}

function inspectGonDir(gonDir) {
  if (!fs.existsSync(gonDir)) {
    return { ok: true, exists: false, runIds: [] };
  }
  try {
    if (isLinkOrJunction(gonDir)) {
      return { ok: false, exists: true, runIds: [] };
    }
    const st = fs.lstatSync(gonDir);
    if (!st.isDirectory()) {
      return { ok: true, exists: false, runIds: [] };
    }
    const entries = fs.readdirSync(gonDir, { withFileTypes: true });
    const runIds = [];
    for (const entry of entries) {
      if (!RUN_ID_RE.test(entry.name)) continue;
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const runDir = path.join(gonDir, entry.name);
      if (isLinkOrJunction(runDir)) continue;
      const evPath = path.join(runDir, 'events.jsonl');
      if (!fs.existsSync(evPath)) continue;
      if (isLinkOrJunction(evPath)) continue;
      const evStat = fs.lstatSync(evPath);
      if (!evStat.isFile() || evStat.nlink > 1) continue;
      runIds.push(entry.name);
    }
    runIds.sort();
    return { ok: true, exists: true, runIds };
  } catch {
    return { ok: false, exists: false, runIds: [] };
  }
}

function validateSafeMdPath(runDir, rawQuery) {
  if (typeof rawQuery !== 'string' || !rawQuery) return null;
  if (rawQuery.includes('\0') || ENCODED_TRAVERSAL_RE.test(rawQuery)) return null;

  const params = new URLSearchParams(rawQuery);
  const allPaths = params.getAll('path');
  if (allPaths.length !== 1) return null;
  for (const key of params.keys()) {
    if (key !== 'path') return null;
  }

  const rel = allPaths[0];
  if (!rel || typeof rel !== 'string') return null;
  if (!SAFE_OUT_RE.test(rel)) return null;

  // Verify single-decode stability
  try {
    if (decodeURIComponent(rel) !== rel) return null;
  } catch {
    return null;
  }

  const segments = rel.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.includes('..')) return null;
    if (seg.endsWith('.') || seg.endsWith(' ')) return null;
    const stem = seg.split('.')[0];
    if (WIN_RESERVED_RE.test(stem)) return null;
  }

  try {
    const realRunDir = fs.realpathSync(runDir);
    let current = realRunDir;
    for (const seg of segments) {
      current = path.join(current, seg);
      if (!fs.existsSync(current)) return null;
      if (isLinkOrJunction(current)) return null;
    }
    const realTarget = fs.realpathSync(current);
    const relFromRun = path.relative(realRunDir, realTarget);
    if (!relFromRun || relFromRun.startsWith('..') || path.isAbsolute(relFromRun)) {
      return null;
    }
    return realTarget;
  } catch {
    return null;
  }
}

export async function startServer(opts = {}) {
  const gonDir = path.resolve(String(opts.gonDir ?? '.gon'));
  const requestedPort = opts.port !== undefined ? Number(opts.port) : 0;
  const pollMs = typeof opts.pollMs === 'number' && opts.pollMs > 0 ? opts.pollMs : 400;
  const pingMs = typeof opts.pingMs === 'number' && opts.pingMs > 0 ? opts.pingMs : 15000;

  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error(`Invalid port: ${opts.port}`);
  }

  let token;
  if (opts.token !== undefined) {
    if (typeof opts.token !== 'string' || opts.token.trim().length === 0) {
      throw new Error('Token must be a non-empty string');
    }
    token = opts.token;
  } else {
    token = crypto.randomBytes(16).toString('hex');
  }
  const tokenBuf = Buffer.from(token, 'utf8');

  let boundPort = 0;
  const sseClients = new Set();

  function verifyToken(req, rawQuery) {
    if (rawQuery && /(?:^|&)t(?:=|$)/.test(rawQuery)) {
      return false;
    }
    const { count, value } = getSingleRawHeader(req.rawHeaders, 'x-gon-token');
    if (count !== 1 || typeof value !== 'string' || value.length === 0) {
      return false;
    }
    const candidateBuf = Buffer.from(value, 'utf8');
    if (candidateBuf.length !== tokenBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(candidateBuf, tokenBuf);
  }

  function verifyHostAndOrigin(req) {
    const { count, value } = getSingleRawHeader(req.rawHeaders, 'host');
    if (count !== 1 || typeof value !== 'string') return false;
    const hostLower = value.toLowerCase();
    const allowedHost1 = `127.0.0.1:${boundPort}`;
    const allowedHost2 = `localhost:${boundPort}`;
    if (hostLower !== allowedHost1 && hostLower !== allowedHost2) {
      return false;
    }

    const secFetchSite = req.headers['sec-fetch-site'];
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      return false;
    }

    const origin = req.headers.origin;
    if (origin !== undefined) {
      const originLower = String(origin).toLowerCase();
      if (originLower !== `http://${allowedHost1}` && originLower !== `http://${allowedHost2}`) {
        return false;
      }
    }
    return true;
  }

  const server = http.createServer((req, res) => {
    try {
      if (!verifyHostAndOrigin(req)) {
        sendResponse(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
        return;
      }

      if (req.method !== 'GET') {
        sendResponse(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
        return;
      }

      const rawUrl = typeof req.url === 'string' ? req.url : '/';
      if (rawUrl.includes('\0')) {
        sendResponse(res, 400, 'text/plain; charset=utf-8', 'Bad Request');
        return;
      }

      const qIdx = rawUrl.indexOf('?');
      const rawPath = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
      const rawQuery = qIdx === -1 ? '' : rawUrl.slice(qIdx + 1);

      if (STATIC_MAP.has(rawPath)) {
        const entry = STATIC_MAP.get(rawPath);
        const filePath = path.join(VIEWER_DIR, entry.file);
        const content = fs.readFileSync(filePath);
        sendResponse(res, 200, entry.type, content);
        return;
      }

      if (!rawPath.startsWith('/api/')) {
        sendResponse(res, 404, 'text/plain; charset=utf-8', 'Not Found');
        return;
      }

      if (!verifyToken(req, rawQuery)) {
        sendResponse(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
        return;
      }

      const gonCheck = inspectGonDir(gonDir);
      if (!gonCheck.ok) {
        sendResponse(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
        return;
      }

      if (rawPath === '/api/runs' && rawQuery === '') {
        const summaries = [];
        for (const runId of gonCheck.runIds) {
          // One unreadable or hostile run must not take down the whole list: skip it.
          try {
            const read = readBoundedFile(path.join(gonDir, runId, 'events.jsonl'), MAX_EVENTS_BYTES);
            if (read.status !== 200) continue;
            const { events } = parseEvents(read.buf.toString('utf8'));
            const run = buildRun(runId, events);
            summaries.push({
              id: run.id,
              req: run.req,
              tool: run.tool,
              depth: run.depth,
              status: runStatus(run),
              startedAt: run.startedAt,
              endedAt: run.endedAt,
              nodeCount: run.nodes.length,
            });
          } catch {
            // skipped
          }
        }
        sendJson(res, 200, summaries);
        return;
      }

      if (rawPath === '/api/stream' && rawQuery === '') {
        if (sseClients.size >= MAX_SSE_CLIENTS) {
          sendResponse(res, 429, 'text/plain; charset=utf-8', 'Too Many Requests');
          return;
        }
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          Connection: 'keep-alive',
        });
        res.write(': connected\n\n');

        const pingTimer = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            // client closed
          }
        }, pingMs);
        pingTimer.unref?.();

        const client = { res, pingTimer };
        sseClients.add(client);

        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          clearInterval(pingTimer);
          sseClients.delete(client);
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        res.on('error', cleanup);
        return;
      }

      const detailMatch = /^\/api\/runs\/([^/]+)$/.exec(rawPath);
      if (detailMatch && rawQuery === '') {
        const runId = detailMatch[1];
        if (!RUN_ID_RE.test(runId) || !gonCheck.runIds.includes(runId)) {
          sendResponse(res, 404, 'text/plain; charset=utf-8', 'Not Found');
          return;
        }
        const read = readBoundedFile(path.join(gonDir, runId, 'events.jsonl'), MAX_EVENTS_BYTES);
        if (read.status !== 200) {
          sendStatus(res, read.status);
          return;
        }
        const { events, skipped } = parseEvents(read.buf.toString('utf8'));
        const run = buildRun(runId, events);
        sendJson(res, 200, {
          run,
          status: runStatus(run),
          skipped,
        });
        return;
      }

      const fileMatch = /^\/api\/runs\/([^/]+)\/file$/.exec(rawPath);
      if (fileMatch) {
        const runId = fileMatch[1];
        if (!RUN_ID_RE.test(runId) || !gonCheck.runIds.includes(runId)) {
          sendResponse(res, 404, 'text/plain; charset=utf-8', 'Not Found');
          return;
        }
        const runDir = path.join(gonDir, runId);
        const safeTarget = validateSafeMdPath(runDir, rawQuery);
        if (!safeTarget) {
          sendResponse(res, 400, 'text/plain; charset=utf-8', 'Bad Request');
          return;
        }

        const read = readBoundedFile(safeTarget, MAX_FILE_BYTES);
        if (read.status !== 200) {
          sendStatus(res, read.status);
          return;
        }
        sendResponse(res, 200, 'text/plain; charset=utf-8', read.buf);
        return;
      }

      sendResponse(res, 404, 'text/plain; charset=utf-8', 'Not Found');
    } catch {
      if (!res.headersSent) {
        sendResponse(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
      } else {
        res.end();
      }
    }
  });

  server.on('clientError', (_err, socket) => {
    if (socket.writable) {
      const hdrs = Object.entries(SECURITY_HEADERS)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n');
      socket.end(`HTTP/1.1 400 Bad Request\r\n${hdrs}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 11\r\nConnection: close\r\n\r\nBad Request`);
    }
  });

  // Snapshot state for polling
  const snapshot = new Map();
  function takeSnapshot(emitChanges) {
    const check = inspectGonDir(gonDir);
    if (!check.ok || !check.exists) return;
    const currentIds = new Set(check.runIds);
    for (const runId of check.runIds) {
      try {
        const evPath = path.join(gonDir, runId, 'events.jsonl');
        const st = fs.statSync(evPath);
        const sig = `${st.size}:${st.mtimeMs}`;
        const prev = snapshot.get(runId);
        if (prev !== sig) {
          snapshot.set(runId, sig);
          if (emitChanges && sseClients.size > 0) {
            const msg = `event: change\ndata: ${JSON.stringify({ runId })}\n\n`;
            for (const c of sseClients) {
              try {
                c.res.write(msg);
              } catch {
                // ignore write error
              }
            }
          }
        }
      } catch {
        // ignore transient read error
      }
    }
    for (const oldId of snapshot.keys()) {
      if (!currentIds.has(oldId)) {
        snapshot.delete(oldId);
      }
    }
  }

  takeSnapshot(false);
  const pollTimer = setInterval(() => takeSnapshot(true), pollMs);
  pollTimer.unref?.();

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      clearInterval(pollTimer);
      reject(err);
    };
    server.once('error', onError);
    server.listen(requestedPort, '127.0.0.1', () => {
      server.removeListener('error', onError);
      boundPort = server.address().port;
      resolve();
    });
  });

  const url = `http://127.0.0.1:${boundPort}/?t=${token}`;

  async function close() {
    clearInterval(pollTimer);
    for (const c of sseClients) {
      clearInterval(c.pingTimer);
      try {
        c.res.end();
      } catch {
        // ignore
      }
    }
    sseClients.clear();
    server.closeAllConnections?.();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  return {
    url,
    port: boundPort,
    token,
    server,
    close,
  };
}

function parseCliArgs(argv) {
  let gonDir = '.gon';
  let port = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--gon-dir') {
      if (i + 1 >= argv.length) throw new Error('Missing value for --gon-dir');
      gonDir = argv[i + 1];
      i += 1;
    } else if (arg === '--port') {
      if (i + 1 >= argv.length) throw new Error('Missing value for --port');
      port = Number(argv[i + 1]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --port value: ${argv[i + 1]}`);
      }
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { gonDir, port };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  startServer(parsed)
    .then((srv) => {
      console.log(`Open: ${srv.url}`);
    })
    .catch((err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`Error: Port ${parsed.port} is already in use (EADDRINUSE).`);
        process.exit(2);
      }
      console.error(`Error: ${err?.message || err}`);
      process.exit(1);
    });
}
