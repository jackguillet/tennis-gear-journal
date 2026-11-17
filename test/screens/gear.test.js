// Screen tests for the new Gear tab and racket page (/next/#/gear, #/racket/<id>).
// `npm run build` first, then `npm run test:screens`. Skipped when Playwright isn't installed.
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
const sync = (ops = []) => page.evaluate(async (ops) => (await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops }) })).json(), ops);
// Wait until the phone has sent everything, then read what the server has.
async function server() {
  await page.waitForFunction(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("sbm-outbox:")); return !k || JSON.parse(localStorage.getItem(k)).length === 0; }, null, { timeout: 10000 });
  return sync();
}

before(async () => {
  if (skip) return;
  delete process.env.NEON_AUTH_BASE_URL;
  app = await startServer({ port: 3932 });
  browser = await playwright.chromium.launch();
  page = await (await browser.newContext({ ...playwright.devices["iPhone 15"], locale: "en-US", timezoneId: "America/Los_Angeles" })).newPage();
  await page.goto(app.origin + "/");
  await page.click("#acct-switch");
  await page.fill("#acct-name", "Pat Player"); await page.fill("#acct-email", "gear@example.com"); await page.fill("#acct-pass", "password123");
  await page.click("#acct-go");
  await page.locator("#app").waitFor();
  await sync([
    { op: "racket.put", id: "rk_a", data: { name: "Blade 98", head: 98, gauge: 1.25, material: "poly", pattern: "16x19", stringName: "ALU Power", strungKg: 22.7, strungOn: day(20), calib: 1 } },
    { op: "play.add", id: "pa", racketId: "rk_a", d: day(5), min: 90, kind: "singles" },
    { op: "shoe.put", id: "sh_old", data: { name: "Old pair", startedOn: day(30), lifeHours: 60 } },
  ]);
});
after(async () => { await browser?.close(); await app?.close(); });

test("Restrung saves the old strings to the history with their hours", { skip }, async () => {
  await page.goto(app.origin + "/next/#/racket/rk_a");
  await page.getByRole("button", { name: "Restrung" }).click();
  await page.getByRole("radio", { name: "Went dead" }).click();
  await page.getByLabel("New string").fill("RPM Blast");
  await page.getByRole("button", { name: "Save restring" }).click();
  await page.getByText(/^Old strings saved to the history \(1\.5 h\)/).waitFor();
  const { rackets } = await server();
  assert.equal(rackets.rk_a.stringName, "RPM Blast");
  assert.equal(rackets.rk_a.strungOn, day(0));
  assert.deepEqual(rackets.rk_a.jobs.map((j) => [j.stringName, j.reason, j.from, j.to]), [["ALU Power", "dead", day(20), day(0)]]);
});

test("Strings broke can be undone", { skip }, async () => {
  await page.getByRole("button", { name: "Strings broke" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  const { rackets } = await server();
  assert.equal(rackets.rk_a.strungOn, day(0));
  assert.equal(rackets.rk_a.jobs.length, 1);
});

test("Edit saves the racket in lb", { skip }, async () => {
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Strung at (lb)").fill("52");
  await page.getByLabel("Name").fill("Blade 98 v9");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("heading", { name: "Blade 98 v9" }).waitFor();
  const { rackets } = await server();
  assert.ok(Math.abs(rackets.rk_a.strungKg - 52 / 2.20462) < 0.01);
});

test("A new pair of shoes retires the old one that day", { skip }, async () => {
  await page.goto(app.origin + "/next/#/gear");
  await page.getByRole("button", { name: "New pair" }).click();
  await page.getByRole("textbox", { name: "Shoes" }).fill("NB 996v6 Wide");
  await page.getByRole("button", { name: "Save pair" }).click();
  await page.getByText(/^Old pair retired after 1\.5 h/).waitFor();
  const { shoes } = await server();
  assert.equal(shoes.find((s) => s.id === "sh_old").retiredOn, day(0));
  assert.ok(shoes.some((s) => s.name === "NB 996v6 Wide" && !s.retiredOn));
});

test("Deleting a racket asks first and can be undone with its history", { skip }, async () => {
  await page.goto(app.origin + "/next/#/racket/rk_a/edit");
  await page.getByRole("button", { name: "Delete racket" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("heading", { name: "Gear" }).waitFor();
  await page.getByRole("button", { name: "Undo" }).click();
  const { rackets } = await server();
  assert.equal(rackets.rk_a.name, "Blade 98 v9");
  assert.equal(rackets.rk_a.plays.length, 1);
  assert.equal(rackets.rk_a.jobs.length, 1);
});
