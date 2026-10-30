// Stringbed Meter's GameTime button. A bookmark loads this on stc.gametime.net while the member
// is signed in. It reads the club's own court sheet with the member's session, the same calls
// the GameTime page makes, then:
//   1. shows open courts for a day in a clean, phone-sized view. Tapping one opens GameTime's
//      own booking form for that slot, where the member finishes the booking (and its robot check).
//   2. sends the member's own bookings (from GameTime's "upcoming" list, or the court sheets if
//      that isn't available; never anyone else's) to Stringbed Meter, so they reach the
//      app, the court calendar and the play log.
//   3. lists clinics and events with open spots (sign-up stays on GameTime's event page), lesson
//      time the pros hold on the court sheet, the court waitlist, and members on GameTime's
//      Available Partners list, filtered by level. The partner list and the waitlist are only
//      shown on the page; they are never sent to Stringbed Meter or stored.
// On the club site (seattletennisclub.org) the same button shows dinner times after the member's
// court bookings, read from the club's own dining page with the member's session.
// It never books, changes or cancels anything in GameTime or on the club site. It is a classic script (not a module)
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

  // Lesson time a pro holds on the court sheet: GameTime's "Lesson" / "Lesson Available" blocks
  // carry the pro's name (b.j) and nobody has booked into them yet.
  const proName = (j) => decode(j).replace(/\(\s*pro\s*\)/i, " ").replace(/\s+/g, " ").trim().toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, c) => a + c.toUpperCase());
  function parseLessons(sheet, date) {
    const out = [];
    for (const c of (sheet && sheet.e) || []) {
      for (const b of c.b || []) {
        if (!b.j || (b.p && b.p.length) || b.f || b.e) continue;
        out.push({ pro: proName(b.j), date, start: Number(b.t), minutes: Number(b.d), court: c.n, courtId: String(c.i) });
      }
    }
    return out.sort((a, b) => a.start - b.start || a.pro.localeCompare(b.pro));
  }

  // GameTime's court waitlist page: one row per group waiting for a court to free up.
  const waitlistUrl = `/scheduling/waitlist/index/sport/${SPORT}`;
  const waitlistJoinUrl = `/scheduling/waitlist/new/sport/${SPORT}`;
  function parseWaitlist(html) {
    const out = [];
    for (const chunk of String(html || "").split(/<tr id="row_\d+">/).slice(1)) {
      const tds = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (tds.length < 6) continue;
      const d = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})/i.exec(decode(tds[2]));
      const t = /(\d{1,2}):(\d{2})\s*(am|pm)\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(decode(tds[3]));
      if (!d || !t) continue;
      const start = to24(t[1], t[2], t[3]);
      let end = to24(t[4], t[5], t[6]); if (end <= start) end += 1440;
      out.push({
        date: `${d[3]}-${pad(MONTHS.indexOf(d[1].slice(0, 3).toLowerCase()) + 1)}-${pad(d[2])}`, start, minutes: Math.min(end, 1440) - start,
        players: tds[0].split(/<br\s*\/?>/i).map((x) => decode(x).replace(/,$/, "").trim()).filter(Boolean),
        courts: decode(tds[5]).split(/\s*,\s*/).filter(Boolean),
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  }

  // ---------- the club site's dining reservations (Jonas Clubhouse Online) ----------
  const DINING_API = "/api/v1/dining/";
  const DINING_PAGE = "/CMSModules/CHO/DiningReservations/Dining.aspx";
  // The club writes its own wall-clock times as if they were GMT, e.g. "Wed, 28 Oct 2026 17:00:00 GMT".
  const jonasDate = (date, min = 0) => date.replace(/-/g, "") + "T" + pad(Math.floor(min / 60)) + pad(min % 60) + "00";
  function wallDate(v) {
    const m = /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i.exec(String(v || ""));
    return m ? `${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}` : null;
  }
  function wallMin(v) {
    const s = String(v == null ? "" : v), m = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:GMT|Z|$)/i.exec(s) || /T(\d{2}):?(\d{2})/.exec(s);
    return m ? +m[1] * 60 + +m[2] : null;
  }
  const diningDates = (list) => (Array.isArray(list) ? list : []).map(wallDate).filter(Boolean);
  function parseDiningSlots(list) {
    return (Array.isArray(list) ? list : []).filter((s) => s && String(s.available) !== "False").map((s) => {
      const v = /^(\d{1,2})(\d{2})$/.exec(String(s.value24 || ""));
      return { min: v ? +v[1] * 60 + +v[2] : wallMin(s.valueJSFriendly), label: s.value || null };
    }).filter((s) => s.min != null).sort((a, b) => a.min - b.min);
  }
  // GetAvailability answers per facility (Canoe Club, Club Grill) with the times it can seat the party.
  function parseAvailability(list, facilities) {
    const names = new Map((facilities || []).map((f) => [String(f.id), f.description]));
    return (Array.isArray(list) ? list : []).map((f) => ({
      facility: names.get(String(f.facilityID)) || "Dining room",
      times: [...new Set((f.availableTimes || []).map((t) => wallMin(t.dateTimeJS || t.dateTime || t.time)).filter((x) => x != null))].sort((a, b) => a - b),
      note: f.restrictionMessage ? decode(f.restrictionMessage) : null,
    }));
  }
  // When the member is done on court each day (club time), from the bookings Stringbed Meter has.
  function playDays(bookings, tz = "America/Los_Angeles") {
    const days = new Map();
    for (const b of bookings || []) {
      const end = new Date(Number(b.start) + Number(b.minutes) * 60000);
      const date = end.toLocaleDateString("en-CA", { timeZone: tz });
      const [h, m] = end.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false }).split(":");
      const min = +h * 60 + +m, prev = days.get(date);
      if (!prev || min > prev.end) days.set(date, { date, end: min, court: b.court || null });
    }
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---------- regular weekly times ----------
  const AREA_GROUPS = { indoor: ["2"], outdoor: ["3"], clay: ["4"], any: ["2", "3", "4"] };
  const addDay = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const dowOf = (d) => new Date(d + "T12:00:00Z").getUTCDay();
  // The day a regular time can be booked now and the next one that hasn't opened yet. `nowMin` (minutes
  // into the club's day) drops today's when it has already started.
  // GameTime opens each court time `days` days before it ends, on the club's clock (a Friday 2:15 to
  // 3:30 pm court opens at 3:30 pm the Friday before). `opens` is when `next` opens: a date and minute.
  function planDays(plan, today, nowMin = -1, days = 7) {
    let d = addDay(today, (plan.dow - dowOf(today) + 7) % 7);
    const startMin = +plan.time.slice(0, 2) * 60 + +plan.time.slice(3, 5), end = startMin + (Number(plan.min) || 60);
    if (d === today && startMin <= nowMin) d = addDay(d, 7);
    const ahead = Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
    const open = (ahead - days) * 1440 + end <= nowMin;
    const next = open ? addDay(d, 7) : d;
    return { bookable: open ? d : null, next, opens: { date: addDay(next, Math.floor(end / 1440) - days), min: end % 1440 } };
  }
  // Open slots for a regular time, best first: the favourite court at (or near) the time, then the backup
  // courts in order ("Court 15, Court 14"), then any court in the area, nearest start first. Only starts
  // within `within` minutes count.
  function pickSlots(slots, startMin, court, within = 90, backups = "") {
    const order = [court].concat(String(backups || "").split(",")).map((c) => String(c || "").replace(/\D/g, "")).filter(Boolean);
    const rank = (name) => { const i = order.indexOf(name.replace(/\D/g, "")); return i < 0 ? 0 : (i - order.length) * 1000; };
    return slots.filter((x) => Math.abs(x.start - startMin) <= within)
      .map((x) => ({ ...x, score: Math.abs(x.start - startMin) + rank(x.court) }))
      .sort((a, b) => a.score - b.score || a.court.localeCompare(b.court, undefined, { numeric: true }));
  }
  // GameTime's "Booking Not Available" page, in a sentence (it ends before "Time:" or "Court Time:").
  function bookError(html) {
    const t = decode(String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " "));
    const m = /Booking Not Available\s*(.*?)(?:\b(?:Court )?Time:|Copyright|$)/i.exec(t);
    return m ? m[1].trim().slice(0, 300) || "Booking not available." : null;
  }
  // What that sentence says about the window: "not allowed to book more than 7 days in advance. Please
  // wait for 12 minute(s)." gives { days: 7, wait: 12 }. Either can be null.
  function bookLimit(text) {
    const s = String(text || ""), d = /more than (\d+) days? in advance/i.exec(s), w = /wait for (\d+) minute/i.exec(s);
    return d || w ? { days: d ? +d[1] : null, wait: w ? +w[1] : null } : null;
  }
  // One day's sheet as a grid: a column per court, a row per slot time, each cell open, booked, the
  // member's own, a lesson, a club event or closed (outside the court's bookable hours).
  function sheetGrid(sheets, userId, { nowMin = -1 } = {}) {
    const me = Number(userId), courts = [], seen = new Set(), times = new Set();
    for (const sh of sheets || []) for (const c of (sh && sh.e) || []) {
      if (seen.has(String(c.i))) continue; seen.add(String(c.i));
      const slots = new Map();
      for (const w of c.t || []) { const step = Number(w.i) || 60; for (let t = Number(w.t); t + step <= Number(w.t) + Number(w.d); t += step) slots.set(t, step); }
      courts.push({ name: c.n, id: String(c.i), slots, bookings: c.b || [] });
      for (const t of slots.keys()) times.add(t);
    }
    courts.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const rows = [...times].sort((a, b) => a - b).map((t) => ({
      start: t,
      cells: courts.map((c) => {
        const step = c.slots.get(t);
        if (!step) return { state: "closed" };
        const b = c.bookings.find((x) => overlaps(t, step, Number(x.t), Number(x.d)));
        if (!b) return { state: t < nowMin ? "past" : "open", minutes: step };
        const mine = Number(b.e) === me || (b.p || []).some((p) => Number(p.u) === me);
        return { state: mine ? "mine" : b.j ? "lesson" : b.m || b.l ? "event" : "booked", minutes: step };
      }),
    }));
    return { courts: courts.map((c) => ({ name: c.name, id: c.id })), rows };
  }
  // The free slots on a day's sheets, without anything about who booked the rest: what the button
  // saves to the app so it (and a chat assistant) can say what's open.
  function freeSlots(sheets) {
    const seen = new Set();
    return (sheets || []).flatMap((sh) => openSlots(sh)).filter((x) => { const k = x.courtId + "@" + x.start; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((x) => ({ c: x.court, i: x.courtId, t: x.start, d: x.minutes }));
  }

  globalThis.SBM_GT = {
    sheetGrid, freeSlots,
    planDays, pickSlots, bookError, bookLimit,
    openSlots, myBookings, parseUpcoming, parseEvents, parsePartners, levelRange, parseLessons, parseWaitlist,
    jonasDate, wallMin, diningDates, parseDiningSlots, parseAvailability, playDays,
    upcomingUrl, eventsUrl, partnersUrl, waitlistUrl, bookUrl, sheetUrl, clock, hhmm,
  };

  // ---------- the panel (only on GameTime, launched from the bookmark) ----------
  const cfg = typeof window !== "undefined" ? window.__sbmGT : null;
  if (!cfg) return;
  const onClubSite = /(^|\.)seattletennisclub\.org$/.test(location.hostname);
  if (!onClubSite && !/(^|\.)gametime\.net$/.test(location.hostname)) {
    alert("Open stc.gametime.net (courts) or seattletennisclub.org (dining) and sign in, then tap the Tennis Hub button again.");
    return;
  }
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

  const STYLE = `<style>
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
    .tabs { display: flex; gap: 4px; overflow-x: auto; margin: 4px 0 12px; border-bottom: 1px solid rgba(128,128,128,.3); }
    .tab { flex: none; border: 0; background: none; color: inherit; font: 600 15px system-ui, sans-serif; padding: 8px 12px; cursor: pointer; border-bottom: 3px solid transparent; }
    .tab[aria-selected="true"] { border-bottom-color: #1d4f7c; color: #1d4f7c; }
    .item { padding: 10px 0; border-top: 1px solid rgba(128,128,128,.25); }
    .item a.title { color: #1d4f7c; font-weight: 600; text-decoration: none; } .item .meta { font-size: 14px; color: #5b6b7c; margin-top: 2px; }
    .tag { display: inline-block; font: 600 11px system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; background: #e7f3ec; color: #2e7d4f; margin-left: 6px; }
    .tag.full { background: #f3e8e7; color: #b42318; }
    .contact a { color: #1d4f7c; margin-right: 12px; font-size: 14px; }
    input[type=search] { width: 100%; box-sizing: border-box; font: 16px system-ui, sans-serif; padding: 8px 10px; border: 1px solid #d5dce4; border-radius: 8px; margin: 8px 0; background: transparent; color: inherit; }
  </style>`;
  // A full-screen panel in a shadow root, so GameTime's and the club site's styles don't leak in.
  function mount(inner) {
    const host = document.createElement("div"); host.id = "sbm-gt-host";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = STYLE + inner;
    document.body.appendChild(host);
    root.getElementById("close").onclick = () => host.remove();
    root.querySelector(".wrap").addEventListener("click", (e) => { if (e.target.classList.contains("wrap")) host.remove(); });
    return root;
  }
  function chips(box, items, isOn, onTap) {
    box.textContent = "";
    for (const [value, label] of items) {
      const b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.textContent = label;
      b.setAttribute("aria-pressed", String(isOn(value))); b.onclick = () => onTap(value); box.appendChild(b);
    }
  }
  const getJSON = async (url) => { const r = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } }); if (!r.ok) throw new Error("said " + r.status); return r.json(); };
  const pref = (k, d) => { try { return localStorage.getItem("sbm-gt-" + k) ?? d; } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem("sbm-gt-" + k, v); } catch {} };
  const today = clubToday();
  const dayLabel = (d) => { const i = Math.round((Date.parse(d) - Date.parse(today)) / 86400000); return dayName(d, i >= 0 && i < 2 ? i : 9); };

  if (onClubSite) { dining(); return; }

  const html = document.documentElement.innerHTML;
  const userId = (/setUserId\((\d+)\)/.exec(html) || [])[1] || null;
  const root = mount(`
  <div class="wrap"><div class="panel" role="dialog" aria-label="Tennis Hub for GameTime">
    <header><h1>Seattle Tennis Club</h1><button class="x" id="close" aria-label="Close">\u00d7</button></header>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="courts" aria-selected="true">Courts</button>
      <button class="tab" role="tab" data-tab="lessons" aria-selected="false">Lessons</button>
      <button class="tab" role="tab" data-tab="events" aria-selected="false">Clinics & events</button>
      <button class="tab" role="tab" data-tab="waitlist" aria-selected="false">Waitlist</button>
      <button class="tab" role="tab" data-tab="partners" aria-selected="false">Partners</button>
    </div>
    <section id="tab-courts">
      <p id="too-soon" class="err" hidden></p>
      <p class="muted">Tap a court to open GameTime's booking form for it.</p>
      <div class="row" id="views" style="margin-bottom:8px"></div>
      <div class="row" id="days"></div>
      <div class="row" id="groups" style="margin-top:8px"></div>
      <div id="slots"><p class="muted">Loading\u2026</p></div>
      <div id="plans-box" hidden><h2>Your regular times</h2><div id="plans"></div></div>
      <h2>Your bookings</h2>
      <div id="mine"><p class="muted">Loading your bookings\u2026</p></div>
      <p class="muted">Dinner after tennis: tap this button on seattletennisclub.org while signed in.</p>
    </section>
    <section id="tab-lessons" hidden>
      <p class="muted">Lesson time the pros are holding on the court sheet this week. Book it with the pro or the Pro Shop, <a href="tel:+12063245454">(206) 324-5454</a>.</p>
      <div class="row" id="ls-pro"></div>
      <div id="lessons"><p class="muted">Loading\u2026</p></div>
    </section>
    <section id="tab-waitlist" hidden>
      <p class="muted">Groups waiting for a court to free up. When a court is cancelled, GameTime offers it to the first group whose players all pass the booking rules. <a href="${waitlistJoinUrl}">Join the waitlist</a></p>
      <div id="waitlist"><p class="muted">Loading\u2026</p></div>
    </section>
    <section id="tab-events" hidden>
      <p class="muted">Adult clinics, round robins and club nights for the next four weeks. Tap one to see it and sign up on GameTime.</p>
      <div class="row" id="ev-filter"></div>
      <div id="events"><p class="muted">Loading\u2026</p></div>
    </section>
    <section id="tab-partners" hidden>
      <p class="muted">Members on GameTime's Available Partners list. This list stays on this page; Tennis Hub doesn't keep it.</p>
      <div class="row" id="pt-level"></div>
      <div class="row" id="pt-type" style="margin-top:8px"></div>
      <input type="search" id="pt-q" placeholder="Search names and notes (e.g. mornings, clay)">
      <div id="partners"><p class="muted">Loading\u2026</p></div>
    </section>
  </div></div>`);
  const $ = (id) => root.getElementById(id);
  // Tapped on GameTime's "Booking Not Available" page: say when that court opens.
  if (/bookerror/.test(location.pathname)) {
    const lim = bookLimit(bookError(document.body ? document.body.innerHTML : ""));
    if (lim && lim.wait != null) {
      const at = Math.round((clubNowMin() + lim.wait) / 5) * 5 % 1440;
      $("too-soon").textContent = "Too early: that court opens at about " + clock(at) + " (in " + lim.wait + " min). GameTime opens each court time " + (lim.days || 7) + " days before it ends. Go back and try again then.";
      $("too-soon").hidden = false;
    }
  }

  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));
  let day = days[0], groups = new Set(GROUPS.map(([g]) => g));

  let view = pref("view", "list");
  function renderChips() {
    chips($("views"), [["list", "Open courts"], ["grid", "Everything (grid)"]], (v) => v === view, (v) => { view = v; setPref("view", v); renderChips(); renderSlots(); });
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
      if (view === "grid") { renderGrid(box, sheets); return; }
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

  // Every court and time at once: what's open (tap to book), taken, yours, a lesson or a club event.
  const CELL = { open: ["#e7f3ec", "#2e7d4f", ""], booked: ["#e4e7eb", "#5b6b7c", ""], mine: ["#1d4f7c", "#fff", "You"], lesson: ["#f4f1d9", "#7a6a12", "L"], event: ["#f3e8e7", "#9a3b30", "E"], past: ["transparent", "#93a4b6", ""], closed: ["transparent", "", ""] };
  function renderGrid(box, sheets) {
    const g = sheetGrid(sheets, userId, { nowMin: day === today ? clubNowMin() : -1 });
    box.textContent = "";
    if (!g.courts.length) { box.innerHTML = '<p class="muted">No courts on the sheet that day.</p>'; return; }
    const key = document.createElement("p"); key.className = "muted"; key.style.fontSize = "12px";
    key.innerHTML = '<span style="color:#2e7d4f">\u25a0</span> open (tap to book) \u00a0<span style="color:#9aa5b1">\u25a0</span> taken \u00a0<span style="color:#1d4f7c">\u25a0</span> yours \u00a0L lesson \u00a0E club event';
    box.appendChild(key);
    const wrap = document.createElement("div"); wrap.style.cssText = "overflow-x:auto;-webkit-overflow-scrolling:touch";
    const tbl = document.createElement("table"); tbl.style.cssText = "border-collapse:separate;border-spacing:2px;font:12px system-ui,sans-serif";
    const hr = document.createElement("tr"); hr.appendChild(document.createElement("th"));
    for (const c of g.courts) { const th = document.createElement("th"); th.textContent = c.name.replace(/^Court\s*/i, ""); th.style.cssText = "font-weight:600;padding:2px;min-width:30px"; hr.appendChild(th); }
    tbl.appendChild(hr);
    for (const r of g.rows) {
      if (r.cells.every((c) => c.state === "closed" || c.state === "past")) continue;
      const tr = document.createElement("tr");
      const th = document.createElement("th"); th.textContent = clock(r.start); th.style.cssText = "text-align:right;font-weight:600;padding:0 4px;white-space:nowrap;position:sticky;left:0;background:inherit"; tr.appendChild(th);
      r.cells.forEach((c, i) => {
        const td = document.createElement("td"), [bg, fg, label] = CELL[c.state];
        td.style.cssText = `background:${bg};color:${fg};height:26px;min-width:30px;border-radius:5px;text-align:center;font-weight:600`;
        if (c.state === "open") { const a = document.createElement("a"); a.href = bookUrl(g.courts[i].id, day, r.start); a.setAttribute("aria-label", "Book " + g.courts[i].name + " at " + clock(r.start)); a.style.cssText = "display:block;height:26px;text-decoration:none"; td.appendChild(a); }
        else td.textContent = label;
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    }
    wrap.appendChild(tbl); box.appendChild(wrap);
  }

  // The coming week's free slots (free or taken only, no names) go to the app, so it and a chat
  // assistant can say what's open. At most every 20 minutes, one sheet at a time.
  async function saveOpenCourts() {
    try { if (Date.now() - Number(localStorage.getItem("sbm-gt-open-at") || 0) < 20 * 60000) return; } catch {}
    const out = [];
    for (const d of days) {
      const sheets = [];
      for (const [g] of GROUPS) { try { sheets.push(await sheet(d, g)); } catch { return; } }
      out.push({ date: d, slots: freeSlots(sheets).filter((x) => d !== today || x.t > clubNowMin()) });
    }
    const r = await fetch(cfg.api, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ key: cfg.key, open: { at: Date.now(), days: out } }) }).catch(() => null);
    if (r && r.ok) try { localStorage.setItem("sbm-gt-open-at", String(Date.now())); } catch {}
  }

  // Look through the coming days for the member's own bookings, one request at a time, and
  // send them to Stringbed Meter.
  // The member's full name as GameTime writes it on bookings ("JACKSON GUILLET"), to spot them on the waitlist.
  let myName = null;
  function fullName(feed, me) {
    if (!me) return null;
    for (const r of (feed && feed.Response && feed.Response.Results) || []) {
      const n = String(r.players || "").split(",").map((x) => x.replace(/\s+/g, " ").trim()).find((x) => x.toUpperCase().startsWith(me.toUpperCase() + " "));
      if (n) return n.toUpperCase();
    }
    return null;
  }
  async function scanMine() {
    const box = $("mine");
    if (!userId) { box.innerHTML = '<p class="muted">Sign in to GameTime to see your bookings.</p>'; return; }
    let found = [], scanned = days;
    try {
      // GameTime's own upcoming list: one request, covers every booking ahead.
      const r = await fetch(upcomingUrl, { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("upcoming " + r.status);
      const me = ((/Welcome,\s*([A-Za-z'-]+)/.exec(document.body.innerText || "") || [])[1]) || null;
      const feed = await r.json();
      const up = parseUpcoming(feed, me);
      myName = fullName(feed, me);
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
    const note = document.createElement("p"); note.className = "muted"; note.textContent = "Sending to Tennis Hub\u2026"; box.appendChild(note);
    try {
      const res = await fetch(cfg.api, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ key: cfg.key, days: scanned, bookings: found }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "HTTP " + res.status);
      note.textContent = out.message || "Saved to Tennis Hub and your court calendar.";
      renderPlans(out.plans || [], out.window, found);
    } catch (e) { note.className = "err"; note.textContent = "Couldn't reach Tennis Hub: " + e.message; }
  }

  // ---------- regular times: book the next one in one tap ----------
  // How many days ahead GameTime opens a court time, read from its refusal: the button opens the booking
  // form (without booking) for a slot 8 days out, which is always too far, and reads "not allowed to
  // book more than N days in advance". Remembered for a day.
  async function probeWindow() {
    try { const c = JSON.parse(localStorage.getItem("sbm-gt-probe2") || "null"); if (c && Date.now() - c.at < 864e5) return c; } catch {}
    const out = { at: Date.now(), days: null, message: null };
    try {
      const d = addDays(today, 8), s = await sheet(d, "2");
      const court = ((s && s.e) || [])[0], w = court && (court.t || [])[0];
      if (w) {
        const r = await fetch(bookUrl(court.i, d, Number(w.t)), { credentials: "same-origin" });
        if (/bookerror/.test(r.url)) { out.message = bookError(await r.text()); out.days = (bookLimit(out.message) || {}).days || null; }
      }
      localStorage.setItem("sbm-gt-probe2", JSON.stringify(out));
    } catch {}
    return out;
  }

  async function renderPlans(plans, win, mine) {
    if (!plans.length) return;
    $("plans-box").hidden = false;
    const box = $("plans"); box.innerHTML = '<p class="muted">Checking GameTime\u2026</p>';
    const probe = await probeWindow();
    if (probe.days && (!win || probe.days !== win.days || !win.set)) {
      fetch(cfg.api, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ key: cfg.key, window: { days: probe.days } }) }).catch(() => {});
    }
    const days = probe.days || (win && win.days) || 7;
    const opensAt = (o) => dayLabel(o.date).replace(/^(Today|Tomorrow)$/, (x) => x.toLowerCase()) + " at " + clock(o.min);
    box.textContent = "";
    for (const p of plans) {
      const div = document.createElement("div"); div.className = "item";
      const startMin = +p.time.slice(0, 2) * 60 + +p.time.slice(3, 5);
      const head = document.createElement("b");
      head.textContent = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.dow] + " " + clock(startMin) + " \u00b7 " + p.min + " min" + (p.court ? " \u00b7 " + p.court : p.area !== "any" ? " \u00b7 " + ({ indoor: "indoor", outdoor: "outdoor", clay: "pro & clay" })[p.area] : "");
      div.appendChild(head);
      if (p.note || p.backups) { const m = document.createElement("div"); m.className = "meta"; m.textContent = [p.note, p.backups && "if taken: " + p.backups].filter(Boolean).join(" \u00b7 "); div.appendChild(m); }
      if (p.paused) { const m = document.createElement("div"); m.className = "meta"; m.textContent = "Paused. Resume it in Tennis Hub."; div.appendChild(m); box.appendChild(div); continue; }
      const { bookable, next, opens } = planDays(p, today, clubNowMin(), days);
      const line = document.createElement("div"); line.className = "courts"; line.style.marginTop = "6px"; div.appendChild(line);
      const later = document.createElement("div"); later.className = "meta";
      later.textContent = "Next: " + dayLabel(next) + ", opens " + opensAt(opens) + ".";
      box.appendChild(div);
      if (!bookable) { line.remove(); div.appendChild(later); continue; }
      const booked = mine.some((b) => b.date === bookable && Math.abs(+b.time.slice(0, 2) * 60 + +b.time.slice(3) - startMin) <= 90);
      const lbl = document.createElement("span"); lbl.className = "muted"; lbl.textContent = dayLabel(bookable) + ": "; line.appendChild(lbl);
      if (booked) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "Booked"; line.appendChild(t); div.appendChild(later); continue; }
      try {
        const sheets = await Promise.all((AREA_GROUPS[p.area] || AREA_GROUPS.any).map((g) => sheet(bookable, g)));
        const seen = new Set();
        const open = sheets.flatMap((s) => openSlots(s, { nowMin: bookable === today ? clubNowMin() : -1 }))
          .filter((x) => { const k = x.courtId + "@" + x.start; if (seen.has(k)) return false; seen.add(k); return true; });
        const best = pickSlots(open, startMin, p.court, 90, p.backups);
        if (!best.length) {
          const t = document.createElement("span"); t.className = "muted"; t.textContent = "nothing open near " + clock(startMin) + ". ";
          const a = document.createElement("a"); a.href = waitlistJoinUrl; a.textContent = "Join the waitlist"; line.append(t, a);
        } else {
          best.slice(0, 4).forEach((x, i) => {
            const a = document.createElement("a"); a.className = "slot"; a.href = bookUrl(x.courtId, bookable, x.start);
            a.textContent = (i === 0 ? "Book " : "") + x.court.replace(/^Court\s*/i, "Ct ") + " \u00b7 " + clock(x.start);
            if (i === 0) { a.style.background = "#1d4f7c"; a.style.color = "#fff"; a.style.borderColor = "#1d4f7c"; }
            line.appendChild(a);
          });
        }
      } catch { const t = document.createElement("span"); t.className = "err"; t.textContent = "couldn't read the court sheet."; line.appendChild(t); }
      div.appendChild(later);
    }
    const m = document.createElement("p"); m.className = "muted";
    m.textContent = "Each court time opens " + (days === 7 ? "exactly a week" : days + " days") + " before it ends, so a 2:15 to 3:30 pm court opens at 3:30 pm " + (days === 7 ? "a week earlier." : days + " days earlier.");
    box.appendChild(m);
  }

  // ---------- tabs ----------
  const loaded = {};
  root.querySelectorAll(".tab").forEach((t) => t.onclick = () => {
    root.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    for (const name of ["courts", "lessons", "events", "waitlist", "partners"]) $("tab-" + name).hidden = name !== t.dataset.tab;
    const load = { lessons: loadLessons, events: loadEvents, waitlist: loadWaitlist, partners: loadPartners }[t.dataset.tab];
    if (load && !loaded[t.dataset.tab]) { loaded[t.dataset.tab] = true; load(); }
  });

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
      meta.textContent = [clock(e.start) + (e.minutes ? "\u2013" + clock(e.start + e.minutes) : ""), e.pros, e.place].filter(Boolean).join(" \u00b7 ");
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
      if (p.level) { const t = document.createElement("span"); t.className = "tag"; t.textContent = p.level[0] === p.level[1] ? p.level[0].toFixed(1) : p.level[0].toFixed(1) + "\u2013" + p.level[1].toFixed(1); b.appendChild(t); }
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

  // ---------- lessons ----------
  let lessons = [], lsPro = pref("ls-pro", "any");
  async function loadLessons() {
    const box = $("lessons");
    try {
      // One sheet at a time (the Courts tab may already have most of them).
      lessons = [];
      for (const d of days) for (const [g] of GROUPS) {
        for (const l of parseLessons(await sheet(d, g), d)) if (!lessons.some((x) => x.courtId === l.courtId && x.date === l.date && x.start === l.start)) lessons.push(l);
      }
      const now = clubNowMin();
      lessons = lessons.filter((l) => l.date > today || l.start + l.minutes > now).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
      renderLessons();
    } catch { box.innerHTML = '<p class="err">Couldn\'t read the court sheet from GameTime.</p>'; }
  }
  function renderLessons() {
    const pros = [...new Set(lessons.map((l) => l.pro))].sort();
    if (lsPro !== "any" && !pros.includes(lsPro)) lsPro = "any";
    chips($("ls-pro"), [["any", "All pros"], ...pros.map((p) => [p, p])], (v) => v === lsPro, (v) => { lsPro = v; setPref("ls-pro", v); renderLessons(); });
    const box = $("lessons"); box.textContent = "";
    const list = lessons.filter((l) => lsPro === "any" || l.pro === lsPro);
    if (!list.length) { box.innerHTML = '<p class="muted">No open lesson time on the sheet this week.</p>'; return; }
    // One row per pro and time, even when the block covers several courts (often a group lesson).
    const rows = new Map();
    for (const l of list) { const k = [l.date, l.start, l.minutes, l.pro].join("|"); if (rows.has(k)) rows.get(k).courts.push(l.court); else rows.set(k, { ...l, courts: [l.court] }); }
    let lastDay = "";
    for (const l of rows.values()) {
      if (l.date !== lastDay) { const h = document.createElement("h2"); h.textContent = dayLabel(l.date); box.appendChild(h); lastDay = l.date; }
      const div = document.createElement("div"); div.className = "item";
      const b = document.createElement("b"); b.textContent = clock(l.start) + "\u2013" + clock(l.start + l.minutes);
      const meta = document.createElement("div"); meta.className = "meta";
      meta.textContent = l.pro + " \u00b7 " + (l.courts.length > 1 ? "courts " + l.courts.map((c) => c.replace(/^Court\s*/i, "")).join(", ") : l.courts[0]);
      div.append(b, meta); box.appendChild(div);
    }
  }

  // ---------- waitlist ----------
  async function loadWaitlist() {
    const box = $("waitlist");
    let rows;
    await mineDone.catch(() => {});
    try {
      const r = await fetch(waitlistUrl, { credentials: "same-origin" });
      if (!r.ok) throw new Error(String(r.status));
      rows = parseWaitlist(await r.text()).filter((w) => w.date >= today);
    } catch { box.innerHTML = '<p class="err">Couldn\'t load the waitlist from GameTime.</p>'; return; }
    box.textContent = "";
    if (!rows.length) { box.innerHTML = '<p class="muted">Nobody is on the waitlist. If a time you want is taken, you\'d be first.</p>'; return; }
    const n = document.createElement("p"); n.className = "muted"; n.textContent = rows.length + (rows.length === 1 ? " group" : " groups") + " waiting."; box.appendChild(n);
    let lastDay = "";
    for (const w of rows) {
      if (w.date !== lastDay) { const h = document.createElement("h2"); h.textContent = dayLabel(w.date); box.appendChild(h); lastDay = w.date; }
      const div = document.createElement("div"); div.className = "item";
      const b = document.createElement("b"); b.textContent = clock(w.start) + "\u2013" + clock((w.start + w.minutes) % 1440);
      const mine = myName && w.players.some((p) => p.toUpperCase().replace(/\s+/g, " ") === myName);
      if (mine) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "You"; b.appendChild(t); }
      const meta = document.createElement("div"); meta.className = "meta";
      meta.textContent = (w.players.length >= 3 ? "Doubles" : w.players.length === 2 ? "Singles" : w.players.length + " player") + " \u00b7 courts " + w.courts.join(", ");
      div.append(b, meta); box.appendChild(div);
    }
  }

  renderChips(); renderSlots();
  const mineDone = scanMine();
  mineDone.finally(() => saveOpenCourts());

  // ---------- dinner after tennis (on seattletennisclub.org) ----------
  // Reads the club's dining availability with the member's own session and shows times after
  // each day they play. Reserving stays on the club's dining page.
  function dining() {
    const root = mount(`<div class="wrap"><div class="panel" role="dialog" aria-label="Tennis Hub: dinner after tennis">
      <header><h1>Dinner after tennis</h1><button class="x" id="close" aria-label="Close">\u00d7</button></header>
      <p class="muted">Canoe Club and Club Grill times after your court bookings. Reserve on the club's <a href="${DINING_PAGE}">dining page</a>.</p>
      <div class="row" id="party"></div>
      <div id="dine"><p class="muted">Loading\u2026</p></div>
    </div></div>`);
    const $ = (id) => root.getElementById(id);
    let party = +pref("party", "2") || 2, seq = 0, base = null;
    const SIZES = [1, 2, 3, 4, 5, 6].map((n) => [n, n === 1 ? "1 person" : n + " people"]);

    async function loadBase() {
      const [dates, facilities, mine] = await Promise.all([
        getJSON(DINING_API + "GetAvailableDates").then(diningDates),
        getJSON(DINING_API + "GetFacilities").catch(() => []),
        fetch(cfg.api, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ key: cfg.key, list: true }) })
          .then((r) => r.json().then((j) => { if (!r.ok) throw new Error(j.error || "HTTP " + r.status); return j.bookings || []; })),
      ]);
      return { dates, facilities, days: playDays(mine).filter((d) => d.date >= today) };
    }

    async function render() {
      const n = ++seq, box = $("dine");
      chips($("party"), SIZES, (v) => v === party, (v) => { party = v; setPref("party", String(v)); render(); });
      box.innerHTML = '<p class="muted">Loading\u2026</p>';
      try { base = base || await loadBase(); }
      catch (e) {
        box.innerHTML = "";
        const p = document.createElement("p"); p.className = "err";
        p.textContent = /said 401/.test(e.message) ? "Sign in to the club site first, then tap the button again." : "Couldn't load dining times: " + e.message;
        box.appendChild(p); return;
      }
      if (n !== seq) return;
      const open = new Set(base.dates);
      // Days with a court booking, or tonight when there are none.
      let plan = base.days.filter((d) => open.has(d.date)).slice(0, 5);
      const none = !plan.length;
      if (none) plan = open.has(today) ? [{ date: today, end: clubNowMin(), court: null }] : base.dates.slice(0, 1).map((d) => ({ date: d, end: 0, court: null }));
      box.textContent = "";
      if (none) { const p = document.createElement("p"); p.className = "muted"; p.textContent = base.days.length ? "The dining room isn't taking reservations on the days you play. Here's the next open day:" : "No court bookings in the next two weeks. Here's the next open day:"; box.appendChild(p); }
      for (const d of plan) {
        const h = document.createElement("h2"); h.textContent = dayLabel(d.date); box.appendChild(h);
        if (!none) { const m = document.createElement("div"); m.className = "meta"; m.textContent = "Off court at " + clock(d.end) + (d.court ? " (" + d.court + ")" : ""); box.appendChild(m); }
        const line = document.createElement("div"); line.className = "courts"; line.style.marginTop = "6px";
        line.innerHTML = '<span class="muted">Checking\u2026</span>'; box.appendChild(line);
        dayTimes(d, line, n);
      }
    }

    // Times on one day from half an hour after play: per room when the club says, else the day's slots.
    async function dayTimes(d, line, n) {
      const after = d.end + 30;
      try {
        const slots = parseDiningSlots(await getJSON(DINING_API + "GetTimeSlots/" + jonasDate(d.date)));
        const first = slots.find((x) => x.min >= after);
        if (n !== seq) return;
        if (!first) { line.innerHTML = '<span class="muted">No dinner times after you play that day.</span>'; return; }
        let rooms = [];
        if (base.facilities.length) {
          try {
            rooms = parseAvailability(await getJSON(DINING_API + "GetAvailability/" + jonasDate(d.date, first.min) + "/" + party + "/" + base.facilities.map((f) => f.id).join(";")), base.facilities)
              .map((r) => ({ ...r, times: r.times.filter((t) => t >= after) }));
          } catch { rooms = []; }
        }
        if (n !== seq) return;
        line.textContent = "";
        const add = (label, times) => {
          const row = document.createElement("div"); row.className = "time";
          const b = document.createElement("b"); b.textContent = label; b.style.fontSize = "14px";
          const c = document.createElement("div"); c.className = "courts";
          for (const t of times.slice(0, 8)) { const a = document.createElement("a"); a.className = "slot"; a.href = DINING_PAGE; a.textContent = clock(t); c.appendChild(a); }
          if (!times.length) c.innerHTML = '<span class="muted">Full after you play</span>';
          row.append(b, c); line.appendChild(row);
        };
        if (rooms.length) for (const r of rooms) add(r.facility, r.times);
        else add("Dining", slots.filter((x) => x.min >= after).map((x) => x.min));
      } catch { if (n === seq) line.innerHTML = '<span class="err">Couldn\'t read times for this day.</span>'; }
    }
    render();
  }
})();
