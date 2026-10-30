// Share cards people want to post: "30 days of Fajr", "Great Lent: all 55 days", "Ramadan: 29 of 29".
// Nothing leaves the phone unless you share it, and only the line on the card is shared.

import { esc, toast } from "../util.js";
import { today, addDays, keyOf } from "../dates.js";
import { currentStreak, streakUnit, isScheduled, status } from "../schedule.js";
import { SEASONS, fromIndex } from "../seasons.js";
import { hijri } from "../hijri.js";
import { on, openOverlay } from "./core.js";
import { ovHead } from "./components.js";
import { tr, trText, currentLang, arCount } from "../i18n.js";

// "30 days" / «30 يومًا» — Arabic counted nouns change with the number.
const counted = (n, unit) => currentLang() === "ar" ? arCount(n, unit) : n + " " + unit + (n === 1 ? "" : "s");

// The best thing to share about this habit right now, or null.
export function milestone(h) {
  const t = today();
  // A fasting season or Ramadan: how many of its days so far (or in the one that just ended).
  const run = seasonRun(h, t);
  if (run && run.done >= 3) return { emoji: h.emoji, big: run.done === run.of ? tr("All {n} days", { n: run.of }) : tr("{d} of {n} days", { d: run.done, n: run.of }), line: trText(run.name) };
  const s = currentStreak(h);
  if (s >= 7) return { emoji: h.emoji, big: counted(s, streakUnit(h) === "week" ? "week" : "day"), line: trText(h.name) };
  return null;
}
function seasonRun(h, t) {
  let days = [];
  if (h.schedule.season && SEASONS[h.schedule.season]) {
    const s = SEASONS[h.schedule.season];
    for (const y of [t.getFullYear(), t.getFullYear() - 1]) {
      const [a, b] = s.range(y), from = fromIndex(a), to = fromIndex(b);
      if (b < a || from > t || addDays(to, 14) < t) continue; // running now, or ended in the last two weeks
      for (let d = from; d <= to && d <= t; d = addDays(d, 1)) days.push(d);
      return count(h, days, s.name, b - a + 1);
    }
  }
  if (h.schedule.hijriMonth === 9) { // Ramadan: walk back to its first day
    for (let i = 0; i < 45; i++) { const d = addDays(t, -i), hj = hijri(d); if (hj && hj.month === 9) days.unshift(d); else if (days.length) break; }
    if (days.length) return count(h, days, "Ramadan", null);
  }
  return null;
}
function count(h, days, name, of) {
  const due = days.filter(d => isScheduled(h, d));
  return { name, done: due.filter(d => status(h, d) === "done").length, of: of || due.length };
}

export function shareButton(h) {
  return !h.private && milestone(h) ? '<button class="btn sec sm" data-action="share-milestone" data-id="' + h.id + '">📣 <span>Share this</span></button>' : "";
}

let card = null;
function renderShare() {
  return ovHead('<button class="link" data-action="close">Close</button>', "", "") +
    '<div class="ov-body"><div class="share-card"><div class="tiny" style="letter-spacing:.08em;opacity:.8">WAQTI</div><div class="spread"><div><div style="font-size:30px;font-weight:800;font-family:var(--serif)">' + esc(card.big) + '</div><div class="small" style="opacity:.9" data-no-tr>' + esc(card.line) + '</div></div><div class="emo" style="font-size:38px">' + card.emoji + "</div></div></div>" +
    '<button class="btn" data-action="share-send" style="background:#fff;color:#0f766e">Share</button><div class="center tiny" style="opacity:.8">Only this line is shared — nothing else leaves your phone.</div></div>';
}
on("share-milestone", id => {
  import("../store.js").then(({ findHabit }) => {
    const h = findHabit(id), m = h && milestone(h);
    if (!m) return;
    card = m;
    openOverlay(renderShare, { cls: "celebrate", push: true, form: null });
  });
});
on("share-send", async () => {
  if (!card) return;
  const txt = card.big + " — " + card.line + " " + card.emoji + "\n" + tr("Kept with Waqti — habits and prayers on your own clock.");
  if (navigator.share) { try { await navigator.share({ text: txt }); return; } catch (e) { /* cancelled */ } }
  try { await navigator.clipboard.writeText(txt); toast("Copied — paste it anywhere"); } catch (e) { toast(txt); }
});
