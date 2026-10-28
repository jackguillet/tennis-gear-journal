import { db } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";
import { userForToken } from "../lib/tokens.js";
import { calendarFor, logFinishedBookings } from "../lib/bookings.js";

// The player's court bookings as a calendar to subscribe to in Apple, Google or Outlook Calendar:
//   https://<site>/api/calendar/<secret>.ics   (vercel.json rewrites it to /api/calendar?token=<secret>.ics)
// The secret is a "calendar" link made in the app; it can only read bookings.
export async function GET(request) {
  const url = new URL(request.url);
  const fromPath = url.pathname.startsWith("/api/calendar/") ? decodeURIComponent(url.pathname.slice("/api/calendar/".length)) : null;
  const secret = String(fromPath || url.searchParams.get("token") || "").replace(/\.ics$/, "");
  try {
    const store = db();
    await ensureSchema(store);
    const user = await userForToken(store, secret, "calendar");
    if (!user) return new Response("This calendar link isn't valid. Make a new one in the Stringbed Meter app.", { status: 404, headers: { "content-type": "text/plain" } });
    // Calendar apps poll this every hour or so, which also logs finished bookings without the app open.
    await logFinishedBookings(store, user.id);
    return new Response(await calendarFor(store, user.id), {
      headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300", "content-disposition": "inline; filename=\"tennis-courts.ics\"" },
    });
  } catch (e) {
    console.error(e);
    return new Response("The server couldn't load the calendar.", { status: 503, headers: { "content-type": "text/plain" } });
  }
}
