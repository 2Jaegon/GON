import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without types
import { renderSafeMarkdown } from "../../apps/web/public/markdown-renderer.js";

describe("Web UI Safe Image Rendering (renderSafeMarkdown)", () => {
  const context = {
    workspaceId: "ws-test-123",
    runId: "run-test-456"
  };

  it("converts ![alt](.gon-images/<name>) to safe <img> pointing to the run image API", () => {
    const md = "Here is your picture:\n\n![A vintage camera selfie](.gon-images/20261106-120000-1.png)";
    const html = renderSafeMarkdown(md, context);

    expect(html).toContain('<img src="/api/v1/workspaces/ws-test-123/runs/run-test-456/images/20261106-120000-1.png"');
    expect(html).toContain('alt="A vintage camera selfie"');
    expect(html).toContain('class="agent-generated-img"');
  });

  it("handles relative path with leading ./ like ./.gon-images/pic.jpg", () => {
    const md = "![Snapshot](./.gon-images/20261106-120000-1.jpg)";
    const html = renderSafeMarkdown(md, context);

    expect(html).toContain('<img src="/api/v1/workspaces/ws-test-123/runs/run-test-456/images/20261106-120000-1.jpg"');
    expect(html).toContain('alt="Snapshot"');
  });

  it("escapes malicious alt text preventing XSS and attribute breakout", () => {
    const md = '!["><script>alert("xss")</script><img src="x](.gon-images/safe.png)';
    const html = renderSafeMarkdown(md, context);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("blocks external image URLs from rendering as <img> tags", () => {
    const md = "![External](https://evil.com/tracker.png) and ![HTTP](http://attacker.com/cookie.jpg)";
    const html = renderSafeMarkdown(md, context);

    expect(html).not.toContain('<img src="https://evil.com');
    expect(html).not.toContain('<img src="http://attacker.com');
  });

  it("blocks javascript: and data: URLs", () => {
    const md = "![XSS](javascript:alert(1)) and ![Data](data:image/png;base64,1234)";
    const html = renderSafeMarkdown(md, context);

    expect(html).not.toContain('<img src="javascript:');
    expect(html).not.toContain('<img src="data:');
  });

  it("blocks path traversal in .gon-images paths", () => {
    const md = "![Traversal](.gon-images/../secret.png) and ![Encoded](.gon-images/..%2fsecret.png)";
    const html = renderSafeMarkdown(md, context);

    expect(html).not.toContain('<img src="/api/v1/workspaces/ws-test-123/runs/run-test-456/images/../');
    expect(html).not.toContain('<img src="/api/v1/workspaces/ws-test-123/runs/run-test-456/images/..%2f');
  });

  it("blocks unsupported executable or script extensions", () => {
    const md = "![Executable](.gon-images/malware.exe) and ![SVG](.gon-images/vector.svg)";
    const html = renderSafeMarkdown(md, context);

    expect(html).not.toContain('<img src="/api/v1/workspaces/ws-test-123/runs/run-test-456/images/malware.exe"');
    expect(html).not.toContain('<img src="/api/v1/workspaces/ws-test-123/runs/run-test-456/images/vector.svg"');
  });

  it("preserves standard markdown formatting (code blocks, bold, headers, lists)", () => {
    const md = "## Title\n**bold** and `code`\n```js\nconsole.log(1);\n```";
    const html = renderSafeMarkdown(md, context);

    expect(html).toContain(">Title</strong>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code");
    expect(html).toContain("console.log(1);");
  });
});
