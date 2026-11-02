export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CTRL_AND_BIDI_RE = /[\u0000-\u0020\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const UNSAFE_URL_CHAR_RE = /[\u0000-\u0020\u007F"'<>\\]/;
const TOKEN_INLINE_RE = /`([^`\r\n]{1,1000})`|(!?)\[([^\[\]\r\n]{1,500})\]\(([^\[\r\n]{1,2000})\)/g;

function renderSafeLink(label, rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('//') || UNSAFE_URL_CHAR_RE.test(rawUrl)) {
    return escapeHtml(label);
  }
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx <= 0) {
    return escapeHtml(label);
  }
  const schemePart = trimmed.slice(0, colonIdx);
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(schemePart)) {
    return escapeHtml(label);
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return escapeHtml(label);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return escapeHtml(label);
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    return escapeHtml(label);
  }
  const safeHref = escapeHtml(parsed.href);
  const safeHost = escapeHtml(parsed.host.replace(CTRL_AND_BIDI_RE, ''));
  const safeLabel = escapeHtml(label);
  return `<a href="${safeHref}" rel="noopener noreferrer" target="_blank">${safeLabel}</a> (${safeHost})`;
}

function formatTextSegment(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([^*\r\n]{1,500})\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\r\n]{1,500})\*/g, '<em>$1</em>');
  return out;
}

function renderInline(line) {
  if (!line) return '';
  if (!line.includes('`') && (!line.includes('](') || !line.includes(')'))) {
    return formatTextSegment(line);
  }
  let result = '';
  let lastIndex = 0;
  TOKEN_INLINE_RE.lastIndex = 0;
  let match;

  while ((match = TOKEN_INLINE_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      result += formatTextSegment(line.slice(lastIndex, match.index));
    }
    const [full, codeContent, bang, linkLabel, linkUrl] = match;
    if (codeContent !== undefined) {
      result += `<code>${escapeHtml(codeContent)}</code>`;
    } else if (bang === '!') {
      result += escapeHtml(full);
    } else {
      result += renderSafeLink(linkLabel, linkUrl);
    }
    lastIndex = TOKEN_INLINE_RE.lastIndex;
  }

  if (lastIndex < line.length) {
    result += formatTextSegment(line.slice(lastIndex));
  }
  return result;
}

export function renderMarkdown(src, opts = {}) {
  try {
    if (opts && opts._forceThrow) {
      throw new Error('Forced throw for test');
    }
    if (typeof src !== 'string') {
      return `<pre>${escapeHtml(src)}</pre>`;
    }
    if (src.length === 0) return '';

    const lines = src.split(/\r?\n/);
    const blocks = [];
    let inFence = false;
    let fenceLines = [];
    let listType = null;
    let listItems = [];
    let quoteLines = [];
    let paraLines = [];

    function flushPara() {
      if (paraLines.length > 0) {
        blocks.push(`<p>${paraLines.map(renderInline).join('<br>')}</p>`);
        paraLines = [];
      }
    }

    function flushQuote() {
      if (quoteLines.length > 0) {
        blocks.push(`<blockquote>${quoteLines.map(renderInline).join('<br>')}</blockquote>`);
        quoteLines = [];
      }
    }

    function flushList() {
      if (listItems.length > 0 && listType) {
        blocks.push(`<${listType}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${listType}>`);
        listItems = [];
        listType = null;
      }
    }

    function flushAll() {
      flushPara();
      flushQuote();
      flushList();
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (inFence) {
        if (/^\s*```\s*$/.test(line)) {
          blocks.push(`<pre><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
          fenceLines = [];
          inFence = false;
        } else {
          fenceLines.push(line);
        }
        continue;
      }

      if (/^\s*```/.test(line)) {
        flushAll();
        inFence = true;
        fenceLines = [];
        continue;
      }

      if (/^\s*$/.test(line)) {
        flushAll();
        continue;
      }

      const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
      if (headingMatch) {
        flushAll();
        const level = headingMatch[1].length;
        blocks.push(`<h${level}>${renderInline(headingMatch[2].trim())}</h${level}>`);
        continue;
      }

      const quoteMatch = /^>\s?(.*)$/.exec(line);
      if (quoteMatch) {
        flushPara();
        flushList();
        quoteLines.push(quoteMatch[1]);
        continue;
      }

      const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line);
      if (ulMatch) {
        flushPara();
        flushQuote();
        if (listType && listType !== 'ul') flushList();
        listType = 'ul';
        listItems.push(ulMatch[1]);
        continue;
      }

      const olMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (olMatch) {
        flushPara();
        flushQuote();
        if (listType && listType !== 'ol') flushList();
        listType = 'ol';
        listItems.push(olMatch[1]);
        continue;
      }

      flushQuote();
      flushList();
      paraLines.push(line);
    }

    if (inFence) {
      blocks.push(`<pre><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
    }
    flushAll();

    return blocks.join('\n');
  } catch {
    return `<pre>${escapeHtml(src)}</pre>`;
  }
}
