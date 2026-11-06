import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  AGENT_SAFE_TOOLS,
  AGENT_DENIED_TOOLS,
  buildAgentArgs,
  parseAgentLine,
  denialToRule,
  describeDenial,
  summarizeTool,
  isResumeFailure,
  AgentDenial
} from "@aso/provider-adapters";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

describe("claude-agent pure utilities", () => {
  describe("constants", () => {
    it("defines the exact AGENT_SAFE_TOOLS and AGENT_DENIED_TOOLS", () => {
      expect(AGENT_SAFE_TOOLS).toEqual([
        "Read",
        "Glob",
        "Grep",
        "Bash(git status:*)",
        "Bash(git diff:*)",
        "Bash(git log:*)",
        "Bash(ls:*)"
      ]);
      expect(AGENT_DENIED_TOOLS).toEqual([
        "Read(.env*)",
        "Read(**/.env*)",
        "Read(**/*.pem)",
        "Read(**/id_rsa*)"
      ]);
    });
  });

  describe("buildAgentArgs", () => {
    it("builds default agent CLI arguments without setting-sources", () => {
      const args = buildAgentArgs({
        prompt: "hello agent",
        cwd: "C:\\work"
      });

      expect(args.slice(0, 7)).toEqual([
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        "default"
      ]);

      expect(args).not.toContain("--setting-sources");

      const allowedIdx = args.indexOf("--allowedTools");
      expect(allowedIdx).toBeGreaterThan(-1);
      expect(args.slice(allowedIdx + 1, allowedIdx + 1 + AGENT_SAFE_TOOLS.length)).toEqual(AGENT_SAFE_TOOLS);

      const disallowedIdx = args.indexOf("--disallowedTools");
      expect(disallowedIdx).toBeGreaterThan(-1);
      expect(args.slice(disallowedIdx + 1, disallowedIdx + 1 + AGENT_DENIED_TOOLS.length)).toEqual(AGENT_DENIED_TOOLS);

      expect(args.slice(-2)).toEqual(["--", "hello agent"]);
    });

    it("includes extraAllowed in --allowedTools when provided", () => {
      const args = buildAgentArgs({
        prompt: "do something",
        cwd: "C:\\work",
        extraAllowed: ["Edit(//c/work/b.txt)", "Bash(npm test)"]
      });

      const allowedIdx = args.indexOf("--allowedTools");
      const disallowedIdx = args.indexOf("--disallowedTools");
      const allowedSlice = args.slice(allowedIdx + 1, disallowedIdx);
      expect(allowedSlice).toEqual([...AGENT_SAFE_TOOLS, "Edit(//c/work/b.txt)", "Bash(npm test)"]);
    });

    it("handles model, effort, resumeSessionId and keeps flag-like prompt intact", () => {
      const complexPrompt = "--version\n\"x\" & $(whoami)";
      const args = buildAgentArgs({
        prompt: complexPrompt,
        cwd: "C:\\work",
        model: "sonnet",
        effort: "low",
        resumeSessionId: "sess-999-aaa"
      });

      const modelIdx = args.indexOf("--model");
      expect(modelIdx).toBeGreaterThan(-1);
      expect(args[modelIdx + 1]).toBe("sonnet");

      const effortIdx = args.indexOf("--effort");
      expect(effortIdx).toBeGreaterThan(-1);
      expect(args[effortIdx + 1]).toBe("low");

      const resumeIdx = args.indexOf("--resume");
      expect(resumeIdx).toBeGreaterThan(-1);
      expect(args[resumeIdx + 1]).toBe("sess-999-aaa");

      expect(args.slice(-2)).toEqual(["--", complexPrompt]);
    });
  });

  describe("parseAgentLine", () => {
    it("returns [] for empty or invalid json lines", () => {
      expect(parseAgentLine("")).toEqual([]);
      expect(parseAgentLine("   ")).toEqual([]);
      expect(parseAgentLine("not json string")).toEqual([]);
      expect(parseAgentLine("{not: valid json}")).toEqual([]);
    });

    it("ignores input_json_delta deltas", () => {
      const line = JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"file":' }
        }
      });
      expect(parseAgentLine(line)).toEqual([]);
    });

    it("parses the claude-agent-read fixture correctly", () => {
      const fixturePath = path.join(FIXTURES_DIR, "claude-agent-read.jsonl");
      const lines = fs.readFileSync(fixturePath, "utf8").split(/\r?\n/).filter(Boolean);

      const allEvents = lines.flatMap((l) => parseAgentLine(l));

      const initEv = allEvents.find((e) => e.kind === "init");
      expect(initEv).toEqual({ kind: "init", sessionId: "sess-read-001" });

      const textEvents = allEvents.filter((e) => e.kind === "text");
      expect(textEvents.length).toBe(2);
      expect((textEvents[0] as any).delta).toBe("파일 내용을 ");
      expect((textEvents[1] as any).delta).toBe("확인했습니다.");

      const toolEv = allEvents.find((e) => e.kind === "tool");
      expect(toolEv).toEqual({
        kind: "tool",
        id: "toolu_01",
        name: "Read",
        input: { file_path: "C:\\work\\a.txt" }
      });

      const toolDoneEv = allEvents.find((e) => e.kind === "tool_done");
      expect(toolDoneEv).toEqual({
        kind: "tool_done",
        id: "toolu_01"
      });

      const resultEv = allEvents.find((e) => e.kind === "result");
      expect(resultEv).toMatchObject({
        kind: "result",
        sessionId: "sess-read-001",
        isError: false,
        denials: [],
        inputTokens: 15,
        outputTokens: 25,
        cachedInputTokens: 8,
        costUsd: 0.002,
        durationMs: 1500
      });
      expect((resultEv as any).text).toContain("파일 내용을 확인했습니다");
    });

    it("parses the claude-agent-denied fixture correctly", () => {
      const fixturePath = path.join(FIXTURES_DIR, "claude-agent-denied.jsonl");
      const lines = fs.readFileSync(fixturePath, "utf8").split(/\r?\n/).filter(Boolean);

      const allEvents = lines.flatMap((l) => parseAgentLine(l));
      const resultEv = allEvents.find((e) => e.kind === "result") as any;

      expect(resultEv).toBeDefined();
      expect(resultEv.denials.length).toBe(1);
      expect(resultEv.denials[0]).toEqual({
        toolName: "Write",
        toolUseId: "toolu_02",
        toolInput: { file_path: "C:\\work\\b.txt", content: "안녕" }
      });
    });
  });

  describe("denialToRule", () => {
    it("converts Bash commands to Bash(<command>)", () => {
      expect(denialToRule({ toolName: "Bash", toolUseId: "t1", toolInput: { command: "npm test" } })).toBe("Bash(npm test)");
      expect(denialToRule({ toolName: "Bash", toolUseId: "t1", toolInput: { command: "git status" } })).toBe("Bash(git status)");
      expect(denialToRule({ toolName: "Bash", toolUseId: "t1", toolInput: {} })).toBeNull();
      expect(denialToRule({ toolName: "Bash", toolUseId: "t1", toolInput: { command: "" } })).toBeNull();
    });

    it("converts file editing tools to Edit(//drive/path) format with lowercase drive and forward slashes", () => {
      expect(
        denialToRule({ toolName: "Write", toolUseId: "t1", toolInput: { file_path: "C:\\Users\\a\\b.txt" } })
      ).toBe("Edit(//c/Users/a/b.txt)");

      expect(
        denialToRule({ toolName: "Edit", toolUseId: "t2", toolInput: { file_path: "d:/work/src/index.ts" } })
      ).toBe("Edit(//d/work/src/index.ts)");

      expect(
        denialToRule({ toolName: "MultiEdit", toolUseId: "t3", toolInput: { file_path: "C:\\a\\b.js" } })
      ).toBe("Edit(//c/a/b.js)");

      expect(
        denialToRule({ toolName: "NotebookEdit", toolUseId: "t4", toolInput: { notebook_path: "E:\\data\\study.ipynb" } })
      ).toBe("Edit(//e/data/study.ipynb)");

      expect(denialToRule({ toolName: "Write", toolUseId: "t5", toolInput: {} })).toBeNull();
    });

    it("returns null for non-automatable tools", () => {
      expect(denialToRule({ toolName: "UnknownTool", toolUseId: "t1", toolInput: { foo: "bar" } })).toBeNull();
    });
  });

  describe("describeDenial", () => {
    it("flags dangerous operations appropriately", () => {
      const dangerBash1 = describeDenial({
        toolName: "Bash",
        toolUseId: "t1",
        toolInput: { command: "rm -rf build" }
      });
      expect(dangerBash1.danger).toBe(true);
      expect(dangerBash1.rule).toBe("Bash(rm -rf build)");

      const dangerBash2 = describeDenial({
        toolName: "Bash",
        toolUseId: "t2",
        toolInput: { command: "git push origin main" }
      });
      expect(dangerBash2.danger).toBe(true);

      const dangerBash3 = describeDenial({
        toolName: "Bash",
        toolUseId: "t3",
        toolInput: { command: "npm install lodash" }
      });
      expect(dangerBash3.danger).toBe(true);

      const safeBash = describeDenial({
        toolName: "Bash",
        toolUseId: "t4",
        toolInput: { command: "npm test" }
      });
      expect(safeBash.danger).toBe(false);

      const fileWrite = describeDenial({
        toolName: "Write",
        toolUseId: "t5",
        toolInput: { file_path: "C:\\work\\b.txt", content: "data" }
      });
      expect(fileWrite.danger).toBe(false);
      expect(fileWrite.rule).toBe("Edit(//c/work/b.txt)");
      expect(fileWrite.summary.length).toBeLessThanOrEqual(160);
    });
  });

  describe("summarizeTool", () => {
    it("summarizes tools under 160 characters without leaking file contents", () => {
      const writeSum = summarizeTool("Write", { file_path: "C:\\work\\test.ts", content: "secret passwords" });
      expect(writeSum).toContain("C:\\work\\test.ts");
      expect(writeSum).not.toContain("secret passwords");
      expect(writeSum.length).toBeLessThanOrEqual(160);

      const bashSum = summarizeTool("Bash", { command: "npm run test:all" });
      expect(bashSum).toContain("npm run test:all");
      expect(bashSum.length).toBeLessThanOrEqual(160);
    });
  });

  describe("isResumeFailure", () => {
    it("identifies no conversation found errors", () => {
      expect(isResumeFailure("No conversation found with session ID: 12345")).toBe(true);
      expect(isResumeFailure("Error: No conversation found")).toBe(true);
      expect(isResumeFailure("no conversation found")).toBe(true);
      expect(isResumeFailure("Process exited with code 1")).toBe(false);
      expect(isResumeFailure("Command failed: claude")).toBe(false);
    });
  });
});
