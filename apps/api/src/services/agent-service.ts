import crypto from "node:crypto";
import { IDatabase } from "@aso/database";
import { Run, RunEvent } from "@aso/contracts";
import {
  AgentRunner,
  AgentEvent,
  AgentResult,
  runClaudeAgent,
  describeDenial,
  summarizeTool,
  isResumeFailure,
  buildAgentSystemPrompt
} from "@aso/provider-adapters";
import { redactSecrets } from "@aso/security";
import { EventBus } from "./event-bus.js";

export class AgentService {
  private activeControllers = new Map<string, AbortController>();

  constructor(
    private db: IDatabase,
    private eventBus: EventBus,
    private runner: AgentRunner = runClaudeAgent
  ) {}

  public cancel(runId: string): boolean {
    const controller = this.activeControllers.get(runId);
    if (!controller) return false;
    controller.abort();
    this.activeControllers.delete(runId);
    return true;
  }

  private async emitEvent(
    workspaceId: string,
    runId: string,
    eventType: string,
    payload: Record<string, any>
  ): Promise<RunEvent> {
    const event = await this.db.events.appendEvent(workspaceId, runId, eventType, payload);
    this.eventBus.publish(runId, event);
    return event;
  }

  private async findResumeSessionId(run: Run): Promise<string | undefined> {
    const sessionId = run.runContext?.sessionId;
    const connectionId = run.runContext?.connectionId;
    if (!sessionId || !connectionId) return undefined;

    const projectRuns = await this.db.runs.listForProject(run.projectId);
    const priorRuns = projectRuns
      .filter(
        (r) =>
          r.id !== run.id &&
          r.runContext?.sessionId === sessionId &&
          r.runContext?.connectionId === connectionId &&
          r.executionMode === "agent"
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    for (const prior of priorRuns) {
      const events = await this.db.events.listForRun(prior.id);
      const lastSessionEv = [...events].reverse().find(
        (ev) =>
          (ev.eventType === "agent:done" && ev.payload?.claudeSessionId) ||
          (ev.eventType === "agent:approval_needed" && ev.payload?.claudeSessionId)
      );
      if (lastSessionEv?.payload?.claudeSessionId) {
        return String(lastSessionEv.payload.claudeSessionId);
      }
    }
    return undefined;
  }

  private async supersedePendingRuns(run: Run): Promise<void> {
    const sessionId = run.runContext?.sessionId;
    if (!sessionId) return;

    const projectRuns = await this.db.runs.listForProject(run.projectId);
    const pendingRuns = projectRuns.filter(
      (r) => r.id !== run.id && r.runContext?.sessionId === sessionId && r.status === "awaiting_approval"
    );

    for (const pending of pendingRuns) {
      await this.db.runs.updateStatus(pending.id, "cancelled", { cancelledAt: new Date().toISOString() });
      await this.emitEvent(pending.workspaceId, pending.id, "agent:approval_resolved", {
        decision: "deny",
        reason: "superseded"
      });
    }
  }

  public async start(run: Run): Promise<void> {
    await this.supersedePendingRuns(run);

    await this.db.runs.updateStatus(run.id, "running", { startedAt: new Date().toISOString() });
    await this.emitEvent(run.workspaceId, run.id, "run:classified", {
      mode: "agent",
      reason: "Claude agent execution with tool calling",
      confidence: 1
    });

    let prompt = run.rawRequest;
    const attachments = (run.runContext?.attachments as any[]) || [];
    const textAttachments = attachments.filter((a) => a && a.text);
    if (textAttachments.length > 0) {
      prompt += "\n\n[첨부 파일]:\n" + textAttachments.map((a) => `--- ${a.name} ---\n${a.text}`).join("\n");
    }

    const hasImageAttachment = attachments.some(
      (a) => a && !a.text && (a.dataUrl || (typeof a.type === "string" && a.type.startsWith("image/")))
    );

    const initialResumeId = await this.findResumeSessionId(run);

    const sessionId = run.runContext?.sessionId;
    if (sessionId) {
      const priorRuns = await this.db.runs.listForProject(run.projectId);
      const sortedPriors = priorRuns
        .filter((r) => r.id !== run.id && r.runContext?.sessionId === sessionId && r.executionMode === "agent")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (sortedPriors.length > 0) {
        const events = await this.db.events.listForRun(sortedPriors[0].id);
        const lastGrillEv = [...events].reverse().find((e) => e.eventType === "agent:grilling");
        if (lastGrillEv?.payload?.state === "asking") {
          await this.emitEvent(run.workspaceId, run.id, "agent:grilling", { state: "answered" });
        }
      }
    }

    await this.runLoop(run, prompt, initialResumeId, undefined, hasImageAttachment, true);
  }

  public async resolveApproval(run: Run, decision: "allow" | "deny"): Promise<void> {
    if (run.status !== "awaiting_approval") {
      throw new Error("승인 대기 중인 요청이 없어요");
    }

    const events = await this.db.events.listForRun(run.id);
    const lastApprovalEv = [...events].reverse().find((e) => e.eventType === "agent:approval_needed");
    if (!lastApprovalEv) {
      throw new Error("승인 대기 중인 요청이 없어요");
    }

    const claudeSessionId = lastApprovalEv.payload?.claudeSessionId;
    const items = lastApprovalEv.payload?.items ?? [];

    await this.emitEvent(run.workspaceId, run.id, "agent:approval_resolved", {
      requestId: lastApprovalEv.payload?.requestId,
      decision
    });

    let prompt = "거절했어요. 다른 방법을 제안하세요.";
    let extraAllowed: string[] = [];

    if (decision === "allow") {
      const rules = items.map((i: any) => i.rule).filter((r: any): r is string => Boolean(r));
      if (rules.length > 0) {
        prompt = "승인했어요. 계속하세요.";
        extraAllowed = rules;
      }
    }

    await this.db.runs.updateStatus(run.id, "running");
    await this.runLoop(run, prompt, claudeSessionId, extraAllowed, false, false);
  }

  private async runLoop(
    run: Run,
    prompt: string,
    resumeSessionId: string | undefined,
    extraAllowed: string[] | undefined,
    hasImageAttachment: boolean,
    canRetryOnResumeFailure: boolean
  ): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(run.id, controller);

    const maxWallMs = (run.budget?.maxWallTimeSeconds ?? 1800) * 1000;
    let streamedText = "";
    let resumeFailedNotice = "";
    let isGrilling = false;
    let grillingAskingEmitted = false;

    const stripGrillingMarker = (text: string) => text.replace(/^\s*\[Grilling\][^\n]*\n?/i, "");

    const markGrillingAsking = async () => {
      if (!grillingAskingEmitted) {
        grillingAskingEmitted = true;
        await this.emitEvent(run.workspaceId, run.id, "agent:grilling", { state: "asking" });
      }
    };

    const onEvent = async (ev: AgentEvent) => {
      if (ev.kind === "text") {
        streamedText += ev.delta;
        if (!isGrilling && /^\s*\[Grilling\]/i.test(streamedText)) {
          isGrilling = true;
          await markGrillingAsking();
        }
        const cleanedText = isGrilling ? stripGrillingMarker(streamedText) : streamedText;
        this.eventBus.publish(run.id, {
          id: 0,
          workspaceId: run.workspaceId,
          runId: run.id,
          sequence: 0,
          eventType: "chat:delta",
          payload: { delta: ev.delta, text: cleanedText, provider: "anthropic" },
          recordedAt: new Date().toISOString()
        });
      } else if (ev.kind === "tool") {
        if (
          !isGrilling &&
          ev.name === "Skill" &&
          typeof (ev.input as any)?.skill === "string" &&
          /grill/i.test((ev.input as any).skill)
        ) {
          isGrilling = true;
          await markGrillingAsking();
        }
        await this.emitEvent(run.workspaceId, run.id, "agent:tool", {
          id: ev.id,
          name: ev.name,
          summary: redactSecrets(summarizeTool(ev.name, ev.input))
        });
      }
    };

    let result: AgentResult;
    const isSkipGrilling = Boolean((run.runContext as any)?.skipGrilling);
    const appendSystemPrompt = buildAgentSystemPrompt({
      image: { gonRoot: process.cwd() },
      grilling: !isSkipGrilling
    });

    try {
      try {
        result = await this.runner(
          {
            prompt,
            cwd: run.runContext?.cwd || process.cwd(),
            model: run.runContext?.model ?? undefined,
            effort: run.runContext?.effort ?? undefined,
            resumeSessionId,
            appendSystemPrompt,
            extraAllowed,
            maxWallMs
          },
          (ev) => {
            void onEvent(ev);
          },
          controller.signal
        );
      } catch (err: any) {
        if (canRetryOnResumeFailure && resumeSessionId && isResumeFailure(err?.message || "")) {
          resumeFailedNotice = "이전 대화를 이어가지 못해 새로 시작했어요\n";
          result = await this.runner(
            {
              prompt,
              cwd: run.runContext?.cwd || process.cwd(),
              model: run.runContext?.model ?? undefined,
              effort: run.runContext?.effort ?? undefined,
              resumeSessionId: undefined,
              appendSystemPrompt,
              extraAllowed,
              maxWallMs
            },
            (ev) => {
              void onEvent(ev);
            },
            controller.signal
          );
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      this.activeControllers.delete(run.id);
      if (controller.signal.aborted || err?.message === "중단했어요.") {
        await this.db.runs.updateStatus(run.id, "cancelled", { cancelledAt: new Date().toISOString() });
        await this.emitEvent(run.workspaceId, run.id, "run:cancelled", {});
        return;
      }
      await this.db.runs.updateStatus(run.id, "failed", { completedAt: new Date().toISOString() });
      await this.emitEvent(run.workspaceId, run.id, "run:failed", { error: err?.message || String(err) });
      return;
    }

    this.activeControllers.delete(run.id);

    if (result.denials && result.denials.length > 0) {
      await this.db.runs.updateStatus(run.id, "awaiting_approval");
      const items = result.denials.map((d) => {
        const desc = describeDenial(d);
        return {
          tool: desc.tool,
          summary: redactSecrets(desc.summary),
          danger: desc.danger,
          rule: desc.rule
        };
      });

      await this.emitEvent(run.workspaceId, run.id, "agent:approval_needed", {
        requestId: crypto.randomUUID(),
        claudeSessionId: result.sessionId,
        items
      });
      return;
    }

    // Agent turn completed without denials
    await this.emitEvent(run.workspaceId, run.id, "agent:done", {
      claudeSessionId: result.sessionId,
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens
    });

    const measured = result.inputTokens != null || result.outputTokens != null;
    const usage = {
      workspaceId: run.workspaceId,
      runId: run.id,
      taskId: "agent",
      provider: "anthropic",
      model: run.runContext?.model ?? null,
      connectionMode: "LOCAL_NATIVE_CLI" as const,
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
      cachedInputTokens: result.cachedInputTokens ?? 0,
      cacheWriteTokens: 0,
      durationMs: result.durationMs,
      measuredCostUsd: measured ? (result.costUsd ?? 0) : null,
      costConfidence: measured ? ("measured" as const) : ("unavailable" as const),
      source: "claude-code-cli (agent)"
    };
    await this.db.usage.record(usage);

    let finalOutput = result.text;
    if (!isGrilling && /^\s*\[Grilling\]/i.test(finalOutput)) {
      isGrilling = true;
      await markGrillingAsking();
    }
    if (isGrilling) {
      finalOutput = stripGrillingMarker(finalOutput);
    }
    if (hasImageAttachment) {
      finalOutput = "이미지 첨부는 에이전트 경로에서 아직 지원하지 않아요\n" + finalOutput;
    }
    if (resumeFailedNotice) {
      finalOutput = resumeFailedNotice + finalOutput;
    }

    await this.emitEvent(run.workspaceId, run.id, "chat:response", {
      text: finalOutput,
      usage
    });

    await this.db.runs.updateStatus(run.id, "completed", { completedAt: new Date().toISOString() });
    await this.emitEvent(run.workspaceId, run.id, "run:completed", {
      output: finalOutput,
      usage
    });
  }
}

