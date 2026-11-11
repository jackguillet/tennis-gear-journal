import { db } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";
import { runReminders, runCourtAlerts } from "../lib/push.js";
import { json } from "../lib/http.js";

// GET /api/reminders: the daily restring check, run by the Vercel cron in vercel.json, plus the court
// "book now" alerts. GET /api/reminders?only=courts runs just the court alerts; a GitHub Actions
// schedule calls it every 5 minutes (.github/workflows/court-alerts.yml), since Vercel's free cron runs daily.
// With CRON_SECRET set in Vercel, only Vercel's cron (which sends it as a Bearer token) can run it.
// Without it anyone could trigger the check, which is harmless: each reminder goes out once per stage.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Not allowed." }, 401);
  try {
    const store = db();
    await ensureSchema(store);
    const only = new URL(request.url).searchParams.get("only");
    const courts = await runCourtAlerts(store);
    if (only === "courts") return json({ courts: courts.length });
    const sent = await runReminders(store);
    return json({ sent: sent.length, courts: courts.length });
  } catch (e) {
    console.error(e);
    return json({ error: "The reminder check failed." }, 500);
  }
}
