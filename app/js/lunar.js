// Hindu lunar days (tithi) for Ekadashi, Purnima and Amavasya fasts. A tithi is each 12° the Moon
// gains on the Sun (30 a month: 1–15 waxing/Shukla, 16–30 waning/Krishna). Longitudes use the
// main terms of Meeus' lunar theory (good to a few arc-minutes, so a tithi's start is right to
// within ~30 min; a fast whose tithi changes within that of sunrise can differ from a printed panchang).
// The fast day is the one whose sunrise (Smarta) or arunodaya, 96 min before sunrise (Vaishnava),
// falls in the tithi; if a tithi touches no sunrise at all, the day it falls within.

import { state } from "./store.js";
import { prayerTimes, CITIES } from "./prayer.js";
import { keyOf } from "./dates.js";

const R = Math.PI / 180, s = x => Math.sin(x * R);
// Moon − Sun ecliptic longitude, 0–360°, at a moment (ms since 1970).
export function elongation(ms) {
  const T = (ms / 86400000 + 2440587.5 - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T, D = 297.8501921 + 445267.1114034 * T, M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T, F = 93.272095 + 483202.0175233 * T;
  const moon = Lp + 6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp) - 0.185116 * s(M) - 0.114332 * s(2 * F)
    + 0.058793 * s(2 * D - 2 * Mp) + 0.057066 * s(2 * D - M - Mp) + 0.053322 * s(2 * D + Mp) + 0.045758 * s(2 * D - M) - 0.040923 * s(M - Mp) - 0.03472 * s(D)
    - 0.030383 * s(M + Mp) + 0.015327 * s(2 * D - 2 * F) - 0.012528 * s(Mp + 2 * F) + 0.01098 * s(Mp - 2 * F) + 0.010675 * s(4 * D - Mp) + 0.010034 * s(3 * Mp) + 0.008548 * s(4 * D - 2 * Mp);
  const sun = 280.46646 + 36000.76983 * T + (1.914602 - 0.004817 * T) * s(M) + 0.019993 * s(2 * M) + 0.000289 * s(3 * M);
  return ((moon - sun) % 360 + 360) % 360;
}
export const tithiAt = ms => Math.floor(elongation(ms) / 12) + 1; // 1…30

const home = () => { const f = state && state.profile && state.profile.faith; const l = f && f.muslim && f.muslim.location; return l && l.lat != null ? l : { lat: CITIES[0][1], lng: CITIES[0][2] }; };
const cache = new Map();
// Tithi at this day's sunrise (or arunodaya) where you live.
function tithiOfDay(date, vaishnava) {
  const loc = home(), k = keyOf(date) + "|" + loc.lat + "|" + loc.lng + (vaishnava ? "v" : "");
  if (!cache.has(k)) {
    const rise = prayerTimes(date, loc, { method: "mwl" }).sunrise - (vaishnava ? 96 : 0);
    cache.set(k, tithiAt(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, rise).getTime()));
  }
  return cache.get(k);
}
const shift = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12);
// Is the tithi `t` observed on `date`? First day if it spans two sunrises; the day it falls within if it spans none.
function observed(date, t, vaishnava) {
  const now = tithiOfDay(date, vaishnava), prev = tithiOfDay(shift(date, -1), vaishnava), next = tithiOfDay(shift(date, 1), vaishnava);
  if (now === t) return prev !== t;
  const before = t === 1 ? 30 : t - 1, after = t === 30 ? 1 : t + 1;
  return now === before && next === after; // skipped tithi (kshaya)
}
export const HINDU_FASTS = {
  ekadashi: { name: "Ekadashi", emoji: "🪔", tithis: [11, 26], food: "Fast or no grains & beans — break it after sunrise the next day" },
  purnima: { name: "Purnima (full moon)", emoji: "🌕", tithis: [15], food: "Fast until moonrise, or a light fast" },
  amavasya: { name: "Amavasya (new moon)", emoji: "🌑", tithis: [30], food: "A light fast; remember the ancestors" }
};
// Which of these is observed on `date`: { id, paksha } or null. rule: "smarta" | "vaishnava" (Ekadashi only).
export function hinduFastOn(date, id, rule) {
  const f = HINDU_FASTS[id]; if (!f) return null;
  for (const t of f.tithis) if (observed(date, t, id === "ekadashi" && rule === "vaishnava")) return { id, paksha: t <= 15 ? "Shukla" : "Krishna" };
  return null;
}
