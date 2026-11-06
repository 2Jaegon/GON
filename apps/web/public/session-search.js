// Sidebar "최근 항목" search helpers. ES module; also exposed on window for app.js (classic script).
function escapeHtmlText(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function filterSessions(sessions, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => {
    const haystack = [s.title, ...(s.runs || []).map((r) => r.rawRequest)];
    return haystack.some((t) => typeof t === "string" && t.toLowerCase().includes(q));
  });
}

export function highlightMatch(text, query) {
  const q = String(query || "").trim();
  const source = String(text ?? "");
  if (!q) return escapeHtmlText(source);
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let out = "";
  let last = 0;
  for (const m of source.matchAll(re)) {
    out += escapeHtmlText(source.slice(last, m.index)) + "<mark>" + escapeHtmlText(m[0]) + "</mark>";
    last = m.index + m[0].length;
  }
  return out + escapeHtmlText(source.slice(last));
}

if (typeof window !== "undefined") {
  window.filterSessions = filterSessions;
  window.highlightMatch = highlightMatch;
}
