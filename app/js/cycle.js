// Period tracker: log when a period starts and ends; the next one is estimated from your own
// average (the last six cycles). Estimates only: not for contraception or diagnosis.
// For Muslim women, logging a start can begin Excused days (prayers and fasts) until it ends.
// Everything stays on the phone, and its reminders are always private on the lock screen.

import { state } from "./store.js";
import { keyOf, fromKey, addDays, daysBetween, today } from "./dates.js";

const DEFAULT_CYCLE = 28, DEFAULT_LENGTH = 5;

export const cycleCfg = () => {
  if (!state.cycle) state.cycle = { on: false, starts: [], ends: {}, remind: 2, autoExcuse: true };
  return state.cycle;
};
const starts = () => (cycleCfg().starts || []).slice().sort();

// Average cycle length (start to start) over the last six, ignoring gaps that look like a missed log (> 60 days).
export function avgCycle() {
  const s = starts(), gaps = [];
  for (let i = 1; i < s.length; i++) { const g = daysBetween(fromKey(s[i - 1]), fromKey(s[i])); if (g >= 15 && g <= 60) gaps.push(g); }
  const last = gaps.slice(-6);
  return last.length ? Math.round(last.reduce((a, b) => a + b, 0) / last.length) : DEFAULT_CYCLE;
}
// Average period length, from logged ends.
export function avgLength() {
  const c = cycleCfg(), lens = starts().map(k => c.ends[k] ? daysBetween(fromKey(k), fromKey(c.ends[k])) + 1 : null).filter(n => n && n <= 12).slice(-6);
  return lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : DEFAULT_LENGTH;
}
export const lastStart = () => { const s = starts(); return s.length ? s[s.length - 1] : null; };

// The period running on day d (from a logged start, until its logged end or the average length).
export function periodOn(d) {
  const c = cycleCfg(), k = keyOf(d);
  for (const s of starts().reverse()) {
    if (s > k) continue;
    const end = c.ends[s] || keyOf(addDays(fromKey(s), avgLength() - 1));
    return k <= end ? { start: s, end, open: !c.ends[s], day: daysBetween(fromKey(s), d) + 1 } : null;
  }
  return null;
}
// Estimated next start (never in the past: an overdue period moves to today).
export function nextStart(from) {
  const ls = lastStart(), t = from || today();
  if (!ls) return null;
  let n = addDays(fromKey(ls), avgCycle());
  return n < t ? t : n;
}
export const irregular = () => starts().length >= 3 && (avgCycle() < 21 || avgCycle() > 35);

export function logStart(day) {
  const c = cycleCfg(), k = keyOf(day || today());
  if (!c.starts.includes(k)) c.starts.push(k);
  c.starts.sort();
  if (c.autoExcuse && muslim()) {
    state.excused = (state.excused || []).filter(e => !(e.cycle && e.from === k));
    state.excused.push({ from: k, to: keyOf(addDays(fromKey(k), avgLength() - 1)), cycle: true });
  }
}
export function logEnd(day) {
  const c = cycleCfg(), p = periodOn(day || today()) || periodOn(addDays(day || today(), -1));
  if (!p) return false;
  const k = keyOf(day || today());
  c.ends[p.start] = k < p.start ? p.start : k;
  (state.excused || []).forEach(e => { if (e.cycle && e.from === p.start) e.to = c.ends[p.start]; });
  return true;
}
export function removeStart(k) {
  const c = cycleCfg();
  c.starts = c.starts.filter(x => x !== k); delete c.ends[k];
  state.excused = (state.excused || []).filter(e => !(e.cycle && e.from === k));
}
const muslim = () => state.profile.faith && state.profile.faith.religion === "muslim";
