import {
  User,
  Workspace,
  WorkspaceMember,
  Project,
  CreateProjectDTO,
  ProviderConnectionView,
  RunnerDevice,
  RunnerPairingCode,
  Run,
  RunStatus,
  RunRequirements,
  RunPlan,
  RunTask,
  TaskState,
  RunEvent,
  ApprovalRequest,
  ApprovalState,
  UsageRecord,
  ArtifactRecord
} from "@aso/contracts";

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(user: Omit<User, "id" | "createdAt">): Promise<User>;
}

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  listForUser(userId: string): Promise<Workspace[]>;
  create(workspace: Omit<Workspace, "id" | "createdAt">): Promise<Workspace>;
  addMember(member: WorkspaceMember): Promise<void>;
  getMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
}

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  listForWorkspace(workspaceId: string): Promise<Project[]>;
  create(workspaceId: string, createdBy: string, dto: CreateProjectDTO & { id?: string }): Promise<Project>;
  delete(id: string): Promise<boolean>;
}

export interface IProviderRepository {
  listForWorkspace(workspaceId: string): Promise<ProviderConnectionView[]>;
  findById(id: string): Promise<ProviderConnectionView | null>;
  create(view: ProviderConnectionView): Promise<ProviderConnectionView>;
  updateStatus(id: string, status: ProviderConnectionView["status"]): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export interface IRunnerRepository {
  listForWorkspace(workspaceId: string): Promise<RunnerDevice[]>;
  findById(id: string): Promise<RunnerDevice | null>;
  createPairingCode(workspaceId: string, initiatedBy: string): Promise<RunnerPairingCode>;
  findPairingCode(code: string): Promise<RunnerPairingCode | null>;
  redeemPairingCode(code: string, deviceName: string, publicKey: string): Promise<RunnerDevice>;
  updateStatus(id: string, status: RunnerDevice["status"]): Promise<boolean>;
  addAllowedPath(id: string, dirPath: string, setAsActive?: boolean): Promise<RunnerDevice | null>;
  removeAllowedPath(id: string, dirPath: string): Promise<RunnerDevice | null>;
  setActivePath(id: string, dirPath: string): Promise<RunnerDevice | null>;
  delete(id: string): Promise<boolean>;
}

export interface IRunRepository {
  findById(id: string): Promise<Run | null>;
  listForProject(projectId: string): Promise<Run[]>;
  create(run: Omit<Run, "id" | "createdAt">): Promise<Run>;
  updateStatus(id: string, status: RunStatus, details?: { startedAt?: string; completedAt?: string; cancelledAt?: string }): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  deleteSession(projectId: string, sessionId: string): Promise<number>;
  clearForProject(projectId: string): Promise<number>;
}

export interface IRequirementsRepository {
  findByRunId(runId: string): Promise<RunRequirements | null>;
  upsert(runId: string, spec: RunRequirements): Promise<RunRequirements>;
}

export interface IPlanRepository {
  findLatestByRunId(runId: string): Promise<RunPlan | null>;
  create(plan: Omit<RunPlan, "id" | "createdAt">): Promise<RunPlan>;
  updateStatus(planId: string, status: "draft" | "approved" | "rejected"): Promise<boolean>;
}

export interface ITaskRepository {
  listByRunId(runId: string): Promise<RunTask[]>;
  createMany(tasks: Omit<RunTask, "id">[]): Promise<RunTask[]>;
  updateState(taskId: string, state: TaskState): Promise<boolean>;
  updateResult(taskId: string, result: any, state?: TaskState): Promise<boolean>;
}

export interface IEventRepository {
  appendEvent(workspaceId: string, runId: string, eventType: string, payload: Record<string, any>): Promise<RunEvent>;
  listAfterSequence(runId: string, afterSequence: number): Promise<RunEvent[]>;
  listForRun(runId: string): Promise<RunEvent[]>;
}

export interface IApprovalRepository {
  create(approval: Omit<ApprovalRequest, "id" | "createdAt">): Promise<ApprovalRequest>;
  findById(id: string): Promise<ApprovalRequest | null>;
  listForRun(runId: string): Promise<ApprovalRequest[]>;
  decide(id: string, decidedBy: string, state: "approved" | "rejected"): Promise<boolean>;
}

export interface IArtifactRepository {
  create(artifact: Omit<ArtifactRecord, "id" | "createdAt">): Promise<ArtifactRecord>;
  listForRun(runId: string): Promise<ArtifactRecord[]>;
}

export interface IUsageRepository {
  record(usage: Omit<UsageRecord, "id" | "recordedAt">): Promise<UsageRecord>;
  listForRun(runId: string): Promise<UsageRecord[]>;
  aggregateForRun(runId: string): Promise<{
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    totalDurationMs: number;
    totalCostUsd: number | null;
  }>;
}

export interface IIdempotencyRepository {
  get(workspaceId: string, key: string): Promise<{ status: number; body: any } | null>;
  set(workspaceId: string, key: string, status: number, body: any, ttlSeconds?: number): Promise<void>;
}

export interface IDatabase {
  users: IUserRepository;
  workspaces: IWorkspaceRepository;
  projects: IProjectRepository;
  providers: IProviderRepository;
  runners: IRunnerRepository;
  runs: IRunRepository;
  requirements: IRequirementsRepository;
  plans: IPlanRepository;
  tasks: ITaskRepository;
  events: IEventRepository;
  approvals: IApprovalRepository;
  artifacts: IArtifactRepository;
  usage: IUsageRepository;
  idempotency: IIdempotencyRepository;
}

