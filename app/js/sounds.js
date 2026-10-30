// Reminder sounds. Faith reminders can use an Adhan (Islam), a church bell (Christianity) or a
// soft chime; other habits use the phone's default or the chime.
//
// Files: www/sounds/<file>.wav (or .mp3) for in-app preview, plus the same sound as <file>.wav in
// android/app/src/main/res/raw/ and in the iOS app bundle (≤ 30 s — iOS plays the default
// sound for anything longer). See docs/RELEASE.md → Sounds. Adhan recordings must be licensed.

import { state } from "./store.js";
import { canUse } from "./pro.js";

export const SOUNDS = [
  { id: "default", label: "Phone's default sound", file: null },
  { id: "chime", label: "Soft chime", file: "waqti_chime" },
  { id: "adhan-short", label: "Adhan — opening takbir", faith: "muslim", file: "adhan_short" },
  { id: "adhan-makkah", label: "Adhan — Makkah style", faith: "muslim", file: "adhan_makkah", tier: "extraSounds" },
  { id: "adhan-egypt", label: "Adhan — Egyptian style", faith: "muslim", file: "adhan_egypt", tier: "extraSounds" },
  { id: "adhan-fajr", label: "Fajr Adhan", faith: "muslim", file: "adhan_fajr", tier: "extraSounds" },
  { id: "bell", label: "Church bell", faith: "christian", file: "church_bell" },
  { id: "bells-peal", label: "Church bells — full peal", faith: "christian", file: "church_bells_peal", tier: "extraSounds" },
  { id: "agpeya-chime", label: "Agpeya hour chime", faith: "christian", file: "agpeya_chime", tier: "extraSounds" }
];

export const soundById = id => SOUNDS.find(s => s.id === id) || SOUNDS[0];
export function soundsFor(religion) { return SOUNDS.filter(s => !s.faith || s.faith === religion); }

// Which sound files are really in the app. The chime and church bell ship with Waqti; Adhan
// recordings switch on by themselves once their file is added to www/sounds/ (checked at start).
const ready = new Set(["waqti_chime", "church_bell"]);
let checked = null;
export function detectSounds() {
  if (!checked) checked = Promise.all(SOUNDS.filter(s => s.file && !ready.has(s.file)).map(async s => {
    for (const ext of [".wav", ".mp3"]) {
      try { const r = await fetch("sounds/" + s.file + ext, { method: "HEAD", cache: "no-store" }); if (r.ok) { ready.add(s.file); return; } } catch (e) { /* not there */ }
    }
  })).then(() => ready);
  return checked;
}
export const soundReady = s => !s.file || ready.has(s.file);
export const soundAllowed = s => soundReady(s) && (!s.tier || canUse(s.tier));

export function defaultFaithSound(religion) {
  if (religion === "muslim") return soundReady(soundById("adhan-short")) ? "adhan-short" : "chime";
  return religion === "christian" ? "bell" : "chime";
}

// The sound for one habit's reminder.
export function soundFor(h) {
  const cfg = (state && state.settings.sounds) || {};
  const religion = state && state.profile.faith && state.profile.faith.religion;
  let id = cfg.habits || "default";
  if (h && h.category === "Faith") {
    id = cfg.faith || defaultFaithSound(religion);
    const p = h.source && h.source.match(/^faith:(fajr|dhuhr|asr|maghrib|isha)$/);
    if (p && cfg.perPrayer && cfg.perPrayer[p[1]] && canUse("perPrayerSound")) id = cfg.perPrayer[p[1]];
  }
  const s = soundById(id);
  return soundAllowed(s) ? s : soundById(h && h.category === "Faith" ? defaultFaithSound(religion) : "default");
}

let audio = null;
export function preview(id) {
  const s = soundById(id);
  if (audio) { audio.pause(); audio = null; }
  if (!s.file) return Promise.resolve("default");
  const tryPlay = ext => { audio = new Audio("sounds/" + s.file + ext); return audio.play(); };
  return tryPlay(".wav").catch(() => tryPlay(".mp3")).then(() => "playing").catch(() => "missing");
}
export function stopPreview() { if (audio) { audio.pause(); audio = null; } }
