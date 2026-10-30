// Jewish fast days from the Hebrew calendar (the browser's own, via Intl), with the rules for
// when a fast falls on Shabbat. Null everywhere if the browser lacks the Hebrew calendar.
//   Yom Kippur      10 Tishri — fasted even on Shabbat; sunset the evening before → nightfall
//   Tisha B'Av      9 Av — on Shabbat moves to Sunday; sunset the evening before → nightfall
//   Fast of Gedaliah 3 Tishri, 17 Tammuz — on Shabbat move to Sunday; dawn → nightfall
//   10 Tevet        never moved (can be a Friday); dawn → nightfall
//   Fast of Esther  13 Adar (Adar II in a leap year) — on Shabbat moves back to Thursday; dawn → nightfall

import { keyOf } from "./dates.js";

let fmt = null;
try {
  fmt = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric" });
  if (fmt.resolvedOptions().calendar !== "hebrew") fmt = null;
} catch (e) { fmt = null; }

const cache = new Map();
export function hebrew(date) {
  if (!fmt) return null;
  const k = keyOf(date);
  if (!cache.has(k)) {
    const p = {};
    fmt.formatToParts(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)).forEach(x => { p[x.type] = x.value; });
    cache.set(k, { day: +p.day, month: p.month, year: parseInt(p.year, 10) });
  }
  return cache.get(k);
}
const shift = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12);
const is = (date, month, day) => { const h = hebrew(date); return !!h && h.day === day && [].concat(month).includes(h.month); };

// major: from sunset the evening before; minor: from dawn. move: what happens on Shabbat.
export const JEWISH_FASTS = [
  { id: "gedaliah", name: "Fast of Gedaliah", emoji: "🕯️", month: "Tishri", day: 3, move: "sunday", major: false },
  { id: "yom-kippur", name: "Yom Kippur", emoji: "🕍", month: "Tishri", day: 10, move: null, major: true },
  { id: "tevet", name: "Fast of 10 Tevet", emoji: "🕯️", month: "Tevet", day: 10, move: null, major: false },
  { id: "esther", name: "Fast of Esther", emoji: "📜", month: ["Adar", "Adar II"], day: 13, move: "thursday", major: false },
  { id: "tammuz", name: "Fast of 17 Tammuz", emoji: "🕯️", month: "Tamuz", day: 17, move: "sunday", major: false },
  { id: "av", name: "Tisha B'Av", emoji: "🕍", month: "Av", day: 9, move: "sunday", major: true }
];

// The fast observed on `date` (after Shabbat moves), or null.
export function jewishFastOn(date) {
  if (!fmt) return null;
  const dow = date.getDay();
  for (const f of JEWISH_FASTS) {
    if (is(date, f.month, f.day) && !(dow === 6 && f.move)) return f;
    if (f.move === "sunday" && dow === 0 && is(shift(date, -1), f.month, f.day)) return Object.assign({ moved: true }, f);
    if (f.move === "thursday" && dow === 4 && is(shift(date, 2), f.month, f.day)) return Object.assign({ moved: true }, f);
  }
  return null;
}
