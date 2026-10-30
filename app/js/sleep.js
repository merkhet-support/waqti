// Sleep: what you actually slept, logged in one tap each morning (or read from Apple Health /
// Health Connect where the phone allows), ticking "In bed on time" and "Wake up on time" when they
// match the plan, and showing how bedtime drifts on days off. (The two-year review: sleep was
// the hardest category to keep, 66%.) state.sleep: wake-day key → { bed, wake, src }.

import { state } from "./store.js";
import { keyOf, fromKey, addDays, toMin, habitDayOf, today } from "./dates.js";
import { sleepFor, isWorkDay } from "./routine.js";
import { status, tap } from "./schedule.js";

const BED_OK = 30, WAKE_OK = 20; // minutes either side of the plan
const diff = (a, b) => { const x = ((a - b) % 1440 + 1440) % 1440; return x > 720 ? x - 1440 : x; };

export function sleptMinutes(e) { return ((toMin(e.wake) - toMin(e.bed)) % 1440 + 1440) % 1440; }

// Save last night (wakeKey = the morning you woke) and tick the sleep habits it satisfies.
export function logSleep(wakeKey, bed, wake, src) {
  state.sleep = state.sleep || {};
  if (state.sleep[wakeKey] && state.sleep[wakeKey].src === "manual" && src === "health") return; // what you typed wins
  state.sleep[wakeKey] = { bed, wake, src: src || "manual" };
  const keys = Object.keys(state.sleep).sort();
  while (keys.length > 120) delete state.sleep[keys.shift()];
  applySleep(wakeKey);
}
function applySleep(wakeKey) {
  const e = state.sleep[wakeKey], wakeDay = fromKey(wakeKey);
  if (!e) return;
  // Bedtime belongs to the evening before (or the same night after midnight).
  const bm = toMin(e.bed), wm = toMin(e.wake);
  const bedCal = bm > wm ? addDays(wakeDay, -1) : wakeDay;
  const bedDay = habitDayOf(new Date(bedCal.getFullYear(), bedCal.getMonth(), bedCal.getDate(), 0, bm).getTime());
  const bedHabit = state.habits.find(h => h.source === "routine:bed" && !h.archived), wakeHabit = state.habits.find(h => h.source === "routine:wake" && !h.archived);
  if (bedHabit && Math.abs(diff(bm, toMin(sleepFor(bedDay).bed))) <= BED_OK && status(bedHabit, bedDay) === "open") tap(bedHabit, bedDay);
  if (wakeHabit && Math.abs(diff(wm, toMin(sleepFor(wakeDay).wake))) <= WAKE_OK && status(wakeHabit, wakeDay) === "open") tap(wakeHabit, wakeDay);
}

// Should Today ask "How did you sleep?" — in the first five hours after your planned wake-up, once.
export function askSleepToday(nowMs) {
  const t = today(), k = keyOf(t);
  if (!state.habits.some(h => h.source === "routine:wake" && !h.archived)) return false;
  if ((state.sleep || {})[k] || (state.meta && state.meta.sleepAsked === k)) return false;
  const now = new Date(nowMs || Date.now()), nm = now.getHours() * 60 + now.getMinutes();
  const since = ((nm - toMin(sleepFor(t).wake)) % 1440 + 1440) % 1440;
  return since >= 0 && since <= 300;
}

// Average logged bed and wake times on work days vs days off (last 6 weeks), and the gap.
export function sleepDrift() {
  const since = keyOf(addDays(today(), -42)), w = { bed: [], wake: [], slept: [] }, o = { bed: [], wake: [], slept: [] };
  for (const [k, e] of Object.entries(state.sleep || {})) {
    if (k < since) continue;
    const g = isWorkDay(fromKey(k)) ? w : o; // the morning after decides: a work morning means a work night
    g.bed.push(toMin(e.bed)); g.wake.push(toMin(e.wake)); g.slept.push(sleptMinutes(e));
  }
  // Circular mean around the evening, so 23:30 and 00:30 average to midnight.
  const cm = a => { if (!a.length) return null; const ref = a[0]; return ((ref + Math.round(a.reduce((s, x) => s + diff(x, ref), 0) / a.length)) % 1440 + 1440) % 1440; };
  const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null;
  const work = { bed: cm(w.bed), wake: cm(w.wake), slept: avg(w.slept), n: w.bed.length }, off = { bed: cm(o.bed), wake: cm(o.wake), slept: avg(o.slept), n: o.bed.length };
  return { work, off, bedGap: work.bed != null && off.bed != null ? diff(off.bed, work.bed) : null, n: work.n + off.n };
}
