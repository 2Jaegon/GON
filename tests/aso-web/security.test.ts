import { describe, it, expect } from "vitest";
import path from "node:path";
import { redactSecrets, redactObject } from "@aso/security";
import { isPathInside, isWindowsReservedName, assertSafePath } from "@aso/security";
import { assessCommandRisk, computeCommandDigest } from "@aso/security";

describe("Security & Redaction", () => {
  it("redacts sensitive AI API keys and authorization headers", () => {
    const raw = "Connecting with sk-ant-api03-abcdef123456789012345678 and Bearer eyJhbGciOiJIUzI1NiJ9.abc";
    const redacted = redactSecrets(raw);
    expect(redacted).not.toContain("sk-ant-api03");
    expect(redacted).not.toContain("eyJhbGci");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts sensitive keys in nested JSON objects", () => {
    const input = {
      username: "developer",
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456",
      meta: { password: "supersecretpassword123" }
    };
    const cleaned = redactObject(input);
    expect(cleaned.apiKey).toBe("[REDACTED]");
    expect(cleaned.meta.password).toBe("[REDACTED]");
    expect(cleaned.username).toBe("developer");
  });

  it("detects and prevents path traversal out of allowed directory", () => {
    const parent = path.resolve("./workspace");
    const safeChild = path.resolve("./workspace/src/file.ts");
    const outsideEscaped = path.resolve("./workspace/../../etc/passwd");

    expect(isPathInside(parent, safeChild)).toBe(true);
    expect(isPathInside(parent, outsideEscaped)).toBe(false);
    expect(() => assertSafePath(parent, outsideEscaped)).toThrow(/Security Violation/);
  });

  it("rejects Windows reserved device names", () => {
    expect(isWindowsReservedName("CON")).toBe(true);
    expect(isWindowsReservedName("prn.txt")).toBe(true);
    expect(isWindowsReservedName("aux")).toBe(true);
    expect(isWindowsReservedName("nul.json")).toBe(true);
    expect(isWindowsReservedName("com1")).toBe(true);
    expect(isWindowsReservedName("normal_file.ts")).toBe(false);

    const parent = path.resolve("./workspace");
    const reservedPath = path.join(parent, "CON");
    expect(isPathInside(parent, reservedPath)).toBe(false);
  });

  it("evaluates command risks and disallows catastrophic commands", () => {
    expect(assessCommandRisk("npm test").risk).toBe("safe");
    expect(assessCommandRisk("rm -rf /").risk).toBe("forbidden");
    expect(assessCommandRisk("format c:").risk).toBe("forbidden");
    expect(assessCommandRisk("rm -rf node_modules").risk).toBe("destructive");
  });

  it("computes deterministic command digests", () => {
    const d1 = computeCommandDigest("npm", ["test"]);
    const d2 = computeCommandDigest("npm", ["test"]);
    const d3 = computeCommandDigest("npm", ["run", "build"]);
    expect(d1).toBe(d2);
    expect(d1).not.toBe(d3);
  });
});

