// Habits tab: everything you track, grouped by category, plus archived ones.

import { state } from "../store.js";
import { colorOf } from "../colors.js";
import { esc } from "../util.js";
import { today, keyOf } from "../dates.js";
import { currentStreak, completion, describeSchedule, streakUnit } from "../schedule.js";
import { describeReminders } from "../reminders.js";
import { on, ui } from "./core.js";
import { emptyCard } from "./components.js";
import { openHabit } from "./habit-detail.js";
import { quitDays } from "./quit.js";

let showArchived = false;
let query = "";

function row(h) {
  const s = currentStreak(h);
  return '<button class="habit" data-action="open-habit-list" data-id="' + h.id + '" style="--hc:' + colorOf(h) + '"><div class="emoji">' + h.emoji + '</div><div class="grow"><div class="name ellipsis">' + esc(h.name) + "</div>" +
    '<div class="meta ellipsis">' + esc(describeSchedule(h)) + "</div>" +
    '<div class="tiny faint ellipsis">' + (h.reminders.on ? "🔔 " : "🔕 ") + esc(describeReminders(h)) + "</div></div>" +
    '<div class="center" style="min-width:44px"><div class="bold tabnum">' + (s ? s + "🔥" : completion(h, 30) == null ? "—" : completion(h, 30) + "%") + '</div><div class="tiny faint">' + (s ? streakUnit(h) + "s" : "30d") + "</div></div></button>";
}

export function viewHabits(app) {
  const all = state.habits, tk = keyOf(today());
  const ended = h => h.schedule.end && h.schedule.end < tk; // past its end date: kept with history, out of the way
  const active = all.filter(h => !h.archived && !ended(h)), archived = all.filter(h => h.archived || ended(h));
  document.getElementById("hdrTitle").textContent = "Habits";
  document.getElementById("hdrSub").textContent = active.length + " active" + (state.quits.length ? " · " + state.quits.length + " quitting" : "");
  let h = '<div class="row"><button class="btn sm" data-action="add-habit">+ New habit</button><button class="btn sec sm" data-action="add-quit">🚭 Quit a habit</button><button class="btn sec sm" data-action="tab" data-id="insights" aria-label="Insights" style="width:auto;flex:none;padding:0 14px">📊</button></div>';
  if (all.length > 6) h += '<input class="input" type="search" id="habit-q" placeholder="Search habits" value="' + esc(query) + '">';
  if (!active.length && !archived.length) { app.innerHTML = h + emptyCard("🌱", "Nothing here yet", "Add your first habit — try “Drink water” or “Haircut every 3 weeks”."); return; }
  const q = query.trim().toLowerCase();
  const match = x => !q || x.name.toLowerCase().includes(q) || x.category.toLowerCase().includes(q);
  const cats = {};
  active.filter(match).forEach(x => { (cats[x.category] = cats[x.category] || []).push(x); });
  Object.keys(cats).forEach(c => {
    h += '<div class="group-label"><span class="eyebrow">' + esc(c) + " · " + cats[c].length + '</span><span class="line"></span></div><div class="stack-sm">' + cats[c].map(row).join("") + "</div>";
  });
  if (state.quits.length) {
    h += '<div class="group-label"><span class="eyebrow">Quitting</span><span class="line"></span></div><div class="stack-sm">' +
      state.quits.map(x => '<button class="habit" data-action="open-quit" data-id="' + x.id + '"><div class="emoji">' + x.emoji + '</div><div class="grow"><div class="name">' + esc(x.name) + '</div><div class="meta">' + quitDays(x) + (x.mode === "limit" ? " days within limit" : " days free") + '</div></div><span class="faint">›</span></button>').join("") + "</div>";
  }
  if (archived.length) {
    h += '<button class="btn ghost" data-action="toggle-archived">' + (showArchived ? "Hide" : "Show") + " archived & ended (" + archived.length + ")</button>";
    if (showArchived) h += '<div class="stack-sm" style="opacity:.75">' + archived.filter(match).map(row).join("") + "</div>";
  }
  app.innerHTML = h;
  const qi = document.getElementById("habit-q");
  if (qi) qi.addEventListener("input", () => { query = qi.value; viewHabits(app); const n = document.getElementById("habit-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
}

on("toggle-archived", () => { showArchived = !showArchived; ui.render(); });
on("open-habit-list", id => openHabit(id, today()));
