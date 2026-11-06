export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderSafeMarkdown(rawText, context = {}) {
  if (!rawText) return "";

  const codeBlocks = [];
  const textWithPlaceholders = String(rawText).replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length;
    const safeLang = escapeHtml(lang || "code");
    const safeCode = escapeHtml(code.replace(/\n$/, ""));
    codeBlocks.push(`
      <div class="md-code-block" style="margin:10px 0;border:1px solid rgb(var(--c-line));border-radius:8px;overflow:hidden;background:rgb(var(--c-sunken));">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid rgb(var(--c-line));font-size:12px;color:rgb(var(--c-ink-sub));">
          <span>${safeLang}</span>
          <button type="button" class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;" onclick="copyCodeBlock(this)">복사</button>
        </div>
        <pre style="margin:0;padding:12px;overflow-x:auto;font-family:var(--font-mono, monospace);font-size:13px;line-height:1.5;"><code>${safeCode}</code></pre>
      </div>
    `);
    return `@@CODE_BLOCK_${idx}@@`;
  });

  // Extract and safely transform images: ![alt](url)
  // Only permit .gon-images/<name> when workspaceId and runId context are available
  const imagePlaceholders = [];
  const textWithImages = textWithPlaceholders.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (fullMatch, alt, url) => {
    const cleanUrl = url.trim().replace(/^\.\//, "");
    if (!cleanUrl.startsWith(".gon-images/")) {
      return fullMatch;
    }

    const fileName = cleanUrl.slice(".gon-images/".length);
    if (!/^[\w.-]+\.(png|jpe?g|webp)$/i.test(fileName) || fileName.includes("..")) {
      return fullMatch;
    }

    const ws = context.workspaceId || (typeof window !== "undefined" && window.currentWorkspaceId) || "";
    const run = context.runId || "";

    if (!ws || !run) {
      return fullMatch;
    }

    const safeAlt = escapeHtml(alt);
    const safeSrc = `/api/v1/workspaces/${encodeURIComponent(ws)}/runs/${encodeURIComponent(run)}/images/${encodeURIComponent(fileName)}`;
    const imgHtml = `<div class="agent-image-card"><img src="${safeSrc}" alt="${safeAlt}" class="agent-generated-img" loading="lazy" /></div>`;

    const idx = imagePlaceholders.length;
    imagePlaceholders.push(imgHtml);
    return `@@IMAGE_PLACEHOLDER_${idx}@@`;
  });

  let html = escapeHtml(textWithImages);
  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code style="padding:2px 5px;border-radius:4px;background:rgb(var(--c-sunken));font-family:var(--font-mono, monospace);font-size:0.9em;">$1</code>');
  // Bold
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Headings
  html = html.replace(/^### (.+)$/gm, '<strong style="display:block;font-size:1.05em;margin:10px 0 4px;">$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong style="display:block;font-size:1.12em;margin:12px 0 6px;">$1</strong>');
  // Bullet items
  html = html.replace(/^[•\-*] (.+)$/gm, '<div style="margin-left:10px;">• $1</div>');
  // Line breaks
  html = html.replace(/\n/g, "<br>");

  // Re-insert safe image tags
  imagePlaceholders.forEach((imgHtml, idx) => {
    html = html.replace(`@@IMAGE_PLACEHOLDER_${idx}@@`, imgHtml);
  });

  // Re-insert safe code blocks
  codeBlocks.forEach((blockHtml, idx) => {
    html = html.replace(`@@CODE_BLOCK_${idx}@@`, blockHtml);
  });

  return html;
}

if (typeof window !== "undefined") {
  window.renderSafeMarkdown = renderSafeMarkdown;
}

