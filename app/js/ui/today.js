// Today: week strip (browse & backfill), progress, "next up", habits grouped
// by part of day in the order *your* day runs, and quit counters.

import { state, activeHabits, findHabit, save } from "../store.js";
import { esc, toast } from "../util.js";
import { today, addDays, startOfWeek, keyOf, fromKey, daysBetween, fmtDate, fmtTime, DAY_MIN, momentFor, toMin, fmtDuration, relDay, habitDayOf } from "../dates.js";
import { isScheduled, status, tap, canLog, progressLabel, currentStreak, bestStreak as bestStreakOf, target, value, dayScore, streakUnit, streakAtRisk, dayPaused, pauseOn, restDaysLeft, isMedicine, excusable, excusedOn } from "../schedule.js";
import { primaryMinute } from "../reminders.js";
import { sleepFor, isWorkDay, hasWork, daySection, greetingFor } from "../routine.js";
import { prayerMinutes, AGPEYA } from "../faith.js";
import { PRAYERS, CITIES } from "../prayer.js";
import { hijriLabel, hijri } from "../hijri.js";
import { reminderMinutes } from "../reminders.js";
import { lifeCards } from "./life.js";
import { quitDays } from "./quit.js";
import { permission, platform } from "../notify.js";
import { on, ui, openSheet, closeSheet } from "./core.js";
import { ring, check, emptyCard, proTag, proSheet, doneFold } from "./components.js";
import { canUse, showProTag } from "../pro.js";
import { openHabit } from "./habit-detail.js";
import { tasksOn } from "../tasks.js";
import { eventsOn } from "../calendars.js";
import { healthNote } from "../health.js";
import { taskRow, eventRow, quickAdd, bindQuickAdd } from "./tasks-ui.js";
import { reviewCard } from "./review.js";
import { requestsCard } from "./requests.js";
import { listsStrip } from "./lists.js";
import { celebrate } from "./celebrate.js";
import { maybeAskForRating, MILESTONES } from "../rate.js";
import { colorOf, inkOn } from "../colors.js";
import { logSleep, askSleepToday, sleptMinutes } from "../sleep.js";

let selDay = null;
let notifyState = "default";
export function resetSelDay() { selDay = null; }

/* ---------- prayers: one strip, other faith habits as chips ---------- */
// A row for every prayer, adhkar and fast crowded Today (tested with a Muslim user), so with two or
// more prayers on a day they share one card: a circle each, in their own order (Fajr → Isha, the
// Agpeya hours, simple prayer times), and the rest of the faith habits become chips under it.
const STRIP = PRAYERS.map(p => p.id).concat(AGPEYA.map(a => "agpeya-" + a.id));
const faithKey = h => /^faith:/.test(h.source || "") ? h.source.slice(6) : null;
const stripRank = h => { const k = faithKey(h); if (k == null) return -1; const i = STRIP.indexOf(k); return i >= 0 ? i : /^pray-\d+$/.test(k) ? 100 + +k.slice(5) : -1; };
// "Fajr prayer" → "Fajr", "Prime (1st hour)" → "1st hour"
const shortName = h => { const p = h.name.match(/\(([^)]+)\)/); return p ? p[1] : h.name.replace(/ prayer$/, ""); };

function faithCard(list, d) {
  const strip = list.filter(h => stripRank(h) >= 0).sort((a, b) => stripRank(a) - stripRank(b));
  if (strip.length < 2) return { html: "", ids: new Set() };
  const loggable = canLog(d), now = Date.now();
  const pt = strip.some(h => PRAYERS.some(p => p.id === faithKey(h))) ? prayerMinutes(d) : null;
  const minuteOf = h => pt && pt[faithKey(h)] != null ? pt[faithKey(h)] : primaryMinute(h, d);
  // Chips in the order of the prayer day (from Fajr / the first hour, not from waking), untimed last.
  const start = minuteOf(strip[0]) ?? toMin(sleepFor(d).wake), when = h => { const m = primaryMinute(h, d); return m == null ? 9999 : (m - start + 1440) % 1440; };
  const extras = list.filter(h => faithKey(h) != null && stripRank(h) < 0).sort((a, b) => when(a) - when(b));
  // The prayer due now: the latest whose time has come (Fajr only until sunrise).
  let cur = null;
  if (daysBetween(d, today()) === 0) strip.forEach(h => { const m = minuteOf(h); if (m != null && momentFor(d, m).getTime() <= now) cur = h; });
  if (cur && pt && faithKey(cur) === "fajr" && momentFor(d, pt.sunrise).getTime() <= now) cur = null;
  const done = strip.filter(h => status(h, d) === "done").length;
  const cells = strip.map(h => {
    const st = status(h, d), on = st === "done", m = minuteOf(h), isCur = h === cur && st === "open";
    const sub = on ? "" : st === "skip" ? "—" : isCur ? "now" : m != null ? fmtTime(m) : "";
    return '<div class="ps-cell' + (isCur ? " now" : "") + '">' +
      check(on, 'data-action="log" data-id="' + h.id + '" aria-label="' + esc(h.name) + '" aria-pressed="' + on + '"' + (loggable && st !== "skip" ? "" : " disabled"), st === "skip" ? "skip" : "") +
      '<span class="ps-name">' + esc(shortName(h)) + '</span><span class="ps-time tabnum">' + sub + "</span></div>";
  }).join("");
  const chips = extras.map(h => {
    const st = status(h, d), on = st === "done" || st === "met";
    const prog = h.type === "count" ? value(h, d) + "/" + target(h) : on ? "✓" : "";
    return '<button class="chip fchip' + (on ? " on" : "") + '" data-action="log" data-id="' + h.id + '" aria-pressed="' + on + '"' + (loggable && st !== "skip" ? "" : " disabled") + '>' +
      '<span class="emo">' + h.emoji + "</span> <span>" + esc(h.name) + "</span>" + (prog ? ' <span class="tabnum">' + prog + "</span>" : "") + "</button>";
  }).join("");
  const icon = state.profile.faith && state.profile.faith.religion === "christian" ? "🙏" : "🕌";
  const html = '<div class="card pad pstrip"><button class="spread link" data-action="tab" data-id="faith" style="width:100%;color:inherit">' +
    '<span class="bold small">' + icon + " <span>Prayers</span></span>" + '<span class="small muted tabnum">' + done + " / " + strip.length + ' <span class="faint">›</span></span></button>' +
    '<div class="ps-row' + (strip.length > 5 ? " many" : "") + '">' + cells + "</div>" + (chips ? '<div class="ps-chips">' + chips + "</div>" : "") + "</div>";
  return { html, ids: new Set(strip.concat(extras).map(h => h.id)) };
}

// "⭐ Top 3: 2 of 3" — with long lists a perfect day is rare, so your starred habits get their own goal.
function topLine(list, d) {
  const keys = list.filter(h => h.key);
  if (!keys.length) return list.length >= 8 && daysBetween(d, today()) === 0 ? '<button class="link small top3-pick" data-action="top3-open" style="color:inherit;text-decoration:underline">⭐ <span>Pick your top 3 for every day</span></button>' : "";
  const done = keys.filter(h => status(h, d) === "done").length;
  return '<div class="small top3">⭐ <span>' + (done === keys.length ? "Top habits done" : "Top habits") + '</span> <b class="tabnum">' + done + " / " + keys.length + "</b></div>";
}
const topDone = (d) => { const keys = activeHabits().filter(h => h.key && isScheduled(h, d)); return keys.length > 0 && keys.every(h => status(h, d) === "done"); };

// "🕌 Asr in 1h 05m" under the day's progress, for Muslims.
function nextPrayerLine() {
  const f = state.profile.faith;
  if (!f || f.religion !== "muslim") return "";
  const now = Date.now(), base = new Date(); base.setHours(0, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const day = addDays(base, i), pt = prayerMinutes(day);
    for (const p of PRAYERS) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, pt[p.id]).getTime();
      if (at > now) return '<div class="small next-prayer">🕌 <b>' + p.name + "</b> <span>in</span> <span class=\"tabnum\">" + fmtDuration(Math.max(1, Math.round((at - now) / 60000))) + "</span> · " + fmtTime(pt[p.id]) + "</div>";
    }
  }
  return "";
}

export function habitRow(h, d) {
  const st = status(h, d), t = target(h), v = value(h, d);
  const m = primaryMinute(h, d);
  const meta = [];
  if (m != null) meta.push(fmtTime(m));
  const prog = progressLabel(h, d);
  if (prog) meta.push(prog);
  const s = currentStreak(h);
  if (s > 1) meta.push("🔥 " + s + (streakUnit(h) === "week" ? "w" : ""));
  const hn = healthNote(h, d);
  if (hn) meta.push(hn);
  if (st === "skip") meta.unshift(excusable(h) && excusedOn(d) ? "Excused" : dayPaused(d) ? "Resting" : "Skipped");
  if (daysBetween(d, today()) === 0 && streakAtRisk(h)) meta.unshift("Missed yesterday — today keeps the streak");
  if (h.key) meta.unshift("⭐");
  if (st === "met") meta.unshift("Weekly goal reached");
  const loggable = canLog(d);
  let right;
  if (h.type === "count" && st !== "skip") {
    right = '<button class="count-pill tabnum' + (v >= t ? " full" : "") + '" data-action="log" data-id="' + h.id + '"' + (loggable ? "" : " disabled") + ' aria-label="Add ' + (h.step || 1) + '">' + (v >= t ? "✓ " : "+ ") + v + "/" + t + "</button>";
  } else {
    right = check(st === "done", 'data-action="log" data-id="' + h.id + '" aria-label="' + (st === "done" ? "Mark not done" : "Mark done") + '"' + (loggable ? "" : " disabled"), st === "skip" ? "skip" : "");
  }
  const bar = h.type === "count" && st !== "skip" && v > 0 && v < t ? '<i class="hbar" style="width:' + Math.round(v / t * 100) + '%"></i>' : "";
  const hc = colorOf(h);
  return '<div class="habit' + (st === "done" || st === "met" ? " is-done" : "") + (st === "skip" ? " is-skip" : "") + '" style="--hc:' + hc + ";--hc-ink:" + inkOn(hc) + '">' +
    '<button class="habit-main" data-action="open-habit" data-id="' + h.id + '"><div class="emoji" aria-hidden="true">' + h.emoji + '</div>' +
    '<div class="grow"><div class="name ellipsis">' + esc(h.name) + '</div><div class="meta ellipsis">' + esc(meta.join(" · ")) + "</div></div></button>" +
    right + bar + "</div>";
}

function weekStrip(d) {
  const ws = startOfWeek(d), t = today();
  let h = '<div class="spread"><button class="link" data-action="week-shift" data-id="-7" aria-label="Previous week">‹ Prev</button>' +
    '<span class="small bold">' + (daysBetween(d, t) === 0 ? "This week" : relDay(d)) + "</span>" +
    '<button class="link" data-action="week-shift" data-id="7" aria-label="Next week"' + (addDays(ws, 7) > addDays(t, 7) ? " disabled" : "") + ">Next ›</button></div>";
  h += '<div class="week">';
  for (let i = 0; i < 7; i++) {
    const day = addDays(ws, i);
    const sc = dayScore(day);
    const dot = day > t || !sc.sched ? "" : sc.done === sc.sched ? " full" : sc.done ? " part" : "";
    h += '<button class="' + (keyOf(day) === keyOf(t) ? "today " : "") + (keyOf(day) === keyOf(d) ? "sel" : "") + '" data-action="pick-day" data-id="' + keyOf(day) + '" aria-label="' + esc(fmtDate(day, { weekday: "long", day: "numeric", month: "long" })) + (dot === " full" ? " — all done" : dot === " part" ? " — partly done" : "") + '"' + (keyOf(day) === keyOf(d) ? ' aria-current="date"' : "") + ">" +
      '<span class="wd">' + DAY_MIN[day.getDay()] + '</span><span class="dn tabnum">' + day.getDate() + '</span><span class="dot' + dot + '"></span></button>';
  }
  return h + "</div>";
}

function nextUp(list, d) {
  const now = Date.now();
  let best = null;
  for (const h of list) {
    const st = status(h, d);
    if (st !== "open") continue;
    const m = primaryMinute(h, d);
    if (m == null) continue;
    const at = momentFor(d, m).getTime();
    if (at < now - 30 * 60000) continue;
    if (!best || at < best.at) best = { h, at, m };
  }
  if (!best) return "";
  const mins = Math.round((best.at - now) / 60000);
  const when = mins <= 0 ? "now" : "in " + fmtDuration(mins);
  return '<div class="small" style="margin-top:2px">Next: <b>' + best.h.emoji + " " + esc(best.h.name) + "</b> · " + fmtTime(best.m) + ' <span class="muted">(' + when + ")</span></div>";
}

export function viewToday(app) {
  const t = today();
  const d = selDay || t;
  const greet = greetingFor(Date.now(), t);
  document.getElementById("hdrTitle").textContent = greet + (state.profile.name ? ", " + state.profile.name : "");
  const hj = state.profile.faith && state.profile.faith.religion === "muslim" ? hijriLabel(d) : "";
  document.getElementById("hdrSub").textContent = fmtDate(d, { weekday: "long", day: "numeric", month: "long" }) + (hj ? " · " + hj : "") + (hasWork() ? " · " + (isWorkDay(d) ? "Work day" : "Day off") : "");

  const list = activeHabits().filter(h => isScheduled(h, d) || status(h, d) === "done");
  const sc = dayScore(d, list);
  const pct = sc.sched ? Math.round(sc.done / sc.sched * 100) : 0;
  const faith = faithCard(list, d);
  // Finished habits and tasks fold into "✓ N done" under the week strip (prayers keep their circles).
  const isDone = x => { const st = status(x, d); return st === "done" || st === "met"; };
  const doneHabits = list.filter(x => !faith.ids.has(x.id) && isDone(x)), tasks = tasksOn(d), doneTasks = tasks.filter(x => x.done);
  let h = weekStrip(d) + doneFold(doneHabits.length + doneTasks.length, doneHabits.map(x => habitRow(x, d)).join("") + doneTasks.map(x => taskRow(x, d)).join(""));

  if (!state.settings.notify.enabled && notifyState !== "denied" && platform() !== "unsupported" && daysBetween(d, t) === 0) {
    h += '<button class="card pad row" data-action="open-notify" style="text-align:left;border-color:var(--amber-line);background:var(--amber-soft);font:inherit;width:100%"><span class="emo" style="font-size:22px">🔔</span><span class="grow"><span class="bold small" style="display:block">Turn on reminders</span><span class="tiny muted">So you never miss a prayer, a dose or a bedtime.</span></span><span class="faint">›</span></button>';
  }

  if (daysBetween(d, t) > 0) h += '<div class="okbox">Viewing ' + esc(relDay(d)) + " — tap a circle to fill in a day you missed.</div>";
  if (daysBetween(d, t) < 0) h += '<div class="okbox">This is a future day — here\'s what\'s planned.</div>';

  const sl = sleepFor(d);
  h += '<div class="card pad hero' + (pct === 100 && sc.sched ? " perfect" : "") + '"><div class="ring-wrap">' + ring(pct, 96) +
    '<div class="grow"><div class="sect-title">' + sc.done + " of " + sc.sched + " done</div>" +
    '<div class="small muted">' + (pct === 100 && sc.sched ? "Perfect day — keep it going 🔥" : sc.sched ? (sc.sched - sc.done) + " to go · wake " + fmtTime(sl.wake) + " · bed " + fmtTime(sl.bed) : "Nothing scheduled") + "</div>" +
    topLine(list, d) + (daysBetween(d, t) === 0 ? nextUp(list, d) + nextPrayerLine() : "") + "</div></div></div>";
  if (daysBetween(d, t) === 0) h += welcomeCard(list, t) + comebackCard() + drowsyCard(t) + sleepCard(t) + shortSleepCard(t) + ramadanMedCard(t) + lifeCards(t) + restControls(t) + requestsCard() + reviewCard() + connectCard() + top3Card();
  h += faith.html;

  // Meetings and one-off tasks for this day
  const evs = eventsOn(d).filter(e => e.allDay || e.end > Date.now() - 3600000 || daysBetween(d, t) !== 0);
  if (evs.length) h += '<div class="group-label"><span class="eyebrow">Meetings · ' + evs.length + '</span><span class="line"></span></div>' + evs.map(eventRow).join("");
  h += '<div class="group-label"><span class="eyebrow">Tasks' + (tasks.length ? " · " + tasks.filter(x => !x.done).length + " to do" : "") + '</span><span class="line"></span></div>' +
    (daysBetween(d, t) === 0 ? listsStrip() : "") + tasks.filter(x => !x.done).map(x => taskRow(x, d)).join("") + quickAdd(d);

  const left = list.filter(x => !faith.ids.has(x.id) && !isDone(x));
  if (!list.length) {
    h += emptyCard("🌱", "No habits for this day", "Tap + to add one — daily, a few times a week, or every few weeks.");
  } else {
    const wake = toMin(sl.wake);
    const withTime = [], anytime = [];
    left.forEach(x => { const m = primaryMinute(x, d); (m == null ? anytime : withTime).push({ x, m }); });
    withTime.sort((a, b) => ((a.m - wake + 1440) % 1440) - ((b.m - wake + 1440) % 1440));
    let cur = null;
    withTime.forEach(({ x, m }) => {
      const part = daySection(m, d);
      if (part !== cur) { cur = part; h += '<div class="group-label"><span class="eyebrow">' + part + '</span><span class="line"></span></div>'; }
      h += habitRow(x, d);
    });
    if (anytime.length) {
      h += '<div class="group-label"><span class="eyebrow">Anytime</span><span class="line"></span></div>';
      h += anytime.map(({ x }) => habitRow(x, d)).join("");
    }
  }

  if (daysBetween(d, t) === 0) h += moodCard(t);

  if (state.quits.length) {
    h += '<div class="group-label"><span class="eyebrow">Staying free</span><span class="line"></span></div>';
    h += state.quits.map(q => '<button class="habit" data-action="open-quit" data-id="' + q.id + '"><div class="emoji">' + q.emoji + '</div><div class="grow"><div class="name">' + esc(q.name) + '</div><div class="meta">' + quitDays(q) + " days clean</div></div><span class=\"badge live tabnum\">" + quitDays(q) + " 🔥</span></button>").join("");
  }
  app.innerHTML = h;
  bindQuickAdd(() => ui.render());
  permission().then(p => { if (p !== notifyState) { notifyState = p; } });
}

/* ---------- welcome back after a break ---------- */
function comebackCard() {
  const c = state.meta && state.meta.comeback;
  if (!c) return "";
  const top = activeHabits().filter(h => isScheduled(h, today()) && status(h, today()) === "open")
    .sort((a, b) => (b.key ? 1 : 0) - (a.key ? 1 : 0) || bestStreakOf(b) - bestStreakOf(a))[0];
  return '<div class="card pad stack-sm comeback"><div class="row"><span class="emo" style="font-size:28px">🌱</span><div class="grow"><div class="bold">Welcome back</div>' +
    '<div class="small muted"><span>You were away</span> <span class="tabnum">' + c.days + "</span> <span>days. Everything you built is still here.</span></div></div></div>" +
    (top ? '<div class="small">👉 <span>Start small today:</span> <b data-no-tr>' + top.emoji + " " + esc(top.name) + "</b></div>" : "") +
    '<div class="row" style="flex-wrap:wrap"><button class="btn sm soft" data-action="comeback-break" style="width:auto">🤒 <span>I was sick or away — keep my streaks</span>' + proTag("pauses") + "</button>" +
    '<button class="btn sm sec" data-action="comeback-fresh" style="width:auto">Start fresh</button></div></div>';
}
on("comeback-break", () => {
  const c = state.meta.comeback; if (!c) return;
  if (!canUse("pauses")) return pauseUpsell();
  state.pauses.push({ from: c.from, to: c.to, reason: "break", faith: false });
  delete state.meta.comeback; save(); toast("Done — those days count as a break 🌱"); ui.render();
});
on("comeback-fresh", () => { delete state.meta.comeback; save(); toast("Fresh start — one habit at a time 🌱"); ui.render(); });

/* ---------- the first week: a first win, then one short card a day ----------
 * The first tick is the strongest sign someone will stay (marketing review), so the first card
 * points at one habit due now; later days introduce the weekly review, sharing and insights. */
const WELCOME = {
  2: ["🗓️", "Your weekly review", "At the start of each week you'll see what worked and get one tip. It's in Me, any day.", "tab", "me", "Open Me"],
  3: ["📨", "Plan with someone", "Ask someone to pick up the groceries or share a family list — by WhatsApp, no account.", "add-ask", "", "Ask someone"],
  5: ["📊", "Your first insights", "Five days in: see your strongest day and which habits you keep best.", "tab", "insights", "See insights"]
};
function welcomeCard(list, t) {
  const m = state.meta || {}, since = m.committedAt || state.profile.committedAt;
  if (!since) return "";
  const day = Math.floor((Date.now() - since) / 86400000) + 1, seen = m.welcomeSeen || {};
  const ticked = state.habits.some(h => Object.keys(h.history || {}).length);
  if (!ticked && day <= 3 && !seen.first) {
    const next = list.filter(h => status(h, t) === "open").sort((a, b) => (primaryMinute(a, t) ?? 1440) - (primaryMinute(b, t) ?? 1440))[0];
    if (!next) return "";
    return '<div class="card pad row welcome-card"><span class="emo" style="font-size:24px">👆</span><div class="grow"><div class="small bold">Your first tick</div><div class="tiny muted"><span>Tap the circle next to</span> <b data-no-tr>' + next.emoji + " " + esc(next.name) + "</b> <span>when it's done. That's the whole habit.</span></div></div>" +
      '<button class="link small" data-action="welcome-seen" data-id="first" aria-label="Dismiss">✕</button></div>';
  }
  const w = WELCOME[day];
  if (!w || seen[day]) return "";
  return '<div class="card pad row welcome-card"><span class="emo" style="font-size:24px">' + w[0] + '</span><div class="grow"><div class="small bold">' + w[1] + '</div><div class="tiny muted">' + w[2] + "</div>" +
    '<button class="btn xs soft" data-action="welcome-go" data-id="' + day + '" style="margin-top:8px">' + w[5] + "</button></div>" +
    '<button class="link small" data-action="welcome-seen" data-id="' + day + '" aria-label="Dismiss">✕</button></div>';
}
const markSeen = id => { state.meta.welcomeSeen = Object.assign({}, state.meta.welcomeSeen, { [id]: true }); save(); };
on("welcome-seen", id => { markSeen(id); ui.render(); });
on("welcome-go", id => {
  const w = WELCOME[id]; markSeen(id);
  const b = document.createElement("button"); b.dataset.action = w[3]; if (w[4]) b.dataset.id = w[4];
  document.body.appendChild(b); b.click(); b.remove();
});

/* ---------- "How did you sleep?" — one tap in the morning ---------- */
/* ---------- health & safety notes (never advice: they point to a doctor or pharmacist) ---------- */
// Ramadan: medicine reminders that fall between Fajr and Maghrib. Asked once a Ramadan; never moves doses itself.
function ramadanMedCard(t) {
  const hj = hijri(t), f = state.profile.faith;
  if (!hj || hj.month !== 9 || !f || f.religion !== "muslim" || (state.meta.ramadanMedSeen === hj.year)) return "";
  const pt = prayerMinutes(t), day = m => m > pt.fajr && m < pt.maghrib;
  const meds = activeHabits().filter(h => isMedicine(h) && h.reminders.on && isScheduled(h, t) && reminderMinutes(h, t).some(day));
  if (!meds.length) return "";
  return '<div class="card pad stack-sm"><div class="row"><span class="emo" style="font-size:24px">💊</span><div class="grow"><div class="small bold">Medicine while fasting</div>' +
    '<div class="tiny muted">' + meds.length + ' <span>' + (meds.length === 1 ? "medicine reminder falls" : "medicine reminders fall") + "</span> <span>between Fajr and Maghrib. Ask your doctor or pharmacist before moving doses to suhoor and iftar — some medicines can't be moved, and some people shouldn't fast.</span></div></div>" +
    '<button class="link small" data-action="ramadan-med-seen" aria-label="Dismiss">✕</button></div>' +
    '<button class="btn xs soft" data-action="ramadan-med-edit" data-id="' + meds[0].id + '">Change reminder times</button></div>';
}
on("ramadan-med-seen", () => { const hj = hijri(today()); state.meta.ramadanMedSeen = hj && hj.year; save(); ui.render(); });
on("ramadan-med-edit", id => { const hj = hijri(today()); state.meta.ramadanMedSeen = hj && hj.year; save(); import("./editor.js").then(m => m.openEditor(id)); });
// After a night shift ends: a gentle reminder before the drive home (90 minutes after the shift ends).
function drowsyCard(t) {
  const s = state.profile.schedule;
  if (!hasWork() || toMin(s.workEnd) >= toMin(s.workStart) || !isWorkDay(addDays(t, -1))) return "";
  const n = new Date(), nm = n.getHours() * 60 + n.getMinutes(), end = toMin(s.workEnd);
  if (nm < end || nm > end + 90) return "";
  return '<div class="small muted sleep-line">🚗 <span>Long night? If you feel drowsy, rest before you drive.</span></div>';
}
// Five or more short nights (under 5 hours) in the last week: one gentle note a week.
function shortSleepCard(t) {
  const wk = keyOf(startOfWeek(t));
  if (state.meta.shortSleepSeen === wk) return "";
  let short = 0;
  for (let i = 0; i < 7; i++) { const e = (state.sleep || {})[keyOf(addDays(t, -i))]; if (e && sleptMinutes(e) < 300) short++; }
  if (short < 5) return "";
  return '<div class="card pad row"><span class="emo" style="font-size:22px">🌙</span><div class="grow small"><div class="bold">A run of short nights</div><div class="tiny muted">' + short + ' <span>of your last 7 nights were under 5 hours. If this keeps happening, it\'s worth talking to a doctor.</span></div></div><button class="link small" data-action="short-sleep-seen" aria-label="Dismiss">✕</button></div>';
}
on("short-sleep-seen", () => { state.meta.shortSleepSeen = keyOf(startOfWeek(today())); save(); ui.render(); });

function sleepCard(t) {
  const k = keyOf(t), e = (state.sleep || {})[k];
  if (e) {
    const m = sleptMinutes(e);
    return '<div class="small muted sleep-line">😴 <span>Slept</span> <b class="tabnum">' + fmtDuration(m) + "</b> · " + fmtTime(e.bed) + "–" + fmtTime(e.wake) + (e.src === "health" ? " · 🍎" : "") + "</div>";
  }
  if (!askSleepToday()) return "";
  const plan = sleepFor(t), prev = sleepFor(addDays(t, -1));
  return '<div class="card pad stack-sm sleep-card"><div class="row"><span class="emo" style="font-size:24px">😴</span><div class="grow"><div class="small bold">How did you sleep?</div><div class="tiny muted">Ticks “In bed on time” and “Wake up on time” when they match your plan.</div></div>' +
    '<button class="link small" data-action="sleep-skip" aria-label="Dismiss">✕</button></div>' +
    '<div class="inline"><span class="small">Bed</span><input class="input time" type="time" id="sl-bed" value="' + esc(prev.bed) + '"><span class="small">Woke</span><input class="input time" type="time" id="sl-wake" value="' + esc(plan.wake) + '"></div>' +
    '<div class="row"><button class="btn xs" data-action="sleep-save">Save</button><button class="btn xs soft" data-action="sleep-plan">As planned</button></div></div>';
}
on("sleep-save", () => { const b = document.getElementById("sl-bed").value, w = document.getElementById("sl-wake").value; if (!b || !w) return; logSleep(keyOf(today()), b, w, "manual"); save(); ui.render(); });
on("sleep-plan", () => { logSleep(keyOf(today()), sleepFor(addDays(today(), -1)).bed, sleepFor(today()).wake, "manual"); save(); ui.render(); });
on("sleep-skip", () => { state.meta.sleepAsked = keyOf(today()); save(); ui.render(); });

/* ---------- first week: connect calendars & health (moved out of setup) ---------- */
function connectCard() {
  const m = state.meta || {};
  const since = m.committedAt || state.profile.committedAt || m.firstOpen || Date.now();
  if (m.connectDismissed || Date.now() - since > 7 * 86400e3) return "";
  if (state.calendars.sources.length && state.health.connected) return "";
  return '<div class="card pad row connect-card"><span class="emo" style="font-size:24px">📅</span><div class="grow"><div class="small bold">Bring in your meetings & steps</div>' +
    '<div class="tiny muted">Teams, Outlook or Google meetings next to your habits — and steps filled in by your phone.</div>' +
    '<button class="btn xs soft" data-action="open-connections" style="margin-top:8px">Connect</button></div>' +
    '<button class="link small" data-action="connect-dismiss" aria-label="Dismiss">✕</button></div>';
}
on("connect-dismiss", () => { state.meta.connectDismissed = true; save(); ui.render(); });

/* ---------- top 3: asked once, after two weeks ----------
 * A year's test: only 2 of 10 people ever starred a habit — the option sat in the editor.
 * After two weeks there's enough history to know what matters; asked once, dismissible. */
function top3Card() {
  const m = state.meta || {}, since = m.committedAt || state.profile.committedAt || m.firstOpen;
  if (m.top3Asked || !since || Date.now() - since < 14 * 86400e3 || m.comeback) return "";
  const hs = activeHabits();
  if (hs.length < 5 || hs.some(h => h.key)) return "";
  return '<div class="card pad row top3-card"><span class="emo" style="font-size:24px">⭐</span><div class="grow"><div class="small bold">Which 3 matter most?</div>' +
    '<div class="tiny muted">Star them. On busy days, getting those 3 done counts as a win — even if the rest waits.</div>' +
    '<button class="btn xs soft" data-action="top3-ask" style="margin-top:8px">Pick my top 3</button></div>' +
    '<button class="link small" data-action="top3-dismiss" aria-label="Dismiss">✕</button></div>';
}
on("top3-ask", () => { state.meta.top3Asked = true; save(); openSheet(top3Sheet()); });
on("top3-dismiss", () => { state.meta.top3Asked = true; save(); ui.render(); });

/* ---------- top 3 picker ---------- */
function top3Sheet() {
  const hs = activeHabits().filter(h => !h.archived);
  const n = hs.filter(h => h.key).length;
  return '<div class="sheet-head"><div class="sect-title">Your top 3</div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    '<div class="small muted">The habits that matter most. They\'re starred on Today and you get a win when they\'re done — even on busy days.</div>' +
    '<div class="stack-xs" style="max-height:52vh;overflow:auto">' + hs.map(h => '<button type="button" class="li card" data-action="top3-toggle" data-id="' + h.id + '" aria-pressed="' + !!h.key + '"' + (!h.key && n >= 3 ? " disabled" : "") + ' style="border-radius:12px"><span class="lic">' + h.emoji + '</span><span class="grow small bold" data-no-tr>' + esc(h.name) + '</span><span style="font-size:18px">' + (h.key ? "⭐" : "☆") + "</span></button>").join("") + "</div>" +
    '<button class="btn" data-action="top3-done">Done</button></div>';
}
on("top3-open", () => openSheet(top3Sheet()));
on("top3-toggle", id => {
  const h = findHabit(id); if (!h) return;
  if (!h.key && activeHabits().filter(x => x.key).length >= 3) return;
  h.key = !h.key; save();
  document.querySelector("#sheet").innerHTML = '<div class="sheet-grip"></div>' + top3Sheet();
});
on("top3-done", () => { closeSheet(); ui.render(); });

/* ---------- mood ---------- */
export const MOODS = [[1, "😞", "Low"], [2, "🙂", "Okay"], [3, "😄", "Good"]];
// Shown from an hour before the end-of-day check-in (or once a mood is logged).
function moodCard(t) {
  const k = keyOf(t), cur = state.moods[k];
  const ev = toMin(state.settings.notify.evening.time) || 1260, now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
  const wake = toMin(sleepFor(t).wake) || 0;
  const sinceWake = (nm - wake + 1440) % 1440, evSinceWake = (ev - 60 - wake + 1440) % 1440;
  if (!cur && sinceWake < evSinceWake) return "";
  return '<div class="card pad mood-card"><div class="small bold">' + (cur ? "Today felt" : "How was today?") + '</div><div class="mood-row" role="group" aria-label="How was today?">' +
    MOODS.map(([v, e, l]) => '<button type="button" class="mood' + (cur === v ? " on" : "") + '" data-action="mood" data-id="' + v + '" aria-pressed="' + (cur === v) + '"><span class="emo">' + e + "</span><span>" + l + "</span></button>").join("") +
    '</div><div class="tiny muted">Your weekly review will show what lifts your days.</div></div>';
}
on("mood", id => {
  const k = keyOf(today());
  if (state.moods[k] === +id) delete state.moods[k]; else state.moods[k] = +id;
  save(); ui.render();
});

/* ---------- rest days & pauses ---------- */
function restControls(t) {
  return excusedBanner(t) + restOrPause(t);
}
// Excused from prayers and fasts (free, private): a banner while it runs, a chip otherwise.
const canExcuse = () => activeHabits().some(excusable);
function excusedBanner(t) {
  const e = canExcuse() && excusedOn(t);
  if (!e) return "";
  return '<div class="card pad row rest-banner"><div class="grow small"><div class="bold">🤍 <span>Excused until</span> ' + esc(fmtDate(fromKey(e.to), { weekday: "short", day: "numeric", month: "short" })) + "</div>" +
    '<div class="tiny muted">Prayer and fast reminders are off and your streaks are kept. Only you see this.</div></div>' +
    '<button class="btn xs soft" data-action="excused-end">End</button></div>';
}
on("excused-open", () => {
  const muslim = state.profile.faith && state.profile.faith.religion === "muslim";
  openSheet('<div class="sheet-head"><div class="sect-title">🤍 <span>Excused from prayers &amp; fasts</span></div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    '<div class="small muted">' + (muslim
      ? "For the days you're excused — your period, after childbirth, or illness and travel when fasting. Prayer and fast reminders stop and your streaks are kept. Quran, dhikr and other reminders carry on."
      : "For the days you're excused from fasting — illness, pregnancy, or as your church or community allows. Fast reminders stop and your streaks are kept.") + "</div>" +
    '<div class="field"><label for="excused-to">Until (and including)</label><input id="excused-to" class="input" type="date" min="' + keyOf(today()) + '" value="' + keyOf(today()) + '"></div>' +
    '<div class="hint">Free, and only on this phone. Nothing is shared.</div>' +
    '<button class="btn" data-action="excused-start">Start</button></div>');
});
on("excused-start", (id, el) => {
  const v = el.closest("#sheet").querySelector("#excused-to").value, k = keyOf(today());
  state.excused = (state.excused || []).concat([{ from: k, to: v && v > k ? v : k }]);
  save(); closeSheet(); toast("Done — prayer and fast reminders are off for now 🤍"); ui.render();
});
on("excused-end", () => {
  const k = keyOf(today()), y = keyOf(addDays(today(), -1));
  state.excused = (state.excused || []).map(e => k >= e.from && k <= e.to ? Object.assign({}, e, { to: y }) : e).filter(e => e.to >= e.from);
  save(); toast("Welcome back 🤍"); ui.render();
});
function restOrPause(t) {
  const p = pauseOn(t);
  if (p) {
    const label = p.rest ? "😴 Rest day — streaks are safe" : (p.reason === "travel" ? "✈️" : "🤒") + " " + (p.reason === "travel" ? "Travelling" : "Feeling unwell") + " until " + fmtDate(fromKey(p.to), { weekday: "short", day: "numeric", month: "short" });
    const faith = state.profile.faith && state.profile.faith.religion && !p.faith;
    return '<div class="card pad row rest-banner"><div class="grow small"><div class="bold">' + esc(label) + '</div>' +
      (p.rest ? "" : '<div class="tiny muted">' + (p.reason === "travel" ? "Reminders are off and streaks are safe. Have a safe trip." : "Reminders are off and streaks are safe. Get well soon.") + "</div>") +
      (faith ? '<div class="tiny muted">🤲 Prayer reminders stay on.</div>' : "") +
      (activeHabits().some(isMedicine) ? '<div class="tiny muted">💊 Medicine reminders stay on.</div>' : "") +
      (p.loc ? '<div class="tiny muted">📍 <span>Prayer times for</span> <span data-no-tr>' + esc(p.loc.name) + "</span></div>" : "") + "</div>" +
      '<button class="btn xs soft" data-action="rest-end">Resume</button></div>';
  }
  // One small chip; its sheet holds the three kinds of break (three chips here crowded Today).
  return '<div class="rest-row"><button class="chip" data-action="break-open">🌿 <span>Taking a break?</span></button></div>';
}
on("break-open", () => {
  const t = today(), left = restDaysLeft(t), upsell = !left && showProTag("extraRestDays");
  const opt = (action, icon, title, desc, off) => '<button class="li card" data-action="' + action + '" style="border-radius:14px"' + (off ? " disabled" : "") + '><span class="lic">' + icon + '</span><span class="grow"><span class="small bold" style="display:block">' + title + '</span><span class="tiny muted">' + desc + '</span></span><span class="chev">›</span></button>';
  openSheet('<div class="sheet-head"><div class="sect-title">Taking a break?</div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    opt("rest-day", "😴", '<span>Rest day</span> <span class="muted tabnum">(' + left + " left)</span>" + (upsell ? proTag("extraRestDays") : ""), "Just today: habit reminders stop and streaks are safe.", !left && !upsell) +
    opt("pause-open", "🤒", "<span>Sick or travelling</span>" + proTag("pauses"), "A few days off: reminders stop and streaks are kept.") +
    (canExcuse() && !excusedOn(t) ? opt("excused-open", "🤍", "<span>Excused</span>", "From prayers and fasts. Private, only on this phone.") : "") + "</div>");
});
on("rest-day", () => {
  if (!restDaysLeft(today())) return proSheet("😴", "More rest days with Pro", "You've used this month's free rest day. Pro gives you 4 a month, so a busy week doesn't cost you your streaks.");
  closeSheet(); state.restDays.push(keyOf(today())); save(); toast("Rest day — habit reminders are off for today 😴"); ui.render();
});
on("rest-end", () => {
  const k = keyOf(today());
  state.restDays = state.restDays.filter(x => x !== k);
  state.pauses = state.pauses.map(p => (k >= p.from && k <= p.to) ? Object.assign({}, p, { to: keyOf(addDays(today(), -1)) }) : p).filter(p => p.to >= p.from);
  save(); toast("Welcome back 🌱"); ui.render();
});
const pauseUpsell = () => proSheet("🤒", "Sick or travelling? Pro keeps your streaks", "With Pro, reminders stop and your streaks are kept while you're ill or away. Without it, a rest day or never-miss-twice still covers one day.");
on("pause-open", () => {
  if (!canUse("pauses")) return pauseUpsell();
  openSheet('<div class="sheet-head"><div class="sect-title">Take a break</div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    '<div class="small muted">Reminders stop and your streaks are kept. Nothing is counted as missed.</div>' +
    (activeHabits().some(isMedicine) ? '<div class="small">💊 <span>Medicine reminders keep coming — a sick day is when they matter most.</span></div>' : "") +
    '<div class="seg" style="--cols:2"><button type="button" class="on" data-action="pause-reason" data-id="sick">🤒 <span>Sick</span></button><button type="button" data-action="pause-reason" data-id="travel">✈️ <span>Travelling</span></button></div>' +
    '<div class="field"><label for="pause-to">Until (and including)</label><input id="pause-to" class="input" type="date" min="' + keyOf(today()) + '" value="' + keyOf(addDays(today(), 2)) + '"></div>' +
    (state.profile.faith && state.profile.faith.religion === "muslim" ? '<div class="field travel-only" hidden><label for="pause-city">Prayer times while you\'re away</label><select id="pause-city" class="input"><option value="">Same as home</option>' +
      CITIES.map((c, i) => '<option value="' + i + '">' + esc(c[0]) + "</option>").join("") + '<option value="here">📍 Where I am now</option></select></div>' : "") +
    (state.profile.faith && state.profile.faith.religion ? '<label class="checkrow"><input type="checkbox" id="pause-faith"><span class="grow"><span class="bold small" style="display:block">Pause prayer reminders too</span><span class="hint">Off by default — prayers stay on while you travel or rest.</span></span></label>' : "") +
    '<button class="btn" data-action="pause-start">Start break</button></div>');
});
on("pause-reason", (id, el) => {
  el.parentNode.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === el));
  const t = el.closest("#sheet").querySelector(".travel-only"); if (t) t.hidden = id !== "travel";
});
on("pause-start", async (id, el) => {
  const sheet = el.closest("#sheet"), reason = sheet.querySelector('[data-action="pause-reason"].on').dataset.id;
  const to = sheet.querySelector("#pause-to").value || keyOf(today());
  const pf = sheet.querySelector("#pause-faith"), city = sheet.querySelector("#pause-city");
  const p = { from: keyOf(today()), to: to < keyOf(today()) ? keyOf(today()) : to, reason, faith: !!(pf && pf.checked) };
  if (reason === "travel" && city && city.value) {
    if (city.value === "here") {
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000, maximumAge: 600000 }));
        p.loc = { name: "Current location", lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4) };
      } catch (e) { toast("Couldn't get your location — pick a city instead"); return; }
    } else { const c = CITIES[+city.value]; p.loc = { name: c[0], lat: c[1], lng: c[2] }; }
  }
  state.pauses.push(p);
  save(); closeSheet();
  toast(reason === "travel" ? (p.loc ? "Safe travels ✈️ — prayer times now for " + p.loc.name : "Safe travels ✈️ — reminders paused") : "Get well soon 🤍 — reminders paused");
  ui.render();
});

/* ---------- actions ---------- */
on("pick-day", id => {
  const [y, m, dd] = id.split("-").map(Number);
  selDay = new Date(y, m - 1, dd);
  if (keyOf(selDay) === keyOf(today())) selDay = null;
  ui.render();
});
on("week-shift", n => {
  const base = selDay || today();
  let nd = addDays(base, +n);
  if (nd > addDays(today(), 7)) nd = addDays(today(), 7);
  selDay = keyOf(nd) === keyOf(today()) ? null : nd;
  ui.render();
});
on("log", (id, el) => {
  const h = findHabit(id);
  const d = selDay || today();
  if (!h || !canLog(d)) return;
  const before = status(h, d);
  const wasPerfect = perfectDay(d), wasTop = topDone(d);
  tap(h, d);
  save();
  const after = status(h, d);
  if (before !== "done" && after === "done") {
    const s = currentStreak(h);
    if (MILESTONES.includes(s)) maybeAskForRating();
    if (!wasPerfect && perfectDay(d)) { celebrate({ count: 70 }); toast("Perfect day — everything done 🎉"); }
    else if (!wasTop && topDone(d)) { celebrate({ count: 50 }); toast("⭐ Your top habits are done — that's a win"); }
    else {
      const r = el && el.getBoundingClientRect();
      if (r) celebrate({ x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight, count: 14 });
      toast(s > 2 ? "🔥 " + s + "-" + streakUnit(h) + " streak!" : "Nice — done ✓");
    }
  }
  ui.render();
});
function perfectDay(d) {
  const sc = dayScore(d, activeHabits().filter(x => isScheduled(x, d)));
  return sc.sched > 0 && sc.done === sc.sched;
}
on("open-habit", id => openHabit(id, selDay || today()));
