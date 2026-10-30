// "Calendars & apps": connect work calendars (Teams/Outlook, Google, iCloud,
// phone calendars), meeting reminders, and Apple Health / Health Connect.

import { state, save, newHabit } from "../store.js";
import { esc, toast } from "../util.js";
import { keyOf } from "../dates.js";
import { addSource, removeSource, syncSource, importIcsText, isNative, hasDeviceCalendar } from "../calendars.js";
import * as health from "../health.js";
import { on, ui, openOverlay, rerenderOverlay } from "./core.js";
import { ovHead, selectEl } from "./components.js";

const KIND = { device: "📱 Phone calendar", msgraph: "🟦 Microsoft 365", "ics-url": "🔗 Calendar link", "ics-file": "📄 Imported file" };

function ago(ms) {
  if (!ms) return "never";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
}

// push = open on top of another screen (e.g. onboarding) and return to it on "Done".
export function openConnections(section, push) {
  const f = { add: null, ics: { name: "", url: "" }, graph: { clientId: state.calendars.msgraph.clientId, tenant: state.calendars.msgraph.tenant }, busy: false, healthOk: null, section };
  openOverlay(render, { form: f, push: !!push });
  health.available().then(ok => { if (ui.form === f) { f.healthOk = ok; rerenderOverlay(); } });
  if (section === "health") setTimeout(() => { const el = document.getElementById("conn-health"); if (el) el.scrollIntoView(); }, 60);
}

function sourceRow(s) {
  const n = (state.calendars.events[s.id] || []).length;
  return '<div class="li" style="align-items:flex-start"><span class="cal-swatch" style="background:' + s.color + '"></span><span class="grow"><span class="small bold" style="display:block">' + esc(s.name || KIND[s.kind]) + "</span>" +
    '<span class="tiny muted" style="display:block">' + KIND[s.kind] + " · " + n + " events · synced " + ago(s.lastSync) + "</span>" +
    (s.error ? '<span class="tiny" style="color:var(--danger);display:block">' + esc(s.error) + "</span>" : "") +
    '<span class="row" style="gap:6px;margin-top:6px">' + (s.kind !== "ics-file" ? '<button class="btn xs soft" data-action="conn-sync" data-id="' + s.id + '">Sync now</button>' : "") +
    '<button class="btn xs sec" data-action="conn-remove" data-id="' + s.id + '">Remove</button></span></span>' +
    '<label class="switch"><input type="checkbox" data-action="conn-toggle" data-id="' + s.id + '"' + (s.enabled ? " checked" : "") + "><span></span></label></div>";
}

function render() {
  const f = ui.form, g = state.calendars.msgraph;
  let h = ovHead('<button class="link" data-action="close">Done</button>', "Calendars & apps", "") + '<div class="ov-body">';

  h += '<div class="section"><div class="eyebrow">Your calendars</div>';
  h += state.calendars.sources.length ? '<div class="list">' + state.calendars.sources.map(sourceRow).join("") + "</div>" : '<div class="hint">Nothing connected yet. Meetings from these calendars appear on Today and in Calendar, with a Join button for Teams, Zoom and Meet.</div>';
  h += "</div>";

  h += '<div class="section"><div class="eyebrow">Add a calendar</div><div class="options">' +
    opt("device", "📱", "Phone calendars", isNative() ? "Every account on your phone — work Outlook/Teams, Google, iCloud" : "In the Android/iOS app", !isNative()) +
    (isNative() ? "" : opt("msgraph", "🟦", "Microsoft 365 / Teams", g.account ? "Signed in: " + esc(g.account) : "Sign in with your work account")) +
    opt("ics", "🔗", "Calendar link", "Outlook, Google or iCloud .ics link") +
    opt("file", "📄", "Import .ics file", "A one-time copy of a calendar") + "</div>";

  if (f.add === "device") {
    h += '<div class="card pad stack-sm">' + (hasDeviceCalendar()
      ? '<div class="small">Waqti will read (never change) the calendars on this phone. To include work meetings, add your work account in your phone\'s Settings → Mail/Calendar accounts (Outlook app on Android) first.</div><button class="btn sm" data-action="conn-device">Allow & connect</button>'
      : '<div class="warn">Phone calendars need the Android/iOS app build. In the browser, use Microsoft 365 sign-in or a calendar link.</div>') + "</div>";
  }
  if (f.add === "msgraph") {
    h += '<div class="card pad stack-sm"><div class="small bold">Connect Outlook & Teams meetings</div>' +
      (g.account ? '<div class="okbox">Signed in as ' + esc(g.account) + '</div><button class="btn sm sec" data-action="conn-ms-signout">Sign out</button>' : "") +
      '<div class="hint">Microsoft requires an app registration for your organisation (one-time, ~5 minutes — your IT admin may need to approve it):<br>1. portal.azure.com → App registrations → New registration<br>2. Platform: <b>Single-page application</b>, Redirect URI: <code class="sel">' + esc(location.origin + location.pathname) + "</code><br>3. API permissions → Microsoft Graph → Delegated → <b>Calendars.Read</b><br>4. Copy the <b>Application (client) ID</b> here.</div>" +
      '<div class="field"><label>Application (client) ID</label><input data-bind="graph.clientId" value="' + esc(f.graph.clientId) + '" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" spellcheck="false"></div>' +
      '<div class="field"><label>Account type</label>' + selectEl("graph.tenant", [["organizations", "Work or school account"], ["common", "Work, school or personal"], ["consumers", "Personal Outlook.com"]].concat(["organizations", "common", "consumers"].includes(f.graph.tenant) ? [] : [[f.graph.tenant, "Tenant " + f.graph.tenant]]), f.graph.tenant) + "</div>" +
      '<button class="btn sm" data-action="conn-ms-signin">Sign in with Microsoft</button>' +
      '<div class="hint">No admin access? Use <b>Calendar link</b> (if your company allows publishing) or the phone app\'s <b>Phone calendars</b> with your work account added to the phone.</div></div>';
  }
  if (f.add === "ics") {
    h += '<div class="card pad stack-sm"><div class="field"><label>Name</label><input data-bind="ics.name" value="' + esc(f.ics.name) + '" placeholder="e.g. Work"></div>' +
      '<div class="field"><label>Calendar link (.ics)</label><input data-bind="ics.url" value="' + esc(f.ics.url) + '" placeholder="https://… .ics" inputmode="url" autocomplete="off" spellcheck="false"></div>' +
      '<details class="hint"><summary class="small bold" style="cursor:pointer">Where do I find this link?</summary>' +
      '<p><b>Outlook / Microsoft 365 (Teams meetings):</b> Outlook on the web → Settings → Calendar → Shared calendars → Publish a calendar → choose your calendar and "Can view all details" → copy the <b>ICS</b> link.</p>' +
      '<p><b>Google Calendar:</b> calendar.google.com → Settings → your calendar → Integrate calendar → <b>Secret address in iCal format</b>.</p>' +
      '<p><b>iCloud:</b> Calendar app → share the calendar → Public Calendar → copy link.</p>' +
      '<p><b>Zoom:</b> Zoom meetings live in the calendar you schedule them in (Outlook or Google) — connect that calendar and Zoom links get a Join button.</p></details>' +
      '<div class="hint">Keep this link private — anyone with it can see your calendar. In the browser some providers block reading links; it always works in the phone app.</div>' +
      '<button class="btn sm" data-action="conn-ics"' + (f.busy ? " disabled" : "") + ">" + (f.busy ? "Connecting…" : "Add calendar") + "</button></div>";
  }
  if (f.add === "file") {
    h += '<div class="card pad stack-sm"><div class="small">Export a calendar as .ics (Outlook: File → Save calendar; Google: Settings → Import & export) and pick the file. This is a one-time copy — use a link to stay in sync.</div>' +
      '<label class="btn sm sec" style="cursor:pointer">Choose .ics file<input type="file" id="ics-file" accept=".ics,text/calendar" hidden></label></div>';
  }
  h += '<div class="card pad row" style="align-items:flex-start"><span class="emo" style="font-size:20px">🎥</span><div class="hint"><b>Zoom & Teams:</b> meetings from any connected calendar show with a <b>Join</b> button and a reminder before they start. Zoom doesn\'t offer a calendar connection apps can use without a server, so Zoom meetings come in through the calendar they\'re scheduled in.</div></div>';

  h += '<div class="card pad stack-sm"><div class="small bold">Meeting reminders</div><div class="inline"><span class="small">Notify me</span>' +
    '<select class="input sm" id="meet-remind" style="width:150px">' + [[0, "Off"], [5, "5 min before"], [10, "10 min before"], [15, "15 min before"], [30, "30 min before"]].map(o => '<option value="' + o[0] + '"' + (o[0] === state.calendars.meetingRemind ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></div></div>";

  // Health
  const hs = state.health;
  h += '<div class="section" id="conn-health"><div class="eyebrow">Health & fitness</div><div class="card pad stack-sm">';
  h += '<div class="row"><span class="emo" style="font-size:24px">❤️</span><div class="grow"><div class="small bold">' + health.platformName() + '</div><div class="hint">Steps and workouts — including from Fitbit, Garmin, Samsung Health, Strava and other apps that sync there.</div></div></div>';
  if (!isNative()) {
    h += '<div class="warn">Phones only let installed apps read health data, so this works in the Android/iOS app build. In the browser you can still log steps and workouts by hand.</div>';
  } else if (hs.connected) {
    h += '<div class="okbox">Connected · synced ' + ago(hs.lastSync) + (hs.steps[keyOf(new Date())] != null ? " · " + hs.steps[keyOf(new Date())].toLocaleString() + " steps today" : "") + "</div>" +
      (hs.error ? '<div class="tiny" style="color:var(--danger)">' + esc(hs.error) + "</div>" : "") +
      '<div class="row"><button class="btn xs soft" data-action="health-sync">Sync now</button><button class="btn xs sec" data-action="health-settings">Permissions</button><button class="btn xs sec" data-action="health-off">Disconnect</button></div>';
  } else {
    h += f.healthOk === false ? '<div class="warn">' + health.platformName() + " isn't available on this phone yet.</div>" : "";
    h += '<button class="btn sm" data-action="health-connect">Connect ' + health.platformName() + "</button>";
  }
  h += '<hr class="sep"><div class="small bold">Which habits fill in automatically?</div>' + linkRows() + "</div></div>";
  return h + "</div>";
}

function opt(id, icon, title, desc, disabled) {
  return '<button type="button" class="option' + (ui.form.add === id ? " on" : "") + '" data-action="conn-add" data-id="' + id + '"' + (disabled ? ' style="opacity:.6"' : "") + '><span class="oi">' + icon + '</span><span class="ot">' + title + '</span><span class="od">' + desc + "</span></button>";
}

function linkRows() {
  const habits = state.habits.filter(h => !h.archived);
  const steps = habits.find(h => h.auto && h.auto.source === "steps");
  const work = habits.find(h => h.auto && h.auto.source === "workout");
  const optsFor = list => [["", "— none —"]].concat(list.map(h => [h.id, h.emoji + " " + h.name]));
  return '<div class="field"><label>Daily steps go into</label><div class="row"><select class="input" id="link-steps">' + optsFor(habits.filter(h => h.type === "count")).map(o => '<option value="' + esc(o[0]) + '"' + (steps && steps.id === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select>" +
    (steps ? "" : '<button class="btn xs soft" data-action="health-make-steps" style="white-space:nowrap">+ Steps habit</button>') + "</div></div>" +
    '<div class="field"><label>Workouts complete</label><div class="row"><select class="input" id="link-workout">' + optsFor(habits).map(o => '<option value="' + esc(o[0]) + '"' + (work && work.id === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select>" +
    '<input class="input num" type="number" min="1" id="link-workout-min" value="' + ((work && work.auto.minMinutes) || 20) + '" aria-label="Minimum minutes"><span class="small">min</span></div></div>' +
    '<div class="hint">A habit marked this way is ticked off when your phone records it. You can always log by hand too.</div>';
}

/* ---------- actions ---------- */
on("open-connections", id => openConnections(id));
on("conn-add", id => { ui.form.add = ui.form.add === id ? null : id; rerenderOverlay(); });
on("conn-toggle", (id, el) => { const s = state.calendars.sources.find(x => x.id === id); if (s) { s.enabled = !s.enabled; save(); } setTimeout(rerenderOverlay, 0); });
on("conn-remove", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = "Tap to confirm"; return; }
  removeSource(id); save(); rerenderOverlay(); toast("Calendar removed");
});
on("conn-sync", async id => {
  const s = state.calendars.sources.find(x => x.id === id); if (!s) return;
  toast("Syncing…"); await syncSource(s); save(); rerenderOverlay();
  toast(s.error ? "Couldn't sync — see the message" : "Synced " + (state.calendars.events[s.id] || []).length + " events");
});
on("conn-device", async () => {
  const s = state.calendars.sources.find(x => x.kind === "device") || addSource("device", { name: "Phone calendars" });
  await syncSource(s); save(); ui.form.add = null; rerenderOverlay();
  toast(s.error ? s.error : "Phone calendars connected");
});
on("conn-ms-signin", async () => {
  const g = ui.form.graph;
  if (!/^[0-9a-f-]{36}$/i.test((g.clientId || "").trim())) { toast("Paste the Application (client) ID — it looks like 8-4-4-4-12 characters"); return; }
  state.calendars.msgraph.clientId = g.clientId.trim();
  state.calendars.msgraph.tenant = g.tenant || "organizations";
  save();
  try { await (await import("../msgraph.js")).startSignIn(); } catch (e) { toast(e.message); }
});
on("conn-ms-signout", async () => {
  (await import("../msgraph.js")).signOut();
  const s = state.calendars.sources.find(x => x.kind === "msgraph"); if (s) removeSource(s.id);
  save(); rerenderOverlay(); toast("Signed out of Microsoft");
});
on("conn-ics", async () => {
  const f = ui.form, url = (f.ics.url || "").trim();
  if (!/^(https?|webcal):\/\//i.test(url)) { toast("Paste a link that starts with https:// or webcal://"); return; }
  f.busy = true; rerenderOverlay();
  const s = addSource("ics-url", { name: (f.ics.name || "").trim() || "Calendar", url });
  await syncSource(s);
  f.busy = false;
  if (s.error) { removeSource(s.id); toast(s.error); rerenderOverlay(); return; }
  save(); f.add = null; f.ics = { name: "", url: "" }; rerenderOverlay();
  toast("Added " + (state.calendars.events[s.id] || []).length + " events");
});
on("health-connect", async () => { try { await health.connect(); toast("Connected — steps and workouts will sync"); } catch (e) { toast(e.message); } save(); rerenderOverlay(); });
on("health-sync", async () => { await health.sync(true); rerenderOverlay(); toast("Health data synced"); });
on("health-settings", () => health.openSettings());
on("health-off", () => { health.disconnect(); save(); rerenderOverlay(); });
on("health-make-steps", () => {
  const h = newHabit({ name: "Daily steps", emoji: "👟", category: "Fitness", type: "count", target: 8000, step: 1000, unit: "steps", auto: { source: "steps" } });
  state.habits.push(h); save(); rerenderOverlay(); toast("Steps habit added — goal 8,000");
});

// Inputs in this screen that save immediately.
document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "meet-remind") { state.calendars.meetingRemind = +el.value; save(); toast(+el.value ? "Meeting reminders on" : "Meeting reminders off"); }
  if (el.id === "ics-file" && el.files && el.files[0]) {
    const file = el.files[0], r = new FileReader();
    r.onload = () => { try { const n = importIcsText(file.name.replace(/\.ics$/i, ""), String(r.result)); toast("Imported " + n + " events"); if (ui.form) ui.form.add = null; rerenderOverlay(); } catch (err) { toast(err.message); } };
    r.readAsText(file);
  }
  if (el.id === "link-steps" || el.id === "link-workout" || el.id === "link-workout-min") {
    const src = el.id === "link-steps" ? "steps" : "workout";
    const sel = document.getElementById(src === "steps" ? "link-steps" : "link-workout");
    state.habits.forEach(h => { if (h.auto && h.auto.source === src) h.auto = null; });
    const h = state.habits.find(x => x.id === sel.value);
    if (h) h.auto = src === "steps" ? { source: "steps" } : { source: "workout", minMinutes: Math.max(1, +document.getElementById("link-workout-min").value || 20) };
    health.applyToHabits();
    save();
    if (el.id !== "link-workout-min") toast(h ? h.name + " will fill in automatically" : "Unlinked");
  }
});

