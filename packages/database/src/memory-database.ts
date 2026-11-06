import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
  UsageRecord,
  ArtifactRecord
} from "@aso/contracts";
import {
  IDatabase,
  IUserRepository,
  IWorkspaceRepository,
  IProjectRepository,
  IProviderRepository,
  IRunnerRepository,
  IRunRepository,
  IRequirementsRepository,
  IPlanRepository,
  ITaskRepository,
  IEventRepository,
  IApprovalRepository,
  IArtifactRepository,
  IUsageRepository,
  IIdempotencyRepository
} from "./types.js";

export class MemoryDatabase implements IDatabase {
  private filePath: string | null = null;
  private usersMap = new Map<string, User>();
  private workspacesMap = new Map<string, Workspace>();
  private membersMap = new Map<string, WorkspaceMember[]>(); // workspaceId -> members
  private projectsMap = new Map<string, Project>();
  private providersMap = new Map<string, ProviderConnectionView>();
  private runnersMap = new Map<string, RunnerDevice>();
  private pairingsMap = new Map<string, RunnerPairingCode>();
  private runsMap = new Map<string, Run>();
  private requirementsMap = new Map<string, RunRequirements>();
  private plansMap = new Map<string, RunPlan[]>(); // runId -> plans
  private tasksMap = new Map<string, RunTask[]>(); // runId -> tasks
  private eventsMap = new Map<string, RunEvent[]>(); // runId -> events
  private approvalsMap = new Map<string, ApprovalRequest>();
  private artifactsMap = new Map<string, ArtifactRecord[]>(); // runId -> artifacts
  private usageMap = new Map<string, UsageRecord[]>(); // runId -> usages
  private idempotencyMap = new Map<string, { status: number; body: any; expiresAt: number }>();

  constructor(filePath?: string) {
    if (filePath && filePath !== ":memory:") {
      this.filePath = filePath;
      this.loadFromDisk();
    }
  }

  private loadFromDisk() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.users)) this.usersMap = new Map(data.users);
      if (Array.isArray(data.workspaces)) this.workspacesMap = new Map(data.workspaces);
      if (Array.isArray(data.members)) this.membersMap = new Map(data.members);
      if (Array.isArray(data.projects)) this.projectsMap = new Map(data.projects);
      if (Array.isArray(data.providers)) this.providersMap = new Map(data.providers);
      if (Array.isArray(data.runners)) this.runnersMap = new Map(data.runners);
      if (Array.isArray(data.pairings)) this.pairingsMap = new Map(data.pairings);
      if (Array.isArray(data.runs)) this.runsMap = new Map(data.runs);
      if (Array.isArray(data.requirements)) this.requirementsMap = new Map(data.requirements);
      if (Array.isArray(data.plans)) this.plansMap = new Map(data.plans);
      if (Array.isArray(data.tasks)) this.tasksMap = new Map(data.tasks);
      if (Array.isArray(data.events)) this.eventsMap = new Map(data.events);
      if (Array.isArray(data.approvals)) this.approvalsMap = new Map(data.approvals);
      if (Array.isArray(data.artifacts)) this.artifactsMap = new Map(data.artifacts);
      if (Array.isArray(data.usage)) this.usageMap = new Map(data.usage);
    } catch {
      // ignore corrupt file
    }
  }

  private saveToDisk() {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        users: Array.from(this.usersMap.entries()),
        workspaces: Array.from(this.workspacesMap.entries()),
        members: Array.from(this.membersMap.entries()),
        projects: Array.from(this.projectsMap.entries()),
        providers: Array.from(this.providersMap.entries()),
        runners: Array.from(this.runnersMap.entries()),
        pairings: Array.from(this.pairingsMap.entries()),
        runs: Array.from(this.runsMap.entries()),
        requirements: Array.from(this.requirementsMap.entries()),
        plans: Array.from(this.plansMap.entries()),
        tasks: Array.from(this.tasksMap.entries()),
        events: Array.from(this.eventsMap.entries()),
        approvals: Array.from(this.approvalsMap.entries()),
        artifacts: Array.from(this.artifactsMap.entries()),
        usage: Array.from(this.usageMap.entries())
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // ignore file write errors
    }
  }

  public users: IUserRepository = {
    findById: async (id) => this.usersMap.get(id) || null,
    findByEmail: async (email) => {
      for (const u of this.usersMap.values()) {
        if (u.email.toLowerCase() === email.toLowerCase()) return u;
      }
      return null;
    },
    create: async (data: any) => {
      const user: User = {
        id: data.id || crypto.randomUUID(),
        email: data.email,
        displayName: data.displayName || null,
        createdAt: new Date().toISOString()
      };
      this.usersMap.set(user.id, user);
      this.saveToDisk();
      return user;
    }
  };

  public workspaces: IWorkspaceRepository = {
    findById: async (id) => this.workspacesMap.get(id) || null,
    listForUser: async (userId) => {
      const result: Workspace[] = [];
      for (const [wsId, members] of this.membersMap.entries()) {
        if (members.some((m) => m.userId === userId) || userId === "dev-user") {
          const ws = this.workspacesMap.get(wsId);
          if (ws) result.push(ws);
        }
      }
      return result;
    },
    create: async (data: any) => {
      const ws: Workspace = {
        id: data.id || crypto.randomUUID(),
        name: data.name,
        ownerId: data.ownerId,
        plan: data.plan || "free",
        retentionDays: data.retentionDays || 30,
        createdAt: new Date().toISOString()
      };
      this.workspacesMap.set(ws.id, ws);
      const member: WorkspaceMember = {
        workspaceId: ws.id,
        userId: data.ownerId,
        role: "owner",
        status: "active"
      };
      this.membersMap.set(ws.id, [member]);
      this.saveToDisk();
      return ws;
    },
    addMember: async (member) => {
      const list = this.membersMap.get(member.workspaceId) || [];
      const filtered = list.filter((m) => m.userId !== member.userId);
      filtered.push(member);
      this.membersMap.set(member.workspaceId, filtered);
      this.saveToDisk();
    },
    getMember: async (workspaceId, userId) => {
      const list = this.membersMap.get(workspaceId) || [];
      return list.find((m) => m.userId === userId) || null;
    }
  };

  public projects: IProjectRepository = {
    findById: async (id) => this.projectsMap.get(id) || null,
    listForWorkspace: async (workspaceId) => {
      return Array.from(this.projectsMap.values()).filter(
        (p) => p.workspaceId === workspaceId && !p.deletedAt
      );
    },
    create: async (workspaceId, createdBy, dto: any) => {
      const project: Project = {
        id: dto.id || crypto.randomUUID(),
        workspaceId,
        name: dto.name,
        description: dto.description || null,
        sourceType: dto.source.type,
        repositoryRef: dto.source.repositoryFullName || dto.source.localPath || null,
        defaultRuntime: dto.defaultRuntime || "local",
        defaultProvider: dto.defaultProvider || "auto",
        executionPolicy: {
          allowNetwork: dto.executionPolicy?.allowNetwork ?? false,
          allowGitPush: dto.executionPolicy?.allowGitPush ?? false,
          allowDeployment: dto.executionPolicy?.allowDeployment ?? false,
          requireApprovalForDestructiveActions: dto.executionPolicy?.requireApprovalForDestructiveActions ?? true
        },
        createdBy,
        createdAt: new Date().toISOString()
      };
      this.projectsMap.set(project.id, project);
      this.saveToDisk();
      return project;
    },
    delete: async (id) => {
      const p = this.projectsMap.get(id);
      if (!p) return false;
      p.deletedAt = new Date().toISOString();
      this.saveToDisk();
      return true;
    }
  };

  public providers: IProviderRepository = {
    listForWorkspace: async (workspaceId) => {
      // In-memory returns all registered provider connections
      return Array.from(this.providersMap.values());
    },
    findById: async (id) => this.providersMap.get(id) || null,
    create: async (view) => {
      this.providersMap.set(view.id, view);
      this.saveToDisk();
      return view;
    },
    updateStatus: async (id, status) => {
      const p = this.providersMap.get(id);
      if (!p) return false;
      p.status = status;
      this.saveToDisk();
      return true;
    },
    updateMetadata: async (id, metadata) => {
      const p = this.providersMap.get(id);
      if (!p) return false;
      p.metadata = { ...p.metadata, ...metadata };
      this.saveToDisk();
      return true;
    },
    delete: async (id) => {
      const res = this.providersMap.delete(id);
      this.saveToDisk();
      return res;
    }
  };

  public runners: IRunnerRepository = {
    listForWorkspace: async (workspaceId) =>
      Array.from(this.runnersMap.values()).filter((r) => r.workspaceId === workspaceId),
    findById: async (id) => {
      const r = this.runnersMap.get(id);
      if (r) {
        r.allowedPaths = Array.from(new Set((r.allowedPaths ?? []).map((p) => p.replace(/\\+/g, "/"))));
        if (r.activePath) r.activePath = r.activePath.replace(/\\+/g, "/");
      }
      return r || null;
    },
    createPairingCode: async (workspaceId, initiatedBy) => {
      const code = `PAIR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const pairing: RunnerPairingCode = {
        id: crypto.randomUUID(),
        workspaceId,
        pairingCode: code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        consumedAt: null,
        attemptCount: 0,
        instructions: "Run 'aso-runner pair " + code + "' on your target machine"
      };
      this.pairingsMap.set(code, pairing);
      this.saveToDisk();
      return pairing;
    },
    findPairingCode: async (code) => this.pairingsMap.get(code) || null,
    redeemPairingCode: async (code, deviceName, publicKey) => {
      const pairing = this.pairingsMap.get(code);
      if (!pairing) throw new Error("Invalid pairing code");
      if (pairing.consumedAt) throw new Error("Pairing code already consumed");
      if (new Date(pairing.expiresAt).getTime() < Date.now()) throw new Error("Pairing code expired");

      pairing.consumedAt = new Date().toISOString();
      const device: RunnerDevice = {
        id: crypto.randomUUID(),
        workspaceId: pairing.workspaceId,
        name: deviceName,
        publicKey,
        status: "online",
        allowedPaths: [],
        activePath: null,
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      this.runnersMap.set(device.id, device);
      this.saveToDisk();
      return device;
    },
    updateStatus: async (id, status) => {
      const r = this.runnersMap.get(id);
      if (!r) return false;
      r.status = status;
      r.lastSeenAt = new Date().toISOString();
      this.saveToDisk();
      return true;
    },
    addAllowedPath: async (id, dirPath, setAsActive = true) => {
      const r = this.runnersMap.get(id);
      if (!r) return null;
      if (!r.allowedPaths) r.allowedPaths = [];
      const cleanPath = dirPath.replace(/\\+/g, "/");
      r.allowedPaths = Array.from(new Set(
        r.allowedPaths
          .map((p) => p.replace(/\\+/g, "/"))
          .filter((p) => !p.includes("UsersaicamDesktop"))
      ));
      if (!r.allowedPaths.includes(cleanPath)) {
        r.allowedPaths.push(cleanPath);
      }
      if (setAsActive) {
        r.activePath = cleanPath;
      }
      this.saveToDisk();
      return r;
    },
    removeAllowedPath: async (id, dirPath) => {
      const r = this.runnersMap.get(id);
      if (!r || !r.allowedPaths) return null;
      const cleanPath = dirPath.replace(/\\+/g, "/");
      r.allowedPaths = r.allowedPaths
        .map((p) => p.replace(/\\+/g, "/"))
        .filter((p) => p !== cleanPath);
      if (r.activePath === cleanPath) {
        r.activePath = r.allowedPaths[0] || "";
      }
      this.saveToDisk();
      return r;
    },
    setActivePath: async (id, dirPath) => {
      const r = this.runnersMap.get(id);
      if (!r) return null;
      if (!r.allowedPaths) r.allowedPaths = [];
      const cleanPath = dirPath.replace(/\\+/g, "/");
      r.allowedPaths = Array.from(new Set(
        r.allowedPaths
          .map((p) => p.replace(/\\+/g, "/"))
          .filter((p) => !p.includes("UsersaicamDesktop"))
      ));
      if (!r.allowedPaths.includes(cleanPath)) {
        r.allowedPaths.push(cleanPath);
      }
      r.activePath = cleanPath;
      this.saveToDisk();
      return r;
    },
    delete: async (id) => {
      const res = this.runnersMap.delete(id);
      this.saveToDisk();
      return res;
    }
  };

  public runs: IRunRepository = {
    findById: async (id) => this.runsMap.get(id) || null,
    listForProject: async (projectId) => {
      return Array.from(this.runsMap.values()).filter((r) => r.projectId === projectId);
    },
    create: async (data) => {
      const id = (data as any).id || crypto.randomUUID();
      const sessionId = (data.runContext as any)?.sessionId || id;
      const run: Run = {
        id,
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        createdBy: data.createdBy,
        rawRequest: data.rawRequest,
        status: data.status || "queued",
        executionMode: data.executionMode || "auto",
        runtime: data.runtime || "local",
        providerPreference: data.providerPreference || "auto",
        budget: {
          maxWallTimeSeconds: data.budget?.maxWallTimeSeconds ?? 1800,
          maxEstimatedCostUsd: data.budget?.maxEstimatedCostUsd ?? 5,
          maxParallelTasks: data.budget?.maxParallelTasks ?? 2,
          hardStopOnBudget: data.budget?.hardStopOnBudget ?? true
        },
        runContext: {
          ...data.runContext,
          sessionId
        },
        createdAt: new Date().toISOString()
      };
      this.runsMap.set(run.id, run);
      this.saveToDisk();
      return run;
    },
    updateStatus: async (id, status, details) => {
      const r = this.runsMap.get(id);
      if (!r) return false;
      r.status = status;
      if (details?.startedAt) r.startedAt = details.startedAt;
      if (details?.completedAt) r.completedAt = details.completedAt;
      if (details?.cancelledAt) r.cancelledAt = details.cancelledAt;
      this.saveToDisk();
      return true;
    },
    delete: async (id) => {
      this.requirementsMap.delete(id);
      this.plansMap.delete(id);
      this.tasksMap.delete(id);
      this.eventsMap.delete(id);
      this.approvalsMap.delete(id);
      this.artifactsMap.delete(id);
      this.usageMap.delete(id);
      const res = this.runsMap.delete(id);
      this.saveToDisk();
      return res;
    },
    deleteSession: async (projectId: string, sessionId: string) => {
      let count = 0;
      for (const [id, r] of this.runsMap.entries()) {
        if (r.projectId === projectId && ((r.runContext as any)?.sessionId === sessionId || id === sessionId)) {
          this.requirementsMap.delete(id);
          this.plansMap.delete(id);
          this.tasksMap.delete(id);
          this.eventsMap.delete(id);
          this.approvalsMap.delete(id);
          this.artifactsMap.delete(id);
          this.usageMap.delete(id);
          this.runsMap.delete(id);
          count++;
        }
      }
      this.saveToDisk();
      return count;
    },
    clearForProject: async (projectId) => {
      let count = 0;
      for (const [id, r] of this.runsMap.entries()) {
        if (r.projectId === projectId) {
          this.requirementsMap.delete(id);
          this.plansMap.delete(id);
          this.tasksMap.delete(id);
          this.eventsMap.delete(id);
          this.approvalsMap.delete(id);
          this.artifactsMap.delete(id);
          this.usageMap.delete(id);
          this.runsMap.delete(id);
          count++;
        }
      }
      this.saveToDisk();
      return count;
    }
  };

  public requirements: IRequirementsRepository = {
    findByRunId: async (runId) => this.requirementsMap.get(runId) || null,
    upsert: async (runId, spec) => {
      this.requirementsMap.set(runId, spec);
      this.saveToDisk();
      return spec;
    }
  };

  public plans: IPlanRepository = {
    findLatestByRunId: async (runId) => {
      const list = this.plansMap.get(runId) || [];
      if (list.length === 0) return null;
      return list[list.length - 1];
    },
    create: async (data) => {
      const plan: RunPlan = {
        id: crypto.randomUUID(),
        runId: data.runId,
        version: data.version || 1,
        tasks: data.tasks,
        approvalStatus: data.approvalStatus || "draft",
        createdAt: new Date().toISOString()
      };
      const list = this.plansMap.get(data.runId) || [];
      list.push(plan);
      this.plansMap.set(data.runId, list);
      this.saveToDisk();
      return plan;
    },
    updateStatus: async (planId, status) => {
      for (const plans of this.plansMap.values()) {
        const found = plans.find((p) => p.id === planId);
        if (found) {
          found.approvalStatus = status;
          this.saveToDisk();
          return true;
        }
      }
      return false;
    }
  };

  public tasks: ITaskRepository = {
    listByRunId: async (runId) => this.tasksMap.get(runId) || [],
    createMany: async (tasks) => {
      if (tasks.length === 0) return [];
      const runId = tasks[0].runId;
      const createdList: RunTask[] = tasks.map((t) => ({
        ...t,
        id: crypto.randomUUID()
      }));
      const existing = this.tasksMap.get(runId) || [];
      this.tasksMap.set(runId, [...existing, ...createdList]);
      this.saveToDisk();
      return createdList;
    },
    updateState: async (taskId, state) => {
      for (const tasks of this.tasksMap.values()) {
        const found = tasks.find((t) => t.id === taskId);
        if (found) {
          found.state = state;
          if (state === "running" && !found.startedAt) {
            found.startedAt = new Date().toISOString();
          }
          if ((state === "completed" || state === "failed") && !found.finishedAt) {
            found.finishedAt = new Date().toISOString();
          }
          this.saveToDisk();
          return true;
        }
      }
      return false;
    },
    updateResult: async (taskId, result, state) => {
      for (const tasks of this.tasksMap.values()) {
        const found = tasks.find((t) => t.id === taskId);
        if (found) {
          found.result = result;
          if (state) found.state = state;
          found.finishedAt = new Date().toISOString();
          this.saveToDisk();
          return true;
        }
      }
      return false;
    }
  };

  public events: IEventRepository = {
    appendEvent: async (workspaceId, runId, eventType, payload) => {
      const list = this.eventsMap.get(runId) || [];
      const nextSequence = list.length + 1;
      const event: RunEvent = {
        id: nextSequence,
        workspaceId,
        runId,
        sequence: nextSequence,
        eventType,
        payload,
        recordedAt: new Date().toISOString()
      };
      list.push(event);
      this.eventsMap.set(runId, list);
      this.saveToDisk();
      return event;
    },
    listAfterSequence: async (runId, afterSequence) => {
      const list = this.eventsMap.get(runId) || [];
      return list.filter((e) => e.sequence > afterSequence);
    },
    listForRun: async (runId) => this.eventsMap.get(runId) || []
  };

  public approvals: IApprovalRepository = {
    create: async (data) => {
      const approval: ApprovalRequest = {
        id: crypto.randomUUID(),
        runId: data.runId,
        taskId: data.taskId,
        requestedBy: data.requestedBy,
        commandDigest: data.commandDigest,
        scope: data.scope || {},
        reason: data.reason,
        state: data.state || "pending",
        expiresAt: data.expiresAt,
        createdAt: new Date().toISOString()
      };
      this.approvalsMap.set(approval.id, approval);
      this.saveToDisk();
      return approval;
    },
    findById: async (id) => this.approvalsMap.get(id) || null,
    listForRun: async (runId) => {
      return Array.from(this.approvalsMap.values()).filter((a) => a.runId === runId);
    },
    decide: async (id, decidedBy, state) => {
      const a = this.approvalsMap.get(id);
      if (!a) return false;
      a.state = state;
      a.decidedBy = decidedBy;
      a.decidedAt = new Date().toISOString();
      this.saveToDisk();
      return true;
    }
  };

  public artifacts: IArtifactRepository = {
    create: async (data) => {
      const artifact: ArtifactRecord = {
        id: crypto.randomUUID(),
        workspaceId: data.workspaceId,
        runId: data.runId,
        artifactType: data.artifactType,
        storageKey: data.storageKey,
        sha256: data.sha256,
        byteSize: data.byteSize,
        createdAt: new Date().toISOString()
      };
      const list = this.artifactsMap.get(data.runId) || [];
      list.push(artifact);
      this.artifactsMap.set(data.runId, list);
      this.saveToDisk();
      return artifact;
    },
    listForRun: async (runId) => this.artifactsMap.get(runId) || []
  };

  public usage: IUsageRepository = {
    record: async (data) => {
      const record: UsageRecord = {
        id: crypto.randomUUID(),
        workspaceId: data.workspaceId,
        runId: data.runId,
        taskId: data.taskId,
        provider: data.provider,
        model: data.model || null,
        connectionMode: data.connectionMode,
        inputTokens: data.inputTokens || 0,
        outputTokens: data.outputTokens || 0,
        cachedInputTokens: data.cachedInputTokens || 0,
        cacheWriteTokens: data.cacheWriteTokens || 0,
        durationMs: data.durationMs || 0,
        measuredCostUsd: data.measuredCostUsd ?? null,
        costConfidence: data.costConfidence || "unavailable",
        source: data.source,
        recordedAt: new Date().toISOString()
      };
      const list = this.usageMap.get(data.runId) || [];
      list.push(record);
      this.usageMap.set(data.runId, list);
      this.saveToDisk();
      return record;
    },
    listForRun: async (runId) => this.usageMap.get(runId) || [],
    aggregateForRun: async (runId) => {
      const list = this.usageMap.get(runId) || [];
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens = 0;
      let cacheWriteTokens = 0;
      let totalDurationMs = 0;
      let totalCostUsd: number | null = null;

      for (const item of list) {
        inputTokens += item.inputTokens;
        outputTokens += item.outputTokens;
        cachedInputTokens += item.cachedInputTokens;
        cacheWriteTokens += item.cacheWriteTokens;
        totalDurationMs += item.durationMs;
        if (item.measuredCostUsd !== null) {
          totalCostUsd = (totalCostUsd || 0) + item.measuredCostUsd;
        }
      }

      return {
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheWriteTokens,
        totalDurationMs,
        totalCostUsd
      };
    }
  };

  public idempotency: IIdempotencyRepository = {
    get: async (workspaceId, key) => {
      const fullKey = `${workspaceId}:${key}`;
      const found = this.idempotencyMap.get(fullKey);
      if (!found) return null;
      if (found.expiresAt < Date.now()) {
        this.idempotencyMap.delete(fullKey);
        return null;
      }
      return { status: found.status, body: found.body };
    },
    set: async (workspaceId, key, status, body, ttlSeconds = 300) => {
      const fullKey = `${workspaceId}:${key}`;
      this.idempotencyMap.set(fullKey, {
        status,
        body,
        expiresAt: Date.now() + ttlSeconds * 1000
      });
    }
  };
}

export function createDatabase(filePath?: string): IDatabase {
  if (process.env.NODE_ENV === "test" && !filePath) {
    return new MemoryDatabase();
  }
  const defaultPath = path.resolve(process.cwd(), ".aso", "db.json");
  return new MemoryDatabase(filePath || process.env.ASO_DB_FILE || defaultPath);
}
