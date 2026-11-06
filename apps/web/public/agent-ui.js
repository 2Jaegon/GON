export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function agentToolRowHtml(ev) {
  const id = escapeHtml(ev.id || "");
  const name = escapeHtml(ev.name || "");
  const summary = escapeHtml(ev.summary || "");

  return `
    <div class="agent-tool-row" id="agent-tool-${id}" data-tool-id="${id}">
      <div class="agent-tool-indicator">
        <span class="agent-tool-spinner"></span>
        <span class="agent-tool-check hidden">✓</span>
      </div>
      <div class="agent-tool-info">
        <span class="agent-tool-name">${name}</span>
        <span class="agent-tool-summary">${summary}</span>
      </div>
    </div>
  `.trim();
}

export function agentApprovalCardHtml(runId, ev) {
  const safeRunId = escapeHtml(runId);
  const items = Array.isArray(ev?.items) ? ev.items : [];

  const itemsHtml = items
    .map((item) => {
      const tool = escapeHtml(item.tool || "");
      const summary = escapeHtml(item.summary || "");
      const isDanger = Boolean(item.danger);
      const isRuleNull = item.rule == null;

      const dangerBadge = isDanger
        ? `<div class="agent-item-danger-badge"><span class="agent-badge-icon">⚠️</span> 되돌리기 어려운 작업이에요</div>`
        : "";
      const unapprovableBadge = isRuleNull
        ? `<div class="agent-item-warning-badge">자동 승인할 수 없어요</div>`
        : "";

      return `
        <div class="agent-approval-item ${isDanger ? "danger" : ""}">
          <div class="agent-item-header">
            <span class="agent-item-tool">${tool}</span>
            ${dangerBadge}
            ${unapprovableBadge}
          </div>
          <div class="agent-item-summary">${summary}</div>
        </div>
      `.trim();
    })
    .join("\n");

  return `
    <div class="agent-approval-card" id="agent-approval-${safeRunId}">
      <div class="agent-approval-header">
        <span class="agent-approval-title">도구 실행 승인이 필요해요</span>
      </div>
      <div class="agent-approval-items">
        ${itemsHtml}
      </div>
      <div class="agent-approval-actions">
        <button type="button" class="btn btn-secondary agent-btn-deny" onclick="resolveAgentApproval('${safeRunId}', 'deny')">거절</button>
        <button type="button" class="btn btn-primary agent-btn-allow" onclick="resolveAgentApproval('${safeRunId}', 'allow')">이번만 허용</button>
      </div>
    </div>
  `.trim();
}

if (typeof window !== "undefined") {
  window.agentToolRowHtml = agentToolRowHtml;
  window.agentApprovalCardHtml = agentApprovalCardHtml;
}

