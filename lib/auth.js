import { createHmac, createHash, timingSafeEqual } from "node:crypto";

// A single owner signs in with APP_PASSCODE. The session is a signed cookie, so no session table is needed.
const COOKIE = "sbm_session";
const DAYS = 365;

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!process.env.APP_PASSCODE) throw new Error("APP_PASSCODE is not set.");
  // Changing the passcode signs out every device.
  return createHash("sha256").update("stringbed-session:" + process.env.APP_PASSCODE).digest("hex");
}

const sign = (value) => createHmac("sha256", secret()).update(value).digest("base64url");

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passcodeMatches(given) {
  const want = process.env.APP_PASSCODE;
  if (!want) throw new Error("APP_PASSCODE is not set.");
  const h = (s) => createHash("sha256").update(String(s)).digest();
  return timingSafeEqual(h(given), h(want));
}

export function sessionCookie() {
  const exp = String(Date.now() + DAYS * 864e5);
  const token = exp + "." + sign(exp);
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function isSignedIn(request) {
  const header = request.headers.get("cookie") || "";
  const m = header.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m) return false;
  const [exp, mac] = m[1].split(".");
  if (!exp || !mac || !safeEqual(mac, sign(exp))) return false;
  return Number(exp) > Date.now();
}
