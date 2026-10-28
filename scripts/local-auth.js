// A stand-in for Neon Auth when developing and testing offline: the same open-source
// Better Auth that Neon manages, kept in memory, with Neon's cookie names.
// Never used on Vercel.
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

export function createLocalAuth({ origin, basePath = "/__local-auth" }) {
  // Neon Auth emails reset links; locally the last one is kept here so tests and `npm run dev` can follow it.
  const mail = [];
  const auth = betterAuth({
    secret: "local-development-secret-not-for-production-use",
    baseURL: origin,
    basePath,
    trustedOrigins: [origin],
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: {
      enabled: true, minPasswordLength: 8,
      sendResetPassword: async ({ user, url, token }) => {
        mail.push({ to: user.email, url, token });
        if (!process.env.NODE_TEST_CONTEXT) console.log(`[local auth] password reset link for ${user.email}: ${url}`);
      },
    },
    // Neon Auth's cookies are named __Secure-neon-auth.*; the app's proxy only forwards those.
    advanced: { cookiePrefix: "neon-auth", useSecureCookies: true },
    logger: { level: "error" },
  });
  return { basePath, mail, handler: (request) => auth.handler(request) };
}
