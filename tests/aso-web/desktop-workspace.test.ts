import { describe, it, expect } from "vitest";
import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase } from "@aso/database";

describe("Desktop Runner Workspace Directory Selection", () => {
  it("allows querying, granting, and switching desktop workspace paths", async () => {
    const db = createDatabase(":memory:");
    const { server } = await createApiServer({ db, logger: false });

    // 1. Create a pairing and redeem to register a device
    const pairRes = await server.inject({
      method: "POST",
      url: "/api/v1/workspaces/00000000-0000-7000-8000-000000000002/runner-pairings"
    });
    expect(pairRes.statusCode).toBe(201);
    const pairData = JSON.parse(pairRes.body);

    const redeemRes = await server.inject({
      method: "POST",
      url: "/api/v1/runner/pairings/redeem",
      payload: {
        pairingCode: pairData.pairingCode,
        deviceName: "My-Workstation-win32",
        publicKey: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0\n-----END PUBLIC KEY-----"
      }
    });
    expect(redeemRes.statusCode).toBe(200);
    const device = JSON.parse(redeemRes.body);

    // 2. Query allowed paths for the device
    const pathsRes = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/00000000-0000-7000-8000-000000000002/runners/${device.deviceId}/paths`
    });
    expect(pathsRes.statusCode).toBe(200);
    const pathsData = JSON.parse(pathsRes.body);
    expect(Array.isArray(pathsData.allowedPaths)).toBe(true);

    // 3. Grant a new workspace directory
    const newPath = "C:\\Users\\aicam\\Desktop\\my-workspace";
    const grantRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/00000000-0000-7000-8000-000000000002/runners/${device.deviceId}/paths`,
      payload: {
        path: newPath,
        setAsActive: true
      }
    });
    expect(grantRes.statusCode).toBe(200);
    const updated = JSON.parse(grantRes.body);
    expect(updated.allowedPaths.some((p: string) => p.includes("my-workspace"))).toBe(true);

    // 4. Create a Run with the selected workspacePath
    const runRes = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/00000000-0000-7000-8000-000000000002/projects/00000000-0000-7000-8000-000000000003/runs`,
      payload: {
        request: "Hello desktop workspace",
        workspacePath: newPath,
        executionMode: "chat",
        providerPreference: "mock"
      }
    });
    expect(runRes.statusCode).toBe(201);
    const runData = JSON.parse(runRes.body);
    expect(runData.runId).toBeDefined();

    // Verify runContext has workspacePath
    const runRecord = await db.runs.findById(runData.runId);
    expect(runRecord?.runContext?.workspacePath).toBe(newPath);

    // 5. Delete / unregister the runner device
    const deleteRes = await server.inject({
      method: "DELETE",
      url: `/api/v1/workspaces/00000000-0000-7000-8000-000000000002/runners/${device.deviceId}`
    });
    expect(deleteRes.statusCode).toBe(200);
    const deleteData = JSON.parse(deleteRes.body);
    expect(deleteData.success).toBe(true);

    const checkDevice = await db.runners.findById(device.deviceId);
    expect(checkDevice).toBeNull();
  });
});

