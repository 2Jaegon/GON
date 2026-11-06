import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

export interface SupabaseUserRow {
  id: string;
  email: string;
  hashed_password: string | null;
  name: string | null;
  avatar_url: string | null;
  provider: string | null;
  created_at: Date | string | null;
}

export interface SupabaseStatusInfo {
  mode: "supabase" | "local";
  is_supabase: boolean;
  project_ref: string;
  host: string;
  message: string;
}

let pool: pg.Pool | null = null;
let initialized = false;
let supabaseAvailable = false;
let statusMessage = "로컬 스토리지 모드로 동작 중이에요.";

function getResolvedDatabaseUrl(): string {
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url || url.includes("[YOUR-PASSWORD]") || url.includes("aso:aso_dev_password@localhost")) {
    return "";
  }
  return url;
}

export function isSupabaseConfigured(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  return Boolean(getResolvedDatabaseUrl());
}

async function getPool(): Promise<pg.Pool | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (pool && initialized) {
    return supabaseAvailable ? pool : null;
  }
  const dbUrl = getResolvedDatabaseUrl();
  if (!dbUrl) return null;

  try {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1")
        ? undefined
        : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        hashed_password VARCHAR(255),
        name VARCHAR(100),
        avatar_url VARCHAR(500),
        provider VARCHAR(50) DEFAULT 'email',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    initialized = true;
    supabaseAvailable = true;
    const projectRef = process.env.SUPABASE_PROJECT_REF || "wdnyhnfooqmqlgtrdshn";
    statusMessage = `Supabase PostgreSQL (${projectRef})에 연결되었어요.`;
    return pool;
  } catch (err: any) {
    initialized = true;
    supabaseAvailable = false;
    statusMessage = `Supabase 연결 실패로 로컬 DB 사용 중: ${err?.message || "연결 오류"}`;
    return null;
  }
}

export async function getSupabaseStatus(): Promise<SupabaseStatusInfo> {
  const p = await getPool();
  const projectRef = process.env.SUPABASE_PROJECT_REF || "wdnyhnfooqmqlgtrdshn";
  return {
    mode: p ? "supabase" : "local",
    is_supabase: Boolean(p),
    project_ref: projectRef,
    host: "aws-0-ap-northeast-2.pooler.supabase.com",
    message: statusMessage
  };
}

export async function hashPassword(password: string): Promise<string> {
  const rounds = process.env.NODE_ENV === "test" ? 6 : 12;
  const salt = await bcrypt.genSalt(rounds);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  if (!plainPassword || !hashedPassword) return false;
  try {
    return await bcrypt.compare(plainPassword, hashedPassword);
  } catch {
    return false;
  }
}

export async function findSupabaseUserByEmail(email: string): Promise<SupabaseUserRow | null> {
  const p = await getPool();
  if (!p) return null;
  try {
    const res = await p.query<SupabaseUserRow>(
      "SELECT id, email, hashed_password, name, avatar_url, provider, created_at FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email.trim().toLowerCase()]
    );
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

export async function createSupabaseUser(params: {
  id?: string;
  email: string;
  hashedPassword: string;
  name?: string | null;
  avatarUrl?: string | null;
  provider?: "email" | "google";
}): Promise<SupabaseUserRow | null> {
  const p = await getPool();
  if (!p) return null;

  const id = params.id || crypto.randomUUID();
  const normalizedEmail = params.email.trim().toLowerCase();
  const displayName = params.name?.trim() || normalizedEmail.split("@")[0];
  const provider = params.provider || "email";
  const now = new Date();

  const res = await p.query<SupabaseUserRow>(
    `INSERT INTO users (id, email, hashed_password, name, avatar_url, provider, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, hashed_password, name, avatar_url, provider, created_at`,
    [id, normalizedEmail, params.hashedPassword, displayName, params.avatarUrl || null, provider, now]
  );
  return res.rows[0] || null;
}

export async function upsertSupabaseGoogleUser(params: {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}): Promise<SupabaseUserRow | null> {
  const p = await getPool();
  if (!p) return null;

  const normalizedEmail = params.email.trim().toLowerCase();
  const existing = await findSupabaseUserByEmail(normalizedEmail);
  if (existing) {
    const nextName = existing.name || params.name?.trim() || normalizedEmail.split("@")[0];
    const nextAvatar = existing.avatar_url || params.avatarUrl || null;
    if (nextName !== existing.name || nextAvatar !== existing.avatar_url) {
      try {
        const updated = await p.query<SupabaseUserRow>(
          `UPDATE users SET name = $1, avatar_url = $2 WHERE id = $3
           RETURNING id, email, hashed_password, name, avatar_url, provider, created_at`,
          [nextName, nextAvatar, existing.id]
        );
        if (updated.rows[0]) return updated.rows[0];
      } catch {
        // ignore update error and return existing
      }
    }
    return existing;
  }

  const randomPasswordHash = await hashPassword(crypto.randomUUID());
  return createSupabaseUser({
    email: normalizedEmail,
    hashedPassword: randomPasswordHash,
    name: params.name?.trim() || normalizedEmail.split("@")[0],
    avatarUrl: params.avatarUrl || null,
    provider: "google"
  });
}

