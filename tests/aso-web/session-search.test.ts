import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without types
import { filterSessions, highlightMatch } from "../../apps/web/public/session-search.js";

const s = [
  { id: "a", title: "로그인 화면", runs: [{ rawRequest: "로그인 화면 만들어줘" }] },
  { id: "b", title: "모델 선택", runs: [{ rawRequest: "Opus로 바꿔줘" }] },
];

describe("session search", () => {
  it("matches title", () => expect(filterSessions(s, "로그인").map((x: { id: string }) => x.id)).toEqual(["a"]));
  it("matches message body, case-insensitive", () =>
    expect(filterSessions(s, "opus").map((x: { id: string }) => x.id)).toEqual(["b"]));
  it("empty query returns all", () => expect(filterSessions(s, "  ")).toHaveLength(2));
  it("no match returns empty", () => expect(filterSessions(s, "없는말")).toEqual([]));
  it("highlight escapes html", () =>
    expect(highlightMatch("<b>Opus</b>", "opus")).toBe("&lt;b&gt;<mark>Opus</mark>&lt;/b&gt;"));
  it("regex special chars are literal", () => expect(highlightMatch("a.b (c)", "(c)")).toBe("a.b <mark>(c)</mark>"));
});
