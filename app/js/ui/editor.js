// Add / edit a habit: name & icon, goal type, a flexible schedule, and
// reminders that can follow fixed times, a window, your routine or prayers.

import { state, newHabit, findHabit, save, rememberEmoji } from "../store.js";
import { esc, deepClone, toast } from "../util.js";
import { today, addDays, fmtDate, fmtTime, fmtDuration, toMin, fromMin, fromKey, keyOf } from "../dates.js";
import { KINDS, isScheduled, describeSchedule, keepPastSchedule, keepPastTarget, isMedicine } from "../schedule.js";
import { MODES, NAG_OPTIONS, reminderMinutes, describeReminders } from "../reminders.js";
import { hasWork, isWorkDay, ANCHORS, anchorsFor, inSleep, suggestedTime } from "../routine.js";
import { TIME_POINTS } from "../prayer.js";
import { sunMinutes, SUN_POINTS, prayerLocation } from "../faith.js";
import { CATEGORIES, TEMPLATES } from "../templates.js";
import { on, openOverlay, closeOverlay, rerenderOverlay, ui } from "./core.js";
import { seg, chipsSet, daysPicker, switchEl, timeList, selectEl, numInput, ovHead, toggleRow } from "./components.js";
import { openEmojiPicker } from "./emoji-picker.js";
import { HABIT_COLORS, colorOf } from "../colors.js";

const OFFSETS = [-120, -90, -60, -45, -30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
const offLabel = o => o === 0 ? "Right at" : fmtDuration(Math.abs(o)) + (o < 0 ? " before" : " after");

export function openEditor(id, preset) {
  const existing = id ? findHabit(id) : null;
  const draft = existing ? deepClone(existing) : newHabit(preset || {});
  if (!existing) fitToRoutine(draft);
  if (!existing && preset) applyTemplate(draft, preset);
  draft._isNew = !existing;
  openOverlay(renderEditor, { form: draft, push: !!existing });
  if (!existing && !preset) setTimeout(() => { const n = document.getElementById("f-name"); if (n) n.focus(); }, 50);
}

function applyTemplate(d, t) {
  const base = newHabit();
  Object.assign(d, { name: t.name, emoji: t.emoji, category: t.category, type: t.type || "check", target: t.target || 1, step: t.step || 1, unit: t.unit || "", notes: t.notes || "", auto: t.auto ? Object.assign({}, t.auto) : null });
  d.schedule = Object.assign(base.schedule, t.schedule || {});
  d.reminders = Object.assign(base.reminders, t.reminders || {});
  d.reminders.interval = Object.assign(base.reminders.interval, (t.reminders || {}).interval || {});
  if (d.reminders.lead) d.reminders.lead = d.reminders.lead.slice();
  // Yearly ideas start on today's date until you set the real one.
  if (d.schedule.kind === "yearly" && !d.schedule.occasion) { const td = today(); d.schedule.month = td.getMonth() + 1; d.schedule.monthDay = td.getDate(); }
  if (d.category === "Bills") { d.bill = { amount: null }; d.private = true; }
  if (d.reminders.mode === "routine" && !hasWork() && /^work/.test(d.reminders.anchor)) { d.reminders.anchor = "wake"; d.reminders.offset = 60; }
  // A template time that lands while you sleep (e.g. 10 AM for a night worker) follows your wake-up instead.
  if (d.reminders.mode === "times" && (d.reminders.times || []).some(t => inSleep(toMin(t), today()))) {
    Object.assign(d.reminders, { mode: "routine", anchor: "wake", offset: 120 });
  }
  if (d.reminders.mode === "interval") fitToRoutine(d, true);
  // Medicine-style templates: one reminder per dose, relative to your own wake-up / bedtime.
  if (t.doses) {
    const a = anchorsFor(today());
    Object.assign(d.reminders, { mode: "times", times: t.doses.map(([an, o]) => fromMin((an === "bed" ? a.bed : a.wake) + o)) });
  }
}

// New-habit defaults that respect the user's sleep: next full hour while awake, and a
// repeat window from 30 min after waking to an hour before bed.
function fitToRoutine(d, windowOnly) {
  const a = anchorsFor(today());
  if (!windowOnly) d.reminders.times = [fromMin(suggestedTime(Date.now(), today()))];
  d.reminders.interval = Object.assign({}, d.reminders.interval, { from: fromMin(a.wake + 30), to: fromMin(a.bed - 60) });
}

function renderEditor() {
  const d = ui.form;
  const cats = Array.from(new Set(CATEGORIES.concat(state.habits.map(h => h.category))));
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', d._isNew ? "New habit" : "Edit habit", '<button class="link" data-action="save-habit">Save</button>');
  h += '<div class="ov-body">';

  if (d._isNew) {
    // The first 8 ideas as quick chips; "More ideas…" shows them all, grouped by category.
    const chip = ([t, i]) => '<button type="button" class="chip" data-action="use-template" data-id="' + i + '"><span class="emo">' + t.emoji + "</span>" + esc(t.name) + "</button>";
    const all = TEMPLATES.map((t, i) => [t, i]), more = '<button type="button" class="chip" data-action="editor-ideas">' + (d._ideas ? "Fewer" : "More ideas…") + "</button>";
    if (!d._ideas) h += '<div class="section"><div class="eyebrow">Quick ideas</div><div class="chips">' + all.slice(0, 8).map(chip).join("") + (all.length > 8 ? more : "") + "</div></div>";
    else {
      const order = CATEGORIES.concat(all.map(([t]) => t.category).filter(c => !CATEGORIES.includes(c)));
      h += '<div class="section"><div class="eyebrow">Ideas by category</div>' + Array.from(new Set(order)).map(c => {
        const list = all.filter(([t]) => t.category === c);
        return list.length ? '<div class="idea-group"><div class="tiny muted bold">' + esc(c) + '</div><div class="chips">' + list.map(chip).join("") + "</div></div>" : "";
      }).join("") + '<div class="chips">' + more + "</div></div>";
    }
    if (!state.settings.hideHabitTips) h += habitTips(d);
  }

  // Name + icon
  h += '<div class="row" style="align-items:flex-end">' +
    '<button type="button" class="emo-btn" data-action="editor-emoji" aria-label="Change icon">' + d.emoji + "</button>" +
    '<div class="field grow"><label for="f-name">Habit name</label><input id="f-name" data-bind="name" value="' + esc(d.name) + '" placeholder="e.g. Haircut at the barber" maxlength="60" autocomplete="off"></div></div>';
  h += '<div class="hint" style="margin-top:-8px">Tap the icon for 1,000+ emoji, or use your phone\'s emoji keyboard.</div>';

  // Goal
  h += '<div class="card pad stack-sm"><div class="bold small">Goal</div>' +
    seg("type", [["check", "✓ Just do it"], ["count", "# Reach a number"]], d.type, 2);
  if (d.type === "count") {
    h += '<div class="inline"><span class="small">Reach</span>' + numInput("target", d.target, 1, 100000) +
      '<input class="input sm" style="width:120px" data-bind="unit" value="' + esc(d.unit) + '" placeholder="unit">' +
      '<span class="small">per day</span></div>' +
      '<div class="chips">' + ["times", "glasses", "L", "min", "pages", "steps", "km", "reps"].map(u => '<button type="button" class="chip' + (d.unit === u ? " on" : "") + '" data-action="set" data-path="unit" data-val="' + u + '" style="min-height:32px">' + u + "</button>").join("") + "</div>" +
      '<div class="inline"><span class="small">Each tap adds</span>' + numInput("step", d.step, 1, 100000) + '<span class="small muted">' + esc(d.unit || "") + "</span></div>";
  }
  h += "</div>";

  h += scheduleEditor(d);
  h += detailsEditor(d);
  h += reminderEditor(d);
  h += leadEditor(d);

  // Everything else folds away (the editor was 3.5 screens tall). The button names what's set inside.
  const set = [d.color && "Colour", d.category && d.category !== "Daily Rhythm" && d.category, d.auto && "Automatic", d.key && "⭐ Top 3", d.schedule.end && "End date", (d.schedule.onlyOn || "any") !== "any" && "Work days", d.notes && "Notes", d.private && "🔒 Private"].filter(Boolean);
  h += '<button type="button" class="btn sec sm more-btn" data-action="editor-more" aria-expanded="' + !!d._more + '"><span>' + (d._more ? "Fewer options" : "More options") + "</span>" + (set.length && !d._more ? ' <span class="tiny muted" data-no-tr>· ' + esc(set.join(" · ")) + "</span>" : "") + "</button>";
  if (d._more) {
    h += '<div class="section"><div class="eyebrow">Colour</div><div class="swatches">' +
      '<button type="button" class="swatch auto' + (!d.color ? " on" : "") + '" data-action="set" data-path="color" data-val="" style="--sw:' + colorOf(Object.assign({}, d, { color: null })) + '" aria-label="Auto colour from category">A</button>' +
      HABIT_COLORS.map(c => '<button type="button" class="swatch' + (d.color === c ? " on" : "") + '" data-action="set" data-path="color" data-val="' + c + '" style="--sw:' + c + '" aria-label="Colour ' + c + '"></button>').join("") + "</div></div>";
    h += '<div class="section"><div class="eyebrow">Category</div>' + chipsSet("category", cats.map(c => [c, esc(c)]), d.category) +
      '<input class="input" data-bind="category" value="' + esc(d.category) + '" placeholder="Or type your own category" data-rerender maxlength="24"></div>';
    h += scheduleMore(d);
    h += autoEditor(d);
    h += '<div class="card pad">' + toggleRow("⭐ One of my top 3", "key", !!d.key, "Your most important habits — starred on Today and celebrated when done", false) +
      (d.category === "Health" ? toggleRow("💊 This is a medicine", "medicine", isMedicine(d), "Keeps reminding on rest days and sick days, and each dose is ticked on its own", false) : "") +
      toggleRow("🔒 Keep private", "private", !!d.private, "Reminders say “Waqti reminder” on the lock screen, and it stays off widgets, summaries and share cards", false) + "</div>";
    h += '<div class="field"><label>Notes (optional)</label><textarea data-bind="notes" placeholder="Why it matters, how to do it, where…" maxlength="300">' + esc(d.notes) + "</textarea></div>";
  }

  if (!d._isNew) {
    h += '<div class="row"><button class="btn sec sm" data-action="archive-habit" data-id="' + d.id + '">' + (d.archived ? "Restore habit" : "Archive (keep history)") + "</button>" +
      '<button class="btn danger sm" data-action="delete-habit" data-id="' + d.id + '">Delete</button></div>';
  }
  h += '<button class="btn" data-action="save-habit">Save habit</button>';
  return h + "</div>";
}

/* ---------- "How to make it stick" ---------- */
// Short, practical advice shown while adding a habit. Open by default for new users.
const TIPS = [
  ["🤏", "Start tiny.", "Make it so small you can't say no: one glass, one page, two minutes. Grow it later."],
  ["🔗", "Attach it to something you already do.", "\"After Fajr, I read one page.\" Use the Around my routine or Around prayer times reminder."],
  ["👀", "Make it easy to see.", "Put the bottle, book or shoes where you'll notice them at the right moment."],
  ["✅", "Tick it right away.", "Mark it done the moment you finish — the streak is part of the reward."],
  ["🔁", "Never miss twice.", "Missing a day is normal. Skip it here so your streak is safe — just don't miss two in a row."]
];
const CATEGORY_TIP = {
  Nutrition: "Keep a full bottle where you work and refill it each time you're reminded.",
  Fitness: "Lay out your clothes the night before. On a busy shift, 10 minutes still counts.",
  Health: "Keep your medicine next to something you use every day, like your toothbrush or kettle.",
  Sleep: "Waking at the same time — even on days off — makes sleep easier.",
  Faith: "Pair it with a prayer you already never miss.",
  Family: "A short call every day beats a long one now and then. Try it on your way home.",
  Growth: "Leave the book on your pillow or the app on your home screen.",
  Home: "Do it at the same point every day, like right before bed.",
  Money: "Review on the same day each month, and automate saving if you can.",
  Grooming: "Book the next appointment before you leave the barber or salon.",
  Work: "Before you leave, write tomorrow's top three."
};
function habitTips(d) {
  const open = state.habits.filter(x => !x.archived).length < 5;
  const extra = CATEGORY_TIP[d.category];
  return '<details class="card pad tips"' + (open ? " open" : "") + '><summary class="small bold">💡 How to make it stick</summary><div class="stack-sm" style="margin-top:10px">' +
    TIPS.map(([e, t, s]) => '<div class="row" style="align-items:flex-start;gap:10px"><span class="emo">' + e + '</span><div class="grow small"><b>' + t + "</b> " + s + "</div></div>").join("") +
    (extra ? '<div class="okbox">' + extra + "</div>" : "") +
    '<button type="button" class="link small" data-action="hide-tips" style="align-self:flex-start">Don\'t show tips again</button></div></details>';
}
on("hide-tips", () => { state.settings.hideHabitTips = true; save(); rerenderOverlay(); });

/* ---------- health auto-tracking ---------- */
function autoEditor(d) {
  const a = d.auto ? d.auto.source : "off";
  let h = '<div class="card pad stack-sm"><div class="bold small">Fill in automatically</div>' +
    '<div class="seg" style="--cols:3">' + [["off", "Off"], ["steps", "👟 Steps"], ["workout", "🏋️ Workouts"]].map(o => '<button type="button" class="' + (a === o[0] ? "on" : "") + '" data-action="editor-auto" data-id="' + o[0] + '">' + o[1] + "</button>").join("") + "</div>";
  if (a === "steps") h += '<div class="hint">Your daily step count from Apple Health / Health Connect is written here'+ (d.type === "count" ? "" : " — switch the goal to “Reach a number” and set e.g. 8000 steps") + '.</div>';
  if (a === "workout") h += '<div class="inline"><span class="small">Done when workouts add up to</span>' + numInput("auto.minMinutes", d.auto.minMinutes || 20, 1, 600) + '<span class="small">min</span></div>';
  if (a !== "off") h += '<div class="hint">Works in the Android/iOS app once Health is connected (Settings → Health & fitness). Fitbit, Garmin, Samsung Health and Strava count if they sync to your phone\'s health app.</div>';
  return h + "</div>";
}

/* ---------- schedule ---------- */
const DAYS31 = Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)]);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Heads-ups before the day (bills, birthdays, renewals). Shown for habits that don't come every day.
const LEAD_KINDS = ["weeks", "interval", "monthly", "months", "yearly"];
function leadEditor(d) {
  if (!LEAD_KINDS.includes(d.schedule.kind)) return "";
  const lead = (d.reminders && d.reminders.lead) || [];
  return '<div class="card pad stack-sm"><div class="bold small">Heads-up before</div><div class="chips">' +
    [1, 2, 3, 7, 14, 30].map(n => '<button type="button" class="chip' + (lead.includes(n) ? " on" : "") + '" data-action="toggle-in" data-path="reminders.lead" data-val="' + n + '" data-num>' + (n === 1 ? "1 day" : n + " days") + "</button>").join("") + "</div>" +
    '<div class="hint">A reminder that many days ahead, at the habit\'s reminder time (or 9 AM) — time to pay, book or buy a gift.</div></div>';
}
// Bills: the amount; car maintenance: the distance.
function detailsEditor(d) {
  let h = "";
  if (d.category === "Bills" || d.bill) h += '<div class="field"><label>Amount (' + esc(state.settings.currency || "") + ', optional)</label><input type="number" min="0" inputmode="decimal" data-bind="bill.amount" value="' + esc(d.bill && d.bill.amount != null ? d.bill.amount : "") + '" placeholder="e.g. 450"></div>';
  if (d.car) h += '<div class="inline"><span class="small">Also due every</span><input class="input num" type="number" min="0" step="500" inputmode="numeric" data-bind="car.everyKm" value="' + esc(d.car.everyKm || "") + '" style="width:110px"><span class="small">km, whichever comes first</span></div>';
  return h;
}
function scheduleEditor(d) {
  const s = d.schedule;
  let h = '<div class="card pad stack-sm"><div class="spread"><div class="bold small">How often?</div><span class="tiny muted">' + esc(describeSchedule(d)) + "</span></div>";
  h += seg("schedule.kind", KINDS.map(k => [k.id, k.label]), s.kind, 3);
  if (s.kind === "days") {
    h += '<div class="small muted">Pick the days</div>' + daysPicker("schedule.days", s.days) +
      '<div class="chips">' +
      '<button type="button" class="chip" data-action="set-days" data-id="0,1,2,3,4">Sun–Thu</button>' +
      '<button type="button" class="chip" data-action="set-days" data-id="1,2,3,4,5">Mon–Fri</button>' +
      '<button type="button" class="chip" data-action="set-days" data-id="5,6">Fri & Sat</button>' +
      '<button type="button" class="chip" data-action="set-days" data-id="0,6">Sat & Sun</button></div>';
  } else if (s.kind === "perWeek") {
    h += '<div class="inline"><span class="small">Any</span>' + numInput("schedule.perWeek", s.perWeek, 1, 7, " data-rerender") + '<span class="small">days a week — you choose which</span></div>' +
      '<div class="hint">Shows every day until you hit your weekly number. Streaks count in weeks.</div>';
  } else if (s.kind === "interval") {
    h += '<div class="inline"><span class="small">Every</span>' + numInput("schedule.n", s.n, 1, 365, " data-rerender") + '<span class="small">days, counting from the start date</span></div>';
  } else if (s.kind === "weeks") {
    h += '<div class="small muted">On which day(s)?</div>' + daysPicker("schedule.days", s.days) +
      '<div class="inline"><span class="small">every</span>' + numInput("schedule.n", s.n, 1, 52, " data-rerender") + '<span class="small">week(s)</span></div>' +
      '<div class="hint">Example: Thursday every 3 weeks for a haircut, or Mon + Thu every 2 weeks.</div>';
  } else if (s.kind === "monthly") {
    h += '<div class="inline"><span class="small">On day</span>' + selectEl("schedule.monthDay", Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)]).concat([["last", "Last day"]]), s.monthDay, ' style="width:130px" data-rerender') + '<span class="small">of every month</span></div>';
  } else if (s.kind === "months") {
    h += '<div class="inline"><span class="small">Every</span>' + numInput("schedule.n", s.n, 1, 24, " data-rerender") + '<span class="small">months</span></div>' +
      '<div class="row"><div class="field grow"><label>Next one on</label><input type="date" data-bind="schedule.start" value="' + esc(s.start || keyOf(today())) + '" data-rerender></div></div>' +
      '<div class="hint">Then the same day every few months. Example: an oil change every 6 months, or a vet visit every 3.</div>';
  } else if (s.kind === "yearly") {
    // A new yearly habit starts on its start date until a real date is picked.
    if (!s.occasion && !s.month) { const st = fromKey(s.start || keyOf(today())); s.month = st.getMonth() + 1; s.monthDay = st.getDate(); }
    h += seg("schedule.occasion", [["", "A date"], ["mothers-day", "Mother's Day"], ["fathers-day", "Father's Day"]], s.occasion || "", 3);
    if (!s.occasion) h += '<div class="inline"><span class="small">On</span>' + selectEl("schedule.monthDay", DAYS31, s.monthDay || 1, ' style="width:80px" data-num data-rerender') +
      selectEl("schedule.month", MONTHS.map((m, i) => [i + 1, m]), s.month || 1, ' style="width:150px" data-num data-rerender') + '<span class="small">every year</span></div>';
    else h += '<div class="hint">Follows the date in your country (Settings → Region).</div>';
  }
  // Preview the next few dates
  const next = [];
  for (let i = 0, dd = today(); i < 120 && next.length < 5; i++, dd = addDays(dd, 1)) if (isScheduled(Object.assign({}, d, { archived: false }), dd)) next.push(dd);
  h += '<div class="okbox">Next: ' + (next.length ? next.map(x => fmtDate(x)).join(" · ") : "nothing in the next 4 months — check the settings") + "</div>";
  return h + "</div>";
}

// Start/end dates and work-day-only: under "More options".
function scheduleMore(d) {
  const s = d.schedule;
  let h = '<div class="card pad stack-sm"><div class="bold small">When it runs</div>' +
    '<div class="row"><div class="field grow"><label>Starting</label><input type="date" data-bind="schedule.start" value="' + esc(s.start) + '" data-rerender></div>' +
    '<div class="field grow"><label>Ending (optional)</label><input type="date" data-bind="schedule.end" value="' + esc(s.end || "") + '" min="' + esc(s.start || "") + '" data-rerender></div></div>';
  if (s.end) h += '<div class="hint">After ' + esc(fmtDate(fromKey(s.end), { day: "numeric", month: "long", year: "numeric" })) + ' it stops by itself and moves to Habits → Ended. Good for a course of medicine, a challenge or a season.</div>';
  if (hasWork()) h += '<div class="small muted">Only on…</div>' + seg("schedule.onlyOn", [["any", "Any day"], ["work", "Work days"], ["off", "Days off"]], s.onlyOn || "any", 3);
  return h + "</div>";
}
on("editor-more", () => { ui.form._more = !ui.form._more; rerenderOverlay(); });
on("editor-ideas", () => { ui.form._ideas = !ui.form._ideas; rerenderOverlay(); });

/* ---------- reminders ---------- */
function reminderEditor(d) {
  const r = d.reminders;
  const muslim = state.profile.faith && state.profile.faith.religion === "muslim";
  let h = '<div class="card pad stack-sm"><div class="toggle-row"><div><div class="bold small">Reminders</div><div class="hint">Phone notification for this habit</div></div>' + switchEl("reminders.on", r.on) + "</div>";
  if (!r.on) return h + "</div>";
  const modes = MODES.filter(m => m.id !== "prayer" || muslim || r.mode === "prayer");
  h += seg("reminders.mode", modes.map(m => [m.id, m.label]), r.mode, 2);

  if (r.mode === "times") {
    h += '<div class="small muted">Remind me at</div>' + timeList("reminders.times", r.times, fromMin(suggestedTime(Date.now(), today())));
    if (d.type === "count" && d.target > 1 && r.times.length < 2) h += '<div class="hint">Tip: add several times, or use "Repeat in a window" to spread reminders across the day.</div>';
  } else if (r.mode === "interval") {
    h += '<div class="inline"><span class="small">Every</span>' + selectEl("reminders.interval.every", [[30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1.5 hours"], [120, "2 hours"], [180, "3 hours"], [240, "4 hours"]], r.interval.every, ' style="width:130px" data-num data-rerender') + "</div>" +
      '<div class="inline"><span class="small">from</span><input class="input time" type="time" data-bind="reminders.interval.from" value="' + esc(r.interval.from) + '" data-rerender><span class="small">to</span><input class="input time" type="time" data-bind="reminders.interval.to" value="' + esc(r.interval.to) + '" data-rerender></div>';
  } else if (r.mode === "routine") {
    const anchors = ANCHORS.filter(a => hasWork() || !/^work/.test(a.id));
    h += '<div class="small muted">Relative to</div>' + seg("reminders.anchor", anchors.map(a => [a.id, a.label[0].toUpperCase() + a.label.slice(1)]), r.anchor, 2) +
      '<div class="inline"><span class="small">When</span>' + selectEl("reminders.offset", OFFSETS.map(o => [o, offLabel(o)]), r.offset || 0, ' style="width:160px" data-num data-rerender') + "</div>";
    h += '<div class="hint">Follows your schedule automatically — different times on work days and days off, and it works for night shifts.</div>';
  } else if (r.mode === "prayer") {
    h += '<div class="small muted">Prayer / time</div>' + selectEl("reminders.prayer", TIME_POINTS.map(p => [p.id, p.name]), r.prayer, " data-rerender") +
      '<div class="small muted">When (pick one or more)</div><div class="chips">' +
      [-30, -15, -10, -5, 0, 10, 15, 30, 45].map(o => '<button type="button" class="chip' + ((r.offsets || []).includes(o) ? " on" : "") + '" data-action="toggle-in" data-path="reminders.offsets" data-val="' + o + '" data-num>' + (o === 0 ? "At the time" : Math.abs(o) + "m " + (o < 0 ? "before" : "after")) + "</button>").join("") + "</div>";
  } else if (r.mode === "sun") {
    const sm = sunMinutes(today()), loc = prayerLocation(today());
    h += seg("reminders.sun", SUN_POINTS.map(p => [p.id, p.name]), r.sun || "sunset", 3) +
      '<div class="small muted">When (pick one or more)</div><div class="chips">' +
      [-60, -30, -18, -10, 0, 10, 30, 42, 60].map(o => '<button type="button" class="chip' + ((r.offsets || []).includes(o) ? " on" : "") + '" data-action="toggle-in" data-path="reminders.offsets" data-val="' + o + '" data-num>' + (o === 0 ? "At the time" : Math.abs(o) + "m " + (o < 0 ? "before" : "after")) + "</button>").join("") + "</div>" +
      '<div class="hint"><span>Today in</span> <span data-no-tr>' + esc(loc ? loc.name : "") + '</span>: <span>sunrise</span> <span class="tabnum">' + fmtTime(sm.sunrise) + '</span> · <span>sunset</span> <span class="tabnum">' + fmtTime(sm.sunset) + "</span>. <span>Moves with the seasons by itself. Change the city in Faith setup.</span></div>";
  }

  h += '<div class="inline"><span class="small">If not done, remind again</span>' + selectEl("reminders.nag", NAG_OPTIONS.map(n => [n, n ? "after " + fmtDuration(n) : "No repeat"]), r.nag || 0, ' style="width:150px" data-num data-rerender') + "</div>";

  // Preview
  const prev = [];
  for (let i = 0, dd = today(); i < 14 && prev.length < 4; i++, dd = addDays(dd, 1)) {
    if (!isScheduled(Object.assign({}, d, { archived: false }), dd)) continue;
    const mins = reminderMinutes(d, dd);
    if (!mins.length) continue;
    const label = (i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmtDate(dd, { weekday: "short" })) + (hasWork() && r.mode === "routine" ? (isWorkDay(dd) ? " (work)" : " (off)") : "");
    prev.push(label + ": " + mins.slice(0, 4).map(m => fmtTime(m)).join(", ") + (mins.length > 4 ? " +" + (mins.length - 4) : ""));
  }
  h += '<div class="okbox">' + esc(describeReminders(d)) + (prev.length ? "<br>" + prev.map(esc).join("<br>") : "") + "</div>";
  return h + "</div>";
}

/* ---------- actions ---------- */
on("use-template", id => {
  const t = TEMPLATES[+id];
  if (!t) return;
  applyTemplate(ui.form, t);
  rerenderOverlay();
});
on("editor-auto", id => {
  const d = ui.form;
  d.auto = id === "off" ? null : id === "steps" ? { source: "steps" } : { source: "workout", minMinutes: 20 };
  if (id === "steps" && d.type !== "count") { d.type = "count"; d.target = 8000; d.step = 1000; d.unit = "steps"; }
  rerenderOverlay();
});
on("set-days", id => { ui.form.schedule.days = id.split(",").map(Number); rerenderOverlay(); });
on("editor-emoji", () => openEmojiPicker(ui.form.emoji, e => { ui.form.emoji = e; rerenderOverlay(); }));

on("save-habit", () => {
  const d = ui.form;
  d.name = (d.name || "").trim();
  if (!d.name) { toast("Give it a name first"); return; }
  if ((d.schedule.kind === "days" || d.schedule.kind === "weeks") && !(d.schedule.days || []).length) { toast("Pick at least one day"); return; }
  if (!d.schedule.end) delete d.schedule.end;
  else if (d.schedule.start && d.schedule.end < d.schedule.start) { toast("The end date is before the start date"); return; }
  if (d.reminders.on && d.reminders.mode === "times") d.reminders.times = (d.reminders.times || []).filter(Boolean);
  if (d.reminders.on && d.reminders.mode === "times" && !d.reminders.times.length) { toast("Add a reminder time, or switch reminders off"); return; }
  if (d.reminders.on && (d.reminders.mode === "prayer" || d.reminders.mode === "sun") && !(d.reminders.offsets || []).length) d.reminders.offsets = [0];
  if (d.reminders.mode === "sun" && !d.reminders.sun) d.reminders.sun = "sunset";
  d.category = (d.category || "").trim() || "Daily Rhythm";
  if (d.schedule.kind === "yearly" && !d.schedule.occasion) { const t = today(); d.schedule.month = +d.schedule.month || t.getMonth() + 1; d.schedule.monthDay = +d.schedule.monthDay || t.getDate(); }
  if (d.schedule.kind !== "yearly") delete d.schedule.occasion;
  if (d.bill) d.bill.amount = d.bill.amount === "" || isNaN(+d.bill.amount) ? null : +d.bill.amount;
  if (d.car) d.car.everyKm = Math.max(0, Math.round(+d.car.everyKm || 0));
  if (d.type === "count") { d.target = Math.max(1, Math.round(+d.target || 1)); d.step = Math.max(1, Math.round(+d.step || 1)); }
  if (d.key && state.habits.filter(x => x.key && !x.archived && x.id !== d.id).length >= 3) { toast("You already have 3 top habits — unstar one first"); return; }
  const isNew = d._isNew;
  delete d._isNew; delete d._more; delete d._ideas;
  rememberEmoji(d.emoji);
  if (isNew) state.habits.push(d);
  else { const i = state.habits.findIndex(x => x.id === d.id); if (i >= 0) { keepPastSchedule(state.habits[i], d); if (state.habits[i].type === "count") keepPastTarget(state.habits[i].target, d); state.habits[i] = d; } }
  save();
  closeOverlay();
  toast(isNew ? "Habit added 🌱" : "Saved");
});

on("archive-habit", id => {
  const h = findHabit(id); if (!h) return;
  h.archived = !h.archived;
  save();
  closeOverlay({ all: true });
  toast(h.archived ? "Archived — find it at the bottom of Habits" : "Restored");
});

on("delete-habit", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = "Tap again to delete forever"; return; }
  state.habits = state.habits.filter(x => x.id !== id);
  save();
  closeOverlay({ all: true });
  toast("Deleted");
});

