// Reminder delivery. One planner, two delivery paths:
//  • Native app (Capacitor build): OS-scheduled local notifications — fire
//    reliably with the app closed, with Done / Snooze actions.
//  • Web / PWA: service-worker notifications. Uses Notification Triggers where
//    the browser supports them; otherwise fires while the app is open or
//    recently backgrounded.
// The plan is rebuilt on every save, so finishing a habit cancels its reminders.

import { state, activeHabits, findHabit, save } from "./store.js";
import { today, habitDayOf, addDays, keyOf, fromKey, momentFor, toMin, fmtTime, fmtDate, getLocale, startOfWeek } from "./dates.js";
import { weeklyReview } from "./review.js";
import { soundFor, SOUNDS } from "./sounds.js";
import { isScheduled, status, target, value, tap, isMedicine } from "./schedule.js";
import { reminderMinutes } from "./reminders.js";
import { sleepFor, hasWork } from "./routine.js";
import { eventsOn } from "./calendars.js";
import { prayerMinutes } from "./faith.js";
import { PRAYERS } from "./prayer.js";
import { tr, trText } from "./i18n.js";
import { riskyWindow } from "./quits.js";
import { nextStart } from "./cycle.js";
const daysBetweenKeys = (a, b) => Math.round((fromKey(keyOf(b)) - fromKey(keyOf(a))) / 86400e3);

const HORIZON_H = 48;
const NATIVE_MAX = 60; // iOS keeps at most 64 pending local notifications
const NATIVE_HOURS = 72;
let timers = [];
let swReg = null;
let actionHandler = null;

const Cap = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? window.Capacitor : null;
const LN = () => { const c = Cap(); return c && c.Plugins && c.Plugins.LocalNotifications; };

export function platform() {
  if (LN()) return "native";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  return "web";
}
export function hasTriggers() { return typeof window.TimestampTrigger === "function" && "showTrigger" in Notification.prototype; }

export async function permission() {
  const ln = LN();
  if (ln) { try { const p = await ln.checkPermissions(); return p.display === "granted" ? "granted" : p.display === "denied" ? "denied" : "default"; } catch (e) { return "default"; } }
  if (platform() === "unsupported") return "unsupported";
  return Notification.permission;
}

export async function requestPermission() {
  const ln = LN();
  if (ln) { const p = await ln.requestPermissions(); return p.display === "granted" ? "granted" : "denied"; }
  if (platform() === "unsupported") return "unsupported";
  return Notification.requestPermission();
}

export function deliveryNote() {
  const p = platform();
  if (p === "native") return "Reminders are scheduled on your phone and arrive even when Waqti is closed.";
  if (p === "unsupported") return "This browser can't show notifications. Add Waqti to your home screen or use the Android/iOS app build.";
  if (hasTriggers()) return "Reminders are scheduled with the browser and can arrive while Waqti is closed.";
  return "In the browser, reminders arrive while Waqti is open or running in the background. For alarm-style reminders with the app closed, use the Android/iOS app build.";
}

/* ---------- planning ---------- */
// Quiet hours: by default they follow each day's own sleep (work days and days off differ — a night
// nurse sleeps 8:30–15:30 after a shift but 1:00–9:00 on a day off). "follow: false" keeps fixed times.
export function quietWindow(d) {
  const q = state.settings.notify.quiet;
  if (q && q.follow !== false && d && hasWork()) { const sl = sleepFor(d); return { from: sl.bed, to: sl.wake }; }
  return { from: q && q.from, to: q && q.to };
}
function inQuiet(min, d) {
  const q = state.settings.notify.quiet;
  if (!q || !q.on) return false;
  const w = quietWindow(d), a = toMin(w.from), b = toMin(w.to);
  if (a == null || b == null || a === b) return false;
  return a < b ? (min >= a && min < b) : (min >= a || min < b);
}

function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000;
}

// Prayers that fell inside quiet hours: one reminder when quiet hours end, saying whether
// the prayer's time is still running (e.g. Dhuhr until Asr) or it should be made up.
const NEXT_POINT = { fajr: "sunrise", dhuhr: "asr", asr: "maghrib", maghrib: "isha", isha: "fajr" };
function wakeCatchUps(list, d, dk, n) {
  if (!list.length) return [];
  const to = toMin(quietWindow(d).to);
  const groups = new Map();
  for (const c of list) {
    const prayerAt = momentFor(d, c.m);
    const at = new Date(prayerAt.getTime() + (((to - c.m) % 1440 + 1440) % 1440 + 5) * 60000);
    const id = c.h.source.split(":")[1], next = NEXT_POINT[id];
    const cal = new Date(prayerAt.getFullYear(), prayerAt.getMonth(), prayerAt.getDate());
    const endDay = id === "isha" ? addDays(cal, 1) : cal;
    const endAt = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), 0, prayerMinutes(endDay)[next]);
    const k = at.getTime();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ h: c.h, id, open: at < endAt, endAt, next });
  }
  const out = [];
  groups.forEach((items, k) => {
    const at = new Date(k);
    const name = x => trText(PRAYERS.find(p => p.id === x.id).name);
    const one = items.length === 1 ? items[0] : null;
    const body = one
      ? (one.open
        ? tr("Its time lasts until {p} · {t}", { p: trText(one.next === "sunrise" ? "Sunrise" : PRAYERS.find(p => p.id === one.next).name), t: fmtTime(one.endAt.getHours() * 60 + one.endAt.getMinutes()) })
        : tr("Its time has passed — make it up (qada) when you can."))
      : tr("Tap to see which are still on time.");
    out.push({
      key: "wake|" + dk + "|" + items.map(x => x.id).join(","), at, kind: "habit",
      title: "🕌 " + (one ? tr("{p} — prayed yet?", { p: name(one) }) : tr("Prayers while you slept: {list}", { list: items.map(name).join(", ") })),
      body, habitId: one ? one.h.id : null, day: dk
    });
  });
  return out;
}

// Heads-ups days before a due date (birthdays, bills, renewals): "🎂 Mom's birthday — in 7 days".
// Sent at the habit's own reminder time on that day, or 9 AM; quiet hours still apply.
export function leadReminders(h, d, dk) {
  const lead = (h.reminders && h.reminders.lead) || [];
  if (!lead.length) return [];
  const out = [];
  for (const n of lead) {
    const due = addDays(d, n);
    if (!(n > 0) || !isScheduled(h, due) || status(h, due) === "done") continue;
    const mins = reminderMinutes(h, due), m = (h.reminders.on && mins.length ? mins[0] : 540) % 1440;
    if (inQuiet(m, d)) continue;
    const when = n === 1 ? tr("tomorrow") : tr("in {n} days", { n });
    const amount = h.bill && +h.bill.amount ? " · " + (+h.bill.amount).toLocaleString() + " " + (state.settings.currency || "") : "";
    out.push({ key: "lead|" + h.id + "|" + keyOf(due) + "|" + n, at: momentFor(d, m), kind: "lead", day: dk,
      title: h.private ? PRIVATE_TITLE() : h.emoji + " " + trText(h.name) + " — " + when,
      body: h.private ? tr("A heads-up for a few days from now.") : fmtDate(due, { weekday: "long", day: "numeric", month: "long" }) + amount });
  }
  return out;
}

// "Keep private" habits and trackers never show their name or emoji on the lock screen.
export const PRIVATE_TITLE = () => "🔒 " + tr("Waqti reminder");
const label = h => h.private ? PRIVATE_TITLE() : h.emoji + " " + trText(h.name);

// Count habits get a "+1 glass" style button on their reminders, so they can be logged without opening the app.
export function plusLabel(h) {
  if (h.type !== "count") return null;
  const step = h.step || 1;
  return "+" + step + (h.unit ? " " + trText(h.unit) : "");
}
// Native: one action type per count habit (button titles are fixed per type), plus the shared one.
async function registerActions(ln) {
  const types = [{ id: "HABIT", actions: [{ id: "done", title: tr("✓ Done") }, { id: "snooze", title: tr("Snooze 10 min") }] },
    { id: "BUNDLE", actions: [{ id: "done", title: tr("✓ Done all") }, { id: "snooze", title: tr("Snooze 10 min") }] }];
  // Medicine in a combined reminder is ticked dose by dose in the app, so that bundle has no "Done all".
  types.push({ id: "BUNDLE_MED", actions: [{ id: "snooze", title: tr("Snooze 10 min") }] });
  for (const h of activeHabits()) if (h.type === "count") types.push({ id: "COUNT_" + h.id, actions: [{ id: "plus", title: plusLabel(h) }, { id: "done", title: tr("✓ Done") }] });
  try { await ln.registerActionTypes({ types }); } catch (e) { /* ignore */ }
}
// Android plays a notification's sound from its channel, so each sound gets one channel.
let channelsMade = false;
async function ensureChannels(ln) {
  if (channelsMade || !ln.createChannel || !window.Capacitor.getPlatform || window.Capacitor.getPlatform() !== "android") return;
  channelsMade = true;
  for (const s of SOUNDS) {
    try { await ln.createChannel({ id: channelId(s.file), name: trText(s.label), importance: 4, sound: s.file ? s.file + ".wav" : undefined, vibration: true, visibility: 1 }); } catch (e) { /* ignore */ }
  }
}
const channelId = file => file ? "waqti_" + file : "waqti_default";

export function plan(hours) {
  if (!state || !state.onboarded) return [];
  const n = state.settings.notify;
  const horizon = hours || HORIZON_H;
  const now = Date.now(), end = now + horizon * 3600e3;
  const out = [];
  const t0 = today();
  for (let i = 0; i <= Math.ceil(horizon / 24); i++) {
    const d = addDays(t0, i), dk = keyOf(d);
    const dueToday = [], catchUp = [];
    for (const h of activeHabits()) {
      out.push(...leadReminders(h, d, dk));
      if (!isScheduled(h, d)) continue;
      const st = status(h, d);
      if (st === "done" || st === "skip" || st === "met") continue;
      dueToday.push(h);
      const mins = reminderMinutes(h, d).sort((a, b) => momentFor(d, a) - momentFor(d, b));
      const faith = h.category === "Faith";
      const fard = /^faith:(fajr|dhuhr|asr|maghrib|isha)$/.test(h.source || "");
      // Prayers during sleep: "smart" lets Fajr (and Qiyam/suhoor) wake you and reminds you of
      // the others when you wake; "ring" wakes you for all; "wake" reminds on waking for all.
      const mode = n.sleepPrayers || "smart";
      const ringInQuiet = faith && (mode === "ring" || (mode === "smart" && (!fard || h.source === "faith:fajr")));
      mins.forEach((m, idx) => {
        if (inQuiet(m, d) && !ringInQuiet) {
          if (fard && idx === mins.length - 1) catchUp.push({ h, m });
          return;
        }
        const at = momentFor(d, m);
        const body = h.private ? tr("Open Waqti to see it.") : h.type === "count"
          ? value(h, d) + " of " + target(h) + (h.unit ? " " + h.unit : "") + tr(" so far")
          : (h.notes ? trText(h.notes) : tr("Tap Done when you've finished."));
        out.push({ key: h.id + "|" + dk + "|" + m, at, title: label(h), body, habitId: h.id, day: dk, kind: "habit", repeat: h.reminders.mode === "interval", plus: plusLabel(h), sound: soundFor(h).file, primary: idx === mins.length - 1 });
        if (idx === mins.length - 1 && h.reminders.nag) {
          const nagAt = new Date(at.getTime() + h.reminders.nag * 60000);
          const nm = nagAt.getHours() * 60 + nagAt.getMinutes();
          if (!inQuiet(nm, d) || ringInQuiet) out.push({ key: h.id + "|" + dk + "|nag", at: nagAt, title: h.private ? PRIVATE_TITLE() : tr("Still to do: ") + h.emoji + " " + trText(h.name), body: tr("Not marked yet — tap Done if you already did it."), habitId: h.id, day: dk, kind: "nag" });
        }
      });
    }
    out.push(...wakeCatchUps(catchUp, d, dk, n));
    if (n.morning.on && dueToday.length) {
      const at = momentFor(d, toMin(n.morning.time));
      out.push({ key: "am|" + dk, at, title: "☀️ " + tr("Your day: {n} habits", { n: dueToday.length }), body: dueToday.filter(h => !h.private).slice(0, 4).map(h => h.emoji + " " + trText(h.name)).join(" · "), kind: "summary", day: dk });
    }
    if (n.evening.on && dueToday.length) {
      const at = momentFor(d, toMin(n.evening.time));
      out.push({ key: "pm|" + dk, at, title: "🌙 " + tr("{n} left today", { n: dueToday.length }), body: tr("Quick check-in — log what you did or skip what you can't."), kind: "summary", day: dk });
    }
    // Weekly review: first day of the week, half an hour after the start-of-day plan.
    if (n.weekly && n.weekly.on && keyOf(startOfWeek(d)) === dk) {
      const r = weeklyReview(d);
      if (r && state.reviewSeen !== r.key) {
        const at = momentFor(d, (toMin(n.morning.time) || 480) + 30);
        out.push({ key: "week|" + dk, at, title: "🗓️ " + tr("Your week in review is ready"), body: tr("{p}% kept last week — open Waqti for what worked and one tip for this week.", { p: r.pct }), kind: "summary", day: dk });
      }
    }
  }
  // One-off tasks with a reminder
  for (const tk of state.tasks || []) {
    if (tk.done || !tk.date || tk.remind == null) continue;
    const d = fromKey(tk.date);
    const base = tk.time ? momentFor(d, toMin(tk.time)) : momentFor(d, toMin(n.morning.time) || 480);
    const at = new Date(base.getTime() - (tk.time ? (+tk.remind || 0) * 60000 : 0));
    const m = at.getHours() * 60 + at.getMinutes();
    if (inQuiet(m, d) && tk.priority !== "high") continue;
    out.push({ key: "task|" + tk.id + "|" + at.getTime(), at, title: (tk.emoji || "📝") + " " + tk.title, body: tk.time ? (tk.remind ? "At " + fmtTime(tk.time) : "Now") + (tk.notes ? " · " + tk.notes.slice(0, 80) : "") : "On your list for today", kind: "task", day: tk.date });
  }
  // Quit trackers: a heads-up 15 minutes before the time urges and slips cluster.
  for (const q of state.quits || []) {
    const w = q.riskRemind === false ? null : riskyWindow(q);
    if (!w) continue;
    for (let i = 0; i <= Math.ceil(horizon / 24); i++) {
      const d = addDays(t0, i), at = momentFor(d, (w.from - 15 + 1440) % 1440), m = at.getHours() * 60 + at.getMinutes();
      if (inQuiet(m, d)) continue;
      out.push({ key: "quit|" + q.id + "|" + keyOf(d), at, title: q.private ? PRIVATE_TITLE() : q.emoji + " " + tr("Heads-up: this is your hardest time"), body: q.private ? tr("A heads-up for later today.") : q.replacement ? tr("Your plan: {p}", { p: q.replacement }) : tr("Tap “I have an urge” if it hits — two minutes is enough."), kind: "summary", day: keyOf(d) });
    }
  }
  // Period tracker: one private heads-up a couple of days before the estimated start.
  const cy = state.cycle;
  if (cy && cy.on && cy.remind) {
    const ns = nextStart(t0);
    if (ns) {
      const day = addDays(ns, -cy.remind), at = momentFor(day, 540);
      if (daysBetweenKeys(t0, day) >= 0) out.push({ key: "cycle|" + keyOf(ns), at, kind: "summary", day: keyOf(day), title: PRIVATE_TITLE(), body: tr("A heads-up from your tracker.") });
    }
  }
  // Meetings from connected calendars
  const mr = state.calendars && state.calendars.meetingRemind;
  if (mr) {
    const seen = new Set();
    for (let i = 0; i <= Math.ceil(horizon / 24); i++) {
      for (const e of eventsOn(addDays(new Date(), i))) {
        if (e.allDay || seen.has(e.id)) continue;
        seen.add(e.id);
        const at = new Date(e.start - mr * 60000);
        out.push({ key: "ev|" + e.id + "|" + e.start, at, title: "📅 " + e.title, body: "Starts at " + fmtTime(new Date(e.start).getHours() * 60 + new Date(e.start).getMinutes()) + (e.provider ? " · tap to open, then Join" : e.location ? " · " + e.location : ""), kind: "meeting", day: keyOf(new Date(e.start)) });
      }
    }
  }
  // The daily limit is applied to whole days first (including reminders earlier today), then the
  // window is cut — otherwise re-planning at noon would ignore the morning and let the afternoon overflow.
  return withinBudget(n.bundle === false ? out : bundleSameTime(out), n.maxPerDay).filter(x => x.at.getTime() > now + 5000 && x.at.getTime() <= end)
    .sort((a, b) => a.at - b.at)
    .map(x => Object.assign(x, { nid: hashId(x.key) }));
}

/* ---------- same-time reminders become one ----------
 * A year's test: a retiree's 8 AM was three medicine alerts and a prayer reminder in a row.
 * Habits due at the same minute (with the same sound) now arrive as one notification —
 * "💊 Diabetes medicine + 2 more" — with a "Done all" button. Count habits keep their own
 * "+1" reminder, and "repeat in a window" reminders (water) stay separate. */
export function bundleSameTime(items) {
  const groups = new Map(), out = [];
  for (const x of items) {
    if (x.kind !== "habit" || !x.habitId || x.repeat || x.plus || String(x.key).startsWith("wake|")) { out.push(x); continue; }
    const k = x.day + "|" + x.at.getTime() + "|" + (x.sound || "");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  groups.forEach(list => {
    if (list.length === 1) { out.push(list[0]); return; }
    const hs = list.map(x => findHabit(x.habitId)).filter(Boolean);
    const first = list[0], open = hs.filter(h => !h.private), med = hs.some(isMedicine);
    out.push({
      key: "bundle|" + first.day + "|" + first.at.getTime() + "|" + list.map(x => x.habitId).sort().join(","),
      at: first.at, day: first.day, kind: "habit", sound: first.sound, members: list, med,
      habitId: list.map(x => x.habitId).join(","), primary: list.some(x => x.primary !== false),
      title: open.length ? label(open[0]) + tr(" + {n} more", { n: hs.length - 1 }) : PRIVATE_TITLE(),
      body: (open.length ? open.map(label).join(" · ") : tr("Open Waqti to see it.")) + (med ? " — " + tr("open Waqti to tick each dose") : "")
    });
  });
  return out;
}

/* ---------- daily reminder limit ----------
 * A month's test showed ~30 alerts a day for a night-shift worker with prayers and water.
 * Each day keeps at most `maxPerDay` (default 20). What goes first, lowest priority first:
 * every other "repeat while awake" reminder (water) → summaries and ordinary follow-ups →
 * ordinary habit reminders. Prayers (the five), medicine, tasks and meetings are kept. */
const FARD = /^faith:(fajr|dhuhr|asr|maghrib|isha)$/;
export function essential(h) { return !!h && (FARD.test(h.source || "") || h.category === "Health"); }
function priority(x) {
  if (x.members) return Math.min(...x.members.map(priority));
  if (x.kind === "task" || x.kind === "meeting" || String(x.key).startsWith("wake|")) return 0;
  const h = x.habitId && findHabit(x.habitId);
  // Only the main reminder of a prayer or medicine is guaranteed; its "10 min before" and its
  // follow-up rank with ordinary reminders (a year's test: they crowded out every Sunnah/Quran reminder).
  if (x.kind === "nag") return 2;
  if (x.kind === "summary") return 2;
  if (x.repeat) return 3;
  return essential(h) && x.primary !== false ? 0 : 1;
}
// How many lower-priority reminders the daily limit is holding back in the next 24 hours.
let counting = false; // plan() → weekly review → heldBack24h() → plan(): don't recurse
export function heldBack24h() {
  if (!state || !state.onboarded || counting) return 0;
  counting = true;
  try {
    const n = state.settings.notify, cap = n.maxPerDay;
    // Count over the whole of today and tomorrow, like the limit itself.
    const day = items => items.filter(x => x.day === keyOf(today())).length;
    n.maxPerDay = 0; const all = day(plan(48)); n.maxPerDay = cap;
    return Math.max(0, all - day(plan(48)));
  } finally { counting = false; }
}
export function withinBudget(items, cap) {
  cap = cap == null ? 20 : +cap;
  if (!cap) return items;
  const byDay = new Map();
  items.forEach(x => { const k = x.day || ""; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x); });
  const drop = new Set();
  for (const list of byDay.values()) {
    let extra = list.length - cap;
    if (extra <= 0) continue;
    // Drop order: highest priority number first; repeats thinned evenly (every other one).
    const ranked = list.slice().sort((a, b) => a.at - b.at).map((x, i) => ({ x, p: priority(x), i }))
      .sort((a, b) => (b.p - a.p) || ((b.i % 2) - (a.i % 2)) || (b.x.at - a.x.at));
    for (const r of ranked) { if (extra <= 0 || r.p === 0) break; drop.add(r.x); extra--; }
  }
  return items.filter(x => !drop.has(x));
}

/**
 * Choose which reminders fit in the phone's pending-notification limit (iOS keeps 64).
 * The next 24 hours are always kept; after that prayers, tasks, meetings and normal reminders
 * win over high-frequency repeats (e.g. water every 30 min). The last slot is a "keep your
 * reminders coming" nudge, timed just before the first important reminder that didn't fit
 * (or the morning after the planned window), so it only appears if the app isn't opened.
 */
export function pickNative(items, max, now, morningMin) {
  const soon = now + 24 * 3600e3;
  const rank = i => (i.at.getTime() <= soon ? 0 : i.repeat ? 2 : 1);
  const ordered = items.slice().sort((a, b) => rank(a) - rank(b) || a.at - b.at);
  const chosen = ordered.slice(0, max - 1).sort((a, b) => a.at - b.at);
  // Only reminders after the first 24h count here: opening the app re-plans those, whereas an
  // overflow inside the next 24h can't be fixed by a nudge and would just nag after every save.
  const dropped = ordered.slice(max - 1).filter(i => rank(i) === 1).sort((a, b) => a.at - b.at);
  let nudgeAt;
  if (dropped.length) {
    nudgeAt = new Date(Math.max(dropped[0].at.getTime() - 30 * 60000, now + 60 * 60000));
  } else {
    const lastAt = chosen.length ? chosen[chosen.length - 1].at : new Date(now + 24 * 3600e3);
    nudgeAt = momentFor(addDays(habitDayOf(lastAt.getTime()), 1), morningMin);
  }
  chosen.push({ nid: 7, key: "keepalive", at: nudgeAt, title: tr("🌱 Keep your reminders coming"), body: tr("Open Waqti to schedule your next few days of reminders."), kind: "keepalive" });
  return chosen;
}

/* ---------- delivery ---------- */
export async function reschedule() {
  clearTimers();
  if (!state || !state.settings.notify.enabled) { await cancelNative(); return; }
  if ((await permission()) !== "granted") return;
  const ln = LN();
  if (ln) {
    await cancelNative();
    await ensureChannels(ln);
    await registerActions(ln);
    // Plan further ahead on phones, within the OS limit, and end with a nudge that only
    // shows if Waqti hasn't been opened (every open re-plans and replaces it).
    const items = pickNative(plan(NATIVE_HOURS), NATIVE_MAX, Date.now(), toMin(state.settings.notify.morning.time) || 540);
    if (items.length) {
      await ln.schedule({
        notifications: items.map(i => ({
          id: i.nid, title: i.title, body: i.body,
          schedule: { at: i.at, allowWhileIdle: true },
          actionTypeId: i.habitId ? (i.plus ? "COUNT_" + i.habitId : i.members ? (i.med ? "BUNDLE_MED" : "BUNDLE") : "HABIT") : undefined,
          sound: i.sound ? i.sound + ".wav" : undefined,   // iOS: file in the app bundle
          channelId: channelId(i.sound),                   // Android: the channel carries the sound
          extra: { habitId: i.habitId || null, day: i.day }
        }))
      });
    }
    return;
  }
  const items = plan();
  const reg = await getReg();
  if (!reg) return;
  if (hasTriggers()) {
    try {
      const existing = await reg.getNotifications({ includeTriggered: true });
      existing.forEach(nt => nt.data && nt.data.planned && nt.close());
      for (const i of items) {
        await reg.showNotification(i.title, Object.assign(options(i), { showTrigger: new window.TimestampTrigger(i.at.getTime()) }));
      }
      return;
    } catch (e) { /* fall back to timers */ }
  }
  for (const i of items) {
    const ms = i.at.getTime() - Date.now();
    if (ms > 0 && ms < 2 ** 31 - 1) timers.push(setTimeout(() => fire(i), ms));
  }
}

function options(i) {
  return {
    body: i.body, tag: i.key, renotify: true,
    icon: "icons/icon-192.png", badge: "icons/badge-72.png",
    vibrate: state.settings.notify.vibrate ? [180, 80, 180] : undefined,
    data: { habitId: i.habitId || null, day: i.day, planned: true },
    actions: !i.habitId ? [] : i.plus ? [{ action: "plus", title: i.plus }, { action: "done", title: tr("✓ Done") }] : i.med ? [{ action: "snooze", title: tr("Snooze 10 min") }] : [{ action: "done", title: i.members ? tr("✓ Done all") : tr("✓ Done") }, { action: "snooze", title: tr("Snooze 10 min") }]
  };
}

async function fire(i) {
  const reg = await getReg();
  if (reg) reg.showNotification(i.title, options(i));
  else if ("Notification" in window) new Notification(i.title, { body: i.body });
}

function clearTimers() { timers.forEach(clearTimeout); timers = []; }

async function cancelNative() {
  const ln = LN();
  if (!ln) return;
  try {
    const p = await ln.getPending();
    if (p.notifications && p.notifications.length) await ln.cancel({ notifications: p.notifications.map(x => ({ id: x.id })) });
  } catch (e) { /* ignore */ }
}

async function getReg() {
  if (swReg) return swReg;
  if (!("serviceWorker" in navigator)) return null;
  try { swReg = await navigator.serviceWorker.ready; } catch (e) { swReg = null; }
  return swReg;
}

export async function testNotification() {
  const ln = LN();
  const i = { key: "test", title: "🌱 Waqti reminder test", body: "This is how your habit reminders will look.", habitId: null, day: keyOf(today()), at: new Date(Date.now() + 3000) };
  if (ln) { await ln.schedule({ notifications: [{ id: 1, title: i.title, body: i.body, schedule: { at: i.at } }] }); return; }
  fire(i);
}

// `habitId` may be several ids joined with "," (a combined reminder): they snooze together.
export async function snooze(habitId, minutes) {
  const hs = String(habitId || "").split(",").map(findHabit).filter(Boolean);
  if (!hs.length) return;
  const h = hs[0], many = hs.length > 1, ids = hs.map(x => x.id).join(",");
  const med = many && hs.some(isMedicine);
  const i = { key: ids + "|snooze|" + Date.now(), at: new Date(Date.now() + minutes * 60000), title: "⏰ " + label(h) + (many ? tr(" + {n} more", { n: hs.length - 1 }) : ""), body: many ? hs.map(label).join(" · ") : tr("Snoozed reminder"), habitId: ids, members: many ? hs : null, med, day: keyOf(today()) };
  const ln = LN();
  if (ln) { await ln.schedule({ notifications: [{ id: hashId(i.key), title: i.title, body: i.body, schedule: { at: i.at, allowWhileIdle: true }, actionTypeId: med ? "BUNDLE_MED" : many ? "BUNDLE" : "HABIT", extra: { habitId: ids, day: i.day } }] }); return; }
  const reg = await getReg();
  if (reg && hasTriggers()) { reg.showNotification(i.title, Object.assign(options(i), { showTrigger: new window.TimestampTrigger(i.at.getTime()) })); return; }
  timers.push(setTimeout(() => fire(i), minutes * 60000));
}

// Done/snooze from a notification (service worker message, native action, or ?action= URL).
export function handleAction(action, habitId, dayKey) {
  const ids = String(habitId || "").split(",").filter(Boolean);
  if (ids.length > 1) {
    // A combined reminder: "Done all" ticks every habit in it; snooze keeps them together.
    const hs = ids.map(findHabit).filter(Boolean);
    if (!hs.length) return;
    const d = dayKey ? fromKey(dayKey) : today();
    const many = { name: tr("{n} habits", { n: hs.length }) };
    if (action === "done") {
      // Never tick medicine in bulk: each dose is confirmed on its own in the app.
      hs.filter(h => !isMedicine(h)).forEach(h => { if (h.type === "count") { if (value(h, d) < target(h)) tap(h, d); } else if (!h.history[keyOf(d)] || h.history[keyOf(d)] === "skip") tap(h, d); });
      save();
      if (actionHandler) actionHandler("done", many);
    } else if (action === "snooze") {
      snooze(ids.join(","), 10);
      if (actionHandler) actionHandler("snooze", many);
    }
    return;
  }
  const h = findHabit(habitId);
  if (!h) return;
  const d = dayKey ? fromKey(dayKey) : today();
  if (action === "done") {
    if (h.type === "count") { if (value(h, d) < target(h)) tap(h, d); }
    else if (!h.history[keyOf(d)] || h.history[keyOf(d)] === "skip") tap(h, d);
    save();
    if (actionHandler) actionHandler("done", h);
  } else if (action === "plus") {
    if (value(h, d) < target(h)) tap(h, d);
    save();
    if (actionHandler) actionHandler("plus", h, d);
  } else if (action === "snooze") {
    snooze(h.id, 10);
    if (actionHandler) actionHandler("snooze", h);
  }
}

export function initNotifications(onAction) {
  actionHandler = onAction;
  const ln = LN();
  if (ln) {
    if (state) registerActions(ln);
    ln.addListener("localNotificationActionPerformed", ev => {
      const ex = (ev.notification && ev.notification.extra) || {};
      if (ex.habitId && ["done", "snooze", "plus"].includes(ev.actionId)) handleAction(ev.actionId, ex.habitId, ex.day);
    });
  } else if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", ev => {
      const m = ev.data || {};
      if (m.type === "notification-action") handleAction(m.action, m.habitId, m.day);
    });
  }
  // Opened from a notification while the app was closed
  const q = new URLSearchParams(location.search);
  if (q.get("action") && q.get("habit")) {
    const a = q.get("action"), id = q.get("habit"), dk = q.get("day");
    history.replaceState(null, "", location.pathname);
    setTimeout(() => handleAction(a, id, dk), 300);
  }
  // Re-plan when coming back to the app (days roll over, prayer times shift).
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reschedule(); });
}

// Android 12+: exact alarms need the user's OK; without it reminders can drift by minutes.
export async function exactAlarmStatus() {
  const ln = LN();
  if (!ln || !window.Capacitor.getPlatform || window.Capacitor.getPlatform() !== "android" || !ln.checkExactNotificationSetting) return "granted";
  try { const r = await ln.checkExactNotificationSetting(); return r.exact_alarm === "granted" ? "granted" : "prompt"; } catch (e) { return "granted"; }
}
export async function openExactAlarmSettings() {
  const ln = LN();
  if (ln && ln.changeExactNotificationSetting) { try { await ln.changeExactNotificationSetting(); } catch (e) { /* ignore */ } }
}

export function upcoming(limit) {
  return plan().slice(0, limit || 8).map(i => ({ when: i.at, title: i.title, kind: i.kind }));
}

export function fmtWhen(at) {
  const d = new Date(at);
  const dayLabel = keyOf(d) === keyOf(new Date()) ? tr("Today") : keyOf(d) === keyOf(addDays(new Date(), 1)) ? tr("Tomorrow") : d.toLocaleDateString(getLocale(), { weekday: "short" });
  return dayLabel + " " + fmtTime(d.getHours() * 60 + d.getMinutes());
}
