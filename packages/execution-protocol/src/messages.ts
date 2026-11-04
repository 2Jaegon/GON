import { SignedJobContract, RunnerTaskResult } from "@aso/contracts";

export type RunnerMessageType =
  | "CHALLENGE"
  | "AUTH_REQUEST"
  | "AUTH_SUCCESS"
  | "AUTH_FAILURE"
  | "HEARTBEAT"
  | "JOB_DISPATCH"
  | "JOB_ACK"
  | "JOB_PROGRESS"
  | "JOB_RESULT"
  | "JOB_CANCEL";

export interface RunnerMessage<T = any> {
  type: RunnerMessageType;
  deviceId?: string;
  timestamp: string;
  payload: T;
}

export interface ChallengePayload {
  nonce: string;
  expiresAt: string;
}

export interface AuthRequestPayload {
  deviceId: string;
  nonce: string;
  signature: string;
}

export interface HeartbeatPayload {
  deviceId: string;
  status: "idle" | "busy" | "error";
  activeJobId?: string;
  uptimeSeconds: number;
}

export interface JobDispatchPayload {
  contract: SignedJobContract;
}

export interface JobProgressPayload {
  jobId: string;
  runId: string;
  taskId: string;
  chunk: string;
  stream: "stdout" | "stderr";
}

export interface JobResultPayload {
  result: RunnerTaskResult;
}

