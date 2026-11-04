import { describe, it, expect } from "vitest";
import { signJobContract, verifyJobContract } from "@aso/execution-protocol";

describe("Execution Protocol & Contract Signing", () => {
  const secretKey = "super-secret-runner-key-at-least-32-bytes";

  const contractPayload = {
    jobId: "00000000-0000-7000-8000-000000000001",
    runId: "00000000-0000-7000-8000-000000000002",
    taskId: "00000000-0000-7000-8000-000000000003",
    workspaceId: "00000000-0000-7000-8000-000000000004",
    targetDir: "c:/projects/test",
    command: "npm",
    args: ["test"],
    env: {},
    timeoutMs: 30000,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };

  it("signs and validates a genuine job contract", () => {
    const signed = signJobContract(contractPayload, secretKey);
    expect(signed.signature).toBeDefined();

    const result = verifyJobContract(signed, secretKey);
    expect(result.valid).toBe(true);
  });

  it("rejects a tampered job contract", () => {
    const signed = signJobContract(contractPayload, secretKey);
    // Malicious attacker changes command to 'rm -rf'
    const tampered = { ...signed, command: "rm -rf" };

    const result = verifyJobContract(tampered, secretKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Signature mismatch");
  });

  it("rejects an expired contract", () => {
    const expiredPayload = {
      ...contractPayload,
      expiresAt: new Date(Date.now() - 5000).toISOString()
    };
    const signed = signJobContract(expiredPayload, secretKey);

    const result = verifyJobContract(signed, secretKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });
});

