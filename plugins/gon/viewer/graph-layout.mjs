export function layoutRuns(runs, opts = {}) {
  const colW = typeof opts?.colW === 'number' && opts.colW > 0 ? opts.colW : 180;
  const rowH = typeof opts?.rowH === 'number' && opts.rowH > 0 ? opts.rowH : 72;
  const laneGap = typeof opts?.laneGap === 'number' && opts.laneGap >= 0 ? opts.laneGap : 48;

  const mainNode = {
    key: 'main',
    runId: '',
    id: 'main',
    x: 0,
    y: 0,
    dim: false,
    node: null,
  };

  if (!Array.isArray(runs) || runs.length === 0) {
    return {
      nodes: [mainNode],
      edges: [],
      width: colW,
      height: rowH,
    };
  }

  const sortedRuns = runs
    .filter((r) => r && typeof r === 'object' && Array.isArray(r.nodes) && r.nodes.length > 0)
    .slice()
    .sort((a, b) => {
      const idA = String(a.id ?? '');
      const idB = String(b.id ?? '');
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    });

  if (sortedRuns.length === 0) {
    return {
      nodes: [mainNode],
      edges: [],
      width: colW,
      height: rowH,
    };
  }

  const allNodes = [mainNode];
  const allEdges = [];
  let currentTopY = 0;
  let maxX = 0;

  for (let rIdx = 0; rIdx < sortedRuns.length; rIdx += 1) {
    const run = sortedRuns[rIdx];
    const runId = String(run.id ?? '');
    const dim = run.endStatus === 'done' || run.endStatus === 'failed';

    const nodeMap = new Map();
    for (const n of run.nodes) {
      if (n && typeof n.id === 'string' && n.id) {
        nodeMap.set(n.id, n);
      }
    }

    const colMemo = new Map();
    const visiting = new Set();

    function getCol(nodeId) {
      if (colMemo.has(nodeId)) return colMemo.get(nodeId);
      if (visiting.has(nodeId)) return 0;
      visiting.add(nodeId);

      const n = nodeMap.get(nodeId);
      const parents = Array.isArray(n?.from) && n.from.length > 0 ? n.from : ['main'];
      let maxParentCol = 0;
      for (const p of parents) {
        if (p === 'main' || p === nodeId || !nodeMap.has(p)) {
          if (maxParentCol < 0) maxParentCol = 0;
        } else {
          const pCol = getCol(p);
          if (pCol > maxParentCol) maxParentCol = pCol;
        }
      }

      visiting.delete(nodeId);
      const col = maxParentCol + 1;
      colMemo.set(nodeId, col);
      return col;
    }

    let maxCol = 1;
    const cols = new Map();
    for (const [nodeId, n] of nodeMap.entries()) {
      const c = getCol(nodeId);
      if (c > maxCol) maxCol = c;
      if (!cols.has(c)) cols.set(c, []);
      cols.get(c).push(n);
    }

    let maxRowsInLane = 1;
    for (const list of cols.values()) {
      if (list.length > maxRowsInLane) maxRowsInLane = list.length;
    }

    const laneHeight = (maxRowsInLane - 1) * rowH;
    const nodeYMap = new Map();

    for (let c = 1; c <= maxCol; c += 1) {
      const list = cols.get(c);
      if (!list || list.length === 0) continue;

      list.sort((a, b) => {
        const avgParentY = (node) => {
          const parents = Array.isArray(node.from) ? node.from : [];
          let sum = 0;
          let count = 0;
          for (const p of parents) {
            if (nodeYMap.has(p)) {
              sum += nodeYMap.get(p);
              count += 1;
            }
          }
          return count > 0 ? sum / count : currentTopY + laneHeight / 2;
        };
        const ya = avgParentY(a);
        const yb = avgParentY(b);
        if (ya !== yb) return ya - yb;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      const colSpan = (list.length - 1) * rowH;
      const startY = currentTopY + (laneHeight - colSpan) / 2;
      const x = c * colW;
      if (x > maxX) maxX = x;

      for (let i = 0; i < list.length; i += 1) {
        const n = list[i];
        const y = startY + i * rowH;
        nodeYMap.set(n.id, y);
        allNodes.push({
          key: `${runId}/${n.id}`,
          runId,
          id: n.id,
          x,
          y,
          dim,
          node: n,
        });
      }
    }

    for (const n of nodeMap.values()) {
      const toKey = `${runId}/${n.id}`;
      const rawParents = Array.isArray(n.from) && n.from.length > 0 ? n.from : ['main'];
      const seenFrom = new Set();
      for (const p of rawParents) {
        const fromKey = p !== 'main' && p !== n.id && nodeMap.has(p) ? `${runId}/${p}` : 'main';
        if (seenFrom.has(fromKey)) continue;
        seenFrom.add(fromKey);
        allEdges.push({ from: fromKey, to: toKey, dim });
      }
    }

    currentTopY += laneHeight + rowH + laneGap;
  }

  const nonMainYs = allNodes.slice(1).map((n) => n.y);
  const minY = Math.min(...nonMainYs);
  const maxY = Math.max(...nonMainYs);
  mainNode.y = Math.round((minY + maxY) / 2);

  return {
    nodes: allNodes,
    edges: allEdges,
    width: maxX + colW,
    height: maxY + rowH,
  };
}
