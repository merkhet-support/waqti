// Date helpers. A "habit day" doesn't have to start at midnight: for people
// working night shifts the day rolls over at `dayStartHour` (set from their
// sleep schedule), so a 2 AM check-in still counts for the day they're living.

let dayStartHour = 0;
let locale; // undefined = device locale; set by i18n (e.g. "ar-EG-u-nu-latn")
export function setLocale(l) { locale = l; }
export function getLocale() { return locale; }
let weekStart = 6; // 6 = Saturday (Egypt/Gulf default), 0 = Sunday, 1 = Monday

export function configureDates(opts) {
  if (opts.dayStartHour != null) dayStartHour = opts.dayStartHour;
  if (opts.weekStart != null) weekStart = opts.weekStart;
}
export function getDayStartHour() { return dayStartHour; }
export function getWeekStart() { return weekStart; }

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_MIN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
export const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// keyOf / fromKey run thousands of times when streaks are worked out over a year of history,
// so both are cached (a year's test: half the time went into building these strings).
const keyCache = new Map(), dateCache = new Map();
export function keyOf(d) {
  const t = typeof d === "number" ? d : d instanceof Date ? d.getTime() : new Date(d).getTime();
  let k = keyCache.get(t);
  if (k === undefined) {
    const x = new Date(t);
    k = x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
    if (keyCache.size > 20000) keyCache.clear();
    keyCache.set(t, k);
  }
  return k;
}
export function fromKey(k) {
  let t = dateCache.get(k);
  if (t === undefined) {
    const [y, m, d] = String(k).split("-").map(Number);
    t = new Date(y, m - 1, d).getTime();
    if (dateCache.size > 5000) dateCache.clear();
    dateCache.set(k, t);
  }
  return new Date(t);
}
export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// The habit-day the given moment belongs to.
// Uses the clock hour, not "now minus N hours", so the reset stays at the right hour on
// daylight-saving days (23- and 25-hour days).
export function habitDayOf(ms) {
  const x = new Date(ms);
  if (x.getHours() < dayStartHour) x.setDate(x.getDate() - 1);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function today() { return habitDayOf(Date.now()); }

export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); x.setHours(0, 0, 0, 0); return x; }
export function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
export function startOfWeek(d) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStart + 7) % 7;
  return addDays(x, -diff);
}
export function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
// Week-ordered list of weekday numbers, e.g. [6,0,1,2,3,4,5] when weeks start Saturday.
export function weekOrder() { return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7); }

// "HH:MM" <-> minutes after midnight
export function toMin(t) {
  if (!t || typeof t !== "string" || !t.includes(":")) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
export function fromMin(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}
// Friendly clock label honoring the device's 12/24h preference.
export function fmtTime(t) {
  const m = typeof t === "number" ? t : toMin(t);
  if (m == null) return "";
  const d = new Date(2000, 0, 1, Math.floor(((m % 1440) + 1440) % 1440 / 60), ((m % 60) + 60) % 60);
  return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}
export function fmtDuration(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return m + "m";
  return m ? h + "h " + m + "m" : h + "h";
}
// Minutes from a to b going forward round the clock (e.g. bed 23:00 -> wake 07:00 = 480).
export function clockSpan(a, b) { return ((toMin(b) - toMin(a)) % 1440 + 1440) % 1440; }

// The real Date a time-of-day lands on for a given habit day. Times before the
// day-start hour belong to the *next* calendar date (e.g. 02:00 on a night shift).
export function momentFor(day, minutes) {
  const d = new Date(day);
  let m = ((minutes % 1440) + 1440) % 1440;
  if (m < dayStartHour * 60) m += 1440;
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m);
  // A time inside the hour skipped by daylight saving (e.g. 02:30 when clocks jump 02:00→03:00)
  // is pushed an hour later by Date; fire it when the clock jumps instead.
  if (out.getHours() !== Math.floor(m / 60) % 24) out.setMinutes(0, 0, 0);
  return out;
}

export function fmtDate(d, opts) { return new Date(d).toLocaleDateString(locale, opts || { weekday: "short", day: "numeric", month: "short" }); }
export function relDay(d) {
  const n = daysBetween(today(), d);
  if (n === 0) return "Today";
  if (n === -1) return "Yesterday";
  if (n === 1) return "Tomorrow";
  return fmtDate(d);
}
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
