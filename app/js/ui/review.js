// The weekly review screen, and the Today card that offers it at the start of each week.

import { state, findHabit, save } from "../store.js";
import { esc, toast } from "../util.js";
import { fmtDate, fmtTime, DAY_LONG, DAY_MIN, daysBetween, today, startOfWeek } from "../dates.js";
import { weeklyReview, shiftEarlier, moveReminder, recordTips, dismissTip, pauseHabits, markActed, halveTarget } from "../review.js";

// The tips on screen. Kept here because recording them changes what weeklyReview() would pick next.
let shownTips = [];
import { on, ui, openOverlay, closeOverlay } from "./core.js";
import { ovHead, ring } from "./components.js";
import { openEditor } from "./editor.js";
import { maybeAskForRating } from "../rate.js";

// Shown on Today for the first three days of a week, until opened or dismissed.
export function reviewCard() {
  if (daysBetween(startOfWeek(today()), today()) > 2) return "";
  const r = weeklyReview();
  if (!r || state.reviewSeen === r.key) return "";
  const delta = r.prevPct != null ? r.pct - r.prevPct : null;
  return '<div class="card pad review-card"><button class="row grow" data-action="open-review" style="all:unset;display:flex;gap:12px;align-items:center;cursor:pointer;flex:1">' +
    '<span class="emo" style="font-size:26px">🗓️</span><span class="grow"><span class="bold small" style="display:block">Your week in review</span>' +
    '<span class="tiny muted"><span class="tabnum">' + r.pct + "%</span> <span>kept</span>" + (delta ? ' · <span class="tabnum ' + (delta > 0 ? "up" : "down") + '">' + (delta > 0 ? "+" : "") + delta + "%</span> <span>vs the week before</span>" : "") + "</span></span>" +
    '<span class="faint">›</span></button><button class="link small" data-action="dismiss-review" data-id="' + r.key + '" aria-label="Dismiss">✕</button></div>';
}

export function openReview() {
  const r = weeklyReview();
  if (!r) { toast("Track your habits for a week to get your first review"); return; }
  state.reviewSeen = r.key; recordTips(r); save();
  shownTips = r.tips.concat(r.month && r.month.advice ? [r.month.advice] : []);
  openOverlay(() => renderReview(r), { form: {} });
  if (r.pct >= 90 && r.perfect >= 3) maybeAskForRating();
}

function renderReview(r) {
  let h = ovHead('<button class="link" data-action="close">Close</button>', "Your week", "") + '<div class="ov-body review">';
  h += '<div class="center tiny muted">' + esc(fmtDate(r.from, { day: "numeric", month: "short" })) + " – " + esc(fmtDate(r.to, { day: "numeric", month: "short" })) + "</div>";
  const delta = r.prevPct != null ? r.pct - r.prevPct : null;
  h += '<div class="card pad"><div class="ring-wrap">' + ring(r.pct, 92) + '<div class="grow">' +
    '<div class="sect-title"><span class="tabnum">' + r.done + " / " + r.sched + "</span> <span>kept</span></div>" +
    (delta == null ? '<div class="small muted">Your first full week 🎉</div>'
      : delta === 0 ? '<div class="small muted">Same as the week before</div>'
        : '<div class="small ' + (delta > 0 ? "up" : "down") + '"><span class="tabnum">' + (delta > 0 ? "+" : "") + delta + "%</span> <span>vs the week before</span></div>") +
    (r.topDays != null ? '<div class="small">⭐ <span class="tabnum">' + r.topDays + " / 7</span> <span>days with your top habits done</span></div>" : "") +
    '<div class="tiny muted"><span class="tabnum">' + r.perfect + "</span> <span>" + (r.perfect === 1 ? "perfect day" : "perfect days") + "</span> · 🔥 <span class=\"tabnum\">" + r.topStreak + "</span> <span>top streak</span></div></div></div>";
  h += '<div class="bars" style="margin-top:12px">' + r.days.map(x => '<div class="b' + (x.s ? "" : " empty") + '"><div class="col"><div class="fill" style="height:' + Math.max(x.p, 3) + '%"></div></div><div class="tiny faint">' + DAY_MIN[x.day.getDay()] + "</div></div>").join("") + "</div>";
  if (r.mood) h += '<div class="mood-week" aria-label="Mood each day">' + r.mood.days.map(m => '<span class="emo">' + (m ? ["", "😞", "🙂", "😄"][m] : "·") + "</span>").join("") + "</div>";
  h += "</div>";
  if (r.month) h += monthSection(r.month, r.tips.length);

  if (r.tips.length) {
    h += '<div class="group-label"><span class="eyebrow">Coach</span><span class="line"></span></div>';
    h += r.tips.map((t, i) => '<div class="card pad stack-sm tip"><div class="row"><span class="emo" style="font-size:22px">' + t.emoji + '</span><div class="grow"><div class="bold small">' + esc(t.title) + "</div>" +
      (t.habit ? '<div class="small"><span class="emo">' + t.habit.emoji + "</span> <span>" + esc(t.habit.name) + "</span></div>" : "") +
      (t.day != null ? '<div class="small">' + DAY_LONG[t.day] + "</div>" : "") + "</div></div>" +
      '<div class="small muted">' + esc(t.body) + "</div>" + tipAction(t, i) + "</div>").join("");
  }
  if (r.wins.length) {
    h += '<div class="group-label"><span class="eyebrow">Wins</span><span class="line"></span></div><div class="card pad stack-sm">' +
      r.wins.map(w => '<div class="row"><span class="emo" style="font-size:20px">' + w.h.emoji + '</span><span class="grow small bold">' + esc(w.h.name) + '</span><span class="badge live tabnum">' + w.d + "/" + w.s + " ✓</span></div>").join("") + "</div>";
  }
  const goals = r.goals.filter(g => g.pct != null);
  if (goals.length) {
    h += '<div class="group-label"><span class="eyebrow">Your goals</span><span class="line"></span></div><div class="card pad stack-sm">' +
      goals.map(g => '<div><div class="spread small" style="margin-bottom:5px"><span><span class="emo">' + g.goal.emoji + "</span> <span>" + esc(g.goal.label) + '</span></span><span class="muted tabnum">' + g.pct + '%</span></div><div class="catbar"><i style="width:' + g.pct + '%"></i></div></div>').join("") + "</div>";
  }
  h += '<button class="btn" data-action="close">Start this week</button></div>';
  return h;
}

// Once a month: the month that just ended, next to the ones before it, and one piece of advice.
function monthSection(m, idx) {
  const name = fmtDate(m.start, { month: "long" });
  let h = '<div class="group-label"><span class="eyebrow">Your month</span><span class="line"></span></div><div class="card pad stack-sm">' +
    '<div class="spread"><div><div class="sect-title" data-no-tr>' + esc(name) + '</div><div class="small ' + (m.delta == null || Math.abs(m.delta) < 3 ? "muted" : m.delta > 0 ? "up" : "down") + '">' +
    '<span class="tabnum">' + m.pct + "%</span> <span>kept</span>" + (m.prev != null ? ' · <span>' + (m.delta > 0 ? "up from" : m.delta < 0 ? "down from" : "same as") + '</span> <span class="tabnum">' + m.prev + "%</span> <span>before</span>" : "") + "</div></div></div>" +
    '<div class="bars" style="height:90px">' + m.months.map((x, i) => '<div class="b"><div class="col"><div class="fill" style="height:' + Math.max(x.pct, 3) + "%" + (i < m.months.length - 1 ? ";opacity:.45" : "") + '"></div></div><div class="tiny faint" data-no-tr>' + esc(fmtDate(x.start, { month: "short" })) + "</div></div>").join("") + "</div>";
  const t = m.advice;
  if (t) h += '<div class="tip stack-sm" style="padding-top:4px"><div class="row"><span class="emo" style="font-size:22px">' + t.emoji + '</span><div class="grow"><div class="bold small">' + esc(t.title) + "</div>" +
    (t.habit ? '<div class="small"><span class="emo">' + t.habit.emoji + '</span> <span data-no-tr>' + esc(t.habit.name) + "</span>" + (t.from != null ? ' <span class="muted tabnum">' + t.from + "% → " + t.to + "%</span>" : "") + "</div>" : "") + "</div></div>" +
    '<div class="small muted">' + esc(t.body) + "</div>" + tipAction(t, idx) + "</div>";
  return h + "</div>";
}

function tipAction(t, i) {
  const dismiss = '<button class="link small muted" data-action="review-tip-dismiss" data-id="' + i + '">Not helpful</button>';
  if (!t.action || (!t.habit && t.action !== "trim" && t.action !== "limit")) return '<div class="row" style="justify-content:flex-end">' + dismiss + "</div>";
  const label = t.action === "move" ? "Move reminder to " + fmtTime(t.to)
    : t.action === "trim" ? "Pause " + t.trim.length + " least-kept habits"
      : t.action === "halve" ? "Make it " + t.to + (t.habit.unit ? " " + t.habit.unit : "") + " for now"
        : { earlier: "Remind me 10 min earlier", remind: "Set a reminder", edit: "Adjust this habit", "fajr-ring": "Let Fajr wake me", limit: "Raise the limit to 30", "pause-one": "Pause it for now" }[t.action];
  const names = t.action === "trim" ? '<div class="small muted" data-no-tr>' + t.trim.map(id => { const h = findHabit(id); return h ? h.emoji + " " + esc(h.name) : ""; }).join(" · ") + "</div>" : "";
  return names + '<div class="spread"><button class="btn sm soft" data-action="review-tip" data-id="' + i + '" style="width:auto">' + label + "</button>" + dismiss + "</div>";
}

on("open-review", () => openReview());
on("dismiss-review", id => { state.reviewSeen = id; save(); ui.render(); });
on("review-tip-dismiss", (id, el) => {
  const t = shownTips[+id]; if (!t) return;
  dismissTip(t); save();
  const card = el.closest(".tip"); if (card) card.outerHTML = '<div class="okbox small">👍 <span>Got it — we won\'t suggest that again.</span></div>';
});
on("review-tip", (id, el) => {
  const t = shownTips[+id];
  if (!t) return;
  markActed(t);
  if (t.action === "trim") {
    pauseHabits(t.trim); save();
    el.closest(".spread").outerHTML = '<div class="okbox">✅ <span>Paused — find them under Habits → Archived when you\'re ready.</span></div>';
    return;
  }
  if (t.action === "limit") {
    state.settings.notify.maxPerDay = 30; save();
    el.closest(".spread").outerHTML = '<div class="okbox">✅ <span>Daily limit is now 30. You can change it in Settings → Notifications.</span></div>';
    return;
  }
  if (t.action === "fajr-ring") {
    state.settings.notify.sleepPrayers = "smart"; save();
    el.closest(".spread").outerHTML = '<div class="okbox">✅ <span>Fajr can now wake you. Other prayers still wait until you\'re up.</span></div>';
    return;
  }
  if (!t.habit) return;
  const h = findHabit(t.habit.id);
  if (!h) return;
  if (t.action === "earlier") {
    shiftEarlier(h, 10); save();
    el.closest(".spread").outerHTML = '<div class="okbox">✅ Reminder moved 10 minutes earlier</div>';
    return;
  }
  if (t.action === "move") {
    moveReminder(h, t.to); save();
    el.closest(".spread").outerHTML = '<div class="okbox">✅ <span>Reminder moved to</span> ' + fmtTime(t.to) + "</div>";
    return;
  }
  if (t.action === "halve") {
    halveTarget(h, t.to); save();
    el.closest(".spread").outerHTML = '<div class="okbox">✅ <span>Done — raise it again any time from the habit.</span></div>';
    return;
  }
  if (t.action === "pause-one") {
    pauseHabits([h.id]); save();
    el.closest(".spread").outerHTML = '<div class="okbox">✅ <span>Paused — find it under Habits → Archived when you\'re ready.</span></div>';
    return;
  }
  closeOverlay({ all: true });
  openEditor(h.id);
});
