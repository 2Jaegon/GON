import { FastifyInstance } from "fastify";
import { IDatabase } from "@aso/database";
import { CreateRunDTOSchema, ConnectionModels, AgentApprovalDTOSchema } from "@aso/contracts";
import { OrchestratorService } from "../services/orchestrator-service.js";
import { EventBus } from "../services/event-bus.js";
import { resolveActiveWorkspacePath } from "../services/workspace-path.js";

export async function runRoutes(
  server: FastifyInstance,
  options: { db: IDatabase; orchestrator: OrchestratorService; eventBus: EventBus }
) {
  const { db, orchestrator, eventBus } = options;

  // List runs for project
  server.get("/api/v1/workspaces/:workspaceId/projects/:projectId/runs", async (req) => {
    const { projectId } = req.params as { workspaceId: string; projectId: string };
    const runs = await db.runs.listForProject(projectId);
    return { items: runs };
  });

  // Create new run
  server.post("/api/v1/workspaces/:workspaceId/projects/:projectId/runs", async (req, reply) => {
    const { workspaceId, projectId } = req.params as { workspaceId: string; projectId: string };
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

    if (idempotencyKey) {
      const cached = await db.idempotency.get(workspaceId, idempotencyKey);
      if (cached) {
        return reply.status(cached.status).send(cached.body);
      }
    }

    const dto = CreateRunDTOSchema.parse(req.body);
    const sessionId = dto.sessionId || crypto.randomUUID();

    // A chosen connection must offer the model/effort and the workspace needs an active folder.
    let cwd: string | null = null;
    let executionMode = dto.executionMode || "auto";

    if (dto.connectionId) {
      const fail = (code: string, message: string) => reply.status(400).send({ error: { code, message } });
      const connection = (await db.providers.listForWorkspace(workspaceId)).find((c) => c.id === dto.connectionId);
      if (!connection) return fail("CONNECTION_NOT_FOUND", "연결을 찾을 수 없어요");
      const offered = connection.metadata?.models as ConnectionModels | undefined;
      const chosenModel = dto.model ? offered?.models.find((m) => m.id === dto.model) : undefined;
      if (dto.model && !chosenModel) {
        return fail("MODEL_NOT_AVAILABLE", "이 구독에서 쓸 수 없는 모델이에요");
      }
      // A model with its own levels (codex) narrows what the connection offers.
      const allowedEfforts = chosenModel?.efforts ?? offered?.efforts;
      if (dto.effort && !allowedEfforts?.includes(dto.effort)) {
        return fail("EFFORT_NOT_SUPPORTED", "이 구독에서 쓸 수 없는 강도예요");
      }
      cwd = await resolveActiveWorkspacePath(db, workspaceId);
      if (!cwd) return fail("NO_WORKSPACE_FOLDER", "작업 폴더를 먼저 골라 주세요");

      const reqMode = dto.executionMode ?? "auto";
      if (connection.provider === "anthropic" && cwd && (reqMode === "auto" || reqMode === "agent")) {
        executionMode = "agent";
      }
    }

    const run = await db.runs.create({
      workspaceId,
      projectId,
      createdBy: (req as any).user?.id || "00000000-0000-0000-0000-000000000001",
      rawRequest: dto.request,
      status: "queued",
      executionMode,
      runtime: dto.runtime || "local",
      providerPreference: dto.providerPreference || "auto",
      budget: {
        maxWallTimeSeconds: dto.budget?.maxWallTimeSeconds ?? 1800,
        maxEstimatedCostUsd: dto.budget?.maxEstimatedCostUsd ?? 5,
        maxParallelTasks: dto.budget?.maxParallelTasks ?? 2,
        hardStopOnBudget: dto.budget?.hardStopOnBudget ?? true
      },
      runContext: {
        sessionId,
        attachments: dto.attachments || [],
        workspacePath: dto.workspacePath || null,
        connectionId: dto.connectionId ?? null,
        model: dto.model ?? null,
        effort: dto.effort ?? null,
        cwd
      }
    });

    const responseBody = {
      id: run.id,
      runId: run.id,
      sessionId,
      status: run.status,
      executionMode: run.executionMode,
      links: {
        self: `/api/v1/workspaces/${workspaceId}/runs/${run.id}`,
        events: `/api/v1/workspaces/${workspaceId}/runs/${run.id}/events`
      }
    };

    if (idempotencyKey) {
      await db.idempotency.set(workspaceId, idempotencyKey, 201, responseBody);
    }

    // Trigger orchestration asynchronously
    setImmediate(() => {
      orchestrator.startRun(run, dto.options).catch((err) => {
        req.log.error(err, "Error in orchestrator background execution");
      });
    });

    return reply.status(201).send(responseBody);
  });

  // Get run details
  server.get("/api/v1/workspaces/:workspaceId/runs/:runId", async (req, reply) => {
    const { runId } = req.params as { workspaceId: string; runId: string };
    const run = await db.runs.findById(runId);
    if (!run) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Run not found" } });
    }
    return run;
  });

  // Get requirements
  server.get("/api/v1/workspaces/:workspaceId/runs/:runId/requirements", async (req, reply) => {
    const { runId } = req.params as { workspaceId: string; runId: string };
    const reqs = await db.requirements.findByRunId(runId);
    if (!reqs) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Requirements not yet refined" } });
    }
    return reqs;
  });

  // Get plan
  server.get("/api/v1/workspaces/:workspaceId/runs/:runId/plan", async (req, reply) => {
    const { runId } = req.params as { workspaceId: string; runId: string };
    const plan = await db.plans.findLatestByRunId(runId);
    if (!plan) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Plan not yet created" } });
    }
    return plan;
  });

  // Approve plan
  server.post("/api/v1/workspaces/:workspaceId/runs/:runId/plan/approve", async (req, reply) => {
    const { workspaceId, runId } = req.params as { workspaceId: string; runId: string };
    try {
      await orchestrator.approvePlanAndExecute(runId, workspaceId);
      return reply.status(200).send({ success: true, message: "Plan approved, execution initiated" });
    } catch (err: any) {
      return reply.status(400).send({ error: { code: "PLAN_APPROVAL_FAILED", message: err.message } });
    }
  });

  // Agent approval
  server.post("/api/v1/workspaces/:workspaceId/runs/:runId/agent/approval", async (req, reply) => {
    const { workspaceId, runId } = req.params as { workspaceId: string; runId: string };
    const parsed = AgentApprovalDTOSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "AGENT_APPROVAL_FAILED", message: "결정(allow 또는 deny)이 올바르지 않아요" }
      });
    }

    const run = await db.runs.findById(runId);
    if (!run || run.workspaceId !== workspaceId) {
      return reply.status(404).send({ error: { code: "RUN_NOT_FOUND", message: "실행을 찾을 수 없어요" } });
    }

    if (run.status !== "awaiting_approval") {
      return reply.status(400).send({
        error: { code: "AGENT_APPROVAL_FAILED", message: "승인 대기 중인 요청이 없어요" }
      });
    }

    try {
      await orchestrator.agent.resolveApproval(run, parsed.data.decision);
      return reply.status(200).send({ success: true });
    } catch (err: any) {
      return reply.status(400).send({
        error: { code: "AGENT_APPROVAL_FAILED", message: err?.message || String(err) }
      });
    }
  });

  // Cancel running run
  server.post("/api/v1/workspaces/:workspaceId/runs/:runId/cancel", async (req, reply) => {
    const { workspaceId, runId } = req.params as { workspaceId: string; runId: string };
    const run = await db.runs.findById(runId);
    if (!run || run.workspaceId !== workspaceId) {
      return reply.status(404).send({ error: { code: "RUN_NOT_RUNNING", message: "진행 중인 실행을 찾을 수 없어요" } });
    }

    if (run.status === "awaiting_approval") {
      await db.runs.updateStatus(run.id, "cancelled", { cancelledAt: new Date().toISOString() });
      await orchestrator.emitEvent(workspaceId, run.id, "run:cancelled", {});
      return reply.status(200).send({ success: true });
    }

    const cancelled = orchestrator.agent.cancel(runId);
    if (!cancelled) {
      return reply.status(404).send({ error: { code: "RUN_NOT_RUNNING", message: "진행 중인 실행이 아니에요" } });
    }

    return reply.status(200).send({ success: true });
  });

  // Get tasks
  server.get("/api/v1/workspaces/:workspaceId/runs/:runId/tasks", async (req) => {
    const { runId } = req.params as { workspaceId: string; runId: string };
    const tasks = await db.tasks.listByRunId(runId);
    return { items: tasks };
  });

  // Get artifacts
  server.get("/api/v1/workspaces/:workspaceId/runs/:runId/artifacts", async (req) => {
    const { runId } = req.params as { workspaceId: string; runId: string };
    const artifacts = await db.artifacts.listForRun(runId);
    return { items: artifacts };
  });

  // Get usage summary
  server.get("/api/v1/workspaces/:workspaceId/runs/:runId/usage", async (req) => {
    const { runId } = req.params as { workspaceId: string; runId: string };
    const aggregate = await db.usage.aggregateForRun(runId);
    const records = await db.usage.listForRun(runId);
    return { aggregate, items: records };
  });

  // Server-Sent Events (SSE) Stream
  server.get("/api/v1/workspaces/:workspaceId/runs/:runId/events", async (req, reply) => {
    const { runId } = req.params as { workspaceId: string; runId: string };

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    reply.raw.flushHeaders?.();

    // Check Last-Event-ID for replay
    const lastEventId = req.headers["last-event-id"] as string | undefined;
    const fromSequence = lastEventId ? parseInt(lastEventId, 10) : 0;

    const previousEvents = await db.events.listAfterSequence(runId, fromSequence);
    for (const ev of previousEvents) {
      reply.raw.write(`id: ${ev.sequence}\nevent: ${ev.eventType}\ndata: ${JSON.stringify(ev.payload)}\n\n`);
    }

    // Subscribe to live events
    const unsubscribe = eventBus.subscribe(runId, (ev) => {
      reply.raw.write(`id: ${ev.sequence}\nevent: ${ev.eventType}\ndata: ${JSON.stringify(ev.payload)}\n\n`);
    });

    // Heartbeat every 15s to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 15000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // Get event list for a run (replays all past events)
  server.get("/api/v1/workspaces/:workspaceId/runs/:runId/event-list", async (req) => {
    const { runId } = req.params as { workspaceId: string; runId: string };
    const list = await db.events.listForRun(runId);
    return { items: list };
  });

  // Delete single run
  server.delete("/api/v1/workspaces/:workspaceId/runs/:runId", async (req, reply) => {
    const { runId } = req.params as { workspaceId: string; runId: string };
    const deleted = await db.runs.delete(runId);
    if (!deleted) {
      return reply.status(404).send({ error: "Run not found" });
    }
    return { ok: true, deletedRunId: runId };
  });

  // Delete all runs belonging to a session
  server.delete("/api/v1/workspaces/:workspaceId/projects/:projectId/sessions/:sessionId", async (req) => {
    const { projectId, sessionId } = req.params as { workspaceId: string; projectId: string; sessionId: string };
    const count = await db.runs.deleteSession(projectId, sessionId);
    return { ok: true, deletedCount: count, sessionId };
  });

  // Clear all runs / conversations for project
  server.delete("/api/v1/workspaces/:workspaceId/projects/:projectId/runs", async (req) => {
    const { projectId } = req.params as { workspaceId: string; projectId: string };
    const count = await db.runs.clearForProject(projectId);
    return { ok: true, deletedCount: count };
  });
}

