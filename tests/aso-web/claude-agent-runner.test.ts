import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it, expect, vi } from "vitest";
import { runClaudeAgent, AgentEvent, AgentResult } from "@aso/provider-adapters";

function createMockChild() {
  const child: any = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = {
    end: vi.fn()
  };
  child.kill = vi.fn(() => {
    child.killed = true;
    child.emit("close", null, "SIGTERM");
  });
  return child;
}

describe("runClaudeAgent runner", () => {
  it("streams events and resolves to the AgentResult on success", async () => {
    const mockChild = createMockChild();
    const spawnSpy = vi.fn(() => mockChild);
    const resolveSpy = vi.fn(async () => ({ cmd: "claude.exe", prefixArgs: [] }));

    const receivedEvents: AgentEvent[] = [];
    const controller = new AbortController();

    const promise = runClaudeAgent(
      {
        prompt: "hello agent",
        cwd: "C:\\work",
        model: "sonnet"
      },
      (ev) => receivedEvents.push(ev),
      controller.signal,
      { spawn: spawnSpy as any, resolve: resolveSpy }
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const spawnArgs = spawnSpy.mock.calls[0];
    expect(spawnArgs[0]).toBe("claude.exe");
    expect(spawnArgs[2]).toMatchObject({
      cwd: "C:\\work",
      shell: false,
      windowsHide: true
    });
    expect(mockChild.stdin.end).toHaveBeenCalled();

    // Stream lines
    mockChild.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }) + "\n");
    mockChild.stdout.write(
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "안녕" } }
      }) + "\n"
    );
    mockChild.stdout.write(
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "s1",
        result: "안녕하세요!",
        is_error: false,
        usage: { input_tokens: 5, output_tokens: 10 }
      }) + "\n"
    );
    mockChild.emit("close", 0);

    const result = await promise;
    expect(result).toMatchObject({
      sessionId: "s1",
      text: "안녕하세요!",
      isError: false,
      inputTokens: 5,
      outputTokens: 10
    });

    expect(receivedEvents.map((e) => e.kind)).toEqual(["init", "text", "result"]);
  });

  it("kills process and rejects on idle timeout when no events arrive", async () => {
    const mockChild = createMockChild();
    const spawnSpy = vi.fn(() => mockChild);
    const resolveSpy = vi.fn(async () => ({ cmd: "claude.exe", prefixArgs: [] }));

    const controller = new AbortController();
    const promise = runClaudeAgent(
      {
        prompt: "slow prompt",
        cwd: "C:\\work",
        idleTimeoutMs: 30
      },
      () => {},
      controller.signal,
      { spawn: spawnSpy as any, resolve: resolveSpy }
    );

    await expect(promise).rejects.toThrow("응답이 없어 중단했어요(무응답 시간 초과).");
    expect(mockChild.kill).toHaveBeenCalled();
  });

  it("suspends idle timeout while a tool execution is active", async () => {
    const mockChild = createMockChild();
    const spawnSpy = vi.fn(() => mockChild);
    const resolveSpy = vi.fn(async () => ({ cmd: "claude.exe", prefixArgs: [] }));

    const controller = new AbortController();
    const promise = runClaudeAgent(
      {
        prompt: "tool prompt",
        cwd: "C:\\work",
        idleTimeoutMs: 50
      },
      () => {},
      controller.signal,
      { spawn: spawnSpy as any, resolve: resolveSpy }
    );

    // Tool starts
    mockChild.stdout.write(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.txt" } }] }
      }) + "\n"
    );

    // Wait longer than idleTimeoutMs (60ms > 50ms)
    await new Promise((r) => setTimeout(r, 65));

    // Tool finishes
    mockChild.stdout.write(
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "data" }] }
      }) + "\n"
    );

    // Finish successfully
    mockChild.stdout.write(
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "s1",
        result: "done",
        is_error: false
      }) + "\n"
    );
    mockChild.emit("close", 0);

    const result = await promise;
    expect(result.text).toBe("done");
  });

  it("kills process and rejects when signal is aborted", async () => {
    const mockChild = createMockChild();
    const spawnSpy = vi.fn(() => mockChild);
    const resolveSpy = vi.fn(async () => ({ cmd: "claude.exe", prefixArgs: [] }));

    const controller = new AbortController();
    const promise = runClaudeAgent(
      {
        prompt: "abort me",
        cwd: "C:\\work"
      },
      () => {},
      controller.signal,
      { spawn: spawnSpy as any, resolve: resolveSpy }
    );

    setTimeout(() => {
      controller.abort();
    }, 10);

    await expect(promise).rejects.toThrow("중단했어요.");
    expect(mockChild.kill).toHaveBeenCalled();
  });

  it("rejects with stderr message when process exits with code 1 without a result", async () => {
    const mockChild = createMockChild();
    const spawnSpy = vi.fn(() => mockChild);
    const resolveSpy = vi.fn(async () => ({ cmd: "claude.exe", prefixArgs: [] }));

    const controller = new AbortController();
    const promise = runClaudeAgent(
      {
        prompt: "err prompt",
        cwd: "C:\\work"
      },
      () => {},
      controller.signal,
      { spawn: spawnSpy as any, resolve: resolveSpy }
    );

    await new Promise((r) => setTimeout(r, 10));

    mockChild.stderr.write("Error: not logged in\n");
    mockChild.emit("close", 1);

    await expect(promise).rejects.toThrow("Error: not logged in");
  });
});
