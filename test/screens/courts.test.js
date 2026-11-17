// Screen tests for the new Courts tab (/next/#/courts).
// `npm run build` first, then `npm run test:screens`. Skipped when Playwright isn't installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { startServer } from "../../scripts/server.js";
import { zonedToUtc, localDate } from "../../public/courts.js";

let playwright = null;
try { playwright = createRequire(import.meta.url)("playwright"); } catch {}
const built = await access(new URL("../../public/next/index.html", import.meta.url)).then(() => true, () => false);
const skip = !playwright ? "Playwright isn't installed" : !built ? "run `npm run build` first" : false;

const TZ = "America/Los_Angeles";
const club = (n) => { const d = new Date(localDate(Date.now(), TZ) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay();
// The court sheet the GameTime button would have read for tomorrow: Court 15 open at 6 pm, Court 14 taken.
const sheet = [{ date: club(1), at: Date.now() - 3600e3, courts: [{ c: "Court 14", i: 8, cells: [[1080, 75, "b"]] }, { c: "Court 15", i: 9, cells: [[1080, 75, "o"]] }] }];

let app, browser, page;
const sync = (ops = []) => page.evaluate(async (ops) => (await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops }) })).json(), ops);
async function server() {
  await page.waitForFunction(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("sbm-outbox:")); return !k || JSON.parse(localStorage.getItem(k)).length === 0; }, null, { timeout: 10000 });
  return sync();
}
const row = (text) => page.locator("#h-coming").locator("xpath=ancestor::section").locator("div.px-4", { hasText: text });

before(async () => {
  if (skip) return;
  delete process.env.NEON_AUTH_BASE_URL;
  app = await startServer({ port: 3933 });
  browser = await playwright.chromium.launch();
  page = await (await browser.newContext({ ...playwright.devices["iPhone 15"], locale: "en-US", timezoneId: TZ })).newPage();
  // The test server has no GameTime button scans, so the sheet is added to what sync sends back.
  await page.route("**/api/sync", async (route) => {
    const res = await route.fetch(), body = await res.json();
    await route.fulfill({ response: res, json: { ...body, courtSheet: sheet } });
  });
  await page.goto(app.origin + "/");
  await page.click("#acct-switch");
  await page.fill("#acct-name", "Pat Player"); await page.fill("#acct-email", "courts@example.com"); await page.fill("#acct-pass", "password123");
  await page.click("#acct-go");
  await page.locator("#app").waitFor();
  await sync([
    { op: "racket.put", id: "rk_c", data: { name: "Pure Aero", head: 100, gauge: 1.25, material: "poly", pattern: "16x19", calib: 1 } },
    // Every week on the day after tomorrow at 10, and that one is booked.
    { op: "plan.put", id: "pl_week", dow: dow(club(2)), date: null, skips: [], time: "10:00", min: 90, area: "indoor", court: null, kind: "singles", note: "Marc", backups: null, paused: false },
    { op: "booking.put", id: "bk_week", start: zonedToUtc(club(2), "10:00", TZ), min: 90, tz: TZ, kind: "singles", court: "Court 16", racketId: "rk_c" },
    // Once, tomorrow at 6 pm on Court 15, open on the sheet.
    { op: "plan.put", id: "pl_once", dow: dow(club(1)), date: club(1), skips: [], time: "18:00", min: 75, area: "any", court: "Court 15", kind: "singles", note: null, backups: null, paused: false },
  ]);
});
after(async () => { await browser?.close(); await app?.close(); });

test("A booked weekly request shows once, on its booking", { skip }, async () => {
  await page.goto(app.origin + "/next/#/courts");
  const booked = row("Court 16");
  await booked.getByText(/^Every week · next one opens /).waitFor();
  assert.equal(await row("with Marc").count(), 0, "the request has no row of its own");
  assert.equal(await row("Every week").count(), 1);
});

test("An open request links straight to the court's booking form", { skip }, async () => {
  const book = row("Once · Court 15").getByRole("link", { name: "Book Ct 15" });
  assert.equal(await book.getAttribute("href"), `https://stc.gametime.net/scheduling/index/book/sport/2/court/9/date/${club(1)}/time/1080`);
});

test("Request a court, skip its next week, then remove it with undo", { skip }, async () => {
  await page.getByRole("button", { name: "Request a court" }).click();
  await page.getByLabel("Day", { exact: true }).selectOption(String(dow(club(4))));
  await page.getByLabel("Start", { exact: true }).fill("19:30");
  await page.getByLabel("If it's taken, try (in order)").fill("15, ct 14");
  await page.getByRole("button", { name: "Save request" }).click();
  let { plans } = await server();
  const p = plans.find((x) => x.time === "19:30");
  assert.equal(p.backups, "Court 15, Court 14");
  assert.equal(p.dow, dow(club(4)));

  const r = row("if taken: Court 15, Court 14");
  await r.getByRole("button", { name: "More for this request" }).click();
  await page.getByRole("menuitem", { name: /^Skip / }).click();
  ({ plans } = await server());
  assert.deepEqual(plans.find((x) => x.id === p.id).skips, [club(4)]);

  await r.getByRole("button", { name: "More for this request" }).click();
  await page.getByRole("menuitem", { name: "Remove request" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  ({ plans } = await server());
  assert.ok(plans.some((x) => x.id === p.id), "undo brings it back");
});

test("Add a booking by hand", { skip }, async () => {
  await page.getByRole("button", { name: "Add a booking" }).click();
  await page.getByLabel("Day", { exact: true }).fill(club(3));
  await page.getByLabel("Start", { exact: true }).fill("08:00");
  await page.getByLabel("Court", { exact: true }).selectOption("Court 4");
  await page.getByLabel("Racket", { exact: true }).selectOption("rk_c");
  await page.getByRole("button", { name: "Save booking" }).click();
  const { bookings } = await server();
  const b = bookings.find((x) => x.court === "Court 4");
  assert.equal(b.start, zonedToUtc(club(3), "08:00", TZ));
  assert.equal(b.racketId, "rk_c");
});

test("The grid books open courts and explains taken ones", { skip }, async () => {
  await page.getByRole("radio", { name: "Tmrw" }).click();
  const open = page.getByRole("link", { name: "Book Court 15 at 6 pm, 75 minutes" });
  assert.equal(await open.getAttribute("href"), `https://stc.gametime.net/scheduling/index/book/sport/2/court/9/date/${club(1)}/time/1080`);
  await page.getByRole("button", { name: "Court 14 at 6 pm: taken" }).click();
  await page.getByRole("status").getByRole("link", { name: "Join the waitlist" }).waitFor();
});
