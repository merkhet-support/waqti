// Faith setup: turns a detailed, per-person config (which prayers, how times
// are found, how/when to be reminded, extras) into ordinary habits tagged
// with `source: "faith:<key>"`, so re-running setup updates them in place and
// keeps their history.

import { state, newHabit } from "./store.js";
import { keyOf, toMin, fromMin } from "./dates.js";
import { prayerTimes, PRAYERS, CITIES } from "./prayer.js";
import { hijri } from "./hijri.js";
import { keepPastSchedule } from "./schedule.js";
import { SEASONS, churchFasts, wedFriExceptions, isOrthodox } from "./seasons.js";

export const AGPEYA = [
  { id: "prime", name: "Prime (1st hour)", time: "06:00" },
  { id: "terce", name: "Terce (3rd hour)", time: "09:00" },
  { id: "sext", name: "Sext (6th hour)", time: "12:00" },
  { id: "none", name: "None (9th hour)", time: "15:00" },
  { id: "vespers", name: "Vespers (11th hour)", time: "17:00" },
  { id: "compline", name: "Compline (12th hour)", time: "21:00" },
  { id: "midnight", name: "Midnight prayer", time: "00:00" }
];

export function defaultFaith(religion) {
  const cairo = CITIES[0];
  return {
    religion: religion || null,
    muslim: {
      // Sunni (with a madhhab, which sets Asr) or Shia Ithna 'Ashari (Ja'fari: own times, prayers
      // usually joined — Dhuhr with Asr, Maghrib with Isha — and its own nights and days).
      sect: "sunni",
      madhhab: "shafii",            // hanafi | shafii | maliki | hanbali
      combine: false,               // pray Dhuhr+Asr and Maghrib+Isha together (3 times a day)
      hijriAdjust: 0,               // −2…+2 days vs Umm al-Qura, for moon-sighting countries
      highLat: "angle",             // far north/south: angle | midnight | seventh | none (prayer.js)
      shia: { tasbih: true, kumayl: true, ziyarahAshura: false, iftitah: true },
      occasions: { eid: true, arafah: true, ashuraFast: true, lastTen: true, muharram: true, arbaeen: true, ghadir: true, shaban: true, qadrNights: true },
      prayers: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
      source: "auto",
      method: "egypt",
      asr: "standard",
      location: { name: cairo[0], lat: cairo[1], lng: cairo[2] },
      manual: { fajr: "04:45", dhuhr: "11:45", asr: "14:55", maghrib: "17:20", isha: "18:40" },
      remind: { before: 0, atAdhan: true, nag: 30 },   // one reminder per prayer by default (a month's test: before + at + follow-up was ~30 alerts a day)
      adjust: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      extras: { rawatib: false, duha: false, witr: true, qiyam: false },
      jumuah: true,
      quran: { on: true, amount: 2, unit: "pages", after: "fajr" },
      adhkar: { morning: true, evening: true },
      fasting: { monThu: false, whiteDays: false },
      ramadan: true
    },
    christian: {
      denom: "orthodox",
      church: { on: true, days: [5], time: "08:00" },
      prayerMode: "simple",
      simple: { times: ["07:00", "22:00"] },
      agpeya: { prime: true, compline: true },
      agpeyaTimes: Object.fromEntries(AGPEYA.map(a => [a.id, a.time])),
      bible: { on: true, amount: 1, unit: "chapter", time: "21:30" },
      fasting: { wedFri: false, greatLent: true, jonah: true, apostles: true, virgin: true, nativity: true, paramoun: true, feastFasts: true, lent: true, fastDays: true, fridays: true, advent: false },
      remind: { before: 0, nag: 30 }
    },
    other: {
      practice: "Meditation",
      emoji: "🧘",
      times: ["07:00"],
      days: [0, 1, 2, 3, 4, 5, 6],
      minutes: 10,
      // Traditions whose times follow the sun (worked out from your city each day).
      tradition: null,
      jewish: { candles: true, candleMin: 18, havdalah: true, havdalahMin: 42, shacharit: false, mincha: false, maariv: false, fasts: "all" },
      hindu: { sunrise: true, sunset: true, ekadashi: true, ekadashiRule: "smarta", purnima: false, amavasya: false },
      sikh: { japji: true, rehras: true, sohila: true }
    }
  };
}

export function faithCfg() {
  const f = state.profile.faith || {};
  const def = defaultFaith(f.religion);
  // Saves from before madhhabs: a Hanafi Asr means a Hanafi.
  if (f.muslim && !f.muslim.madhhab && f.muslim.asr === "hanafi") def.muslim.madhhab = "hanafi";
  // shallow-merge each branch so old saves gain new fields
  return {
    religion: f.religion || null,
    muslim: Object.assign(def.muslim, f.muslim || {}),
    christian: Object.assign(def.christian, f.christian || {}),
    other: Object.assign(def.other, f.other || {})
  };
}

/* ---------- prayer times ---------- */
// Where prayer times are calculated for on a given day: home, or the city of a travel pause.
export function travelOn(day) {
  const k = keyOf(day);
  return (state && state.pauses || []).find(p => p.loc && k >= p.from && k <= p.to) || null;
}
export function prayerLocation(day) {
  const t = travelOn(day);
  return t ? t.loc : faithCfg().muslim.location;
}

const ptCache = new Map();
export function prayerMinutes(day, cfg) {
  const m = Object.assign({}, (cfg || faithCfg()).muslim);
  if (!cfg) { const t = travelOn(day); if (t) { m.location = t.loc; m.source = "auto"; } }
  if (m.source === "manual") {
    const out = {};
    for (const p of PRAYERS) out[p.id] = toMin(m.manual[p.id]);
    out.sunrise = out.fajr + 85;
    out.sunset = out.maghrib;
    const night = ((out.fajr - out.maghrib) % 1440 + 1440) % 1440;
    out.midnight = (out.maghrib + Math.round(night / 2)) % 1440;
    out.lastThird = (out.maghrib + Math.round(night * 2 / 3)) % 1440;
    return out;
  }
  const loc = m.location || { lat: CITIES[0][1], lng: CITIES[0][2] };
  let k = keyOf(day) + "|" + loc.lat + "|" + loc.lng + "|" + m.method + "|" + m.asr + "|" + (m.highLat || "angle");
  const hj = hijri(new Date(day));
  if (m.method === "makkah" && hj && hj.month === 9) k += "|rm"; // Umm al-Qura's longer Ramadan Isha
  if (!ptCache.has(k)) ptCache.set(k, prayerTimes(new Date(day), loc, { method: m.method, asr: m.asr, ramadan: !!(hj && hj.month === 9), highLat: m.highLat }));
  // Per-prayer minute adjustments to match the local mosque timetable.
  const adj = m.adjust || {}, base = ptCache.get(k), out = Object.assign({}, base);
  for (const p in adj) if (out[p] != null && +adj[p]) out[p] = ((out[p] + +adj[p]) % 1440 + 1440) % 1440;
  return out;
}

// Sunrise, midday and sunset for any faith (or none): same city and travel rules as prayer times,
// always calculated (a Muslim's hand-typed timetable doesn't apply to sunset reminders).
export function sunMinutes(day) {
  const loc = prayerLocation(day) || { lat: CITIES[0][1], lng: CITIES[0][2] };
  const k = "sun|" + keyOf(day) + "|" + loc.lat + "|" + loc.lng;
  if (!ptCache.has(k)) {
    const p = prayerTimes(new Date(day), loc, { method: "mwl" });
    ptCache.set(k, { sunrise: p.sunrise, noon: p.dhuhr, sunset: p.sunset });
  }
  return ptCache.get(k);
}
export const SUN_POINTS = [{ id: "sunrise", name: "Sunrise" }, { id: "noon", name: "Midday" }, { id: "sunset", name: "Sunset" }];

/* ---------- build habits from config ---------- */
function spec(key, over) {
  return Object.assign({ source: "faith:" + key, category: "Faith" }, over);
}
const R = (over) => Object.assign({ on: true, mode: "times", times: [], offsets: [0], nag: 0 }, over);
// Each church fast → its on/off switch in Faith setup and its habit key (kept across churches, so
// switching from Coptic to Greek Orthodox reshapes "Great Lent" instead of starting a new habit).
const FAST_TOGGLE = {
  "great-lent": { on: "greatLent", key: "great-lent", name: "Great Lent fast" }, "eastern-lent": { on: "greatLent", key: "great-lent", name: "Great Lent fast" },
  "jonah-fast": { on: "jonah", key: "jonah" }, "apostles-fast": { on: "apostles", key: "apostles" }, "apostles": { on: "apostles", key: "apostles" },
  "virgin-fast": { on: "virgin", key: "virgin" }, "dormition": { on: "virgin", key: "virgin" },
  "nativity-fast": { on: "nativity", key: "nativity" }, "nativity": { on: "nativity", key: "nativity" },
  "paramoun": { on: "paramoun", key: "paramoun" }, "theophany-eve": { on: "feastFasts", key: "theophany-eve" },
  "beheading": { on: "feastFasts", key: "beheading" }, "exaltation": { on: "feastFasts", key: "exaltation" },
  "western-lent": { on: "lent", key: "lent", name: "Lent" }, "ash-wednesday": { on: "fastDays", key: "ash-wednesday" }, "good-friday": { on: "fastDays", key: "good-friday" },
  "advent": { on: "advent", key: "advent", name: "Advent prayer" }
};
// Saved setups from before the full church calendars: the new fasts follow the ones already kept.
export function fastingCfg(c) {
  const f = c.fasting || {}, seasons = !!(f.greatLent || f.nativity);
  return Object.assign({ virgin: seasons, paramoun: seasons, feastFasts: seasons, fastDays: !!f.lent, fridays: !!f.lent }, f);
}
// Hijri "month-day" (or a whole month) when voluntary fasts are skipped: Eid al-Fitr, Eid al-Adha, Tashriq.
const NO_FAST = ["10-1", "12-10", "12-11", "12-12", "12-13"];

export function buildFaithSpecs(cfg) {
  const out = [];
  if (cfg.religion === "muslim") {
    const m = cfg.muslim, shia = m.sect === "shia", occ = m.occasions || {};
    const offsets = [];
    if (m.remind.before) offsets.push(-Math.abs(m.remind.before));
    if (m.remind.atAdhan || !offsets.length) offsets.push(0);
    // Joined prayers: Asr is reminded with Dhuhr and Isha with Maghrib (one combined notification),
    // but each is still ticked on its own.
    const JOIN = { asr: "dhuhr", isha: "maghrib" };
    for (const p of PRAYERS) {
      if (!m.prayers[p.id]) continue;
      const joined = m.combine && JOIN[p.id];
      out.push(spec(p.id, {
        name: p.name + " prayer", emoji: p.id === "fajr" ? "🌅" : p.id === "maghrib" ? "🌇" : p.id === "isha" ? "🌙" : "🕌",
        schedule: { kind: "daily" },
        reminders: R({ mode: "prayer", prayer: joined || p.id, offsets, nag: m.remind.nag || 0 }),
        notes: p.rakah + " rak'ah" + (joined ? " · prayed together with " + PRAYERS.find(x => x.id === joined).name : "")
      }));
    }
    if (m.extras.rawatib) out.push(spec("rawatib", shia
      ? { name: "Daily nawafil", emoji: "📿", type: "count", target: 34, unit: "rak'ah", schedule: { kind: "daily" }, reminders: R({ on: false, mode: "prayer", prayer: "dhuhr" }), notes: "8 before Dhuhr, 8 before Asr, 4 after Maghrib, 2 after Isha, 11 Salat al-Layl, 2 before Fajr" }
      : { name: "Sunnah rawatib", emoji: "📿", type: "count", target: 12, unit: "rak'ah", schedule: { kind: "daily" }, reminders: R({ on: false, mode: "prayer", prayer: "dhuhr" }), notes: "2 before Fajr, 4 before + 2 after Dhuhr, 2 after Maghrib, 2 after Isha" }));
    if (m.extras.duha && !shia) out.push(spec("duha", { name: "Duha prayer", emoji: "☀️", schedule: { kind: "daily" }, reminders: R({ mode: "prayer", prayer: "sunrise", offsets: [30] }) }));
    // Shia Witr is the last rak'ah of Salat al-Layl, so it isn't a separate habit.
    if (m.extras.witr && !shia) out.push(spec("witr", { name: "Witr", emoji: "✨", schedule: { kind: "daily" }, reminders: R({ mode: "routine", anchor: "bed", offset: -20 }), notes: m.madhhab === "hanafi" ? "Wajib in the Hanafi school" : "" }));
    if (m.extras.qiyam) out.push(spec("qiyam", shia
      ? { name: "Salat al-Layl", emoji: "🌌", schedule: { kind: "daily" }, reminders: R({ mode: "prayer", prayer: "lastThird", offsets: [0] }), notes: "11 rak'ah, ending with Witr — best before Fajr" }
      : { name: "Qiyam / Tahajjud", emoji: "🌌", schedule: { kind: "daily" }, reminders: R({ mode: "prayer", prayer: "lastThird", offsets: [0] }) }));
    if (shia) {
      const s = m.shia || {};
      if (s.tasbih) out.push(spec("tasbih-zahra", { name: "Tasbih of Fatima al-Zahra", emoji: "📿", schedule: { kind: "daily" }, reminders: R({ on: false }), notes: "After each prayer: 34 Allahu Akbar, 33 Alhamdulillah, 33 Subhan Allah" }));
      if (s.kumayl) out.push(spec("kumayl", { name: "Dua Kumayl", emoji: "🤲", schedule: { kind: "days", days: [4] }, reminders: R({ mode: "prayer", prayer: "isha", offsets: [30] }), notes: "Thursday night (the eve of Friday)" }));
      if (s.ziyarahAshura) out.push(spec("ziyarah-ashura", { name: "Ziyarat Ashura", emoji: "🕊️", schedule: { kind: "daily" }, reminders: R({ mode: "prayer", prayer: "fajr", offsets: [30] }) }));
    }
    if (m.jumuah) out.push(spec("jumuah", { name: "Jumu'ah prayer", emoji: "🕋", schedule: { kind: "days", days: [5] }, reminders: R({ mode: "prayer", prayer: "dhuhr", offsets: [-45] }), notes: "Ghusl, Surat Al-Kahf, go early" }));
    if (m.quran.on) out.push(spec("quran", { name: "Read Quran", emoji: "📖", type: "count", target: Math.max(1, +m.quran.amount || 1), unit: m.quran.unit, schedule: { kind: "daily" }, reminders: R({ mode: "prayer", prayer: m.quran.after || "fajr", offsets: [15] }) }));
    if (m.adhkar.morning) out.push(spec("adhkar-am", { name: "Morning adhkar", emoji: "🌤️", schedule: { kind: "daily" }, reminders: R({ mode: "prayer", prayer: "fajr", offsets: [20] }) }));
    if (m.adhkar.evening) out.push(spec("adhkar-pm", { name: "Evening adhkar", emoji: "🌆", schedule: { kind: "daily" }, reminders: R({ mode: "prayer", prayer: "asr", offsets: [30] }) }));
    // Voluntary fasts never fall on the days fasting is forbidden: the two Eids and the days of Tashriq.
    if (m.fasting.monThu) out.push(spec("fast-mt", { name: "Sunnah fast", emoji: "🌙", schedule: { kind: "days", days: [1, 4], hijriNot: NO_FAST.concat("9") }, reminders: R({ mode: "prayer", prayer: "fajr", offsets: [-45] }), notes: "Monday & Thursday — reminder is for suhoor" }));
    if (m.fasting.whiteDays) out.push(spec("fast-white", { name: "White days fast", emoji: "🌕", schedule: { kind: "daily", hijriDays: [13, 14, 15], skipRamadan: true, hijriNot: NO_FAST }, reminders: R({ mode: "prayer", prayer: "fajr", offsets: [-45] }) }));
    if (m.ramadan) {
      out.push(spec("rm-suhoor", { name: "Suhoor", emoji: "🥣", schedule: { kind: "daily", hijriMonth: 9 }, reminders: R({ mode: "prayer", prayer: "fajr", offsets: [-50] }) }));
      out.push(spec("rm-fast", { name: "Fast today", emoji: "🌙", schedule: { kind: "daily", hijriMonth: 9 }, reminders: R({ mode: "prayer", prayer: "maghrib", offsets: [0] }), notes: "Iftar reminder at Maghrib" }));
      if (!shia) out.push(spec("rm-taraweeh", { name: "Taraweeh", emoji: "🕌", schedule: { kind: "daily", hijriMonth: 9 }, reminders: R({ mode: "prayer", prayer: "isha", offsets: [15] }) }));
      else if ((m.shia || {}).iftitah) out.push(spec("rm-iftitah", { name: "Dua al-Iftitah", emoji: "🤲", schedule: { kind: "daily", hijriMonth: 9 }, reminders: R({ mode: "prayer", prayer: "isha", offsets: [15] }), notes: "Every night of Ramadan" }));
      out.push(spec("rm-quran", { name: "Ramadan Quran — 1 juz", emoji: "📗", type: "count", target: 20, unit: "pages", schedule: { kind: "daily", hijriMonth: 9 }, reminders: R({ on: false }) }));
    }
    // Special days of the year, by the Hijri calendar. An Islamic night comes before its day, so
    // "the night of the 21st" is reminded on the evening of the 20th.
    const day = (key, name, emoji, month, days, rem, notes) => out.push(spec(key, { name, emoji, schedule: { kind: "daily", hijriMonth: month, hijriDays: days }, reminders: R(rem), notes }));
    const SUHOOR = { mode: "prayer", prayer: "fajr", offsets: [-45] }, NIGHT = { mode: "prayer", prayer: "isha", offsets: [60] };
    if (occ.eid) {
      day("eid-fitr", "Eid al-Fitr prayer", "🎉", 10, [1], { mode: "prayer", prayer: "sunrise", offsets: [20] }, "Eid Mubarak — no fasting today");
      day("eid-adha", "Eid al-Adha prayer", "🐑", 12, [10], { mode: "prayer", prayer: "sunrise", offsets: [20] }, "Eid Mubarak — no fasting today");
    }
    if (!shia) {
      if (occ.arafah) day("fast-arafah", "Fast of Arafah", "🕋", 12, [9], SUHOOR, "9 Dhu al-Hijjah — reminder is for suhoor");
      if (occ.ashuraFast) day("fast-ashura", "Fast of Ashura", "🌙", 1, [9, 10], SUHOOR, "9 & 10 Muharram — reminder is for suhoor");
      if (occ.lastTen) day("last-ten", "Last ten nights", "✨", 9, [20, 22, 24, 26, 28], { mode: "prayer", prayer: "lastThird", offsets: [0] }, "Seek Laylat al-Qadr in the odd nights");
    } else {
      if (occ.muharram) day("muharram", "Muharram majlis", "🖤", 1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { mode: "prayer", prayer: "maghrib", offsets: [60] }, "Remembrance of Imam Husayn — the first ten nights of Muharram");
      if (occ.muharram) day("ashura", "Day of Ashura", "🖤", 1, [10], { mode: "prayer", prayer: "sunrise", offsets: [60] }, "10 Muharram — Ziyarat and remembrance");
      if (occ.arbaeen) day("arbaeen", "Arba'een", "🚶", 2, [20], { mode: "prayer", prayer: "sunrise", offsets: [60] }, "20 Safar — forty days after Ashura");
      if (occ.qadrNights) day("qadr-nights", "Nights of Qadr", "✨", 9, [18, 20, 22], NIGHT, "The 19th, 21st and 23rd nights of Ramadan — stay up in worship (Ihya)");
      if (occ.ghadir) day("ghadir", "Eid al-Ghadir", "🌿", 12, [18], { mode: "prayer", prayer: "sunrise", offsets: [60] }, "18 Dhu al-Hijjah");
      if (occ.shaban) day("mid-shaban", "Night of mid-Sha'ban", "🌕", 8, [14], NIGHT, "The night of the 15th of Sha'ban");
    }
  } else if (cfg.religion === "christian") {
    const c = cfg.christian;
    const nag = c.remind.nag || 0, before = -(Math.abs(c.remind.before || 0));
    if (c.church.on && c.church.days.length) out.push(spec("church", { name: isOrthodox(c.denom) ? "Liturgy / church" : "Church service", emoji: "⛪", schedule: { kind: "days", days: c.church.days }, reminders: R({ times: [fromMin(toMin(c.church.time) - 60)] }), notes: "Service at " + c.church.time }));
    if (c.prayerMode === "agpeya") {
      AGPEYA.filter(a => c.agpeya[a.id]).forEach(a => out.push(spec("agpeya-" + a.id, { name: a.name, emoji: "🙏", schedule: { kind: "daily" }, reminders: R({ times: [fromMin(toMin(c.agpeyaTimes[a.id] || a.time) + before)], nag }) })));
    } else {
      const times = (c.simple.times || []).filter(Boolean);
      times.forEach((t, i) => {
        const label = times.length === 1 ? "Daily prayer" : (toMin(t) < 720 && i === 0 ? "Morning prayer" : toMin(t) >= 1080 || i === times.length - 1 ? "Evening prayer" : "Prayer " + (i + 1));
        out.push(spec("pray-" + i, { name: label, emoji: "🙏", schedule: { kind: "daily" }, reminders: R({ times: [fromMin(toMin(t) + before)], nag }) }));
      });
    }
    if (c.bible.on) out.push(spec("bible", { name: "Read the Bible", emoji: "📖", type: "count", target: Math.max(1, +c.bible.amount || 1), unit: c.bible.unit + (c.bible.amount > 1 ? "s" : ""), schedule: { kind: "daily" }, reminders: R({ times: [c.bible.time] }) }));
    const d = c.denom, fst = fastingCfg(c);
    // Wednesday & Friday (Orthodox): not in the church's fast-free weeks, nor inside a long fast
    // (that day is already a fast) — a year's review found both habits due on the same Lenten Fridays.
    if (fst.wedFri && isOrthodox(d)) out.push(spec("fast", { name: "Fasting day", emoji: "🥖", schedule: { kind: "days", days: [3, 5], notInSeason: wedFriExceptions(d) }, reminders: R({ mode: "routine", anchor: "wake", offset: 0 }), notes: "Wednesday & Friday" }));
    if (fst.fridays && d === "catholic") out.push(spec("lent-fridays", { name: "No meat today", emoji: "🐟", schedule: { kind: "days", days: [5], season: "western-lent", notInSeason: "good-friday" }, reminders: R({ mode: "routine", anchor: "wake", offset: 0 }), notes: "Fridays of Lent" }));
    // Fasting seasons and days: on only when they fall, worked out from Easter and the church's calendar.
    for (const id of churchFasts(d)) {
      const t = FAST_TOGGLE[id.replace(/-(o|n)$/, "")];
      if (!t || !fst[t.on]) continue;
      const s = SEASONS[id];
      out.push(spec(t.key, { name: t.name || s.name, emoji: s.emoji, schedule: { kind: "daily", season: id }, reminders: R({ mode: "routine", anchor: "wake", offset: 0 }), notes: s.food }));
    }
  } else if (cfg.religion === "other") {
    const o = cfg.other;
    (o.times || []).filter(Boolean).forEach((t, i, arr) => {
      out.push(spec("other-" + i, {
        name: (o.practice || "Practice") + (arr.length > 1 ? " · " + (i + 1) : ""), emoji: o.emoji || "🧘",
        type: o.minutes ? "count" : "check", target: o.minutes || 1, unit: o.minutes ? "min" : "",
        schedule: o.days.length === 7 ? { kind: "daily" } : { kind: "days", days: o.days },
        reminders: R({ times: [t] })
      }));
    });
    // Sun-timed practices: the times move with the seasons by themselves.
    const sun = (key, name, emoji, days, at, offsets, notes) => out.push(spec(key, {
      name, emoji, schedule: days ? { kind: "days", days } : { kind: "daily" },
      reminders: R({ mode: "sun", sun: at, offsets }), notes
    }));
    if (o.tradition === "jewish") {
      const j = o.jewish, cm = Math.max(0, +j.candleMin || 18), hm = Math.max(0, +j.havdalahMin || 42);
      if (j.candles) sun("shabbat-candles", "Light Shabbat candles", "🕯️", [5], "sunset", [-(cm + 20), -cm], "Candle-lighting " + cm + " min before sunset");
      if (j.havdalah) sun("havdalah", "Havdalah", "🍷", [6], "sunset", [hm], "When three stars appear, about " + hm + " min after sunset");
      if (j.shacharit) sun("shacharit", "Shacharit", "🌅", null, "sunrise", [15], "Morning prayer");
      if (j.mincha) sun("mincha", "Mincha", "☀️", null, "sunset", [-40], "Afternoon prayer, before sunset");
      if (j.maariv) sun("maariv", "Maariv", "🌙", null, "sunset", [30], "Evening prayer, after nightfall");
      // Fasts, from the Hebrew calendar: Yom Kippur & Tisha B'Av run sunset to nightfall (so the
      // evening before gets a "pre-fast meal" reminder); the four minor fasts run dawn to nightfall.
      const fasts = j.fasts || "all", obs = (key, name, emoji, o2, at, offs, notes) => out.push(spec(key, { name, emoji, schedule: { kind: "daily", observance: o2 }, reminders: R({ mode: "sun", sun: at, offsets: offs }), notes }));
      if (fasts !== "none") {
        obs("fast-eve", "Pre-fast meal", "🍽️", "jewish-eve", "sunset", [-90], "The fast begins at sunset tonight");
        obs("jewish-major", "Fast day", "🕍", "jewish-major", "sunrise", [0], "Yom Kippur or Tisha B'Av — no food or drink until nightfall");
      }
      if (fasts === "all") obs("jewish-minor", "Fast day", "🕯️", "jewish-minor", "sunrise", [-60], "A minor fast — dawn to nightfall");
    } else if (o.tradition === "hindu") {
      const hd = o.hindu;
      if (hd.sunrise) sun("sandhya-am", "Puja at sunrise", "🪔", null, "sunrise", [0], "Morning Sandhya");
      if (hd.sunset) sun("sandhya-pm", "Sandhya at sunset", "🌇", null, "sunset", [0], "Evening prayer and lamp");
      // Lunar fasts, worked out from the Moon where you live.
      const lunar = (key, name, emoji, at, notes) => out.push(spec(key, { name, emoji, schedule: { kind: "daily", observance: "hindu:" + key + ":" + (hd.ekadashiRule || "smarta") }, reminders: R({ mode: "sun", sun: at, offsets: [0] }), notes }));
      if (hd.ekadashi) lunar("ekadashi", "Ekadashi fast", "🪔", "sunrise", "Sunrise to sunrise — break it after sunrise tomorrow");
      if (hd.purnima) lunar("purnima", "Purnima fast", "🌕", "sunset", "Full moon — until moonrise");
      if (hd.amavasya) lunar("amavasya", "Amavasya", "🌑", "sunrise", "New moon — a light fast, remember the ancestors");
    } else if (o.tradition === "sikh") {
      if (o.sikh.japji) out.push(spec("japji", { name: "Japji Sahib", emoji: "🌄", schedule: { kind: "daily" }, reminders: R({ mode: "routine", anchor: "wake", offset: 0 }), notes: "Morning Nitnem, Amrit vela" }));
      if (o.sikh.rehras) sun("rehras", "Rehras Sahib", "🌇", null, "sunset", [0], "Evening prayer at sunset");
      if (o.sikh.sohila) out.push(spec("sohila", { name: "Kirtan Sohila", emoji: "🌙", schedule: { kind: "daily" }, reminders: R({ mode: "routine", anchor: "bed", offset: -15 }), notes: "Before sleep" }));
    }
  }
  return out;
}

// Create/update/retire habits to match a spec list for a given source prefix.
export function syncSourced(prefix, specs) {
  const seen = new Set();
  for (const sp of specs) {
    seen.add(sp.source);
    let h = state.habits.find(x => x.source === sp.source);
    const base = newHabit();
    if (!h) {
      h = newHabit(Object.assign({}, sp));
      h.schedule = Object.assign(base.schedule, sp.schedule);
      h.reminders = Object.assign(base.reminders, sp.reminders);
      state.habits.push(h);
    } else {
      const keepStart = h.schedule.start;
      const before = { schedule: JSON.parse(JSON.stringify(h.schedule)), pastSchedules: h.pastSchedules, createdAt: h.createdAt };
      Object.assign(h, { name: sp.name, emoji: sp.emoji, category: sp.category, type: sp.type || "check", target: sp.target || 1, unit: sp.unit || "", notes: sp.notes || h.notes, archived: false });
      h.schedule = Object.assign(base.schedule, sp.schedule, { start: keepStart });
      keepPastSchedule(before, h); // e.g. Jumu'ah day or fasting days changed: past days keep their rule
      // Keep the person's own reminder tweaks unless the faith/routine settings changed this reminder.
      const specKey = JSON.stringify(sp.reminders || {});
      if (h.specReminders !== specKey) h.reminders = Object.assign(base.reminders, sp.reminders);
    }
    h.specReminders = JSON.stringify(sp.reminders || {});
  }
  state.habits = state.habits.filter(h => {
    if (!h.source || !h.source.startsWith(prefix) || seen.has(h.source)) return true;
    if (Object.keys(h.history).length) { h.archived = true; return true; }
    return false;
  });
}

export function applyFaith(cfg) {
  state.profile.faith = cfg;
  syncSourced("faith:", buildFaithSpecs(cfg));
}

export function routineSpecs() {
  return [
    { source: "routine:wake", name: "Wake up on time", emoji: "⏰", category: "Sleep", schedule: { kind: "daily" }, reminders: { on: true, mode: "routine", anchor: "wake", offset: 0, nag: 15 }, notes: "Follows your work-day / day-off wake time" },
    { source: "routine:bed", name: "In bed on time", emoji: "🛌", category: "Sleep", schedule: { kind: "daily" }, reminders: { on: true, mode: "routine", anchor: "bed", offset: -30, nag: 0 }, notes: "Reminder 30 min before bedtime to wind down" }
  ].concat(state && state.settings && state.settings.windDown ? [
    // One reminder for the whole wind-down, 45 minutes before bed.
    { source: "routine:winddown", name: "Wind down", emoji: "🌙", category: "Sleep", schedule: { kind: "daily" }, reminders: { on: true, mode: "routine", anchor: "bed", offset: -45, nag: 0 }, notes: "Screens away, lights low, a prayer or a few pages" }
  ] : []);
}
export function applyRoutine() { syncSourced("routine:", routineSpecs()); }

export function religionLabel(r, tradition) {
  if (r === "other" && tradition) return { jewish: "Judaism", hindu: "Hinduism", sikh: "Sikhism" }[tradition] || "Personal practice";
  return { muslim: "Islam", christian: "Christianity", other: "Personal practice" }[r] || "Off";
}
