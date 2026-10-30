// Hijri (Umm al-Qura) date via Intl — used to switch Ramadan habits on
// automatically and for "white days" fasting. Falls back to null if the
// browser lacks the Islamic calendar.
// Months start by moon sighting in many countries (Iraq, Iran, Pakistan, most Shia authorities),
// often a day after Umm al-Qura: Faith setup → "Hijri date" shifts every date by −2…+2 days.

import { getLocale, keyOf } from "./dates.js";
import { state } from "./store.js";

export function hijriOffset() {
  const f = state && state.profile && state.profile.faith;
  return (f && f.muslim && +f.muslim.hijriAdjust) || 0;
}
// "+1 day later" means the month starts a day after Umm al-Qura, so today is Umm al-Qura's yesterday.
const shifted = (date, off) => new Date(date.getFullYear(), date.getMonth(), date.getDate() - off, 12);

export const HIJRI_MONTHS = ["Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani", "Jumada al-Ula", "Jumada al-Akhirah", "Rajab", "Sha'ban", "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah"];

let fmt = null;
try {
  fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric" });
  if (fmt.resolvedOptions().calendar !== "islamic-umalqura") fmt = null;
} catch (e) { fmt = null; }

const cache = new Map();
export function hijri(date, offset) {
  if (!fmt) return null;
  const off = offset != null ? offset : hijriOffset();
  const k = keyOf(date) + "|" + off;
  const hit = cache.get(k);
  if (hit) return hit;
  const d = shifted(date, off);
  const parts = {};
  fmt.formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  const out = { day: +parts.day, month: +parts.month, year: parseInt(parts.year, 10) };
  out.monthName = HIJRI_MONTHS[out.month - 1];
  cache.set(k, out);
  return out;
}

let arFmt = null;
export function hijriLabel(date) {
  if (/^ar/.test(getLocale() || "")) {
    try {
      arFmt = arFmt || new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric" });
      return arFmt.format(shifted(date, hijriOffset()));
    } catch (e) { /* fall through */ }
  }
  const h = hijri(date);
  return h ? h.day + " " + h.monthName + " " + h.year : "";
}

// Days until the next 1st of Ramadan (0 if today is in Ramadan, null if unknown).
export function daysToRamadan(from) {
  if (!fmt) return null;
  for (let i = 0; i < 400; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const h = hijri(d);
    if (h.month === 9) return i;
  }
  return null;
}
