// First-run setup: you & goals, work & sleep, faith, habits (with their own times and days),
// reminders, then — once the setup is saved — a "hold to commit" moment. Connecting calendars and
// health is offered on Today during the first week instead.

import { blankState, defaultSchedule, defaultSettings, setState, state, newHabit, save } from "../store.js";
import { esc, toast, deepClone } from "../util.js";
import { fmtTime, fmtDuration, fmtDate, addDays, keyOf, toMin, fromMin, today, DAY_SHORT, weekOrder } from "../dates.js";
import { suggestDayStart } from "../routine.js";
import { blankFaith, applyFaith, applyRoutine } from "../faith.js";
import { TEMPLATES, FEATURED, GOALS } from "../templates.js";
import { celebrate } from "./celebrate.js";
import { WHATS_NEW_ID } from "./whats-new.js";
import { requestPermission, deliveryNote, platform, permission, testNotification } from "../notify.js";
import { on, ui, openOverlay, closeOverlay, rerenderOverlay, openSheet, closeSheet } from "./core.js";
import { prayerMinutes } from "../faith.js";
import { currentFast, nextFast } from "../seasons.js";
import { PRAYERS } from "../prayer.js";
import { isScheduled, status, tap } from "../schedule.js";
import { toggleRow, checkRow, seg, daysPicker, numInput } from "./components.js";
import { currentLang, setLang, tr, trText } from "../i18n.js";
import { routineFields } from "./routine-form.js";
import { faithFields, sleepPrayersField } from "./faith-form.js";
import { PACKS } from "./life.js";

// Six steps: goals sit on the first screen, and "Connect your apps" moved to a card on Today
// (fewer steps → fewer people giving up during setup).
const STEPS = ["You", "Work & sleep", "Faith", "Habits", "Reminders", "Commit"];
const GOALS_STEP = 0, ROUTINE_STEP = 1, FAITH_STEP = 2, HABITS_STEP = 3, REMINDERS_STEP = 4, COMMIT_STEP = 5;

const idx = name => TEMPLATES.findIndex(t => t.name === name);
// Habits for the chosen goals first, then featured ones (in FEATURED order), then everything else.
function orderFor(goals) {
  const out = [];
  const add = i => { if (i >= 0 && !out.includes(i)) out.push(i); };
  GOALS.filter(g => (goals || []).includes(g.id)).forEach(g => g.habits.forEach(n => add(idx(n))));
  FEATURED.forEach(([name]) => add(idx(name)));
  TEMPLATES.forEach((_, i) => add(i));
  return out;
}
const PITCH = Object.fromEntries(FEATURED.map(([name, pitch]) => [name, pitch]));
function goalFor(name, goals) { return GOALS.find(g => (goals || []).includes(g.id) && g.habits.includes(name)); }

export function startOnboarding() {
  const sch = defaultSchedule();
  const settings = defaultSettings();
  settings.dayStartHour = suggestDayStart(sch);
  // Nothing starts ticked: every habit, prayer and pack is the person's own pick (goals only reorder the list).
  openOverlay(renderOb, { form: { step: 0, name: "", schedule: sch, settings, faith: blankFaith(null), picks: {}, custom: {}, editing: null, shown: FEATURED.length, routine: true, perm: null, goals: [], door: null, packs: [] } });
  loadInvite();
}

/* ---------- habit templates fitted to the person's own day ---------- */
function fitReminders(t, sch) {
  const rem = Object.assign({ on: true, mode: "times", times: [], anchor: "wake", offset: 0, nag: 0 }, deepClone(t.reminders || {}));
  rem.interval = Object.assign({ every: 120, from: "09:00", to: "21:00" }, (t.reminders || {}).interval || {});
  const w = sch.sleep.work;
  if (rem.mode === "routine" && /^work/.test(rem.anchor) && (sch.shift === "none" || (sch.shift === "night" && rem.anchor === "workEnd"))) { rem.anchor = "wake"; rem.offset = 90; }
  if (rem.mode === "interval") { rem.interval.from = fromMin(toMin(w.wake) + 30); rem.interval.to = fromMin(toMin(w.bed) - 60); }
  if (rem.mode === "times" && sch.shift === "night") Object.assign(rem, { mode: "routine", anchor: "wake", offset: 120 });
  // Medicine-style templates: one time per dose, relative to waking / bedtime.
  if (t.doses) Object.assign(rem, { mode: "times", times: t.doses.map(([a, o]) => fromMin(toMin(a === "bed" ? w.bed : w.wake) + o)) });
  return rem;
}
function remMinute(rem, sch) {
  const w = sch.sleep.work;
  if (rem.mode === "routine") {
    const base = { wake: w.wake, bed: w.bed, workStart: sch.workStart, workEnd: sch.workEnd }[rem.anchor] || w.wake;
    return ((toMin(base) + (+rem.offset || 0)) % 1440 + 1440) % 1440;
  }
  if (rem.mode === "times" && rem.times[0]) return toMin(rem.times[0]);
  return null;
}
function scheduleLabel(s) {
  const days = list => weekOrder().filter(x => (list || []).includes(x)).map(x => DAY_SHORT[x]).join(", ");
  let r = { daily: "Every day", days: days(s.days), perWeek: (s.perWeek || 3) + "× a week, any days", interval: "Every " + s.n + " days",
    weeks: days(s.days) + ((s.n || 1) > 1 ? ", every " + s.n + " weeks" : " every week"), monthly: "Monthly on the " + (s.monthDay || 1) + (s.monthDay === 1 ? "st" : "th") }[s.kind] || "Every day";
  if (s.onlyOn === "work") r += " · work days";
  return r;
}
function effective(i, d) {
  const t = TEMPLATES[i], c = d.custom[i] || {};
  let rem = fitReminders(t, d.schedule);
  if (rem.mode === "times" && rem.times.length > 1) { if (c.times) rem.times = rem.times.map((x, k) => c.times[k] || x); }
  else if (c.time && rem.mode !== "interval") rem = Object.assign(rem, { mode: "times", times: [c.time] });
  let sch = Object.assign({ kind: "daily" }, deepClone(t.schedule || {}));
  if (c.sched === "daily") sch = { kind: "daily", onlyOn: sch.onlyOn };
  if (c.sched === "days") sch = { kind: "days", days: (c.days || []).slice(), onlyOn: sch.onlyOn };
  if (c.sched === "weeks") sch = { kind: "weeks", days: (c.days || []).slice(), n: Math.max(1, +c.n || 2), onlyOn: sch.onlyOn };
  if (c.sched === "perWeek") sch = { kind: "perWeek", perWeek: Math.min(7, Math.max(1, +c.perWeek || 3)), onlyOn: sch.onlyOn };
  return { rem, sch };
}

const c0 = (d, i) => !!(d.custom[i] && (d.custom[i].time || d.custom[i].times)); // their own time: no "why"
// Why a habit got its time — the "it fits my day" moment: "after you wake", "after your shift"…
function whyTime(t, rem, sch) {
  if (t.doses) return "with your wake-up and bedtime";
  if (rem.mode === "interval") return fmtTime(toMin(rem.interval.from)) + "–" + fmtTime(toMin(rem.interval.to));
  if (rem.mode !== "routine") return "";
  const o = +rem.offset || 0, dur = fmtDuration(Math.abs(o));
  if (rem.anchor === "wake") return o ? dur + " after you wake" : "when you wake";
  if (rem.anchor === "bed") return o ? dur + " before bed" : "at bedtime";
  if (rem.anchor === "workEnd") return sch.shift === "day" || sch.shift === "flexible" ? "after work" : "after your shift";
  if (rem.anchor === "workStart") return o >= 0 ? "into your shift" : "before your shift";
  return "";
}

/* ---------- faith step: today's real prayer times, and what "asleep at Dhuhr" looks like ---------- */
const inWindow = (m, a, b) => a <= b ? m >= a && m < b : m >= a || m < b;
function faithPreview(d) {
  if (d.faith && d.faith.religion === "christian" && d.faith.christian) return churchPreview(d.faith.christian.denom);
  if (!d.faith || d.faith.religion !== "muslim" || !d.faith.muslim) return "";
  let pt;
  try { pt = prayerMinutes(today(), d.faith); } catch (e) { return ""; }
  if (!pt) return "";
  const n = new Date(), now = n.getHours() * 60 + n.getMinutes();
  const next = PRAYERS.find(p => pt[p.id] > now) || PRAYERS[0], wait = ((pt[next.id] - now) % 1440 + 1440) % 1440;
  // (The full timetable is in the form below; this card is the payoff: next prayer, and sleep handled.)
  let h = '<div class="card pad stack-sm"><div class="spread"><div class="eyebrow">Today, where you are</div><span class="badge live tabnum">' + esc(trText(next.name)) + " " + fmtTime(pt[next.id]) + " · " + tr("in {t}", { t: fmtDuration(Math.max(1, wait)) }) + "</span></div>";
  // A prayer that falls while they sleep: show the reminder they'd get on waking instead.
  const w = d.schedule.sleep.work, bed = toMin(w.bed), wake = toMin(w.wake);
  const slept = PRAYERS.find(p => p.id !== "fajr" && inWindow(pt[p.id], bed, wake));
  if (slept) {
    const i = PRAYERS.indexOf(slept), after = PRAYERS[i + 1];
    h += '<div class="notif-mock"><div class="nm-app">WAQTI · ' + esc(fmtTime(wake)) + '</div><div class="nm-title">🕌 ' + esc(tr("{p} — prayed yet?", { p: trText(slept.name) })) + "</div>" +
      (after ? '<div class="nm-body">' + esc(tr("Its time lasts until {p} · {t}", { p: trText(after.name), t: fmtTime(pt[after.id]) })) + "</div>" : "") + "</div>" +
      '<div class="hint">' + esc(tr("{p} falls while you sleep. You won't be woken: this comes when you wake, with the time left.", { p: trText(slept.name) })) + "</div>";
  } else if (inWindow(pt.fajr, bed, wake)) h += '<div class="hint">' + esc(tr("Fajr falls while you sleep — you choose next whether it wakes you.")) + "</div>";
  return h + "</div>";
}

// Christians: the fast running now, or the next one, worked out for their church.
function churchPreview(denom) {
  const t = today(), now = currentFast(t, denom), next = !now && nextFast(t, denom);
  if (!now && !next) return "";
  const line = now ? tr("Day {d} of {n}", { d: now.day, n: now.of }) : tr("Starts {date} · in {n} days", { date: fmtDate(addDays(t, next.in), { day: "numeric", month: "long" }), n: next.in });
  const f = now || next;
  return '<div class="card pad stack-xs"><div class="eyebrow">' + esc(tr(now ? "Fasting now" : "Your next fast")) + '</div><div class="spread"><div class="bold">' + f.emoji + " " + esc(trText(f.name)) + '</div><span class="badge live">' + esc(line) + "</span></div>" +
    (f.food ? '<div class="tiny muted">' + esc(trText(f.food)) + "</div>" : "") + '<div class="hint">' + esc(tr("Worked out from your church's calendar — reminders come by themselves when each fast starts.")) + "</div></div>";
}

/* ---------- reminders step: what tomorrow's reminders look like, and a real test ---------- */
function lockPreview(d) {
  const sch = d.schedule, wake = toMin(sch.sleep.work.wake), items = [];
  Object.keys(d.picks).filter(i => d.picks[i]).forEach(i => {
    const t = TEMPLATES[+i]; if (!t) return;
    const { rem } = effective(+i, d), m = rem.mode === "interval" ? toMin(rem.interval.from) : remMinute(rem, sch);
    if (m == null) return;
    const body = t.type === "count" ? tr("0 of {n} {u} so far", { n: t.target, u: trText(t.unit || "") }) : tr("Tap Done when you've finished.");
    items.push({ m, rel: ((m - wake) % 1440 + 1440) % 1440, title: t.emoji + " " + trText(t.name), body });
  });
  if (!items.length) return "";
  items.sort((a, b) => a.rel - b.rel);
  return '<div class="lock-mock" aria-label="Preview of your reminders"><div class="lm-time tabnum">' + esc(fmtTime(wake)) + '</div><div class="lm-day">' + esc(tr("Tomorrow")) + "</div>" +
    items.slice(0, 3).map(x => '<div class="notif-mock"><div class="nm-app">WAQTI · ' + esc(fmtTime(x.m)) + '</div><div class="nm-title">' + esc(x.title) + '</div><div class="nm-body">' + esc(x.body) + '</div><div class="nm-acts"><span>✓ ' + esc(tr("Done")) + "</span><span>" + esc(tr("Snooze 10 min")) + "</span></div></div>").join("") + "</div>";
}
on("ob-test", async () => {
  let p = await permission();
  if (p !== "granted") { p = await requestPermission(); ui.form.perm = p; }
  if (p === "granted") { await testNotification(); toast("Sent — look at your notifications 🔔"); }
  else toast("Allow notifications first, then try again");
  rerenderOverlay();
});

/* ---------- right after "Hold to commit": the first tick, so day one starts with a win ---------- */
function firstWin() {
  if (!state) return;
  const t = today(), list = state.habits.filter(h => !h.archived && isScheduled(h, t) && status(h, t) === "open");
  // The easiest thing to do right now: a glass of water beats a workout.
  const EASY = ["Drink water", "Stretch", "Take vitamins", "Floss & brush", "Plan tomorrow", "Read 10 minutes", "Journal", "Call Mom", "Tidy up"];
  const rank = x => { const i = EASY.indexOf(x.name); return i < 0 ? 99 : i; };
  const h = list.filter(x => !x.source).sort((a, b) => rank(a) - rank(b))[0] || list[0];
  if (!h) return;
  openSheet('<div class="sheet-head"><div class="sect-title">' + esc(tr("Your first win")) + '</div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    '<div class="small muted">' + esc(tr("Start with one, right now. Small and done beats big and planned.")) + "</div>" +
    '<div class="card pad row"><span class="emo" style="font-size:28px">' + h.emoji + '</span><div class="grow bold" data-no-tr>' + esc(trText(h.name)) + (h.type === "count" ? ' <span class="tiny muted">+' + (h.step || 1) + " " + esc(trText(h.unit || "")) + "</span>" : "") + "</div></div>" +
    '<button class="btn" data-action="ob-first-done" data-id="' + h.id + '">✓ ' + esc(tr("I did it")) + '</button><button class="btn ghost" data-action="ob-first-later">' + esc(tr("Later today")) + "</button></div>");
}
on("ob-first-done", id => {
  const h = state.habits.find(x => x.id === id); if (!h) return;
  tap(h, today()); save(); closeSheet(); celebrate({ count: 80 });
  toast(tr("Day 1 done 🔥 Come back tomorrow to make it 2."));
  ui.render && ui.render();
});
on("ob-first-later", () => closeSheet());

/* ---------- "Your day, drawn": a 24-hour dial of the day they just described ---------- */
function dayDial(d) {
  const sch = d.schedule, w = sch.sleep.work, bed = toMin(w.bed), wake = toMin(w.wake);
  const work = sch.shift !== "none" && sch.shift !== "flexible" && sch.workStart && sch.workEnd ? [toMin(sch.workStart), toMin(sch.workEnd)] : null;
  const R = 62, C = 80, pt = m => { const a = (m / 1440) * 2 * Math.PI - Math.PI / 2; return [C + R * Math.cos(a), C + R * Math.sin(a)]; };
  const arc = (a, b, cls) => { const span = ((b - a) % 1440 + 1440) % 1440 || 1440, [x1, y1] = pt(a), [x2, y2] = pt(a + Math.min(span, 1439));
    return '<path class="' + cls + '" d="M' + x1.toFixed(1) + " " + y1.toFixed(1) + " A" + R + " " + R + " 0 " + (span > 720 ? 1 : 0) + " 1 " + x2.toFixed(1) + " " + y2.toFixed(1) + '"/>'; };
  const tick = (m, label) => { const [x, y] = pt(m), a = (m / 1440) * 2 * Math.PI - Math.PI / 2, lx = C + (R + 15) * Math.cos(a), ly = C + (R + 15) * Math.sin(a);
    return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.2" class="dot"/><text x="' + lx.toFixed(1) + '" y="' + (ly + 3).toFixed(1) + '" text-anchor="middle">' + label + "</text>"; };
  const resetAt = (+d.settings.dayStartHour || 0) * 60;
  const svg = '<svg viewBox="-12 -12 184 184" class="dial-svg" role="img" aria-label="Your day">' +
    '<circle cx="80" cy="80" r="' + R + '" class="track"/>' + arc(bed, wake, "sleep") + (work ? arc(work[0], work[1], "work") : "") +
    tick(wake, "☀️") + tick(bed, "🌙") + (work ? tick(work[0], "💼") : "") +
    '<text x="80" y="74" text-anchor="middle" class="c1">' + esc(tr("Your day starts")) + '</text><text x="80" y="94" text-anchor="middle" class="c2">' + esc(fmtTime(wake)) + "</text></svg>";
  const awake = ((bed - wake) % 1440 + 1440) % 1440, workLen = work ? ((work[1] - work[0]) % 1440 + 1440) % 1440 : 0, own = Math.max(0, awake - workLen);
  const overnight = work && work[1] < work[0];
  const lines = [
    tr("Your day resets at {t}, while you sleep — not at midnight.", { t: fmtTime(resetAt) }),
    overnight ? tr("A check-in at 2 AM on shift still counts for that shift.") : "",
    sch.shift === "rotating" ? tr("Work days and days off each get their own times, following your rotation.") : "",
    tr("About {h} hours of your own time on a work day.", { h: Math.round(own / 60) })
  ].filter(Boolean);
  return '<div class="card pad dial"><div class="eyebrow">Your day, drawn</div><div class="dial-row">' + svg + '<div class="stack-xs small">' +
    '<div class="dial-key"><i class="k-sleep"></i><span>Sleep</span></div>' + (work ? '<div class="dial-key"><i class="k-work"></i><span>Work</span></div>' : "") + '<div class="dial-key"><i class="k-free"></i><span>Yours</span></div>' +
    lines.map(l => '<div class="small">' + esc(l) + "</div>").join("") + "</div></div></div>";
}

function habitPicker(d) {
  const order = orderFor(d.goals);
  const shown = order.slice(0, d.shown || FEATURED.length);
  let h = '<div class="stack-sm">';
  for (const i of shown) {
    const t = TEMPLATES[i], picked = !!d.picks[i], g = goalFor(t.name, d.goals);
    const hint = PITCH[t.name] || (t.category + (t.type === "count" ? " · " + t.target + " " + t.unit : ""));
    const tag = g ? '<span class="goal-tag"><span class="emo">' + g.emoji + "</span><span>" + esc(g.label) + "</span></span> " : "";
    h += '<div class="ob-pick' + (picked ? " on" : "") + '">' + checkRow(t.emoji, esc(t.name), "picks." + i, picked, tag + "<span>" + esc(hint) + "</span>");
    if (picked) {
      const { rem, sch } = effective(i, d), m = remMinute(rem, d.schedule);
      const when = rem.mode === "interval" ? "Every " + Math.round(rem.interval.every / 60) + "h while awake"
        : rem.mode === "times" && rem.times.length > 1 ? rem.times.map(fmtTime).join(" & ")
          : m != null ? fmtTime(m) : "No reminder";
      const why = c0(d, i) ? "" : whyTime(t, rem, d.schedule);
      h += '<div class="ob-pick-meta"><span>⏰ <b>' + esc(when) + "</b>" + (why ? ' <span class="fit">— <span>' + esc(tr(why)) + "</span></span>" : "") + " · " + esc(scheduleLabel(sch)) + '</span>' +
        (d.editing === i ? "" : '<button type="button" class="link small" data-action="ob-edit" data-id="' + i + '">Change</button>') + "</div>";
      if (d.editing === i) h += habitEditor(i, d, rem, m);
    }
    h += "</div>";
  }
  h += "</div>";
  // More ideas come in groups of 7; once everything is shown, offer to collapse back.
  const all = shown.length >= order.length;
  h += '<button type="button" class="btn ghost" data-action="ob-more">' + (all ? "Show fewer" : "Show more suggestions") + "</button>";
  return h;
}

function habitEditor(i, d, rem, m) {
  const c = d.custom[i] || {}, p = "custom." + i;
  let h = '<div class="ob-edit stack-sm">';
  if (rem.mode === "times" && rem.times.length > 1) {
    h += rem.times.map((x, k) => '<div class="inline"><span class="small">Dose ' + (k + 1) + '</span><input class="input time" type="time" data-bind="' + p + ".times." + k + '" value="' + esc(x) + '" data-rerender></div>').join("");
  } else if (rem.mode !== "interval") {
    h += '<div class="inline"><span class="small">Remind me at</span><input class="input time" type="time" data-bind="' + p + '.time" value="' + esc(c.time || (m != null ? fromMin(m) : "")) + '" data-rerender>' +
      (c.time ? '<button type="button" class="chip" data-action="ob-time-reset" data-id="' + i + '">Use suggested</button>' : "") + "</div>";
  } else {
    h += '<div class="hint">Repeats while you\'re awake — fine-tune it later in the habit.</div>';
  }
  h += '<div class="small muted">How often</div>' + seg(p + ".sched", [["default", "As suggested"], ["daily", "Every day"], ["days", "Pick days"], ["weeks", "Every few weeks"], ["perWeek", "Times a week"]], c.sched || "default", 3, ' data-then="ob-sched" data-pick="' + i + '"');
  if (c.sched === "days" || c.sched === "weeks") h += daysPicker(p + ".days", c.days || []);
  if (c.sched === "weeks") h += '<div class="inline"><span class="small">every</span>' + numInput(p + ".n", c.n || 2, 1, 12, " data-rerender") + '<span class="small">week(s)</span></div><div class="hint">Example: Friday every 3 weeks for a haircut.</div>';
  if (c.sched === "perWeek") h += '<div class="inline"><span class="small">Any</span>' + numInput(p + ".perWeek", c.perWeek || 3, 1, 7, " data-rerender") + '<span class="small">days a week — you choose which</span></div>';
  h += '<button type="button" class="btn xs soft" data-action="ob-edit-done" style="align-self:flex-start">Done</button></div>';
  return h;
}

/* ---------- the four doors in (marketing review: one promise, a door per audience) ---------- */
const DOORS = [
  ["shift", "🌙", "I work shifts", "Nights, rotations, 4 on / 4 off"],
  ["worship", "🕌", "Prayer & habits together", "Salah, Quran, Ramadan"],
  ["church", "⛪", "My church's fasts & prayers", "Agpeya, fasting seasons"],
  ["habits", "🌱", "Just better habits", "Sleep, health, focus"]
];
// A sample day for each door, shown before any setup questions.
const PREVIEW = {
  shift: [["3:30 PM", "⏰", "Wake up on time", true], ["6:30 PM", "💧", "Water · 4 of 8", false], ["7:00 PM", "💼", "Shift starts — streak safe past midnight", false], ["7:30 AM", "🛌", "In bed on time", false]],
  worship: [["5:02 AM", "🌅", "Fajr prayer", true], ["5:20 AM", "📖", "Read Quran · 2 pages", true], ["12:05 PM", "🕌", "Dhuhr — asleep? We'll remind you when you wake", false], ["5:38 PM", "🌇", "Maghrib · iftar", false]],
  church: [["6:00 AM", "🙏", "Prime (1st hour)", true], ["Today", "⭐", "Nativity Fast — day 12 of 43", false], ["9:00 PM", "📖", "Read the Bible · 1 chapter", false], ["9:30 PM", "🙏", "Compline (12th hour)", false]],
  habits: [["7:00 AM", "⏰", "Wake up on time", true], ["8:00 AM", "💊", "Vitamins", true], ["6:00 PM", "🚶", "Walk · 5,000 of 8,000 steps", false], ["10:30 PM", "📵", "No phone in bed", false]]
};
// Someone sent a request link before you had the app: say who and what, so setup has a reason.
let invite = null;
async function loadInvite() {
  let link = null;
  try { link = localStorage.getItem("waqti_pending_request") || (location.hash.includes("waqti=") ? location.hash : null); } catch (e) { /* ignore */ }
  if (!link) return;
  try {
    const R = await import("../requests.js");
    const m = await R.decodeMessage(R.extractCode(link));
    if (!m || !m.from) return;
    const t = m.task || {};
    invite = { from: m.from.name || "Someone", list: m.t === "list", title: m.t === "list" ? "" : (t.title || "") + (t.date ? " · " + t.date : "") + (t.time ? " " + fmtTime(t.time) : "") };
    rerenderOverlay();
  } catch (e) { /* not a readable link */ }
}

/* ---------- screens ---------- */
function renderOb() {
  const d = ui.form;
  let h = '<div class="ov-body ob">';
  h += '<div class="steps">' + STEPS.map((s, i) => "<i class=\"" + (i <= d.step ? "on" : "") + '"></i>').join("") + "</div>";
  h += '<div class="eyebrow" style="color:var(--accent)">Step ' + (d.step + 1) + " of " + STEPS.length + " · " + STEPS[d.step] + "</div>";

  if (d.step === 0) {
    h += '<div class="seg" style="--cols:2" data-no-tr><button type="button" class="' + (currentLang() === "en" ? "on" : "") + '" data-action="ob-lang" data-id="en">English</button><button type="button" class="' + (currentLang() === "ar" ? "on" : "") + '" data-action="ob-lang" data-id="ar">العربية</button></div>';
    h += '<div><img src="icons/icon.svg" alt="Waqti logo" class="ob-logo"><h1 class="ob-title">Welcome to Waqti 🌱</h1><div class="tiny faint" style="margin-top:2px">by Merkhet</div><div class="small muted" style="margin-top:6px">A habit companion that fits <b>your</b> day — whether you work 9 to 5, nights or rotating shifts — with faith reminders done properly.</div></div>' +
      '<div class="field"><label for="ob-name">What should we call you? (optional)</label><input id="ob-name" data-bind="name" value="' + esc(d.name) + '" placeholder="Your name — or leave it empty" autocomplete="given-name"></div>';
    if (invite) h += '<div class="card pad stack-xs invite-card"><div class="small bold">' + (invite.list ? "🛒" : "📨") + ' <span data-no-tr>' + esc(invite.from) + "</span> <span>" + (invite.list ? "invited you to a shared list" : "sent you a request") + "</span></div>" +
      (invite.title ? '<div class="small" data-no-tr>' + esc(invite.title) + "</div>" : "") + '<div class="tiny muted">Set up Waqti in about a minute to ' + (invite.list ? "join it" : "answer it") + " — free, private, no account.</div></div>";
    // Who is this for? Sets sensible defaults (faith, starter habits) and shows the payoff first.
    h += '<div><div class="small bold">What brings you to Waqti?</div></div><div class="options">' + DOORS.map(([id, e, t, s]) =>
      '<button type="button" class="option' + (d.door === id ? " on" : "") + '" data-action="ob-door" data-id="' + id + '" aria-pressed="' + (d.door === id) + '"><span class="oi">' + e + '</span><span class="ot">' + t + '</span><span class="od">' + s + "</span></button>").join("") + "</div>";
    if (d.door && PREVIEW[d.door]) h += '<div class="card pad stack-xs ob-preview"><div class="eyebrow">Your day in Waqti</div>' + PREVIEW[d.door].map(([tm, e, n, done]) =>
      '<div class="row small"><span class="tabnum muted" style="width:64px">' + tm + '</span><span class="emo">' + e + '</span><span class="grow' + (done ? " muted" : " bold") + '">' + n + "</span><span>" + (done ? "✅" : "○") + "</span></div>").join("") + "</div>";
    h += '<div class="tiny muted">📦 <span>Also inside: bills &amp; subscriptions, car service, birthdays &amp; anniversaries, pets, check-ups, documents and a private period tracker.</span></div>';
    h += '<div><div class="small bold">What do you want to improve? <span class="muted">(optional, up to 3)</span></div><div class="hint">We\'ll suggest habits that get you there.</div></div>';
    h += '<div class="goal-grid">' + GOALS.map(g => {
      const on = d.goals.includes(g.id);
      return '<button type="button" class="goal' + (on ? " on" : "") + '" data-action="ob-goal" data-id="' + g.id + '" aria-pressed="' + on + '"><span class="emo">' + g.emoji + "</span><span>" + esc(g.label) + "</span></button>";
    }).join("") + "</div>";
  } else if (d.step === ROUTINE_STEP) {
    h += '<div><h1 class="ob-title">How does your day run?</h1><div class="small muted" style="margin-top:6px">We use this to time wake-up, bedtime and routine reminders — and to know when your day really ends.</div></div>';
    h += routineFields("schedule", "settings.dayStartHour");
    h += dayDial(d);
    h += toggleRow("Add wake-up & bedtime habits", "routine", d.routine, "Reminders follow your work-day and day-off times");
  } else if (d.step === FAITH_STEP) {
    h += '<div><h1 class="ob-title">Faith reminders</h1><div class="small muted" style="margin-top:6px">Optional. Tell us exactly what you want — we\'ll handle the times and reminders.</div></div>';
    h += faithPreview(d);
    h += faithFields("faith");
  } else if (d.step === HABITS_STEP) {
    h += '<div><h1 class="ob-title">Start with a few habits</h1><div class="small muted" style="margin-top:6px">Tick what you want. Times already fit your sleep and shifts — tap Change to set your own time and days. Fewer is better to start.</div></div>';
    h += habitPicker(d);
    // Life admin packs: picked here, set up from Today afterwards (setup stays short).
    h += '<div class="card pad stack-sm"><div><div class="small bold">Also keep track of</div><div class="hint">Pick any — you\'ll set each one up from Today in a minute.</div></div><div class="chips">' +
      PACKS.map(([id, , e, l]) => { const on = d.packs.includes(id); return '<button type="button" class="chip' + (on ? " on" : "") + '" data-action="ob-pack" data-id="' + id + '" aria-pressed="' + on + '"><span class="emo">' + e + "</span><span>" + l + "</span></button>"; }).join("") + "</div></div>";
  } else if (d.step === REMINDERS_STEP) {
    const n = d.settings.notify;
    h += '<div><h1 class="ob-title">Reminders that respect your sleep</h1><div class="small muted" style="margin-top:6px">' + esc(deliveryNote()) + "</div></div>";
    h += '<div class="card pad stack-sm">' + (d.perm === "granted"
      ? '<div class="okbox">✅ Notifications are on</div>'
      : d.perm === "denied"
        ? '<div class="warn">Notifications are blocked. You can allow them later in your phone/browser settings for this app.</div>'
        : platform() === "unsupported" ? '<div class="warn">This browser can\'t show notifications.</div>'
          : '<button class="btn" data-action="ob-perm">🔔 Allow notifications</button>') + "</div>";
    h += '<div class="card pad stack-sm">' + toggleRow("Quiet hours", "settings.notify.quiet.on", n.quiet.on, "No reminders while you sleep") +
      (n.quiet.on ? '<div class="inline"><span class="small">From</span><input class="input time" type="time" data-bind="settings.notify.quiet.from" value="' + esc(n.quiet.from) + '"><span class="small">to</span><input class="input time" type="time" data-bind="settings.notify.quiet.to" value="' + esc(n.quiet.to) + '"></div>' +
        (d.faith.religion === "muslim" ? sleepPrayersField("settings.notify.sleepPrayers", n.sleepPrayers, d.schedule.sleep.work, d.faith) : "") : "") + "</div>";
    h += '<div class="card pad stack-sm">' + toggleRow("Start-of-day plan", "settings.notify.morning.on", n.morning.on, "What's on today, at " + fmtTime(n.morning.time)) +
      toggleRow("End-of-day check-in", "settings.notify.evening.on", n.evening.on, "If anything is left, at " + fmtTime(n.evening.time)) +
      toggleRow("Weekly review", "settings.notify.weekly.on", n.weekly.on, "What worked last week, and one tip for this one") + "</div>";
    const lp = lockPreview(d);
    if (lp) h += '<div class="card pad stack-sm"><div class="eyebrow">How they\'ll look</div>' + lp +
      (platform() === "unsupported" ? "" : '<button class="btn sec sm" data-action="ob-test">🔔 <span>Send me a test now</span></button>') + "</div>";
  } else if (d.step === COMMIT_STEP) {
    h += commitScreen(d);
    return h + "</div>";
  }

  h += '<div class="ob-actions">' + (d.step > 0 ? '<button class="btn sec" data-action="ob-back">Back</button>' : "") +
    '<button class="btn" data-action="ob-next">' + (d.step === REMINDERS_STEP ? "Save my setup" : "Continue") + "</button></div>";
  if (d.step === FAITH_STEP || d.step === HABITS_STEP) h += '<button class="btn ghost" data-action="ob-skip">Skip this step</button>';
  if (d.step === 0) h += '<div class="center tiny faint">Everything can be changed later. Your data stays on this device.</div>' +
    '<div class="center tiny faint">Waqti is for ages 13 and up.</div>'; // matches the terms and store age rating; nothing is collected from anyone
  return h + "</div>";
}

// The last screen: a short promise to yourself, sealed by holding the button.
function commitScreen(d) {
  const habits = state ? state.habits.filter(x => !x.archived && !x.source) : [];
  const goals = GOALS.filter(g => d.goals.includes(g.id));
  let h = '<div class="center stack-sm"><img src="icons/icon.svg" alt="" class="ob-logo" style="margin-inline:auto"><h1 class="ob-title">Make it a promise</h1>' +
    '<div class="small muted">Small steps, kept, change a life. Hold the button to commit to yourself.</div></div>';
  h += '<div class="card pad stack-sm commit-card">';
  if (goals.length) h += '<div class="small muted">I want to</div><div class="chips">' + goals.map(g => '<span class="chip on"><span class="emo">' + g.emoji + "</span><span>" + esc(g.label) + "</span></span>").join("") + "</div>";
  if (habits.length) {
    h += '<div class="small muted">So I\'ll show up for</div><div class="chips">' + habits.slice(0, 6).map(x => '<span class="chip"><span class="emo">' + x.emoji + "</span><span>" + esc(x.name) + "</span></span>").join("") +
      (habits.length > 6 ? '<span class="chip">+' + (habits.length - 6) + "</span>" : "") + "</div>";
  }
  if (state && state.profile.faith && state.profile.faith.religion) h += '<div class="small">🤲 <span>And keep my faith reminders</span></div>';
  const packs = PACKS.filter(p => d.packs.includes(p[0]));
  if (packs.length) h += '<div class="small muted">And keep track of</div><div class="chips">' + packs.map(([, , e, l]) => '<span class="chip"><span class="emo">' + e + "</span><span>" + l + "</span></span>").join("") + "</div>";
  h += '<div class="hint">Missing a day is fine. Coming back the next day is what counts.</div>' +
    '<div class="small">🗓️ <span>Each week you\'ll get a short review: what worked, and one tip for the week ahead.</span></div></div>';
  h += '<button type="button" class="hold-btn" data-action="ob-commit" aria-label="Hold to commit"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" class="track"/><circle cx="60" cy="60" r="54" class="fill"/></svg><span class="hold-in"><span class="emo">🤝</span><span>Hold to commit</span></span></button>';
  h += '<button class="btn ghost" data-action="ob-back">Back</button>';
  return h;
}

/* ---------- hold to commit ---------- */
const HOLD_MS = 1300;
let holdTimer = null;
function holdEnd() {
  clearTimeout(holdTimer); holdTimer = null;
  document.querySelectorAll(".hold-btn.holding").forEach(b => b.classList.remove("holding"));
}
document.addEventListener("pointerdown", e => {
  const b = e.target.closest && e.target.closest(".hold-btn");
  if (!b) return;
  e.preventDefault();
  b.classList.add("holding");
  try { if (navigator.vibrate) navigator.vibrate(10); } catch (err) { /* ignore */ }
  holdTimer = setTimeout(() => { holdEnd(); commit(); }, HOLD_MS);
});
["pointerup", "pointercancel", "pointerleave"].forEach(t => document.addEventListener(t, e => { if (holdTimer && (t !== "pointerleave" || (e.target.closest && e.target.closest(".hold-btn")))) holdEnd(); }, true));
function commit() {
  if (state) { state.profile.goals = ui.form.goals.slice(); state.profile.committedAt = Date.now(); state.meta.pendingPacks = ui.form.packs.slice(); save(); }
  celebrate({ count: 60 });
  closeOverlay({ all: true });
  toast("You're all set" + (state && state.profile.name ? ", " + state.profile.name : "") + " 🌱");
  window.dispatchEvent(new Event("waqti:setup-done"));
  setTimeout(firstWin, 900); // after the confetti
}

/* ---------- actions ---------- */
const top = () => { document.getElementById("overlay").scrollTop = 0; };
on("ob-perm", async () => {
  const p = await requestPermission();
  ui.form.perm = p;
  ui.form.settings.notify.enabled = p === "granted";
  rerenderOverlay();
});
on("ob-lang", id => { setLang(id); rerenderOverlay(); });
// The door sets defaults that the later steps show and let you change.
on("ob-door", id => {
  const d = ui.form; d.door = id;
  if (id === "worship" && d.faith.religion !== "muslim") { d.faith = blankFaith("muslim"); d.faithFromDoor = true; }
  if (id === "church" && d.faith.religion !== "christian") { d.faith = blankFaith("christian"); d.faith.christian.prayerMode = "agpeya"; d.faithFromDoor = true; }
  if ((id === "habits" || id === "shift") && d.faithFromDoor) { d.faith = blankFaith(null); d.faithFromDoor = false; }
  if (id === "shift" && !d.goals.includes("sleep") && d.goals.length < 3) d.goals.push("sleep");
  rerenderOverlay();
});
on("ob-pack", id => { const p = ui.form.packs, i = p.indexOf(id); if (i >= 0) p.splice(i, 1); else p.push(id); rerenderOverlay(); });
on("ob-back", () => { ui.form.step = Math.max(0, ui.form.step - 1); ui.form.editing = null; rerenderOverlay(); top(); });
on("ob-goal", id => {
  const g = ui.form.goals, i = g.indexOf(id);
  if (i >= 0) g.splice(i, 1);
  else if (g.length >= 3) { toast("Pick up to 3 — you can add more habits later"); return; }
  else g.push(id);
  rerenderOverlay();
});
// Keyboard (Enter/Space) can't "hold", so a keyboard press commits straight away.
on("ob-commit", (id, el, e) => { if (e && e.detail === 0) commit(); });
on("ob-skip", () => {
  if (ui.form.step === FAITH_STEP) ui.form.faith.religion = null;
  if (ui.form.step === HABITS_STEP) ui.form.picks = {};
  ui.form.step++; rerenderOverlay(); top();
});
const MORE_STEP = 7;
on("ob-more", () => {
  const cur = ui.form.shown || FEATURED.length, total = TEMPLATES.length;
  ui.form.shown = cur >= total ? FEATURED.length : Math.min(total, cur + MORE_STEP);
  rerenderOverlay();
});
on("ob-edit", id => { ui.form.editing = +id; ui.form.custom[id] = ui.form.custom[id] || {}; rerenderOverlay(); });
// Switching to "Pick days" / "Every few weeks": start from the habit's suggested day(s).
on("ob-sched", (val, el) => {
  const i = +el.dataset.pick, c = ui.form.custom[i], t = TEMPLATES[i];
  if ((val === "days" || val === "weeks") && c && !(c.days || []).length) {
    c.days = (t.schedule && t.schedule.days && t.schedule.days.length) ? t.schedule.days.slice() : [new Date().getDay()];
  }
  if (val === "weeks" && c && !c.n) c.n = (t.schedule && t.schedule.kind === "weeks" && t.schedule.n) || 2;
});
on("ob-edit-done", () => { ui.form.editing = null; rerenderOverlay(); });
on("ob-time-reset", id => { if (ui.form.custom[id]) ui.form.custom[id].time = ""; rerenderOverlay(); });
on("ob-next", () => {
  const d = ui.form;
  if (d.step === ROUTINE_STEP && d.schedule.shift !== "none" && d.schedule.shift !== "rotating" && !d.schedule.workDays.length) { toast("Pick your work days"); return; }
  if (d.step === HABITS_STEP) {
    const bad = Object.keys(d.picks).find(i => d.picks[i] && d.custom[i] && (d.custom[i].sched === "days" || d.custom[i].sched === "weeks") && !(d.custom[i].days || []).length);
    if (bad != null) { d.editing = +bad; rerenderOverlay(); toast("Pick at least one day"); return; }
    d.editing = null;
  }
  if (d.step === ROUTINE_STEP) {
    // Fit reminder defaults to their sleep: quiet while asleep, plan just after waking, check-in before bed.
    const w = d.schedule.sleep.work, n = d.settings.notify;
    n.quiet = { on: true, from: w.bed, to: w.wake };
    n.morning.time = fromMin(toMin(w.wake) + 15);
    n.evening.time = fromMin(toMin(w.bed) - 90);
  }
  if (d.step === REMINDERS_STEP) { finish(d); d.step = COMMIT_STEP; rerenderOverlay(); top(); return; }
  d.step++; rerenderOverlay(); top();
});

// Saves the setup. The onboarding stays open on the "Connect your apps" step.
function finish(d) {
  const s = blankState();
  s.onboarded = true;
  s.profile.name = (d.name || "").trim();
  s.profile.schedule = d.schedule;
  s.profile.door = d.door || null; // what brought them here: shift | worship | church | habits
  s.settings = d.settings;
  s.settings.lang = currentLang();
  s.profile.goals = d.goals.slice();
  s.whatsNewSeen = WHATS_NEW_ID; // new users get the tour through setup instead
  setState(s);
  if (d.routine) applyRoutine();
  applyFaith(d.faith);
  orderFor(d.goals).forEach(i => {
    if (!d.picks[i]) return;
    const t = TEMPLATES[i];
    const { rem, sch } = effective(i, d);
    const h = newHabit({ name: t.name, emoji: t.emoji, category: t.category, type: t.type || "check", target: t.target || 1, step: t.step || 1, unit: t.unit || "", notes: t.notes || "", auto: t.auto ? Object.assign({}, t.auto) : null });
    Object.assign(h.schedule, sch, { start: keyOf(today()) });
    Object.assign(h.reminders, rem);
    state.habits.push(h);
  });
  save();
  ui.render();
}
