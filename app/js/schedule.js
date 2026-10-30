// When is a habit due, and how is it going? Scheduling, logging, streaks.
//
// schedule.kind:
//   daily     every day
//   days      chosen weekdays (e.g. Sun, Tue, Thu)
//   perWeek   any N days a week (flexible)
//   interval  every N days
//   weeks     chosen weekdays, every N weeks (e.g. Mon + Thu every 2 weeks)
//   monthly   a day of the month (or the last day)
// Extra filters: onlyOn (any | work | off), hijriMonth (e.g. 9 = Ramadan), hijriDays.

import { state, activeHabits } from "./store.js";
import { keyOf, fromKey, today, habitDayOf, addDays, daysBetween, startOfWeek, daysInMonth, DAY_SHORT, weekOrder, ordinal, fmtDate } from "./dates.js";
import { isWorkDay, hasWork } from "./routine.js";
import { hijri, HIJRI_MONTHS } from "./hijri.js";
import { inSeason, SEASONS } from "./seasons.js";
import { jewishFastOn } from "./hebrew.js";
import { hinduFastOn } from "./lunar.js";
import { restPerMonth } from "./pro.js";
import { occasionOn, OCCASION_NAMES } from "./occasions.js";

export const KINDS = [
  { id: "daily", label: "Every day" },
  { id: "days", label: "Specific days" },
  { id: "perWeek", label: "Times a week" },
  { id: "interval", label: "Every few days" },
  { id: "weeks", label: "Every few weeks" },
  { id: "monthly", label: "Monthly" },
  { id: "months", label: "Every few months" },
  { id: "yearly", label: "Every year" }
];

// Habits start on the habit day they were created (not the calendar date), so a habit added
// at 2 AM on a night shift shows up on the shift being worked.
export function startDate(h) {
  const first = h.pastSchedules && h.pastSchedules.length ? h.pastSchedules[0].schedule : h.schedule;
  return fromKey(first.start || h.schedule.start || keyOf(habitDayOf(h.createdAt || Date.now())));
}

/* ---------- schedule history ----------
   Changing how often a habit repeats must not rewrite the past (Grit calls this a "repeat plan").
   h.pastSchedules = [{ until: "YYYY-MM-DD", schedule }] in date order; each past day is judged by
   the schedule that applied on that day, and h.schedule applies after the last "until". */
export function scheduleFor(h, d) {
  const k = keyOf(d);
  for (const p of h.pastSchedules || []) if (k <= p.until) return p.schedule;
  return h.schedule;
}
const RULE_KEYS = ["kind", "days", "n", "perWeek", "monthDay", "month", "occasion", "onlyOn", "hijriMonth", "hijriDays", "skipRamadan", "hijriNot", "observance", "season", "notInSeason", "end"];
const rule = s => JSON.stringify(RULE_KEYS.map(k => s[k] === undefined ? null : s[k]));

// Call when saving an edited habit: if the repeat rule changed, keep the old one for past days
// and start the new one today.
export function keepPastSchedule(before, after) {
  if (!before || rule(before.schedule) === rule(after.schedule)) return;
  const t = today(), yesterday = keyOf(addDays(t, -1));
  if (startDate(before) > addDays(t, -1)) return; // nothing in the past to protect yet
  after.pastSchedules = (before.pastSchedules || []).slice();
  after.pastSchedules.push({ until: yesterday, schedule: JSON.parse(JSON.stringify(before.schedule)) });
  if (!after.schedule.start || after.schedule.start < keyOf(t)) after.schedule.start = keyOf(t);
}

// Days set by another calendar: "jewish-fast", "jewish-major", "jewish-eve" (the day before a
// sunset-to-nightfall fast), or "hindu:<ekadashi|purnima|amavasya>:<smarta|vaishnava>".
function observanceOn(o, d) {
  if (o === "jewish-fast") return !!jewishFastOn(d);
  if (o === "jewish-major") { const f = jewishFastOn(d); return !!f && f.major; }
  if (o === "jewish-minor") { const f = jewishFastOn(d); return !!f && !f.major; }
  if (o === "jewish-eve") { const f = jewishFastOn(addDays(d, 1)); return !!f && f.major; }
  if (o.startsWith("hindu:")) { const [, id, rule] = o.split(":"); return !!hinduFastOn(d, id, rule); }
  return true;
}

function passesFilters(h, d, s) {
  s = s || h.schedule;
  if (s.season && !inSeason(s.season, d)) return false;           // e.g. Great Lent only
  if (s.notInSeason && inSeason(s.notInSeason, d)) return false;    // e.g. no Wed/Fri fast after Easter
  if (s.onlyOn === "work" && hasWork() && !isWorkDay(d)) return false;
  if (s.onlyOn === "off" && hasWork() && isWorkDay(d)) return false;
  if (s.hijriMonth || (s.hijriDays && s.hijriDays.length)) {
    const hj = hijri(d);
    if (!hj) return !s.hijriMonth; // no Islamic calendar support: hide Ramadan-only habits
    if (s.hijriMonth && hj.month !== s.hijriMonth) return false;
    if (s.hijriDays && s.hijriDays.length && !s.hijriDays.includes(hj.day)) return false;
    if (s.hijriDays && s.hijriDays.length && hj.month === 9 && s.skipRamadan) return false;
  }
  if (s.observance && !observanceOn(s.observance, d)) return false; // Jewish fasts, Ekadashi…
  if (s.hijriNot && s.hijriNot.length) {
    // e.g. ["10-1", "12-10", "9"]: never on Eid days, or never in Ramadan
    const hj = hijri(d);
    if (hj && s.hijriNot.some(x => x === String(hj.month) || x === hj.month + "-" + hj.day)) return false;
  }
  return true;
}

export function isScheduled(h, d) {
  if (h.archived) return false;
  const sd = startDate(h);
  if (d < sd) return false;
  const s = scheduleFor(h, d), dow = d.getDay();
  if (s.end && keyOf(d) > s.end) return false;
  const start = s.start ? fromKey(s.start) : sd;
  if (d < start) return false;
  if (!passesFilters(h, d, s)) return false;
  switch (s.kind) {
    case "daily":
    case "perWeek":
      return true;
    case "days":
      return (s.days || []).includes(dow);
    case "interval":
      return daysBetween(start, d) % Math.max(1, s.n || 1) === 0;
    case "weeks": {
      if (!(s.days || []).includes(dow)) return false;
      const w = Math.round(daysBetween(startOfWeek(start), startOfWeek(d)) / 7);
      return w % Math.max(1, s.n || 1) === 0;
    }
    case "monthly": {
      const md = s.monthDay === "last" ? daysInMonth(d) : Math.min(+s.monthDay || 1, daysInMonth(d));
      return d.getDate() === md;
    }
    case "months": { // every n months, on the start date's day (the 31st falls on the month's last day)
      const gap = (d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth();
      if (gap < 0 || gap % Math.max(1, s.n || 1)) return false;
      return d.getDate() === Math.min(start.getDate(), daysInMonth(d));
    }
    case "yearly": { // a date each year (29 Feb falls on 28 Feb), or Mother's / Father's Day for your country
      if (s.occasion) return occasionOn(s.occasion, d);
      return d.getMonth() + 1 === (+s.month || 1) && d.getDate() === Math.min(+s.monthDay || 1, daysInMonth(d));
    }
    default:
      return true;
  }
}

/* ---------- values ---------- */
// With a day: the target that applied then (lowering a target mustn't turn old partial days into "done").
export function target(h, d) {
  if (h.type !== "count") return 1;
  if (d && h.pastTargets && h.pastTargets.length) {
    const k = keyOf(d), old = h.pastTargets.find(p => k <= p.until);
    if (old) return Math.max(1, +old.target || 1);
  }
  return Math.max(1, +h.target || 1);
}
// Call after changing a count habit's target: days up to yesterday keep the old one.
export function keepPastTarget(beforeTarget, h) {
  if (h.type !== "count" || !beforeTarget || +beforeTarget === +h.target) return;
  const yesterday = keyOf(addDays(today(), -1));
  if (startDate(h) > addDays(today(), -1)) return;
  h.pastTargets = (h.pastTargets || []).filter(p => p.until < yesterday);
  h.pastTargets.push({ until: yesterday, target: +beforeTarget });
}
export function rawVal(h, d) { return h.history[keyOf(d)]; }
export function value(h, d) {
  const v = rawVal(h, d);
  if (v === true) return 1;
  if (typeof v === "number") return v;
  return 0;
}
// Medicine-like habits: their reminders keep coming through rest days and sick or travel breaks.
const MEDICINE = /medic|pill|dose|tablet|insulin|inhaler|capsule|دواء|علاج|جرع|حبوب|أنسولين|انسولين|بخاخ/i;
// Car maintenance by distance: kilometres left until it's due (negative = overdue), or null.
export function kmLeft(h) {
  if (!h || !h.car || !(+h.car.everyKm > 0)) return null;
  const v = (state.vehicles || []).find(x => x.id === h.car.vid);
  if (!v) return null;
  return +h.car.everyKm - ((+v.odo || 0) - (+h.car.lastOdo || 0));
}
// A habit can also be marked as medicine (or not) by hand in its editor — drug names can't be guessed.
export const isMedicine = h => !!h && (h.medicine === true || (h.medicine !== false && h.category === "Health" && (h.emoji === "💊" || h.unit === "doses" || MEDICINE.test(h.name || ""))));
// Skipped: this habit marked "skip", or the whole day is a rest day / inside a sick or travel pause.
// Faith habits (prayers) stay on during rests and pauses unless that pause includes them; medicine always stays on.
// Excused days (always free): prayer and fasting reminders stop and streaks are kept — a period or
// the weeks after childbirth (no salah, no fasting), or illness, pregnancy and travel (fasting).
// Only prayers (salah) and fasts are covered; Quran, dhikr and duas carry on. Wording to be checked
// by a scholar before launch.
const SALAH = /^faith:(fajr|dhuhr|asr|maghrib|isha|rawatib|duha|witr|qiyam|jumuah|rm-taraweeh|eid-fitr|eid-adha)$/;
const FASTS = /^faith:(fast|fast-.+|rm-fast|rm-suhoor|jewish-major|jewish-minor|ekadashi|purnima|amavasya|great-lent|jonah|apostles|virgin|nativity|paramoun|theophany-eve|beheading|exaltation|lent|ash-wednesday|good-friday|lent-fridays)$/;
export const excusable = h => !!h && (SALAH.test(h.source || "") || FASTS.test(h.source || ""));
export function excusedOn(d) { const k = keyOf(d); return !!state && (state.excused || []).find(e => k >= e.from && k <= e.to) || null; }

export function isSkipped(h, d) {
  if (rawVal(h, d) === "skip") return true;
  if (excusable(h) && excusedOn(d) && !isDone(h, d)) return true;
  if (h.repaired && h.repaired.includes(keyOf(d)) && !isDone(h, d)) return true; // streak repair (Pro)
  const p = dayPaused(d) && pauseOn(d);
  if (!p || (h.category === "Faith" && !p.faith) || isMedicine(h)) return false; // medicine never pauses: a sick day is when it matters most
  return !(value(h, d) >= target(h, d));
}
export function dayPaused(d) {
  if (!state) return false;
  const k = keyOf(d);
  if ((state.restDays || []).includes(k)) return true;
  return (state.pauses || []).some(p => k >= p.from && k <= p.to);
}
export function pauseOn(d) { const k = keyOf(d); return (state.pauses || []).find(p => k >= p.from && k <= p.to) || ((state.restDays || []).includes(k) ? { rest: true } : null); }
// Rest days left this calendar month (1 free, 4 with Pro; sick/travel pauses don't count).
export function restDaysLeft(d) {
  const ym = keyOf(d || today()).slice(0, 7);
  return Math.max(0, restPerMonth() - (state.restDays || []).filter(k => k.slice(0, 7) === ym).length);
}
const forgiving = () => !state || !state.settings || state.settings.streakMode !== "strict";
export function isDone(h, d) { return value(h, d) >= target(h, d); }

export function weekCount(h, d) {
  const ws = startOfWeek(d);
  let c = 0;
  for (let i = 0; i < 7; i++) if (isDone(h, addDays(ws, i))) c++;
  return c;
}

// done | skip | met (weekly goal reached on other days) | open | off
export function status(h, d) {
  if (!isScheduled(h, d)) return isDone(h, d) ? "done" : "off";
  if (isSkipped(h, d)) return "skip";
  if (isDone(h, d)) return "done";
  const s = scheduleFor(h, d);
  if (s.kind === "perWeek" && weekCount(h, d) >= (s.perWeek || 1)) return "met";
  return "open";
}

/* ---------- logging ---------- */
export function canLog(d) { return daysBetween(d, today()) >= 0; }

export function tap(h, d) {
  const k = keyOf(d);
  if (h.type === "count") {
    const cur = value(h, d), t = target(h, d);
    const next = cur >= t ? 0 : Math.min(t, cur + (h.step || 1));
    if (next === 0) delete h.history[k]; else h.history[k] = next;
  } else if (h.history[k] === true) {
    delete h.history[k];
  } else {
    h.history[k] = true;
  }
  // Car maintenance: doing it resets the kilometre count from the current odometer reading.
  if (h.car && isDone(h, d)) { const v = (state.vehicles || []).find(x => x.id === h.car.vid); if (v) h.car.lastOdo = +v.odo || 0; }
  // Remember when it actually gets done, so the weekly review can suggest a better reminder time.
  // Each tick keeps its day, so it's compared with *that day's* reminder (work days and days off differ).
  if (isDone(h, d) && k === keyOf(today())) {
    const n = new Date();
    h.tickTimes = (h.tickTimes || []).concat({ d: k, m: n.getHours() * 60 + n.getMinutes() }).slice(-14);
  }
}

// Typical time of day a habit gets done (circular median of recent ticks), or null with < 5 ticks.
export function usualTime(h) {
  const t = (h.tickTimes || []).map(x => typeof x === "number" ? x : x.m);
  if (t.length < 5) return null;
  // Rotate so the gap in the day with no ticks sits at midnight, then take the plain median.
  const sorted = t.slice().sort((a, b) => a - b);
  let gapAt = 0, gap = -1;
  sorted.forEach((m, i) => { const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 1440; if (next - m > gap) { gap = next - m; gapAt = (i + 1) % sorted.length; } });
  const shift = sorted[gapAt];
  const rel = sorted.map(m => (m - shift + 1440) % 1440).sort((a, b) => a - b);
  return (rel[Math.floor(rel.length / 2)] + shift) % 1440;
}
export function setCount(h, d, n) {
  const k = keyOf(d);
  n = Math.max(0, Math.round(n));
  if (!n) delete h.history[k]; else h.history[k] = h.type === "count" ? n : true;
}
// Skips are planned: today or a day ahead. Past days need a rest day, a break or a streak repair
// (an already-skipped past day can still be unskipped).
export const canSkip = (h, d) => rawVal(h, d) === "skip" || daysBetween(today(), d) >= 0;
export function toggleSkip(h, d) {
  const k = keyOf(d);
  if (h.history[k] === "skip") delete h.history[k]; else h.history[k] = "skip";
}

/* ---------- streaks & rates ---------- */
function weeklyStreak(h) {
  const per = h.schedule.perWeek || 1;
  let ws = startOfWeek(today()), s = 0, guard = 0;
  if (weekCount(h, ws) < per) ws = addDays(ws, -7); // current week still in progress
  while (guard++ < 260 && ws >= startOfWeek(startDate(h))) {
    if (weekCount(h, ws) >= per) s++; else break;
    ws = addDays(ws, -7);
  }
  return s;
}

// "Never miss twice": in forgiving mode (the default) a single missed day doesn't break a streak —
// it just doesn't add to it. Two missed days in a row do. Skips, rest days and pauses never count.
// Streaks walk back through up to a year of history, and Today/Insights ask for them on every
// draw. Each result is remembered until anything it depends on changes (history, schedule,
// rests/pauses, streak mode, or the day itself) — a fingerprint check is far cheaper than the walk.
const streakMemo = new WeakMap();
function fingerprint(h) {
  const s = JSON.stringify([keyOf(today()), h.history, h.repaired, h.schedule, h.pastSchedules, h.archived, h.type, h.target, h.pastTargets,
    state && state.restDays, state && state.pauses, state && state.excused, state && state.settings && state.settings.streakMode, state && state.settings && state.settings.weekStart,
    state && state.profile && state.profile.schedule, state && state.profile && state.profile.faith && state.profile.faith.muslim && state.profile.faith.muslim.hijriAdjust]);
  let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return s.length + ":" + x;
}
function memo(h, kind, compute) {
  const fp = fingerprint(h);
  let m = streakMemo.get(h);
  if (!m || m.fp !== fp) { m = { fp }; streakMemo.set(h, m); }
  if (!(kind in m)) m[kind] = compute();
  return m[kind];
}

export function currentStreak(h) { return memo(h, "cur", () => currentStreakRaw(h)); }
export function bestStreak(h) { return memo(h, "best", () => bestStreakRaw(h)); }

function currentStreakRaw(h) {
  if (h.schedule.kind === "perWeek") return weeklyStreak(h);
  let d = today(), s = 0, guard = 0, missRun = 0;
  const start = startDate(h), allow = forgiving() ? 1 : 0;
  if (isScheduled(h, d) && !isDone(h, d)) d = addDays(d, -1);
  while (guard++ < 1500 && d >= start) {
    if (isScheduled(h, d)) {
      if (isDone(h, d)) { s++; missRun = 0; }
      else if (!isSkipped(h, d)) { if (++missRun > allow) break; }
    }
    d = addDays(d, -1);
  }
  return s;
}

// A streak that broke in the last week: the missed days that broke it (a gap of up to a week) and
// what the streak would be without them. Repairing it (Pro) treats those days like rest days for
// this habit only.
export function streakBreak(h) {
  if (h.schedule.kind === "perWeek") return null;
  const t = today(), start = startDate(h), allow = forgiving() ? 1 : 0;
  let d = t, run = [], guard = 0, closed = false;
  if (isScheduled(h, d) && !isDone(h, d)) d = addDays(d, -1);
  while (guard++ < 400 && d >= start) {
    if (isScheduled(h, d) && !isSkipped(h, d)) {
      if (isDone(h, d)) { if (run.length > allow) { closed = true; break; } run = []; }
      else run.push(keyOf(d));
    }
    d = addDays(d, -1);
  }
  if (!closed || run.length > 7) return null;
  if (daysBetween(fromKey(run[0]), t) > 7) return null;
  const now = currentStreak(h), before = currentStreakRaw(Object.assign({}, h, { repaired: (h.repaired || []).concat(run) }));
  return before >= 3 && before > now ? { days: run, from: run[run.length - 1], before, now } : null;
}

// The last scheduled day before today was missed and today isn't done yet:
// today decides whether the streak lives ("Missed yesterday — today keeps it alive").
export function streakAtRisk(h) {
  if (!forgiving() || h.schedule.kind === "perWeek") return false;
  const t = today();
  if (!isScheduled(h, t) || isDone(h, t) || isSkipped(h, t)) return false;
  for (let d = addDays(t, -1), i = 0; i < 60 && d >= startDate(h); d = addDays(d, -1), i++) {
    if (!isScheduled(h, d) || isSkipped(h, d)) continue;
    return !isDone(h, d) && currentStreak(h) > 0;
  }
  return false;
}

function bestStreakRaw(h) {
  const start = startDate(h), end = today();
  let best = 0, run = 0;
  if (h.schedule.kind === "perWeek") {
    const per = h.schedule.perWeek || 1;
    for (let ws = startOfWeek(start); ws <= end; ws = addDays(ws, 7)) {
      if (weekCount(h, ws) >= per) { run++; best = Math.max(best, run); } else if (ws < startOfWeek(end)) run = 0;
    }
    return best;
  }
  const allow = forgiving() ? 1 : 0;
  let missRun = 0;
  for (let d = new Date(start), i = 0; d <= end && i < 3000; d = addDays(d, 1), i++) {
    if (!isScheduled(h, d)) continue;
    if (isDone(h, d)) { run++; missRun = 0; best = Math.max(best, run); }
    else if (!isSkipped(h, d) && daysBetween(d, end) > 0 && ++missRun > allow) run = 0;
  }
  return best;
}

export function streakUnit(h) { return h.schedule.kind === "perWeek" ? "week" : "day"; }

export function completion(h, days) {
  let sched = 0, done = 0;
  const end = today(), start = startDate(h);
  if (h.schedule.kind === "perWeek") {
    const per = h.schedule.perWeek || 1;
    const from = addDays(end, -(days - 1));
    for (let ws = startOfWeek(from); ws <= end; ws = addDays(ws, 7)) {
      if (addDays(ws, 6) < start) continue;
      const c = Math.min(per, weekCount(h, ws));
      const finished = addDays(ws, 6) < end;
      sched += finished ? per : Math.max(c, 0);
      done += c;
    }
    return sched ? Math.round(done / sched * 100) : null;
  }
  for (let i = 0; i < days; i++) {
    const d = addDays(end, -i);
    if (d < start) break;
    if (!isScheduled(h, d) || isSkipped(h, d)) continue;
    if (i === 0 && !isDone(h, d)) continue; // today isn't over yet
    sched++;
    if (isDone(h, d)) done++;
  }
  // Nothing was due (a fast out of season, a yearly day): no score, rather than 0% — the
  // two-year test found Great Lent "0%" all summer, ranked last and dragging averages down.
  return sched ? Math.round(done / sched * 100) : null;
}

export function totalDone(h) {
  return Object.keys(h.history).filter(k => h.history[k] !== "skip" && isDone(h, fromKey(k))).length;
}

// Aggregate over all active habits for a day: { sched, done }
export function dayScore(d, list) {
  list = list || activeHabits();
  let sched = 0, done = 0;
  for (const h of list) {
    const st = status(h, d);
    if (st === "open") sched++;
    else if (st === "done") { sched++; done++; }
  }
  return { sched, done };
}

export function nextDue(h, from) {
  let d = from || addDays(today(), 1);
  for (let i = 0; i < 400; i++, d = addDays(d, 1)) if (isScheduled(h, d)) return d;
  return null;
}

/* ---------- text ---------- */
function dayList(days) {
  const ord = weekOrder().filter(x => (days || []).includes(x));
  if (ord.length === 7) return "every day";
  if (ord.length === 5 && [1, 2, 3, 4, 5].every(x => ord.includes(x))) return "Mon–Fri";
  if (ord.length === 5 && [0, 1, 2, 3, 4].every(x => ord.includes(x))) return "Sun–Thu";
  return ord.map(x => DAY_SHORT[x]).join(", ") || "no days picked";
}

export function describeSchedule(h) {
  const s = h.schedule;
  let txt;
  switch (s.kind) {
    case "daily": txt = "Every day"; break;
    case "days": txt = dayList(s.days); txt = txt[0].toUpperCase() + txt.slice(1); break;
    case "perWeek": txt = (s.perWeek || 1) + "× a week, any days"; break;
    case "interval": txt = (s.n || 1) === 1 ? "Every day" : "Every " + s.n + " days"; break;
    case "weeks": txt = dayList(s.days) + ((s.n || 1) === 1 ? " every week" : ", every " + s.n + " weeks"); txt = txt[0].toUpperCase() + txt.slice(1); break;
    case "monthly": txt = s.monthDay === "last" ? "Last day of each month" : "Monthly on the " + ordinal(+s.monthDay || 1); break;
    case "months": {
      const day = fromKey(s.start || keyOf(today())).getDate();
      txt = ((s.n || 1) === 1 ? "Monthly" : "Every " + s.n + " months") + " on the " + ordinal(day); break;
    }
    case "yearly":
      txt = s.occasion ? OCCASION_NAMES[s.occasion] + " each year" : "Every year on " + fmtDate(new Date(2024, (+s.month || 1) - 1, +s.monthDay || 1), { day: "numeric", month: "long" }); break;
    default: txt = "Every day";
  }
  if (s.onlyOn === "work" && hasWork()) txt += " · work days";
  if (s.onlyOn === "off" && hasWork()) txt += " · days off";
  if (s.hijriMonth && !(s.hijriDays && s.hijriDays.length)) txt += " · " + HIJRI_MONTHS[s.hijriMonth - 1] + " only";
  if (s.season && SEASONS[s.season]) txt += " · " + SEASONS[s.season].name + " only";
  if (s.observance) txt = { "jewish-fast": "On Jewish fast days", "jewish-major": "On Yom Kippur and Tisha B'Av", "jewish-minor": "On the minor fast days", "jewish-eve": "The day before Yom Kippur and Tisha B'Av" }[s.observance]
    || (/^hindu:ekadashi/.test(s.observance) ? "On Ekadashi (twice a month)" : /^hindu:purnima/.test(s.observance) ? "On Purnima (full moon)" : "On Amavasya (new moon)");
  if (s.end) txt += " · until " + fmtDate(fromKey(s.end), { day: "numeric", month: "short", year: "numeric" });
  if (s.hijriDays && s.hijriDays.length) {
    const ds = s.hijriDays, run = ds.length > 2 && ds.every((x, i) => !i || x === ds[i - 1] + 1);
    const which = run ? ordinal(ds[0]) + "–" + ordinal(ds[ds.length - 1]) : ds.map(ordinal).join(", ");
    txt = s.hijriMonth ? which + " " + HIJRI_MONTHS[s.hijriMonth - 1] + " each year" : "Hijri " + which + " of each month";
  }
  return txt;
}

export function progressLabel(h, d) {
  const parts = [];
  if (h.type === "count") parts.push(value(h, d) + "/" + target(h, d) +(h.unit ? " " + h.unit : ""));
  if (h.schedule.kind === "perWeek") parts.push(weekCount(h, d) + "/" + (h.schedule.perWeek || 1) + " this week");
  return parts.join(" · ");
}

export function scheduledOn(d) {
  return activeHabits().filter(h => isScheduled(h, d));
}

