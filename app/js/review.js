// Weekly review: last full week's numbers plus up to three specific suggestions,
// worked out on the device from the person's own history (work days, weekdays, reminders).

import { state, activeHabits } from "./store.js";
import { today, addDays, startOfWeek, keyOf, fromKey, toMin, fromMin } from "./dates.js";
import { status, isScheduled, currentStreak, scheduleFor, completion, keepPastTarget } from "./schedule.js";
import { primaryMinute } from "./reminders.js";
import { heldBack24h } from "./notify.js";
import { isWorkDay, hasWork } from "./routine.js";
import { GOALS } from "./templates.js";

// Scheduled vs done for one habit over `n` days from `from` (optionally only days matching `pred`).
function tally(h, from, n, pred) {
  let s = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const day = addDays(from, i);
    if (pred && !pred(day)) continue;
    if (!isScheduled(h, day)) continue;
    const st = status(h, day);
    if (st === "done") { s++; d++; } else if (st === "open") s++;
  }
  return { s, d };
}
// "N times a week" habits are judged on the week as a whole.
function weekTally(h, ws) {
  const s = scheduleFor(h, addDays(ws, 6));
  if (s.kind !== "perWeek") return tally(h, ws, 7);
  let done = 0, due = false;
  for (let i = 0; i < 7; i++) { const day = addDays(ws, i); if (isScheduled(h, day)) due = true; if (status(h, day) === "done") done++; }
  const per = Math.max(1, s.perWeek || 1);
  return due ? { s: per, d: Math.min(done, per) } : { s: 0, d: 0 };
}
const rate = t => t.s ? t.d / t.s : null;
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const variance = a => { const m = avg(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1); };
const hashStr = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
const weekNo = d => Math.floor(d.getTime() / (7 * 86400e3));
const daysBetweenKeys = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400e3);
// Different, practical advice for a habit that had a hard week (rotates week to week).
const HARD_WEEK = [
  "Pick a fixed time and place for it. Small and certain beats big and sometimes.",
  "Tie it to something you already do every day — right after breakfast, or right after a prayer.",
  "Shrink it to a two-minute version for this week. Showing up matters more than size.",
  "Get it ready the night before — clothes out, book on the pillow, bottle filled."
];
const pctOf = (d, s) => s ? Math.round(d / s * 100) : 0;

// The week being reviewed: the last full week before the current one.
export function reviewWeekStart(ref) { return addDays(startOfWeek(ref || today()), -7); }

export function weeklyReview(ref) {
  const ws = reviewWeekStart(ref);
  const habits = activeHabits();
  const rows = habits.map(h => Object.assign({ h }, weekTally(h, ws))).filter(r => r.s > 0);
  if (!rows.length) return null;
  const sum = list => list.reduce((a, r) => ({ s: a.s + r.s, d: a.d + r.d }), { s: 0, d: 0 });
  const tot = sum(rows);
  const prev = sum(habits.map(h => weekTally(h, addDays(ws, -7))));
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(ws, i);
    const t = sum(habits.filter(h => scheduleFor(h, day).kind !== "perWeek").map(h => tally(h, day, 1)));
    return { day, s: t.s, d: t.d, p: pctOf(t.d, t.s) };
  });
  const r = {
    from: ws, to: addDays(ws, 6), key: keyOf(ws),
    done: tot.d, sched: tot.s, pct: pctOf(tot.d, tot.s),
    prevPct: prev.s ? pctOf(prev.d, prev.s) : null,
    perfect: days.filter(x => x.s && x.d === x.s).length,
    topDays: topDaysIn(ws, habits),
    days,
    topStreak: rows.reduce((m, x) => Math.max(m, currentStreak(x.h)), 0),
    wins: rows.filter(x => x.s >= 2 && x.d === x.s).sort((a, b) => b.s - a.s).slice(0, 3),
    misses: rows.filter(x => x.s >= 2 && x.d / x.s < 0.6).sort((a, b) => a.d / a.s - b.d / b.s),
    goals: goalProgress(rows),
    mood: weekMood(ws),
    month: monthLook(ref),
    tips: []
  };
  r.tips = suggestions(r, ws, rows);
  return r;
}

/* ---------- monthly look-back ----------
 * Shown in the first review of each month: the month that just ended next to the three before it.
 * A year's test: one person slid from 70% to 58% over ten months while each week looked "strong"
 * next to the week before — a slow slide only shows over months. */
export function monthLook(ref) {
  const W = startOfWeek(ref || today());
  if (W.getMonth() === addDays(W, -7).getMonth()) return null;
  const habits = activeHabits();
  const months = [];
  for (let k = 4; k >= 1; k--) {
    const start = new Date(W.getFullYear(), W.getMonth() - k, 1), next = new Date(W.getFullYear(), W.getMonth() - k + 1, 1);
    months.push({ start, n: Math.round((next - start) / 86400e3) });
  }
  // One pass per habit and month; summed for the whole list.
  const per = habits.map(h => ({ h, t: months.map(m => tally(h, m.start, m.n)) }));
  months.forEach((m, i) => {
    const s = per.reduce((a, x) => a + x.t[i].s, 0), d = per.reduce((a, x) => a + x.t[i].d, 0);
    Object.assign(m, { s, d, pct: s >= 20 ? pctOf(d, s) : null });
  });
  const cur = months[3];
  if (cur.pct == null) return null;
  const before = months.slice(0, 3).filter(m => m.pct != null);
  const prev = before.length ? Math.round(avg(before.map(m => m.pct))) : null;
  // The habit that slipped most (enough days both ways, at least 15 points down).
  let drop = null;
  for (const x of per) {
    const now = x.t[3], then = x.t.slice(0, 3).reduce((a, t) => ({ s: a.s + t.s, d: a.d + t.d }), { s: 0, d: 0 });
    if (now.s < 8 || then.s < 8) continue;
    const a = pctOf(then.d, then.s), b = pctOf(now.d, now.s);
    if (a - b >= 15 && (!drop || a - b > drop.from - drop.to)) drop = { h: x.h, from: a, to: b };
  }
  const perDay = Math.round(cur.s / cur.n);
  const delta = prev == null ? null : cur.pct - prev;
  let advice = null;
  if (delta != null && delta <= -8) {
    const trim = perDay >= 12 ? trimCandidates(per).map(h => h.id) : [];
    advice = drop
      ? { emoji: "📉", title: "This one slipped the most", habit: drop.h, body: "Make it smaller or move it to an easier time for a month — and protect the rest.", action: "edit", from: drop.from, to: drop.to }
      : perDay >= 12
        ? { emoji: "📉", title: "A slow slide", body: "About " + perDay + " habits a day is a lot. Try fewer for a month — a short list you keep beats a long one you don't.", action: trim.length >= 2 ? "trim" : null, trim }
        : { emoji: "📉", title: "A slow slide", body: "Pick the one or two habits that matter most and protect them this month.", action: null };
  } else if (delta != null && delta >= 8) {
    advice = { emoji: "🚀", title: "Your best month in a while", body: "Whatever changed is working — keep it.", action: null };
  }
  return { start: cur.start, pct: cur.pct, prev, delta, perDay, months: months.filter(m => m.pct != null).map(m => ({ start: m.start, pct: m.pct })), drop, advice };
}

// Days in the week when every starred "top 3" habit due that day was done (null if none starred).
function topDaysIn(ws, habits) {
  const keys = habits.filter(h => h.key);
  if (!keys.length) return null;
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(ws, i), due = keys.filter(h => isScheduled(h, day));
    if (due.length && due.every(h => status(h, day) === "done")) n++;
  }
  return n;
}

// Moods logged in the week: { days: [1|2|3|null ×7], avg } or null if none.
function weekMood(ws) {
  const days = Array.from({ length: 7 }, (_, i) => (state.moods || {})[keyOf(addDays(ws, i))] || null);
  const got = days.filter(Boolean);
  return got.length ? { days, avg: avg(got) } : null;
}

function goalProgress(rows) {
  const goals = (state.profile && state.profile.goals) || [];
  return GOALS.filter(g => goals.includes(g.id)).map(g => {
    const mine = rows.filter(x => g.habits.includes(x.h.name));
    const t = mine.reduce((a, x) => ({ s: a.s + x.s, d: a.d + x.d }), { s: 0, d: 0 });
    return { goal: g, pct: t.s ? pctOf(t.d, t.s) : null, count: mine.length };
  });
}

/* ---------- tip memory ----------
 * A tip shown in last week's review isn't repeated this week (a month's test found the same
 * tip three weeks running), and a tip you dismiss never comes back. state.tipLog: key → week | "never". */
export const tipKey = t => t.title + "|" + (t.habit ? t.habit.id : t.day != null ? "d" + t.day : "");
export function recordTips(r) {
  const log = state.tipLog || (state.tipLog = {}), cnt = state.tipCount || (state.tipCount = {});
  r.tips.forEach(t => {
    const k = tipKey(t);
    if (log[k] !== "never") log[k] = r.key;
    if (t.fallback) return;
    // How often a tip has been shown: the third time it offers to do the change for you,
    // and after that it rests for five weeks (a year's test: "Make it smaller" 17 times).
    const c = cnt[k];
    cnt[k] = { n: (c && !(c.n >= SHOWN_MAX && daysBetweenKeys(c.at, r.key) >= REST_DAYS) ? c.n : 0) + 1, at: r.key };
  });
}
const SHOWN_MAX = 3, REST_DAYS = 35;
const shownBefore = t => ((state.tipCount || {})[tipKey(t)] || { n: 0 }).n;
export function dismissTip(t) { (state.tipLog || (state.tipLog = {}))[tipKey(t)] = "never"; }
// Acted on (moved a reminder, etc.): give it four weeks to work before suggesting it again.
export function markActed(t) { (state.tipLog || (state.tipLog = {}))[tipKey(t)] = "acted:" + keyOf(today()); }
const MAX_SHIFT = 30; // "earlier" can move a reminder at most 30 minutes in total

// Each tip: { emoji, title, body, habit?, action?: "earlier" | "remind" | "edit" | "move" | "trim" | "fajr-ring", day? }
function suggestions(r, ws, rows) {
  const tips = [];
  const log = state.tipLog || {}, lastWeek = keyOf(addDays(ws, -7));
  const fresh = t => {
    const v = log[tipKey(t)];
    if (v === "never" || v === lastWeek) return false;
    if (typeof v === "string" && v.startsWith("acted:") && daysBetweenKeys(v.slice(6), keyOf(ws)) < 28) return false;
    // The generic "hard week" tip: at most every third week, whichever habit it's about
    // (every other week still came to 25 a year for someone juggling many habits).
    if (t.title === "A hard week for this one" && Object.keys(log).some(k => k.startsWith("A hard week for this one|") && (log[k] === lastWeek || log[k] === keyOf(addDays(ws, -14))))) return false;
    // The reminder-limit tip: once a month at most.
    if (t.action === "limit" && typeof v === "string" && /^\d{4}-/.test(v) && daysBetweenKeys(v, keyOf(ws)) < 28) return false;
    // Don't offer "earlier" once a reminder has already been moved 30 minutes earlier.
    if (t.action === "earlier" && t.habit && (t.habit.reminders.shifted || 0) >= MAX_SHIFT) return false;
    // Shown three times already: give it a rest before it comes back.
    const c = (state.tipCount || {})[tipKey(t)];
    if (c && c.n >= SHOWN_MAX && daysBetweenKeys(c.at, keyOf(ws)) < REST_DAYS) return false;
    return true;
  };
  const add = t => { if (fresh(t) && tips.length < 3 && !tips.some(x => tipKey(x) === tipKey(t))) { tips.push(t); return true; } return false; };
  const span = addDays(ws, -21), N = 28; // patterns use four weeks, so one odd day doesn't decide
  const end = addDays(ws, 7);

  let missTips = 0;
  for (const m of r.misses) {
    if (missTips >= 2) break;
    const h = m.h;
    if (h.source === "faith:fajr") { if (add(fajrTip(h))) missTips++; continue; } // no generic fallback for Fajr
    if (hasWork() && scheduleFor(h, ws).kind !== "perWeek") {
      const work = tally(h, span, N, isWorkDay), off = tally(h, span, N, d => !isWorkDay(d));
      const wr = rate(work), or = rate(off);
      if (work.s >= 3 && off.s >= 2 && wr != null && or != null && or - wr >= 0.3) {
        if (add(h.reminders.on && h.reminders.mode !== "interval"
          ? { emoji: "💼", title: "Missed mostly on work days", habit: h, body: "Work days leave less slack. Try the reminder 10 minutes earlier.", action: "earlier" }
          : { emoji: "💼", title: "Missed mostly on work days", habit: h, body: "A reminder on work days would help.", action: "remind" })) missTips++;
        continue;
      }
      if (work.s >= 2 && off.s >= 3 && wr != null && or != null && wr - or >= 0.3) {
        if (add({ emoji: "🛋️", title: "Missed mostly on days off", habit: h, body: "Days off run on a different rhythm. Tie it to something you always do, like breakfast.", action: "edit" })) missTips++;
        continue;
      }
    }
    if (!h.reminders.on) { if (add({ emoji: "🔔", title: "No reminder set", habit: h, body: "Habits with a reminder are much easier to keep.", action: "remind" })) missTips++; continue; }
    if (h.type === "count" && (+h.target || 1) > 1) {
      const t = { emoji: "🪜", title: "Make it smaller for now", habit: h, body: "Halve the target for a week, then build back up.", action: "edit" };
      // Seen twice already: offer to do it in one tap.
      // Only once per habit — the year's test halved one water goal three times (10 → 2).
      if (shownBefore(t) >= 2 && !(h.pastTargets || []).some(p => +p.target > +h.target)) Object.assign(t, { body: "This has been hard for a few weeks. Halve it for now — you can raise it again any time.", action: "halve", to: Math.max(1, Math.ceil((+h.target || 1) / 2)) });
      if (add(t)) missTips++;
      continue;
    }
    if (tips.some(t => t.title === "A hard week for this one")) continue; // the generic tip at most once per review
    const hard = { emoji: "🎯", title: "A hard week for this one", habit: h, body: HARD_WEEK[(hashStr(h.id) + weekNo(ws)) % HARD_WEEK.length], action: "edit" };
    if (shownBefore(hard) >= 2 && pausable(h)) Object.assign(hard, { body: "Hard for a few weeks now. Pause it for a while and give your energy to the rest — bring it back any time from Habits.", action: "pause-one" });
    if (add(hard)) missTips++;
  }

  // Too much on the list: offer to pause the least-kept habits in one tap (checked early — it matters most).
  const perDay = r.sched / 7;
  if (perDay > 10 && r.pct < 60) {
    const trim = trimCandidates(rows);
    if (trim.length >= 3) tips.splice(Math.min(1, tips.length), 0, ...[{ emoji: "✂️", title: "Your list is long", body: "A short list you keep beats a long one you don't. Pause the habits you've kept least — you can bring them back any time.", action: "trim", trim: trim.map(h => h.id) }].filter(fresh));
    if (tips.length > 3) tips.length = 3;
  }

  // Reminder doesn't match when it really gets done (≥ 30 min off, from the last 14 ticks).
  for (const x of rows) {
    if (tips.length >= 3) break;
    const h = x.h, rm = h.reminders;
    if (!rm.on || (rm.mode !== "times" && rm.mode !== "routine") || (rm.mode === "times" && (rm.times || []).length !== 1)) continue;
    const diff = reminderDrift(h), now = primaryMinute(h, today());
    if (diff == null || now == null || Math.abs(diff) < 30 || tips.some(t => t.habit === h)) continue;
    const to = ((Math.round((now + diff) / 5) * 5 - 10) % 1440 + 1440) % 1440;
    add({ emoji: "⏰", title: diff > 0 ? "You usually do this later" : "You usually do this earlier", habit: h, body: "Your reminder doesn't match when you really do it. Move it to fit your day.", action: "move", to });
  }

  // Mood: which habit's done days feel better than its missed days (four weeks, ≥ 3 of each).
  const moods = state.moods || {};
  if (tips.length < 3 && Object.keys(moods).length >= 6) {
    let best = null;
    for (const x of rows) {
      const on = [], off = [];
      for (let i = 0; i < N; i++) {
        const day = addDays(span, i), mv = moods[keyOf(day)];
        if (!mv || day >= end || !isScheduled(x.h, day)) continue;
        const st = status(x.h, day);
        if (st === "done") on.push(mv); else if (st === "open") off.push(mv);
      }
      // Needs enough days both ways and a difference unlikely to be chance (Welch t ≥ 2) —
      // a year's test with random moods showed a looser rule "finding" links that weren't there.
      if (on.length < 5 || off.length < 5) continue;
      const lift = avg(on) - avg(off), se = Math.sqrt(variance(on) / on.length + variance(off) / off.length);
      if (lift >= 0.5 && (se === 0 || lift / se >= 2) && (!best || lift > best.lift)) best = { h: x.h, lift };
    }
    if (best) add({ emoji: "😊", title: "You feel better on days you do this", habit: best.h, body: "Worth protecting — it lifts your whole day.", action: null });
  }

  // Hardest weekday over four weeks, if it stands out.
  const byDow = Array.from({ length: 7 }, () => ({ s: 0, d: 0 }));
  for (let i = 0; i < N; i++) {
    const day = addDays(span, i);
    if (day >= end) break;
    for (const x of rows) { if (scheduleFor(x.h, day).kind === "perWeek") continue; const t = tally(x.h, day, 1); byDow[day.getDay()].s += t.s; byDow[day.getDay()].d += t.d; }
  }
  const all = byDow.reduce((a, x) => ({ s: a.s + x.s, d: a.d + x.d }), { s: 0, d: 0 });
  const worst = byDow.map((x, i) => ({ i, p: x.s >= 4 ? x.d / x.s : null })).filter(x => x.p != null).sort((a, b) => a.p - b.p)[0];
  if (worst && all.s && all.d / all.s - worst.p >= 0.25) {
    add({ emoji: "📆", title: "Your hardest day", day: worst.i, body: "Plan a lighter version of your habits for this day.", action: null });
  }

  if (r.prevPct != null && r.pct - r.prevPct >= 10) add({ emoji: "📈", title: "Better than last week", body: "Whatever you changed is working. Keep it.", action: null });

  // The daily reminder limit is holding things back most days: say so, offer to raise it.
  const held = heldBack24h();
  if (held >= 3 && (state.settings.notify.maxPerDay || 0) && state.settings.notify.maxPerDay < 30) {
    add({ emoji: "🔕", title: "Some reminders are held back", body: "Your daily limit keeps lower-priority reminders quiet — about " + held + " a day. Prayers and medicine always come through. Raise the limit if you want them all.", action: "limit" });
  }

  if (!tips.length) tips.push(fallbackTip(r, rows, weekNo(ws)));
  return tips.slice(0, 3);
}

// When there's nothing specific to suggest: say something true about this week, and never the same
// heading two weeks running (a year's test: "A strong week" 35 weeks out of 51).
function fallbackTip(r, rows, w) {
  const opts = [];
  if (r.pct >= 80) {
    if (r.perfect >= 3) opts.push({ emoji: "🌟", title: r.perfect + " perfect days", body: "Every habit, all day, " + r.perfect + " times this week. Notice what those days had in common." });
    const best = rows.map(x => ({ h: x.h, s: currentStreak(x.h) })).filter(x => x.s >= 14).sort((a, b) => b.s - a.s)[0];
    if (best) opts.push({ emoji: "🔥", title: best.s + " days running", habit: best.h, body: "Your longest streak right now. It's carrying the rest — protect it." });
    if (r.wins.length >= 3) opts.push({ emoji: "✅", title: r.wins.length + " habits kept every day", body: "Not one missed. That's what consistency looks like." });
    STRONG.forEach(([title, body]) => opts.push({ emoji: "🌟", title, body }));
  } else FRESH.forEach(([title, body]) => opts.push({ emoji: "🌱", title, body }));
  const lastWeek = keyOf(addDays(r.from, -7)), log = state.tipLog || {};
  const pick = opts.slice(w % opts.length).concat(opts.slice(0, w % opts.length)).find(t => log[tipKey(t)] !== lastWeek && log[tipKey(t)] !== "never") || opts[0];
  return Object.assign({ action: null, fallback: true }, pick);
}
const STRONG = [
  ["A strong week", "You kept nearly everything. Ready to add one small habit?"],
  ["Keep it rolling", "That's consistency. Notice what made this week work — and keep it."],
  ["Solid week", "A steady week. Maybe make one habit a little harder, or star your top 3."],
  ["Nicely done", "Rest is part of the plan too — a rest day won't break anything."]
];
const FRESH = [
  ["One thing this week", "Pick the one habit that matters most and protect it this week."],
  ["A clean page", "A new week. Start with the easiest habit tomorrow morning."],
  ["A lighter week", "Lower the bar: do the two-minute version and keep the chain going."],
  ["Start the week fresh", "Look at your list — pause anything that doesn't matter right now."]
];

// Fajr gets its own coaching: for shift workers it often falls mid-shift or mid-sleep.
function fajrTip(h) {
  const shift = state.profile.schedule.shift, sleepy = state.settings.notify.sleepPrayers === "wake";
  if (sleepy) return { emoji: "🌅", title: "Fajr is hard on your schedule", habit: h, body: "Prayer reminders now wait until you wake up, which is often too late for Fajr. Let Fajr wake you — the other prayers still wait.", action: "fajr-ring" };
  if (shift === "night" || shift === "rotating") return { emoji: "🌅", title: "Fajr is hard on your schedule", habit: h, body: "Fajr often lands in the middle of a shift. A reminder 10 minutes earlier gives you time to plan a short break.", action: "earlier" };
  return { emoji: "🌅", title: "Fajr is hard this week", habit: h, body: "Sleep a little earlier and keep the phone across the room so the reminder gets you up. A 10-minute earlier reminder helps too.", action: "earlier" };
}

// The least-kept habits that are safe to pause (not your top 3, prayers, wake/bed or medicine).
const pausable = h => !h.key && !h.source && h.category !== "Health" && h.category !== "Faith";
function trimCandidates(rows) {
  return rows.map(x => x.h).filter(pausable)
    .map(h => ({ h, c: completion(h, 28) })).filter(x => x.c != null).sort((a, b) => a.c - b.c).slice(0, 5).filter(x => x.c < 60).map(x => x.h);
}
// "Halve it for now": a count habit's target, remembering the old one so it can be raised again.
export function halveTarget(h, to) {
  if (h.type !== "count") return;
  const before = h.target;
  h.target = Math.max(1, to || Math.ceil(h.target / 2));
  keepPastTarget(before, h); // past days keep the old target
}
export function pauseHabits(ids) {
  const now = Date.now();
  ids.forEach(id => { const h = state.habits.find(x => x.id === id); if (h) { h.archived = true; h.pausedAt = now; } });
}

// How much later (+) or earlier (−) than that day's reminder a habit really gets done:
// median of the last ticks, each compared with its own day's reminder. Null with < 5 ticks.
export function reminderDrift(h) {
  const diffs = [];
  for (const t of h.tickTimes || []) {
    if (typeof t === "number" || !t.d) continue;
    const r = primaryMinute(h, fromKey(t.d));
    if (r != null) diffs.push(((t.m - r + 2160) % 1440) - 720);
  }
  if (diffs.length < 5) return null;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

// Move a single-time or routine reminder so it fires at `minute` (minutes after midnight).
export function moveReminder(h, minute) {
  const r = h.reminders;
  if (r.mode === "times") r.times = [fromMin(minute)];
  else if (r.mode === "routine") {
    const cur = primaryMinute(h, today());
    if (cur != null) r.offset = (+r.offset || 0) + (((minute - cur + 2160) % 1440) - 720);
  }
  r.on = true;
}

// "Remind me 10 minutes earlier", whatever kind of reminder the habit uses.
export function shiftEarlier(h, mins) {
  // Joined prayers (Dhuhr+Asr, Maghrib+Isha) share one reminder: move the pair together, or they'd
  // split into two notifications (a two-year test found this after "remind me earlier" on Maghrib).
  if (/^faith:(dhuhr|asr|maghrib|isha)$/.test(h.source || "") && h.reminders.mode === "prayer") {
    const pair = state.habits.filter(x => x !== h && !x.archived && /^faith:(dhuhr|asr|maghrib|isha)$/.test(x.source || "") && x.reminders.mode === "prayer" && x.reminders.prayer === h.reminders.prayer);
    pair.forEach(x => shiftOne(x, mins));
  }
  shiftOne(h, mins);
}
function shiftOne(h, mins) {
  const r = h.reminders, by = mins || 10;
  r.shifted = (r.shifted || 0) + by;
  if (r.mode === "times") r.times = (r.times || []).map(t => t ? fromMin(((toMin(t) - by) % 1440 + 1440) % 1440) : t);
  else if (r.mode === "routine") r.offset = (+r.offset || 0) - by;
  else if (r.mode === "prayer") r.offsets = Array.from(new Set((r.offsets && r.offsets.length ? r.offsets : [0]).map(o => o - by)));
  r.on = true;
}
