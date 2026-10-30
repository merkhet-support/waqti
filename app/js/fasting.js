// The fasting calendar: every fast of your faith and tradition in the next twelve months, with
// when it starts and ends (dates, and times where the faith sets them), what it asks, and whether
// it's on your list. One list for all faiths:
//   Islam        Ramadan, the Sunni Sunnah fasts or the Shia days, Eid (no fasting) — by your Hijri setting
//   Christianity your church's seasons and days (seasons.js) and Wednesday/Friday
//   Judaism      the six public fasts (hebrew.js), sunset/dawn to nightfall
//   Hinduism     Ekadashi (and Purnima / Amavasya) by the Moon (lunar.js), sunrise to sunrise
//   Sikhism      no ritual fasting — Sikh teaching discourages it

import { state } from "./store.js";
import { addDays, keyOf, fmtTime, fmtDate } from "./dates.js";
import { faithCfg, prayerMinutes, prayerLocation, fastingCfg } from "./faith.js";
import { prayerTimes } from "./prayer.js";
import { hijri } from "./hijri.js";
import { churchYear, isOrthodox } from "./seasons.js";
import { jewishFastOn } from "./hebrew.js";
import { hinduFastOn, HINDU_FASTS } from "./lunar.js";

const DAYS = 365;
const dayKeyN = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400e3); // time-zone proof
const span = (a, b) => dayKeyN(b) - dayKeyN(a) + 1;
const tracked = src => (state.habits || []).some(h => !h.archived && h.source === "faith:" + src);
const wd = d => fmtDate(d, { weekday: "short" });
const halachic = day => prayerTimes(day, prayerLocation(day), { method: "halachic" });

// Group consecutive days that share an id (from a per-day function) into periods.
function periods(from, to, idOf) {
  const out = []; let cur = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const id = idOf(d);
    if (cur && cur.id === id) { cur.end = d; continue; }
    if (cur && cur.id) out.push(cur);
    cur = id ? { id, start: d, end: d } : null;
  }
  if (cur && cur.id) out.push(cur);
  return out;
}

function islam(from, m) {
  const shia = m.sect === "shia", occ = m.occasions || {}, fst = m.fasting || {};
  const ids = h => {
    if (!h) return null;
    if (h.month === 9) return "ramadan";
    if ((h.month === 10 && h.day === 1) || (h.month === 12 && h.day >= 10 && h.day <= 13)) return h.month === 10 ? "eid-fitr" : "eid-adha";
    if (!shia && h.month === 10 && h.day >= 2) return "shawwal";
    if (!shia && h.month === 12 && h.day === 9) return "arafah";
    if (h.month === 1 && (shia ? h.day === 10 : h.day === 9 || h.day === 10)) return shia ? "ashura-faqa" : "ashura";
    if (shia && h.month === 12 && h.day === 18) return "ghadir";
    return null;
  };
  const INFO = {
    ramadan: { name: "Ramadan", emoji: "🌙", food: "Obligatory: no food or drink from Fajr to Maghrib", src: "rm-fast" },
    "eid-fitr": { name: "Eid al-Fitr", emoji: "🎉", food: "No fasting — fasting on Eid is forbidden", none: true },
    "eid-adha": { name: "Eid al-Adha & the days of Tashriq", emoji: "🐑", food: "No fasting — 10th to 13th Dhu al-Hijjah", none: true },
    shawwal: { name: "Six days of Shawwal", emoji: "🌙", food: "Sunnah: any six days after Eid, together or apart" },
    arafah: { name: "Fast of Arafah", emoji: "🕋", food: "Sunnah: Fajr to Maghrib", src: "fast-arafah" },
    ashura: { name: "Fast of Ashura (9th & 10th)", emoji: "🌙", food: "Sunnah: Fajr to Maghrib", src: "fast-ashura" },
    "ashura-faqa": { name: "Day of Ashura", emoji: "🖤", food: "Not a fast day — many abstain from food until Asr (fāqa), without the intention of fasting", src: "ashura" },
    ghadir: { name: "Eid al-Ghadir", emoji: "🌿", food: "Recommended (mustahab) fast, Fajr to Maghrib", src: "ghadir" }
  };
  const out = periods(addDays(from, -40), addDays(from, DAYS), d => ids(hijri(d))).filter(p => p.end >= from).map(p => {
    const i = INFO[p.id], pt = prayerMinutes(p.start), n = span(p.start, p.end);
    return Object.assign({ start: p.start, end: p.end, days: n, tracked: i.src ? tracked(i.src) : false }, i,
      i.none || p.id === "ashura-faqa" || p.id === "shawwal" ? {} : { times: "Fajr " + fmtTime(pt.fajr) + " → Maghrib " + fmtTime(pt.maghrib) + (n > 1 ? " (first day)" : "") });
  });
  if (fst.whiteDays) out.push({ name: "White days", emoji: "🌕", food: "13th, 14th & 15th of each Hijri month", recurring: true, tracked: tracked("fast-white") });
  if (fst.monThu && !shia) out.push({ name: "Mondays & Thursdays", emoji: "🌙", food: "Sunnah — not on Eid or in Ramadan", recurring: true, tracked: tracked("fast-mt") });
  return out;
}

function christianity(from, c) {
  const fst = fastingCfg(c), d = c.denom;
  const out = churchYear(from, d, DAYS).map(x => Object.assign({ tracked: (state.habits || []).some(h => !h.archived && h.schedule && h.schedule.season === x.id) }, x));
  if (isOrthodox(d)) out.push({ name: "Wednesdays & Fridays", emoji: "🥖", food: d === "orthodox" ? "All year, except the fifty days after Easter and the feasts of Nativity & Theophany" : "All year, except the fast-free weeks: Bright Week, Trinity Week, Publican & Pharisee, Cheesefare and Christmas to Theophany", recurring: true, tracked: !!fst.wedFri && tracked("fast") });
  if (d === "catholic") out.push({ name: "Fridays", emoji: "🐟", food: "A day of penance all year — in Lent, no meat", recurring: true, tracked: tracked("lent-fridays") });
  return out;
}

function judaism(from) {
  const out = [];
  for (let i = 0; i < DAYS; i++) {
    const day = addDays(from, i), f = jewishFastOn(day);
    if (!f) continue;
    const eve = addDays(day, -1), h = halachic(day), sunsetEve = halachic(eve).sunset;
    out.push({ name: f.name, emoji: f.emoji, start: f.major ? eve : day, end: day, days: 1, tracked: tracked(f.major ? "jewish-major" : "jewish-minor"),
      food: (f.major ? "No food or drink (25 hours)" : "No food or drink, dawn to nightfall") + (f.moved ? " — moved because of Shabbat" : ""),
      times: f.major ? (f.id === "yom-kippur" ? "Candles " + fmtTime(sunsetEve - 18) + ", fast from sunset " : "From sunset ") + wd(eve) + " " + fmtTime(sunsetEve) + " → nightfall " + wd(day) + " " + fmtTime(h.isha)
        : "Dawn " + fmtTime(h.fajr) + " → nightfall " + fmtTime(h.isha) });
  }
  return out;
}

function hinduism(from, o) {
  const hd = o.hindu || {}, rule = hd.ekadashiRule || "smarta", out = [];
  const want = ["ekadashi"].concat(hd.purnima ? ["purnima"] : [], hd.amavasya ? ["amavasya"] : []);
  for (let i = 0; i < DAYS; i++) {
    const day = addDays(from, i);
    for (const id of want) {
      const f = hinduFastOn(day, id, rule);
      if (!f) continue;
      const rise = prayerTimes(day, prayerLocation(day), { method: "mwl" }).sunrise, next = prayerTimes(addDays(day, 1), prayerLocation(day), { method: "mwl" }).sunrise;
      out.push(Object.assign({}, HINDU_FASTS[id], { name: HINDU_FASTS[id].name + (id === "ekadashi" ? " · " + f.paksha : ""), start: day, end: day, days: 1, tracked: tracked(id),
        times: id === "ekadashi" ? "Sunrise " + fmtTime(rise) + " → break after sunrise tomorrow, " + fmtTime(next) : null }));
    }
  }
  return out;
}

// Everything, sorted: periods by start date, then the recurring weekly/monthly fasts.
export function fastingCalendar(from) {
  const cfg = faithCfg(), r = cfg.religion;
  let list = [];
  if (r === "muslim") list = islam(from, cfg.muslim);
  else if (r === "christian") list = christianity(from, cfg.christian);
  else if (r === "other" && cfg.other.tradition === "jewish") list = judaism(from);
  else if (r === "other" && cfg.other.tradition === "hindu") list = hinduism(from, cfg.other);
  const dated = list.filter(x => !x.recurring).sort((a, b) => a.start - b.start), rec = list.filter(x => x.recurring);
  return { list: dated.concat(rec), note: r === "other" && cfg.other.tradition === "sikh" ? "Sikh teaching doesn't ask for ritual fasting — Guru Nanak taught that a fast of the body means little without a fast of the mind." : null };
}
// The fast (if any) on `day`: for the Faith tab's "today" line.
export function fastToday(day) {
  const k = keyOf(day);
  return fastingCalendar(addDays(day, -1)).list.find(x => !x.recurring && !x.none && keyOf(x.end) >= k && keyOf(x.start) <= k && (x.days > 1 || keyOf(x.end) === k)) || null;
}
