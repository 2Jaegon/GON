import { describe, it, expect } from "vitest";
import { agyResultError, agyTimeoutMessage, cliFailureMessage } from "@aso/provider-adapters";

describe("cliFailureMessage", () => {
  const cmdLine = "Command failed: C:\\x\\claude.exe -p --model sonnet -- 비밀 프롬프트";

  it("says a killed process timed out and never echoes the command line or prompt", () => {
    const msg = cliFailureMessage({ message: cmdLine, killed: true, signal: "SIGTERM", stderr: "" }, 30000);
    expect(msg).toBe("30초 안에 끝나지 않아 중단했어요(시간 초과).");
  });

  it("uses the last stderr line (after any banner) for other failures, without the command line", () => {
    const msg = cliFailureMessage({ message: cmdLine, code: 1, stderr: "OpenAI Codex v0.144.6\n--------\nError: not logged in\n" }, 30000);
    expect(msg).toBe("Error: not logged in");
  });

  it("does not call an output-size overflow a timeout", () => {
    const msg = cliFailureMessage({ message: cmdLine, killed: true, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stderr: "" }, 30000);
    expect(msg).toBe("출력이 너무 커서(10MB 초과) 중단했어요.");
  });

  it("falls back to the exit code when stderr is empty", () => {
    expect(cliFailureMessage({ message: cmdLine, code: 2, stderr: "" }, 30000)).toBe("종료 코드 2로 끝났어요.");
  });
});

describe("agy stream-json result interpretation", () => {
  it("names the denied tool when agy ends with an empty answer because headless mode denied it", () => {
    const result = {
      status: "SUCCESS",
      response: "",
      denied_actions: [{ action: "read_file", display_name: "ReadFile" }]
    };
    expect(agyResultError(result)).toBe(
      "Gemini가 권한이 필요한 도구(read_file)를 쓰려다 막혀서 답을 만들지 못했어요. ~/.gemini/GEMINI.md 같은 전역 규칙이 파일 읽기를 시키는지 확인해 주세요."
    );
  });

  it("gives a generic hint when the denied tool is not a file read", () => {
    expect(agyResultError({ response: "", denied_actions: [{ action: "run_command" }] })).toBe(
      "Gemini가 권한이 필요한 도구(run_command)를 쓰려다 막혀서 답을 만들지 못했어요. 전역 규칙이나 지침이 이 도구를 쓰라고 시키는지 확인해 주세요."
    );
  });

  it("returns null for a normal answer, even when a tool was also denied", () => {
    expect(agyResultError({ response: "안녕하세요\n" })).toBeNull();
    expect(agyResultError({ response: "답", denied_actions: [{ action: "read_file" }] })).toBeNull();
  });

  it("returns null for an empty answer without denied tools so the caller reports it as empty", () => {
    expect(agyResultError({ response: "" })).toBeNull();
  });

  it("claims a live connection on timeout only when some answer had already arrived", () => {
    expect(agyTimeoutMessage(35000, false)).toBe("35초 안에 답이 오지 않았어요(시간 초과). 시작이 늦거나 연결이 안 됐을 수 있어요.");
    expect(agyTimeoutMessage(35000, true)).toBe("35초 안에 답이 끝나지 않았어요(시간 초과). 답은 오고 있었지만 너무 길거나 느려요.");
  });
});
