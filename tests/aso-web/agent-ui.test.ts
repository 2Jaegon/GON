import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without types
import { agentToolRowHtml, agentApprovalCardHtml, grillingBadgeHtml } from "../../apps/web/public/agent-ui.js";

describe("agent-ui HTML builders", () => {
  it("escapes html in tool row name and summary", () => {
    const html = agentToolRowHtml({
      id: "t1",
      name: "<script>alert('xss')</script>",
      summary: 'Bash: rm -rf "some/path" & echo <hello>'
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;some/path&quot;");
    expect(html).toContain("&lt;hello&gt;");
    expect(html).toContain("&amp;");
  });

  it("renders tool row with name and summary", () => {
    const html = agentToolRowHtml({
      id: "tool-123",
      name: "Read",
      summary: "Read: C:\\work\\a.txt"
    });

    expect(html).toContain("tool-123");
    expect(html).toContain("Read");
    expect(html).toContain("Read: C:\\work\\a.txt");
  });

  it("escapes html in approval card items", () => {
    const html = agentApprovalCardHtml("run-001", {
      requestId: "req-1",
      items: [
        {
          tool: "Bash",
          summary: '<script>alert("hack")</script>',
          danger: false,
          rule: "Bash(echo 1)"
        }
      ]
    });

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
    expect(html).toContain("&quot;hack&quot;");
  });

  it("applies danger styling and notice for dangerous items", () => {
    const html = agentApprovalCardHtml("run-002", {
      requestId: "req-2",
      items: [
        {
          tool: "Bash",
          summary: "Bash: git push origin main",
          danger: true,
          rule: "Bash(git push origin main)"
        },
        {
          tool: "Read",
          summary: "Read: safe.txt",
          danger: false,
          rule: null
        }
      ]
    });

    // Contains danger class and warning text
    expect(html).toContain("danger");
    expect(html).toContain("되돌리기 어려운 작업이에요");

    // For rule: null, indicates it cannot be auto-approved
    expect(html).toContain("자동 승인할 수 없어요");

    // Contains allow and deny buttons with specified text
    expect(html).toContain("resolveAgentApproval('run-002', 'allow')");
    expect(html).toContain("resolveAgentApproval('run-002', 'deny')");
    expect(html).toContain("이번만 허용");
    expect(html).toContain("거절");
  });

  describe("grillingBadgeHtml", () => {
    it("renders asking badge with proper wording and class", () => {
      const html = grillingBadgeHtml("asking");
      expect(html).toContain("Grilling · 요구사항 다듬는 중");
      expect(html).toContain("asking");
    });

    it("renders answered badge with proper wording and class", () => {
      const html = grillingBadgeHtml("answered");
      expect(html).toContain("Grilling 완료");
      expect(html).toContain("answered");
    });

    it("escapes unexpected state safely", () => {
      const html = grillingBadgeHtml('<script>alert("xss")</script>');
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });
});
