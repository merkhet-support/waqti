// Detailed faith setup (onboarding + Faith tab). Asks exactly what to track,
// how prayer times are found, and how/when to remind.

import { esc, getPath, toast } from "../util.js";
import { fmtTime, today, toMin } from "../dates.js";
import { PRAYERS, METHODS, CITIES, nearestCity, prayerTimes } from "../prayer.js";
import { prayerMinutes, sunMinutes, AGPEYA } from "../faith.js";
import { daysToRamadan, hijri, hijriLabel } from "../hijri.js";
import { currentFast, nextFast, churchYear, isOrthodox } from "../seasons.js";
import { fastingCfg } from "../faith.js";
import { fmtDate } from "../dates.js";
import { currentLang } from "../i18n.js";

// "25 Nov – 6 Jan" (or one day), for fasting dates.
export function dateRange(x) {
  const o = { day: "numeric", month: "short" };
  return x.days > 1 ? fmtDate(x.start, o) + " – " + fmtDate(x.end, o) : fmtDate(x.start, Object.assign({ weekday: "short" }, o));
}
import { on, ui, rerenderOverlay } from "./core.js";
import { option, seg, selectEl, checkRow, toggleRow, daysPicker, timeList, numInput } from "./components.js";
import { openEmojiPicker } from "./emoji-picker.js";

const BEFORE = [[0, "No early reminder"], [5, "5 min before"], [10, "10 min before"], [15, "15 min before"], [20, "20 min before"], [30, "30 min before"]];
const NAG = [[0, "No repeat"], [15, "after 15 min"], [30, "after 30 min"], [45, "after 45 min"], [60, "after 1 hour"]];

export function faithFields(p) {
  const f = getPath(ui.form, p);
  let h = '<div class="options">' +
    option(p + ".religion", "muslim", f.religion, "🕌", "Islam", "Salah, Quran, adhkar, fasting") +
    option(p + ".religion", "christian", f.religion, "⛪", "Christianity", "Prayer, church, Bible, fasting") +
    option(p + ".religion", "other", f.religion, "🌿", "Another faith or practice", "Any religion or spiritual routine — prayer, scripture, meditation, gratitude…") +
    option(p + ".religion", "null", f.religion == null ? "null" : f.religion, "🚫", "No thanks", "Skip faith reminders") +
    "</div>";
  if (f.religion === "muslim") h += muslimFields(p + ".muslim", f.muslim);
  if (f.religion === "christian") h += christianFields(p + ".christian", f.christian);
  if (f.religion === "other") h += otherFields(p + ".other", f.other);
  return h;
}

function muslimFields(p, m) {
  const cfg = { muslim: m };
  const pt = prayerMinutes(today(), cfg);
  const shia = m.sect === "shia";
  let h = "";

  // Sect and school first: they decide the times, which prayers are joined and the year's special days.
  h += '<div class="card pad stack-sm"><div class="small bold">Your tradition</div>' +
    '<div class="seg" style="--cols:2"><button type="button" class="' + (shia ? "" : "on") + '" data-action="faith-sect" data-id="sunni" data-path="' + p + '">Sunni</button>' +
    '<button type="button" class="' + (shia ? "on" : "") + '" data-action="faith-sect" data-id="shia" data-path="' + p + '">Shia (Ja\'fari)</button></div>';
  if (!shia) {
    h += '<div class="small muted">School (madhhab)</div><div class="seg" style="--cols:4">' + [["hanafi", "Hanafi"], ["shafii", "Shafi'i"], ["maliki", "Maliki"], ["hanbali", "Hanbali"]]
      .map(([id, n]) => '<button type="button" class="' + (m.madhhab === id ? "on" : "") + '" data-action="faith-madhhab" data-id="' + id + '" data-path="' + p + '">' + n + "</button>").join("") + "</div>" +
      '<div class="hint">' + (m.madhhab === "hanafi" ? "Hanafi: Asr is later (when shadows are twice an object's length), and Witr is wajib." : "Asr when shadows equal an object's length.") + "</div>";
  } else {
    h += '<div class="hint">Ja\'fari times: Fajr at 16°, Maghrib when the redness in the east has gone (about ' + Math.round(((pt.maghrib - pt.sunset) % 1440 + 1440) % 1440) + " min after sunset today), Isha at 14°.</div>";
  }
  h += toggleRow("Pray Dhuhr & Asr together, and Maghrib & Isha together", p + ".combine", !!m.combine, "Three prayer times a day — one reminder for each pair, each prayer still ticked on its own");
  h += '<div class="field"><label>Hijri date</label>' + selectEl(p + ".hijriAdjust", [[-2, "2 days earlier"], [-1, "1 day earlier"], [0, "Umm al-Qura (Saudi calendar)"], [1, "1 day later (local moon sighting)"], [2, "2 days later"]], +m.hijriAdjust || 0, " data-num data-rerender") +
    '<div class="hint">' + (hijriLabel(today()) ? "<span>Today:</span> <span data-no-tr>" + esc(hijriLabelWith(+m.hijriAdjust || 0)) + "</span>. " : "") + "<span>Match your country or marja' — Ramadan, Eid and the special days follow it.</span></div></div></div>";

  h += '<div class="card pad stack-sm"><div class="small bold">Which prayers do you want to track?</div>' +
    PRAYERS.map(pr => checkRow("", pr.name + ' <span class="faint">' + pr.ar + "</span>", p + ".prayers." + pr.id, m.prayers[pr.id], "Today " + fmtTime(pt[pr.id]) + " · " + pr.rakah + " rak'ah")).join("") +
    "</div>";

  h += '<div class="card pad stack-sm"><div class="small bold">Prayer times</div>' + seg(p + ".source", [["auto", "📍 Auto by location"], ["manual", "✏️ I'll set them"]], m.source, 2);
  if (m.source === "auto") {
    const cityOpts = CITIES.map(c => [c[0], c[0]]);
    const isCustom = !CITIES.some(c => c[0] === m.location.name);
    if (isCustom) cityOpts.unshift([m.location.name, m.location.name + " (GPS)"]);
    h += '<div class="row"><div class="field grow"><label>City</label>' + selectEl("_city", cityOpts, m.location.name, ' data-onchange="faith-city" data-path="' + p + '"') + "</div>" +
      '<button type="button" class="btn sec xs" style="align-self:flex-end;height:48px" data-action="faith-gps" data-id="' + p + '">📍 Locate me</button></div>' +
      '<div class="field"><label>Calculation method</label>' + selectEl(p + ".method", Object.keys(METHODS).filter(k => !METHODS[k].hidden && (!!METHODS[k].shia === shia || k === m.method)).map(k => [k, METHODS[k].name]), m.method, " data-rerender") + "</div>";
    // Far north or south (UK, Scandinavia, Canada): twilight can last all night in summer.
    if (Math.abs(m.location.lat || 0) >= 45 || (m.highLat && m.highLat !== "angle")) h += '<div class="field"><label>Summer nights (far north or south)</label>' +
      selectEl(p + ".highLat", [["angle", "Angle-based (most common)"], ["midnight", "Middle of the night"], ["seventh", "One-seventh of the night"], ["none", "No adjustment"]], m.highLat || "angle", " data-rerender") +
      '<div class="hint">In summer the sky may never get dark enough for the usual Fajr and Isha. Choose the rule your mosque uses.</div></div>';
    h += '<div class="prayer-grid">' + PRAYERS.map(pr => '<div class="prayer-cell"><div class="pn">' + pr.name + '</div><div class="pt tabnum">' + fmtTime(pt[pr.id]) + "</div></div>").join("") +
      '<div class="prayer-cell"><div class="pn">Sunrise</div><div class="pt tabnum">' + fmtTime(pt.sunrise) + "</div></div></div>" +
      '<div class="hint">Calculated on your phone for ' + esc(m.location.name) + " — updates every day, works offline. Uses your phone's time zone.</div>";
    const adj = m.adjust || {};
    h += '<details class="stack-sm"' + (Object.values(adj).some(v => +v) ? " open" : "") + '><summary class="small bold" style="cursor:pointer">Fine-tune to your mosque (± minutes)</summary><div class="stack-sm" style="margin-top:8px">' +
      PRAYERS.concat([{ id: "sunrise", name: "Sunrise" }]).map(pr => '<div class="timerow"><span class="small bold">' + pr.name + ' <span class="faint tabnum">' + fmtTime(pt[pr.id]) + "</span></span>" +
        selectEl(p + ".adjust." + pr.id, Array.from({ length: 41 }, (_, i) => [i - 20, (i - 20 > 0 ? "+" : "") + (i - 20) + " min"]), +(adj[pr.id] || 0), ' data-num data-rerender style="width:110px"') + "</div>").join("") +
      '<div class="hint">Calculated times can differ from your local mosque by a few minutes. Adjust once and Waqti keeps the difference every day. Always follow your local mosque or authority when in doubt.</div></div></details>';
  } else {
    h += '<div class="stack-sm">' + PRAYERS.map(pr => '<div class="timerow"><span class="bold small">' + pr.name + '</span><input class="input time" type="time" data-bind="' + p + ".manual." + pr.id + '" value="' + esc(m.manual[pr.id]) + '" data-rerender></div>').join("") + "</div>" +
      '<div class="hint">Use your local mosque\'s timetable. Update them when the season changes, or switch to Auto.</div>';
  }
  h += "</div>";

  h += '<div class="card pad stack-sm"><div class="small bold">How should we remind you?</div>' +
    '<div class="field"><label>Before the adhan</label>' + selectEl(p + ".remind.before", BEFORE, m.remind.before, " data-num data-rerender") + "</div>" +
    toggleRow("Also remind at adhan time", p + ".remind.atAdhan", m.remind.atAdhan) +
    '<div class="field"><label>Not marked as prayed? Remind again</label>' + selectEl(p + ".remind.nag", NAG, m.remind.nag, " data-num data-rerender") + "</div>" +
    '<div class="hint">So for Asr you\'d get: ' + esc(previewPrayer(pt.asr, m.remind)) + "</div></div>";

  const dr = daysToRamadan(today());
  const cutExtras = h.length;
  h += '<div class="card pad stack-sm"><div class="small bold">Extras</div>' +
    (shia
      ? checkRow("📿", "Daily nawafil", p + ".extras.rawatib", m.extras.rawatib, "34 rak'ah a day, counted") +
        checkRow("🌌", "Salat al-Layl", p + ".extras.qiyam", m.extras.qiyam, "11 rak'ah with Witr, at the last third of the night") +
        checkRow("📿", "Tasbih of Fatima al-Zahra", p + ".shia.tasbih", m.shia.tasbih, "34 · 33 · 33 after each prayer") +
        checkRow("🤲", "Dua Kumayl", p + ".shia.kumayl", m.shia.kumayl, "Thursday nights, after Isha") +
        checkRow("🕊️", "Ziyarat Ashura", p + ".shia.ziyarahAshura", m.shia.ziyarahAshura, "Daily, after Fajr")
      : checkRow("📿", "Sunnah rawatib", p + ".extras.rawatib", m.extras.rawatib, "12 rak'ah a day, counted") +
        checkRow("☀️", "Duha prayer", p + ".extras.duha", m.extras.duha, "Reminder 30 min after sunrise") +
        checkRow("✨", "Witr", p + ".extras.witr", m.extras.witr, "Reminder 20 min before your bedtime") +
        checkRow("🌌", "Qiyam / Tahajjud", p + ".extras.qiyam", m.extras.qiyam, "At the last third of the night")) +
    checkRow("🕋", "Jumu'ah", p + ".jumuah", m.jumuah, "Fridays, 45 min before Dhuhr") +
    checkRow("🌤️", "Morning adhkar", p + ".adhkar.morning", m.adhkar.morning, "After Fajr") +
    checkRow("🌆", "Evening adhkar", p + ".adhkar.evening", m.adhkar.evening, "After Asr") +
    checkRow("📖", "Daily Quran", p + ".quran.on", m.quran.on, "Set an amount below");
  if (m.quran.on) {
    h += '<div class="inline" style="padding-left:6px"><span class="small">Read</span>' + numInput(p + ".quran.amount", m.quran.amount, 1, 604) +
      selectEl(p + ".quran.unit", [["pages", "pages"], ["ayat", "ayat"], ["min", "minutes"]], m.quran.unit, ' style="width:120px"') +
      '<span class="small">after</span>' + selectEl(p + ".quran.after", PRAYERS.map(x => [x.id, x.name]), m.quran.after, ' style="width:120px"') + "</div>";
  }
  h += checkRow("🌙", "Fast Mondays & Thursdays", p + ".fasting.monThu", m.fasting.monThu, "Suhoor reminder before Fajr") +
    checkRow("🌕", "White days fast", p + ".fasting.whiteDays", m.fasting.whiteDays, "13th, 14th & 15th of each Hijri month") +
    checkRow("🏮", "Ramadan mode", p + ".ramadan", m.ramadan, (shia ? "Suhoor, fasting, iftar at Maghrib, Dua al-Iftitah & daily juz" : "Suhoor, fasting, iftar at Maghrib, Taraweeh & daily juz") + " — switches on by itself in Ramadan" + (dr === 0 ? " · Ramadan Mubarak! Active now" : dr != null ? " · Ramadan in ~" + dr + " days" : "")) +
    "</div>";
  const extrasOn = [m.extras.rawatib, m.extras.qiyam, !shia && m.extras.duha, !shia && m.extras.witr, shia && m.shia.tasbih, shia && m.shia.kumayl, shia && m.shia.ziyarahAshura, m.jumuah, m.adhkar.morning, m.adhkar.evening, m.quran.on, m.fasting.monThu, m.fasting.whiteDays, m.ramadan].filter(Boolean).length;
  h = h.slice(0, cutExtras) + fold("extras", "Extras", extrasOn, h.slice(cutExtras));
  const o = m.occasions, cutDays = h.length;
  h += '<div class="card pad stack-sm"><div class="small bold">Special days of the year</div><div class="hint">Switch on by themselves on the right Hijri date. Voluntary fasts are never set on Eid or the days of Tashriq.</div>' +
    checkRow("🎉", "Eid prayers", p + ".occasions.eid", o.eid, "Eid al-Fitr and Eid al-Adha, after sunrise") +
    (shia
      ? checkRow("🖤", "Muharram & Ashura", p + ".occasions.muharram", o.muharram, "Majlis on the first ten nights, and the Day of Ashura") +
        checkRow("🚶", "Arba'een", p + ".occasions.arbaeen", o.arbaeen, "20 Safar") +
        checkRow("✨", "Nights of Qadr", p + ".occasions.qadrNights", o.qadrNights, "19th, 21st and 23rd nights of Ramadan") +
        checkRow("🌿", "Eid al-Ghadir", p + ".occasions.ghadir", o.ghadir, "18 Dhu al-Hijjah") +
        checkRow("🌕", "Night of mid-Sha'ban", p + ".occasions.shaban", o.shaban, "15 Sha'ban")
      : checkRow("🕋", "Fast of Arafah", p + ".occasions.arafah", o.arafah, "9 Dhu al-Hijjah") +
        checkRow("🌙", "Fast of Ashura", p + ".occasions.ashuraFast", o.ashuraFast, "9 & 10 Muharram") +
        checkRow("✨", "Last ten nights of Ramadan", p + ".occasions.lastTen", o.lastTen, "The odd nights — seek Laylat al-Qadr")) +
    "</div>";
  const daysOn = (shia ? ["eid", "muharram", "arbaeen", "qadrNights", "ghadir", "shaban"] : ["eid", "arafah", "ashuraFast", "lastTen"]).filter(k => o[k]).length;
  return h.slice(0, cutDays) + fold("days", "Special days of the year", daysOn, h.slice(cutDays));
}

// Long setup sections fold to one line (Faith setup was 4.5 screens tall): "Extras · 6 on ›".
const opened = new Set();
function fold(id, title, on, inner) {
  if (opened.has(id)) return inner + '<button type="button" class="link small" data-action="faith-fold" data-id="' + id + '" style="align-self:flex-start">Hide ' + title.toLowerCase() + "</button>";
  return '<button type="button" class="card pad row fold-btn" data-action="faith-fold" data-id="' + id + '"><span class="grow" style="text-align:start"><span class="small bold" style="display:block">' + title + '</span><span class="tiny muted"><span class="tabnum">' + on + "</span> <span>switched on</span></span></span><span class=\"chev\">›</span></button>";
}

function previewPrayer(min, r) {
  const parts = [];
  if (r.before) parts.push(fmtTime(min - r.before) + " (" + r.before + " min before)");
  if (r.atAdhan || !r.before) parts.push(fmtTime(min) + " (adhan)");
  if (r.nag) parts.push(fmtTime(min + r.nag) + " if not marked");
  return parts.join(", ");
}

function christianFields(p, c) {
  let h = '<div class="card pad stack-sm"><div class="small bold">Church</div>' +
    seg(p + ".denom", [["orthodox", "Coptic / Ethiopian Orthodox"], ["eastern-new", "Greek / Antiochian Orthodox"], ["eastern", "Russian / Serbian Orthodox"], ["catholic", "Catholic"], ["protestant", "Protestant"], ["other", "Other"]], c.denom, 2) +
    (c.denom === "eastern" ? '<div class="hint">Old (Julian) calendar: Christmas on 7 January — also Georgian, Jerusalem, Ukrainian and Mount Athos.</div>'
      : c.denom === "eastern-new" ? '<div class="hint">New calendar: Christmas on 25 December, Easter with all Orthodox — also Romanian, Bulgarian and Cypriot.</div>' : "") +
    toggleRow("Remind me about church", p + ".church.on", c.church.on);
  if (c.church.on) {
    h += '<div class="small muted">Which day(s)?</div>' + daysPicker(p + ".church.days", c.church.days) +
      '<div class="inline"><span class="small">Service starts</span><input class="input time" type="time" data-bind="' + p + '.church.time" value="' + esc(c.church.time) + '" data-rerender><span class="hint">— reminder 1 hour before</span></div>';
  }
  h += "</div>";

  h += '<div class="card pad stack-sm"><div class="small bold">Daily prayer</div>' +
    seg(p + ".prayerMode", [["simple", "My own times"], ["agpeya", "Agpeya hours"]], c.prayerMode, 2);
  if (c.prayerMode === "simple") {
    h += '<div class="small muted">How many times a day, and when? Add one time per prayer.</div>' + timeList(p + ".simple.times", c.simple.times, "13:00");
  } else {
    h += '<div class="hint">Pick the canonical hours you pray — adjust each time to your day.</div>' +
      AGPEYA.map(a => '<div class="timerow"><label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" data-bind="' + p + ".agpeya." + a.id + '"' + (c.agpeya[a.id] ? " checked" : "") + ' data-rerender style="width:20px;height:20px;accent-color:var(--accent)"><span class="small bold">' + a.name + "</span></label>" +
        '<input class="input time" type="time" data-bind="' + p + ".agpeyaTimes." + a.id + '" value="' + esc(c.agpeyaTimes[a.id] || a.time) + '"' + (c.agpeya[a.id] ? "" : " disabled") + "></div>").join("");
  }
  h += '<div class="row"><div class="field grow"><label>Remind me</label>' + selectEl(p + ".remind.before", [[0, "At the time"], [5, "5 min before"], [10, "10 min before"], [15, "15 min before"]], c.remind.before, " data-num") + "</div>" +
    '<div class="field grow"><label>Then again</label>' + selectEl(p + ".remind.nag", NAG, c.remind.nag, " data-num") + "</div></div></div>";

  h += '<div class="card pad stack-sm">' + checkRow("📖", "Daily Bible reading", p + ".bible.on", c.bible.on, "");
  if (c.bible.on) h += '<div class="inline"><span class="small">Read</span>' + numInput(p + ".bible.amount", c.bible.amount, 1, 50) +
    selectEl(p + ".bible.unit", [["chapter", "chapter(s)"], ["verse", "verse(s)"], ["min", "minutes"]], c.bible.unit, ' style="width:130px"') +
    '<span class="small">at</span><input class="input time" type="time" data-bind="' + p + '.bible.time" value="' + esc(c.bible.time) + '"></div>';
  const orth = isOrthodox(c.denom), fst = fastingCfg(c);
  if (orth) h += checkRow("🥖", "Fast Wednesdays & Fridays", p + ".fasting.wedFri", fst.wedFri, c.denom === "orthodox" ? "Not in the fifty days after Easter, on Nativity or Theophany, or inside the long fasts" : "Not in the fast-free weeks, or inside the long fasts");
  else if (c.denom === "catholic") h += checkRow("🐟", "No meat on Fridays of Lent", p + ".fasting.fridays", fst.fridays, "");
  h += "</div>";
  // Each fast with its real dates in the coming year, worked out from Easter and the church's calendar.
  const year = churchYear(today(), c.denom, 365), when = id => { const x = year.find(y => y.id === id || y.id === id + "-o" || y.id === id + "-n"); return x ? dateRange(x) + (x.days > 1 ? " · " + x.days + " days" : "") : "Not in the next twelve months"; };
  const nf = nextFast(today(), c.denom), cf = currentFast(today(), c.denom);
  h += '<div class="card pad stack-sm"><div class="small bold">Fasting seasons and days</div><div class="hint">' +
    (cf ? cf.emoji + " " + cf.name + " — day " + cf.day + " of " + cf.of : nf ? "Next: " + nf.emoji + " " + nf.name + " in " + nf.in + " days" : "") + "</div>";
  const row = (e, n, key, id) => checkRow(e, n, p + ".fasting." + key, fst[key], when(id));
  if (c.denom === "orthodox") {
    h += row("✝️", "Great Lent (55 days)", "greatLent", "great-lent") + row("🐋", "Fast of Jonah (3 days)", "jonah", "jonah-fast") +
      row("⛵", "Apostles' Fast", "apostles", "apostles-fast") + row("🌹", "Fast of the Virgin Mary (15 days)", "virgin", "virgin-fast") +
      row("⭐", "Nativity Fast", "nativity", "nativity-fast") + row("🕊️", "Paramoun of Theophany", "paramoun", "paramoun") +
      '<div class="hint">Dates follow the Coptic calendar: the Nativity Fast starts on 16 Hatour — 25 November, or 26 November in some years (2027, 2031…). If your church announces a different day, follow your church.</div>';
  } else if (orth) {
    h += row("✝️", "Great Lent (from Clean Monday)", "greatLent", "eastern-lent") + row("⛵", "Apostles' Fast", "apostles", "apostles") +
      row("🌹", "Dormition Fast (14 days)", "virgin", "dormition") + row("⭐", "Nativity Fast (40 days)", "nativity", "nativity") +
      checkRow("🕊️", "Strict one-day fasts", p + ".fasting.feastFasts", fst.feastFasts, "Eve of Theophany, Beheading of St John, Exaltation of the Cross");
  } else {
    h += row("✝️", "Lent", "lent", "western-lent") +
      (c.denom === "catholic" || c.denom === "protestant" ? checkRow("✝️", "Ash Wednesday & Good Friday", p + ".fasting.fastDays", fst.fastDays, c.denom === "catholic" ? "Days of fasting (one full meal) and no meat" : "Fasting days, if you keep them") : "") +
      checkRow("🕯️", "Advent", p + ".fasting.advent", fst.advent, "A daily moment of prayer · " + when("advent"));
  }
  return h + '<div class="hint">See every date for the year in Faith → Fasting calendar.</div></div>';
}

// Quick picks for "Another faith or practice" — any religion or spiritual routine.
const PRACTICES = [["🙏", "Prayer"], ["📜", "Scripture reading"], ["🧘", "Meditation"], ["🙌", "Gratitude"], ["📝", "Reflection / journaling"], ["🤲", "Charity / giving"], ["🕯️", "Quiet time"], ["🎶", "Worship / chanting"]];

const TRADITIONS = [["", "🌿", "My own"], ["jewish", "✡️", "Jewish"], ["hindu", "🕉️", "Hindu"], ["sikh", "🪯", "Sikh"]];

function otherFields(p, o) {
  const base = p.replace(/\.other$/, ""), m = getPath(ui.form, base + ".muslim");
  const sm = m && m.location ? prayerTimes(today(), m.location, { method: "mwl" }) : sunMinutes(today());
  let h = '<div class="card pad stack-sm"><div class="small bold">Your tradition</div>' +
    '<div class="seg" style="--cols:4">' + TRADITIONS.map(([id, e, n]) => '<button type="button" class="' + ((o.tradition || "") === id ? "on" : "") + '" data-action="faith-tradition" data-id="' + id + '" data-path="' + p + '"><span class="emo">' + e + "</span> " + n + "</button>").join("") + "</div>";
  if (o.tradition === "jewish") {
    const j = o.jewish;
    h += checkRow("🕯️", "Shabbat candles", p + ".jewish.candles", j.candles, "Fridays, " + j.candleMin + " min before sunset — with a reminder 20 min earlier");
    if (j.candles) h += '<div class="inline" style="padding-inline-start:6px"><span class="small">Light them</span>' + selectEl(p + ".jewish.candleMin", [[18, "18 min"], [20, "20 min"], [22, "22 min"], [30, "30 min"], [40, "40 min (Jerusalem)"]], j.candleMin, ' data-num data-rerender style="width:170px"') + '<span class="small">before sunset</span></div>';
    h += checkRow("🍷", "Havdalah", p + ".jewish.havdalah", j.havdalah, "Saturday night, about " + j.havdalahMin + " min after sunset") +
      checkRow("🌅", "Shacharit", p + ".jewish.shacharit", j.shacharit, "Morning prayer, after sunrise") +
      checkRow("☀️", "Mincha", p + ".jewish.mincha", j.mincha, "Afternoon prayer, before sunset") +
      checkRow("🌙", "Maariv", p + ".jewish.maariv", j.maariv, "Evening prayer, after nightfall") +
      '<div class="small muted">Fast days</div>' + seg(p + ".jewish.fasts", [["all", "All six"], ["major", "Yom Kippur & Tisha B'Av"], ["none", "None"]], j.fasts || "all", 3) +
      '<div class="hint">Yom Kippur and Tisha B\'Av: sunset to nightfall. The Fast of Gedaliah, 10 Tevet, the Fast of Esther and 17 Tammuz: dawn to nightfall — moved when they fall on Shabbat.</div>';
  } else if (o.tradition === "hindu") {
    const hd = o.hindu;
    h += checkRow("🪔", "Puja at sunrise", p + ".hindu.sunrise", hd.sunrise, "Morning Sandhya") +
      checkRow("🌇", "Sandhya at sunset", p + ".hindu.sunset", hd.sunset, "Evening prayer and lamp") +
      checkRow("🪔", "Ekadashi fast", p + ".hindu.ekadashi", hd.ekadashi, "The 11th lunar day, twice a month — worked out from the Moon") +
      (hd.ekadashi ? seg(p + ".hindu.ekadashiRule", [["smarta", "Smarta (at sunrise)"], ["vaishnava", "Vaishnava / ISKCON"]], hd.ekadashiRule || "smarta", 2) +
        '<div class="hint">' + (hd.ekadashiRule === "vaishnava" ? "Vaishnava: Ekadashi must hold at arunodaya, 96 minutes before sunrise — sometimes a day later than Smarta." : "Smarta: the day Ekadashi holds at sunrise.") + " Check your temple's panchang when it's close.</div>" : "") +
      checkRow("🌕", "Purnima (full moon)", p + ".hindu.purnima", hd.purnima, "Fast until moonrise") +
      checkRow("🌑", "Amavasya (new moon)", p + ".hindu.amavasya", hd.amavasya, "A light fast");
  } else if (o.tradition === "sikh") {
    h += checkRow("🌄", "Japji Sahib", p + ".sikh.japji", o.sikh.japji, "When you wake — Amrit vela") +
      checkRow("🌇", "Rehras Sahib", p + ".sikh.rehras", o.sikh.rehras, "At sunset") +
      checkRow("🌙", "Kirtan Sohila", p + ".sikh.sohila", o.sikh.sohila, "Before sleep") +
      '<div class="hint">Sikh teaching doesn\'t ask for ritual fasting, so there are no fast reminders.</div>';
  }
  if (o.tradition && m) {
    const cityOpts = CITIES.map(c => [c[0], c[0]]);
    if (!CITIES.some(c => c[0] === m.location.name)) cityOpts.unshift([m.location.name, m.location.name + " (GPS)"]);
    h += '<div class="row"><div class="field grow"><label>City</label>' + selectEl("_city", cityOpts, m.location.name, ' data-onchange="faith-city" data-path="' + base + '.muslim"') + "</div>" +
      '<button type="button" class="btn sec xs" style="align-self:flex-end;height:48px" data-action="faith-gps" data-id="' + base + '.muslim">📍 Locate me</button></div>' +
      '<div class="hint"><span>Today:</span> <span>sunrise</span> <span class="tabnum">' + fmtTime(sm.sunrise) + '</span> · <span>sunset</span> <span class="tabnum">' + fmtTime(sm.sunset) + "</span>. <span>Times move with the seasons by themselves.</span></div>";
  }
  h += "</div>";
  return h + '<div class="card pad stack-sm"><div class="small bold">' + (o.tradition ? "Anything else? (optional)" : "Pick one, or type your own") + '</div><div class="chips">' +
    PRACTICES.map(([e, n], i) => '<button type="button" class="chip' + (o.practice === n ? " on" : "") + '" data-action="faith-practice" data-id="' + i + '" data-path="' + p + '"><span class="emo">' + e + "</span>" + n + "</button>").join("") + "</div>" +
    '<div class="row" style="align-items:flex-end"><button type="button" class="emo-btn" data-action="faith-emoji" data-id="' + p + '">' + o.emoji + "</button>" +
    '<div class="field grow"><label>What do you practice?</label><input data-bind="' + p + '.practice" value="' + esc(o.practice) + '" placeholder="Your faith\'s prayer, reading, fasting, a ritual…"></div></div>' +
    '<div class="inline"><span class="small">For</span>' + numInput(p + ".minutes", o.minutes, 0, 600) + '<span class="small">minutes each time (0 = just tick it off)</span></div>' +
    '<div class="small muted">Which days?</div>' + daysPicker(p + ".days", o.days) +
    '<div class="small muted">How many times a day, and when?</div>' + timeList(p + ".times", o.times, "20:00") + "</div>";
}

/**
 * "Prayers during your sleep" choice + which prayers fall in the user's sleep today.
 * @param {string} path  form path of settings.notify.sleepPrayers
 * @param {{bed:string, wake:string}} win  work-day sleep window
 * @param {object} cfg   faith config ({ muslim: … })
 */
export function sleepPrayersField(path, mode, win, cfg) {
  const pt = prayerMinutes(today(), cfg);
  const bed = toMin(win.bed), span = ((toMin(win.wake) - bed) % 1440 + 1440) % 1440;
  const asleep = PRAYERS.filter(p => cfg.muslim.prayers[p.id] && ((pt[p.id] - bed) % 1440 + 1440) % 1440 < span);
  const hint = { smart: "Fajr can wake you. Other prayers remind you when you wake up, with how long their time lasts.",
    ring: "Prayer reminders ring even while you sleep.",
    wake: "No prayer alerts while you sleep — one reminder when you wake up." }[mode || "smart"];
  return '<div class="stack-sm"><div class="small bold">Prayers during your sleep</div>' +
    seg(path, [["smart", "Smart"], ["ring", "Wake me"], ["wake", "After I wake"]], mode || "smart", 3) +
    '<div class="hint">' + hint + "</div>" +
    (asleep.length ? '<div class="okbox">During your work-day sleep: ' + asleep.map(p => p.name + " " + fmtTime(pt[p.id])).join(", ") + "</div>" : "") + "</div>";
}

// Today's Hijri date with a not-yet-saved adjustment, in the app's language.
function hijriLabelWith(off) {
  const hj = hijri(today(), off);
  if (!hj) return "";
  return currentLang() === "ar" ? hj.day + " " + HIJRI_AR_NAMES[hj.month - 1] + " " + hj.year + " هـ" : hj.day + " " + hj.monthName + " " + hj.year;
}
const HIJRI_AR_NAMES = ["محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"];

/* ---------- actions ---------- */
on("faith-fold", id => { if (opened.has(id)) opened.delete(id); else opened.add(id); rerenderOverlay(); });
// Switching sect sets the matching defaults; everything stays editable afterwards.
on("faith-sect", (id, el) => {
  const m = getPath(ui.form, el.dataset.path);
  if (!m || m.sect === id) return;
  m.sect = id;
  if (id === "shia") {
    if (!(METHODS[m.method] || {}).shia) m.method = "jafari";
    Object.assign(m, { asr: "standard", combine: true, jumuah: false });
    m.extras = Object.assign({}, m.extras, { duha: false, witr: false });
  } else {
    if ((METHODS[m.method] || {}).shia) m.method = "egypt";
    m.combine = false;
    m.asr = m.madhhab === "hanafi" ? "hanafi" : "standard";
    m.extras = Object.assign({}, m.extras, { witr: true });
  }
  rerenderOverlay();
});
on("faith-madhhab", (id, el) => {
  const m = getPath(ui.form, el.dataset.path);
  if (!m) return;
  m.madhhab = id; m.asr = id === "hanafi" ? "hanafi" : "standard";
  rerenderOverlay();
});

on("faith-city", (val, el) => {
  const m = getPath(ui.form, el.dataset.path);
  const c = CITIES.find(x => x[0] === val);
  if (c) m.location = { name: c[0], lat: c[1], lng: c[2] };
  rerenderOverlay();
});

on("faith-gps", p => {
  if (!navigator.geolocation) { toast("Location isn't available — pick your city"); return; }
  toast("Finding your location…");
  navigator.geolocation.getCurrentPosition(pos => {
    const m = getPath(ui.form, p);
    const lat = +pos.coords.latitude.toFixed(4), lng = +pos.coords.longitude.toFixed(4);
    m.location = { name: nearestCity(lat, lng) || "My location", lat, lng };
    rerenderOverlay();
    toast("Prayer times set for " + m.location.name);
  }, () => toast("Couldn't get location — pick your city instead"), { timeout: 10000, maximumAge: 3600e3 });
});

on("faith-tradition", (id, el) => {
  const o = getPath(ui.form, el.dataset.path);
  if (!o) return;
  o.tradition = id || null;
  // A sun-timed tradition replaces the generic "Meditation at 7:00" starter, unless it was customised.
  if (id && o.practice === "Meditation" && (o.times || []).join() === "07:00") o.times = [];
  rerenderOverlay();
});

on("faith-practice", (i, el) => {
  const o = getPath(ui.form, el.dataset.path), pr = PRACTICES[+i];
  if (o && pr) { o.emoji = pr[0]; o.practice = pr[1]; }
  rerenderOverlay();
});

on("faith-emoji", p => {
  const o = getPath(ui.form, p);
  openEmojiPicker(o.emoji, e => { o.emoji = e; rerenderOverlay(); });
});

