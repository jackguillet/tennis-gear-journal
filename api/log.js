import { db } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";
import { userForToken } from "../lib/tokens.js";
import { getState, PLAY_KINDS } from "../lib/store.js";
import { callTool } from "../lib/assistant.js";

// Quick log: log a session in one tap, without opening the app. The link is a "log" link made in
// the app (Account tab); it can add and undo play sessions and nothing else.
//   https://<site>/api/log/<secret>     (vercel.json rewrites it to /api/log?token=<secret>)
//
//   GET   a small page with big buttons (type, time, racket). Safari can add it to the Home Screen.
//   POST  form fields or JSON { kind, minutes | hours, racket?, date? }  -> logs it
//         { undo: "<session id>" }                                        -> removes it
//   An iPhone Shortcut ("Get Contents of URL", method POST, JSON body) gets a one-line answer
//   back as plain text to show; the page gets a page.

const KINDS = [["singles", "Singles"], ["doubles", "Doubles"], ["hitting", "Hitting"], ["drills", "Lesson / drills"], ["ball_machine", "Ball machine"], ["serves", "Serves"]];
const TIMES = [[60, "1 h"], [90, "1.5 h"], [120, "2 h"], [45, "45 min"], [30, "30 min"], [180, "3 h"]];
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function secretFrom(request) {
  const url = new URL(request.url);
  const fromPath = url.pathname.startsWith("/api/log/") ? decodeURIComponent(url.pathname.slice("/api/log/".length)) : null;
  return fromPath || url.searchParams.get("token");
}

function page(title, inner, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Log play">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<title>${esc(title)}</title>
<style>
:root { --bg:#eef1f4; --panel:#fff; --ink:#142233; --muted:#5b6b7c; --line:#d5dce4; --court:#1d4f7c; --good:#2e7d4f; --bad:#b3261e; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#0e1620; --panel:#16212d; --ink:#e6edf4; --muted:#95a6b8; --line:#2a3a4b; --court:#6aa8de; --good:#5fc48a; --bad:#ef7d74; } }
* { box-sizing: border-box; } body { margin:0; background:var(--bg); color:var(--ink); font:17px/1.45 system-ui,-apple-system,sans-serif; padding: calc(16px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom)); }
main { max-width: 480px; margin: 0 auto; display:flex; flex-direction:column; gap:16px; }
h1 { font-size: 24px; margin: 0; } p { margin: 0; } .muted { color: var(--muted); font-size: 15px; }
fieldset { border:0; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:8px; } legend { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin-bottom:6px; }
label.pick input { position:absolute; opacity:0; } label.pick span { display:inline-block; padding:10px 14px; border-radius:999px; border:1px solid var(--line); background:var(--panel); font-weight:600; min-height:44px; }
label.pick input:checked + span { background:var(--court); border-color:var(--court); color:var(--panel); } label.pick input:focus-visible + span { outline:3px solid var(--court); outline-offset:2px; }
select, button { font: inherit; } select { width:100%; padding:12px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:var(--ink); }
button { padding:14px; border-radius:12px; border:1px solid var(--court); background:var(--court); color:var(--panel); font-weight:700; min-height:52px; width:100%; }
button.ghost { background:transparent; color:var(--court); } .ok { color: var(--good); font-weight:600; } .err { color: var(--bad); font-weight:600; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:12px; }
a { color: var(--court); }
</style></head><body><main>${inner}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

function form(rackets, chosen = {}) {
  const list = Object.entries(rackets).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const recent = list.map(([id, r]) => [id, (r.plays || []).reduce((m, p) => (p.d > m ? p.d : m), r.strungOn || "")]).sort((a, b) => b[1].localeCompare(a[1]))[0];
  const pick = chosen.racket || (recent && recent[0]);
  const radios = (name, items, sel) => items.map(([v, l]) => `<label class="pick"><input type="radio" name="${name}" value="${esc(v)}"${String(v) === String(sel) ? " checked" : ""}><span>${esc(l)}</span></label>`).join("");
  return `<form method="post" class="card">
  <fieldset><legend>Type of play</legend>${radios("kind", KINDS, chosen.kind || "singles")}</fieldset>
  <fieldset><legend>Time</legend>${radios("minutes", TIMES, chosen.minutes || 90)}</fieldset>
  ${list.length > 1 ? `<label><span class="muted">Racket</span><select name="racket">${list.map(([id, r]) => `<option value="${esc(id)}"${id === pick ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>` : ""}
  <button type="submit">Log it</button>
</form>`;
}

async function read(request) {
  const type = request.headers.get("content-type") || "";
  const text = (await request.text()).slice(0, 4096);
  if (type.includes("application/json")) { try { return { body: JSON.parse(text || "{}"), json: true }; } catch { return { body: {}, json: true }; } }
  return { body: Object.fromEntries(new URLSearchParams(text)), json: false };
}

async function handle(request) {
  let store, user;
  try {
    store = db(); await ensureSchema(store);
    user = await userForToken(store, secretFrom(request), "log");
  } catch (e) { console.error(e); return page("Not ready", `<p class="err">The server isn't ready. Try again in a minute.</p>`, 503); }
  const wantsText = request.method === "POST" && !(request.headers.get("accept") || "").includes("text/html") && !(request.headers.get("content-type") || "").includes("form");
  if (!user) {
    const msg = "This quick-log link isn't valid. Make a new one in Stringbed Meter, under Account.";
    return wantsText ? new Response(msg, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } }) : page("Link not valid", `<h1>Link not valid</h1><p>${msg}</p>`, 404);
  }
  if (request.method === "GET") {
    const { rackets } = await getState(store, user.id);
    if (!Object.keys(rackets).length) return page("Log play", `<h1>Log play</h1><p>Add a racket in Stringbed Meter first.</p>`);
    return page("Log play", `<h1>Log play</h1><p class="muted">Pick what you played and tap Log it. Add this page to your Home Screen for a one-tap shortcut.</p>${form(rackets)}`);
  }
  const { body, json } = await read(request);
  const reply = (status, text, html) => (wantsText || json ? new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }) : page("Log play", html, status));
  if (body.undo) {
    const out = await callTool(store, user, "delete_session", { session_id: String(body.undo) });
    const text = out.content[0].text.split("\n\n")[0];
    return reply(out.isError ? 400 : 200, text, `<h1>${out.isError ? "Couldn't undo" : "Removed"}</h1><p>${esc(text)}</p><a href="">Log another session</a>`);
  }
  const args = { kind: body.kind };
  if (body.minutes !== undefined && body.minutes !== "") args.minutes = Number(body.minutes);
  else if (body.hours !== undefined && body.hours !== "") args.hours = Number(body.hours);
  if (body.racket) args.racket = String(body.racket);
  if (body.date) args.date = String(body.date);
  if (!PLAY_KINDS.includes(args.kind)) args.kind = "singles";
  const out = await callTool(store, user, "log_play", args);
  const text = out.content[0].text.split("\n\n")[0];
  if (out.isError) return reply(400, text, `<h1>Not logged</h1><p class="err">${esc(text)}</p><a href="">Try again</a>`);
  const id = out.structuredContent.session_id;
  return reply(200, text, `<h1>Logged</h1><p class="ok">${esc(text)}</p>
<form method="post"><input type="hidden" name="undo" value="${esc(id)}"><button class="ghost" type="submit">Undo</button></form>
<a href="">Log another session</a>`);
}

export const GET = handle, POST = handle;
