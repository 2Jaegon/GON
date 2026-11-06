export type GoogleIdentity = { sub: string; email: string; name: string | null };

export class AuthError extends Error {
  constructor(message: string, public code: string = "AUTH_ERROR") {
    super(message);
    this.name = "AuthError";
  }
}

export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
  fetchFn: typeof fetch = fetch
): Promise<GoogleIdentity> {
  if (!credential) {
    throw new AuthError("Credential is required", "INVALID_CREDENTIAL");
  }

  const res = await fetchFn(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) {
    throw new AuthError("Failed to verify Google ID token", "TOKEN_VERIFICATION_FAILED");
  }

  const payload = await res.json();

  if (payload.aud !== clientId) {
    throw new AuthError("Client ID mismatch", "AUDIENCE_MISMATCH");
  }

  const validIssuers = ["accounts.google.com", "https://accounts.google.com"];
  if (!validIssuers.includes(payload.iss)) {
    throw new AuthError("Invalid issuer", "INVALID_ISSUER");
  }

  const expSec = Number(payload.exp);
  if (isNaN(expSec) || expSec * 1000 <= Date.now()) {
    throw new AuthError("Token has expired", "TOKEN_EXPIRED");
  }

  if (payload.email_verified !== "true" && payload.email_verified !== true) {
    throw new AuthError("Email is not verified", "EMAIL_NOT_VERIFIED");
  }

  return {
    sub: payload.sub,
    email: String(payload.email || "").toLowerCase(),
    name: payload.name || null
  };
}

