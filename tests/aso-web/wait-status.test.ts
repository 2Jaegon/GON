import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without types
import { waitingLabel, SLOW_AFTER_SEC } from "../../apps/web/public/wait-status.js";

describe("waitingLabel", () => {
  it("shows the elapsed seconds while the answer is still on time", () => {
    expect(waitingLabel("Claude", 0)).toBe("Claude가 답변을 쓰고 있어요 · 0초");
    expect(waitingLabel("Gemini", SLOW_AFTER_SEC - 1)).toBe(`Gemini가 답변을 쓰고 있어요 · ${SLOW_AFTER_SEC - 1}초`);
  });

  it("says plainly that it is slow, and that a timeout will be reported as an error", () => {
    expect(waitingLabel("Claude", SLOW_AFTER_SEC)).toBe(
      `Claude가 답변을 쓰고 있어요 · ${SLOW_AFTER_SEC}초 · 평소보다 오래 걸려요. 시간이 넘으면 오류로 알려드려요.`
    );
  });

  it("rounds down and never shows a negative time", () => {
    expect(waitingLabel("Claude", 3.9)).toBe("Claude가 답변을 쓰고 있어요 · 3초");
    expect(waitingLabel("Claude", -2)).toBe("Claude가 답변을 쓰고 있어요 · 0초");
  });
});
