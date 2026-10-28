// Stringbed Meter's GameTime button. A bookmark loads this on stc.gametime.net while the member
// is signed in. It reads the club's own court sheet with the member's session, the same calls
// the GameTime page makes, then:
//   1. shows open courts for a day in a clean, phone-sized view. Tapping one opens GameTime's
//      own booking form for that slot, where the member finishes the booking (and its robot check).
//   2. sends the member's own bookings (from GameTime's "upcoming" list, or the court sheets if
//      that isn't available; never anyone else's) to Stringbed Meter, so they reach the
//      app, the court calendar and the play log.
//   3. lists clinics and events with open spots (sign-up stays on GameTime's event page), and
//      members on GameTime's Available Partners list, filtered by level. The partner list is
//      only shown on the page; it is never sent to Stringbed Meter or stored.
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

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const to24 = (h, m, ap) => ((+h % 12) + (/p/i.test(ap) ? 12 : 0)) * 60 + +m;

  // The member's upcoming bookings from GameTime's own "upcoming" feed (/account/jsonlistupcoming),
  // which is what the dashboard's reminders use. `me` is the member's first name, to leave them
  // out of the partner list. `complete` is false when the feed was cut off by its limit.
  function parseUpcoming(feed, me) {
    const res = (feed && feed.Response) || {}, rows = res.Results || [], out = [];
    for (const r of rows) {
      // Court bookings for tennis, plus classes and events the member is registered for
      // (logged as lesson / drills). Waitlist places and other sports are left out.
      const isClass = r.type !== "booking";
      if (/wait/i.test(String(r.status || "") + " " + String(r.type || ""))) continue;
      if (!isClass && Number(r.sport_id) !== SPORT) continue;
      if (isClass && r.sport_id && Number(r.sport_id) !== SPORT) continue;
      const rid = String(r.booking_id || r.event_instance_id || r.instance_id || r.id || "");
      if (!/^\d{1,12}$/.test(rid)) continue;
      const d = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})/i.exec(r.date || "");
      const t = /(\d{1,2}):(\d{2})\s*(am|pm)\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(r.time || "");
      if (!d || !t) continue;
      const start = to24(t[1], t[2], t[3]);
      let minutes = to24(t[4], t[5], t[6]) - start; if (minutes <= 0) minutes += 1440;
      const players = String(r.players || "").split(",").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
      const mine = me ? players.findIndex((n) => n.toUpperCase().startsWith(me.toUpperCase() + " ")) : 0;
      const others = players.filter((_, i) => i !== (mine >= 0 ? mine : 0));
      out.push({
        bkId: rid, ref: r.conf_id ? String(r.conf_id) : null,
        date: `${d[3]}-${pad(MONTHS.indexOf(d[1].slice(0, 3).toLowerCase()) + 1)}-${pad(d[2])}`, time: hhmm(start), minutes,
        court: decode(r.place) || null, kind: isClass || /lesson|clinic/i.test(r.activity || "") ? "drills" : players.length >= 3 ? "doubles" : "singles",
        note: isClass ? (decode(r.activity || r.title) || null) : others.length ? ("With " + others.join(", ")).slice(0, 200) : null,
      });
    }
    return { bookings: out, complete: Number(res.Total || 0) <= rows.length };
  }
  const upcomingUrl = "/account/jsonlistupcoming?wltext=1&family=member&limit=50&order=asc";

  const decode = (t) => String(t == null ? "" : t).replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").replace(/(,\s*)+$/, "").trim();
  const YOUTH = /\bages?\b|\b(red|orange|green|yellow) ball\b|junior|tiny tots|youth|\bkids?\b|parent\s*\/\s*child|high school/i;

  // Classes and events (clinics, round robins, Men's and Women's Night...) from GameTime's
  // classes list for a date range. Registration itself stays on GameTime's event page.
  const eventsUrl = (from, to) => `/cne/index/listdata?startDay=${from}&endDay=${to}&availType=AVAILABLE`;
  function parseEvents(feed, { adultOnly = true } = {}) {
    const rows = (feed && feed.Response && feed.Response.Results) || [], out = [];
    for (const r of rows) {
      if (Number(r.cancelled) === 1 || !r.year || !r.month || !r.date) continue;
      const title = decode(r.title && r.title.text);
      if (!title || (adultOnly && YOUTH.test(title))) continue;
      const dur = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/.exec(String(r.duration || "")) || [];
      const [taken, cap] = String((r.participants && r.participants.text) || "").split("/").map((x) => parseInt(x, 10));
      out.push({
        id: String(r.event_instance_id || r.row_id), title, date: `${r.year}-${pad(+r.month)}-${pad(+r.date)}`,
        start: (+r.hour || 0) * 60 + (+r.minute || 0), minutes: (+dur[1] || 0) * 60 + (+dur[2] || 0) || null,
        link: (r.title && r.title.link) || (r.availability && r.availability.link) || null,
        full: /full/i.test(String(r.eventStatus || "") + " " + String((r.availability && r.availability.text) || "")),
        spotsLeft: Number.isFinite(cap) && Number.isFinite(taken) ? Math.max(0, cap - taken) : null, cap: Number.isFinite(cap) ? cap : null,
        pros: decode(r.instructors) || null, place: decode(r.place) || null,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.title.localeCompare(b.title));
  }

  // Members who opted in to GameTime's "Available Partners" list. This stays in the member's
  // browser: it is shown in the panel and never sent anywhere.
  const partnersUrl = `/scheduling/gameseeker/rosteravailable/sport/${SPORT}`;
  function levelRange(text) {
    const t = String(text || "");
    const m = /\b([1-6](?:\.[05])?)\s*(?:-|\/|to|or)\s*([1-6](?:\.[05])?)\b/.exec(t) || /\b([1-6]\.[05])\b/.exec(t);
    if (!m) return null;
    const lo = parseFloat(m[1]), hi = parseFloat(m[2] || m[1]);
    return lo >= 1 && hi <= 7 ? [Math.min(lo, hi), Math.max(lo, hi)] : null;
  }
  function parsePartners(html) {
    const out = [];
    for (const chunk of String(html || "").split(/<div class="row (?:even|odd)">/).slice(1)) {
      const labels = [...chunk.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((m) => decode(m[1]));
      const ps = [...chunk.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1]));
      const divs = [...chunk.matchAll(/<div\s+style="font-size:\s*15px;?">([\s\S]*?)<\/div>/g)].map((m) => decode(m[1]));
      const name = labels[0];
      if (!name) continue;
      const notes = divs.length ? divs[divs.length - 1] : "";
      const email = ps.find((p) => /@/.test(p)) || null, phone = ps.find((p) => /\d{3}.*\d{4}/.test(p) && !/@/.test(p)) || null;
      const level = levelRange((labels[1] || "") + " " + notes);
      out.push({ name, level, notes: notes || null, email, phone, singles: /single/i.test(notes), doubles: /double/i.test(notes) });
    }
    return out;
  }

  globalThis.SBM_GT = { openSlots, myBookings, parseUpcoming, parseEvents, parsePartners, levelRange, upcomingUrl, eventsUrl, partnersUrl, bookUrl, sheetUrl, clock, hhmm };

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
    .tabs { display: flex; gap: 4px; margin: 4px 0 12px; border-bottom: 1px solid rgba(128,128,128,.3); }
    .tab { border: 0; background: none; color: inherit; font: 600 15px system-ui, sans-serif; padding: 8px 12px; cursor: pointer; border-bottom: 3px solid transparent; }
    .tab[aria-selected="true"] { border-bottom-color: #1d4f7c; color: #1d4f7c; }
    .item { padding: 10px 0; border-top: 1px solid rgba(128,128,128,.25); }
    .item a.title { color: #1d4f7c; font-weight: 600; text-decoration: none; } .item .meta { font-size: 14px; color: #5b6b7c; margin-top: 2px; }
    .tag { display: inline-block; font: 600 11px system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; background: #e7f3ec; color: #2e7d4f; margin-left: 6px; }
    .tag.full { background: #f3e8e7; color: #b42318; }
    .contact a { color: #1d4f7c; margin-right: 12px; font-size: 14px; }
    input[type=search] { width: 100%; box-sizing: border-box; font: 16px system-ui, sans-serif; padding: 8px 10px; border: 1px solid #d5dce4; border-radius: 8px; margin: 8px 0; background: transparent; color: inherit; }
  </style>
  <div class="wrap"><div class="panel" role="dialog" aria-label="Stringbed Meter for GameTime">
    <header><h1>Seattle Tennis Club</h1><button class="x" id="close" aria-label="Close">\u00d7</button></header>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="courts" aria-selected="true">Courts</button>
      <button class="tab" role="tab" data-tab="events" aria-selected="false">Clinics & events</button>
      <button class="tab" role="tab" data-tab="partners" aria-selected="false">Partners</button>
    </div>
    <section id="tab-courts">
      <p class="muted">Tap a court to open GameTime's booking form for it.</p>
      <div class="row" id="days"></div>
      <div class="row" id="groups" style="margin-top:8px"></div>
      <div id="slots"><p class="muted">Loading\u2026</p></div>
      <h2>Your bookings</h2>
      <div id="mine"><p class="muted">Loading your bookings\u2026</p></div>
    </section>
    <section id="tab-events" hidden>
      <p class="muted">Adult clinics, round robins and club nights for the next four weeks. Tap one to see it and sign up on GameTime.</p>
      <div class="row" id="ev-filter"></div>
      <div id="events"><p class="muted">Loading\u2026</p></div>
    </section>
    <section id="tab-partners" hidden>
      <p class="muted">Members on GameTime's Available Partners list. This list stays on this page; Stringbed Meter doesn't keep it.</p>
      <div class="row" id="pt-level"></div>
      <div class="row" id="pt-type" style="margin-top:8px"></div>
      <input type="search" id="pt-q" placeholder="Search names and notes (e.g. mornings, clay)">
      <div id="partners"><p class="muted">Loading\u2026</p></div>
    </section>
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
    let found = [], scanned = days;
    try {
      // GameTime's own upcoming list: one request, covers every booking ahead.
      const r = await fetch(upcomingUrl, { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("upcoming " + r.status);
      const me = ((/Welcome,\s*([A-Za-z'-]+)/.exec(document.body.innerText || "") || [])[1]) || null;
      const up = parseUpcoming(await r.json(), me);
      found = up.bookings;
      const last = found.length ? found[found.length - 1].date : null;
      // Cancel-sync only covers days the list fully covers.
      scanned = up.complete ? Array.from({ length: 60 }, (_, i) => addDays(today, i)) : Array.from({ length: 60 }, (_, i) => addDays(today, i)).filter((d) => last && d < last);
    } catch {
      // Older or different GameTime set-ups: read the court sheets instead.
      try {
        for (const d of days) for (const [g] of GROUPS) {
          const s = await sheet(d, g);
          for (const b of myBookings(s, d, userId)) if (!found.some((x) => x.bkId === b.bkId)) found.push(b);
        }
      } catch { box.innerHTML = '<p class="err">Couldn\'t read your bookings from GameTime.</p>'; return; }
    }
    found.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const ul = document.createElement("ul");
    for (const b of found) {
      const li = document.createElement("li"), i = days.indexOf(b.date);
      li.textContent = (i >= 0 ? dayName(b.date, i) : dayName(b.date, 9)) + ", " + clock(+b.time.slice(0, 2) * 60 + +b.time.slice(3)) + " \u00b7 " + b.court + " \u00b7 " + b.minutes + " min" + (b.kind === "doubles" ? " \u00b7 doubles" : b.kind === "drills" ? " \u00b7 lesson" : "") + (b.note ? " \u00b7 " + b.note.replace(/^With /, "with ") : "");
      ul.appendChild(li);
    }
    box.textContent = "";
    if (found.length) box.appendChild(ul); else box.innerHTML = '<p class="muted">No upcoming bookings.</p>';
    const note = document.createElement("p"); note.className = "muted"; note.textContent = "Sending to Stringbed Meter\u2026"; box.appendChild(note);
    try {
      const res = await fetch(cfg.api, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ key: cfg.key, days: scanned, bookings: found }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "HTTP " + res.status);
      note.textContent = out.message || "Saved to Stringbed Meter and your court calendar.";
    } catch (e) { note.className = "err"; note.textContent = "Couldn't reach Stringbed Meter: " + e.message; }
  }

  // ---------- tabs ----------
  const loaded = {};
  root.querySelectorAll(".tab").forEach((t) => t.onclick = () => {
    root.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    for (const name of ["courts", "events", "partners"]) $("tab-" + name).hidden = name !== t.dataset.tab;
    if (!loaded[t.dataset.tab]) { loaded[t.dataset.tab] = true; if (t.dataset.tab === "events") loadEvents(); if (t.dataset.tab === "partners") loadPartners(); }
  });
  const getJSON = async (url) => { const r = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } }); if (!r.ok) throw new Error("GameTime said " + r.status); return r.json(); };
  const pref = (k, d) => { try { return localStorage.getItem("sbm-gt-" + k) ?? d; } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem("sbm-gt-" + k, v); } catch {} };

  // ---------- clinics & events ----------
  let events = [], evOpenOnly = pref("ev-open", "1") === "1";
  async function loadEvents() {
    try { events = parseEvents(await getJSON(eventsUrl(today, addDays(today, 28)))).filter((e) => e.date >= today); renderEvents(); }
    catch { $("events").innerHTML = '<p class="err">Couldn\'t load classes and events from GameTime.</p>'; }
  }
  function renderEvents() {
    chips($("ev-filter"), [["1", "Open spots"], ["0", "Everything"]], (v) => (v === "1") === evOpenOnly, (v) => { evOpenOnly = v === "1"; setPref("ev-open", v); renderEvents(); });
    const box = $("events"); box.textContent = "";
    const list = events.filter((e) => !evOpenOnly || !e.full);
    if (!list.length) { box.innerHTML = '<p class="muted">Nothing in the next four weeks' + (evOpenOnly ? " with open spots" : "") + ".</p>"; return; }
    let lastDay = "";
    for (const e of list) {
      if (e.date !== lastDay) { const h = document.createElement("h2"); h.textContent = dayName(e.date, days.indexOf(e.date)); box.appendChild(h); lastDay = e.date; }
      const div = document.createElement("div"); div.className = "item";
      const a = document.createElement("a"); a.className = "title"; a.textContent = e.title; if (e.link) a.href = e.link;
      const tag = document.createElement("span"); tag.className = "tag" + (e.full ? " full" : "");
      tag.textContent = e.full ? "Full" : e.spotsLeft != null ? e.spotsLeft + (e.spotsLeft === 1 ? " spot" : " spots") : "Open";
      const meta = document.createElement("div"); meta.className = "meta";
      meta.textContent = [clock(e.start) + (e.minutes ? "–" + clock(e.start + e.minutes) : ""), e.pros, e.place].filter(Boolean).join(" · ");
      div.append(a, tag, meta); box.appendChild(div);
    }
  }

  // ---------- partners ----------
  let partners = [], ptLevel = pref("pt-level", "any"), ptType = pref("pt-type", "any");
  const LEVELS = [["any", "Any level"], ["3.0", "3.0"], ["3.5", "3.5"], ["4.0", "4.0"], ["4.5", "4.5"], ["5.0", "5.0+"]];
  async function loadPartners() {
    try {
      const r = await fetch(partnersUrl, { credentials: "same-origin" });
      if (!r.ok) throw new Error(String(r.status));
      partners = parsePartners(await r.text()); renderPartners();
    } catch { $("partners").innerHTML = '<p class="err">Couldn\'t load the partner list from GameTime.</p>'; }
  }
  function renderPartners() {
    chips($("pt-level"), LEVELS, (v) => v === ptLevel, (v) => { ptLevel = v; setPref("pt-level", v); renderPartners(); });
    chips($("pt-type"), [["any", "Singles or doubles"], ["singles", "Mentions singles"], ["doubles", "Mentions doubles"]], (v) => v === ptType, (v) => { ptType = v; setPref("pt-type", v); renderPartners(); });
    const q = $("pt-q").value.trim().toLowerCase(), want = ptLevel === "any" ? null : parseFloat(ptLevel);
    const list = partners.filter((p) =>
      (want == null || (p.level && (want >= 5 ? p.level[1] >= 5 : p.level[0] <= want && p.level[1] >= want))) &&
      (ptType === "any" || p[ptType]) &&
      (!q || (p.name + " " + (p.notes || "")).toLowerCase().includes(q)));
    const box = $("partners"); box.textContent = "";
    const n = document.createElement("p"); n.className = "muted"; n.textContent = list.length + " of " + partners.length + " members" + (want != null ? " (only those who list a level)" : ""); box.appendChild(n);
    for (const p of list) {
      const div = document.createElement("div"); div.className = "item";
      const b = document.createElement("b"); b.textContent = p.name.replace(/\b([A-Z])([A-Z']+)/g, (_, a, r) => a + r.toLowerCase());
      if (p.level) { const t = document.createElement("span"); t.className = "tag"; t.textContent = p.level[0] === p.level[1] ? p.level[0].toFixed(1) : p.level[0].toFixed(1) + "–" + p.level[1].toFixed(1); b.appendChild(t); }
      div.appendChild(b);
      if (p.notes) { const m = document.createElement("div"); m.className = "meta"; m.textContent = p.notes; div.appendChild(m); }
      const c = document.createElement("div"); c.className = "contact";
      if (p.email) { const a = document.createElement("a"); a.href = "mailto:" + p.email; a.textContent = "Email"; c.appendChild(a); }
      if (p.phone) { const digits = p.phone.replace(/[^\d+]/g, ""); const a = document.createElement("a"); a.href = "sms:" + digits; a.textContent = "Text"; const t = document.createElement("a"); t.href = "tel:" + digits; t.textContent = "Call"; c.append(a, t); }
      if (c.childNodes.length) div.appendChild(c);
      box.appendChild(div);
    }
  }
  $("pt-q").addEventListener("input", () => renderPartners());

  renderChips(); renderSlots(); scanMine();
})();
