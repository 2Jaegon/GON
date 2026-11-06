import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApiServer, DEV_WORKSPACE_ID } from "../../apps/api/src/server.js";
import { verifyGoogleIdToken, GoogleIdentity } from "../../apps/api/src/auth/google.js";
import { createDatabase } from "@aso/database";

describe("verifyGoogleIdToken helper", () => {
  const clientId = "my-google-client-id";

  it("throws when audience does not match clientId", async () => {
    const fakeFetch: any = async () => ({
      ok: true,
      json: async () => ({
        aud: "wrong-client-id",
        iss: "https://accounts.google.com",
        exp: String(Math.floor(Date.now() / 1000) + 3600),
        email_verified: "true",
        email: "test@example.com",
        sub: "sub1"
      })
    });
    await expect(verifyGoogleIdToken("dummy", clientId, fakeFetch)).rejects.toThrow(/mismatch/i);
  });

  it("throws when token has expired", async () => {
    const fakeFetch: any = async () => ({
      ok: true,
      json: async () => ({
        aud: clientId,
        iss: "https://accounts.google.com",
        exp: String(Math.floor(Date.now() / 1000) - 100),
        email_verified: "true",
        email: "test@example.com",
        sub: "sub1"
      })
    });
    await expect(verifyGoogleIdToken("dummy", clientId, fakeFetch)).rejects.toThrow(/expired/i);
  });

  it("throws when email is not verified", async () => {
    const fakeFetch: any = async () => ({
      ok: true,
      json: async () => ({
        aud: clientId,
        iss: "https://accounts.google.com",
        exp: String(Math.floor(Date.now() / 1000) + 3600),
        email_verified: "false",
        email: "test@example.com",
        sub: "sub1"
      })
    });
    await expect(verifyGoogleIdToken("dummy", clientId, fakeFetch)).rejects.toThrow(/verified/i);
  });

  it("returns GoogleIdentity when token payload is valid", async () => {
    const fakeFetch: any = async () => ({
      ok: true,
      json: async () => ({
        aud: clientId,
        iss: "https://accounts.google.com",
        exp: String(Math.floor(Date.now() / 1000) + 3600),
        email_verified: "true",
        email: "Owner@Test.Local",
        sub: "sub-123",
        name: "Test Owner"
      })
    });
    const identity = await verifyGoogleIdToken("dummy", clientId, fakeFetch);
    expect(identity).toEqual({
      sub: "sub-123",
      email: "owner@test.local",
      name: "Test Owner"
    });
  });
});

describe("Google Sign-In, Session & Protected Routes", () => {
  const allowed = "allowed@test.local";
  const forbidden = "forbidden@test.local";

  it("returns 403 EMAIL_NOT_ALLOWED for unlisted email or when allowedEmails is empty", async () => {
    const db = createDatabase(":memory:");
    const { server } = await createApiServer({
      db,
      logger: false,
      auth: {
        googleClientId: "test-client",
        allowedEmails: [allowed],
        verifyIdToken: async (cred) => ({
          sub: "sub-forbidden",
          email: forbidden,
          name: "Forbidden User"
        })
      }
    });

    const res = await server.inject({
      method: "POST",
      url: "/api/v1/auth/google",
      payload: { credential: "forbidden-token" }
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("EMAIL_NOT_ALLOWED");

    // Empty allowedEmails should also reject all logins with 403
    const { server: emptyServer } = await createApiServer({
      db: createDatabase(":memory:"),
      logger: false,
      auth: {
        googleClientId: "test-client",
        allowedEmails: [],
        verifyIdToken: async () => ({
          sub: "sub-1",
          email: allowed,
          name: "Allowed User"
        })
      }
    });
    const emptyRes = await emptyServer.inject({
      method: "POST",
      url: "/api/v1/auth/google",
      payload: { credential: "any-token" }
    });
    expect(emptyRes.statusCode).toBe(403);
  });

  it("enforces session authentication on protected /api/v1/ routes", async () => {
    const db = createDatabase(":memory:");
    const { server } = await createApiServer({
      db,
      logger: false,
      auth: {
        googleClientId: "test-client",
        allowedEmails: [allowed],
        verifyIdToken: async () => ({
          sub: "sub-allowed",
          email: allowed,
          name: "Allowed Owner"
        })
      }
    });

    // 1. Without session cookie -> 401
    const unauthedRes = await server.inject({
      method: "GET",
      url: "/api/v1/workspaces"
    });
    expect(unauthedRes.statusCode).toBe(401);

    // 2. Successful login -> Set-Cookie & 200
    const loginRes = await server.inject({
      method: "POST",
      url: "/api/v1/auth/google",
      payload: { credential: "valid-token" }
    });
    expect(loginRes.statusCode).toBe(200);
    const setCookie = loginRes.headers["set-cookie"] as string;
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("aso_session=");
    const rawTokenMatch = setCookie.match(/aso_session=([^;]+)/);
    const rawToken = rawTokenMatch ? rawTokenMatch[1] : "";
    expect(rawToken.length).toBeGreaterThan(10);
    // Token plain text must not be in response body
    expect(loginRes.body).not.toContain(rawToken);

    // 3. Request with valid cookie -> 200
    const authedRes = await server.inject({
      method: "GET",
      url: "/api/v1/workspaces",
      headers: { cookie: `aso_session=${rawToken}` }
    });
    expect(authedRes.statusCode).toBe(200);

    // 4. Logout -> invalidates session and expires cookie
    const logoutRes = await server.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: `aso_session=${rawToken}` }
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.headers["set-cookie"]).toContain("Max-Age=0");

    // 5. Subsequent request with the logged-out cookie -> 401
    const afterLogoutRes = await server.inject({
      method: "GET",
      url: "/api/v1/workspaces",
      headers: { cookie: `aso_session=${rawToken}` }
    });
    expect(afterLogoutRes.statusCode).toBe(401);
  });

  it("rejects an expired session token with 401", async () => {
    const db = createDatabase(":memory:");
    const { server } = await createApiServer({
      db,
      logger: false,
      auth: {
        googleClientId: "test-client",
        allowedEmails: [allowed],
        verifyIdToken: async () => ({
          sub: "sub-allowed",
          email: allowed,
          name: "Allowed Owner"
        })
      }
    });

    const loginRes = await server.inject({
      method: "POST",
      url: "/api/v1/auth/google",
      payload: { credential: "valid-token" }
    });
    const setCookie = loginRes.headers["set-cookie"] as string;
    const rawToken = setCookie.match(/aso_session=([^;]+)/)![1];

    // Artificially expire the session in the database
    const record = await (db as any).sessions.findByTokenHash(
      (await import("../../apps/api/src/auth/session.js")).hashSessionToken(rawToken)
    );
    if (record) {
      record.expiresAt = new Date(Date.now() - 60000).toISOString();
    }

    const res = await server.inject({
      method: "GET",
      url: "/api/v1/workspaces",
      headers: { cookie: `aso_session=${rawToken}` }
    });
    expect(res.statusCode).toBe(401);
  });

  it("OPTIONS preflight returns non-wildcard Allow-Origin with Allow-Credentials", async () => {
    const { server } = await createApiServer({ logger: false });
    const res = await server.inject({
      method: "OPTIONS",
      url: "/api/v1/workspaces"
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

