// Reusable markup builders. Form pieces bind to the current overlay model
// through data-bind / data-action="set" (see core.js).

import { esc, CHECK_SVG } from "../util.js";
import { DAY_MIN, DAY_LONG, weekOrder } from "../dates.js";
import { openSheet, on, ui } from "./core.js";
import { state, save } from "../store.js";
import { showProTag } from "../pro.js";

// A small "Pro" tag next to something that needs Pro — only once purchases exist.
export const proTag = feature => showProTag(feature) ? ' <span class="badge pro">Pro</span>' : "";
// The sheet shown when a free user taps something that needs Pro.
export function proSheet(emoji, title, body) {
  openSheet('<div class="sheet-head"><div class="sect-title">' + emoji + " <span>" + esc(title) + '</span></div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    '<div class="small muted">' + esc(body) + "</div>" +
    '<button class="btn" data-action="pro-open">✨ <span>See Waqti Pro</span></button><button class="btn ghost" data-action="close-sheet">Not now</button></div>');
}

export function ring(pct, size = 76) {
  const r = size / 2 - 6, c = 2 * Math.PI * r, off = c * (1 - pct / 100), m = size / 2;
  return '<div class="ring" role="img" aria-label="' + pct + '% done" style="width:' + size + "px;height:" + size + 'px"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '" aria-hidden="true">' +
    '<circle cx="' + m + '" cy="' + m + '" r="' + r + '" fill="none" stroke="var(--ring-track, var(--surface-2))" stroke-width="7"/>' +
    '<circle cx="' + m + '" cy="' + m + '" r="' + r + '" fill="none" stroke="var(--ring-fill, var(--accent))" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 ' + m + " " + m + ')"/>' +
    '</svg><div class="pct tabnum" aria-hidden="true">' + pct + "%</div></div>";
}

export function check(on, attrs, cls) {
  return '<button class="check' + (on ? " on" : "") + (cls ? " " + cls : "") + '" ' + attrs + ">" + CHECK_SVG + "</button>";
}

// "✓ 6 done" under the day switcher on Today and Plan: finished items fold away so the list shows
// what's left. Closed at first; once opened it stays open (state.meta.doneOpen) until closed.
// Unticking an item inside sends it back to its place.
export function doneFold(n, rows) {
  if (!n) return "";
  const open = !!(state && state.meta && state.meta.doneOpen);
  return '<div class="card done-fold"><button class="spread done-head" data-action="done-fold" aria-expanded="' + open + '">' +
    '<span class="small bold">✓ <span class="tabnum">' + n + "</span> <span>done</span></span><span class=\"faint\" aria-hidden=\"true\">" + (open ? "▴" : "▾") + "</span></button>" +
    (open ? '<div class="done-body">' + rows + "</div>" : "") + "</div>";
}
on("done-fold", () => { state.meta.doneOpen = !state.meta.doneOpen; save(); ui.render(); });

// Segmented control bound to `path`.
export function seg(path, options, current, cols, extra) {
  return '<div class="seg" role="group" style="--cols:' + (cols || options.length) + '">' + options.map(o =>
    '<button type="button" aria-pressed="' + (String(o[0]) === String(current)) + '" class="' + (String(o[0]) === String(current) ? "on" : "") + '" data-action="set" data-path="' + path + '" data-val="' + esc(o[0]) + '"' + (typeof o[0] === "number" ? " data-num" : "") + (extra || "") + ">" + o[1] + "</button>"
  ).join("") + "</div>";
}

export function chipsSet(path, options, current) {
  return '<div class="chips">' + options.map(o =>
    '<button type="button" aria-pressed="' + (String(o[0]) === String(current)) + '" class="chip' + (String(o[0]) === String(current) ? " on" : "") + '" data-action="set" data-path="' + path + '" data-val="' + esc(o[0]) + '"' + (typeof o[0] === "number" ? " data-num" : "") + ">" + o[1] + "</button>"
  ).join("") + "</div>";
}

// Weekday picker (ordered by the user's week start) bound to an array path.
export function daysPicker(path, selected) {
  selected = selected || [];
  return '<div class="days">' + weekOrder().map(d =>
    '<button type="button" class="' + (selected.includes(d) ? "on" : "") + '" data-action="toggle-in" data-path="' + path + '" data-val="' + d + '" data-num aria-pressed="' + selected.includes(d) + '" aria-label="' + DAY_LONG[d] + '">' + DAY_MIN[d] + "</button>"
  ).join("") + "</div>";
}

export function switchEl(bind, checked, rerender) {
  return '<label class="switch"><input type="checkbox" data-bind="' + bind + '"' + (checked ? " checked" : "") + (rerender === false ? "" : " data-rerender") + '><span></span></label>';
}

export function toggleRow(title, bind, checked, hint, rerender) {
  return '<div class="toggle-row"><div class="grow"><div class="bold small">' + title + "</div>" + (hint ? '<div class="hint">' + hint + "</div>" : "") + "</div>" + switchEl(bind, checked, rerender) + "</div>";
}

export function checkRow(emoji, title, bind, checked, hint) {
  return '<label class="checkrow"><input type="checkbox" data-bind="' + bind + '"' + (checked ? " checked" : "") + " data-rerender>" +
    (emoji ? '<span class="emo">' + emoji + "</span>" : "") +
    '<span class="grow"><span class="bold small" style="display:block">' + title + "</span>" + (hint ? '<span class="hint">' + hint + "</span>" : "") + "</span></label>";
}

export function timeInput(bind, value, extra) {
  return '<input class="input time" type="time" data-bind="' + bind + '" value="' + esc(value || "") + '"' + (extra || "") + ">";
}

export function numInput(bind, value, min, max, extra) {
  return '<input class="input num" type="number" inputmode="numeric" data-bind="' + bind + '" value="' + esc(value == null ? "" : value) + '"' + (min != null ? ' min="' + min + '"' : "") + (max != null ? ' max="' + max + '"' : "") + (extra || "") + ">";
}

// Editable list of times with add/remove.
export function timeList(path, times, addDefault) {
  return '<div class="timelist">' + (times || []).map((t, i) =>
    '<span class="timechip"><input type="time" data-bind="' + path + "." + i + '" value="' + esc(t) + '"><button type="button" data-action="list-del" data-path="' + path + '" data-idx="' + i + '" aria-label="Remove time">✕</button></span>'
  ).join("") + '<button type="button" class="chip" data-action="list-add" data-path="' + path + '" data-val="' + (addDefault || "12:00") + '">+ Add time</button></div>';
}

export function selectEl(bind, options, current, extra) {
  return '<select class="input" data-bind="' + bind + '"' + (extra || "") + ">" + options.map(o =>
    '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(current) ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select>";
}

export function option(path, val, cur, emoji, title, desc, extra) {
  return '<button type="button" class="option' + (String(val) === String(cur) ? " on" : "") + '" data-action="set" data-path="' + path + '" data-val="' + esc(val) + '"' + (extra || "") + ">" +
    '<span class="oi">' + emoji + '</span><span class="ot">' + title + "</span>" + (desc ? '<span class="od">' + desc + "</span>" : "") + "</button>";
}

export function ovHead(left, title, right) {
  return '<div class="ov-head">' + (left || "<span></span>") + "<h2>" + title + "</h2>" + (right || "<span></span>") + "</div>";
}

export function section(title, body, aside) {
  return '<div class="section"><div class="section-head"><div class="eyebrow">' + title + "</div>" + (aside || "") + "</div>" + body + "</div>";
}

export function emptyCard(emoji, title, text) {
  return '<div class="card pad center stack-xs"><div class="emo" style="font-size:32px">' + emoji + '</div><div class="sect-title">' + title + '</div><div class="small muted">' + text + "</div></div>";
}
