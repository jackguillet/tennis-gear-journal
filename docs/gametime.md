# GameTime (stc.gametime.net) notes

Seattle Tennis Club books courts through GameTime (GameTime Inc., Toronto). Its website runs on Jonas Club Software and links to `https://stc.gametime.net/auth`. These notes come from a browser recording of a signed-in member session on 2026-10-28. They describe what the club's own web pages do, so a later version of this app can show courts without scraping.

## What's public

- There is no published API, webhook or calendar feed. The marketing site says "API-first", but that means partner integrations (Jonas member sync, Stripe), not a member API.
- No terms of use are published at www.gametime.net (`/terms` and `/tos` are 404). The privacy policy has no clause on automated access. The club is the data controller.
- `www.gametime.net/robots.txt` allows everything, but `stc.gametime.net` disallows crawlers.
- Bookings send confirmations by email, text or push.

## Court sheet (read)

`GET /scheduling/index/jsoncourtdata/sport/2/date/YYYY-MM-DD[?group=N]` uses the session cookie and returns JSON:

- `g.g[]`: court groups, `{ g: "2", n: "INDOOR 14 - 19" }`. Groups are 2 for indoor 14-19, 3 for outdoor 1-8, and 4 for pro & clay 9-13.
- `e[]`: one entry per court, `{ n: "Court 15", mn: "15", i: "9", t: [...], b: [...] }`. Here `i` is the court id the booking URLs use.
  - `t[]`: bookable windows, `{ t: start, d: length, i: slot step, e?: "Peak" }`.
  - `b[]`: bookings, `{ t: start, d: length, bkId, c?: confirmation, u: 0|1, p?: [{ n: name, u: memberId, ... }], j?: pro, l?: label, m?: recurring id }`.
- Every time is in minutes after midnight, club local time (America/Los_Angeles). For example, 780 is 1:00 pm.
- The response lists other members' names. This app should only use free and busy times, plus the signed-in member's own bookings (matched on their member id).

Sport 2 is tennis and sport 4 is pickleball.

## Booking (write)

1. `GET /scheduling/index/book/sport/2/court/<i>/date/<YYYY-MM-DD>/time/<minutes>` opens the booking form for a slot. This is a safe deep link to send the member to.
2. `POST jsontempreserve` (`court, date, time, duration, conf, upd`) holds the slot and returns `{ temp_id }`.
3. `POST jsonvalidateresource` and `jsonvalidatebooking` check rules. One error seen: "(Booked by staff only at this time.)".
4. `POST /scheduling/index/save` needs a **Google reCAPTCHA** token (`g-recaptcha-response`).

Because of step 4, the app must not book or change bookings on its own. That would mean getting around the club's anti-bot check. Instead, open GameTime's own booking page at the chosen slot (step 1) and let the member finish there.

Editing a booking: `GET /scheduling/index/editbooking/sport/2/conf/<conf>?bk=<bkId>`. Confirmation page: `/scheduling/confirmation/history/sport/2/id/<conf>`.
