// Shoe wear: hours on each pair of tennis shoes, counted from the play log. Shared by the page
// (public/index.html) and the chat connector (lib/assistant.js).
//
// One pair is in use at a time. A pair counts every session on any racket from the day it went
// into use up to (not including) the day it was retired, so play logged by chat or from a court
// booking counts too, with nothing to tag. Adding a new pair retires the one before it that day.
//
// Expected life: hard courts eat outsoles. Durability-focused shoes (6-month outsole guarantees)
// last roughly 50-80 hours for a heavy toe-dragger; the default of 60 h is a starting point to
// change once a pair or two shows what yours really do.
export const DEFAULT_LIFE = 60;

export const shoeMinutes = (shoe, rackets) => Object.values(rackets || {})
  .flatMap((r) => r.plays || [])
  .filter((p) => p.d >= shoe.startedOn && (!shoe.retiredOn || p.d < shoe.retiredOn))
  .reduce((a, p) => a + p.min, 0);

// { hours, used (0-1+), status: good | soon | now | retired, label }
export function shoeWear(shoe, rackets) {
  const hours = Math.round(shoeMinutes(shoe, rackets) / 6) / 10;
  const life = shoe.lifeHours || DEFAULT_LIFE;
  const used = hours / life;
  const status = shoe.retiredOn ? "retired" : used >= 1 ? "now" : used >= 0.8 ? "soon" : "good";
  const label = { retired: "Retired", now: "Replace now", soon: "Wearing out", good: "Good" }[status];
  return { hours, life, used, status, label, left: Math.max(0, Math.round((life - hours) * 10) / 10) };
}

// The pair in use (the newest without a retired date), or null.
export const currentShoe = (shoes) => (shoes || []).filter((s) => !s.retiredOn).sort((a, b) => b.startedOn.localeCompare(a.startedOn))[0] || null;
