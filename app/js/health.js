// Steps & workouts from Apple Health (iOS) or Health Connect (Android) via the
// `capacitor-health` plugin. Fitbit, Garmin, Samsung Health, Strava, Google Fit
// etc. write into these, so they're covered too. Browsers can't read health
// data, so in the web version this stays off and habits are logged by hand.
//
// Habits opt in with habit.auto:
//   { source: "steps" }                     count habit filled with the day's steps
//   { source: "workout", minMinutes: 20 }    done when workouts that day add up to N min

import { state, save, activeHabits } from "./store.js";
import { keyOf, today, addDays, startOfDay } from "./dates.js";
import { setCount } from "./schedule.js";
import { logSleep } from "./sleep.js";

const Cap = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? window.Capacitor : null;
const plugin = () => { const c = Cap(); return c && c.Plugins && c.Plugins.Health; };
export const platformName = () => { const c = Cap(); const p = c && c.getPlatform ? c.getPlatform() : ""; return p === "ios" ? "Apple Health" : p === "android" ? "Health Connect" : "Apple Health / Health Connect"; };

export async function available() {
  const p = plugin();
  if (!p) return false;
  try { const r = await p.isHealthAvailable(); return !!(r && r.available); } catch (e) { return false; }
}

export async function connect() {
  const p = plugin();
  if (!p) throw new Error("Health data is available in the Android/iOS app.");
  if (!(await available())) {
    if (Cap().getPlatform() === "android" && p.showHealthConnectInPlayStore) { await p.showHealthConnectInPlayStore(); throw new Error("Install Health Connect from the Play Store, then try again."); }
    throw new Error(platformName() + " isn't available on this phone.");
  }
  // Only what the app uses: daily steps and workout type/duration. No calories, heart rate or routes.
  await p.requestHealthPermissions({ permissions: ["READ_STEPS", "READ_WORKOUTS"] });
  // Sleep where the plugin version supports it (newer builds); otherwise the morning check-in covers it.
  if (p.querySleep) { try { await p.requestHealthPermissions({ permissions: ["READ_SLEEP"] }); } catch (e) { /* not offered on this phone */ } }
  state.health.connected = true;
  state.health.error = "";
  await sync(true);
}

export function disconnect() { state.health.connected = false; }

export async function openSettings() {
  const p = plugin();
  if (!p) return;
  if (Cap().getPlatform() === "ios" && p.openAppleHealthSettings) await p.openAppleHealthSettings();
  else if (p.openHealthConnectSettings) await p.openHealthConnectSettings();
}

let running = null;
export function sync(force) {
  if (!state.health.connected || !plugin()) return Promise.resolve(false);
  if (running) return running;
  if (!force && Date.now() - state.health.lastSync < 10 * 60000) return Promise.resolve(false);
  running = doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  const p = plugin();
  const from = startOfDay(addDays(new Date(), -13)), to = new Date();
  try {
    const st = await p.queryAggregated({ startDate: from.toISOString(), endDate: to.toISOString(), dataType: "steps", bucket: "day" });
    (st.aggregatedData || []).forEach(b => { state.health.steps[keyOf(new Date(b.startDate))] = Math.round(b.value || 0); });
  } catch (e) { state.health.error = "Steps: " + (e.message || e); }
  try {
    const w = await p.queryWorkouts({ startDate: from.toISOString(), endDate: to.toISOString(), includeHeartRate: false, includeRoute: false, includeSteps: false });
    const byDay = {};
    (w.workouts || []).forEach(x => {
      const k = keyOf(new Date(x.startDate));
      const min = Math.round((x.duration || (Date.parse(x.endDate) - Date.parse(x.startDate)) / 1000 || 0) / 60);
      (byDay[k] = byDay[k] || []).push({ type: String(x.workoutType || "workout").replace(/_/g, " ").toLowerCase(), minutes: min });
    });
    Object.assign(state.health.workouts, byDay);
  } catch (e) { state.health.error = "Workouts: " + (e.message || e); }
  if (p.querySleep) {
    try {
      const r = await p.querySleep({ startDate: from.toISOString(), endDate: to.toISOString() });
      for (const s of r.sessions || r.sleep || []) {
        const a = new Date(s.startDate), b = new Date(s.endDate);
        if (!(b > a) || b - a < 3 * 3600e3) continue; // naps don't count as the night
        const hm = d => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        logSleep(keyOf(b), hm(a), hm(b), "health");
      }
    } catch (e) { /* sleep isn't readable here — the morning check-in covers it */ }
  }
  // keep two weeks only
  const keep = keyOf(addDays(new Date(), -14));
  for (const bag of [state.health.steps, state.health.workouts]) Object.keys(bag).forEach(k => { if (k < keep) delete bag[k]; });
  state.health.lastSync = Date.now();
  applyToHabits();
  save();
  return true;
}

export function workoutMinutes(k) { return (state.health.workouts[k] || []).reduce((a, w) => a + (w.minutes || 0), 0); }

// Write health numbers into linked habits (never lowers a value you logged by hand).
export function applyToHabits() {
  for (const h of activeHabits()) {
    if (!h.auto) continue;
    for (let i = 0; i < 14; i++) {
      const d = addDays(today(), -i), k = keyOf(d);
      if (h.history[k] === "skip") continue;
      if (h.auto.source === "steps" && state.health.steps[k] != null) {
        const steps = state.health.steps[k];
        if (h.type === "count") { const cur = typeof h.history[k] === "number" ? h.history[k] : 0; if (steps > cur) setCount(h, d, steps); }
        else if (!h.history[k] && steps >= (h.auto.minSteps || 1)) setCount(h, d, 1);
      }
      if (h.auto.source === "workout" && workoutMinutes(k) >= (h.auto.minMinutes || 1) && !h.history[k]) {
        setCount(h, d, h.type === "count" ? workoutMinutes(k) : 1);
      }
    }
  }
}

export function healthNote(h, d) {
  if (!h.auto || !state.health.connected) return "";
  const k = keyOf(d);
  if (h.auto.source === "steps" && state.health.steps[k] != null) return "🍎 " + state.health.steps[k].toLocaleString() + " steps synced";
  if (h.auto.source === "workout" && state.health.workouts[k]) return "🍎 " + state.health.workouts[k].map(w => w.type + " " + w.minutes + "m").join(", ");
  return "";
}
