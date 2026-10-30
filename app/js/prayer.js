// Offline prayer-time calculation (sun-position method, as used by
// PrayTimes.org). Times are returned in the device's local time zone.

export const METHODS = {
  // dhuhrMin: minutes added after true noon. Egypt's official timetable uses none
  // (checked against published Cairo/Alexandria times for 2026); others default to 1.
  egypt:   { name: "Egyptian General Authority", fajr: 19.5, isha: 17.5, dhuhrMin: 0 },
  mwl:     { name: "Muslim World League", fajr: 18, isha: 17 },
  makkah:  { name: "Umm al-Qura, Makkah", fajr: 18.5, ishaMin: 90 },
  karachi: { name: "Univ. of Islamic Sciences, Karachi", fajr: 18, isha: 18 },
  isna:    { name: "ISNA (North America)", fajr: 15, isha: 15 },
  dubai:   { name: "Dubai (UAE)", fajr: 18.2, isha: 18.2 },
  turkey:  { name: "Diyanet (Turkey)", fajr: 18, isha: 17 },
  // Shia (Ithna 'Ashari): Maghrib is when the redness in the east has gone, the sun ~4° below the
  // horizon (≈15–20 min after sunset), not at sunset itself. Values as used by PrayTimes.org.
  jafari:  { name: "Shia Ithna 'Ashari (Leva Institute, Qum)", fajr: 16, isha: 14, maghrib: 4, shia: true },
  tehran:  { name: "Institute of Geophysics, Tehran", fajr: 17.7, isha: 14, maghrib: 4.5, shia: true },
  // Not offered for prayers: Jewish dawn (alot ha-shachar, 16.1°) and nightfall (tzeit, 8.5°) for fast times.
  halachic: { name: "Dawn & nightfall", fajr: 16.1, isha: 8.5, hidden: true }
};
export const SHIA_METHODS = Object.keys(METHODS).filter(k => METHODS[k].shia);

export const PRAYERS = [
  { id: "fajr", name: "Fajr", ar: "الفجر", rakah: 2 },
  { id: "dhuhr", name: "Dhuhr", ar: "الظهر", rakah: 4 },
  { id: "asr", name: "Asr", ar: "العصر", rakah: 4 },
  { id: "maghrib", name: "Maghrib", ar: "المغرب", rakah: 3 },
  { id: "isha", name: "Isha", ar: "العشاء", rakah: 4 }
];
// Extra anchors you can attach reminders to.
export const TIME_POINTS = [
  ...PRAYERS,
  { id: "sunrise", name: "Sunrise" },
  { id: "midnight", name: "Islamic midnight" },
  { id: "lastThird", name: "Last third of night" }
];

export const CITIES = [
  ["Cairo", 30.0444, 31.2357], ["Giza", 30.0131, 31.2089], ["Alexandria", 31.2001, 29.9187],
  ["Mansoura", 31.0409, 31.3785], ["Tanta", 30.7865, 31.0004], ["Zagazig", 30.5877, 31.502],
  ["Port Said", 31.2653, 32.3019], ["Ismailia", 30.5965, 32.2715], ["Suez", 29.9668, 32.5498],
  ["Asyut", 27.1783, 31.1859], ["Minya", 28.1099, 30.7503], ["Sohag", 26.5591, 31.6957],
  ["Luxor", 25.6872, 32.6396], ["Aswan", 24.0889, 32.8998], ["Hurghada", 27.2579, 33.8116],
  ["Sharm El Sheikh", 27.9158, 34.33], ["Riyadh", 24.7136, 46.6753], ["Jeddah", 21.4858, 39.1925],
  ["Makkah", 21.3891, 39.8579], ["Madinah", 24.5247, 39.5692], ["Dammam", 26.4207, 50.0888],
  ["Dubai", 25.2048, 55.2708], ["Abu Dhabi", 24.4539, 54.3773], ["Doha", 25.2854, 51.531],
  ["Kuwait City", 29.3759, 47.9774], ["Manama", 26.2285, 50.586], ["Muscat", 23.588, 58.3829],
  ["Amman", 31.9454, 35.9284], ["Beirut", 33.8938, 35.5018], ["Baghdad", 33.3152, 44.3661],
  ["Najaf", 32.0259, 44.3462], ["Karbala", 32.616, 44.0249], ["Basra", 30.5085, 47.7804],
  ["Tehran", 35.6892, 51.389], ["Mashhad", 36.2605, 59.6168], ["Qom", 34.6416, 50.8746], ["Isfahan", 32.6539, 51.666],
  ["Khartoum", 15.5007, 32.5599], ["Tripoli", 32.8872, 13.1913], ["Tunis", 36.8065, 10.1815],
  ["Algiers", 36.7538, 3.0588], ["Casablanca", 33.5731, -7.5898], ["Istanbul", 41.0082, 28.9784],
  ["London", 51.5074, -0.1278], ["Manchester", 53.4808, -2.2426], ["Paris", 48.8566, 2.3522],
  ["Berlin", 52.52, 13.405], ["Amsterdam", 52.3676, 4.9041], ["Rome", 41.9028, 12.4964],
  ["Athens", 37.9838, 23.7275], ["Moscow", 55.7558, 37.6173], ["Addis Ababa", 9.0301, 38.7408],
  ["New York", 40.7128, -74.006], ["Chicago", 41.8781, -87.6298], ["Los Angeles", 34.0522, -118.2437],
  ["Toronto", 43.6532, -79.3832], ["Sydney", -33.8688, 151.2093], ["Melbourne", -37.8136, 144.9631],
  ["Kuala Lumpur", 3.139, 101.6869], ["Jakarta", -6.2088, 106.8456], ["Karachi", 24.8607, 67.0011],
  ["Lahore", 31.5204, 74.3587], ["Dhaka", 23.8103, 90.4125], ["Mumbai", 19.076, 72.8777]
];

const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const sin = d => Math.sin(rad(d)), cos = d => Math.cos(rad(d)), tan = d => Math.tan(rad(d));
const arcsin = x => deg(Math.asin(x)), arccos = x => deg(Math.acos(x)), arctan2 = (y, x) => deg(Math.atan2(y, x));
const arccot = x => deg(Math.atan(1 / x));
const fix = (a, b) => { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; };
const fixAngle = a => fix(a, 360), fixHour = a => fix(a, 24);

function julian(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = arctan2(cos(e) * sin(L), cos(L)) / 15;
  return { decl: arcsin(sin(e) * sin(L)), eqt: q / 15 - fixHour(RA) };
}

/**
 * @param {Date} date   calendar date
 * @param {{lat:number,lng:number}} loc
 * @param {{method?:string, asr?:"standard"|"hanafi"}} opts
 * @returns {Record<string, number>} minutes after local midnight
 */
export function prayerTimes(date, loc, opts = {}) {
  const method = METHODS[opts.method] || METHODS.egypt;
  const asrFactor = opts.asr === "hanafi" ? 2 : 1;
  const lat = loc.lat, lng = loc.lng;
  const tz = -new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTimezoneOffset() / 60;
  const jDate = julian(date.getFullYear(), date.getMonth() + 1, date.getDate()) - lng / (15 * 24);

  const midDay = t => fixHour(12 - sunPosition(jDate + t).eqt);
  const angleTime = (angle, t, ccw) => {
    const decl = sunPosition(jDate + t).decl;
    const noon = midDay(t);
    const T = arccos((-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat))) / 15;
    return noon + (ccw ? -T : T);
  };
  const asrTime = (factor, t) => {
    const decl = sunPosition(jDate + t).decl;
    return angleTime(-arccot(factor + tan(Math.abs(lat - decl))), t);
  };

  // Two refinement passes from rough guesses (hours / 24).
  let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, maghrib: 18, isha: 18 };
  for (let i = 0; i < 2; i++) {
    const p = {}; for (const k in t) p[k] = t[k] / 24;
    t = {
      fajr: angleTime(method.fajr, p.fajr, true),
      sunrise: angleTime(0.833, p.sunrise, true),
      dhuhr: midDay(p.dhuhr),
      asr: asrTime(asrFactor, p.asr),
      sunset: angleTime(0.833, p.sunset),
      maghrib: method.maghrib ? angleTime(method.maghrib, p.maghrib) : 0,
      isha: method.ishaMin ? 0 : angleTime(method.isha, p.isha)
    };
  }
  if (!method.maghrib || isNaN(t.maghrib)) t.maghrib = t.sunset;
  // Umm al-Qura: Isha is 90 min after Maghrib, 120 min during Ramadan.
  if (method.ishaMin) t.isha = t.maghrib + (method.ishaMin + (opts.ramadan ? 30 : 0)) / 60;

  // High latitudes (UK, northern Europe in summer): twilight may never get deep enough for Fajr or
  // Isha, so each is capped at a share of the night. Mosques differ, so it's a choice:
  //   angle (default) — angle/60 of the night · midnight — half the night · seventh — a seventh · none — no cap
  const night = fixHour(t.sunrise - t.sunset), rule = opts.highLat || "angle";
  const portion = a => rule === "midnight" ? 0.5 : rule === "seventh" ? 1 / 7 : a / 60;
  if (rule !== "none" || isNaN(t.fajr)) {
    const fajrMax = night * portion(method.fajr);
    if (isNaN(t.fajr) || fixHour(t.sunrise - t.fajr) > fajrMax) t.fajr = t.sunrise - fajrMax;
  }
  if (!method.ishaMin && (rule !== "none" || isNaN(t.isha))) {
    const ishaMax = night * portion(method.isha);
    if (isNaN(t.isha) || fixHour(t.isha - t.sunset) > ishaMax) t.isha = t.sunset + ishaMax;
  }

  const out = {};
  for (const k of ["fajr", "sunrise", "dhuhr", "asr", "sunset", "maghrib", "isha"]) {
    let h = t[k] + tz - lng / 15;
    if (k === "dhuhr") h += (method.dhuhrMin != null ? method.dhuhrMin : 1) / 60; // margin after zenith
    out[k] = Math.round(fixHour(h) * 60) % 1440; // 23:59:45 rounds to 00:00, not 24:00
  }
  // Midnight and last third are measured from sunset to the next fajr.
  const nightMin = ((out.fajr - out.sunset) % 1440 + 1440) % 1440;
  out.midnight = (out.sunset + Math.round(nightMin / 2)) % 1440;
  out.lastThird = (out.sunset + Math.round(nightMin * 2 / 3)) % 1440;
  return out;
}

export function nearestCity(lat, lng) {
  let best = null, bd = Infinity;
  for (const c of CITIES) {
    const d = (c[1] - lat) ** 2 + ((c[2] - lng) * Math.cos(rad(lat))) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best && bd < 1.5 ? best[0] : null;
}
