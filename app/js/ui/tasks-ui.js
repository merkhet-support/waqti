// Task rows, quick-add, the task editor, and meeting rows shared by Today and Calendar.

import { state, save } from "../store.js";
import { esc, toast, deepClone } from "../util.js";
import { keyOf, today, addDays, fmtTime, fmtDate, relDay } from "../dates.js";
import { newTask, toggleTask, overdueLabel, REMIND_OPTIONS } from "../tasks.js";
import { PROVIDER } from "../calendars.js";
import { on, openOverlay, closeOverlay, rerenderOverlay, ui } from "./core.js";
import { check, ovHead, selectEl, switchEl, seg } from "./components.js";
import { openEmojiPicker } from "./emoji-picker.js";

export function taskRow(t, d) {
  const meta = [];
  const od = overdueLabel(t, d);
  if (od && !t.done) meta.push("↪ " + od);
  if (t.time) meta.push(fmtTime(t.time) + (t.duration ? " · " + t.duration + " min" : ""));
  if (t.remind != null && !t.done) meta.push("🔔");
  if (t.fromName) meta.push("👤 " + t.fromName);
  if (t.notes) meta.push(t.notes.split("\n")[0].slice(0, 40));
  return '<div class="habit task' + (t.done ? " is-done" : "") + (t.priority === "high" && !t.done ? " is-high" : "") + '">' +
    '<button class="habit-main" data-action="edit-task" data-id="' + t.id + '"><div class="emoji task-ico">' + (t.emoji || (t.priority === "high" ? "❗" : "📝")) + "</div>" +
    '<div class="grow"><div class="name ellipsis' + (t.done ? " strike-t" : "") + '">' + esc(t.title) + "</div>" + (meta.length ? '<div class="meta ellipsis">' + esc(meta.join(" · ")) + "</div>" : "") + "</div></button>" +
    check(t.done, 'data-action="toggle-task" data-id="' + t.id + '" aria-label="' + (t.done ? "Mark not done" : "Mark done") + '"') + "</div>";
}

export function quickAdd(d) {
  return '<form class="quick-add" data-day="' + keyOf(d) + '" id="quick-add-form"><input id="quick-task" class="input" placeholder="+ Add a task for ' + esc(relDay(d).toLowerCase() === "today" ? "today" : fmtDate(d)) + '…" autocomplete="off" enterkeyhint="done" maxlength="120"><button class="btn xs" type="submit">Add</button></form>';
}

export function eventRow(e) {
  const p = e.provider && PROVIDER[e.provider];
  const time = e.allDay ? "All day" : fmtTime(new Date(e.start).getHours() * 60 + new Date(e.start).getMinutes()) + "–" + fmtTime(new Date(e.end).getHours() * 60 + new Date(e.end).getMinutes());
  const now = Date.now(), live = !e.allDay && now >= e.start - 10 * 60000 && now < e.end;
  return '<div class="habit event" style="--ev:' + e.color + '"><span class="ev-bar"></span><div class="grow"><div class="name ellipsis">' + esc(e.title) + "</div>" +
    '<div class="meta ellipsis">' + esc(time + (e.location && !/^https?:/.test(e.location) ? " · " + e.location : "")) + "</div></div>" +
    (p && e.join ? '<a class="btn xs' + (live ? "" : " soft") + '" href="' + esc(e.join) + '" target="_blank" rel="noopener">' + p.label + "</a>" : "") + "</div>";
}

// Wire the quick-add form after rendering a view that contains it.
export function bindQuickAdd(onDone) {
  const f = document.getElementById("quick-add-form");
  if (!f) return;
  f.addEventListener("submit", e => {
    e.preventDefault();
    const inp = document.getElementById("quick-task");
    const title = inp.value.trim();
    if (!title) return;
    const parsed = parseQuick(title);
    state.tasks.push(newTask(Object.assign({ date: f.dataset.day }, parsed)));
    save();
    toast("Task added");
    onDone && onDone();
    const again = document.getElementById("quick-task");
    if (again) again.focus();
  });
}

// "Call bank 3pm" / "Gym at 18:30" -> picks up a time at the end of the title.
function parseQuick(s) {
  const m = s.match(/^(.*?)(?:\s+(?:at|@))?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m && (m[4] || m[3]) && +m[2] <= 23) {
    let h = +m[2]; const mi = +(m[3] || 0); const ap = (m[4] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
    return { title: m[1].trim(), time: String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0"), remind: 10 };
  }
  return { title: s };
}

/* ---------- editor ---------- */
export function openTaskEditor(id, date) {
  const t = id ? deepClone(state.tasks.find(x => x.id === id)) : newTask({ date: date ? keyOf(date) : keyOf(today()) });
  if (!t) return;
  t._new = !id;
  openOverlay(renderTaskEditor, { form: t, push: true });
  if (!id) setTimeout(() => { const n = document.getElementById("t-title"); if (n) n.focus(); }, 50);
}

function renderTaskEditor() {
  const t = ui.form;
  const tk = keyOf(today()), tm = keyOf(addDays(today(), 1));
  const dateMode = !t.date ? "none" : t.date === tk ? "today" : t.date === tm ? "tomorrow" : "pick";
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', t._new ? "New task" : "Task", '<button class="link" data-action="save-task">Save</button>') + '<div class="ov-body">';
  h += '<div class="row" style="align-items:flex-end"><button type="button" class="emo-btn" data-action="task-emoji" aria-label="Choose an icon">' + (t.emoji || "📝") + "</button>" +
    '<div class="field grow"><label for="t-title">What needs doing?</label><input id="t-title" data-bind="title" value="' + esc(t.title) + '" placeholder="e.g. Send the report to Sara" maxlength="120"></div></div>';

  h += '<div class="card pad stack-sm"><div class="small bold">When</div><div class="seg" style="--cols:4">' +
    [["today", "Today", tk], ["tomorrow", "Tomorrow", tm], ["pick", "Pick a day", t.date || tk], ["none", "Someday", ""]].map(([k, l, v]) =>
      '<button type="button" class="' + (dateMode === k ? "on" : "") + '" data-action="task-date" data-id="' + v + '" data-mode="' + k + '">' + l + "</button>").join("") + "</div>";
  if (dateMode === "pick") h += '<input class="input" type="date" data-bind="date" value="' + esc(t.date) + '" data-rerender>';
  if (t.date) {
    h += '<div class="row"><div class="field grow"><label>Time (optional)</label><input type="time" data-bind="time" value="' + esc(t.time) + '" data-rerender></div>' +
      '<div class="field grow"><label>Takes (min)</label><input type="number" min="0" step="5" data-bind="duration" value="' + (t.duration || "") + '" placeholder="—"></div></div>';
    h += '<div class="field"><label>Reminder</label>' + selectEl("remind", REMIND_OPTIONS.map(o => [o[0] == null ? "null" : o[0], o[1]]), t.remind == null ? "null" : t.remind, " data-rerender") + "</div>";
    const rem = t.remind === null || t.remind === "null" || t.remind === "" ? null : +t.remind;
    if (rem != null && !t.time) h += '<div class="hint">No time set, so the reminder comes at the start of your day.</div>';
    h += '<div class="toggle-row"><div><div class="small bold">Move to the next day if not done</div><div class="hint">Unfinished tasks show up on Today until you tick them off</div></div>' + switchEl("carry", t.carry) + "</div>";
  }
  h += "</div>";
  h += '<div class="card pad stack-sm"><div class="small bold">Priority</div>' + seg("priority", [["normal", "Normal"], ["high", "❗ Important — pin to top"]], t.priority, 2) + "</div>";
  h += '<div class="field"><label>Notes</label><textarea data-bind="notes" maxlength="500" placeholder="Details, links, who to ask…">' + esc(t.notes) + "</textarea></div>";
  if (!t._new) h += '<div class="row"><button class="btn sec sm" data-action="task-done-toggle">' + (t.done ? "Mark not done" : "✓ Mark done") + '</button><button class="btn danger sm" data-action="delete-task" data-id="' + t.id + '">Delete</button></div>';
  h += '<button class="btn" data-action="save-task">Save task</button>';
  if (t._new) h += '<button class="btn ghost" data-action="task-ask">📨 <span>Ask someone to do this instead</span></button>';
  return h + "</div>";
}

on("task-date", (v, el) => {
  const mode = el.dataset.mode;
  ui.form.date = mode === "none" ? null : v;
  if (mode === "pick" && !ui.form.date) ui.form.date = keyOf(addDays(today(), 2));
  if (mode === "pick" && (ui.form.date === keyOf(today()) || ui.form.date === keyOf(addDays(today(), 1)))) ui.form.date = keyOf(addDays(today(), 2));
  rerenderOverlay();
});
on("task-emoji", () => openEmojiPicker(ui.form.emoji, e => { ui.form.emoji = e; rerenderOverlay(); }));
on("task-done-toggle", () => { toggleTask(ui.form); rerenderOverlay(); });
on("save-task", () => {
  const t = ui.form;
  t.title = (t.title || "").trim();
  if (!t.title) { toast("Give the task a name"); return; }
  if (t.remind === "null" || t.remind === "") t.remind = null; else if (t.remind != null) t.remind = +t.remind;
  t.duration = Math.max(0, +t.duration || 0);
  const isNew = t._new; delete t._new;
  if (isNew) state.tasks.push(t); else { const i = state.tasks.findIndex(x => x.id === t.id); if (i >= 0) state.tasks[i] = t; }
  save(); closeOverlay(); toast(isNew ? "Task added" : "Saved");
});
on("delete-task", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = "Tap again to delete"; return; }
  state.tasks = state.tasks.filter(x => x.id !== id); save(); closeOverlay(); toast("Task deleted");
});
on("edit-task", id => openTaskEditor(id));
on("task-ask", () => {
  const t = ui.form;
  closeOverlay();
  import("./requests.js").then(m => m.openAsk({ title: t.title, emoji: t.emoji, date: t.date || "", time: t.time, remind: t.remind == null || t.remind === "null" ? 60 : t.remind, notes: t.notes }));
});
on("toggle-task", id => {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  toggleTask(t); save();
  if (t.done) toast("Done ✓");
  ui.render();
});

