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

## How the app uses this

`public/stc.js` (the GameTime button) runs on stc.gametime.net in the member's own browser. It reads `jsoncourtdata` for groups 2, 3 and 4 and shows open slots. Every slot links to GameTime's booking form. It also picks out the member's own bookings: `b.e` is the booker's member id, `b.f` is the confirmation number, and the member id comes from `cv.setUserId(<id>)` in the page. It reads 7 days × 3 areas one request at a time and posts the member's bookings to `/api/gametime`. Nothing is sent to the server about other members except the names of the member's own partners on their own bookings.

## Other GameTime feeds (second recording, 2026-10-28)

The GameTime button now uses `/cne/index/listdata` for its Clinics & events tab (adult events only, next 28 days) and `/scheduling/gameseeker/rosteravailable/sport/2` for its Partners tab. Partner contact details stay in the browser and are never posted to the app.


- `GET /account/jsonlistupcoming?wltext=1&family=member&limit=50&order=asc` returns the member's upcoming bookings (`date` "Thursday Oct 29, 2026", `time` "1:00pm - 2:15pm", `place`, `booking_id`, `conf_id`, `sport_id`, `players`). The GameTime button uses it first. Editing a booking gives it a new `booking_id` but keeps the `conf_id`, so rows are keyed on the confirmation number.
- `GET /cne/index/listdata?...` and `/cne/event/view/eventid/<id>` list classes and events (category, dates, price, pros, spots `participants.text` such as "4/18", waitlist).
- `/scheduling/waitlist/index/sport/2`: the court waitlist (HTML).
- `/scheduling/gameseeker/rosteravailable/sport/2`: members who opted in as available partners, with level, phone and email. Personal data: show it only inside the member's own browser and never store it.
- `/scheduling/index/get-reservation-types?api=1&sport=2`: Singles, Doubles, Lesson, Clinic, Lesson Available, Round Robin and others.

## STC member portal (Jonas Clubhouse Online)

Dining reservations (all GET, member session cookie): `/api/v1/dining/GetAvailableDates` (list of "Wed, 28 Oct 2026 00:00:00 GMT"), `GetFacilities` (Canoe Club 182700, Club Grill 182699), `GetPartySizes` (1 to 6), `GetTimeSlots/<yyyymmdd>T000000` (`value24` "1700", `available`), and `GetAvailability/<yyyymmdd>T<hhmm>00/<party>/<facility;facility>` (per facility `availableTimes[].dateTimeJS`). Times are the club's wall clock written as GMT. The GameTime button uses these on the club site for its "Dinner after tennis" view. GetAvailability's reply shape comes from the dining page's script, not a recording. Reserving stays on `/CMSModules/CHO/DiningReservations/Dining.aspx`.

Court sheet lesson blocks: GameTime's "Lesson" and "Lesson Available" reservation types share colour `adcf53`; a block with a pro's name in `j` and no players is lesson time the pro is holding. Pro Shop: (206) 324-5454.

The portal at www.seattletennisclub.org has a JSON API under `/api/v1/` (dining reservations, events, roster, my bookings). Club tennis rules that the app uses: cancel at least 6 hours before a court time (a no-show can mean a one-week suspension), check in at the Pro Shop before playing, book the ball machine on the day only, wear mostly-white clothing (tennis shoes can be any colour). Address: 922 McGilvra Blvd E, Seattle, WA 98112.

## Booking window

STC members book about a week ahead (Jack, 2026-10-29); the exact opening time isn't published. Opening `/scheduling/index/book/sport/2/court/<i>/date/<d>/time/<min>` for a day GameTime won't take yet redirects to `/scheduling/bookerror/index/sport/2` with a "Booking Not Available" message (for a past time it says "The court time is in the past."). A plain GET of the booking form holds nothing: the hold is a separate `POST /scheduling/index/jsontempreserve` made by the form's script. The GameTime button uses the redirect to find the last bookable day and, over several taps, the opening time (`learnWindowFrom` in `public/stc.js`).

GameTime court ids (from the court sheet): courts 1 to 8 are 14, 15, 16, 20, 17, 18, 19, 21 (group 3); courts 14 to 19 are 8 to 13 (group 2). Courts 9 to 13 (group 4) weren't in a recording.
