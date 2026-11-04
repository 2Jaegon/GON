import crypto from "node:crypto";
import { SignedJobContract } from "@aso/contracts";

export function generateNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function computeContractSignature(
  contractPayload: Omit<SignedJobContract, "signature">,
  secretKey: string
): string {
  const serialized = [
    contractPayload.jobId,
    contractPayload.runId,
    contractPayload.taskId,
    contractPayload.workspaceId,
    contractPayload.targetDir,
    contractPayload.command,
    (contractPayload.args || []).join(" "),
    contractPayload.timeoutMs,
    contractPayload.issuedAt,
    contractPayload.expiresAt
  ].join("|");

  return crypto.createHmac("sha256", secretKey).update(serialized).digest("hex");
}

export function signJobContract(
  contractPayload: Omit<SignedJobContract, "signature">,
  secretKey: string
): SignedJobContract {
  const signature = computeContractSignature(contractPayload, secretKey);
  return {
    ...contractPayload,
    signature
  };
}

export function verifyJobContract(
  contract: SignedJobContract,
  secretKey: string
): { valid: boolean; reason?: string } {
  const now = new Date().getTime();
  const expiresAt = new Date(contract.expiresAt).getTime();

  if (now > expiresAt) {
    return { valid: false, reason: "Contract has expired" };
  }

  const expectedSignature = computeContractSignature(contract, secretKey);
  const sigBuffer = Buffer.from(contract.signature);
  const expBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return { valid: false, reason: "Signature mismatch: tampered contract" };
  }

  return { valid: true };
}

