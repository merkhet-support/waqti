// Backup export. In the phone app, the file goes to the system share sheet
// (Drive, iCloud Files, WhatsApp, email…) via @capacitor/filesystem + @capacitor/share;
// in the browser it downloads.

import { state } from "./store.js";
import { keyOf } from "./dates.js";

const Cap = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? window.Capacitor : null;

// A file you export may be sent around (WhatsApp, email…), so it leaves out this phone's private
// signing key: nobody holding the file can send requests as you. Restoring it creates a new key,
// and the people you share requests with are asked to allow you again once.
// (The automatic backup below keeps the key — it stays in your own iCloud / Google backup.)
// It also leaves out the Microsoft calendar sign-in (token and refresh token): whoever holds the file
// could otherwise read that calendar. After a restore, Microsoft calendars are connected again once.
export function exportable(s) {
  const cal = s.calendars ? Object.assign({}, s.calendars, { msgraph: Object.assign({}, s.calendars.msgraph, { token: null, refresh: null, expires: 0 }) }) : s.calendars;
  return Object.assign({}, s, { me: null, seenMessages: [], calendars: cal });
}

export async function exportBackup() {
  const json = JSON.stringify(exportable(state), null, 2);
  const name = "waqti-backup-" + keyOf(new Date()) + ".json";
  const c = Cap();
  const fs = c && c.Plugins && c.Plugins.Filesystem, share = c && c.Plugins && c.Plugins.Share;
  if (fs && share) {
    const res = await fs.writeFile({ path: name, data: json, directory: "CACHE", encoding: "utf8" });
    await share.share({ title: "Waqti backup", text: "Waqti backup " + keyOf(new Date()), files: [res.uri], dialogTitle: "Save your backup" });
    return "shared";
  }
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  // Not copied to the clipboard: other apps can read it, and the file holds private data.
  return "downloaded";
}

export function validBackup(data) {
  return !!(data && typeof data === "object" && Array.isArray(data.habits) && data.profile && data.settings);
}

/* ---------- automatic backup (phone app) ----------
 * A copy of everything is written to the app's own data folder at most every 6 hours.
 * That folder is part of the phone's normal backup — iCloud backup on iPhone, Google's
 * Android backup — so a new or reset phone restoring from backup brings Waqti back with no
 * account. The previous copy is kept as well, in case the latest one is cut off mid-write. */
// Apple doesn't allow data read from Apple Health to be stored in iCloud, and this file goes into the
// phone's iCloud backup. So the steps and workouts read from Health are left out: they're read again
// from Health after a restore. (The habits they ticked are kept.)
export function forPhoneBackup(s) {
  // Habits filled from Health keep which days were met (as the goal), not the step counts themselves.
  const habits = (s.habits || []).map(h => {
    if (!h.auto) return h;
    const history = {};
    Object.keys(h.history || {}).forEach(k => { const v = h.history[k]; if (v === "skip" || v === true) history[k] = v; else if (+v >= (+h.target || 1)) history[k] = +h.target || 1; });
    return Object.assign({}, h, { history });
  });
  const sleep = {};
  Object.keys(s.sleep || {}).forEach(k => { if (s.sleep[k] && s.sleep[k].src !== "health") sleep[k] = s.sleep[k]; });
  return Object.assign({}, s, { habits, sleep, health: Object.assign({}, s.health, { steps: {}, workouts: {}, lastSync: 0 }) });
}
const AUTO = "waqti-autobackup.json", PREV = "waqti-autobackup-prev.json", EVERY = 6 * 3600e3;
const FS = () => { const c = Cap(); return c && c.Plugins && c.Plugins.Filesystem; };
export const autoBackupAvailable = () => !!FS();

export async function autoBackup(force) {
  const fs = FS();
  if (!fs || !state || !state.onboarded || state.settings.autoBackup === false) return false;
  if (!force && state.meta.lastBackup && Date.now() - state.meta.lastBackup < EVERY) return false;
  try { await fs.copy({ from: AUTO, to: PREV, directory: "DATA", toDirectory: "DATA" }); } catch (e) { /* first backup */ }
  state.meta.lastBackup = Date.now();
  await fs.writeFile({ path: AUTO, data: JSON.stringify(forPhoneBackup(state)), directory: "DATA", encoding: "utf8" });
  return true;
}

/* ---------- the live copy (phone app) ----------
 * Phones can clear a web view's storage when space runs low. So after every change (debounced)
 * the phone app also writes the data to a file in its own folder. If the web storage comes back
 * empty, the restore offer finds this copy first. Like the backup, it leaves out Apple Health data,
 * which is read again from Health. */
const LIVE = "waqti-data.json";
let liveTimer = null;
export function mirrorToFile() {
  const fs = FS();
  if (!fs || !state || !state.onboarded) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    fs.writeFile({ path: LIVE, data: JSON.stringify(forPhoneBackup(Object.assign({}, state, { meta: Object.assign({}, state.meta, { lastBackup: Date.now() }) }))), directory: "DATA", encoding: "utf8" }).catch(() => {});
  }, 1500);
}

// On a fresh install, or when the web storage was cleared: is there a copy on the phone?
// The live copy is newest, then the 6-hourly backup and its previous version. Returns { data, savedAt } or null.
export async function findAutoBackup() {
  const fs = FS();
  if (!fs) return null;
  for (const path of [LIVE, AUTO, PREV]) {
    try {
      const r = await fs.readFile({ path, directory: "DATA", encoding: "utf8" });
      const data = JSON.parse(r.data);
      if (validBackup(data)) return { data, savedAt: (data.meta && data.meta.lastBackup) || null };
    } catch (e) { /* missing or damaged — try the older copy */ }
  }
  return null;
}
