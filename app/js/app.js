// Entry point: routing, tab bar, theme, service worker, reminders, and a
// once-a-minute tick that rolls the day over and refreshes countdowns.

import { load, state, onSave, setState, save } from "./store.js";
import { initLock } from "./lock.js";
import { startDemo } from "./demo.js";
import { keyOf, today, fmtDate, fromKey, addDays, daysBetween } from "./dates.js";
import { autoBackup, autoBackupAvailable, findAutoBackup, mirrorToFile } from "./backup.js";
import { progressLabel } from "./schedule.js";
import { toast } from "./util.js";
import { initNotifications, reschedule, handleAction } from "./notify.js";
import { updateWidgets } from "./widgets.js";
import { CONFIG } from "./config.js";
import { detectSounds } from "./sounds.js";
import { ui, on, initEvents, overlayOpen, closeOverlay, openOverlay } from "./ui/core.js";
import { viewToday, resetSelDay } from "./ui/today.js";
import { viewHabits } from "./ui/habits.js";
import { viewInsights } from "./ui/insights.js";
import { viewFaith } from "./ui/faith-view.js";
import { viewSettings } from "./ui/settings.js";
import { openEditor } from "./ui/editor.js";
import { startOnboarding } from "./ui/onboarding.js";
import "./ui/quit.js";
import { viewCalendar } from "./ui/calendar.js";
import { viewPlan } from "./ui/plan.js";
import { viewMe } from "./ui/me.js";
import { openTaskEditor } from "./ui/tasks-ui.js";
import { openConnections } from "./ui/connections.js";
import { openQuitEditor } from "./ui/quit.js";
import { openSheet, closeSheet } from "./ui/core.js";
import { syncAll } from "./calendars.js";
import * as health from "./health.js";
import { pruneTasks } from "./tasks.js";
import { setLang, detectLang } from "./i18n.js";
import { initErrors, report } from "./errors.js";
import { maybeShowWhatsNew } from "./ui/whats-new.js";
import { openAsk, handleCode } from "./ui/requests.js";
import "./ui/prayer-extras.js";
import { extractCode } from "./requests.js";
import { extractKey } from "./lists.js";
import { openLists } from "./ui/lists.js";
import "./ui/life.js";
import { isPublicWeb, viewDoor, demoBar } from "./ui/web-door.js";

const app = document.getElementById("app");
const hdr = document.getElementById("hdr");
const tabbar = document.getElementById("tabbar");

const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  calendar: '<path d="M3 10h18M7 3v3M17 3v3"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 14h2M14 14h2M8 17h2"/>',
  plan: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  habits: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  insights: '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>',
  faith: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'
};
const svg = n => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + "</svg>";

// Text size: "Match phone" follows the phone's accessibility text size (iOS Dynamic Type /
// Android font scale, via @capacitor/text-zoom); Large / Larger are fixed steps.
let phoneZoom = null;
function applyTextSize() {
  const pref = state && state.settings.textSize;
  let z = pref && pref !== "auto" ? +pref : (phoneZoom || 1);
  z = Math.min(1.6, Math.max(1, z || 1));
  document.body.style.zoom = z > 1.01 ? z : "";
  // Very large text (older users): layouts stack instead of squeezing side by side.
  document.body.classList.toggle("text-xl", z >= 1.4);
}
(function readPhoneZoom() {
  const tz = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.TextZoom;
  if (!tz) return;
  tz.getPreferred().then(r => { phoneZoom = r && r.value; tz.set({ value: 1 }).catch(() => {}); applyTextSize(); }).catch(() => {});
})();

function applyTheme() {
  applyTextSize();
  const t = state && state.settings.theme;
  if (t) document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f3f5f4";
}

// The same five tabs for everyone; Month lives under Plan, and Insights, Faith and Settings under Me.
const TAB_OF = { calendar: "plan", insights: "me", faith: "me", settings: "me" };
function renderTabs() {
  const tabs = [["today", "Today"], ["plan", "Plan"], ["add", ""], ["habits", "Habits"], ["me", "Me"]];
  const on = TAB_OF[state.view] || state.view;
  tabbar.hidden = false;
  tabbar.innerHTML = tabs.map(t => t[0] === "add"
    ? '<button class="fab" data-action="add" aria-label="Add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>'
    : '<button class="' + (on === t[0] ? "on" : "") + '" data-action="tab" data-id="' + t[0] + '" aria-label="' + t[1] + '"' + (on === t[0] ? ' aria-current="page"' : "") + ">" + svg(t[0]) + "<span>" + t[1] + "</span></button>").join("");
}

let lastDay = null, restoreChecked = false;
// The public website: demos only (see ui/web-door.js). Set once the demo, if any, has started.
const publicWeb = isPublicWeb();
let doorOnly = false;
function offerRestore(b) {
  const n = b.data.habits.filter(h => !h.archived).length;
  openOverlay(() => '<div class="ov-body ob center stack"><img src="icons/icon.svg" alt="" class="ob-logo" style="margin-inline:auto"><h1 class="ob-title">Welcome back</h1>' +
    '<div class="small muted"><span>We found your Waqti backup on this phone</span>' + (b.savedAt ? " · " + fmtDate(b.savedAt, { day: "numeric", month: "short", year: "numeric" }) : "") + "</div>" +
    '<div class="card pad small"><b class="tabnum">' + n + "</b> <span>habits</span> · <b class=\"tabnum\">" + (b.data.tasks || []).length + "</b> <span>tasks</span></div>" +
    '<button class="btn" data-action="restore-auto">Restore my data</button><button class="btn ghost" data-action="restore-skip">Start fresh</button></div>', { form: { b } });
}
on("restore-auto", () => { const d = ui.form.b.data; closeOverlay({ all: true }); setState(Object.assign(d, { onboarded: true })); setLang(detectLang(state.settings.lang)); render(); toast("Welcome back — everything is restored 🌱"); });
on("restore-skip", () => { closeOverlay({ all: true }); startOnboarding(); });
function render() {
  applyTheme();
  if (doorOnly) { hdr.hidden = true; tabbar.hidden = true; viewDoor(app); return; }
  if (!state || !state.onboarded) {
    hdr.hidden = true; tabbar.hidden = true; app.innerHTML = "";
    if (overlayOpen()) return;
    // Fresh install on a phone restored from iCloud / Google backup: offer Waqti's own copy first.
    if (!restoreChecked && autoBackupAvailable()) {
      restoreChecked = true;
      findAutoBackup().then(b => { if (b && (!state || !state.onboarded)) offerRestore(b); else startOnboarding(); }).catch(() => startOnboarding());
      return;
    }
    startOnboarding();
    return;
  }
  hdr.hidden = false;
  lastDay = keyOf(today());
  const v = state.view || "today";
  if (v === "habits") viewHabits(app);
  else if (v === "insights") viewInsights(app);
  else if (v === "faith") viewFaith(app);
  else if (v === "settings") viewSettings(app);
  else if (v === "calendar") viewCalendar(app);
  else if (v === "plan") viewPlan(app);
  else if (v === "me") viewMe(app);
  else viewToday(app);
  // Pages inside Me get a way back to it.
  if (TAB_OF[v] === "me") app.insertAdjacentHTML("afterbegin", '<button class="link back-me" data-action="tab" data-id="me">‹ <span>Me</span></button>');
  if (publicWeb) app.insertAdjacentHTML("afterbegin", demoBar());
  renderTabs();
}
ui.render = render;

on("tab", id => {
  if (overlayOpen()) closeOverlay({ all: true });
  if (id === "today" && state.view === "today") resetSelDay();
  state.view = id;
  render();
  window.scrollTo(0, 0);
});
// The + button: choose what to add.
on("add", () => {
  openSheet('<div class="sheet-head"><div class="sect-title">Add</div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    addItem("add-task", "📝", "Task", "Something to do today or on a set day — once") +
    addItem("add-ask", "📨", "Ask someone", "Send a request — they accept, change it, or say no") +
    addItem("add-list", "🛒", "Family list", "Groceries, home jobs — shared and private") +
    addItem("add-habit", "🔁", "Habit", "Something you repeat — daily, weekly, every few weeks…") +
    addItem("add-quit-sheet", "🚭", "Quit tracker", "Count days free of a bad habit") +
    addItem("open-packs", "📦", "Ready-made packs", "Car, bills, birthdays & dates, pets, period tracker") +
    addItem("add-calendar", "📅", "Connect a calendar", "Outlook / Teams, Google, iCloud") + "</div>");
});
function addItem(action, icon, title, desc) {
  return '<button class="li card" data-action="' + action + '" style="border-radius:14px"><span class="lic">' + icon + '</span><span class="grow"><span class="small bold" style="display:block">' + title + '</span><span class="tiny muted">' + desc + '</span></span><span class="chev">›</span></button>';
}
on("add-task", () => { closeSheet(); openTaskEditor(null, today()); });
on("add-ask", () => { closeSheet(); openAsk(); });
on("add-list", () => { closeSheet(); openLists(); });

// Request links: "#waqti=…" in the address (web), waqti:// or https links opened by the phone app,
// or pasted in Requests. Before setup is finished they wait until it is.
const PENDING = "waqti_pending_request";
function takeLink(url) {
  // From a home-screen widget: waqti://done?h=<habitId>&d=<day>
  const w = String(url || "").match(/^waqti:\/\/done\?(.*)$/);
  if (w) {
    const q = new URLSearchParams(w[1]);
    if (state && state.onboarded && q.get("h")) handleAction("done", q.get("h"), q.get("d"));
    return true;
  }
  const code = extractCode(url || "");
  if (!code) return false;
  if (!state || !state.onboarded) { try { localStorage.setItem(PENDING, url); } catch (e) { /* ignore */ } return true; }
  handleCode(code, extractKey(url)).catch(e => report(e, "request"));
  return true;
}
function checkLinks() {
  if (doorOnly) { render(); return; } // the door shows the link itself
  if (location.hash.includes("waqti=")) { const h = location.hash; history.replaceState(null, "", location.pathname + location.search); takeLink(h); }
  let pending = null;
  try { pending = localStorage.getItem(PENDING); } catch (e) { /* ignore */ }
  if (pending && state && state.onboarded) { try { localStorage.removeItem(PENDING); } catch (e) { /* ignore */ } takeLink(pending); }
}
window.addEventListener("hashchange", checkLinks);
window.addEventListener("waqti:setup-done", checkLinks); // fired by onboarding after "Hold to commit"
const capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
if (capApp && capApp.addListener) {
  capApp.addListener("appUrlOpen", e => takeLink(e && e.url));
  // Going to the background: refresh the backup so the phone's own backup has today's data.
  capApp.addListener("pause", () => { autoBackup(true).catch(() => {}); updateWidgets().catch(() => {}); });
}
on("add-habit", () => { closeSheet(); openEditor(null); });
on("add-quit-sheet", () => { closeSheet(); openQuitEditor(); });
on("add-calendar", () => { closeSheet(); openConnections(); });
on("close", () => closeOverlay());

// Save -> re-plan reminders (debounced so rapid taps don't thrash).
let planTimer = null;
onSave(() => {
  clearTimeout(planTimer);
  planTimer = setTimeout(() => { reschedule().catch(e => report(e, "reminders")); autoBackup().catch(e => report(e, "backup")); mirrorToFile(); updateWidgets().catch(e => report(e, "widgets")); }, 400);
});

// Tick: day rollover (at your day-start hour) and live countdowns.
setInterval(() => {
  if (!state || !state.onboarded || overlayOpen()) return;
  if (keyOf(today()) !== lastDay) { resetSelDay(); noteVisit(); reschedule(); updateWidgets().catch(() => {}); }
  const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (!typing && (state.view === "today" || state.view === "faith")) render();
  syncAll(false).then(ch => { if (ch && !typing && !overlayOpen()) render(); });
  health.sync(false).then(ch => { if (ch && !typing && !overlayOpen()) render(); });
}, 60000);

// Offline cache for the web/PWA only — the phone app already ships its files, and a
// service worker there could serve stale code after an app update.
const nativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (!nativeApp && !/[?&]demo=/.test(location.search) && "serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW", e));
}

if (/example\.com/.test(CONFIG.privacyUrl)) console.warn("Waqti: config.js → privacyUrl is still a placeholder. Host docs/privacy-policy.html before submitting to the stores (docs/RELEASE.md).");
initErrors();
initEvents();
try { load(); } catch (e) { report(e, "load"); }
const demo = startDemo(); // "?demo=…": an example person in memory only (screenshots, smoke test)
doorOnly = publicWeb && !demo;
// The website's welcome page has no saved settings: "?lang=ar" picks Arabic there.
setLang(detectLang((state && state.settings.lang) || (doorOnly && new URLSearchParams(location.search).get("lang"))));
// The Arabic dictionary arrives a moment after start: redraw and re-plan reminders in Arabic.
window.addEventListener("waqti:lang-ready", () => { if (!overlayOpen()) render(); reschedule().catch(() => {}); });
initLock();
initNotifications((kind, h) => {
  toast(kind === "done" ? "✓ " + h.name + " marked done" : kind === "plus" ? "✓ " + h.name + " · " + progressLabel(h, today()) : "⏰ Snoozed " + h.name + " for 10 min");
  if (!overlayOpen()) render();
});
if (state) { pruneTasks(); noteVisit(); }

// Back after 4+ days away? Today offers a gentle restart (see today.js → comebackCard).
function noteVisit() {
  if (!state || !state.onboarded) return;
  const tk = keyOf(today()), last = state.meta.lastOpen;
  if (last && last < tk) {
    const gap = daysBetween(fromKey(last), today()) - 1; // full days not opened
    if (gap >= 4) { state.meta.comeback = { from: keyOf(addDays(fromKey(last), 1)), to: keyOf(addDays(today(), -1)), days: gap }; state.meta.backAt = Date.now(); }
  }
  if (last !== tk) { state.meta.lastOpen = tk; save(); }
}
render();
const openedWithLink = location.hash.includes("waqti=");
checkLinks();
if (demo) demo.after();
else if (!openedWithLink && !doorOnly) maybeShowWhatsNew();
reschedule().catch(() => {});
detectSounds().then(() => reschedule()).catch(() => {}); // which reminder sounds are bundled (Adhan files switch on when added)
// Returning from Microsoft sign-in?
import("./msgraph.js").then(m => m.completeSignInIfReturning()).then(r => {
  if (!r) return;
  toast(r.message);
  if (r.ok) { state.view = "calendar"; render(); }
});
if (state && state.onboarded) {
  syncAll(false).then(ch => { if (ch && !overlayOpen()) render(); });
  health.sync(false).then(ch => { if (ch && !overlayOpen()) render(); });
}
