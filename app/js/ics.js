// Minimal iCalendar (.ics) reader for Outlook / Microsoft 365, Google and
// iCloud calendar links: events, all-day events, time zones (IANA and the
// Windows names Outlook uses), and common repeat rules with exceptions.

const WIN_TZ = {
  "Egypt Standard Time": "Africa/Cairo", "Arab Standard Time": "Asia/Riyadh", "Arabian Standard Time": "Asia/Dubai",
  "Arabic Standard Time": "Asia/Baghdad", "Jordan Standard Time": "Asia/Amman", "Middle East Standard Time": "Asia/Beirut",
  "Turkey Standard Time": "Europe/Istanbul", "Israel Standard Time": "Asia/Jerusalem", "South Africa Standard Time": "Africa/Johannesburg",
  "Morocco Standard Time": "Africa/Casablanca", "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin", "Romance Standard Time": "Europe/Paris", "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw", "E. Europe Standard Time": "Europe/Chisinau", "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest", "Russian Standard Time": "Europe/Moscow", "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Kolkata", "Bangladesh Standard Time": "Asia/Dhaka", "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai", "Tokyo Standard Time": "Asia/Tokyo", "AUS Eastern Standard Time": "Australia/Sydney",
  "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago", "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles", "Atlantic Standard Time": "America/Halifax", "UTC": "UTC", "Coordinated Universal Time": "UTC"
};

function unfold(text) { return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); }

function unescape(v) { return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1"); }

function parseLine(line) {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.split(";");
  const params = {};
  parts.slice(1).forEach(p => { const [k, v] = p.split("="); if (k) params[k.toUpperCase()] = (v || "").replace(/^"|"$/g, ""); });
  return { name: parts[0].toUpperCase(), params, value };
}

// Offset (ms) of a time zone at a given UTC instant, via Intl.
function tzOffset(tz, utcMs) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p = {}; f.formatToParts(new Date(utcMs)).forEach(x => { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
  } catch (e) { return null; }
}

function parseDate(value, params) {
  const v = value.trim();
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    return { date: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, Y, Mo, D, h, mi, s, z] = m;
  if (z) return { date: new Date(Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +(s || 0))), allDay: false };
  const tzid = params.TZID ? (WIN_TZ[params.TZID] || params.TZID) : null;
  if (tzid) {
    const guess = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +(s || 0));
    const off = tzOffset(tzid, guess);
    if (off != null) {
      const off2 = tzOffset(tzid, guess - off);
      return { date: new Date(guess - (off2 != null ? off2 : off)), allDay: false };
    }
  }
  return { date: new Date(+Y, +Mo - 1, +D, +h, +mi, +(s || 0)), allDay: false }; // floating = local time
}

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(v) {
  const r = {};
  v.split(";").forEach(p => { const [k, val] = p.split("="); r[k.toUpperCase()] = val; });
  return r;
}

// Expand a repeating event into occurrences that fall inside [from, to].
function expand(ev, rule, exdates, from, to) {
  const out = [];
  const dur = ev.end - ev.start;
  const freq = rule.FREQ, interval = Math.max(1, +rule.INTERVAL || 1);
  const until = rule.UNTIL ? (parseDate(rule.UNTIL, {}) || {}).date : null;
  const count = rule.COUNT ? +rule.COUNT : Infinity;
  const byDay = rule.BYDAY ? rule.BYDAY.split(",").map(x => DAYS[x.slice(-2)]).filter(x => x != null) : null;
  const byMonthDay = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(",").map(Number) : null;
  const start = new Date(ev.start);
  let n = 0;
  const push = d => {
    if (until && d > until) return false;
    if (n >= count) return false;
    n++;
    if (!exdates.has(d.getTime()) && d.getTime() + dur >= from.getTime() && d <= to) out.push(Object.assign({}, ev, { start: d.getTime(), end: d.getTime() + dur, id: ev.id + "@" + d.getTime() }));
    return true;
  };
  const at = (base, dayOffset) => { const d = new Date(base); d.setDate(d.getDate() + dayOffset); return d; };
  for (let i = 0; i < 1500; i++) {
    let cont = true;
    if (freq === "DAILY") {
      cont = push(at(start, i * interval));
    } else if (freq === "WEEKLY") {
      const weekStart = at(start, i * 7 * interval - start.getDay());
      const days = byDay && byDay.length ? byDay : [start.getDay()];
      for (const dow of days.slice().sort()) {
        const d = at(weekStart, dow);
        d.setHours(start.getHours(), start.getMinutes(), start.getSeconds());
        if (d < start) continue;
        if (!push(d)) { cont = false; break; }
      }
    } else if (freq === "MONTHLY") {
      const d = new Date(start); d.setMonth(start.getMonth() + i * interval);
      if (byMonthDay) d.setDate(byMonthDay[0] > 0 ? byMonthDay[0] : new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
      cont = push(d);
    } else if (freq === "YEARLY") {
      const d = new Date(start); d.setFullYear(start.getFullYear() + i * interval);
      cont = push(d);
    } else break;
    if (!cont) break;
    const last = out.length ? new Date(out[out.length - 1].start) : null;
    if ((last && last > to) || at(start, i * (freq === "WEEKLY" ? 7 : 1) * interval) > to) break;
  }
  return out;
}

/** Parse .ics text into occurrences between `from` and `to`. */
export function parseICS(text, from, to) {
  const lines = unfold(text).split("\n");
  const raw = [];
  let cur = null, depth = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { ex: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith("BEGIN:")) { depth++; continue; }      // e.g. VALARM
    if (line.startsWith("END:") && depth > 0) { depth--; continue; }
    if (line === "END:VEVENT") { raw.push(cur); cur = null; continue; }
    if (depth > 0) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "EXDATE") p.value.split(",").forEach(v => { const d = parseDate(v, p.params); if (d) cur.ex.push(d.date.getTime()); });
    else cur[p.name] = p;
  }

  const overrides = new Map(); // UID|RECURRENCE-ID -> event (moved single occurrences)
  raw.forEach(r => { if (r["RECURRENCE-ID"] && r.UID) { const d = parseDate(r["RECURRENCE-ID"].value, r["RECURRENCE-ID"].params); if (d) overrides.set(r.UID.value + "|" + d.date.getTime(), r); } });

  const out = [];
  for (const r of raw) {
    if (!r.DTSTART || (r.STATUS && r.STATUS.value === "CANCELLED")) continue;
    const s = parseDate(r.DTSTART.value, r.DTSTART.params);
    if (!s) continue;
    let e = r.DTEND ? parseDate(r.DTEND.value, r.DTEND.params) : null;
    if (!e && r.DURATION) {
      const m = r.DURATION.value.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/) || [];
      e = { date: new Date(s.date.getTime() + ((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 60000) };
    }
    if (!e) e = { date: new Date(s.date.getTime() + (s.allDay ? 86400000 : 3600000)) };
    const desc = r.DESCRIPTION ? unescape(r.DESCRIPTION.value) : "";
    const loc = r.LOCATION ? unescape(r.LOCATION.value) : "";
    const url = r.URL ? r.URL.value : "";
    const ev = {
      id: (r.UID ? r.UID.value : Math.random().toString(36).slice(2)) + (r["RECURRENCE-ID"] ? "#" + r["RECURRENCE-ID"].value : ""),
      title: r.SUMMARY ? unescape(r.SUMMARY.value) : "(No title)",
      start: s.date.getTime(), end: e.date.getTime(), allDay: s.allDay,
      location: loc, notes: desc.slice(0, 400), ...meetingLink([url, loc, desc].join(" "))
    };
    if (r.RRULE && !r["RECURRENCE-ID"]) {
      const exdates = new Set(r.ex);
      overrides.forEach((_, key) => { if (r.UID && key.startsWith(r.UID.value + "|")) exdates.add(+key.split("|")[1]); });
      out.push(...expand(ev, parseRule(r.RRULE.value), exdates, from, to));
    } else if (ev.end >= from.getTime() && ev.start <= to.getTime()) {
      out.push(ev);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// Find a Teams / Zoom / Google Meet / Webex join link in event text.
export function meetingLink(text) {
  const t = String(text || "");
  const m = t.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/i) || t.match(/https:\/\/teams\.live\.com\/meet\/[^\s"<>]+/i);
  if (m) return { join: m[0], provider: "teams" };
  const z = t.match(/https:\/\/(?:[\w-]+\.)?zoom\.us\/(?:j|my|w)\/[^\s"<>]+/i);
  if (z) return { join: z[0], provider: "zoom" };
  const g = t.match(/https:\/\/meet\.google\.com\/[a-z-]+/i);
  if (g) return { join: g[0], provider: "meet" };
  const w = t.match(/https:\/\/[\w-]+\.webex\.com\/[^\s"<>]+/i);
  if (w) return { join: w[0], provider: "webex" };
  return { join: "", provider: null };
}
