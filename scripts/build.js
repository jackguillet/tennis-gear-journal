// `npm run build`: there is nothing to compile (the front end is one HTML file and the API is
// plain ES modules), so the build checks that everything Vercel will serve and run loads.
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
// The page script is a module; drop its import lines so vm can syntax-check the rest.
const scripts = [...html.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)].map((m) => m[1].replace(/^import .*$/gm, ""));
if (!scripts.length) throw new Error("public/index.html has no inline script.");
scripts.forEach((code, i) => new vm.Script(code, { filename: `public/index.html <script ${i + 1}>` })); // throws on a syntax error
const tension = await import(new URL("../public/tension.js", import.meta.url));
if (typeof tension.analyseRecording !== "function") throw new Error("public/tension.js does not export analyseRecording.");
new vm.Script(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), { filename: "public/sw.js" });
JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));

const routes = { "api/sync.js": ["POST"], "api/auth.js": ["GET", "POST", "PUT", "PATCH", "DELETE"], "api/tokens.js": ["GET", "POST", "DELETE"], "api/mcp.js": ["POST", "GET", "DELETE"] };
for (const [file, methods] of Object.entries(routes)) {
  const mod = await import(new URL("../" + file, import.meta.url));
  for (const m of methods) if (typeof mod[m] !== "function") throw new Error(`${file} does not export ${m}.`);
}
await import(new URL("../neon.ts", import.meta.url)).catch((e) => {
  // Node can't load .ts without a loader; the Neon CLI reads it. Only report real errors.
  if (e.code !== "ERR_UNKNOWN_FILE_EXTENSION") throw e;
});
console.log(`Build check passed: ${scripts.length} page script, service worker, manifest and ${Object.keys(routes).length} API routes load.`);
