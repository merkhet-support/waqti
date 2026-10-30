// Me: everything about you in one place — your week, insights, faith, fasting, quit trackers,
// family lists, requests and settings. The tab bar stays the same for everyone (Today · Plan · + ·
// Habits · Me); before, a faith replaced Insights in the bar and the weekly review hid after
// Tuesday (the two-year review's top "where did it go?" findings).

import { state, activeHabits } from "../store.js";
import { esc } from "../util.js";
import { today, addDays } from "../dates.js";
import { dayScore } from "../schedule.js";
import { weeklyReview } from "../review.js";
import { religionLabel } from "../faith.js";
import { quitDays } from "./quit.js";
import { incomingWaiting } from "../requests.js";
import { lifeRows } from "./life.js";

const row = (action, id, icon, title, val) => '<button class="li" data-action="' + action + '"' + (id ? ' data-id="' + id + '"' : "") + '><span class="lic">' + icon + '</span><span class="grow small bold">' + title + "</span>" + (val ? '<span class="val">' + val + "</span>" : "") + '<span class="chev">›</span></button>';

export function viewMe(app) {
  const f = state.profile.faith || {}, t = today();
  document.getElementById("hdrTitle").textContent = state.profile.name || "Me";
  document.getElementById("hdrSub").textContent = activeHabits().length + " habits" + (f.religion ? " · " + religionLabel(f.religion, f.other && f.other.tradition) : "");
  // The last 7 days at a glance.
  let s = 0, d = 0;
  for (let i = 1; i <= 7; i++) { const x = dayScore(addDays(t, -i)); s += x.sched; d += x.done; }
  const r = weeklyReview();
  let h = '<button class="card pad row" data-action="open-review" style="width:100%;text-align:start;font:inherit;color:inherit"><span class="emo" style="font-size:26px">🗓️</span><span class="grow"><span class="small bold" style="display:block">Your week in review</span>' +
    '<span class="tiny muted"><span class="tabnum">' + (s ? Math.round(d / s * 100) : 0) + "%</span> <span>kept in the last 7 days</span>" + (r && r.month ? " · <span>month look-back inside</span>" : "") + '</span></span><span class="faint">›</span></button>';
  h += '<div class="list">' + row("tab", "insights", "📊", "Insights") +
    (f.religion ? row("tab", "faith", "🤲", "Faith", esc(religionLabel(f.religion, f.other && f.other.tradition))) + row("open-fasts", "", "🍽️", "Fasting calendar") : row("faith-setup", "", "🤲", "Faith reminders", "Off")) + "</div>";
  const quits = state.quits || [];
  h += '<div class="group-label"><span class="eyebrow">Quitting</span><span class="line"></span></div><div class="list">' +
    quits.map(q => row("open-quit", q.id, q.emoji, '<span data-no-tr>' + esc(q.name) + "</span>", '<span class="tabnum">' + quitDays(q) + "</span> <span>days</span>")).join("") + row("add-quit", "", "🚭", "Quit a habit") + "</div>";
  h += '<div class="group-label"><span class="eyebrow">Home &amp; life</span><span class="line"></span></div><div class="list">' + lifeRows() + "</div>";
  const waiting = incomingWaiting().length;
  h += '<div class="group-label"><span class="eyebrow">Together</span><span class="line"></span></div><div class="list">' +
    row("open-lists", "", "🛒", "Family lists", (state.lists || []).length ? '<span class="tabnum">' + state.lists.length + "</span>" : "") +
    row("open-requests", "", "📨", "Requests & people", waiting ? '<span class="badge soon">' + waiting + " new</span>" : "") + "</div>";
  h += '<div class="list">' + row("tab", "settings", "⚙️", "Settings") + "</div>";
  app.innerHTML = h;
}
