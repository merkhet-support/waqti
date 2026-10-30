// Yearly occasions whose date depends on the country: Mother's Day and Father's Day.
// The region comes from Settings → Region, or is guessed from the currency (and changeable).
//   arab: Mother's Day 21 March, Father's Day 21 June (Egypt, the Levant, Iraq, the Gulf)
//   uk:   Mothering Sunday (3 weeks before Easter), Father's Day 3rd Sunday of June
//   intl: 2nd Sunday of May, 3rd Sunday of June (US, Canada, Australia's May date, much of Europe)

import { state } from "./store.js";
import { keyOf, addDays } from "./dates.js";
import { westernEaster } from "./seasons.js";

const ARAB = ["EGP", "SAR", "AED", "QAR", "KWD", "BHD", "OMR", "JOD", "LBP", "IQD", "SYP", "YER", "SDG", "LYD", "TND", "DZD", "MAD"];
export const REGIONS = [["arab", "Arab world (21 March)"], ["intl", "US, Canada & Europe (May)"], ["uk", "UK & Ireland (Mothering Sunday)"]];

// The phone's time zone is the best guess (the currency starts as EGP for everyone); then the currency.
const ARAB_TZ = /^(Africa\/(Cairo|Tripoli|Tunis|Algiers|Casablanca|Khartoum)|Asia\/(Riyadh|Dubai|Kuwait|Qatar|Bahrain|Muscat|Amman|Beirut|Baghdad|Damascus|Aden|Gaza|Hebron))$/;
export function region() {
  const s = state && state.settings;
  if (s && s.region) return s.region;
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* ignore */ }
  if (ARAB_TZ.test(tz)) return "arab";
  if (/^Europe\/(London|Dublin|Belfast)$/.test(tz)) return "uk";
  if (/^(America|Europe|Australia|Pacific|Asia)\//.test(tz)) return "intl";
  const c = (s && s.currency) || "EGP";
  return ARAB.includes(c) ? "arab" : c === "GBP" ? "uk" : "intl";
}

// The n-th given weekday of a month (n = 1, 2, 3…), as a local date.
function nthWeekday(y, month, weekday, n) {
  const first = new Date(y, month - 1, 1);
  return new Date(y, month - 1, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7);
}

export function occasionDate(id, y) {
  const r = region();
  if (id === "mothers-day") {
    if (r === "arab") return new Date(y, 2, 21);
    if (r === "uk") return addDays(westernEaster(y), -21);
    return nthWeekday(y, 5, 0, 2);
  }
  if (id === "fathers-day") return r === "arab" ? new Date(y, 5, 21) : nthWeekday(y, 6, 0, 3);
  return null;
}
export const occasionOn = (id, d) => { const o = occasionDate(id, d.getFullYear()); return !!o && keyOf(o) === keyOf(d); };
export const OCCASION_NAMES = { "mothers-day": "Mother's Day", "fathers-day": "Father's Day" };
