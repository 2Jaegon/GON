import { createApiServer, ApiServerOptions } from "../../../apps/api/src/server.js";
import { GoogleIdentity } from "../../../apps/api/src/auth/google.js";
import { createDatabase } from "@aso/database";

export const TEST_ALLOWED_EMAIL = "owner@test.local";
export const TEST_GOOGLE_CLIENT_ID = "test-google-client-id";

export async function createAuthedServer(opts: ApiServerOptions = {}) {
  const db = opts.db || createDatabase(":memory:");
  const fakeIdentity: GoogleIdentity = {
    sub: "test-google-sub-001",
    email: TEST_ALLOWED_EMAIL,
    name: "Owner Test"
  };

  const app = await createApiServer({
    ...opts,
    db,
    auth: {
      googleClientId: TEST_GOOGLE_CLIENT_ID,
      allowedEmails: [TEST_ALLOWED_EMAIL],
      verifyIdToken: async () => fakeIdentity,
      ...(opts.auth || {})
    }
  });

  // Login to obtain authenticated session cookie
  const loginRes = await app.server.inject({
    method: "POST",
    url: "/api/v1/auth/google",
    payload: { credential: "valid-test-credential" }
  });

  const setCookie = loginRes.headers["set-cookie"] as string;
  const cookieMatch = setCookie?.match(/aso_session=([^;]+)/);
  const sessionToken = cookieMatch ? cookieMatch[1] : "";
  const cookieHeader = `aso_session=${sessionToken}`;

  const rawInject = app.server.inject.bind(app.server);
  (app.server as any).inject = (injectOpts: any) => {
    if (typeof injectOpts === "string") {
      injectOpts = { url: injectOpts };
    }
    const headers = {
      ...(injectOpts.headers || {}),
      cookie: injectOpts.headers?.cookie !== undefined ? injectOpts.headers.cookie : cookieHeader
    };
    return rawInject({ ...injectOpts, headers });
  };

  return {
    ...app,
    cookie: cookieHeader,
    sessionToken,
    user: JSON.parse(loginRes.body).user,
    inject: (injectOpts: any) => (app.server as any).inject(injectOpts)
  };
}

