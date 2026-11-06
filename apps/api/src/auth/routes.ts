import { FastifyInstance } from "fastify";
import { IDatabase } from "@aso/database";
import { GoogleIdentity, verifyGoogleIdToken } from "./google.js";
import {
  hashSessionToken,
  generateSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  parseCookies,
  buildSessionCookie,
  buildExpiredSessionCookie
} from "./session.js";

export interface AuthConfig {
  googleClientId: string;
  allowedEmails: string[];
  verifyIdToken?: (credential: string) => Promise<GoogleIdentity>;
}

export async function authRoutes(
  server: FastifyInstance,
  options: { db: IDatabase; authConfig: AuthConfig }
) {
  const { db, authConfig } = options;

  server.get("/api/v1/auth/config", async () => {
    return {
      googleClientId: authConfig.googleClientId
    };
  });

  server.post("/api/v1/auth/google", async (req, reply) => {
    const { credential } = (req.body || {}) as { credential?: string };
    if (!credential) {
      return reply.status(400).send({
        error: { code: "BAD_REQUEST", message: "Google 인증 정보가 필요해요" }
      });
    }

    let identity: GoogleIdentity;
    try {
      if (authConfig.verifyIdToken) {
        identity = await authConfig.verifyIdToken(credential);
      } else {
        identity = await verifyGoogleIdToken(credential, authConfig.googleClientId);
      }
    } catch (err: any) {
      return reply.status(401).send({
        error: { code: "UNAUTHENTICATED", message: err.message || "Google 로그인 인증에 실패했어요" }
      });
    }

    // Check allow-list
    const normalizedAllowed = (authConfig.allowedEmails || [])
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = (identity.email || "").trim().toLowerCase();
    if (normalizedAllowed.length === 0 || !normalizedAllowed.includes(userEmail)) {
      return reply.status(403).send({
        error: { code: "EMAIL_NOT_ALLOWED", message: "허용되지 않은 계정이에요" }
      });
    }

    // Find or create user
    let user = await db.users.findByGoogleSub(identity.sub);
    if (!user) {
      user = await db.users.findByEmail(identity.email);
      if (user) {
        user.googleSub = identity.sub;
      } else {
        user = await db.users.create({
          email: identity.email,
          displayName: identity.name,
          googleSub: identity.sub
        } as any);
      }
    }

    // Ensure projects exist in user's workspaces
    const workspaces = await db.workspaces.listForUser(user.id);
    for (const ws of workspaces) {
      const projs = await db.projects.listForWorkspace(ws.id);
      if (projs.length === 0) {
        await db.projects.create(ws.id, user.id, {
          name: "기본 프로젝트",
          description: "기본 작업 프로젝트",
          source: { type: "local", localPath: process.cwd() },
          defaultRuntime: "local",
          defaultProvider: "auto"
        });
      }
    }

    // Issue session token
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
    await db.sessions.create(user.id, tokenHash, expiresAt);

    reply.header("Set-Cookie", buildSessionCookie(rawToken));
    return reply.status(200).send({ user });
  });

  server.post("/api/v1/auth/logout", async (req, reply) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      await db.sessions.delete(hashSessionToken(token));
    }
    reply.header("Set-Cookie", buildExpiredSessionCookie());
    return reply.status(200).send({ success: true });
  });
}

