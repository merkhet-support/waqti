// App state: one JSON document in localStorage, with a memory fallback for
// private windows. Listeners run after every save (used to re-plan reminders).

import { keyOf, configureDates, today, habitDayOf } from "./dates.js";
import { uid, cleanEmoji } from "./util.js";
const safeId = x => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || uid();

// Storage keys keep the original "rafeeq_" prefix on purpose: renaming them would wipe existing users' data.
const KEY = "rafeeq_v2";
const LEGACY_KEY = "rafeeq_v1";
export const VERSION = 2;

let memory = null;
const listeners = [];

export let state = null;

export function defaultSettings() {
  return {
    dayStartHour: 3,
    weekStart: 6,
    theme: null,
    currency: "EGP",
    lang: null,
    streakMode: "forgiving",   // forgiving ("never miss twice") | strict
    textSize: "auto",          // auto (follow the phone) | 1 | 1.15 | 1.3
    autoBackup: true,
    notify: {
      enabled: false,
      quiet: { on: true, from: "23:00", to: "06:30" },
      faithInQuiet: true,
      sleepPrayers: "smart",   // smart | ring | wake — see notify.js
      morning: { on: true, time: "07:00" },
      evening: { on: true, time: "21:00" },
      weekly: { on: true },
      maxPerDay: 20,           // daily reminder limit (0 = no limit) — see notify.js → withinBudget
      bundle: true,            // habits due at the same minute arrive as one reminder — notify.js → bundleSameTime
      vibrate: true
    }
  };
}

export function defaultSchedule() {
  return {
    shift: "day",                 // day | evening | night | rotating | flexible | none
    workStart: "09:00",
    workEnd: "17:00",
    workDays: [0, 1, 2, 3, 4],    // Sun–Thu (Egypt). Ignored for rotating.
    rotation: { on: 4, off: 4, anchor: keyOf(today()) },
    sleep: {
      work: { bed: "23:00", wake: "06:30" },
      off: { bed: "00:00", wake: "08:00" },
      sameOnOff: false
    }
  };
}

export function blankState() {
  return {
    version: VERSION,
    onboarded: false,
    view: "today",
    waitlist: false,
    settings: defaultSettings(),
    profile: { name: "", schedule: defaultSchedule(), faith: { religion: null }, goals: [], committedAt: null },
    habits: [],
    quits: [],
    tasks: [],
    calendars: defaultCalendars(),
    health: defaultHealth(),
    recentEmoji: [],
    reviewSeen: null,  // week key of the last weekly review opened or dismissed
    me: null,          // this phone's id + signing key for requests (requests.js)
    contacts: [],      // people you allow (or block) requests from
    requests: [],      // sent and received requests
    seenMessages: [],
    restDays: [],      // whole-day rests ("YYYY-MM-DD"), 1 a month free, 4 with Pro
    repairs: [],       // days a streak repair was used (Pro, 1 a month); the mended days live on each habit's `repaired`
    pauses: [],        // { from, to, reason: "sick" | "travel" } — no reminders, streaks kept
    excused: [],       // { from, to } — excused from prayers and fasts (free), see schedule.js → excusable
    vehicles: [],      // { id, name, odo, odoAt } — car maintenance habits link here by h.car.vid
    cycle: null,       // period tracker (cycle.js), off until set up
    moods: {},         // "YYYY-MM-DD" -> 1 (low) | 2 (okay) | 3 (good)
    lists: [],         // shared family lists (lists.js)
    circle: null,      // family circle: { id, name, key } — end-to-end key, see circle.js
    meta: { firstOpen: null, ratedAt: null, askedRateAt: null, lastBackup: null }
  };
}

function read(key) {
  let r = null;
  try { r = localStorage.getItem(key); } catch (e) { return null; /* storage blocked */ }
  if (!r) return null;
  try { return JSON.parse(r); } catch (e) {
    // Never lose data to a bad save: park the unreadable copy before starting fresh.
    try { localStorage.setItem(key + "_corrupt_" + Date.now(), r); } catch (e2) { /* ignore */ }
    return null;
  }
}

export function load() {
  let s = read(KEY) || memory;
  if (!s) {
    const legacy = read(LEGACY_KEY);
    if (legacy && legacy.onboarded) s = migrateV1(legacy);
  }
  state = s ? normalize(s) : null;
  applyDateConfig();
  return state;
}

export function setState(s) {
  state = s ? normalize(s) : null;
  applyDateConfig();
  save();
}

// Tests only: swap in an in-memory state without touching storage or listeners.
// Tests and simulations run on their own state and must never write it over the real saved data
// (a test that ticked "Done all" once saved its test habits over the app's data in the dev browser).
let testing = false;
export function __useTestState(s) {
  testing = true;
  state = normalize(s);
  applyDateConfig();
  return state;
}

export function save() {
  if (state && !testing) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); memory = null; } catch (e) { memory = state; }
  }
  applyDateConfig();
  listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
}

export function onSave(fn) { listeners.push(fn); }

export function resetAll() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
  memory = null;
  state = null;
}

function applyDateConfig() {
  if (!state) return;
  configureDates({ dayStartHour: state.settings.dayStartHour, weekStart: state.settings.weekStart });
}

// Fill in anything missing so older/partial data never crashes the UI.
function normalize(s) {
  const base = blankState();
  s.version = VERSION;
  s.settings = Object.assign(base.settings, s.settings || {});
  const savedNotify = (s.settings && s.settings.notify) || {};
  s.settings.notify = Object.assign(defaultSettings().notify, savedNotify);
  if (!savedNotify.sleepPrayers && savedNotify.faithInQuiet === false) s.settings.notify.sleepPrayers = "wake";
  // Quiet hours now follow each day's sleep. Anyone who had set their own times keeps them.
  const q = s.settings.notify.quiet, ws = s.profile && s.profile.schedule && s.profile.schedule.sleep && s.profile.schedule.sleep.work;
  if (q && q.follow === undefined) q.follow = !ws || (q.from === ws.bed && q.to === ws.wake);
  s.profile = Object.assign(base.profile, s.profile || {});
  s.profile.schedule = Object.assign(defaultSchedule(), s.profile.schedule || {});
  s.profile.schedule.sleep = Object.assign(defaultSchedule().sleep, s.profile.schedule.sleep || {});
  s.profile.faith = s.profile.faith || { religion: null };
  s.habits = (s.habits || []).map(normalizeHabit);
  s.quits = (s.quits || []).map(q => Object.assign({ emoji: "🚭", slips: [], perDay: null, why: "" }, q));
  s.recentEmoji = s.recentEmoji || [];
  s.tasks = (s.tasks || []).map(t => Object.assign({ emoji: "", time: "", duration: 0, notes: "", priority: "normal", done: false, doneAt: null, remind: null, carry: true }, t));
  s.calendars = Object.assign(defaultCalendars(), s.calendars || {});
  s.calendars.msgraph = Object.assign(defaultCalendars().msgraph, s.calendars.msgraph || {});
  s.health = Object.assign(defaultHealth(), s.health || {});
  s.contacts = s.contacts || [];
  s.requests = s.requests || [];
  s.seenMessages = s.seenMessages || [];
  s.restDays = s.restDays || [];
  s.repairs = s.repairs || [];
  s.excused = s.excused || [];
  s.vehicles = s.vehicles || [];
  s.cycle = Object.assign({ on: false, starts: [], ends: {}, remind: 2, autoExcuse: true }, s.cycle || {});
  s.pauses = s.pauses || [];
  s.moods = s.moods || {};
  s.lists = s.lists || [];
  // Anything that's put into the page's markup unescaped (emoji, colours, ids) is cleaned here, on every
  // load — so an imported backup file or an old save can't carry markup in. See util.js → cleanEmoji.
  s.lists.forEach(l => { l.emoji = cleanEmoji(l.emoji) || "🛒"; l.id = safeId(l.id); });
  s.requests.forEach(r => { if (r.task) r.task.emoji = cleanEmoji(r.task.emoji); r.id = safeId(r.id); if (r.taskId) r.taskId = safeId(r.taskId); if (r.habitId) r.habitId = safeId(r.habitId); if (r.from) r.from.id = safeId(r.from.id); });
  s.habits.forEach(h => {
    h.id = safeId(h.id); h.emoji = cleanEmoji(h.emoji) || (h.requestId ? "📌" : "✅");
    if (h.color && !/^#[0-9a-fA-F]{3,8}$/.test(h.color)) h.color = null;
    if (h.requestId) h.requestId = safeId(h.requestId);
    if (h.car) h.car.vid = safeId(h.car.vid);
  });
  s.quits.forEach(q => { q.id = safeId(q.id); q.emoji = cleanEmoji(q.emoji) || "🚭"; });
  s.tasks.forEach(t => { t.id = safeId(t.id); t.emoji = cleanEmoji(t.emoji); });
  (s.vehicles || []).forEach(v => { v.id = safeId(v.id); });
  (s.contacts || []).forEach(c => { c.id = safeId(c.id); });
  s.circle = s.circle || null;
  s.meta = Object.assign({ firstOpen: Date.now(), ratedAt: null, askedRateAt: null, lastBackup: null }, s.meta || {});
  return s;
}

export function defaultCalendars() {
  return {
    sources: [],          // { id, kind: device|msgraph|ics-url|ics-file, name, url, color, enabled, lastSync, error }
    events: {},           // sourceId -> [{ id, title, start, end, allDay, location, join, provider }]
    meetingRemind: 10,    // minutes before a meeting (0 = off)
    msgraph: { clientId: "", tenant: "organizations", token: null, refresh: null, expires: 0, account: "" }
  };
}

export function defaultHealth() {
  return { connected: false, steps: {}, workouts: {}, lastSync: 0, error: "" };
}

export function newHabit(over) {
  return normalizeHabit(Object.assign({
    id: uid(),
    name: "",
    emoji: "✅",
    category: "Daily Rhythm",
    type: "check",
    target: 1,
    unit: "",
    schedule: { kind: "daily", days: [], n: 2, perWeek: 3, monthDay: 1, onlyOn: "any", start: keyOf(today()) },
    reminders: { on: false, mode: "times", times: ["08:00"], interval: { every: 120, from: "09:00", to: "21:00" }, anchor: "wake", offset: 0, prayer: "fajr", offsets: [0], nag: 0 },
    notes: "",
    history: {},
    archived: false,
    source: null,
    createdAt: Date.now()
  }, over || {}));
}

function normalizeHabit(h) {
  const d = {
    type: "check", target: 1, step: 1, unit: "", notes: "", history: {}, pastSchedules: [], color: null, archived: false, source: null, auto: null, category: "Daily Rhythm", emoji: "✅"
  };
  h = Object.assign(d, h);
  h.schedule = Object.assign({ kind: "daily", days: [], n: 2, perWeek: 3, monthDay: 1, onlyOn: "any", start: keyOf(habitDayOf(h.createdAt || Date.now())) }, h.schedule || {});
  h.reminders = Object.assign({ on: false, mode: "times", times: ["08:00"], interval: { every: 120, from: "09:00", to: "21:00" }, anchor: "wake", offset: 0, prayer: "fajr", offsets: [0], nag: 0 }, h.reminders || {});
  h.reminders.interval = Object.assign({ every: 120, from: "09:00", to: "21:00" }, h.reminders.interval || {});
  if (!Array.isArray(h.reminders.times)) h.reminders.times = [];
  if (h.type === "check") { h.target = 1; h.step = 1; }
  h.step = Math.max(1, +h.step || 1);
  return h;
}

// v1 (single-file prototype) -> v2
function migrateV1(v1) {
  const s = blankState();
  s.onboarded = true;
  s.waitlist = !!v1.waitlist;
  s.settings.theme = v1.theme || null;
  s.profile.name = (v1.profile && v1.profile.name) || "";
  if (v1.profile && v1.profile.wake) s.profile.schedule.sleep.work.wake = v1.profile.wake;
  if (v1.profile && v1.profile.faith) s.profile.faith = { religion: v1.profile.faith };
  s.habits = (v1.habits || []).map(h => {
    const created = new Date(h.createdAt || Date.now());
    const r = h.repeat || { type: "daily" };
    const sch = { start: keyOf(created) };
    if (r.type === "weekdays") Object.assign(sch, { kind: "days", days: [1, 2, 3, 4, 5] });
    else if (r.type === "weekly") Object.assign(sch, { kind: "days", days: [created.getDay()] });
    else if (r.type === "everyX" && r.unit === "weeks") Object.assign(sch, { kind: "weeks", days: [created.getDay()], n: r.n || 1 });
    else if (r.type === "everyX") Object.assign(sch, { kind: "interval", n: r.n || 1 });
    else sch.kind = "daily";
    const target = h.target > 1 ? h.target : 1;
    return {
      id: h.id || uid(), name: h.name, emoji: h.emoji || "✅", category: h.category || "Daily Rhythm",
      type: target > 1 ? "count" : "check", target, unit: target > 1 ? "times" : "",
      schedule: sch,
      reminders: { on: !!h.time, mode: "times", times: h.time ? [h.time] : ["08:00"] },
      history: h.history || {}, createdAt: h.createdAt || Date.now()
    };
  });
  s.quits = (v1.quits || []).map(q => ({ id: q.id || uid(), name: q.name, emoji: "🚭", start: q.start, perDay: q.perDay, slips: [] }));
  return s;
}

export function findHabit(id) { return state.habits.find(h => h.id === id); }
export function findQuit(id) { return state.quits.find(q => q.id === id); }
export function activeHabits() { return state.habits.filter(h => !h.archived); }

export function rememberEmoji(e) {
  if (!e) return;
  state.recentEmoji = [e].concat(state.recentEmoji.filter(x => x !== e)).slice(0, 24);
}
