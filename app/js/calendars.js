// Calendar connections. Four ways in, so work meetings (Teams, Zoom) show
// up next to habits and tasks:
//   device   the phone's own calendars — includes Outlook/Exchange, Google and
//            iCloud accounts added on the phone (native app only)
//   msgraph  Microsoft 365 / Teams work account via Microsoft sign-in
//   ics-url  a calendar link (Outlook "publish calendar", Google secret address, iCloud)
//   ics-file a one-off .ics file import
// Zoom has no client-side calendar API; Zoom meetings arrive through the calendar
// they were scheduled in, and their links get a Join button.

import { state, save } from "./store.js";
import { uid } from "./util.js";
import { keyOf, startOfDay, addDays } from "./dates.js";
import { parseICS, meetingLink } from "./ics.js";

export const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#0891b2", "#65a30d"];
const BACK_DAYS = 30, AHEAD_DAYS = 120;

const Cap = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? window.Capacitor : null;
const devicePlugin = () => { const c = Cap(); return c && c.Plugins && (c.Plugins.CapacitorCalendar || c.Plugins.Calendar); };
export const isNative = () => !!Cap();
export const hasDeviceCalendar = () => !!devicePlugin();

export function sourceColor(id) { const s = state.calendars.sources.find(x => x.id === id); return s ? s.color : COLORS[0]; }

function nextColor() { return COLORS[state.calendars.sources.length % COLORS.length]; }

export function addSource(kind, extra) {
  const s = Object.assign({ id: uid(), kind, name: "", url: "", color: nextColor(), enabled: true, lastSync: 0, error: "" }, extra || {});
  state.calendars.sources.push(s);
  return s;
}

export function removeSource(id) {
  state.calendars.sources = state.calendars.sources.filter(s => s.id !== id);
  delete state.calendars.events[id];
  const src = state.calendars.sources;
  if (!src.some(s => s.kind === "msgraph")) Object.assign(state.calendars.msgraph, { token: null, refresh: null, expires: 0, account: "" });
}

/* ---------- reading events ---------- */
export function eventsOn(d) {
  const from = startOfDay(d).getTime(), to = addDays(d, 1).getTime();
  const out = [];
  for (const s of state.calendars.sources) {
    if (!s.enabled) continue;
    for (const e of state.calendars.events[s.id] || []) {
      if (e.allDay ? keyOf(e.start) === keyOf(d) || (e.start < to && e.end > from && e.end - e.start > 86400000) : (e.start < to && e.end > from)) out.push(Object.assign({ source: s.id, color: s.color }, e));
    }
  }
  return out.sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
}

export function hasEvents() { return state.calendars.sources.some(s => s.enabled); }

/* ---------- syncing ---------- */
const range = () => ({ from: addDays(new Date(), -BACK_DAYS), to: addDays(new Date(), AHEAD_DAYS) });

async function fetchText(url) {
  url = url.trim().replace(/^webcal:\/\//i, "https://");
  const c = Cap();
  if (c && c.Plugins && c.Plugins.CapacitorHttp) {
    const r = await c.Plugins.CapacitorHttp.get({ url, responseType: "text" });
    if (r.status >= 400) throw new Error("The calendar link returned an error (" + r.status + ").");
    return typeof r.data === "string" ? r.data : String(r.data);
  }
  let res;
  try { res = await fetch(url, { cache: "no-store" }); }
  catch (e) { throw new Error("The browser blocked this link (the calendar server doesn't allow web apps to read it). It works in the phone app, or import the .ics file instead."); }
  if (!res.ok) throw new Error("The calendar link returned an error (" + res.status + ").");
  return res.text();
}

async function syncIcsUrl(s) {
  const text = await fetchText(s.url);
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("That link didn't return a calendar (.ics).");
  const { from, to } = range();
  state.calendars.events[s.id] = parseICS(text, from, to);
}

export function importIcsText(name, text) {
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("That file isn't a calendar (.ics).");
  const s = addSource("ics-file", { name: name || "Imported calendar" });
  const { from, to } = range();
  state.calendars.events[s.id] = parseICS(text, from, to);
  s.lastSync = Date.now();
  save();
  return state.calendars.events[s.id].length;
}

async function syncDevice(s) {
  const p = devicePlugin();
  if (!p) throw new Error("Phone calendars are available in the Android/iOS app.");
  const call = async (names, arg) => { for (const n of names) if (typeof p[n] === "function") return p[n](arg); throw new Error("Calendar plugin method missing: " + names[0]); };
  // iOS only lets apps read events with full access; Android needs just READ_CALENDAR.
  const ios = Cap().getPlatform && Cap().getPlatform() === "ios";
  const perm = await call(ios ? ["requestFullCalendarAccess"] : ["requestReadOnlyCalendarAccess", "requestFullCalendarAccess"]).catch(() => null);
  if (!perm || perm.result !== "granted") throw new Error("Calendar access wasn't allowed. Turn it on in your phone's Settings → Waqti.");
  const { from, to } = range();
  // Plugin versions name the range differently (from/to, startDate/endDate): send both.
const res = await call(["listEventsInRange"], { startDate: from.getTime(), endDate: to.getTime(), from: from.getTime(), to: to.getTime() });
  const list = (res && (res.result || res.events)) || [];
  state.calendars.events[s.id] = list.map(e => {
    const st = typeof e.startDate === "number" ? e.startDate : Date.parse(e.startDate || e.start);
    const en = typeof e.endDate === "number" ? e.endDate : Date.parse(e.endDate || e.end) || st + 3600000;
    return Object.assign({ id: String(e.id || e.eventId || st), title: e.title || "(No title)", start: st, end: en, allDay: !!(e.isAllDay || e.allDay), location: e.location || "", notes: (e.description || e.notes || "").slice(0, 400), calendar: e.calendarTitle || e.calendarId || "" },
      meetingLink([e.url, e.location, e.description, e.notes].join(" ")));
  }).filter(e => !isNaN(e.start));
}

export async function syncSource(s) {
  try {
    if (s.kind === "ics-url") await syncIcsUrl(s);
    else if (s.kind === "device") await syncDevice(s);
    else if (s.kind === "msgraph") await (await import("./msgraph.js")).syncGraph(s);
    else return; // ics-file: static
    s.lastSync = Date.now();
    s.error = "";
  } catch (e) {
    s.error = e.message || String(e);
  }
}

let syncing = null;
export function syncAll(force) {
  if (syncing) return syncing;
  const due = state.calendars.sources.filter(s => s.enabled && s.kind !== "ics-file" && (force || Date.now() - (s.lastSync || 0) > 30 * 60000));
  if (!due.length) return Promise.resolve(false);
  syncing = Promise.all(due.map(syncSource)).then(() => { save(); syncing = null; return true; });
  return syncing;
}

export const PROVIDER = {
  teams: { label: "Join Teams", emoji: "🟣" },
  zoom: { label: "Join Zoom", emoji: "🔵" },
  meet: { label: "Join Meet", emoji: "🟢" },
  webex: { label: "Join Webex", emoji: "🟢" }
};
