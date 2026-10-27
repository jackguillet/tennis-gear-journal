import { createAuthServer, extractNeonAuthCookies, handleAuthProxyRequest } from "@neondatabase/auth/server";

// Accounts are Neon Auth (managed Better Auth). The browser only ever talks to this app's
// own /api/auth/*, which forwards to Neon Auth. That keeps the session cookies first-party,
// which iPhone Safari needs.
//
//   NEON_AUTH_BASE_URL       the branch's Neon Auth URL (written by `neon deploy` / `neon env pull`)
//   NEON_AUTH_COOKIE_SECRET  32+ random characters, signs the cached session cookie (yours to set)

function config() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl) throw new Error("NEON_AUTH_BASE_URL is not set. Enable Neon Auth (`auth: true` in neon.ts, then `neon deploy`).");
  if (!cookieSecret || cookieSecret.length < 32) throw new Error("NEON_AUTH_COOKIE_SECRET must be at least 32 characters (openssl rand -base64 32).");
  return { baseUrl: baseUrl.replace(/\/$/, ""), cookieSecret, sameSite: "lax" };
}

// Forward one /api/auth/<path> request to Neon Auth.
export function proxyAuth(request, path) {
  return handleAuthProxyRequest({ request, path, ...config() });
}

// The signed-in user for this request, or null. `cookies` collects any refreshed
// session cookies, which the caller adds to its response.
export async function currentUser(request, cookies = []) {
  const server = createAuthServer({
    ...config(),
    context: () => ({
      getCookies: () => extractNeonAuthCookies(request.headers.get("cookie") || ""),
      setCookie: (name, value, options) => cookies.push({ name, value, ...options }),
      getHeader: (name) => request.headers.get(name),
      getOrigin: () => request.headers.get("origin") || new URL(request.url).origin,
      getFramework: () => "vercel",
    }),
  });
  const { data, error } = await server.getSession();
  if (error || !data || !data.user) return null;
  return { id: String(data.user.id), email: data.user.email || null, name: data.user.name || null };
}
