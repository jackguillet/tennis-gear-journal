// Screen tests: drive Today in a phone-sized Chromium against the local server.
// `npm run build` first (it builds the new front end into public/next/), then `npm run test:screens`.
// Skipped when Playwright isn't installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { startServer } from "../../scripts/server.js";

let playwright = null;
try { playwright = createRequire(import.meta.url)("playwright"); } catch {}
const built = await access(new URL("../../public/next/index.html", import.meta.url)).then(() => true, () => false);
const skip = !playwright ? "Playwright isn't installed" : !built ? "run `npm run build` first" : false;

let app, browser, page;
// Days on the phone's clock (Seattle), not the test machine's.
const day = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const racket = (name, strungOn) => ({ name, head: 98, gauge: 1.25, material: "poly", pattern: "16x19", weight: 305, stringName: "ALU Power", strungKg: 22.7, strungOn, calib: 1 });
const sync = (ops = []) => page.evaluate(async (ops) => (await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops }) })).json(), ops);

before(async () => {
  if (skip) return;
  delete process.env.NEON_AUTH_BASE_URL;
  app = await startServer({ port: 3931 });
  browser = await playwright.chromium.launch();
  page = await (await browser.newContext({ ...playwright.devices["iPhone 15"], locale: "en-US", timezoneId: "America/Los_Angeles" })).newPage();
  await page.goto(app.origin + "/");
  await page.click("#acct-switch");
  await page.fill("#acct-name", "Pat Player"); await page.fill("#acct-email", "pat@example.com"); await page.fill("#acct-pass", "password123");
  await page.click("#acct-go");
  await page.locator("#app").waitFor();
  // Two rackets; every session is on the v9. The v8 page was the last one opened on this phone.
  await sync([
    { op: "racket.put", id: "rk_v8", data: racket("Blade 98 v8", day(36)) },
    { op: "racket.put", id: "rk_v9", data: racket("Blade 98 v9", day(20)) },
    ...[1, 3, 5].map((n, i) => ({ op: "play.add", id: "pl" + i, racketId: "rk_v9", d: day(n), min: 90, kind: "singles" })),
  ]);
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("sbm-prefs") || "{}"); p.racket = "rk_v8"; p.tab = "today"; localStorage.setItem("sbm-prefs", JSON.stringify(p)); });
});
after(async () => { await browser?.close(); await app?.close(); });

test("the new Today follows the racket you play with, not the last one opened", { skip }, async () => {
  await page.goto(app.origin + "/next/");
  const log = page.getByRole("button", { name: /^Log 1 h 30 of singles today on/ });
  await log.waitFor();
  assert.match(await log.getAttribute("aria-label"), /on Blade 98 v9$/);
  await log.click();
  await page.getByText(/^Logged 1 h 30 of singles on Blade 98 v9\./).waitFor();
  await page.waitForFunction(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("sbm-outbox:")); return !k || JSON.parse(localStorage.getItem(k)).length === 0; });
  const state = await sync();
  assert.equal(state.rackets.rk_v9.plays.length, 4);
  assert.equal(state.rackets.rk_v8.plays.length, 0);
});

test("Make main moves Today and one-tap logging to that racket", { skip }, async () => {
  await page.getByRole("button", { name: "Make main" }).click();
  await page.getByRole("button", { name: /today on Blade 98 v8$/ }).waitFor();
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("sbm-prefs")); delete p.main; localStorage.setItem("sbm-prefs", JSON.stringify(p)); });
});

test("units follow the phone's region until you pick", { skip }, async () => {
  await sync([{ op: "reading.add", id: "rd1", racketId: "rk_v9", t: Date.now() - 864e5, hz: 520 }]);
  await page.goto(app.origin + "/next/");
  await page.getByText("lb", { exact: true }).first().waitFor();
});

test("the current app's Today also follows the racket you play with", { skip }, async () => {
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("sbm-prefs")); p.racket = "rk_v8"; localStorage.setItem("sbm-prefs", JSON.stringify(p)); });
  await page.goto(app.origin + "/?tab=today");
  await page.locator("#td-name", { hasText: "Blade 98 v9" }).waitFor();
  assert.match(await page.locator("#td-repeat").getAttribute("aria-label"), /on Blade 98 v9$/);
});
