// Work + sleep setup used in onboarding and Settings. Handles day, evening,
// night, rotating and flexible shifts with separate work-day / day-off sleep.

import { esc } from "../util.js";
import { getPath, setPath } from "../util.js";
import { fmtTime, fmtDuration, clockSpan, toMin, keyOf, fromKey, today, addDays, daysBetween } from "../dates.js";
import { SHIFTS, shiftInfo, sleepVerdict, suggestDayStart } from "../routine.js";
import { on, ui, rerenderOverlay } from "./core.js";
import { option, daysPicker, numInput, selectEl, switchEl } from "./components.js";

function hourLabel(h) { return fmtTime(h * 60); }

function sleepBlock(path, win, title) {
  const v = sleepVerdict(win);
  return '<div class="stack-sm"><div class="small bold">' + title + "</div>" +
    '<div class="row"><div class="field grow"><label>Go to bed</label><input type="time" data-bind="' + path + '.bed" value="' + esc(win.bed) + '" data-rerender></div>' +
    '<div class="field grow"><label>Wake up</label><input type="time" data-bind="' + path + '.wake" value="' + esc(win.wake) + '" data-rerender></div></div>' +
    '<div class="' + (v.level === "warn" ? "warn" : "okbox") + '">😴 ' + fmtDuration(clockSpan(win.bed, win.wake)) + " of sleep · " + v.text + "</div></div>";
}

/**
 * @param {string} p    path to the schedule object in the form model
 * @param {string} dp   path to dayStartHour in the form model
 */
export function routineFields(p, dp) {
  const m = ui.form;
  const sch = getPath(m, p);
  const dayStart = getPath(m, dp);
  let h = '<div class="options">' + SHIFTS.map(s => option(p + ".shift", s.id, sch.shift, s.emoji, s.title, s.desc, ' data-then="shift-preset" data-prefix="' + p + '" data-daypath="' + dp + '"')).join("") + "</div>";

  if (sch.shift !== "none") {
    h += '<div class="card pad stack-sm">';
    if (sch.shift === "rotating") {
      h += '<div class="small bold">Your rotation</div>' +
        '<div class="inline">' + numInput(p + ".rotation.on", sch.rotation.on, 1, 30, " data-rerender") + '<span class="small">days on, then</span>' + numInput(p + ".rotation.off", sch.rotation.off, 0, 30, " data-rerender") + '<span class="small">days off</span></div>' +
        '<div class="chips">' + [[2, 2], [3, 3], [4, 4], [5, 2], [6, 3], [7, 7]].map(([a, b]) => '<button type="button" class="chip" data-action="set-rotation" data-id="' + a + "," + b + '" data-prefix="' + p + '" style="min-height:32px">' + a + " on / " + b + " off</button>").join("") + "</div>" +
        rotationToday(p, sch);
    } else {
      h += '<div class="small bold">Which days do you work?</div>' + daysPicker(p + ".workDays", sch.workDays);
    }
    h += '<div class="row"><div class="field grow"><label>Shift starts</label><input type="time" data-bind="' + p + '.workStart" value="' + esc(sch.workStart) + '" data-rerender></div>' +
      '<div class="field grow"><label>Shift ends</label><input type="time" data-bind="' + p + '.workEnd" value="' + esc(sch.workEnd) + '" data-rerender></div></div>';
    if (toMin(sch.workEnd) < toMin(sch.workStart)) h += '<div class="hint">🌙 Overnight shift — ends the next morning (' + fmtDuration(clockSpan(sch.workStart, sch.workEnd)) + ").</div>";
    else if (sch.workStart && sch.workEnd) h += '<div class="hint">' + fmtDuration(clockSpan(sch.workStart, sch.workEnd)) + " shift.</div>";
    h += "</div>";
  }

  h += '<div class="card pad stack">';
  h += sleepBlock(p + ".sleep.work", sch.sleep.work, sch.shift === "none" ? "Your sleep" : "Sleep on work days");
  if (sch.shift !== "none") {
    h += '<div class="toggle-row"><div class="small">Same sleep times on days off</div>' + switchEl(p + ".sleep.sameOnOff", sch.sleep.sameOnOff) + "</div>";
    if (!sch.sleep.sameOnOff) h += sleepBlock(p + ".sleep.off", sch.sleep.off, "Sleep on days off");
  }
  if (sch.shift === "night") h += '<div class="hint">Sleeping during the day is completely fine — your wake-up, bedtime and "day" all follow these times, not the clock.</div>';
  h += "</div>";

  const sug = suggestDayStart(sch);
  h += '<div class="card pad stack-sm"><div class="small bold">When should a new day start in Waqti?</div>' +
    '<div class="hint">Anything you tick before this time counts for the day before — so finishing a habit at 3 AM on a night shift still counts for that shift. Pick a time you\'re usually asleep. Your history isn\'t changed.</div>' +
    '<div class="inline">' + selectEl(dp, Array.from({ length: 19 }, (_, i) => [i, i === 0 ? "Midnight" : hourLabel(i)]), dayStart, ' data-num data-rerender style="width:150px"') +
    (sug !== dayStart ? '<button type="button" class="chip" data-action="set" data-path="' + dp + '" data-val="' + sug + '" data-num>Use suggested: ' + (sug === 0 ? "midnight" : hourLabel(sug)) + "</button>" : '<span class="badge live">Recommended</span>') + "</div></div>";
  return h;
}

on("shift-preset", (val, el) => {
  const p = el.dataset.prefix, dp = el.dataset.daypath;
  const sch = getPath(ui.form, p);
  const info = shiftInfo(val);
  if (info.start) { sch.workStart = info.start; sch.workEnd = info.end; }
  sch.sleep.work = Object.assign({}, info.sleep.work);
  sch.sleep.off = Object.assign({}, info.sleep.off);
  if (val === "rotating" && !sch.rotation.anchor) sch.rotation.anchor = keyOf(today());
  if (val === "night" || val === "evening") sch.sleep.sameOnOff = false;
  setPath(ui.form, dp, suggestDayStart(sch));
});

// "Which day of your rotation is today?" — easier than picking the first day of a block.
function rotationToday(p, sch) {
  const on = Math.max(1, +sch.rotation.on || 1), off = Math.max(0, +sch.rotation.off || 0), cycle = on + off;
  const idx = ((daysBetween(fromKey(sch.rotation.anchor || keyOf(today())), today()) % cycle) + cycle) % cycle;
  const opts = [];
  for (let i = 0; i < on; i++) opts.push([i, "Work day " + (i + 1) + " of " + on]);
  for (let j = 0; j < off; j++) opts.push([on + j, "Day off " + (j + 1) + " of " + off]);
  return '<div class="field"><label>Which day of your rotation is today?</label>' +
    selectEl("_rotIdx", opts, idx, ' data-num data-onchange="rotation-today" data-prefix="' + p + '"') + "</div>";
}

on("rotation-today", (val, el) => {
  const sch = getPath(ui.form, el.dataset.prefix);
  sch.rotation.anchor = keyOf(addDays(today(), -(+val || 0)));
  rerenderOverlay();
});

on("set-rotation", (id, el) => {
  const sch = getPath(ui.form, el.dataset.prefix);
  const [a, b] = id.split(",").map(Number);
  sch.rotation.on = a; sch.rotation.off = b;
  rerenderOverlay();
});
