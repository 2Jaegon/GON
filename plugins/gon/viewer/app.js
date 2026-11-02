import { layoutRuns } from './graph-layout.mjs';
import { renderMarkdown } from './md-safe.mjs';

const SAFE_OUT_RE = /^[\w가-힣 ._-]+\.md$/;
const SVG_NS = 'http://www.w3.org/2000/svg';
const TRUNCATE_LIMIT = 120;

const STAGE_LABELS = {
  grill: '그릴링 (질문)',
  plan: '기획',
  check: '점검 · 승인',
  compose: '작업 구성',
  execute: '전문가 실행',
  lead: '결과 종합',
};

const STATUS_LABELS = {
  running: '진행 중',
  done: '완료',
  failed: '실패',
  stalled: '멈춤?',
  skipped: '건너뜀',
  loading: '불러오는 중…',
};

export function createSource(opts = {}) {
  const token = typeof opts.token === 'string' ? opts.token : '';
  const fetchImpl = opts.fetchImpl || globalThis.fetch;

  function authHeaders() {
    return token ? { 'x-gon-token': token } : {};
  }

  async function requestJson(urlPath) {
    if (!token) {
      const err = new Error('접근 토큰이 없습니다.');
      err.status = 403;
      throw err;
    }
    const res = await fetchImpl(urlPath, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  return {
    async listRuns() {
      return requestJson('/api/runs');
    },
    async getRun(id) {
      return requestJson(`/api/runs/${encodeURIComponent(id)}`);
    },
    async getFile(id, filePath) {
      if (!token) {
        const err = new Error('접근 토큰이 없습니다.');
        err.status = 403;
        throw err;
      }
      const res = await fetchImpl(
        `/api/runs/${encodeURIComponent(id)}/file?path=${encodeURIComponent(filePath)}`,
        {
          method: 'GET',
          headers: authHeaders(),
        },
      );
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.text();
    },
    subscribe(cb) {
      if (!token || typeof fetchImpl !== 'function') {
        return () => {};
      }
      const controller = new AbortController();
      let active = true;

      (async () => {
        try {
          const res = await fetchImpl('/api/stream', {
            method: 'GET',
            headers: authHeaders(),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) return;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let currentEvent = '';

          while (active) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('event:')) {
                currentEvent = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                const rawData = line.slice(5).trim();
                if (currentEvent === 'change' && rawData) {
                  try {
                    const parsed = JSON.parse(rawData);
                    if (parsed && typeof parsed.runId === 'string') {
                      cb({ runId: parsed.runId });
                    }
                  } catch {
                    // ignore malformed event payload
                  }
                }
                currentEvent = '';
              } else if (line === '') {
                currentEvent = '';
              }
            }
          }
        } catch {
          // stream aborted or disconnected
        }
      })();

      return () => {
        active = false;
        controller.abort();
      };
    },
  };
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt) return '-';
  const s = Date.parse(startedAt);
  if (Number.isNaN(s)) return '-';
  const e = endedAt ? Date.parse(endedAt) : Date.now();
  if (Number.isNaN(e) || e < s) return '-';
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}분 ${rem}초`;
}

function initViewerApp() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const token = params.get('t') || '';
  if (params.has('t')) {
    params.delete('t');
    const cleanSearch = params.toString();
    const cleanUrl = window.location.pathname + (cleanSearch ? `?${cleanSearch}` : '');
    window.history.replaceState(null, '', cleanUrl);
  }

  const source = createSource({ token });

  const globalBadge = document.getElementById('global-status-badge');
  const runCounter = document.getElementById('run-counter');
  const refreshBtn = document.getElementById('refresh-btn');
  const stateBanner = document.getElementById('state-banner');
  const stateBannerTitle = document.getElementById('state-banner-title');
  const stateBannerDesc = document.getElementById('state-banner-desc');
  const stateRetryBtn = document.getElementById('state-retry-btn');
  const runStrip = document.getElementById('run-strip');
  const emptyState = document.getElementById('empty-state');
  const graphSvg = document.getElementById('graph-svg');

  const detailPlaceholder = document.getElementById('detail-placeholder');
  const detailContent = document.getElementById('detail-content');
  const detailTitle = document.getElementById('detail-title');
  const detailStatus = document.getElementById('detail-status');
  const detailRunReq = document.getElementById('detail-run-req');
  const detailReqToggle = document.getElementById('detail-req-toggle');
  const detailFlags = document.getElementById('detail-flags');
  const detailStage = document.getElementById('detail-stage');
  const detailRole = document.getElementById('detail-role');
  const detailDuration = document.getElementById('detail-duration');
  const detailFrom = document.getElementById('detail-from');
  const detailSum = document.getElementById('detail-sum');
  const detailSumToggle = document.getElementById('detail-sum-toggle');
  const detailFilesSection = document.getElementById('detail-files-section');
  const detailFiles = document.getElementById('detail-files');
  const detailOutName = document.getElementById('detail-out-name');
  const detailOutStatus = document.getElementById('detail-out-status');
  const detailOut = document.getElementById('detail-out');

  let loadedDetails = new Map();
  let currentLayout = null;
  let selectedKey = null;
  let reqExpanded = false;
  let sumExpanded = false;

  function setBadge(el, statusKey, customText) {
    const label = customText || STATUS_LABELS[statusKey] || statusKey;
    el.textContent = label;
    el.setAttribute('class', `badge badge-${statusKey}`);
  }

  function hideBanner() {
    stateBanner.setAttribute('class', 'state-banner is-hidden');
    stateRetryBtn.setAttribute('class', 'btn-primary is-hidden');
  }

  function showBanner(kind, title, desc, showRetry = false) {
    stateBanner.setAttribute('class', `state-banner is-${kind}`);
    stateBannerTitle.textContent = title;
    stateBannerDesc.textContent = desc;
    if (showRetry) {
      stateRetryBtn.setAttribute('class', 'btn-primary');
    } else {
      stateRetryBtn.setAttribute('class', 'btn-primary is-hidden');
    }
  }

  function applyTruncatedText(textEl, toggleEl, fullText, isExpanded, onToggle) {
    const str = String(fullText || '');
    if (str.length <= TRUNCATE_LIMIT) {
      textEl.textContent = str || '내용 없음';
      toggleEl.setAttribute('class', 'btn-link is-hidden');
      toggleEl.onclick = null;
      return;
    }
    textEl.textContent = isExpanded ? str : `${str.slice(0, TRUNCATE_LIMIT)}…`;
    toggleEl.textContent = isExpanded ? '접기' : '전체 보기';
    toggleEl.setAttribute('class', 'btn-link');
    toggleEl.onclick = onToggle;
  }

  async function selectNode(lnode) {
    if (!lnode || lnode.key === 'main' || !lnode.node) {
      selectedKey = 'main';
      detailPlaceholder.setAttribute('class', 'detail-placeholder');
      detailContent.setAttribute('class', 'detail-content is-hidden');
      updateSelectedAttr();
      return;
    }

    selectedKey = lnode.key;
    updateSelectedAttr();

    detailPlaceholder.setAttribute('class', 'detail-placeholder is-hidden');
    detailContent.setAttribute('class', 'detail-content');

    const detailObj = loadedDetails.get(lnode.runId);
    const run = detailObj?.run;
    const runOverallStatus = detailObj?.status || 'running';
    const node = lnode.node;

    const effectiveNodeStatus =
      node.status === 'running' && runOverallStatus === 'stalled' ? 'stalled' : node.status;

    detailTitle.textContent = node.role ? `${node.id} (${node.role})` : node.id;
    setBadge(detailStatus, effectiveNodeStatus);

    reqExpanded = false;
    const renderReq = () => {
      applyTruncatedText(detailRunReq, detailReqToggle, run?.req || '', reqExpanded, () => {
        reqExpanded = !reqExpanded;
        renderReq();
      });
    };
    renderReq();

    detailFlags.textContent = '';
    if (node.fallback) {
      const fbBadge = document.createElement('span');
      fbBadge.setAttribute('class', 'badge badge-partial');
      fbBadge.textContent = '대체 카드 사용 (fallback)';
      detailFlags.appendChild(fbBadge);
    }
    if (node.via === 'inline') {
      const viaBadge = document.createElement('span');
      viaBadge.setAttribute('class', 'badge badge-skipped');
      viaBadge.textContent = '단일 AI 순차 실행 (inline)';
      detailFlags.appendChild(viaBadge);
    }
    if (effectiveNodeStatus === 'stalled') {
      const stallBadge = document.createElement('span');
      stallBadge.setAttribute('class', 'badge badge-stalled');
      stallBadge.textContent = '10분 이상 응답 없음 (멈춤?)';
      detailFlags.appendChild(stallBadge);
    }

    detailStage.textContent = STAGE_LABELS[node.stage] || node.stage || '-';
    detailRole.textContent = [node.role, node.via].filter(Boolean).join(' · ') || '기본';
    detailDuration.textContent = formatDuration(node.startedAt, node.endedAt);
    detailFrom.textContent = Array.isArray(node.from) && node.from.length > 0 ? node.from.join(', ') : 'main';

    sumExpanded = false;
    const renderSum = () => {
      applyTruncatedText(detailSum, detailSumToggle, node.sum || '아직 기록된 요약이 없습니다.', sumExpanded, () => {
        sumExpanded = !sumExpanded;
        renderSum();
      });
    };
    renderSum();

    detailFiles.textContent = '';
    if (Array.isArray(node.files) && node.files.length > 0) {
      detailFilesSection.setAttribute('class', 'detail-section');
      for (const f of node.files) {
        const li = document.createElement('li');
        li.textContent = String(f);
        detailFiles.appendChild(li);
      }
    } else {
      detailFilesSection.setAttribute('class', 'detail-section is-hidden');
    }

    detailOut.innerHTML = '';
    if (!node.out) {
      detailOutName.textContent = '없음';
      detailOutStatus.textContent = '이 단계에는 별도 마크다운 산출물 파일이 없습니다.';
      return;
    }

    detailOutName.textContent = node.out;
    if (!SAFE_OUT_RE.test(node.out)) {
      detailOutStatus.textContent = '열 수 없음 (허용되지 않은 파일 경로 형식)';
      return;
    }

    detailOutStatus.textContent = '산출물 불러오는 중…';
    try {
      const mdText = await source.getFile(lnode.runId, node.out);
      if (selectedKey !== lnode.key) return;
      detailOutStatus.textContent = '';
      detailOut.innerHTML = renderMarkdown(mdText);
    } catch {
      if (selectedKey !== lnode.key) return;
      detailOutStatus.textContent = '열 수 없음 (파일이 아직 없거나 읽을 수 없습니다)';
    }
  }

  function updateSelectedAttr() {
    const groups = graphSvg.querySelectorAll('.node-group');
    for (const g of groups) {
      const key = g.getAttribute('data-key');
      const baseClass = g.getAttribute('data-base-class') || 'node-group';
      g.setAttribute('class', key === selectedKey ? `${baseClass} is-selected` : baseClass);
    }
  }

  function renderGraph(runs) {
    graphSvg.textContent = '';
    const padX = 70;
    const padY = 56;
    const layout = layoutRuns(runs, { colW: 165, rowH: 76, laneGap: 48 });
    currentLayout = layout;

    const svgW = Math.max(680, layout.width + padX * 2);
    const svgH = Math.max(320, layout.height + padY * 2);
    graphSvg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    graphSvg.setAttribute('width', String(svgW));
    graphSvg.setAttribute('height', String(svgH));

    const posByKey = new Map();
    for (const n of layout.nodes) {
      posByKey.set(n.key, { x: n.x + padX, y: n.y + padY });
    }

    for (const edge of layout.edges) {
      const p1 = posByKey.get(edge.from);
      const p2 = posByKey.get(edge.to);
      if (!p1 || !p2) continue;
      const midX = Math.round((p1.x + p2.x) / 2);
      const pathEl = document.createElementNS(SVG_NS, 'path');
      pathEl.setAttribute('d', `M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`);
      pathEl.setAttribute('class', edge.dim ? 'edge-line is-dim' : 'edge-line');
      graphSvg.appendChild(pathEl);
    }

    for (const lnode of layout.nodes) {
      const pos = posByKey.get(lnode.key);
      const g = document.createElementNS(SVG_NS, 'g');
      const runDetail = loadedDetails.get(lnode.runId);
      const isStalledNode =
        lnode.node?.status === 'running' && runDetail?.status === 'stalled';
      const statusClass =
        lnode.key === 'main'
          ? 'node-main'
          : isStalledNode
            ? 'node-stalled'
            : `node-${lnode.node?.status || 'running'}`;
      const baseClass = `node-group ${statusClass}${lnode.dim ? ' is-dim' : ''}`;

      g.setAttribute('class', lnode.key === selectedKey ? `${baseClass} is-selected` : baseClass);
      g.setAttribute('data-base-class', baseClass);
      g.setAttribute('data-key', lnode.key);
      g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');

      const labelText = lnode.key === 'main' ? '시작 (main)' : lnode.id;
      const subText =
        lnode.key === 'main'
          ? ''
          : STATUS_LABELS[isStalledNode ? 'stalled' : lnode.node?.status] || '';
      g.setAttribute('aria-label', `${labelText} ${subText}`.trim());

      const ring = document.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('r', '22');
      ring.setAttribute('class', 'node-ring');
      g.appendChild(ring);

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', lnode.key === 'main' ? '14' : '16');
      circle.setAttribute('class', 'node-circle');
      g.appendChild(circle);

      const textEl = document.createElementNS(SVG_NS, 'text');
      textEl.setAttribute('y', '32');
      textEl.setAttribute('text-anchor', 'middle');
      textEl.setAttribute('class', 'node-label');
      textEl.textContent = labelText;
      g.appendChild(textEl);

      if (subText) {
        const subEl = document.createElementNS(SVG_NS, 'text');
        subEl.setAttribute('y', '47');
        subEl.setAttribute('text-anchor', 'middle');
        subEl.setAttribute('class', 'node-sublabel');
        subEl.textContent = subText;
        g.appendChild(subEl);
      }

      g.addEventListener('click', () => selectNode(lnode));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          selectNode(lnode);
        }
      });

      graphSvg.appendChild(g);
    }
  }

  function renderRunStrip(summaries) {
    runStrip.textContent = '';
    for (const s of summaries) {
      const chip = document.createElement('div');
      chip.setAttribute('class', 'run-chip');

      const badge = document.createElement('span');
      setBadge(badge, s.status);
      chip.appendChild(badge);

      const reqSpan = document.createElement('span');
      reqSpan.setAttribute('class', 'run-chip-req');
      reqSpan.textContent = s.req || s.id;
      chip.appendChild(reqSpan);

      runStrip.appendChild(chip);
    }
  }

  async function refreshAll() {
    if (!token) {
      setBadge(globalBadge, 'failed', '권한 없음');
      showBanner(
        'permission',
        '접근 토큰이 없거나 만료되었습니다',
        '터미널에 출력된 Open: http://127.0.0.1:<port>/?t=<token> 주소로 다시 접속하세요.',
        false,
      );
      emptyState.setAttribute('class', 'empty-state is-hidden');
      graphSvg.textContent = '';
      return;
    }

    try {
      const summaries = await source.listRuns();
      runCounter.textContent = `요청 ${summaries.length}건`;
      renderRunStrip(summaries);

      if (summaries.length === 0) {
        hideBanner();
        setBadge(globalBadge, 'skipped', '기록 없음');
        emptyState.setAttribute('class', 'empty-state');
        graphSvg.textContent = '';
        return;
      }

      emptyState.setAttribute('class', 'empty-state is-hidden');

      const details = await Promise.all(summaries.map((s) => source.getRun(s.id)));
      loadedDetails = new Map();
      let totalSkipped = 0;
      let anyStalled = false;
      let anyRunning = false;
      let anyFailed = false;

      const runs = [];
      for (const d of details) {
        loadedDetails.set(d.run.id, d);
        runs.push(d.run);
        totalSkipped += d.skipped || 0;
        if (d.status === 'stalled') anyStalled = true;
        if (d.status === 'running') anyRunning = true;
        if (d.status === 'failed') anyFailed = true;
      }

      if (totalSkipped > 0 || anyStalled) {
        setBadge(globalBadge, 'stalled', anyStalled ? '멈춤?' : '일부 누락');
        const msg = [
          totalSkipped > 0 ? `손상된 기록 줄 ${totalSkipped}개를 건너뛰고 나머지를 표시합니다.` : '',
          anyStalled ? '10분 이상 새로운 진행 기록이 없는 작업이 있습니다.' : '',
        ]
          .filter(Boolean)
          .join(' ');
        showBanner('partial', '일부 기록 확인 필요', msg, false);
      } else {
        hideBanner();
        if (anyRunning) setBadge(globalBadge, 'running');
        else if (anyFailed) setBadge(globalBadge, 'failed');
        else setBadge(globalBadge, 'done');
      }

      renderGraph(runs);

      if (selectedKey && currentLayout) {
        const found = currentLayout.nodes.find((n) => n.key === selectedKey);
        if (found) {
          await selectNode(found);
          return;
        }
      }

      const firstRealNode = currentLayout?.nodes.find((n) => n.key !== 'main');
      if (firstRealNode) {
        await selectNode(firstRealNode);
      }
    } catch (err) {
      if (err && err.status === 403) {
        setBadge(globalBadge, 'failed', '권한 없음');
        showBanner(
          'permission',
          '접근 권한이 거부되었습니다 (403)',
          '서버가 재시작되었거나 토큰이 일치하지 않습니다. 터미널의 최신 Open: 주소로 다시 여세요.',
          false,
        );
      } else {
        setBadge(globalBadge, 'failed', '연결 오류');
        showBanner(
          'error',
          '서버에서 기록을 불러오지 못했습니다',
          '로컬 뷰어 서버가 실행 중인지 확인한 뒤 "다시 시도"를 누르세요.',
          true,
        );
      }
    }
  }

  refreshBtn.addEventListener('click', () => refreshAll());
  stateRetryBtn.addEventListener('click', () => refreshAll());

  refreshAll().finally(() => {
    setTimeout(() => {
      source.subscribe(() => {
        refreshAll();
      });
    }, 50);
  });
}

initViewerApp();
