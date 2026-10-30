// Languages: English (source) and Arabic with right-to-left layout.
//
// The UI is written in English; in Arabic mode a MutationObserver translates
// text nodes and placeholder/aria-label/title attributes as they render, using
// exact phrases from ./i18n-ar.js plus patterns for sentences with numbers.
// Text that has no translation stays as-is (e.g. names the user typed).
// JS-only strings (notifications) go through tr().

import { setLocale } from "./dates.js";

// The Arabic dictionary (~200 KB) loads only when Arabic is used. Until it arrives, text stays in
// English; then the screen is translated in place and "waqti:lang-ready" fires so the app can
// re-render and re-plan reminders in Arabic.
let AR = {}, AR_PATTERNS = [], arCountFn = null, arLoading = null;
export function useArabic(m) { AR = m.AR; AR_PATTERNS = m.AR_PATTERNS; arCountFn = m.count; }
export function loadArabic() {
  if (!arLoading) arLoading = import("./i18n-ar.js").then(useArabic);
  return arLoading;
}
export const arabicReady = () => !!arCountFn;
// Arabic counted nouns ("يومان", "5 أيام"); a plain fallback until the dictionary is in.
export const arCount = (n, noun, gen) => arCountFn ? arCountFn(n, noun, gen) : n + " " + noun;

let lang = "en";
let observer = null;
const ATTRS = ["placeholder", "aria-label", "title"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE"]);

export function currentLang() { return lang; }
export function isRTL() { return lang === "ar"; }

export function detectLang(saved) {
  if (saved === "ar" || saved === "en") return saved;
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  return /^ar\b/i.test(nav) ? "ar" : "en";
}

/** Translate a whole UI string (exact phrase, pattern, or " · " / " & " / ", " separated parts). */
export function trText(s) {
  if (lang !== "ar" || s == null) return s;
  const str = String(s);
  const m = str.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = m[2];
  if (!core || !/[A-Za-z]/.test(core)) return str;
  const out = translateCore(core);
  return out == null ? str : m[1] + out + m[3];
}

function translateCore(core) {
  if (Object.prototype.hasOwnProperty.call(AR, core)) return AR[core];
  for (const [re, fn] of AR_PATTERNS) {
    const mm = core.match(re);
    if (mm) return typeof fn === "function" ? fn(mm, t => translateCore(t) ?? t) : core.replace(re, fn);
  }
  // Leading emoji / bullet ("🔔 At waking up", "· 1/2 pages") — translate the rest.
  const pre = core.match(/^((?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[·•↪])[️‍\p{Extended_Pictographic}]*\s+)([\s\S]+)$/u);
  if (pre) { const rest = translateCore(pre[2]); if (rest != null) return pre[1] + rest; }
  for (const sep of [" · ", " & ", " — ", ", "]) {
    if (!core.includes(sep)) continue;
    const parts = core.split(sep);
    let changed = false;
    const tr = parts.map(p => { const x = p.trim() ? translateCore(p.trim()) : null; if (x != null) changed = true; return x != null ? x : p; });
    if (changed) return tr.join(sep === ", " ? "، " : sep);
  }
  return null;
}

/** For strings built in JS (notifications). Supports {name} placeholders and "|1" singular keys. */
const EN_ONE = { "Your day: {n} habits": "Your day: {n} habit" };
export function tr(key, vars) {
  let s = key;
  if (lang === "ar" && Object.prototype.hasOwnProperty.call(AR, key)) s = AR[key];
  else if (lang !== "ar" && vars && vars.n === 1 && EN_ONE[key]) s = EN_ONE[key];
  else if (lang === "ar") s = trText(key);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));
  return s;
}

function translateTree(root) {
  if (lang !== "ar" || !root) return;
  if (root.nodeType === 3) { fixText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
  if (root.closest && root.closest("[data-no-tr]")) return;
  fixAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => {
      if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
      if (n.nodeName === "TEXTAREA") { fixAttrs(n); return NodeFilter.FILTER_REJECT; } // placeholder yes, the user's text no
      return (SKIP.has(n.nodeName) || n.hasAttribute("data-no-tr")) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  let n;
  while ((n = w.nextNode())) { if (n.nodeType === 3) fixText(n); else fixAttrs(n); }
}

function fixText(node) {
  const p = node.parentNode;
  if (!p || SKIP.has(p.nodeName) || (p.closest && p.closest("[data-no-tr]"))) return;
  const t = trText(node.data);
  if (t !== node.data) node.data = t;
}
function fixAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute && el.getAttribute(a);
    if (v) { const t = trText(v); if (t !== v) el.setAttribute(a, t); }
  }
}

export function setLang(l, onChange) {
  lang = l === "ar" ? "ar" : "en";
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === "ar" ? "rtl" : "ltr";
  setLocale(lang === "ar" ? "ar-EG-u-nu-latn" : undefined);
  if (lang === "ar" && !observer) {
    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === "characterData") fixText(m.target);
        else if (m.type === "attributes") fixAttrs(m.target);
        else m.addedNodes.forEach(translateTree);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (lang !== "ar" && observer) { observer.disconnect(); observer = null; }
  if (onChange) onChange();
  translateTree(document.body);
  if (lang === "ar" && !arabicReady()) loadArabic().then(() => {
    if (lang !== "ar") return;
    translateTree(document.body);
    if (onChange) onChange();
    window.dispatchEvent(new Event("waqti:lang-ready"));
  }).catch(() => { /* offline and not cached: stays in English */ });
}
