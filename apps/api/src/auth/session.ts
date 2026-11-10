import crypto from "node:crypto";

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export const SESSION_COOKIE_NAME = "aso_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 604800 seconds (7 days)

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) {
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

export function buildSessionCookie(token: string, isSecure = (process.env.NODE_ENV === "production" || process.env.WEB_ORIGIN?.startsWith("https"))): string {
  const sameSite = isSecure ? "SameSite=None; Secure" : "SameSite=Lax";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; ${sameSite}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function buildExpiredSessionCookie(isSecure = (process.env.NODE_ENV === "production" || process.env.WEB_ORIGIN?.startsWith("https"))): string {
  const sameSite = isSecure ? "SameSite=None; Secure" : "SameSite=Lax";
  return `${SESSION_COOKIE_NAME}=; HttpOnly; ${sameSite}; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

