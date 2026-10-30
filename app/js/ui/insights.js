// Insights: completion over 7/30/90 days, per-day bars, best weekday,
// per-habit ranking, categories, and faith consistency.

import { state, activeHabits, save } from "../store.js";
import { esc } from "../util.js";
import { today, addDays, startOfWeek, DAY_LONG, DAY_MIN, fmtDate, fmtTime, fmtDuration } from "../dates.js";
import { sleepDrift } from "../sleep.js";
import { applyRoutine } from "../faith.js";

// A switch that runs an action (not a form binding), for settings shown on a page.
const toggleRowAction = (title, hint, on, action) => '<div class="toggle-row"><div><div class="small bold">' + title + '</div><div class="hint">' + hint + '</div></div><label class="switch"><input type="checkbox" aria-label="' + title + '" data-action="' + action + '"' + (on ? " checked" : "") + "><span></span></label></div>";
import { weeklyReview } from "../review.js";
import { dayScore, currentStreak, completion, bestStreak, isScheduled } from "../schedule.js";
import { on, ui } from "./core.js";
import { seg, emptyCard } from "./components.js";
import "./review.js"; // registers the "open-review" action

let range = 7;

on("toggle-winddown", (id, el) => { state.settings.windDown = !!el.checked; applyRoutine(); save(); ui.render(); });

export function viewInsights(app) {
  document.getElementById("hdrTitle").textContent = "Insights";
  document.getElementById("hdrSub").textContent = "Last " + range + " days";
  // Only habits that were actually due in this period (e.g. Ramadan-only habits drop out of season).
  const habits = activeHabits().filter(h => {
    for (let i = 0; i < range; i++) if (isScheduled(h, addDays(today(), -i))) return true;
    return false;
  });
  if (!habits.length) { app.innerHTML = emptyCard("📊", "No data yet", "Track a few habits for a couple of days and your trends will show up here."); return; }

  const t = today();
  let sched = 0, done = 0, perfect = 0, active = 0;
  const days = [];
  const byDow = Array.from({ length: 7 }, () => ({ s: 0, d: 0 }));
  for (let i = range - 1; i >= 0; i--) {
    const d = addDays(t, -i);
    const sc = dayScore(d, habits);
    if (i === 0 && sc.done < sc.sched) { days.push({ d, p: sc.sched ? Math.round(sc.done / sc.sched * 100) : 0, partial: true }); continue; }
    sched += sc.sched; done += sc.done;
    if (sc.sched) { active++; if (sc.done === sc.sched) perfect++; byDow[d.getDay()].s += sc.sched; byDow[d.getDay()].d += sc.done; }
    days.push({ d, p: sc.sched ? Math.round(sc.done / sc.sched * 100) : 0, empty: !sc.sched });
  }
  const pct = sched ? Math.round(done / sched * 100) : 0;
  const top = habits.reduce((m, h) => Math.max(m, currentStreak(h)), 0);

  let h = weeklyReview() ? '<button class="btn soft" data-action="open-review">🗓️ <span>Weekly review</span></button>'
    : '<div class="card pad row"><span class="emo" style="font-size:22px">🗓️</span><div class="grow small"><div class="bold">Your first weekly review</div><div class="muted"><span>Arrives</span> <span>' +
      fmtDate(addDays(startOfWeek(today()), 7), { weekday: "long", day: "numeric", month: "short" }) + "</span></div></div></div>";
  h += seg("_range", [[7, "7 days"], [30, "30 days"], [90, "90 days"]], range, 3).replace(/data-action="set"/g, 'data-action="insight-range"').replace(/data-path="_range" /g, "");
  h += '<div class="tiles">' +
    '<div class="tile accent"><div class="big tabnum">' + pct + '%</div><div class="lbl">Completed</div></div>' +
    '<div class="tile"><div class="big tabnum">' + perfect + '<span class="muted" style="font-size:15px"> / ' + active + '</span></div><div class="lbl muted">Perfect days</div></div>' +
    '<div class="tile"><div class="big tabnum">' + top + ' 🔥</div><div class="lbl muted">Top current streak</div></div>' +
    '<div class="tile"><div class="big tabnum">' + done + '</div><div class="lbl muted">Check-ins</div></div></div>';

  // Bars: daily for 7/30, weekly for 90
  let bars = "";
  if (range <= 30) {
    bars = days.map(x => '<div class="b' + (x.empty ? " empty" : "") + '" title="' + fmtDate(x.d) + ": " + x.p + '%"><div class="col"><div class="fill" style="height:' + Math.max(x.p, 3) + "%;" + (x.partial ? "opacity:.45" : "") + '"></div></div>' +
      (range === 7 ? '<div class="tiny faint">' + DAY_MIN[x.d.getDay()] + "</div>" : "") + "</div>").join("");
  } else {
    for (let w = 0; w < days.length; w += 7) {
      const chunk = days.slice(w, w + 7);
      const avg = Math.round(chunk.reduce((a, c) => a + c.p, 0) / chunk.length);
      bars += '<div class="b"><div class="col"><div class="fill" style="height:' + Math.max(avg, 3) + '%"></div></div></div>';
    }
  }
  h += '<div class="card pad stack-sm"><div class="spread"><div class="sect-title">' + (range > 30 ? "Weekly completion" : "Daily completion") + '</div><span class="tiny muted">faded = today, in progress</span></div><div class="bars">' + bars + "</div></div>";

  // Best / hardest weekday
  const dows = byDow.map((x, i) => ({ i, p: x.s ? x.d / x.s : null })).filter(x => x.p != null);
  if (dows.length >= 3 && range >= 30) {
    dows.sort((a, b) => b.p - a.p);
    h += '<div class="tiles"><div class="tile"><div class="lbl muted">Strongest day</div><div class="big" style="font-size:20px">' + DAY_LONG[dows[0].i] + '</div><div class="tiny muted">' + Math.round(dows[0].p * 100) + '% done</div></div>' +
      '<div class="tile"><div class="lbl muted">Hardest day</div><div class="big" style="font-size:20px">' + DAY_LONG[dows[dows.length - 1].i] + '</div><div class="tiny muted">' + Math.round(dows[dows.length - 1].p * 100) + "% — plan lighter?</div></div></div>";
  }

  // Per-habit ranking
  // Habits with nothing due in the period (a fast out of season) aren't ranked.
  const ranked = habits.map(x => ({ x, r: completion(x, range), s: currentStreak(x), b: bestStreak(x) })).filter(o => o.r != null).sort((a, b) => b.r - a.r);
  h += '<div class="card pad"><div class="sect-title" style="margin-bottom:6px">By habit</div><table class="table">' + ranked.map(o =>
    '<tr data-action="open-habit-list" data-id="' + o.x.id + '" style="cursor:pointer"><td style="width:30px" class="emo">' + o.x.emoji + '</td><td><div class="small bold ellipsis" style="max-width:180px">' + esc(o.x.name) + '</div><div class="catbar" style="margin-top:4px"><i style="width:' + o.r + '%"></i></div></td><td class="tabnum small" style="text-align:right;width:76px">' + o.r + '%<div class="tiny faint">best ' + o.b + "</div></td></tr>").join("") + "</table></div>";

  // Categories
  const cats = {};
  habits.forEach(x => { const c = completion(x, range); if (c != null) (cats[x.category] = cats[x.category] || []).push(c); });
  const catHtml = Object.keys(cats).map(c => {
    const avg = Math.round(cats[c].reduce((a, b) => a + b, 0) / cats[c].length);
    return '<div><div class="spread small" style="margin-bottom:5px"><span>' + esc(c) + '</span><span class="muted tabnum">' + avg + '%</span></div><div class="catbar"><i style="width:' + avg + '%"></i></div></div>';
  }).join("");
  h += '<div class="card pad stack-sm"><div class="sect-title" style="margin-bottom:4px">By category</div>' + catHtml + "</div>";

  // Sleep: logged nights, work days vs days off, and the wind-down reminder.
  const sd = sleepDrift();
  if (sd.n >= 3 || state.habits.some(x => x.source === "routine:bed")) {
    h += '<div class="card pad stack-sm"><div class="sect-title">Sleep</div>';
    if (sd.n >= 3) {
      const line = (lbl, g) => g.n ? '<div class="spread small"><span>' + lbl + '</span><span class="tabnum muted">' + fmtTime(g.bed) + "–" + fmtTime(g.wake) + " · " + fmtDuration(g.slept) + "</span></div>" : "";
      h += line("Work nights", sd.work) + line("Days off", sd.off);
      if (sd.bedGap != null && Math.abs(sd.bedGap) >= 45) h += '<div class="hint">On days off you go to bed <b class="tabnum">' + fmtDuration(Math.abs(sd.bedGap)) + "</b> " + (sd.bedGap > 0 ? "later" : "earlier") + ". Keeping it within an hour makes Monday mornings easier.</div>";
    } else h += '<div class="hint">Log a few mornings on Today (“How did you sleep?”) to see your real sleep here.</div>';
    h += toggleRowAction("Wind-down reminder", "45 minutes before bed: screens away, lights low", !!state.settings.windDown, "toggle-winddown") + "</div>";
  }

  // Faith consistency (prayers)
  const prayers = habits.filter(x => x.source && /^faith:(fajr|dhuhr|asr|maghrib|isha)$/.test(x.source) && completion(x, range) != null);
  if (prayers.length) {
    const tot = prayers.reduce((a, x) => a + completion(x, range), 0);
    const weakest = prayers.slice().sort((a, b) => completion(a, range) - completion(b, range))[0];
    h += '<div class="card pad stack-sm"><div class="spread"><div class="sect-title">Prayers</div><span class="badge live">' + Math.round(tot / prayers.length) + '% prayed</span></div>' +
      '<div class="row" style="justify-content:space-between">' + prayers.map(p => '<div class="center"><div class="tabnum bold">' + completion(p, range) + '%</div><div class="tiny muted">' + esc(p.name.replace(" prayer", "")) + "</div></div>").join("") + "</div>" +
      (completion(weakest, range) < 100 ? '<div class="hint">Focus prayer: <b>' + esc(weakest.name) + "</b>. Try a reminder 10 min earlier or a follow-up nudge.</div>" : '<div class="okbox">MashaAllah — every prayer logged in this period.</div>') + "</div>";
  }
  app.innerHTML = h;
}

on("insight-range", (id, el) => { range = +el.dataset.val; ui.render(); });

