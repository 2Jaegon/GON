export const RUN_ID_RE = /^\d{8}-\d{4}-[0-9a-f]{4}$/;
export const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const DEPTHS = ['quick', 'normal', 'deep'];
export const STAGES = ['grill', 'plan', 'check', 'compose', 'execute', 'lead'];

const NODE_STATUSES = ['running', 'done', 'failed', 'skipped'];
const END_STATUSES = ['done', 'failed'];
const VIAS = ['subagent', 'inline'];
const STALL_MS = 10 * 60 * 1000;
const MAX_FROM = 32;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isNodeRef(v) {
  return typeof v === 'string' && (v === 'main' || NODE_ID_RE.test(v));
}

function cleanFrom(from) {
  return Array.isArray(from) ? from.filter(isNodeRef).slice(0, MAX_FROM) : [];
}

// Formats an untrusted value for an error message without String() recursion.
function show(v) {
  if (typeof v === 'string') return JSON.stringify(v.slice(0, 80));
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return String(v);
  return Array.isArray(v) ? '<array>' : `<${typeof v}>`;
}

export function parseEvents(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { events: [], skipped: 0 };
  }
  const lines = text.split(/\r?\n/);
  const events = [];
  let skipped = 0;

  for (const rawLine of lines) {
    const cleaned = rawLine.replace(/^\uFEFF+/, '').trim();
    if (!cleaned) continue;
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        events.push(parsed);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }

  return { events, skipped };
}

export function buildRun(runId, events) {
  const run = {
    id: String(runId ?? ''),
    req: '',
    tool: '',
    depth: 'normal',
    startedAt: '',
    endedAt: null,
    endStatus: null,
    nodes: [],
  };

  if (!Array.isArray(events)) {
    return run;
  }

  const nodeMap = new Map();

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const t = typeof ev.t === 'string' ? ev.t : '';

    if (ev.ev === 'run.start') {
      if (typeof ev.req === 'string') run.req = ev.req;
      if (typeof ev.tool === 'string') run.tool = ev.tool;
      if (typeof ev.depth === 'string') run.depth = ev.depth;
      if (t) run.startedAt = t;
      continue;
    }

    if (ev.ev === 'run.end') {
      if (t) run.endedAt = t;
      if (ev.status === 'done' || ev.status === 'failed') {
        run.endStatus = ev.status;
      }
      continue;
    }

    if (ev.ev === 'node' && typeof ev.id === 'string' && NODE_ID_RE.test(ev.id)) {
      let node = nodeMap.get(ev.id);
      if (!node) {
        node = {
          id: ev.id,
          from: cleanFrom(ev.from),
          stage: typeof ev.stage === 'string' ? ev.stage : '',
          status: typeof ev.status === 'string' ? ev.status : 'running',
          startedAt: t,
          endedAt: null,
        };
        nodeMap.set(ev.id, node);
      } else {
        if (node.from.length === 0) {
          node.from = cleanFrom(ev.from);
        }
        if (typeof ev.stage === 'string') node.stage = ev.stage;
        if (typeof ev.status === 'string') node.status = ev.status;
        if (!node.startedAt && t) node.startedAt = t;
      }

      if (typeof ev.role === 'string') node.role = ev.role;
      if (typeof ev.sum === 'string') node.sum = ev.sum;
      if (typeof ev.out === 'string') node.out = ev.out;
      if (typeof ev.via === 'string') node.via = ev.via;
      if (typeof ev.fallback === 'boolean') node.fallback = ev.fallback;
      if (Array.isArray(ev.files)) {
        node.files = ev.files.filter((f) => typeof f === 'string');
      }

      if (node.status === 'done' || node.status === 'failed' || node.status === 'skipped') {
        if (t) node.endedAt = t;
      } else if (node.status === 'running') {
        node.endedAt = null;
      }
    }
  }

  if (!run.startedAt && events.length > 0 && typeof events[0]?.t === 'string') {
    run.startedAt = events[0].t;
  }

  run.nodes = Array.from(nodeMap.values());
  return run;
}

export function validateRun(events, opts = {}) {
  const errors = [];
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, errors: ['events must be a non-empty array'] };
  }

  if (opts?.runId !== undefined && (typeof opts.runId !== 'string' || !RUN_ID_RE.test(opts.runId))) {
    errors.push(`invalid opts.runId: ${show(opts.runId)}`);
  }

  const declaredNodes = new Set();
  const nodeParents = new Map();
  let seenStart = false;
  let seenEnd = false;

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
      errors.push(`event[${i}]: not an object`);
      continue;
    }

    if (typeof ev.t !== 'string' || !ISO_TS_RE.test(ev.t) || Number.isNaN(Date.parse(ev.t))) {
      errors.push(`event[${i}]: invalid ISO timestamp t`);
    }

    if (ev.ev === 'run.start') {
      if (i !== 0 || seenStart) {
        errors.push(`event[${i}]: run.start must appear only at index 0`);
      }
      seenStart = true;
      if (ev.v !== 1) {
        errors.push(`event[${i}]: run.start requires v === 1`);
      }
      if (typeof ev.run !== 'string' || !RUN_ID_RE.test(ev.run)) {
        errors.push(`event[${i}]: invalid run id ${show(ev.run)}`);
      } else if (opts?.runId !== undefined && ev.run !== opts.runId) {
        errors.push(`event[${i}]: run ${show(ev.run)} does not match folder runId ${show(opts.runId)}`);
      }
      if (typeof ev.req !== 'string' || ev.req.trim().length === 0 || ev.req.length > 2000) {
        errors.push(`event[${i}]: req must be a non-empty string <= 2000 chars`);
      }
      if (typeof ev.tool !== 'string' || ev.tool.trim().length === 0) {
        errors.push(`event[${i}]: tool must be a non-empty string`);
      }
      if (!DEPTHS.includes(ev.depth)) {
        errors.push(`event[${i}]: depth ${show(ev.depth)} must be one of ${DEPTHS.join(', ')}`);
      }
    } else if (ev.ev === 'node') {
      if (!seenStart) {
        errors.push(`event[${i}]: node event before run.start`);
      }
      if (ev.v !== undefined) {
        errors.push(`event[${i}]: only run.start may contain v`);
      }
      if (typeof ev.id !== 'string' || !NODE_ID_RE.test(ev.id)) {
        errors.push(`event[${i}]: invalid node id ${show(ev.id)}`);
        continue;
      }
      if (ev.id === 'main') {
        errors.push(`event[${i}]: node id "main" is reserved for the virtual root`);
        continue;
      }
      if (!NODE_STATUSES.includes(ev.status)) {
        errors.push(`event[${i}]: invalid node status ${show(ev.status)}`);
      }

      const isFirst = !declaredNodes.has(ev.id);
      if (isFirst) {
        declaredNodes.add(ev.id);
        if (!Array.isArray(ev.from) || ev.from.length === 0) {
          errors.push(`event[${i}]: first event for node "${ev.id}" must have non-empty from[]`);
        }
        if (!STAGES.includes(ev.stage)) {
          errors.push(`event[${i}]: first event for node "${ev.id}" must have valid stage`);
        }
      }

      if (ev.stage !== undefined && !STAGES.includes(ev.stage)) {
        errors.push(`event[${i}]: invalid stage ${show(ev.stage)}`);
      }

      if (ev.from !== undefined) {
        if (!Array.isArray(ev.from) || ev.from.length === 0 || ev.from.length > MAX_FROM || !ev.from.every(isNodeRef)) {
          errors.push(`event[${i}]: from must be 1..${MAX_FROM} node ids or "main"`);
        } else {
          for (const parent of ev.from) {
            if (parent === ev.id) {
              errors.push(`event[${i}]: node "${ev.id}" references itself in from`);
            }
          }
          if (!nodeParents.has(ev.id)) {
            nodeParents.set(ev.id, ev.from.slice());
          }
        }
      }

      if (ev.via !== undefined && !VIAS.includes(ev.via)) {
        errors.push(`event[${i}]: invalid via ${show(ev.via)}`);
      }
      if (ev.fallback !== undefined && typeof ev.fallback !== 'boolean') {
        errors.push(`event[${i}]: fallback must be boolean`);
      }
      if (ev.files !== undefined) {
        if (!Array.isArray(ev.files) || !ev.files.every((f) => typeof f === 'string' && f.length > 0)) {
          errors.push(`event[${i}]: files must be string[]`);
        }
      }
      if (ev.sum !== undefined) {
        if (typeof ev.sum !== 'string' || ev.sum.length > 2000) {
          errors.push(`event[${i}]: sum must be string <= 2000 chars`);
        }
      }
      if (ev.out !== undefined && (typeof ev.out !== 'string' || ev.out.length === 0)) {
        errors.push(`event[${i}]: out must be non-empty string`);
      }
      if (ev.role !== undefined && typeof ev.role !== 'string') {
        errors.push(`event[${i}]: role must be string`);
      }
    } else if (ev.ev === 'run.end') {
      if (!seenStart) {
        errors.push(`event[${i}]: run.end before run.start`);
      }
      if (seenEnd) {
        errors.push(`event[${i}]: duplicate run.end`);
      }
      seenEnd = true;
      if (ev.v !== undefined) {
        errors.push(`event[${i}]: only run.start may contain v`);
      }
      if (!END_STATUSES.includes(ev.status)) {
        errors.push(`event[${i}]: invalid run.end status ${show(ev.status)}`);
      }
    } else {
      errors.push(`event[${i}]: unknown ev ${show(ev.ev)}`);
    }
  }

  for (const [nodeId, parents] of nodeParents.entries()) {
    for (const parent of parents) {
      if (parent !== 'main' && !declaredNodes.has(parent)) {
        errors.push(`node "${nodeId}" references undeclared parent "${parent}" in from`);
      }
    }
  }

  const state = new Map();
  function hasCycle(nodeId) {
    const st = state.get(nodeId);
    if (st === 1) return true;
    if (st === 2) return false;
    state.set(nodeId, 1);
    const parents = nodeParents.get(nodeId) || [];
    for (const p of parents) {
      if (p === 'main' || !declaredNodes.has(p)) continue;
      if (hasCycle(p)) return true;
    }
    state.set(nodeId, 2);
    return false;
  }

  for (const nodeId of declaredNodes) {
    if (hasCycle(nodeId)) {
      errors.push(`cycle detected in from graph involving "${nodeId}"`);
      break;
    }
  }

  return { ok: errors.length === 0, errors };
}

export function runStatus(run, nowMs = Date.now()) {
  if (!run || typeof run !== 'object') return 'failed';
  if (run.endStatus === 'done') return 'done';
  if (run.endStatus === 'failed') return 'failed';

  let lastMs = Number.NaN;
  if (typeof run.startedAt === 'string' && run.startedAt) {
    const t = Date.parse(run.startedAt);
    if (!Number.isNaN(t)) lastMs = t;
  }

  if (Array.isArray(run.nodes)) {
    for (const node of run.nodes) {
      for (const stamp of [node?.startedAt, node?.endedAt]) {
        if (typeof stamp === 'string' && stamp) {
          const t = Date.parse(stamp);
          if (!Number.isNaN(t) && (Number.isNaN(lastMs) || t > lastMs)) {
            lastMs = t;
          }
        }
      }
    }
  }

  if (!Number.isNaN(lastMs) && nowMs - lastMs >= STALL_MS) {
    return 'stalled';
  }
  return 'running';
}
