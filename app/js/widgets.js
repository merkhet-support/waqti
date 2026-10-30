// Home-screen widgets. The app writes a small "today" snapshot with @capacitor/preferences; the
// native widgets (native/android, native/ios — see native/README.md) read it:
//   Android: SharedPreferences "CapacitorStorage", key "waqti_widget" (same app, read directly)
//   iOS:     the app copies UserDefaults.standard "CapacitorStorage.waqti_widget" into the
//            App Group "group.app.merkhet.habits" when it goes to the background
// Tapping a habit in a widget opens waqti://done?h=<habitId>&d=<YYYY-MM-DD>, handled in app.js.

import { state, activeHabits } from "./store.js";
import { today, keyOf, momentFor, fmtTime, addDays } from "./dates.js";
import { isScheduled, status, dayScore, progressLabel } from "./schedule.js";
import { primaryMinute } from "./reminders.js";
import { prayerMinutes } from "./faith.js";
import { PRAYERS } from "./prayer.js";
import { colorOf } from "./colors.js";
import { trText } from "./i18n.js";

const Prefs = () => { const c = window.Capacitor; return c && c.isNativePlatform && c.isNativePlatform() && c.Plugins && c.Plugins.Preferences; };
let last = "";

export function snapshot(now) {
  now = now || Date.now();
  const t = today(), list = activeHabits().filter(h => isScheduled(h, t));
  const sc = dayScore(t, list);
  const open = list.filter(h => status(h, t) === "open")
    .map(h => ({ h, m: primaryMinute(h, t) }))
    .sort((a, b) => (a.m == null) - (b.m == null) || (a.m != null && b.m != null ? momentFor(t, a.m) - momentFor(t, b.m) : 0));
  const snap = {
    day: keyOf(t), done: sc.done, total: sc.sched, pct: sc.sched ? Math.round(sc.done / sc.sched * 100) : 0,
    habits: open.filter(({ h }) => !h.private /* private habits stay off the home screen */).slice(0, 4).map(({ h, m }) => ({ id: h.id, emoji: h.emoji, name: trText(h.name), time: m != null ? fmtTime(m) : "", color: colorOf(h), progress: progressLabel(h, t) || "" })),
    prayer: null, updated: now
  };
  const f = state.profile.faith;
  if (f && f.religion === "muslim") {
    for (let i = 0; i < 2 && !snap.prayer; i++) {
      const d = addDays(t, i), pt = prayerMinutes(d);
      for (const p of PRAYERS) { const at = momentFor(d, pt[p.id]).getTime(); if (at > now) { snap.prayer = { name: trText(p.name), time: fmtTime(pt[p.id]), at }; break; } }
    }
  }
  return snap;
}

export async function updateWidgets() {
  const prefs = Prefs();
  if (!prefs || !state || !state.onboarded) return;
  const value = JSON.stringify(snapshot());
  if (value === last) return;
  last = value;
  await prefs.set({ key: "waqti_widget", value });
}
