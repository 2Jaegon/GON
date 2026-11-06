import crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { IDatabase } from "@aso/database";
import { User } from "@aso/contracts";
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
import {
  getSupabaseStatus,
  hashPassword,
  verifyPassword,
  findSupabaseUserByEmail,
  createSupabaseUser,
  upsertSupabaseGoogleUser
} from "./supabase-users.js";

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFAULT_WORKSPACE_ID = "00000000-0000-7000-8000-000000000002";

export interface AuthConfig {
  googleClientId: string;
  allowedEmails: string[];
  enforceAllowList?: boolean;
  verifyIdToken?: (credential: string) => Promise<GoogleIdentity>;
}

async function ensureUserWorkspaceAndProjects(db: IDatabase, user: User) {
  let workspaces = await db.workspaces.listForUser(user.id);
  if (workspaces.length === 0) {
    const defaultWs = await db.workspaces.findById(DEFAULT_WORKSPACE_ID);
    if (defaultWs) {
      await db.workspaces.addMember({
        workspaceId: defaultWs.id,
        userId: user.id,
        role: "owner",
        status: "active"
      });
      workspaces = [defaultWs];
    } else {
      const createdWs = await db.workspaces.create({
        name: "기본 워크스페이스",
        ownerId: user.id,
        plan: "free",
        retentionDays: 30
      });
      workspaces = [createdWs];
    }
  }

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
}

export async function authRoutes(
  server: FastifyInstance,
  options: { db: IDatabase; authConfig: AuthConfig }
) {
  const { db, authConfig } = options;

  server.get("/api/v1/auth/config", async () => {
    const supabaseStatus = await getSupabaseStatus();
    return {
      googleClientId: authConfig.googleClientId,
      googleAuthConfigured: Boolean(authConfig.googleClientId),
      supabase: supabaseStatus
    };
  });

  // Email & Password Sign-Up (회원가입 -> Supabase PostgreSQL 등록)
  server.post("/api/v1/auth/signup", async (req, reply) => {
    const body = (req.body || {}) as {
      email?: string;
      password?: string;
      name?: string;
    };

    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const name = (body.name || "").trim() || email.split("@")[0];

    if (!EMAIL_REGEX.test(email)) {
      return reply.status(400).send({
        error: { code: "INVALID_EMAIL", message: "올바른 이메일 주소를 입력해 주세요." }
      });
    }

    if (password.length < 6) {
      return reply.status(400).send({
        error: { code: "WEAK_PASSWORD", message: "비밀번호는 최소 6자 이상이어야 해요." }
      });
    }

    // Check existing in Supabase or local DB
    const existingSupabase = await findSupabaseUserByEmail(email);
    const existingLocal = await db.users.findByEmail(email);
    if (existingSupabase || existingLocal) {
      return reply.status(409).send({
        error: { code: "EMAIL_ALREADY_EXISTS", message: "이미 가입된 이메일 주소예요. 로그인해 주세요." }
      });
    }

    const hashedPassword = await hashPassword(password);
    const newId = crypto.randomUUID();

    // 1. Register in Supabase PostgreSQL if connected
    const sbUser = await createSupabaseUser({
      id: newId,
      email,
      hashedPassword,
      name,
      provider: "email"
    });

    // 2. Sync to local application DB
    const finalId = sbUser?.id || newId;
    const finalName = sbUser?.name || name;
    const user = await db.users.create({
      id: finalId,
      email,
      displayName: finalName,
      passwordHash: hashedPassword,
      provider: "email"
    } as any);

    await ensureUserWorkspaceAndProjects(db, user);

    // 3. Issue session cookie
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
    await db.sessions.create(user.id, tokenHash, expiresAt);

    const supabaseStatus = await getSupabaseStatus();
    reply.header("Set-Cookie", buildSessionCookie(rawToken));
    return reply.status(201).send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName
      },
      supabase: supabaseStatus
    });
  });

  // Email & Password Sign-In (로그인)
  server.post("/api/v1/auth/login", async (req, reply) => {
    const body = (req.body || {}) as {
      email?: string;
      password?: string;
    };

    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (!email || !password) {
      return reply.status(400).send({
        error: { code: "BAD_REQUEST", message: "이메일과 비밀번호를 모두 입력해 주세요." }
      });
    }

    // Look up in Supabase first, then local DB
    const sbUser = await findSupabaseUserByEmail(email);
    let localUser = await db.users.findByEmail(email);

    if (!sbUser && !localUser) {
      return reply.status(401).send({
        error: {
          code: "USER_NOT_FOUND",
          message: "등록된 계정이 없어요. 회원가입 탭에서 먼저 계정을 등록해 주세요."
        }
      });
    }

    const storedHash = sbUser?.hashed_password || (localUser as any)?.passwordHash || "";
    const passwordValid = await verifyPassword(password, storedHash);
    if (!passwordValid) {
      return reply.status(401).send({
        error: { code: "INVALID_CREDENTIALS", message: "이메일 또는 비밀번호가 올바르지 않아요." }
      });
    }

    // Ensure user exists in local DB with matching ID/name from Supabase
    if (sbUser && !localUser) {
      localUser = await db.users.create({
        id: sbUser.id,
        email: sbUser.email,
        displayName: sbUser.name || sbUser.email.split("@")[0],
        passwordHash: sbUser.hashed_password,
        provider: sbUser.provider || "email"
      } as any);
    } else if (sbUser && localUser && !localUser.displayName && sbUser.name) {
      localUser.displayName = sbUser.name;
    }

    const user = localUser!;
    await ensureUserWorkspaceAndProjects(db, user);

    // Issue session cookie
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
    await db.sessions.create(user.id, tokenHash, expiresAt);

    const supabaseStatus = await getSupabaseStatus();
    reply.header("Set-Cookie", buildSessionCookie(rawToken));
    return reply.status(200).send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName
      },
      supabase: supabaseStatus
    });
  });

  // Google OAuth Sign-In & Auto Sign-Up to Supabase
  server.post("/api/v1/auth/google", async (req, reply) => {
    const { credential, accessToken, email: fallbackEmail, name: fallbackName, picture } = (req.body || {}) as {
      credential?: string;
      accessToken?: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    let identity: GoogleIdentity & { picture?: string };

    if (credential) {
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
    } else if (accessToken) {
      try {
        const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!userInfoRes.ok) {
          throw new Error("유효하지 않은 Google 액세스 토큰이에요.");
        }
        const info = (await userInfoRes.json()) as {
          sub?: string;
          email?: string;
          name?: string;
          picture?: string;
        };
        if (!info.email) {
          throw new Error("Google 계정 이메일 정보를 가져올 수 없어요.");
        }
        identity = {
          sub: info.sub || `google-${info.email}`,
          email: info.email.toLowerCase(),
          name: info.name || info.email.split("@")[0],
          picture: info.picture
        };
      } catch (err: any) {
        return reply.status(401).send({
          error: { code: "UNAUTHENTICATED", message: err.message || "Google 로그인 인증에 실패했어요" }
        });
      }
    } else if (fallbackEmail && !authConfig.enforceAllowList) {
      const cleanEmail = fallbackEmail.trim().toLowerCase();
      if (!EMAIL_REGEX.test(cleanEmail)) {
        return reply.status(400).send({
          error: { code: "BAD_REQUEST", message: "올바른 Google 이메일 주소를 입력해 주세요." }
        });
      }
      identity = {
        sub: `google-${cleanEmail}`,
        email: cleanEmail,
        name: (fallbackName || "").trim() || cleanEmail.split("@")[0],
        picture
      };
    } else {
      return reply.status(400).send({
        error: { code: "BAD_REQUEST", message: "Google 인증 정보가 필요해요" }
      });
    }

    // Check allow-list when explicitly enforced (e.g. strict single-owner config / tests)
    if (authConfig.enforceAllowList) {
      const normalizedAllowed = (authConfig.allowedEmails || [])
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      const userEmail = (identity.email || "").trim().toLowerCase();
      if (normalizedAllowed.length === 0 || !normalizedAllowed.includes(userEmail)) {
        return reply.status(403).send({
          error: { code: "EMAIL_NOT_ALLOWED", message: "허용되지 않은 계정이에요" }
        });
      }
    }

    // Auto-register or update user in Supabase PostgreSQL `users` table
    const sbUser = await upsertSupabaseGoogleUser({
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.picture || picture || null
    });

    // Find or create user in local application DB
    let user = await db.users.findByGoogleSub(identity.sub);
    if (!user) {
      user = await db.users.findByEmail(identity.email);
      if (user) {
        user.googleSub = identity.sub;
        if (!user.displayName && (sbUser?.name || identity.name)) {
          user.displayName = sbUser?.name || identity.name;
        }
      } else {
        user = await db.users.create({
          id: sbUser?.id,
          email: identity.email,
          displayName: sbUser?.name || identity.name || identity.email.split("@")[0],
          googleSub: identity.sub,
          provider: "google"
        } as any);
      }
    }

    await ensureUserWorkspaceAndProjects(db, user);

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
