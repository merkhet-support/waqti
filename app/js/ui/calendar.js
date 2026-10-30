// Calendar tab: month grid with markers for meetings, tasks and habit progress,
// the selected day's agenda, and the next 7 days at a glance.

import { state, activeHabits } from "../store.js";
import { esc } from "../util.js";
import { today, addDays, startOfWeek, keyOf, fromKey, daysBetween, DAY_MIN, weekOrder, fmtDate, relDay, fmtTime } from "../dates.js";
import { isScheduled, status, dayScore, progressLabel } from "../schedule.js";
import { tasksOn, inbox } from "../tasks.js";
import { eventsOn, hasEvents, syncAll } from "../calendars.js";
import { on, ui } from "./core.js";
import { taskRow, eventRow, quickAdd, bindQuickAdd, openTaskEditor } from "./tasks-ui.js";
import { openHabit } from "./habit-detail.js";

let month = null;   // first day of the shown month
let sel = null;     // selected day

function monthGrid() {
  const t = today();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
  let h = '<div class="cal-head">' + weekOrder().map(d => "<span>" + DAY_MIN[d] + "</span>").join("") + '</div><div class="cal-grid">';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const inMonth = d.getMonth() === month.getMonth();
    const evs = eventsOn(d), tasks = tasksOn(d).filter(x => !x.done);
    const sc = d <= t ? dayScore(d) : null;
    const pct = sc && sc.sched ? sc.done / sc.sched : null;
    const dots = evs.slice(0, 3).map(e => '<i style="background:' + e.color + '"></i>').join("") + (tasks.length ? '<i class="task-dot"></i>' : "");
    h += '<button class="cal-cell' + (inMonth ? "" : " out") + (keyOf(d) === keyOf(t) ? " today" : "") + (keyOf(d) === keyOf(sel) ? " sel" : "") + '" data-action="cal-pick" data-id="' + keyOf(d) + '" aria-label="' + fmtDate(d, { weekday: "long", day: "numeric", month: "long" }) + '">' +
      '<span class="cal-n tabnum">' + d.getDate() + "</span><span class=\"cal-dots\">" + dots + "</span>" +
      (pct != null ? '<span class="cal-prog"><b style="width:' + Math.round(pct * 100) + '%"></b></span>' : '<span class="cal-prog empty"></span>') + "</button>";
  }
  return h + "</div>";
}

function habitMini(h, d) {
  const st = status(h, d);
  const icon = st === "done" || st === "met" ? "✅" : st === "skip" ? "⏭️" : d < today() ? "⚪" : "◯";
  const prog = progressLabel(h, d);
  return '<button class="mini-row" data-action="cal-habit" data-id="' + h.id + '"><span class="emo">' + h.emoji + '</span><span class="grow ellipsis">' + esc(h.name) + (prog ? ' <span class="faint">· ' + esc(prog) + "</span>" : "") + '</span><span class="emo">' + icon + "</span></button>";
}

function upcoming() {
  let h = "";
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today(), i);
    const evs = eventsOn(d), tasks = tasksOn(d).filter(x => !x.done);
    if (!evs.length && !tasks.length) continue;
    const items = evs.slice(0, 4).map(e => '<div class="up-item"><i style="background:' + e.color + '"></i><span class="tabnum faint">' + (e.allDay ? "All day" : fmtTime(new Date(e.start).getHours() * 60 + new Date(e.start).getMinutes())) + "</span><span class=\"ellipsis\">" + esc(e.title) + "</span></div>")
      .concat(tasks.slice(0, 4).map(t => '<div class="up-item"><i class="task-dot"></i><span class="tabnum faint">' + (t.time ? fmtTime(t.time) : "Task") + '</span><span class="ellipsis">' + esc(t.title) + "</span></div>"));
    h += '<button class="up-day" data-action="cal-pick" data-id="' + keyOf(d) + '"><div class="small bold">' + esc(relDay(d)) + '</div><div class="stack-xs">' + items.join("") + ((evs.length > 4 || tasks.length > 4) ? '<div class="tiny faint">+ more</div>' : "") + "</div></button>";
  }
  return h;
}

export function viewCalendar(app) {
  if (!sel) sel = today();
  if (!month) month = new Date(sel.getFullYear(), sel.getMonth(), 1);
  document.getElementById("hdrTitle").textContent = fmtDate(month, { month: "long", year: "numeric" });
  const n = state.calendars.sources.filter(s => s.enabled).length;
  document.getElementById("hdrSub").textContent = n ? n + " calendar" + (n > 1 ? "s" : "") + " connected" : "Habits & tasks";

  let h = '<div class="seg" style="--cols:2"><button type="button" data-action="tab" data-id="plan">Day plan</button><button type="button" class="on">Month</button></div>' +
    '<div class="spread"><button class="link" data-action="cal-month" data-id="-1">‹ Prev</button>' +
    '<button class="link small" data-action="cal-today">Today</button>' +
    '<button class="link" data-action="cal-month" data-id="1">Next ›</button></div>';
  h += '<div class="card pad cal">' + monthGrid() + '<div class="legend" style="margin-top:10px"><span><i style="background:' + (state.calendars.sources[0] ? state.calendars.sources[0].color : "#2563eb") + '"></i>Meetings</span><span><i class="task-dot" style="display:inline-block"></i>Tasks</span><span><i style="background:var(--accent)"></i>Habits done</span></div></div>';

  if (!hasEvents()) {
    h += '<button class="card pad row" data-action="open-connections" style="text-align:left;font:inherit;width:100%"><span class="emo" style="font-size:22px">📅</span><span class="grow"><span class="bold small" style="display:block">Connect your work calendar</span><span class="tiny muted">Outlook / Teams, Google, iCloud — Zoom & Teams meetings get a Join button</span></span><span class="faint">›</span></button>';
  }

  // Selected day agenda
  const evs = eventsOn(sel), tasks = tasksOn(sel);
  const habits = activeHabits().filter(x => isScheduled(x, sel));
  h += '<div class="spread" style="margin-top:4px"><div class="sect-title">' + esc(relDay(sel)) + (relDay(sel) !== fmtDate(sel) ? ' <span class="small muted">' + fmtDate(sel, { day: "numeric", month: "short" }) + "</span>" : "") + '</div><button class="btn xs soft" data-action="cal-add-task">+ Task</button></div>';
  if (evs.length) h += '<div class="group-label"><span class="eyebrow">Meetings & events · ' + evs.length + '</span><span class="line"></span></div>' + evs.map(eventRow).join("");
  h += '<div class="group-label"><span class="eyebrow">Tasks' + (tasks.length ? " · " + tasks.filter(x => !x.done).length + " open" : "") + '</span><span class="line"></span></div>';
  h += tasks.map(t => taskRow(t, sel)).join("") + (daysBetween(today(), sel) >= -400 ? quickAdd(sel) : "");
  if (habits.length) h += '<div class="group-label"><span class="eyebrow">Habits · ' + habits.length + '</span><span class="line"></span></div><div class="card mini-list">' + habits.map(x => habitMini(x, sel)).join("") + "</div>";

  const up = upcoming();
  if (up) h += '<div class="group-label"><span class="eyebrow">Next 7 days</span><span class="line"></span></div><div class="stack-sm">' + up + "</div>";
  const someday = inbox();
  if (someday.length) h += '<div class="group-label"><span class="eyebrow">Someday · no date yet</span><span class="line"></span></div>' + someday.map(t => taskRow(t, sel)).join("");
  app.innerHTML = h;
  bindQuickAdd(() => ui.render());
  syncAll(false).then(changed => { if (changed && state.view === "calendar") ui.render(); });
}

on("cal-pick", id => { sel = fromKey(id); if (sel.getMonth() !== month.getMonth() || sel.getFullYear() !== month.getFullYear()) month = new Date(sel.getFullYear(), sel.getMonth(), 1); ui.render(); });
on("cal-month", n => { month = new Date(month.getFullYear(), month.getMonth() + +n, 1); ui.render(); });
on("cal-today", () => { sel = today(); month = new Date(sel.getFullYear(), sel.getMonth(), 1); ui.render(); });
on("cal-add-task", () => openTaskEditor(null, sel));
on("cal-habit", id => openHabit(id, sel));
