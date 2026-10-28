// Stringbed Meter's GameTime button. A bookmark loads this on stc.gametime.net while the member
// is signed in. It reads the club's own court sheet with the member's session, the same calls
// the GameTime page makes, then:
//   1. shows open courts for a day in a clean, phone-sized view. Tapping one opens GameTime's
//      own booking form for that slot, where the member finishes the booking (and its robot check).
//   2. sends the member's own bookings (never anyone else's) to Stringbed Meter, so they reach the
//      app, the court calendar and the play log.
// It never books, changes or cancels anything in GameTime. It is a classic script (not a module)
// so it loads from another site without CORS. Tests load it in a sandbox and use SBM_GT.
(function () {
  "use strict";
  const SPORT = 2; // tennis
  const GROUPS = [["2", "Indoor"], ["3", "Outdoor"], ["4", "Pro & clay"]];
  const DAYS_AHEAD = 7;

  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (min) => pad(Math.floor(min / 60)) + ":" + pad(min % 60);
  const clock = (min) => { const h = Math.floor(min / 60), m = min % 60; return (h % 12 || 12) + (m ? ":" + pad(m) : "") + (h < 12 ? " am" : " pm"); };
  const overlaps = (a, al, b, bl) => a < b + bl && b < a + al;

  // Open slots on one day's sheet. Each court lists bookable windows (start, length, slot step)
  // and its bookings; a slot is open when nothing overlaps it. Past slots are left out when
  // `nowMin` (minutes after midnight, club time) is given.
  function openSlots(sheet, { nowMin = -1 } = {}) {
    const out = [];
    for (const c of (sheet && sheet.e) || []) {
      const booked = (c.b || []).map((b) => [Number(b.t), Number(b.d)]);
      for (const w of c.t || []) {
        const step = Number(w.i) || 60;
        for (let s = Number(w.t); s + step <= Number(w.t) + Number(w.d); s += step) {
          if (s < nowMin) continue;
          if (booked.some(([t, d]) => overlaps(s, step, t, d))) continue;
          out.push({ court: c.n, courtId: String(c.i), start: s, minutes: step, peak: w.e === "Peak" });
        }
      }
    }
    return out.sort((a, b) => a.start - b.start || a.court.localeCompare(b.court, undefined, { numeric: true }));
  }

  // The member's own bookings on one day's sheet: ones they made (b.e) or play in.
  function myBookings(sheet, date, userId) {
    const me = Number(userId), out = [];
    for (const c of (sheet && sheet.e) || []) {
      for (const b of c.b || []) {
        const players = b.p || [];
        if (Number(b.e) !== me && !players.some((p) => Number(p.u) === me)) continue;
        const n = players.length;
        const kind = b.j || /lesson|clinic|drill/i.test(b.l || "") ? "drills" : n >= 3 ? "doubles" : "singles";
        const others = players.filter((p) => Number(p.u) !== me).map((p) => p.n).filter(Boolean);
        out.push({
          bkId: String(b.bkId), ref: b.f || b.c ? String(b.f || b.c) : null, date, time: hhmm(Number(b.t)), minutes: Number(b.d),
          court: c.n, kind, note: [b.l, b.j, others.length ? "With " + others.join(", ") : null].filter(Boolean).join(" \u00b7 ").slice(0, 200) || null,
        });
      }
    }
    return out;
  }

  const bookUrl = (courtId, date, start) => `/scheduling/index/book/sport/${SPORT}/court/${courtId}/date/${date}/time/${start}`;
  const sheetUrl = (date, group) => `/scheduling/index/jsoncourtdata/sport/${SPORT}/date/${date}?group=${group}`;

  globalThis.SBM_GT = { openSlots, myBookings, bookUrl, sheetUrl, clock, hhmm };

  // ---------- the panel (only on GameTime, launched from the bookmark) ----------
  const cfg = typeof window !== "undefined" ? window.__sbmGT : null;
  if (!cfg) return;
  if (!/(^|\.)gametime\.net$/.test(location.hostname)) {
    alert("Open stc.gametime.net and sign in, then tap the Stringbed Meter button again.");
    return;
  }
  const html = document.documentElement.innerHTML;
  const userId = (/setUserId\((\d+)\)/.exec(html) || [])[1] || null;
  if (document.getElementById("sbm-gt-host")) { document.getElementById("sbm-gt-host").remove(); }

  const clubToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const clubNowMin = () => { const p = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Los_Angeles", hour12: false }).split(":"); return +p[0] * 60 + +p[1]; };
  const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const dayName = (d, i) => i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  const cache = new Map();
  async function sheet(date, group) {
    const k = date + "/" + group;
    if (!cache.has(k)) {
      cache.set(k, fetch(sheetUrl(date, group), { credentials: "same-origin", headers: { accept: "application/json" } }).then((r) => {
        if (!r.ok) throw new Error("GameTime said " + r.status);
        return r.json();
      }).catch((e) => { cache.delete(k); throw e; }));
    }
    return cache.get(k);
  }

  const host = document.createElement("div"); host.id = "sbm-gt-host";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host { all: initial; }
    .wrap { position: fixed; inset: 0; background: rgba(10,20,30,.45); display: flex; justify-content: center; font: 16px/1.4 -apple-system, system-ui, sans-serif; }
    .panel { background: #fff; color: #142233; width: 100%; max-width: 480px; height: 100%; overflow: auto; -webkit-overflow-scrolling: touch; padding: 14px 16px 40px; box-sizing: border-box; }
    @media (prefers-color-scheme: dark) { .panel { background: #0e1620; color: #e6edf3; } .chip { border-color: #2a3a4c !important; color: #e6edf3 !important; } .slot { border-color: #2a3a4c !important; } .muted { color: #93a4b6 !important; } }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    h1 { font-size: 20px; margin: 0; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .07em; margin: 18px 0 8px; color: #5b6b7c; }
    .x { border: 0; background: none; font-size: 28px; line-height: 1; color: inherit; cursor: pointer; padding: 4px 8px; }
    .row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
    .chip { flex: none; border: 1px solid #d5dce4; background: none; color: #142233; border-radius: 999px; padding: 7px 12px; font: 600 14px system-ui, sans-serif; cursor: pointer; }
    .chip[aria-pressed="true"] { background: #1d4f7c; border-color: #1d4f7c; color: #fff !important; }
    .time { display: grid; grid-template-columns: 76px 1fr; gap: 8px; align-items: start; padding: 8px 0; border-top: 1px solid rgba(128,128,128,.25); }
    .time b { font-variant-numeric: tabular-nums; padding-top: 6px; } .time small { display: block; color: #b7791f; font-weight: 600; font-size: 11px; }
    .courts { display: flex; flex-wrap: wrap; gap: 6px; }
    .slot { border: 1px solid #d5dce4; border-radius: 8px; padding: 6px 10px; text-decoration: none; color: #1d4f7c; font-weight: 600; font-size: 15px; }
    .muted { color: #5b6b7c; font-size: 14px; } .err { color: #b42318; font-size: 14px; }
    ul { list-style: none; margin: 0; padding: 0; } li { padding: 6px 0; border-top: 1px solid rgba(128,128,128,.25); font-size: 15px; }
  </style>
  <div class="wrap"><div class="panel" role="dialog" aria-label="Open courts">
    <header><h1>Open courts</h1><button class="x" id="close" aria-label="Close">\u00d7</button></header>
    <p class="muted">Tap a court to open GameTime's booking form for it.</p>
    <div class="row" id="days"></div>
    <div class="row" id="groups" style="margin-top:8px"></div>
    <div id="slots"><p class="muted">Loading\u2026</p></div>
    <h2>Your bookings</h2>
    <div id="mine"><p class="muted">Looking through the next ${DAYS_AHEAD} days\u2026</p></div>
  </div></div>`;
  document.body.appendChild(host);
  const $ = (id) => root.getElementById(id);
  $("close").onclick = () => host.remove();
  root.querySelector(".wrap").addEventListener("click", (e) => { if (e.target.classList.contains("wrap")) host.remove(); });

  const today = clubToday();
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));
  let day = days[0], groups = new Set(GROUPS.map(([g]) => g));

  function chips(box, items, isOn, onTap) {
    box.textContent = "";
    for (const [value, label] of items) {
      const b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.textContent = label;
      b.setAttribute("aria-pressed", String(isOn(value))); b.onclick = () => onTap(value); box.appendChild(b);
    }
  }
  function renderChips() {
    chips($("days"), days.map((d, i) => [d, dayName(d, i)]), (d) => d === day, (d) => { day = d; renderChips(); renderSlots(); });
    chips($("groups"), GROUPS, (g) => groups.has(g), (g) => { if (groups.has(g) && groups.size > 1) groups.delete(g); else groups.add(g); renderChips(); renderSlots(); });
  }

  let renderSeq = 0;
  async function renderSlots() {
    const seq = ++renderSeq, box = $("slots");
    box.innerHTML = '<p class="muted">Loading\u2026</p>';
    try {
      const sheets = await Promise.all([...groups].map((g) => sheet(day, g)));
      if (seq !== renderSeq) return;
      // Each court once, even if two areas' sheets list it.
      const seen = new Set();
      const slots = sheets.flatMap((s) => openSlots(s, { nowMin: day === today ? clubNowMin() : -1 }))
        .filter((s) => { const k = s.courtId + "@" + s.start; if (seen.has(k)) return false; seen.add(k); return true; });
      box.textContent = "";
      if (!slots.length) { box.innerHTML = '<p class="muted">No open courts that day in these areas.</p>'; return; }
      const byTime = new Map();
      for (const s of slots) { if (!byTime.has(s.start)) byTime.set(s.start, []); byTime.get(s.start).push(s); }
      for (const [start, list] of [...byTime].sort((a, b) => a[0] - b[0])) {
        const row = document.createElement("div"); row.className = "time";
        const t = document.createElement("b"); t.textContent = clock(start);
        if (list.some((s) => s.peak)) { const p = document.createElement("small"); p.textContent = "PEAK"; t.appendChild(p); }
        const courts = document.createElement("div"); courts.className = "courts";
        for (const s of list) {
          const a = document.createElement("a"); a.className = "slot"; a.href = bookUrl(s.courtId, day, s.start);
          a.textContent = s.court.replace(/^Court\s*/i, "Ct ") + " \u00b7 " + s.minutes + "m";
          courts.appendChild(a);
        }
        row.append(t, courts); box.appendChild(row);
      }
    } catch (e) {
      if (seq === renderSeq) box.innerHTML = '<p class="err">Couldn\'t read the court sheet. Make sure you are signed in to GameTime, then try again.</p>';
    }
  }

  // Look through the coming days for the member's own bookings, one request at a time, and
  // send them to Stringbed Meter.
  async function scanMine() {
    const box = $("mine");
    if (!userId) { box.innerHTML = '<p class="muted">Sign in to GameTime to see your bookings.</p>'; return; }
    const found = [];
    try {
      for (const d of days) for (const [g] of GROUPS) {
        const s = await sheet(d, g);
        for (const b of myBookings(s, d, userId)) if (!found.some((x) => x.bkId === b.bkId)) found.push(b);
      }
    } catch { box.innerHTML = '<p class="err">Couldn\'t read your bookings from GameTime.</p>'; return; }
    const ul = document.createElement("ul");
    for (const b of found) {
      const li = document.createElement("li");
      li.textContent = dayName(b.date, days.indexOf(b.date)) + ", " + clock(+b.time.slice(0, 2) * 60 + +b.time.slice(3)) + " \u00b7 " + b.court + " \u00b7 " + (b.minutes) + " min" + (b.kind === "doubles" ? " \u00b7 doubles" : b.kind === "drills" ? " \u00b7 lesson" : "");
      ul.appendChild(li);
    }
    box.textContent = "";
    if (found.length) box.appendChild(ul); else box.innerHTML = '<p class="muted">No bookings in the next ' + DAYS_AHEAD + " days.</p>";
    const note = document.createElement("p"); note.className = "muted"; note.textContent = "Sending to Stringbed Meter\u2026"; box.appendChild(note);
    try {
      const res = await fetch(cfg.api, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ key: cfg.key, days, bookings: found }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "HTTP " + res.status);
      note.textContent = out.message || "Saved to Stringbed Meter and your court calendar.";
    } catch (e) { note.className = "err"; note.textContent = "Couldn't reach Stringbed Meter: " + e.message; }
  }

  renderChips(); renderSlots(); scanMine();
})();
