// Settings: profile, work & sleep, faith, notifications, week/day options,
// appearance, data export/import, and Premium.

import { state, save, setState, resetAll } from "../store.js";
import { esc, deepClone, toast } from "../util.js";
import { fmtTime, fmtDate, keyOf, fromKey } from "../dates.js";
import { describeShift, hasWork } from "../routine.js";
import { religionLabel, faithCfg } from "../faith.js";
import { sleepPrayersField } from "./faith-form.js";
import { permission, requestPermission, deliveryNote, testNotification, upcoming, fmtWhen, platform, reschedule } from "../notify.js";
import { on, ui, openOverlay, closeOverlay, rerenderOverlay, closeSheet, openSheet } from "./core.js";
import { FREE, PRO } from "../pro.js";
import { lockOn, setPin, removeLock } from "../lock.js";
import { REGIONS, region } from "../occasions.js";
import { ovHead, toggleRow, selectEl } from "./components.js";
import { routineFields } from "./routine-form.js";
import "./faith-view.js";
import { CONFIG } from "../config.js";
import { isMedicine } from "../schedule.js";
import { exportBackup, validBackup, autoBackup, autoBackupAvailable } from "../backup.js";
import { diagnostics, clearErrors, recentErrors } from "../errors.js";
import { exactAlarmStatus, openExactAlarmSettings, heldBack24h } from "../notify.js";
import { setLang, currentLang, tr } from "../i18n.js";

let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; });

const li = (icon, title, val, action, id) =>
  '<button class="li" data-action="' + action + '"' + (id ? ' data-id="' + id + '"' : "") + '><span class="lic">' + icon + '</span><span class="grow small bold">' + title + '</span><span class="val ellipsis" style="max-width:48%">' + esc(val || "") + '</span><span class="chev">›</span></button>';

export function viewSettings(app) {
  const s = state.settings;
  document.getElementById("hdrTitle").textContent = "Settings";
  document.getElementById("hdrSub").textContent = "";
  let h = !CONFIG.showPremium ? "" : '<button class="card pad row" data-action="open-premium" style="text-align:left;font:inherit;width:100%"><span class="emo" style="font-size:26px">✨</span><span class="grow"><span class="eyebrow" style="color:var(--accent);display:block">Waqti Pro</span><span class="small bold">More rest days, sick & travel breaks, more lists</span></span><span class="faint">›</span></button>';

  h += '<div class="eyebrow">You</div><div class="list">' +
    li("👤", "Name", state.profile.name || "Add your name", "edit-profile") +
    li("🕐", "Work & sleep", describeShift(), "edit-schedule") +
    li("🤲", "Faith", religionLabel(state.profile.faith.religion), "faith-setup") +
    li("🔔", "Notifications", s.notify.enabled ? "On" : "Off", "open-notify") +
    li("🎵", "Reminder sounds", "", "open-sounds") +
    li("📅", "Calendars & apps", state.calendars.sources.length ? state.calendars.sources.length + " connected" : "Teams, Outlook, Google", "open-connections") +
    li("❤️", "Health & fitness", state.health.connected ? "Connected" : "Steps & workouts", "open-connections", "health") +
    li("📊", "Insights", "Your trends", "tab", "insights") + "</div>";

  h += '<div class="eyebrow">Preferences</div><div class="card pad stack">' +
    '<div class="stack-sm"><div class="small bold">Language</div>' + liveSeg("settings.lang", [["en", "English"], ["ar", "العربية"]], currentLang()) + "</div>" +
    '<div class="stack-sm"><div class="small bold">Week starts on</div>' + liveSeg("settings.weekStart", [[6, "Saturday"], [0, "Sunday"], [1, "Monday"]], s.weekStart) + "</div>" +
    '<div class="stack-sm"><div class="small bold">Appearance</div>' + liveSeg("settings.theme", [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]], s.theme || "auto") + "</div>" +
    '<div class="stack-sm"><div class="small bold">Text size</div>' + liveSeg("settings.textSize", [["auto", "Match phone"], ["1.15", "Large"], ["1.3", "Larger"], ["1.5", "Largest"]], s.textSize || "auto") + "</div>" +
    '<div class="stack-sm"><div class="small bold">Streaks</div>' + liveSeg("settings.streakMode", [["forgiving", "Never miss twice"], ["strict", "Strict"]], s.streakMode || "forgiving") +
    '<div class="hint">' + (s.streakMode === "strict" ? "Any missed day resets a streak." : "One missed day doesn't break a streak — two in a row do. Rest and sick days never count.") + "</div></div>" +
    '<div class="spread"><div class="small bold">Currency for savings</div><select class="input sm" data-live="settings.currency" style="width:120px">' +
    ["EGP", "SAR", "AED", "QAR", "KWD", "BHD", "OMR", "JOD", "USD", "EUR", "GBP", "CAD", "AUD", "MYR", "TRY"].map(c => '<option' + (c === s.currency ? " selected" : "") + ">" + c + "</option>").join("") + "</select></div>" +
    '<div class="spread"><div class="small bold">Region <span class="tiny muted">(Mother\'s &amp; Father\'s Day)</span></div><select class="input sm" data-live="settings.region" style="width:170px">' +
    REGIONS.map(([v, l]) => '<option value="' + v + '"' + (v === region() ? " selected" : "") + ">" + esc(tr(l)) + "</option>").join("") + "</select></div></div>";

  const lb = state.meta && state.meta.lastBackup;
  h += '<div class="eyebrow">Your data</div><div class="list">' +
    (autoBackupAvailable()
      ? '<div class="li"><span class="lic">☁️</span><span class="grow"><span class="small bold" style="display:block">Automatic backup</span><span class="tiny muted">' +
        (s.autoBackup === false ? "Off" : lb ? "Last saved " + fmtDate(lb, { weekday: "short", hour: "numeric", minute: "2-digit" }) + " · included in your phone's backup" : "Saved with your phone's backup (iCloud / Google)") + "</span></span>" + switchLive("settings.autoBackup", s.autoBackup !== false) + "</div>"
      : '<div class="li"><span class="lic">☁️</span><span class="grow"><span class="small bold" style="display:block">Automatic backup</span><span class="tiny muted">In the phone app. In the browser, export a backup now and then.</span></span></div>') +
    '<div class="li"><span class="lic">🔒</span><span class="grow"><span class="small bold" style="display:block">Lock with a PIN</span><span class="tiny muted">' + (lockOn() ? "On — asks after a minute away" : "Keeps a glance at your phone away from your logs") + '</span></span><button class="btn xs soft" data-action="lock-setup">' + (lockOn() ? "Turn off" : "Set up") + "</button></div>" +
    li("📤", "Export backup", "JSON file", "export-data") +
    '<label class="li" style="cursor:pointer"><span class="lic">📥</span><span class="grow small bold">Import backup</span><input type="file" accept="application/json,.json" id="import-file" hidden><span class="chev">›</span></label>' +
    (installPrompt ? li("📲", "Install Waqti on this device", "", "install-app") : "") + "</div>";
  h += '<div class="eyebrow">About</div><div class="list">' +
    '<button class="li" data-action="open-requests"><span class="lic">📨</span><span class="grow small bold">Requests & people</span><span class="val">' + ((state.requests || []).length || "") + '</span><span class="chev">›</span></button>' +
    '<button class="li" data-action="whats-new"><span class="lic">✨</span><span class="grow small bold">What\'s new</span><span class="chev">›</span></button>' +
    '<button class="li" data-action="open-about"><span class="lic"><img src="icons/icon.svg" alt="" class="li-logo"></span><span class="grow small bold">About Waqti</span><span class="val">Our story</span><span class="chev">›</span></button>' +
    '<a class="li" href="' + esc(CONFIG.privacyUrl) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="lic">🔒</span><span class="grow small bold">Privacy policy</span><span class="chev">›</span></a>' +
    '<a class="li" href="' + esc(CONFIG.termsUrl) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="lic">📄</span><span class="grow small bold">Terms of use</span><span class="chev">›</span></a>' +
    li("🛟", "Report a problem", recentErrors().length ? recentErrors().length + " error(s) logged" : "Copy app details", "report-problem") +
    '<div class="li"><span class="lic">✉️</span><span class="grow small bold">Support</span><span class="val" style="user-select:all">' + esc(CONFIG.supportEmail) + "</span></div></div>";
  h += '<button class="btn danger" data-action="reset">Reset all data</button>';
  h += '<div class="center tiny faint">Waqti ' + esc(CONFIG.version) + ' by Merkhet · your data is saved on this device only. ' + (autoBackupAvailable() && s.autoBackup !== false ? "It's included in your phone's backup.</div>" : "Export a backup before changing phones.</div>");
  app.innerHTML = h;
  const f = document.getElementById("import-file");
  if (f) f.addEventListener("change", importData);
}

function switchLive(path, on) {
  return '<label class="switch"><input type="checkbox" role="switch" aria-label="Automatic backup" data-live="' + path + '"' + (on ? " checked" : "") + "><span></span></label>";
}
function liveSeg(path, opts, cur) {
  return '<div class="seg" style="--cols:' + opts.length + '">' + opts.map(o => '<button type="button" class="' + (String(o[0]) === String(cur) ? "on" : "") + '" data-action="live-set" data-path="' + path + '" data-val="' + o[0] + '">' + o[1] + "</button>").join("") + "</div>";
}

on("live-set", (id, el) => {
  const path = el.dataset.path, raw = el.dataset.val;
  if (path === "settings.weekStart") state.settings.weekStart = +raw;
  if (path === "settings.theme") state.settings.theme = raw === "auto" ? null : raw;
  if (path === "settings.lang") { state.settings.lang = raw; setLang(raw); }
  if (path === "settings.streakMode") state.settings.streakMode = raw;
  if (path === "settings.textSize") state.settings.textSize = raw;
  save(); ui.render();
});
document.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset && el.dataset.live === "settings.currency") { state.settings.currency = el.value; save(); toast("Currency set to " + el.value); }
  if (el.dataset && el.dataset.live === "settings.autoBackup") {
    state.settings.autoBackup = el.checked; save();
    if (el.checked) autoBackup(true).then(() => ui.render()).catch(e => toast("Backup failed: " + (e.message || e)));
    else ui.render();
  }
});

/* ---------- profile ---------- */
on("edit-profile", () => {
  openOverlay(() => ovHead('<button class="link" data-action="close">Cancel</button>', "Profile", '<button class="link" data-action="save-profile">Save</button>') +
    '<div class="ov-body"><div class="field"><label>Your name</label><input data-bind="name" value="' + esc(ui.form.name) + '" placeholder="What should we call you?"></div><button class="btn" data-action="save-profile">Save</button></div>',
  { form: { name: state.profile.name } });
});
on("save-profile", () => { state.profile.name = (ui.form.name || "").trim(); save(); closeOverlay(); toast("Saved"); });

/* ---------- schedule ---------- */
on("edit-schedule", () => {
  openOverlay(() => ovHead('<button class="link" data-action="close">Cancel</button>', "Work & sleep", '<button class="link" data-action="save-schedule">Save</button>') +
    '<div class="ov-body"><div class="small muted">Wake-up, bedtime and “around my routine” reminders follow these times automatically.</div>' + routineFields("schedule", "dayStartHour") +
    '<button class="btn" data-action="save-schedule">Save</button></div>',
  { form: { schedule: deepClone(state.profile.schedule), dayStartHour: state.settings.dayStartHour } });
});
on("save-schedule", () => {
  const f = ui.form;
  if (f.schedule.shift !== "none" && f.schedule.shift !== "rotating" && !f.schedule.workDays.length) { toast("Pick your work days"); return; }
  state.profile.schedule = f.schedule;
  state.settings.dayStartHour = f.dayStartHour;
  save(); closeOverlay(); toast("Schedule updated — reminders adjusted");
});

/* ---------- notifications ---------- */
let permState = "default";
let exactState = "granted";
function renderNotify() {
  const n = ui.form;
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', "Notifications", '<button class="link" data-action="save-notify">Save</button>') + '<div class="ov-body">';
  h += '<div class="card pad stack-sm">' + toggleRow("Habit reminders", "enabled", n.enabled, "Master switch for all reminders");
  if (permState === "denied") h += '<div class="warn">Notifications are blocked for Waqti. Allow them in your phone or browser settings, then come back.</div>';
  else if (platform() === "unsupported") h += '<div class="warn">This browser can\'t show notifications.</div>';
  else if (n.enabled && permState !== "granted") h += '<button class="btn sm" data-action="notify-perm">🔔 Allow notifications</button>';
  h += '<div class="hint">' + esc(deliveryNote()) + "</div>";
  if (exactState === "prompt") h += '<div class="warn">Android may delay reminders by several minutes. For on-time prayer and task reminders, allow exact alarms.</div><button class="btn sm sec" data-action="notify-exact">Allow exact timing</button>';
  if (permState === "granted") h += '<button class="btn sec sm" data-action="notify-test">Send a test notification</button>';
  h += "</div>";

  h += '<div class="card pad stack-sm">' + toggleRow("Quiet hours", "quiet.on", n.quiet.on, "Hold reminders while you sleep");
  if (n.quiet.on) {
    // With work: quiet hours follow each day's sleep by default (days off differ); otherwise fixed times.
    const sl = state.profile.schedule.sleep, follow = hasWork() && n.quiet.follow !== false;
    if (hasWork()) h += toggleRow("Follow my sleep each day", "quiet.follow", follow, sl.sameOnOff ? tr("Work days {w}", { w: fmtTime(sl.work.bed) + "–" + fmtTime(sl.work.wake) }) : tr("Work days {w} · days off {o}", { w: fmtTime(sl.work.bed) + "–" + fmtTime(sl.work.wake), o: fmtTime(sl.off.bed) + "–" + fmtTime(sl.off.wake) }));
    if (!follow) h += '<div class="inline"><span class="small">From</span><input class="input time" type="time" data-bind="quiet.from" value="' + esc(n.quiet.from) + '"><span class="small">to</span><input class="input time" type="time" data-bind="quiet.to" value="' + esc(n.quiet.to) + '"></div>' +
      '<button type="button" class="chip" data-action="quiet-from-sleep" style="align-self:flex-start">Match my work-day sleep (' + fmtTime(sl.work.bed) + "–" + fmtTime(sl.work.wake) + ")</button>";
    if (state.profile.faith.religion === "muslim") h += sleepPrayersField("sleepPrayers", n.sleepPrayers, state.profile.schedule.sleep.work, faithCfg());
    else if (state.profile.faith.religion) h += toggleRow("Allow faith reminders in quiet hours", "faithInQuiet", n.faithInQuiet, "e.g. prayer times while you're asleep");
  }
  h += "</div>";

  h += '<div class="card pad stack-sm">' + toggleRow("Start-of-day plan", "morning.on", n.morning.on, "Shortly after you wake — what's on today");
  if (n.morning.on) h += '<div class="inline"><span class="small">at</span><input class="input time" type="time" data-bind="morning.time" value="' + esc(n.morning.time) + '"></div>';
  h += toggleRow("End-of-day check-in", "evening.on", n.evening.on, "Only if something is still open");
  if (n.evening.on) h += '<div class="inline"><span class="small">at</span><input class="input time" type="time" data-bind="evening.time" value="' + esc(n.evening.time) + '"></div>';
  h += toggleRow("Weekly review", "weekly.on", n.weekly.on, "First day of each week, 30 min after your start-of-day plan");
  h += toggleRow("Combine reminders due together", "bundle", n.bundle !== false, "e.g. three medicines at 8:00 arrive as one, with “Done all”");
  h += '<div class="spread"><div><div class="small bold">Daily reminder limit</div><div class="hint">Prayers, medicine, tasks and meetings always come through</div></div>' +
    selectEl("maxPerDay", [[10, "10"], [15, "15"], [20, "20"], [30, "30"], [0, "No limit"]], n.maxPerDay == null ? 20 : n.maxPerDay, ' data-num style="width:110px"') + "</div>";
  const held = heldBack24h();
  if (held) h += '<div class="hint">⏸️ <span class="tabnum">' + held + "</span> <span>lower-priority reminders are being held back in the next 24 hours. Raise the limit if you want them all.</span></div>";
  h += toggleRow("Vibrate", "vibrate", n.vibrate, "", false) + "</div>";

  const up = upcoming(8);
  h += '<div class="card pad stack-xs"><div class="small bold">Coming up</div>' + (n.enabled && state.settings.notify.enabled
    ? (up.length ? up.map(u => '<div class="spread small"><span class="ellipsis">' + esc(u.title) + '</span><span class="muted tabnum" style="white-space:nowrap">' + esc(fmtWhen(u.when)) + "</span></div>").join("") : '<div class="hint">Nothing in the next 48 hours.</div>')
    : '<div class="hint">Turn reminders on and save to see what\'s scheduled.</div>') +
    '<div class="hint" style="margin-top:6px">Each habit has its own reminder settings — open a habit and tap Edit.</div></div>';
  h += '<button class="btn" data-action="save-notify">Save</button>';
  return h + "</div>";
}

on("open-notify", async () => {
  permState = await permission();
  exactState = await exactAlarmStatus();
  const form = deepClone(state.settings.notify);
  if (!form.enabled && permState !== "denied") form.enabled = true;
  openOverlay(renderNotify, { form });
});
on("notify-perm", async () => { permState = await requestPermission(); rerenderOverlay(); if (permState === "granted") toast("Notifications allowed ✅"); });
on("notify-exact", async () => { await openExactAlarmSettings(); exactState = await exactAlarmStatus(); rerenderOverlay(); });
on("notify-test", () => { testNotification(); toast("Test sent — check your notifications"); });
on("quiet-from-sleep", () => { const w = state.profile.schedule.sleep.work; ui.form.quiet.from = w.bed; ui.form.quiet.to = w.wake; rerenderOverlay(); });
on("save-notify", async () => {
  const n = ui.form;
  if (n.enabled && permState !== "granted" && permState !== "unsupported") {
    permState = await requestPermission();
    if (permState !== "granted") { n.enabled = false; toast("Notifications weren't allowed — reminders stay off"); }
  }
  state.settings.notify = n;
  save(); closeOverlay();
  if (n.enabled) toast("Reminders on 🔔");
  reschedule();
});

/* ---------- data ---------- */
// The backup file holds everything, period dates and document expiry dates included: say so first.
on("export-data", () => {
  const sensitive = [(state.cycle && state.cycle.on) && tr("period dates"), state.habits.some(h => h.category === "Documents") && tr("document expiry dates"),
    state.habits.some(h => h.category === "Bills") && tr("bills and amounts"), (state.quits || []).length && tr("quit trackers"), state.habits.some(isMedicine) && tr("medicines")].filter(Boolean);
  openSheet('<div class="sheet-head"><div class="sect-title">📤 <span>Export backup</span></div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    '<div class="small">' + esc(tr("The file has everything in Waqti, so you can restore it on a new phone.")) + (sensitive.length ? " " + esc(tr("That includes {list}.", { list: sensitive.join(", ") })) : "") + "</div>" +
    '<div class="small muted">' + esc(tr("Keep it somewhere private, and don't send it to anyone.")) + "</div>" +
    '<button class="btn" data-action="export-go">Export</button><button class="btn ghost" data-action="close-sheet">Cancel</button></div>');
});
on("export-go", async () => {
  closeSheet();
  try {
    const r = await exportBackup();
    toast(r === "shared" ? "Backup ready" : r === "downloaded+copied" ? "Backup saved and copied to clipboard" : "Backup downloaded");
  } catch (e) { toast("Couldn't export: " + (e.message || e)); }
});
on("report-problem", async () => {
  const txt = diagnostics();
  try { await navigator.clipboard.writeText(txt); toast("App details copied — paste them in an email to " + CONFIG.supportEmail); clearErrors(); }
  catch (e) { toast("Email " + CONFIG.supportEmail + " and describe what happened"); }
});
function importData(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!validBackup(data)) throw new Error("bad");
      setState(Object.assign(data, { onboarded: true }));
      ui.render(); toast("Backup restored — " + data.habits.length + " habits");
    } catch (err) { toast("That file isn't a Waqti backup"); }
  };
  r.readAsText(file);
}
on("install-app", async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; ui.render(); });
on("reset", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = "Tap again to erase everything"; return; }
  resetAll(); ui.render(); toast("Everything reset");
});

/* ---------- about ---------- */
// The brand story (see docs/brand.md). One paragraph per element so each translates cleanly.
// The reader first, the merkhet second (marketing review): problem → who it's for → the name → the promise.
const STORY = [
  "Most apps think your day starts at 7 and ends at midnight. Yours might start at 7 in the evening. You might pray before dawn, fast with your church, or work four nights on and four off.",
  "Waqti is built for that day: your habits, tasks and prayers, on your clock.",
  "The name of our studio, Merkhet, comes from one of the oldest timekeeping tools we know. More than 3,000 years ago, Egyptian astronomers held a weighted line against the North Star to tell the hours of the night.",
  "People have always kept time by the sky — by the dawn, the sunset and the stars. We just put it in your pocket."
];
const ABOUT = [
  "We're Merkhet, a small studio. We build for people whose days don't follow the office clock: nurses, engineers, students, parents, and anyone who prays by the sun.",
  "We made Waqti because almost every habit app assumes a 9-to-5 day and a single calendar. Ours bends to your shifts, your sleep and your faith's year."
];
const PROMISES = [["🚫", "No ads, ever"], ["🔒", "We don't sell or share your data"], ["📱", "No account needed — your data stays on your phone"], ["🤲", "Prayer times, Qibla and fasting calendars stay free"], ["✉️", "A person reads every message"]];
on("open-about", () => {
  openOverlay(() => ovHead('<button class="link" data-action="close">Back</button>', "About Waqti", "") +
    '<div class="ov-body about">' +
    '<div class="center stack-sm"><img src="icons/icon.svg" alt="Waqti logo" class="about-logo">' +
    '<div class="ob-title" style="font-size:28px">Waqti</div><div class="small muted">by Merkhet</div>' +
    '<div class="sect-title" style="color:var(--accent)">Your day, on your clock.</div></div>' +
    '<div class="card pad stack-sm"><div class="eyebrow">Our story</div>' + STORY.map(p => "<p>" + p + "</p>").join("") + "</div>" +
    '<div class="card pad stack-sm"><div class="eyebrow">About us</div>' + ABOUT.map(p => "<p>" + p + "</p>").join("") + "</div>" +
    '<div class="card pad stack-sm"><div class="eyebrow">Our promises</div>' + PROMISES.map(([e, t]) => '<div class="row small"><span class="emo">' + e + "</span><span>" + t + "</span></div>").join("") + "</div>" +
    '<div class="list"><a class="li" href="' + esc(CONFIG.privacyUrl) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="lic">🔒</span><span class="grow small bold">Privacy policy</span><span class="chev">›</span></a>' +
    '<div class="li"><span class="lic">✉️</span><span class="grow small bold">Contact</span><span class="val" style="user-select:all">' + esc(CONFIG.supportEmail) + "</span></div></div>" +
    '<div class="center tiny faint">Waqti ' + esc(CONFIG.version) + " by Merkhet</div></div>",
  { form: null });
});

/* ---------- premium ---------- */
// Pro adds room and delight; worship, shifts and never-miss-twice streaks are always free. The
// limits in the table come from pro.js, so they can't drift from what the app enforces.
const TIERS = () => [
  ["💪", "Never miss twice", "✓", "✓"],
  ["😴", "Rest days a month", String(FREE.restDays), String(PRO.restDays)],
  ["🤒", "Sick & travel breaks", "–", "✓"],
  ["🩹", "Repair a broken streak", "–", "1 a month"],
  ["🛒", "Shared lists of your own", String(FREE.lists), "Unlimited"],
  ["👨‍👩‍👧", "People per list", String(FREE.members), "Unlimited"],
  ["🚗", "Cars", String(FREE.cars), "Unlimited"],
  ["🛂", "Family members' documents", "–", "✓"],
  ["🧾", "Bills history & send to family", "–", "✓"],
  ["🕌", "A sound for each prayer", "–", "✓"]
];
const SOON = [
  ["📊", "Year in review", "Your year at a glance and trends by category (the monthly look-back stays free)"],
  ["🎨", "Themes & app icons", "Colours and icons for your home screen"],
  ["🔄", "Family circle", "Lists and requests that sync by themselves, end-to-end encrypted"]
];
const ALWAYS_FREE = "Always free: all your habits and tasks, prayer times, Qibla, fasting calendars, shifts and rotations, quit trackers, and joining lists other people share with you.";
on("close-sheet", () => closeSheet());
on("pro-open", () => { closeSheet(); openPremium(); });
on("open-premium", () => openPremium());
function openPremium() {
  openOverlay(() => {
    let h = ovHead('<button class="link" data-action="close">Back</button>', "Waqti Pro", "") + '<div class="ov-body">';
    h += '<div class="card pad stack-xs"><div class="eyebrow" style="color:var(--accent)">Waqti Pro</div><div class="sect-title">Free vs Pro</div><div class="small muted">' + ALWAYS_FREE + "</div></div>";
    h += '<div class="card tiers"><div class="tier-row tier-head"><span></span><span>Free</span><span>Pro</span></div>' +
      TIERS().map(r => '<div class="tier-row"><span class="small"><span class="emo">' + r[0] + "</span> <span>" + r[1] + '</span></span><span class="tabnum">' + r[2] + '</span><span class="tabnum bold">' + r[3] + "</span></div>").join("") + "</div>";
    // Paying users panel: the payment screen shows only what Pro does today (stores reject paywalls that
    // advertise features that don't exist yet). SOON stays listed here for when each one ships.
    if (CONFIG.showComingSoon) h += '<div class="eyebrow">Coming to Pro</div><div class="stack-sm">' + SOON.map(f => '<div class="feat"><div class="fi">' + f[0] + '</div><div class="grow"><div class="small bold">' + f[1] + '</div><div class="tiny muted">' + f[2] + '</div></div><span class="badge soon">Soon</span></div>').join("") + "</div>";
    // Launch offer with a real end date (the stores' introductory pricing); lifetime is sold only until then.
    const ends = CONFIG.launchOfferEnds, launch = ends && keyOf(new Date()) <= ends, endTxt = ends ? fmtDate(fromKey(ends), { day: "numeric", month: "long", year: "numeric" }) : "";
    if (launch) h += '<div class="card pad row" style="gap:8px;background:var(--amber-soft);border-color:var(--amber-line)"><span class="emo" style="font-size:17px">🔥</span><span class="small" style="color:var(--amber)"><strong>Launch prices</strong> <span>until</span> ' + esc(endTxt) + ".</span></div>";
    h += '<div class="stack-sm"><div class="pricebtn feat-plan"><span><div class="bold">Yearly · best value</div><div class="tiny" style="color:var(--accent-ink)">33 EGP/mo · save 63%</div></span><span style="text-align:right"><div style="font-weight:800">399 EGP</div></span></div>' +
      '<div class="row" style="gap:10px"><div class="pricebtn"><span><div class="bold">Monthly</div><div class="tiny muted">per month</div></span><span style="font-weight:800">89 EGP</span></div>' +
      (launch ? '<div class="pricebtn"><span><div class="bold">Lifetime</div><div class="tiny muted">once · launch only</div></span><span style="font-weight:800">1,299</span></div>' : "") + "</div></div>";
    // No sign-up form: interested people email us, so nothing is sent from the phone on its own.
    // Store rule for subscriptions: the terms and privacy policy are one tap away from the prices.
    // Paying users panel: cancelling or changing a plan must be one tap away (the stores' own pages).
    const ios = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === "ios";
    const manage = ios ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions";
    // Auto-renewal law (e.g. California): price, how often, that it renews, and how to cancel, right by the buttons.
    h += '<div class="center tiny muted">Monthly and yearly Pro renew automatically at the price shown, every month or every year, until you cancel. Cancel any time in your store account, at least 24 hours before the renewal date. Lifetime is a one-time payment. <a href="' + manage + '" target="_blank" rel="noopener">Manage subscription</a> · <a href="' + esc(CONFIG.termsUrl) + '" target="_blank" rel="noopener">Terms of use</a> · <a href="' + esc(CONFIG.privacyUrl) + '" target="_blank" rel="noopener">Privacy policy</a></div>';
    h += '<div class="card pad center stack-sm"><div class="small muted">Payments open soon, through the App Store or Google Play. Want to hear when Pro opens? Email us:</div>' +
      '<div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap"><b data-no-tr style="user-select:all">' + esc(CONFIG.supportEmail) + '</b><button class="btn xs soft" data-action="copy-email">Copy</button></div></div>';
    return h + "</div>";
  }, { form: null });
}
/* ---------- PIN lock ---------- */
on("lock-setup", () => {
  if (lockOn()) { removeLock(); toast("Lock turned off"); ui.render(); return; }
  openSheet('<div class="sheet-head"><div class="sect-title">🔒 <span>Lock Waqti with a PIN</span></div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    '<div class="small muted">Waqti asks for it when you open the app, and after a minute away. If you forget it, you can turn the lock off after a 60-second wait — your data is never lost.</div>' +
    '<input id="pin-1" class="input" type="password" inputmode="numeric" maxlength="8" placeholder="New PIN (4–8 digits)" aria-label="New PIN" autocomplete="off">' +
    '<input id="pin-2" class="input" type="password" inputmode="numeric" maxlength="8" placeholder="Type it again" aria-label="Repeat PIN" autocomplete="off">' +
    '<button class="btn" data-action="lock-save">Turn on the lock</button></div>');
});
on("lock-save", async (id, el) => {
  const s = el.closest("#sheet"), a = s.querySelector("#pin-1").value, b = s.querySelector("#pin-2").value;
  if (!/^\d{4,8}$/.test(a)) { toast("Use 4 to 8 digits"); return; }
  if (a !== b) { toast("The two PINs don't match"); return; }
  await setPin(a); closeSheet(); toast("Lock is on 🔒"); ui.render();
});
on("copy-email", async () => {
  try { await navigator.clipboard.writeText(CONFIG.supportEmail); toast("Email address copied"); } catch (e) { toast(CONFIG.supportEmail); }
});

