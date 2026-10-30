// Christian fasting calendars, worked out from Easter and each church's fixed feasts — so fasts
// switch on and off by themselves, like Ramadan mode. All ranges are inclusive.
//
// Churches (profile.faith.christian.denom):
//   orthodox     Coptic Orthodox (also Ethiopian & Eritrean Tewahedo — same fasts)
//   eastern      Eastern Orthodox on the old (Julian) calendar: Russian, Serbian, Georgian, Jerusalem, Athos
//   eastern-new  Eastern Orthodox on the new (Revised Julian) calendar: Greek, Antiochian, Romanian, Bulgarian, Cypriot
//   catholic / protestant / other — Western Easter
// All Orthodox use the same (Julian-computus) Easter; only the fixed-date fasts differ by calendar
// (old-calendar dates are 13 days later in the Gregorian calendar, 1900–2099).
//
// Coptic:   Great Lent E−55…E−1 (55 days: preparation week + 40 days + Holy Week) · Jonah E−69…E−67
//           Apostles E+50…11 Jul · the Virgin 7–21 Aug · Nativity 25 Nov…6 Jan (43) · Paramoun before Theophany
//           Wed/Fri all year except the Holy Fifty Days and when Nativity (7 Jan) / Theophany (19 Jan) fall on them
// Eastern:  Great Lent from Clean Monday E−48…E−1 · Apostles from the Monday after All Saints (E+57) to 28 Jun
//           (can be zero days on the new calendar) · Dormition 1–14 Aug · Nativity 15 Nov…24 Dec ·
//           strict days: Theophany eve 5 Jan, Beheading of St John 29 Aug, Exaltation of the Cross 14 Sep
//           Wed/Fri except Bright Week, Trinity Week, Publican & Pharisee week, Cheesefare week and Christmas–Theophany
// Western:  Lent E−46…E−1 (Ash Wednesday to Holy Saturday) · fast days Ash Wednesday & Good Friday ·
//           Fridays of Lent without meat · Advent

const DAY = 86400e3;
const easterCache = new Map();
const mid = (y, m, d) => new Date(y, m, d, 12);
// Day number of a calendar date, from its year/month/day alone (UTC maths), so it's the same in
// every time zone. (Rounding local noon put every date a day late west of Greenwich.)
const dayIndex = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
export const fromIndex = i => { const d = new Date(i * DAY); return mid(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

export function westernEaster(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return mid(y, month - 1, day);
}
export function orthodoxEaster(y) {
  const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  const julian = mid(y, month - 1, day);
  return new Date(julian.getTime() + 13 * DAY); // Julian → Gregorian (1900–2099)
}
function easterIdx(y, orthodox) {
  const k = y + (orthodox ? "o" : "w");
  if (!easterCache.has(k)) easterCache.set(k, dayIndex(orthodox ? orthodoxEaster(y) : westernEaster(y)));
  return easterCache.get(k);
}
const E = y => easterIdx(y, true), W = y => easterIdx(y, false);
// A fixed church date (month 0-based) in the Gregorian calendar; old-calendar churches keep it 13 days later.
const fixed = (y, m, d, oldCal) => dayIndex(mid(y, m, d)) + (oldCal ? 13 : 0);
const one = i => [i, i];
// Coptic calendar: twelve 30-day months from 1 Tout (11 September, or 12 September in the year before a
// Gregorian leap year, when the Coptic year just ended had a sixth epagomenal day — 2023, 2027, 2031…).
// coptic(y, m, d) is that date in the Coptic year starting in September of Gregorian year y.
const gLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const tout1 = y => dayIndex(mid(y, 8, gLeap(y + 1) ? 12 : 11));
const coptic = (y, m, d) => tout1(y) + (m - 1) * 30 + (d - 1);
// Coptic Paramoun of Theophany: the day before 19 Jan, or back to Friday when the feast is on Sunday/Monday.
const paramoun = y => { const f = mid(y, 0, 19), dow = f.getDay(); return one(dayIndex(f) - (dow === 0 ? 2 : dow === 1 ? 3 : 1)); };

// food: what the fast asks, in a few words (shown in the fasting calendar).
const VEGAN_FISH = "Vegan — fish allowed", VEGAN = "Vegan — no fish", STRICT = "Strict fast";
export const SEASONS = {
  // Coptic / Ethiopian / Eritrean
  "great-lent": { name: "Great Lent", emoji: "✝️", food: VEGAN + "; Holy Week strictest", range: y => [E(y) - 55, E(y) - 1] },
  "jonah-fast": { name: "Fast of Jonah", emoji: "🐋", food: VEGAN, range: y => [E(y) - 69, E(y) - 67] },
  // Fixed Coptic dates come from the Coptic calendar: Apostles' Fast ends the eve of 5 Epip (11 July),
  // the Virgin's fast is 1–15 Mesori (7–21 August), the Nativity Fast starts 16 Hatour (25 November, or
  // 26 November in 2027, 2031… — then 42 days, as the Church keeps Christmas on 7 January every year).
  "apostles-fast": { name: "Apostles' Fast", emoji: "⛵", food: VEGAN_FISH, range: y => [E(y) + 50, coptic(y - 1, 11, 4)] },
  "virgin-fast": { name: "Fast of the Virgin Mary", emoji: "🌹", food: VEGAN_FISH, range: y => [coptic(y - 1, 12, 1), coptic(y - 1, 12, 15)] },
  "nativity-fast": { name: "Nativity Fast", emoji: "⭐", food: VEGAN_FISH, range: y => [coptic(y, 3, 16), fixed(y + 1, 0, 6)] },
  "paramoun": { name: "Paramoun of Theophany", emoji: "🕊️", food: STRICT + " until evening, vegan", range: y => paramoun(y) },
  "holy-fifty": { name: "Holy Fifty Days", emoji: "🌿", range: y => [E(y), E(y) + 49] },
  "coptic-nativity-day": { name: "Feast of the Nativity", range: y => one(fixed(y, 0, 7)) },
  "coptic-theophany-day": { name: "Feast of Theophany", range: y => one(fixed(y, 0, 19)) },
  // Eastern Orthodox, old (o) and new (n) calendar
  "eastern-lent": { name: "Great Lent", emoji: "✝️", food: "No meat, dairy, eggs or fish; wine & oil at weekends", range: y => [E(y) - 48, E(y) - 1] },
  "apostles-o": { name: "Apostles' Fast", emoji: "⛵", food: VEGAN_FISH + " most days", range: y => [E(y) + 57, fixed(y, 5, 28, true)] },
  "apostles-n": { name: "Apostles' Fast", emoji: "⛵", food: VEGAN_FISH + " most days", range: y => [E(y) + 57, fixed(y, 5, 28)] },
  "dormition-o": { name: "Dormition Fast", emoji: "🌹", food: VEGAN + "; fish on the Transfiguration", range: y => [fixed(y, 7, 1, true), fixed(y, 7, 14, true)] },
  "dormition-n": { name: "Dormition Fast", emoji: "🌹", food: VEGAN + "; fish on the Transfiguration", range: y => [fixed(y, 7, 1), fixed(y, 7, 14)] },
  "nativity-o": { name: "Nativity Fast", emoji: "⭐", food: VEGAN_FISH + " until 19 Dec", range: y => [fixed(y, 10, 15, true), fixed(y, 11, 24, true)] },
  "nativity-n": { name: "Nativity Fast", emoji: "⭐", food: VEGAN_FISH + " until 19 Dec", range: y => [fixed(y, 10, 15), fixed(y, 11, 24)] },
  "theophany-eve-o": { name: "Eve of Theophany", emoji: "🕊️", food: STRICT, range: y => one(fixed(y, 0, 5, true)) },
  "theophany-eve-n": { name: "Eve of Theophany", emoji: "🕊️", food: STRICT, range: y => one(fixed(y, 0, 5)) },
  "beheading-o": { name: "Beheading of St John", emoji: "🕯️", food: STRICT, range: y => one(fixed(y, 7, 29, true)) },
  "beheading-n": { name: "Beheading of St John", emoji: "🕯️", food: STRICT, range: y => one(fixed(y, 7, 29)) },
  "exaltation-o": { name: "Exaltation of the Cross", emoji: "✝️", food: STRICT, range: y => one(fixed(y, 8, 14, true)) },
  "exaltation-n": { name: "Exaltation of the Cross", emoji: "✝️", food: STRICT, range: y => one(fixed(y, 8, 14)) },
  // Fast-free weeks (no Wednesday/Friday fast)
  "bright-week": { name: "Bright Week", range: y => [E(y), E(y) + 6] },
  "trinity-week": { name: "Trinity Week", range: y => [E(y) + 49, E(y) + 55] },
  "publican-week": { name: "Week of the Publican & Pharisee", range: y => [E(y) - 70, E(y) - 64] },
  "cheesefare-week": { name: "Cheesefare Week", range: y => [E(y) - 55, E(y) - 49] },
  "svyatki-o": { name: "Christmas to Theophany", range: y => [fixed(y, 11, 25, true), fixed(y + 1, 0, 4, true)] },
  "svyatki-n": { name: "Christmas to Theophany", range: y => [fixed(y, 11, 25), fixed(y + 1, 0, 4)] },
  // Western
  "western-lent": { name: "Lent", emoji: "✝️", food: "Your Lenten commitment each day", range: y => [W(y) - 46, W(y) - 1] },
  "ash-wednesday": { name: "Ash Wednesday", emoji: "✝️", food: "Fast (one full meal) and no meat", range: y => one(W(y) - 46) },
  "good-friday": { name: "Good Friday", emoji: "✝️", food: "Fast (one full meal) and no meat", range: y => one(W(y) - 2) },
  "advent": { name: "Advent", emoji: "🕯️", food: "A daily moment of prayer", range: y => { const xmas = mid(y, 11, 25); const sun = dayIndex(xmas) - (xmas.getDay() || 7) - 21; return [sun, dayIndex(mid(y, 11, 24))]; } }
};

// The fasts each church keeps (in calendar order), and the periods without Wednesday/Friday fasting.
const cal = (denom, a, b) => denom === "eastern" ? a : b;
export function churchFasts(denom) {
  if (denom === "orthodox") return ["nativity-fast", "paramoun", "jonah-fast", "great-lent", "apostles-fast", "virgin-fast"];
  if (denom === "eastern" || denom === "eastern-new") return [cal(denom, "nativity-o", "nativity-n"), cal(denom, "theophany-eve-o", "theophany-eve-n"), "eastern-lent", cal(denom, "apostles-o", "apostles-n"), cal(denom, "dormition-o", "dormition-n"), cal(denom, "beheading-o", "beheading-n"), cal(denom, "exaltation-o", "exaltation-n")];
  if (denom === "catholic") return ["ash-wednesday", "western-lent", "good-friday", "advent"];
  return ["western-lent", "good-friday", "advent"];
}
// Wednesday/Friday fasting skips these (and the long fasts themselves, which already cover those days).
export function wedFriExceptions(denom) {
  if (denom === "orthodox") return ["holy-fifty", "coptic-nativity-day", "coptic-theophany-day", "great-lent", "jonah-fast", "apostles-fast", "virgin-fast", "nativity-fast"];
  if (denom === "eastern" || denom === "eastern-new") return ["bright-week", "trinity-week", "publican-week", "cheesefare-week", cal(denom, "svyatki-o", "svyatki-n"), "eastern-lent", cal(denom, "apostles-o", "apostles-n"), cal(denom, "dormition-o", "dormition-n"), cal(denom, "nativity-o", "nativity-n")];
  return [];
}
export const isOrthodox = denom => denom === "orthodox" || denom === "eastern" || denom === "eastern-new";

// Is `date` inside the season? Returns { day, of } (1-based) or null.
export function seasonOn(id, date) {
  const s = SEASONS[id]; if (!s) return null;
  const x = dayIndex(date), y = date.getFullYear();
  for (const yy of [y - 1, y]) { // the Nativity fasts and Advent span New Year
    const [a, b] = s.range(yy);
    if (b >= a && x >= a && x <= b) return { day: x - a + 1, of: b - a + 1 };
  }
  return null;
}
export const inSeason = (id, date) => [].concat(id).some(x => !!seasonOn(x, date));

// The fast running today for this church (for the Faith tab), and the next one to start.
export function currentFast(date, denom) {
  for (const id of churchFasts(denom)) { const s = seasonOn(id, date); if (s) return Object.assign({ id }, SEASONS[id], s); }
  return null;
}
export function nextFast(date, denom) {
  let best = null;
  for (const id of churchFasts(denom)) for (const y of [date.getFullYear(), date.getFullYear() + 1]) {
    const [a, b] = SEASONS[id].range(y), n = a - dayIndex(date);
    if (b >= a && n > 0 && (!best || n < best.in)) best = Object.assign({ id, in: n, days: b - a + 1 }, SEASONS[id]);
  }
  return best;
}
// Every fast of this church that starts or runs in the next `days` days: { id, name, emoji, food, start, end, days }.
export function churchYear(from, denom, days) {
  const x0 = dayIndex(from), x1 = x0 + (days || 365), out = [];
  for (const id of churchFasts(denom)) for (const y of [from.getFullYear() - 1, from.getFullYear(), from.getFullYear() + 1]) {
    const [a, b] = SEASONS[id].range(y);
    if (b < a || b < x0 || a >= x1) continue;
    out.push(Object.assign({ id }, SEASONS[id], { start: fromIndex(a), end: fromIndex(b), days: b - a + 1 }));
  }
  return out.sort((p, q) => p.start - q.start);
}
