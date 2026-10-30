// Per-habit reminder rules -> concrete times of day.
//
// reminders.mode:
//   times     fixed clock times (one or many)
//   interval  repeat every N minutes between two times (e.g. water)
//   routine   relative to wake / bed / work start / work end — follows shifts
//   prayer    relative to a prayer time (auto-calculated or manual)
//   sun       relative to sunrise / midday / sunset in your city (any faith, or none)
// reminders.nag: minutes after which to nudge again if still not done (0 = off)

import { anchorsFor, ANCHORS } from "./routine.js";
import { prayerMinutes, sunMinutes, SUN_POINTS } from "./faith.js";
import { TIME_POINTS } from "./prayer.js";
import { toMin, fmtTime, fmtDuration } from "./dates.js";

export const MODES = [
  { id: "times", label: "At set times" },
  { id: "interval", label: "Repeat in a window" },
  { id: "routine", label: "Around my routine" },
  { id: "prayer", label: "Around prayer times" },
  { id: "sun", label: "Sunrise / sunset" }
];
export const NAG_OPTIONS = [0, 10, 15, 30, 60, 120];

// Minutes-of-day (may exceed 1440 or be negative before normalisation) for habit h on habit-day d.
export function reminderMinutes(h, d) {
  const r = h.reminders;
  if (!r || !r.on) return [];
  let out = [];
  if (r.mode === "times") {
    out = (r.times || []).map(toMin).filter(m => m != null);
  } else if (r.mode === "interval") {
    const iv = r.interval || {};
    const from = toMin(iv.from), to = toMin(iv.to), step = Math.max(15, +iv.every || 60);
    if (from != null && to != null) {
      const span = ((to - from) % 1440 + 1440) % 1440;
      for (let m = 0; m <= span && out.length < 48; m += step) out.push(from + m);
    }
  } else if (r.mode === "routine") {
    const a = anchorsFor(d)[r.anchor || "wake"];
    if (a != null) out.push(a + (+r.offset || 0));
  } else if (r.mode === "prayer") {
    const pm = prayerMinutes(d)[r.prayer || "fajr"];
    if (pm != null) (r.offsets && r.offsets.length ? r.offsets : [0]).forEach(o => out.push(pm + (+o || 0)));
  } else if (r.mode === "sun") {
    const sm = sunMinutes(d)[r.sun || "sunset"];
    if (sm != null && !isNaN(sm)) (r.offsets && r.offsets.length ? r.offsets : [0]).forEach(o => out.push(sm + (+o || 0)));
  }
  out = out.map(m => ((Math.round(m) % 1440) + 1440) % 1440);
  return Array.from(new Set(out));
}

// The time to display/sort a habit by on a given day.
export function primaryMinute(h, d) {
  const r = h.reminders;
  if (r && r.mode === "prayer") {
    // A prayer itself shows at adhan; "15 min after Fajr" habits show at their own time.
    const pm = prayerMinutes(d)[r.prayer || "fajr"];
    if (pm == null) return null;
    const offs = r.offsets && r.offsets.length ? r.offsets : [0];
    return ((pm + (offs.includes(0) ? 0 : +offs[0] || 0)) % 1440 + 1440) % 1440;
  }
  if (r && r.mode === "sun") {
    // Shown at the moment itself (e.g. candle-lighting), not at the heads-up before it.
    const sm = sunMinutes(d)[r.sun || "sunset"];
    if (sm == null || isNaN(sm)) return null;
    const offs = r.offsets && r.offsets.length ? r.offsets : [0];
    return ((sm + Math.max(...offs.map(Number))) % 1440 + 1440) % 1440;
  }
  const list = reminderMinutes(Object.assign({}, h, { reminders: Object.assign({}, r, { on: true }) }), d);
  if (!list.length) return null;
  return list[0];
}

function offsetText(o, what) {
  o = +o || 0;
  if (!o) return "at " + what;
  return fmtDuration(Math.abs(o)) + (o < 0 ? " before " : " after ") + what;
}

export function describeReminders(h) {
  const r = h.reminders;
  if (!r || !r.on) return "No reminder";
  let t = "";
  if (r.mode === "times") t = (r.times || []).filter(Boolean).map(fmtTime).join(", ") || "No times set";
  else if (r.mode === "interval") t = "Every " + fmtDuration(r.interval.every) + ", " + fmtTime(r.interval.from) + "–" + fmtTime(r.interval.to);
  else if (r.mode === "routine") t = offsetText(r.offset, (ANCHORS.find(a => a.id === r.anchor) || ANCHORS[0]).label);
  else if (r.mode === "prayer") {
    const p = (TIME_POINTS.find(x => x.id === r.prayer) || TIME_POINTS[0]).name;
    t = (r.offsets && r.offsets.length ? r.offsets : [0]).map(o => offsetText(o, p)).join(" & ");
  } else if (r.mode === "sun") {
    const p = (SUN_POINTS.find(x => x.id === r.sun) || SUN_POINTS[2]).name.toLowerCase();
    t = (r.offsets && r.offsets.length ? r.offsets : [0]).map(o => offsetText(o, p)).join(" & ");
  }
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (r.nag) t += " · again after " + fmtDuration(r.nag) + " if not done";
  return t;
}
