// One-off tasks: things for a specific day (or no day yet), with an optional
// time, reminder and carry-over to the next day if they aren't finished.

import { state } from "./store.js";
import { keyOf, fromKey, today, daysBetween, toMin } from "./dates.js";
import { uid } from "./util.js";

export const REMIND_OPTIONS = [[null, "No reminder"], [0, "At the time"], [5, "5 min before"], [10, "10 min before"], [15, "15 min before"], [30, "30 min before"], [60, "1 hour before"], [1440, "1 day before"]];

export function newTask(over) {
  return Object.assign({
    id: uid(), title: "", emoji: "", date: keyOf(today()), time: "", duration: 0, notes: "",
    priority: "normal", done: false, doneAt: null, remind: null, carry: true, createdAt: Date.now()
  }, over || {});
}

function byTime(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if ((a.priority === "high") !== (b.priority === "high")) return a.priority === "high" ? -1 : 1;
  const ta = toMin(a.time), tb = toMin(b.time);
  if (ta == null && tb == null) return a.createdAt - b.createdAt;
  if (ta == null) return 1;
  if (tb == null) return -1;
  return ta - tb;
}

// Tasks shown on a day: due that day, plus (on today) unfinished carry-over tasks from earlier days.
export function tasksOn(d) {
  const k = keyOf(d), isToday = daysBetween(d, today()) === 0;
  return state.tasks.filter(t => {
    if (!t.date) return false;
    if (t.date === k) return true;
    if (t.done && t.doneAt && keyOf(t.doneAt) === k && t.carry && t.date < k) return true; // finished after carrying over
    return isToday && !t.done && t.carry && t.date < k;
  }).sort(byTime);
}

export function overdueLabel(t, d) {
  if (!t.date || t.date >= keyOf(d)) return "";
  const n = daysBetween(fromKey(t.date), d);
  return n === 1 ? "from yesterday" : "from " + n + " days ago";
}

export function inbox() { return state.tasks.filter(t => !t.date && !t.done).sort(byTime); }

export function toggleTask(t) {
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
}

// Clear out completed tasks older than 60 days so storage stays small.
export function pruneTasks() {
  const cutoff = Date.now() - 60 * 86400000;
  state.tasks = state.tasks.filter(t => !(t.done && t.doneAt && t.doneAt < cutoff));
}

export function openCount(d) { return tasksOn(d).filter(t => !t.done).length; }
