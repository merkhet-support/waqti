// Work & sleep routine. Supports day, evening and night shifts, rotating
// patterns (e.g. 4 on / 4 off), flexible hours and not working — with separate
// sleep windows for work days and days off.

import { state } from "./store.js";
import { daysBetween, fromKey, toMin, clockSpan, fromMin } from "./dates.js";

export const SHIFTS = [
  { id: "day", emoji: "🏢", title: "Day shift", desc: "e.g. 9 AM – 5 PM", start: "09:00", end: "17:00", sleep: { work: { bed: "23:00", wake: "06:30" }, off: { bed: "00:00", wake: "08:00" } } },
  { id: "evening", emoji: "🌆", title: "Midday / evening", desc: "e.g. 2 PM – 10 PM", start: "14:00", end: "22:00", sleep: { work: { bed: "01:30", wake: "09:30" }, off: { bed: "01:00", wake: "09:00" } } },
  { id: "night", emoji: "🌙", title: "Night shift", desc: "e.g. 10 PM – 6 AM", start: "22:00", end: "06:00", sleep: { work: { bed: "07:30", wake: "15:00" }, off: { bed: "02:00", wake: "10:00" } } },
  { id: "rotating", emoji: "🔄", title: "Rotating shifts", desc: "e.g. 4 on / 4 off, 12h", start: "07:00", end: "19:00", sleep: { work: { bed: "22:00", wake: "05:30" }, off: { bed: "00:00", wake: "08:00" } } },
  { id: "flexible", emoji: "💻", title: "Flexible / freelance", desc: "Hours change, I plan as I go", start: "10:00", end: "18:00", sleep: { work: { bed: "00:00", wake: "08:00" }, off: { bed: "00:30", wake: "09:00" } } },
  { id: "none", emoji: "🏡", title: "Not working now", desc: "Student, home, retired…", start: "", end: "", sleep: { work: { bed: "23:30", wake: "07:30" }, off: { bed: "23:30", wake: "07:30" } } }
];

export function shiftInfo(id) { return SHIFTS.find(s => s.id === id) || SHIFTS[0]; }

export function hasWork(sch) {
  sch = sch || state.profile.schedule;
  return sch.shift !== "none";
}

export function isWorkDay(d, sch) {
  sch = sch || state.profile.schedule;
  if (sch.shift === "none") return false;
  if (sch.shift === "rotating") {
    const r = sch.rotation || { on: 4, off: 4, anchor: "2026-01-01" };
    const cycle = Math.max(1, (+r.on || 0) + (+r.off || 0));
    const diff = daysBetween(fromKey(r.anchor), d);
    return (((diff % cycle) + cycle) % cycle) < (+r.on || 0);
  }
  return (sch.workDays || []).includes(new Date(d).getDay());
}

export function sleepFor(d, sch) {
  sch = sch || state.profile.schedule;
  const s = sch.sleep;
  if (s.sameOnOff || !hasWork(sch)) return s.work;
  return isWorkDay(d, sch) ? s.work : s.off;
}

// Minute-of-day anchors used by routine-based reminders.
export function anchorsFor(d, sch) {
  sch = sch || state.profile.schedule;
  const sl = sleepFor(d, sch);
  const work = isWorkDay(d, sch);
  return {
    wake: toMin(sl.wake),
    bed: toMin(sl.bed),
    workStart: work ? toMin(sch.workStart) : null,
    workEnd: work ? toMin(sch.workEnd) : null
  };
}

export const ANCHORS = [
  { id: "wake", label: "waking up" },
  { id: "bed", label: "bedtime" },
  { id: "workStart", label: "work starts" },
  { id: "workEnd", label: "work ends" }
];

export function sleepHours(win) { return clockSpan(win.bed, win.wake) / 60; }

export function sleepVerdict(win) {
  const h = sleepHours(win);
  if (h < 6) return { level: "warn", text: "Under 6 hours — most adults need 7–9. Try moving bedtime earlier." };
  if (h > 10) return { level: "warn", text: "Over 10 hours — double-check the bed and wake times." };
  if (h < 7) return { level: "ok", text: "A little short. 7–9 hours is the sweet spot." };
  return { level: "ok", text: "Healthy range 👍" };
}

// The habit day should flip while you're asleep, never mid-shift.
// Prefer a time you're asleep on BOTH work days and days off.
export function suggestDayStart(sch) {
  const w = sch.sleep.work, o = sch.sleep.off;
  const inWin = (m, win) => ((m - toMin(win.bed) + 1440) % 1440) < clockSpan(win.bed, win.wake);
  let mid = toMin(w.bed) + clockSpan(w.bed, w.wake) / 2;
  if (!sch.sleep.sameOnOff && sch.shift !== "none") {
    // longest run of minutes inside both windows, starting from work bedtime
    let best = null, run = null;
    for (let i = 0; i <= clockSpan(w.bed, w.wake); i++) {
      const m = (toMin(w.bed) + i) % 1440;
      if (inWin(m, o)) { if (run == null) run = i; if (!best || i - run > best[1] - best[0]) best = [run, i]; }
      else run = null;
    }
    if (best) mid = toMin(w.bed) + (best[0] + best[1]) / 2;
  }
  const h = Math.floor((((mid % 1440) + 1440) % 1440) / 60);
  return Math.min(h, 18);
}

/* ---------- the user's own day (not the clock) ---------- */
const rel = (m, from) => ((m - from) % 1440 + 1440) % 1440;

export function inSleep(m, d) {
  const sl = sleepFor(d);
  return rel(m, toMin(sl.bed)) < clockSpan(sl.bed, sl.wake);
}

// Section a minute-of-day belongs to, relative to waking, work and bedtime.
export function daySection(m, d) {
  const a = anchorsFor(d);
  const awake = rel(a.bed, a.wake);           // minutes from waking to bedtime
  const r = rel(m, a.wake);
  if (r >= awake) return "While you sleep";
  let ws = null, we = null;
  if (a.workStart != null && a.workEnd != null) {
    ws = rel(a.workStart, a.wake); we = rel(a.workEnd, a.wake);
    if (we > ws ? r >= ws && r < we : r >= ws || r < we) return "At work";
  }
  if (r < 120) return "Starting your day";
  if (awake - r <= 120) return "Winding down";
  if (ws != null) return r < ws ? "Before work" : "After work";
  return "Your day";
}

// Greeting for "now", following the user's routine (a night worker's morning starts at 3 PM).
export function greetingFor(nowMs, d) {
  const now = new Date(nowMs), m = now.getHours() * 60 + now.getMinutes();
  const a = anchorsFor(d);
  const r = rel(m, a.wake), awake = rel(a.bed, a.wake);
  if (a.workStart != null && a.workEnd != null) {
    const ws = rel(a.workStart, a.wake), we = rel(a.workEnd, a.wake);
    if (we > ws ? r >= ws && r < we : r >= ws || r < we) return "Have a good shift";
  }
  if (r < awake && awake - r <= 120) return "Time to wind down";
  if (r < 240) return "Good morning";
  const h = now.getHours();
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Hello";
}

// A sensible default reminder time while awake: the next full hour, or an hour after waking.
export function suggestedTime(nowMs, d) {
  const now = new Date(nowMs);
  const next = (now.getHours() + 1) % 24 * 60;
  const a = anchorsFor(d);
  if (!inSleep(next, d) && rel(a.bed, next) > 60) return next;
  return (a.wake + 60) % 1440;
}

export function describeShift(sch) {
  sch = sch || state.profile.schedule;
  const info = shiftInfo(sch.shift);
  if (sch.shift === "none") return info.title;
  if (sch.shift === "rotating") return info.title + " · " + sch.rotation.on + " on / " + sch.rotation.off + " off";
  return info.title + " · " + fromMin(toMin(sch.workStart)) + "–" + fromMin(toMin(sch.workEnd));
}
