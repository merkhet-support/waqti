// Plan: one day on one timeline — wake-up, work, meetings, timed tasks, habits and bedtime, in
// the order your day runs, with the free gaps between them. Untimed tasks can be dropped into a
// gap (or all placed at once), the top three tasks sit on top as "Today's focus", and after work
// a short wrap-up moves what's left to tomorrow. (The two-year review: the biggest gap for the
// 69 of 100 testers who work was seeing meetings, tasks and habits together.)

import { state, activeHabits, findHabit, save } from "../store.js";
import { esc, toast } from "../util.js";
import { today, addDays, keyOf, fmtDate, fmtTime, fmtDuration, fromMin, toMin, daysBetween, relDay } from "../dates.js";
import { isScheduled, status, tap, canLog } from "../schedule.js";
import { primaryMinute } from "../reminders.js";
import { anchorsFor, hasWork, isWorkDay } from "../routine.js";
import { tasksOn } from "../tasks.js";
import { eventsOn } from "../calendars.js";
import { on, ui, openSheet, closeSheet } from "./core.js";
import { check, doneFold } from "./components.js";
import { openTaskEditor } from "./tasks-ui.js";

let planDay = null;
const GAP_MIN = 45, TASK_MIN = 30;
const PRI = { high: 0, normal: 1, low: 2 };

// Minutes after waking (so a night shift's day runs in order across midnight).
function day(d) {
  const a = anchorsFor(d), wake = a.wake, bed = a.bed, rel = m => ((m - wake) % 1440 + 1440) % 1440;
  const awake = rel(bed) || 960;
  const items = [{ kind: "wake", m: wake, r: 0 }, { kind: "bed", m: bed, r: awake }];
  const work = hasWork() && isWorkDay(d) && a.workStart != null;
  if (work) items.push({ kind: "work", m: a.workStart, r: rel(a.workStart), end: rel(a.workEnd) }, { kind: "workend", m: a.workEnd, r: rel(a.workEnd) });
  const busy = [];
  for (const e of eventsOn(d)) {
    if (e.allDay) continue;
    const s = new Date(Math.max(e.start, new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime())), m = s.getHours() * 60 + s.getMinutes();
    const len = Math.max(5, Math.round((e.end - Math.max(e.start, s.getTime())) / 60000));
    items.push({ kind: "meeting", m, r: rel(m), len, e });
    busy.push([rel(m), rel(m) + len]);
  }
  const tasks = tasksOn(d), untimed = [];
  for (const t of tasks) {
    if (!t.time) { if (!t.done) untimed.push(t); continue; }
    const m = toMin(t.time), len = +t.duration || TASK_MIN;
    items.push({ kind: "task", m, r: rel(m), len, t });
    busy.push([rel(m), rel(m) + len]);
  }
  for (const h of activeHabits()) {
    if (!isScheduled(h, d) && status(h, d) !== "done") continue;
    const m = primaryMinute(h, d);
    if (m == null) continue;
    items.push({ kind: "habit", m, r: rel(m), h });
    busy.push([rel(m), rel(m) + 10]);
  }
  items.sort((x, y) => x.r - y.r || (x.kind === "wake" ? -1 : 0));
  // Free gaps while you're awake, between busy blocks.
  busy.sort((x, y) => x[0] - y[0]);
  const gaps = []; let cur = 15;
  for (const [s, e] of busy) { if (s >= awake) break; if (s - cur >= GAP_MIN) gaps.push([cur, s]); cur = Math.max(cur, e); }
  if (awake - 30 - cur >= GAP_MIN) gaps.push([cur, awake - 30]);
  return { wake, awake, rel, items, gaps, untimed, tasks, work, a };
}
const abs = (P, r) => fromMin((P.wake + r) % 1440);
export const dayPlan = d => day(d); // for tests

export function viewPlan(app) {
  const t = today(), d = planDay || t, isToday = daysBetween(d, t) === 0, P = day(d);
  document.getElementById("hdrTitle").textContent = "Plan";
  document.getElementById("hdrSub").textContent = fmtDate(d, { weekday: "long", day: "numeric", month: "long" }) + (hasWork() ? " · " + (isWorkDay(d) ? "Work day" : "Day off") : "");
  let h = '<div class="seg" style="--cols:2"><button type="button" class="on">Day plan</button><button type="button" data-action="tab" data-id="calendar">Month</button></div>';
  h += '<div class="spread"><button class="link" data-action="plan-day" data-id="-1" aria-label="Previous day">‹ Prev</button><button class="link small" data-action="plan-day" data-id="0">' + esc(relDay(d)) + '</button><button class="link" data-action="plan-day" data-id="1" aria-label="Next day">Next ›</button></div>';

  // Finished tasks and habits leave the timeline and fold into "✓ N done"; unticking puts them back.
  const habitDone = it => { const st = status(it.h, d); return st === "done" || st === "met"; };
  const isDoneItem = it => (it.kind === "task" && it.t.done) || (it.kind === "habit" && habitDone(it));
  const doneTasks = P.tasks.filter(x => x.done), doneHabits = P.items.filter(it => it.kind === "habit" && habitDone(it));
  const doneRow = (box, label, time) => '<div class="row">' + box + '<span class="grow small muted strike-t" data-no-tr>' + label + "</span>" + (time ? '<span class="tiny muted tabnum">' + fmtTime(time) + "</span>" : "") + "</div>";
  h += doneFold(doneTasks.length + doneHabits.length,
    doneTasks.map(x => doneRow(check(true, 'data-action="toggle-task" data-id="' + x.id + '" aria-label="Mark not done"'), esc((x.emoji ? x.emoji + " " : "📝 ") + x.title), x.time)).join("") +
    doneHabits.map(it => doneRow(canLog(d) ? check(true, 'data-action="plan-log" data-id="' + it.h.id + '" aria-label="Mark not done"') : "", it.h.emoji + " " + esc(it.h.name), it.m)).join(""));

  // Today's focus: the three most important unfinished tasks.
  const focus = P.tasks.filter(x => !x.done).sort((x, y) => (PRI[x.priority] ?? 1) - (PRI[y.priority] ?? 1) || (x.time || "99").localeCompare(y.time || "99")).slice(0, 3);
  if (focus.length) h += '<div class="card pad stack-sm"><div class="eyebrow">' + (isToday ? "Today's focus" : "Focus") + "</div>" +
    focus.map(x => '<div class="row">' + check(false, 'data-action="toggle-task" data-id="' + x.id + '" aria-label="Mark done"') + '<button class="grow small bold plan-link" data-action="plan-task" data-id="' + x.id + '">' + (x.priority === "high" ? "❗ " : "") + esc((x.emoji ? x.emoji + " " : "") + x.title) + "</button>" + (x.time ? '<span class="tiny muted tabnum">' + fmtTime(x.time) + "</span>" : "") + "</div>").join("") + "</div>";

  // Work wrap-up, once work is over today.
  const nowRel = P.rel(new Date().getHours() * 60 + new Date().getMinutes());
  if (isToday && P.work && P.tasks.length && nowRel >= P.rel(P.a.workEnd) && nowRel < P.awake) {
    const done = P.tasks.filter(x => x.done).length, left = P.tasks.filter(x => !x.done);
    h += '<div class="card pad row"><span class="emo" style="font-size:24px">🧳</span><div class="grow"><div class="small bold">Work day wrap-up</div><div class="tiny muted"><span class="tabnum">' + done + " / " + P.tasks.length + "</span> <span>tasks done</span></div>" +
      (left.length ? '<button class="btn xs soft" data-action="plan-tomorrow" style="margin-top:8px">Move ' + left.length + " to tomorrow</button>" : "") + "</div></div>";
  }

  // Timeline
  h += '<div class="card pad tl">';
  let g = 0;
  const gapRow = gp => '<div class="tl-row tl-gap"><div class="tl-time tabnum">' + fmtTime(abs(P, gp[0])) + '</div><div class="tl-body"><span class="small muted">Free · ' + fmtDuration(gp[1] - gp[0]) + "</span>" +
    (P.untimed.length && canLog(d) ? '<button class="btn xs soft" data-action="plan-fit" data-id="' + abs(P, gp[0]) + '">Put a task here</button>' : "") + "</div></div>";
  for (const it of P.items) {
    if (isDoneItem(it)) continue;
    while (g < P.gaps.length && P.gaps[g][0] <= it.r) h += gapRow(P.gaps[g++]);
    const time = '<div class="tl-time tabnum">' + fmtTime(it.m) + "</div>";
    if (it.kind === "wake") h += '<div class="tl-row tl-mark">' + time + '<div class="tl-body small bold">☀️ <span>Wake up</span></div></div>';
    else if (it.kind === "bed") h += '<div class="tl-row tl-mark">' + time + '<div class="tl-body small bold">🌙 <span>Bedtime</span></div></div>';
    else if (it.kind === "work") h += '<div class="tl-row tl-mark">' + time + '<div class="tl-body small bold">💼 <span>Work starts</span></div></div>';
    else if (it.kind === "workend") h += '<div class="tl-row tl-mark">' + time + '<div class="tl-body small bold">🏁 <span>Work ends</span></div></div>';
    else if (it.kind === "meeting") h += '<div class="tl-row">' + time + '<div class="tl-body tl-meeting" style="--ev:' + esc(it.e.color || "#2563eb") + '"><div class="small bold ellipsis" data-no-tr>' + esc(it.e.title) + '</div><div class="tiny muted"><span>Meeting</span> · ' + fmtDuration(it.len) + "</div></div></div>";
    else if (it.kind === "task") h += '<div class="tl-row">' + time + '<div class="tl-body">' + check(it.t.done, 'data-action="toggle-task" data-id="' + it.t.id + '" aria-label="' + (it.t.done ? "Mark not done" : "Mark done") + '"') +
      '<button class="grow plan-link" data-action="plan-task" data-id="' + it.t.id + '"><span class="small bold' + (it.t.done ? " strike-t" : "") + '" data-no-tr>' + esc((it.t.emoji ? it.t.emoji + " " : "📝 ") + it.t.title) + '</span><span class="tiny muted" style="display:block"><span>Task</span>' + (it.t.duration ? " · " + fmtDuration(it.t.duration) : "") + "</span></button></div></div>";
    else if (it.kind === "habit") {
      const st = status(it.h, d), done = st === "done" || st === "met";
      h += '<div class="tl-row">' + time + '<div class="tl-body">' + (canLog(d) && st !== "skip" ? check(done, 'data-action="plan-log" data-id="' + it.h.id + '" aria-label="' + (done ? "Mark not done" : "Mark done") + '"') : "") +
        '<span class="grow small' + (done ? " muted" : " bold") + '" data-no-tr>' + it.h.emoji + " " + esc(it.h.name) + "</span></div></div>";
    }
  }
  while (g < P.gaps.length) h += gapRow(P.gaps[g++]);
  h += "</div>";

  // Tasks without a time
  if (P.untimed.length) {
    h += '<div class="group-label"><span class="eyebrow">To fit in · ' + P.untimed.length + '</span><span class="line"></span></div>' +
      '<div class="card pad stack-sm">' + P.untimed.map(x => '<div class="row">' + check(false, 'data-action="toggle-task" data-id="' + x.id + '" aria-label="Mark done"') + '<button class="grow small plan-link" data-action="plan-task" data-id="' + x.id + '" data-no-tr>' + esc((x.emoji ? x.emoji + " " : "") + x.title) + "</button></div>").join("") +
      (P.gaps.length && canLog(d) ? '<button class="btn sm soft" data-action="plan-auto">Find times for all</button>' : '<div class="hint">No free gap left today — move one to tomorrow from the task.</div>') + "</div>";
  }
  h += '<button class="btn sec sm" data-action="plan-add">+ Add a task for ' + esc(isToday ? "today" : fmtDate(d)) + "</button>";
  app.innerHTML = h;
}

const planned = () => planDay || today();
on("plan-day", id => { planDay = +id === 0 ? null : addDays(planned(), +id); if (planDay && daysBetween(planDay, today()) === 0) planDay = null; ui.render(); window.scrollTo(0, 0); });
on("plan-task", id => openTaskEditor(id));
on("plan-add", () => openTaskEditor(null, planned()));
on("plan-log", id => {
  const h = findHabit(id), d = planned();
  if (!h || !canLog(d)) return;
  tap(h, d); save(); ui.render();
});
// Drop an untimed task into a free gap.
on("plan-fit", at => {
  const P = day(planned());
  openSheet('<div class="sheet-head"><div class="sect-title"><span>Put a task at</span> ' + fmtTime(at) + '</div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    P.untimed.map(x => '<button class="li card" data-action="plan-place" data-id="' + x.id + '|' + at + '" style="border-radius:12px"><span class="lic">' + (x.emoji || "📝") + '</span><span class="grow small bold" data-no-tr>' + esc(x.title) + "</span></button>").join("") + "</div>");
});
on("plan-place", id => {
  const [tid, at] = id.split("|"), t = state.tasks.find(x => x.id === tid);
  if (!t) return;
  Object.assign(t, { time: at, date: keyOf(planned()) }); save(); closeSheet(); toast("Planned for " + fmtTime(at)); ui.render();
});
// Place every untimed task, most important first, into the free gaps.
on("plan-auto", () => {
  const P = day(planned()), gaps = P.gaps.map(x => x.slice());
  let placed = 0;
  for (const t of P.untimed.slice().sort((x, y) => (PRI[x.priority] ?? 1) - (PRI[y.priority] ?? 1))) {
    const len = +t.duration || TASK_MIN, gp = gaps.find(x => x[1] - x[0] >= len);
    if (!gp) break;
    Object.assign(t, { time: abs(P, gp[0]), date: keyOf(planned()) }); gp[0] += len + 5; placed++;
  }
  save(); toast(placed ? "Planned " + placed + " " + (placed === 1 ? "task" : "tasks") : "No free gap is long enough"); ui.render();
});
on("plan-tomorrow", () => {
  const tom = keyOf(addDays(today(), 1)); let n = 0;
  for (const t of tasksOn(today())) if (!t.done) { t.date = tom; t.time = ""; n++; }
  save(); toast("Moved " + n + " to tomorrow"); ui.render();
});
