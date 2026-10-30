// One habit: stats, log/skip/adjust for a day, 16-week heatmap, settings summary.

import { findHabit, save, state } from "../store.js";
import { canUse, repairsLeft } from "../pro.js";
import { tr } from "../i18n.js";
import { colorOf } from "../colors.js";
import { esc, toast } from "../util.js";
import { today, addDays, startOfWeek, keyOf, fmtDate, relDay, daysBetween, fromKey } from "../dates.js";
import { isScheduled, status, tap, setCount, toggleSkip, canLog, currentStreak, bestStreak, completion, totalDone, target, value, describeSchedule, streakUnit, nextDue, isDone, isSkipped, streakBreak, canSkip, isMedicine } from "../schedule.js";
import { describeReminders } from "../reminders.js";
import { on, openOverlay, rerenderOverlay, ui } from "./core.js";
import { ovHead, proTag, proSheet } from "./components.js";
import { openEditor } from "./editor.js";
import { shareButton } from "./share.js";

let cur = { id: null, day: null };

export function openHabit(id, day) {
  cur = { id, day: day || today() };
  openOverlay(renderDetail, { form: null });
}

function heatmap(h) {
  const t = today();
  const end = addDays(startOfWeek(t), 6);
  const start = addDays(startOfWeek(t), -7 * 15);
  let cells = "";
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    let cls = "l0";
    if (d > t) cls = "fut";
    else if (d < fromKey(h.schedule.start)) cls = "off";
    else if (isSkipped(h, d)) cls = "skp";
    else if (isDone(h, d)) cls = "l3";
    else if (value(h, d) > 0) cls = value(h, d) / target(h) >= 0.5 ? "l2" : "l1";
    else if (isScheduled(h, d) && status(h, d) === "open" && d < t) cls = "miss";
    else if (!isScheduled(h, d)) cls = "off";
    if (keyOf(d) === keyOf(t)) cls += " tdy";
    cells += '<div class="' + cls + '" title="' + fmtDate(d) + '"></div>';
  }
  return '<div class="heat" style="grid-template-columns:repeat(16,1fr)">' + cells + "</div>";
}

function renderDetail() {
  const h = findHabit(cur.id);
  if (!h) return ovHead('<button class="link" data-action="close">Back</button>', "Habit", "") + '<div class="ov-body">Not found</div>';
  const d = cur.day, st = status(h, d), t = target(h), v = value(h, d);
  const unit = streakUnit(h);
  let html = ovHead('<button class="link" data-action="close">Back</button>', "Habit", '<button class="link" data-action="edit-habit" data-id="' + h.id + '">Edit</button>');
  html += '<div class="ov-body">';
  html += '<div class="row"><div class="emoji" style="width:58px;height:58px;font-size:30px;border-radius:16px;background:color-mix(in srgb, ' + colorOf(h) + ' 18%, var(--surface))">' + h.emoji + '</div><div class="grow"><h2 class="sect-title" style="font-size:21px">' + esc(h.name) + "</h2>" +
    '<div class="small muted">' + esc(h.category) + (h.archived ? " · Archived" : "") + "</div></div></div>";

  html += '<div class="tiles">' +
    '<div class="tile accent"><div class="big tabnum">' + currentStreak(h) + ' 🔥</div><div class="lbl">Current streak (' + unit + "s)</div></div>" +
    '<div class="tile"><div class="big tabnum">' + bestStreak(h) + '</div><div class="lbl muted">Best streak (' + unit + "s)</div></div>" +
    '<div class="tile"><div class="big tabnum">' + (completion(h, 30) == null ? "—" : completion(h, 30) + "%") + '</div><div class="lbl muted">Last 30 days</div></div>' +
    '<div class="tile"><div class="big tabnum">' + totalDone(h) + '</div><div class="lbl muted">Times completed</div></div></div>' + repairCard(h) + shareButton(h);

  // Log for the chosen day
  html += '<div class="card pad stack-sm"><div class="spread"><div class="bold small">' + esc(relDay(d)) + "</div>" +
    (daysBetween(d, today()) > 0 || daysBetween(d, today()) < 0 ? '<button class="link small" data-action="detail-day" data-id="' + keyOf(today()) + '">Go to today</button>' : '<button class="link small" data-action="detail-day" data-id="' + keyOf(addDays(today(), -1)) + '">Yesterday</button>') + "</div>";
  if (!canLog(d)) {
    html += '<div class="hint">Future day — nothing to log yet.</div>';
  } else if (!isScheduled(h, d) && !isDone(h, d)) {
    const nd = nextDue(h, d);
    html += '<div class="hint">Not scheduled for this day' + (nd ? " · next on " + fmtDate(nd) : "") + ". You can still log it.</div>";
  }
  if (canLog(d)) {
    if (h.type === "count") {
      html += '<div class="row" style="justify-content:center;gap:16px"><button class="icon-btn" style="width:48px;height:48px;font-size:22px" data-action="detail-dec">−</button>' +
        '<div class="center"><div class="tabnum" style="font-size:34px;font-weight:700;font-family:var(--serif)">' + v + '<span class="muted" style="font-size:18px"> / ' + t + "</span></div><div class=\"tiny muted\">" + esc(h.unit || "") + "</div></div>" +
        '<button class="icon-btn" style="width:48px;height:48px;font-size:22px;background:var(--accent);color:var(--on-accent);border-color:var(--accent)" data-action="detail-inc">+</button></div>' +
        '<div class="inline" style="justify-content:center"><span class="small muted">Set exact amount</span><input class="input num" type="number" min="0" id="detail-amt" value="' + v + '"><button class="btn xs soft" data-action="detail-set">Set</button></div>';
    } else {
      html += '<button class="btn' + (st === "done" ? " sec" : "") + '" data-action="detail-toggle">' + (st === "done" ? "✓ Done — tap to undo" : "Mark as done") + "</button>";
    }
    // Medicine: no streak talk next to a dose. Past days can't be skipped (rest days, breaks and repairs cover those).
    const med = isMedicine(h);
    if (canSkip(h, d)) html += '<button class="btn ghost small" data-action="detail-skip">' + (st === "skip" ? (med ? "Undo" : "Unskip this day") : (med ? "Didn't take it today" : "Skip this day (keeps your streak)")) + "</button>";
  }
  html += "</div>";

  html += '<div class="card pad stack-sm"><div class="spread"><div class="bold small">Last 16 weeks</div><span class="tiny muted">' + (completion(h, 112) == null ? "Not due yet" : completion(h, 112) + "% done") + "</span></div>" + heatmap(h) +
    '<div class="legend"><span><i style="background:var(--heat-3)"></i>Done</span><span><i style="background:var(--heat-1)"></i>Partly</span><span><i style="background:var(--amber-soft);box-shadow:inset 0 0 0 1px var(--amber-line)"></i>Missed</span><span><i style="background:var(--skip)"></i>Skipped</span><span><i style="box-shadow:inset 0 0 0 1px var(--border)"></i>Not due</span></div></div>';

  html += '<div class="list">' +
    '<button class="li" data-action="edit-habit" data-id="' + h.id + '"><span class="lic">📅</span><span class="grow"><span class="small bold" style="display:block">Schedule</span><span class="tiny muted">' + esc(describeSchedule(h)) + '</span></span><span class="chev">›</span></button>' +
    '<button class="li" data-action="edit-habit" data-id="' + h.id + '"><span class="lic">🔔</span><span class="grow"><span class="small bold" style="display:block">Reminders</span><span class="tiny muted">' + esc(describeReminders(h)) + '</span></span><span class="chev">›</span></button>' +
    (h.type === "count" ? '<div class="li"><span class="lic">🎯</span><span class="grow"><span class="small bold" style="display:block">Daily goal</span><span class="tiny muted">' + t + " " + esc(h.unit) + " · +" + h.step + " per tap</span></span></div>" : "") +
    (h.notes ? '<div class="li"><span class="lic">📝</span><span class="grow small">' + esc(h.notes) + "</span></div>" : "") +
    (h.source ? '<div class="li"><span class="lic">🔗</span><span class="grow tiny muted">Created from your ' + (h.source.startsWith("faith") ? "faith" : "routine") + " setup — changing that setup updates this habit.</span></div>" : "") +
    "</div>";
  return html + "</div>";
}

// A streak that broke in the last week can be mended once a month with Pro.
function repairCard(h) {
  const b = !h.archived && streakBreak(h);
  if (!b) return "";
  return '<div class="card pad row repair"><span class="emo" style="font-size:24px">🩹</span><div class="grow small"><div class="bold">' +
    esc(tr("Your streak broke on {d}", { d: fmtDate(fromKey(b.from), { weekday: "short", day: "numeric", month: "short" }) })) + '</div><div class="tiny muted">' +
    esc(tr("Repair it to get back to {n}. Once a month.", { n: b.before })) + '</div></div><button class="btn xs soft" data-action="repair-streak">Repair' + proTag("streakRepair") + "</button></div>";
}
on("repair-streak", () => {
  const h = curHabit(), b = h && streakBreak(h); if (!b) return;
  if (!canUse("streakRepair")) return proSheet("🩹", "Repair a broken streak with Pro", "Once a month, mend a streak that broke in the last week — for the days life got in the way.");
  if (!repairsLeft()) { toast("You've used this month's repair — next one on the 1st"); return; }
  h.repaired = (h.repaired || []).concat(b.days);
  state.repairs.push(keyOf(today()));
  save(); rerenderOverlay(); ui.render();
  toast(tr("Repaired — back to {n} 🔥", { n: currentStreak(h) }));
});
function curHabit() { return findHabit(cur.id); }
on("edit-habit", id => openEditor(id));
on("detail-day", id => { cur.day = fromKey(id); rerenderOverlay(); });
on("detail-toggle", () => { const h = curHabit(); if (!h) return; tap(h, cur.day); save(); rerenderOverlay(); ui.render(); });
on("detail-inc", () => { const h = curHabit(); if (!h) return; setCount(h, cur.day, value(h, cur.day) + (h.step || 1)); save(); rerenderOverlay(); });
on("detail-dec", () => { const h = curHabit(); if (!h) return; setCount(h, cur.day, value(h, cur.day) - (h.step || 1)); save(); rerenderOverlay(); });
on("detail-set", () => {
  const h = curHabit(); if (!h) return;
  const n = parseFloat(document.getElementById("detail-amt").value);
  if (isNaN(n)) { toast("Enter a number"); return; }
  setCount(h, cur.day, n); save(); rerenderOverlay();
});
on("detail-skip", () => {
  const h = curHabit(); if (!h || !canSkip(h, cur.day)) return;
  toggleSkip(h, cur.day); save(); rerenderOverlay();
  toast(isMedicine(h) ? (isSkipped(h, cur.day) ? "Noted — if you're unsure about a missed dose, ask your pharmacist" : "Undone") : (isSkipped(h, cur.day) ? "Skipped — streak is safe" : "Unskipped"));
});
