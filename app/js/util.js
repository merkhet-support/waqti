// Small shared helpers: escaping, ids, DOM, toast.

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Emoji arriving from someone else's link (a shared list, a request): emoji are shown unescaped
// everywhere, so anything that could be markup is dropped and the length capped.
export function cleanEmoji(s) {
  const e = String(s == null ? "" : s).replace(/[<>&"'`=\\/;:(){}\[\]\s]/g, "").slice(0, 16);
  return /[A-Za-z0-9]/.test(e) ? "" : e;
}

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

let toastTimer = null;
export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

export const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
export const SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

// Read/write a nested property by "a.b.c" path (used by form binding).
export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, val) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== "object") o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = val;
}

export function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

// Is the string a single emoji (one grapheme that contains a pictographic char)?
export function firstEmoji(str) {
  const s = String(str || "").trim();
  if (!s) return "";
  let first = s;
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const it = seg.segment(s)[Symbol.iterator]().next();
    first = it.value ? it.value.segment : s;
  } else {
    first = Array.from(s).slice(0, 2).join("");
  }
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(first) ? first : "";
}
