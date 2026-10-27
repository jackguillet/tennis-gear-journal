// A stand-in for Neon Auth when developing and testing offline: the same open-source
// Better Auth that Neon manages, kept in memory, with Neon's cookie names.
// Never used on Vercel.
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

export function createLocalAuth({ origin, basePath = "/__local-auth" }) {
  const auth = betterAuth({
    secret: "local-development-secret-not-for-production-use",
    baseURL: origin,
    basePath,
    trustedOrigins: [origin],
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    // Neon Auth's cookies are named __Secure-neon-auth.*; the app's proxy only forwards those.
    advanced: { cookiePrefix: "neon-auth", useSecureCookies: true },
    logger: { level: "error" },
  });
  return { basePath, handler: (request) => auth.handler(request) };
}
