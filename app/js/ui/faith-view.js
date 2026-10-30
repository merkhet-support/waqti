// Faith tab: today's prayer times with countdown, prayer/practice check-offs,
// this week's tally, Ramadan status, and the detailed setup.

import { activeHabits, save } from "../store.js";
import { esc, deepClone, toast } from "../util.js";
import { today, addDays, startOfWeek, fmtTime, fmtDuration, fmtDate, momentFor } from "../dates.js";
import { PRAYERS, METHODS } from "../prayer.js";
import { faithCfg, prayerMinutes, sunMinutes, applyFaith, religionLabel, travelOn, prayerLocation } from "../faith.js";
import { hijriLabel, daysToRamadan, hijri } from "../hijri.js";
import { isScheduled, isDone, nextDue } from "../schedule.js";
import { on, openOverlay, closeOverlay, ui } from "./core.js";
import { ovHead, emptyCard } from "./components.js";
import { faithFields } from "./faith-form.js";
import { habitRow } from "./today.js";
import { qiblaBearing, compassPoint } from "../qibla.js";
import { fastingCalendar } from "../fasting.js";
import { CONFIG } from "../config.js";
import { dateRange } from "./faith-form.js";
import { keyOf, daysBetween } from "../dates.js";
import { soundFor } from "../sounds.js";
import "./prayer-extras.js";

export function viewFaith(app) {
  const cfg = faithCfg();
  const t = today();
  document.getElementById("hdrTitle").textContent = "Faith";
  document.getElementById("hdrSub").textContent = cfg.religion === "muslim" ? (hijriLabel(t) || religionLabel(cfg.religion)) : religionLabel(cfg.religion, cfg.other.tradition);
  if (!cfg.religion) {
    app.innerHTML = emptyCard("🤲", "Faith reminders are off", "Set up prayers, reading, fasting or your own practice — with the exact times and reminders you want.") +
      '<button class="btn" data-action="faith-setup">Set up faith reminders</button>';
    return;
  }
  const habits = activeHabits().filter(h => h.source && h.source.startsWith("faith:"));
  let h = "";

  if (cfg.religion === "muslim") {
    const m = cfg.muslim;
    const pt = prayerMinutes(t);
    const now = Date.now();
    let nextId = null, nextAt = null;
    for (const p of PRAYERS) { const at = momentFor(t, pt[p.id]).getTime(); if (at > now) { nextId = p.id; nextAt = at; break; } }
    if (!nextId) { const tm = prayerMinutes(addDays(t, 1)); nextId = "fajr"; nextAt = momentFor(addDays(t, 1), tm.fajr).getTime(); }
    const nextP = PRAYERS.find(p => p.id === nextId);
    h += '<div class="card pad stack-sm"><div class="spread"><div><div class="eyebrow">Next prayer</div><div class="sect-title" style="font-size:22px">' + nextP.name + " · " + fmtTime(new Date(nextAt).getHours() * 60 + new Date(nextAt).getMinutes()) + "</div></div>" +
      '<span class="badge live tabnum">in ' + fmtDuration(Math.max(1, Math.round((nextAt - now) / 60000))) + "</span></div>" +
      '<div class="prayer-grid">' + PRAYERS.map(p => {
        const past = momentFor(t, pt[p.id]).getTime() < now && p.id !== nextId;
        return '<div class="prayer-cell' + (p.id === nextId ? " next" : past ? " past" : "") + '"><div class="pn">' + p.name + '</div><div class="pt tabnum">' + fmtTime(pt[p.id]) + "</div></div>";
      }).join("") + '<div class="prayer-cell"><div class="pn">Sunrise</div><div class="pt tabnum">' + fmtTime(pt.sunrise) + "</div></div></div>" +
      '<div class="tiny muted">' + (travelOn(t) ? "✈️ " + esc(travelOn(t).loc.name) + " · " : m.source === "auto" ? "📍 " + esc(m.location.name) + " · " + esc((METHODS[m.method] || {}).name || "") + (m.asr === "hanafi" ? " · Hanafi Asr" : "") + (m.combine ? " · prayers joined" : "") : "✏️ Your own times") + "</div></div>";

    const here = prayerLocation(t);
    if (here && here.lat != null) {
      const qb = qiblaBearing(here.lat, here.lng);
      h += '<button class="card pad row" data-action="open-qibla" style="width:100%;text-align:start;font:inherit;color:inherit"><span class="qibla-mini" style="--b:' + qb + 'deg" aria-hidden="true">➤</span>' +
        '<span class="grow"><span class="small bold" style="display:block">Qibla</span><span class="tiny muted tabnum">' + Math.round(qb) + "° " + compassPoint(qb) + '</span></span><span class="faint">›</span></button>';
    }

    // Weekly tally of the five prayers
    const prayerHabits = habits.filter(x => /^faith:(fajr|dhuhr|asr|maghrib|isha)$/.test(x.source));
    if (prayerHabits.length) {
      const ws = startOfWeek(t);
      let possible = 0, prayed = 0;
      for (let d = new Date(ws); d <= t; d = addDays(d, 1)) prayerHabits.forEach(x => { if (isScheduled(x, d)) { possible++; if (isDone(x, d)) prayed++; } });
      h += '<div class="card pad spread"><div><div class="small bold">This week</div><div class="tiny muted">Prayers logged since ' + fmtDate(ws, { weekday: "long" }) + '</div></div><div class="sect-title tabnum">' + prayed + " / " + possible + "</div></div>";
    }

    if (m.ramadan) {
      const dr = daysToRamadan(t), hj = hijri(t);
      h += '<div class="card pad spread"><div><div class="small bold">🏮 Ramadan mode</div><div class="tiny muted">' +
        (dr === 0 ? "Day " + hj.day + " of Ramadan — suhoor, fast, iftar & " + (m.sect === "shia" ? "Dua al-Iftitah" : "Taraweeh") + " are on your Today list" : dr != null ? "Switches on by itself in about " + dr + " days" : "Your browser can't read the Hijri calendar") + '</div></div><span class="badge ' + (dr === 0 ? "live" : "plain") + '">' + (dr === 0 ? "Active" : "Ready") + "</span></div>";
    }
  }

  h += fastingCard(t);

  if (cfg.religion === "other" && cfg.other.tradition) {
    const sm = sunMinutes(t), loc = prayerLocation(t);
    h += '<div class="card pad stack-sm"><div class="prayer-grid"><div class="prayer-cell"><div class="pn">Sunrise</div><div class="pt tabnum">' + fmtTime(sm.sunrise) + '</div></div>' +
      '<div class="prayer-cell"><div class="pn">Midday</div><div class="pt tabnum">' + fmtTime(sm.noon) + '</div></div><div class="prayer-cell"><div class="pn">Sunset</div><div class="pt tabnum">' + fmtTime(sm.sunset) + "</div></div></div>";
    if (cfg.other.tradition === "jewish") {
      // This week's Shabbat: next Friday's candle-lighting and Saturday's Havdalah.
      const fri = addDays(t, (5 - t.getDay() + 7) % 7), sat = addDays(fri, 1), j = cfg.other.jewish;
      h += '<div class="spread"><div><div class="small bold">🕯️ <span>Shabbat candles</span></div><div class="tiny muted">' + esc(fmtDate(fri, { weekday: "long", day: "numeric", month: "short" })) + '</div></div><div class="sect-title tabnum">' + fmtTime(sunMinutes(fri).sunset - (+j.candleMin || 18)) + "</div></div>" +
        '<div class="spread"><div><div class="small bold">🍷 <span>Havdalah</span></div><div class="tiny muted">' + esc(fmtDate(sat, { weekday: "long", day: "numeric", month: "short" })) + '</div></div><div class="sect-title tabnum">' + fmtTime(sunMinutes(sat).sunset + (+j.havdalahMin || 42)) + "</div></div>";
    }
    h += '<div class="tiny muted">' + (travelOn(t) ? "✈️ " : "📍 ") + '<span data-no-tr>' + esc(loc ? loc.name : "") + "</span></div></div>";
  }

  const todays = habits.filter(x => isScheduled(x, t));
  if (todays.length) {
    h += '<div class="group-label"><span class="eyebrow">Today</span><span class="line"></span></div>';
    h += todays.map(x => habitRow(x, t)).join("");
  }
  const later = habits.filter(x => !isScheduled(x, t) && !(x.schedule.hijriMonth));
  if (later.length) {
    h += '<div class="group-label"><span class="eyebrow">Coming up</span><span class="line"></span></div>';
    h += later.map(x => { const nd = nextDue(x); return '<button class="habit" data-action="open-habit-list" data-id="' + x.id + '"><div class="emoji">' + x.emoji + '</div><div class="grow"><div class="name">' + esc(x.name) + '</div><div class="meta">' + (nd ? fmtDate(nd, { weekday: "long", day: "numeric", month: "short" }) : "—") + "</div></div><span class=\"faint\">›</span></button>"; }).join("");
  }
  h += '<div class="list"><button class="li" data-action="open-sounds"><span class="lic">' + (cfg.religion === "christian" ? "🔔" : cfg.religion === "muslim" ? "📢" : "🎵") + '</span><span class="grow small bold">Reminder sound</span><span class="val">' + esc(soundFor({ category: "Faith", source: "" }).label) + '</span><span class="chev">›</span></button></div>';
  h += '<button class="btn sec" data-action="faith-setup">⚙️ Edit faith setup</button>';
  app.innerHTML = h;
}

/* ---------- fasting: today's fast or the next one, and the year ---------- */
const inRange = (x, d) => !x.recurring && keyOf(x.start) <= keyOf(d) && keyOf(x.end) >= keyOf(d);
function fastingCard(t) {
  const fc = fastingCalendar(t);
  if (!fc.list.length && !fc.note) return "";
  const now = fc.list.find(x => !x.none && inRange(x, t) && (x.days > 1 || keyOf(x.end) === keyOf(t)));
  const next = fc.list.find(x => !x.recurring && !x.none && keyOf(x.start) > keyOf(t));
  let h = '<button class="card pad stack-xs" data-action="open-fasts" style="width:100%;text-align:start;font:inherit;color:inherit">';
  if (now) {
    const day = daysBetween(now.start, t) + 1;
    h += '<div class="spread"><div class="small bold">' + now.emoji + " " + esc(now.name) + '</div><span class="badge live">' + (now.days > 1 ? "Day " + day + " of " + now.days : "Today") + "</span></div>" +
      (now.times ? '<div class="small tabnum">' + esc(now.times) + "</div>" : "") + '<div class="tiny muted">' + esc(now.food) + "</div>";
  } else if (next) {
    h += '<div class="spread"><div class="small bold">' + next.emoji + " " + esc(next.name) + '</div><span class="badge plain">' + "Starts in " + daysBetween(t, next.start) + " days</span></div>" +
      '<div class="tiny muted">' + esc(dateRange(next)) + (next.days > 1 ? " · " + next.days + " days" : "") + "</div>";
  } else if (fc.note) h += '<div class="tiny muted">' + esc(fc.note) + "</div>";
  return h + '<div class="spread"><span class="small" style="color:var(--accent)">Fasting calendar</span><span class="faint">›</span></div></button>';
}

function renderFasts() {
  const t = today(), fc = fastingCalendar(t);
  let h = ovHead('<button class="link" data-action="close">Close</button>', "Fasting calendar", "") + '<div class="ov-body stack-sm">';
  h += '<div class="small muted">The next twelve months, worked out for your faith, church or school, your city and your calendar settings.</div>';
  if (fc.note) h += '<div class="okbox">' + esc(fc.note) + "</div>";
  let month = "";
  for (const x of fc.list) {
    if (x.recurring) { if (month !== "rec") { month = "rec"; h += '<div class="group-label"><span class="eyebrow">Every week or month</span><span class="line"></span></div>'; } }
    else { const m = fmtDate(x.start, { month: "long", year: "numeric" }); if (m !== month) { month = m; h += '<div class="group-label"><span class="eyebrow" data-no-tr>' + esc(m) + '</span><span class="line"></span></div>'; } }
    const live = !x.recurring && !x.none && inRange(x, t);
    h += '<div class="card pad stack-xs' + (x.none ? " fast-none" : "") + '"><div class="spread"><div class="small bold">' + x.emoji + " " + esc(x.name) + "</div>" +
      (live ? '<span class="badge live">Now</span>' : x.none ? '<span class="badge plain">No fasting</span>' : x.tracked ? '<span class="badge plain">✓ On your list</span>' : "") + "</div>" +
      (x.recurring ? "" : '<div class="small tabnum">' + esc(dateRange(x)) + (x.days > 1 ? ' · <span>' + x.days + " days</span>" : "") + "</div>") +
      (x.times ? '<div class="tiny tabnum">⏱️ <span>' + esc(x.times) + "</span></div>" : "") +
      (x.food ? '<div class="tiny muted">' + esc(x.food) + "</div>" : "") + "</div>";
  }
  if (!fc.list.length && !fc.note) h += emptyCard("🗓️", "No fasts to show", "Choose your faith and tradition in Faith setup.");
  h += '<div class="hint">🩺 If you\'re ill, pregnant, elderly or on medicines such as diabetes treatment, ask your doctor and your imam, priest or rabbi before fasting. Every tradition makes allowances.</div>';
  if ((CONFIG.faithReviewers || []).length) h += '<div class="okbox small">✅ <span>Checked by</span> ' + CONFIG.faithReviewers.map(r => '<span data-no-tr>' + esc(r.name + " (" + r.role + ")") + "</span>" + (r.covers ? " · <span>" + esc(r.covers) + "</span>" : "")).join("; ") + "</div>";
  h += '<div class="hint">Lunar and Hebrew dates are calculated on your phone. When a date is close, check it with your mosque, church, synagogue or temple — moon sighting and local custom can move it by a day.</div>';
  return h + "</div>";
}
on("open-fasts", () => openOverlay(renderFasts, { push: true }));

export function openFaithSetup() {
  openOverlay(() => ovHead('<button class="link" data-action="close">Cancel</button>', "Faith setup", '<button class="link" data-action="faith-save">Save</button>') +
    '<div class="ov-body">' + '<div class="small muted">Choose exactly what to track and how you want to be reminded. Your history is kept when you change this.</div>' +
    faithFields("cfg") + '<button class="btn" data-action="faith-save">Save faith setup</button></div>', { form: { cfg: deepClone(faithCfg()) }, push: true });
}

on("faith-setup", () => openFaithSetup());
on("faith-save", () => {
  const cfg = ui.form.cfg;
  applyFaith(cfg);
  save();
  closeOverlay({ all: true });
  toast(cfg.religion ? "Faith reminders updated 🤲" : "Faith reminders turned off");
});
