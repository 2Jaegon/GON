import { describe, it, expect } from "vitest";
import {
  WorkspaceSchema,
  ProjectSchema,
  RunSchema,
  RunTaskSchema,
  CreateRunDTOSchema,
  AgentApprovalDTOSchema,
  ProviderConnectionViewSchema
} from "@aso/contracts";

describe("Contracts Zod Schemas", () => {
  it("accepts the agent execution mode and validates the agent approval DTO", () => {
    expect(CreateRunDTOSchema.safeParse({ request: "x", executionMode: "agent" }).success).toBe(true);
    expect(AgentApprovalDTOSchema.safeParse({ decision: "allow" }).success).toBe(true);
    expect(AgentApprovalDTOSchema.safeParse({ decision: "deny" }).success).toBe(true);
    expect(AgentApprovalDTOSchema.safeParse({ decision: "maybe" }).success).toBe(false);
    expect(AgentApprovalDTOSchema.safeParse({}).success).toBe(false);
  });

  it("accepts every effort level the CLIs offer and rejects unknown ones", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max", "ultra"]) {
      expect(CreateRunDTOSchema.safeParse({ request: "x", effort }).success).toBe(true);
    }
    expect(CreateRunDTOSchema.safeParse({ request: "x", effort: "warp" }).success).toBe(false);
  });

  it("validates Workspace schema", () => {
    const valid = {
      id: "00000000-0000-7000-8000-000000000001",
      name: "Engineering Team",
      ownerId: "00000000-0000-7000-8000-000000000002",
      plan: "pro",
      retentionDays: 90,
      createdAt: new Date().toISOString()
    };
    const parsed = WorkspaceSchema.parse(valid);
    expect(parsed.name).toBe("Engineering Team");
    expect(parsed.plan).toBe("pro");
  });

  it("validates Project schema with execution policy", () => {
    const valid = {
      id: "00000000-0000-7000-8000-000000000003",
      workspaceId: "00000000-0000-7000-8000-000000000001",
      name: "Financial Disclosures",
      sourceType: "github",
      repositoryRef: "org/disclosures",
      defaultRuntime: "local",
      defaultProvider: "auto",
      executionPolicy: {
        allowNetwork: false,
        allowGitPush: false,
        allowDeployment: false,
        requireApprovalForDestructiveActions: true
      },
      createdBy: "00000000-0000-7000-8000-000000000002",
      createdAt: new Date().toISOString()
    };
    const parsed = ProjectSchema.parse(valid);
    expect(parsed.name).toBe("Financial Disclosures");
    expect(parsed.executionPolicy.requireApprovalForDestructiveActions).toBe(true);
  });

  it("validates CreateRunDTO defaults", () => {
    const dto = CreateRunDTOSchema.parse({
      request: "Add financial search and summary"
    });
    expect(dto.runtime).toBe("local");
    expect(dto.executionMode).toBe("auto");
    expect(dto.providerPreference).toBe("auto");
  });

  it("validates ProviderConnectionView guarantees zero secret fields", () => {
    const view = {
      id: "00000000-0000-7000-8000-000000000010",
      provider: "openai",
      mode: "USER_API_KEY",
      status: "connected",
      displayName: "OpenAI BYOK",
      capabilities: ["plan", "code", "review"],
      billingOwner: "user",
      estimatedCostVisible: true,
      legalGate: "approved"
    };
    const parsed = ProviderConnectionViewSchema.parse(view);
    expect(parsed.provider).toBe("openai");
    expect((parsed as any).apiKey).toBeUndefined();
    expect((parsed as any).secret).toBeUndefined();
  });
});

