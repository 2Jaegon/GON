import path from "node:path";
import { IDatabase } from "@aso/database";
import { IntentRefiner, TaskClassifier, DAGPlanner, SkillRouter } from "@aso/core";
import { CliRunner, Effort, IProviderAdapter, ProviderRegistry } from "@aso/provider-adapters";
import { Run, RunTask, RunEvent, CreateRunDTO, ExecutionMode } from "@aso/contracts";
import { EventBus } from "./event-bus.js";
import { resolveActiveWorkspacePath } from "./workspace-path.js";

export class OrchestratorService {
  private classifier = new TaskClassifier();
  private refiner = new IntentRefiner();
  private planner = new DAGPlanner();
  private router = new SkillRouter();
  private providerRegistry: ProviderRegistry;

  constructor(
    private db: IDatabase,
    private eventBus: EventBus,
    cliRunner?: CliRunner
  ) {
    this.providerRegistry = new ProviderRegistry(cliRunner);
  }

  /** The adapter plus model/effort/cwd for a run: the chosen connection when there is one, else the old auto pick. */
  private async selectionFor(run: Run): Promise<{ provider: IProviderAdapter; model?: string; effort?: Effort; cwd?: string }> {
    const ctx = run.runContext ?? {};
    if (!ctx.connectionId) return { provider: this.providerRegistry.resolve(run.providerPreference) };

    const connection = await this.db.providers.findById(ctx.connectionId);
    if (!connection) throw new Error("선택한 연결을 찾을 수 없어요");
    // The folder may have been revoked or removed since the run was created (e.g. while awaiting approval).
    const folder = await resolveActiveWorkspacePath(this.db, run.workspaceId);
    if (!folder || !ctx.cwd || path.resolve(folder) !== path.resolve(ctx.cwd)) {
      throw new Error("작업 폴더를 먼저 골라 주세요");
    }
    return {
      provider: this.providerRegistry.forConnection(connection.provider),
      model: ctx.model ?? undefined,
      effort: ctx.effort ?? undefined,
      cwd: ctx.cwd ?? undefined
    };
  }

  private async failRun(runId: string, workspaceId: string, err: any): Promise<void> {
    await this.db.runs.updateStatus(runId, "failed", { completedAt: new Date().toISOString() });
    await this.emitEvent(workspaceId, runId, "run:failed", { error: err?.message || String(err) });
  }

  private async buildConversationalPrompt(run: Run): Promise<string> {
    const sessionId = run.runContext?.sessionId;
    if (!sessionId) return run.rawRequest;

    const projectRuns = await this.db.runs.listForProject(run.projectId);
    const priorRuns = projectRuns
      .filter((r) => r.id !== run.id && r.runContext?.sessionId === sessionId && r.status === "completed")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-6);

    if (priorRuns.length === 0) return run.rawRequest;

    const historyLines: string[] = [];
    for (const prior of priorRuns) {
      const events = await this.db.events.listForRun(prior.id);
      const replyEvent = [...events].reverse().find(
        (ev) => (ev.eventType === "chat:response" && ev.payload?.text) || (ev.eventType === "run:completed" && ev.payload?.output)
      );
      const answer = replyEvent?.payload?.text || replyEvent?.payload?.output || "";
      historyLines.push(`사용자: ${prior.rawRequest}`);
      if (answer) {
        historyLines.push(`AI: ${answer}`);
      }
    }

    return `[이전 대화 기록]\n${historyLines.join("\n")}\n\n[현재 질문]\n${run.rawRequest}`;
  }

  public async emitEvent(
    workspaceId: string,
    runId: string,
    eventType: string,
    payload: Record<string, any>
  ): Promise<RunEvent> {
    const event = await this.db.events.appendEvent(workspaceId, runId, eventType, payload);
    this.eventBus.publish(runId, event);
    return event;
  }

  public async startRun(run: Run, options?: CreateRunDTO["options"]): Promise<void> {
    const { id: runId, workspaceId, rawRequest } = run;

    try {
      // 1. Classify User Intent first
      const classification = this.classifier.classify(rawRequest);
      const executionMode = run.executionMode === "auto" ? classification.mode : run.executionMode;

      // 2. Direct Conversational Chat Mode:
      // When the user asks casual greetings/questions, do NOT create DAG planning tasks or requirements refinement!
      if (executionMode === "chat") {
        await this.db.runs.updateStatus(runId, "running", { startedAt: new Date().toISOString() });
        await this.emitEvent(workspaceId, runId, "run:classified", {
          mode: "chat",
          reason: classification.reason,
          confidence: classification.confidence
        });

        const selection = await this.selectionFor(run);
        const { provider } = selection;
        const conversationalPrompt = await this.buildConversationalPrompt(run);
        const chatResult = await (provider.executeChat
          ? provider.executeChat({
              runId,
              workspaceId,
              prompt: conversationalPrompt,
              model: run.runContext?.connectionId
                ? selection.model
                : run.providerPreference !== "auto" ? run.providerPreference : "gemini-3.8-flash-low",
              effort: selection.effort,
              cwd: selection.cwd,
              context: run.runContext
            })
          : this.providerRegistry.get("agy").executeChat!({
              runId,
              workspaceId,
              prompt: conversationalPrompt,
              model: "gemini-3.8-flash-low",
              context: run.runContext
            }));

        await this.db.usage.record(chatResult.usage);

        await this.emitEvent(workspaceId, runId, "chat:response", {
          text: chatResult.output,
          usage: chatResult.usage
        });

        await this.db.runs.updateStatus(runId, "completed", { completedAt: new Date().toISOString() });
        await this.emitEvent(workspaceId, runId, "run:completed", {
          output: chatResult.output,
          usage: chatResult.usage
        });
        return;
      }

      // 3. Planning & Build Mode (fast, standard, deep)
      // Only execute intent refinement and DAG planning when user actually wants to build/plan/code
      await this.db.runs.updateStatus(runId, "refining", { startedAt: new Date().toISOString() });
      await this.emitEvent(workspaceId, runId, "run:refining", { request: rawRequest });

      const requirements = this.refiner.refine(rawRequest);
      await this.db.requirements.upsert(runId, requirements);
      await this.emitEvent(workspaceId, runId, "requirements:refined", { requirements });

      await this.db.runs.updateStatus(runId, "planning");
      await this.emitEvent(workspaceId, runId, "run:classified", {
        mode: executionMode,
        reason: classification.reason,
        confidence: classification.confidence
      });

      const tasks = this.planner.plan(runId, requirements, executionMode);
      const createdTasks = await this.db.tasks.createMany(tasks);

      const plan = await this.db.plans.create({
        runId,
        version: 1,
        tasks: createdTasks,
        approvalStatus: options?.requirePlanApproval ? "draft" : "approved"
      });

      await this.emitEvent(workspaceId, runId, "plan:created", {
        planId: plan.id,
        tasksCount: createdTasks.length,
        tasks: createdTasks.map((t) => ({ key: t.taskKey, title: t.title, deps: t.dependencies }))
      });

      // If approval is required, pause and wait for user approval
      if (options?.requirePlanApproval) {
        await this.db.runs.updateStatus(runId, "awaiting_approval");
        await this.emitEvent(workspaceId, runId, "run:awaiting_approval", { planId: plan.id });
        return;
      }

      // Otherwise proceed directly
      await this.executePlan(run, createdTasks, executionMode);
    } catch (err: any) {
      await this.failRun(runId, workspaceId, err);
    }
  }

  public async approvePlanAndExecute(runId: string, workspaceId: string): Promise<void> {
    const plan = await this.db.plans.findLatestByRunId(runId);
    if (!plan) throw new Error("No plan found for run");

    await this.db.plans.updateStatus(plan.id, "approved");
    await this.emitEvent(workspaceId, runId, "plan:approved", { planId: plan.id });

    const run = await this.db.runs.findById(runId);
    if (!run) throw new Error("Run not found");
    const tasks = await this.db.tasks.listByRunId(runId);
    try {
      await this.executePlan(run, tasks, "standard");
    } catch (err: any) {
      await this.failRun(runId, workspaceId, err);
    }
  }

  private async executePlan(run: Run, tasks: RunTask[], mode: ExecutionMode): Promise<void> {
    const { id: runId, workspaceId } = run;
    await this.db.runs.updateStatus(runId, "running");
    await this.emitEvent(workspaceId, runId, "run:executing", { tasksCount: tasks.length });

    const { provider, model, effort, cwd } = await this.selectionFor(run);

    for (const task of tasks) {
      await this.db.tasks.updateState(task.id, "running");

      // Select skills
      const selectedSkills = this.router.route(mode, task.title, task.capabilityRequirements);
      await this.emitEvent(workspaceId, runId, "task:skills_routed", {
        taskId: task.id,
        skills: selectedSkills
      });

      // Execute via Provider Adapter (AgyProvider or MockProvider)
      const result = await provider.execute({
        runId,
        workspaceId,
        task,
        model,
        effort,
        cwd,
        onEvent: async (evType, payload) => {
          await this.emitEvent(workspaceId, runId, evType, payload);
        }
      });

      // Update task result
      await this.db.tasks.updateResult(task.id, result, result.success ? "completed" : "failed");

      // Record usage ledger
      await this.db.usage.record(result.usage);

      // Create artifacts
      for (const f of result.filesChanged) {
        await this.db.artifacts.create({
          workspaceId,
          runId,
          artifactType: "diff",
          storageKey: `diffs/${runId}/${task.taskKey}.diff`,
          sha256: "mock-sha256",
          byteSize: Buffer.byteLength(f.diff)
        });
      }
    }

    // Verify & complete
    await this.db.runs.updateStatus(runId, "verifying");
    await this.emitEvent(workspaceId, runId, "run:verifying", {});

    await this.db.runs.updateStatus(runId, "completed", { completedAt: new Date().toISOString() });
    const usageAggregate = await this.db.usage.aggregateForRun(runId);
    await this.emitEvent(workspaceId, runId, "run:completed", { usage: usageAggregate });
  }
}

