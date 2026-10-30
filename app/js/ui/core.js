// UI plumbing: action registry (event delegation), full-screen overlays,
// bottom sheets, and declarative form binding.
//
// Markup conventions:
//   data-action="name" data-id="…"           -> registered handler
//   data-bind="a.b"                           -> two-way bind input to the current form model
//   data-action="set" data-path="a.b" data-val="x" [data-num]     -> set value, re-render
//   data-action="toggle-in" data-path="a.days" data-val="3" [data-num] -> toggle in array
//   data-action="list-add" data-path="a.times" data-val="08:00"   -> push into array
//   data-action="list-del" data-path="a.times" data-idx="0"       -> remove from array
//   data-rerender on an input                 -> re-render the form after it changes

import { getPath, setPath } from "../util.js";

const handlers = {};
export function on(name, fn) { handlers[name] = fn; }

const overlayEl = () => document.getElementById("overlay");
const sheetEl = () => document.getElementById("sheet");
const backdropEl = () => document.getElementById("sheet-backdrop");

export const ui = {
  render: () => {},        // set by app.js
  form: null,              // current form model
  formRender: null,        // () => html for the current overlay
  overlayStack: []
};

/* ---------- overlays ---------- */
export function openOverlay(renderFn, opts = {}) {
  const ov = overlayEl();
  const keep = opts.keepScroll ? ov.scrollTop : 0;
  if (!opts.replace && ui.formRender && ov.classList.contains("show") && opts.push) ui.overlayStack.push({ render: ui.formRender, form: ui.form, cls: ov.dataset.cls || "" });
  ui.formRender = renderFn;
  if (opts.form !== undefined) ui.form = opts.form;
  ov.dataset.cls = opts.cls || "";
  ov.className = "show" + (opts.cls ? " " + opts.cls : "");
  swap(ov, '<div class="inner">' + renderFn() + "</div>");
  ov.scrollTop = keep;
  document.body.style.overflow = "hidden";
  if (opts.focus) { const f = ov.querySelector(opts.focus); if (f) f.focus(); }
}

export function rerenderOverlay() {
  if (!ui.formRender) return;
  const ov = overlayEl();
  const top = ov.scrollTop;
  const active = document.activeElement && ov.contains(document.activeElement) ? document.activeElement.getAttribute("data-bind") : null;
  swap(ov.querySelector(".inner"), ui.formRender());
  ov.scrollTop = top;
  if (active) { const el = ov.querySelector('[data-bind="' + active + '"]'); if (el && el.type !== "checkbox") el.focus({ preventScroll: true }); }
}

export function closeOverlay(opts = {}) {
  const ov = overlayEl();
  const prev = ui.overlayStack.pop();
  if (prev && !opts.all) {
    ui.formRender = prev.render; ui.form = prev.form;
    ov.className = "show" + (prev.cls ? " " + prev.cls : "");
    swap(ov.querySelector(".inner"), prev.render());
    ui.render();
    return;
  }
  ui.overlayStack = [];
  ov.className = ""; swap(ov, "");
  ui.form = null; ui.formRender = null;
  document.body.style.overflow = "";
  ui.render();
}
// Replace a container's content safely. Removing a focused field fires blur/"change"
// mid-replacement; we blur first (so the typed value is still saved to the form) and
// skip any re-render that change would trigger while we're swapping.
let swapping = false;
function swap(el, html) {
  swapping = true;
  try {
    const a = document.activeElement;
    if (a && a !== document.body && el.contains(a)) a.blur();
    el.innerHTML = html;
  } finally { swapping = false; }
}

export function overlayOpen() { const o = overlayEl(); return !!o && o.classList.contains("show"); }

/* ---------- bottom sheet ---------- */
let sheetClose = null;
export function openSheet(html, onClose) {
  const s = sheetEl();
  s.innerHTML = '<div class="sheet-grip"></div>' + html;
  backdropEl().classList.add("show");
  requestAnimationFrame(() => s.classList.add("show"));
  sheetClose = onClose || null;
}
export function setSheetBody(sel, html) { const el = sheetEl().querySelector(sel); if (el) el.innerHTML = html; }
export function closeSheet() {
  sheetEl().classList.remove("show");
  backdropEl().classList.remove("show");
  const cb = sheetClose; sheetClose = null;
  if (cb) cb();
}

/* ---------- events ---------- */
function coerce(el, raw) {
  if (el.hasAttribute("data-num")) { const n = parseFloat(raw); return isNaN(n) ? 0 : n; }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  return raw;
}

function readInput(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number" || el.hasAttribute("data-num")) { const n = parseFloat(el.value); return isNaN(n) ? null : n; }
  return el.value;
}

export function initEvents() {
  document.addEventListener("click", e => {
    if (e.target === backdropEl()) { closeSheet(); return; }
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const a = el.getAttribute("data-action"), id = el.getAttribute("data-id");
    const model = ui.form;
    if (a === "set" && model) { setPath(model, el.dataset.path, coerce(el, el.dataset.val)); afterChange(el); return; }
    if (a === "toggle-in" && model) {
      const arr = (getPath(model, el.dataset.path) || []).slice();
      const v = coerce(el, el.dataset.val);
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      arr.sort((x, y) => (typeof x === "number" ? x - y : 0));
      setPath(model, el.dataset.path, arr); afterChange(el); return;
    }
    if (a === "list-add" && model) { const arr = (getPath(model, el.dataset.path) || []).slice(); arr.push(el.dataset.val || ""); setPath(model, el.dataset.path, arr); afterChange(el); return; }
    if (a === "list-del" && model) { const arr = (getPath(model, el.dataset.path) || []).slice(); arr.splice(+el.dataset.idx, 1); setPath(model, el.dataset.path, arr); afterChange(el); return; }
    const fn = handlers[a];
    if (fn) { e.preventDefault(); fn(id, el, e); }
  });

  const onInput = e => {
    const el = e.target;
    if (!el.matches || !el.matches("[data-bind]") || !ui.form) return;
    setPath(ui.form, el.getAttribute("data-bind"), readInput(el));
    if (swapping) return;
    if (e.type === "change" && el.hasAttribute("data-rerender")) rerenderOverlay();
    if (e.type === "change" && el.dataset.onchange && handlers[el.dataset.onchange]) handlers[el.dataset.onchange](el.value, el);
    if (e.type === "input" && el.dataset.oninput && handlers[el.dataset.oninput]) handlers[el.dataset.oninput](el.value, el);
  };
  document.addEventListener("input", onInput);
  document.addEventListener("change", onInput);

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (sheetEl().classList.contains("show")) closeSheet();
    else if (overlayOpen()) closeOverlay();
  });
}

function afterChange(el) {
  if (el.dataset.then && handlers[el.dataset.then]) handlers[el.dataset.then](el.dataset.val, el);
  rerenderOverlay();
}
