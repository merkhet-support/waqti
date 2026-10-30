// Quit trackers: clean-time counter, money saved, milestones, slip history.

import { state, findQuit, save, rememberEmoji } from "../store.js";
import { esc, uid, toast, deepClone, plural } from "../util.js";
import { keyOf, fromKey, addDays, fmtDate, fmtTime, DAY_SHORT } from "../dates.js";
import { on, openOverlay, closeOverlay, rerenderOverlay, ui } from "./core.js";
import { ovHead, toggleRow } from "./components.js";
import { riskyWindow } from "../quits.js";
import { openEmojiPicker } from "./emoji-picker.js";

const MILES = [1, 3, 7, 14, 30, 60, 90, 180, 365, 730];
// Ready-made trackers. Some default to cutting down rather than stopping outright.
// The first nine show straight away; the more sensitive ones (alcohol, painkillers, gambling, porn) sit
// behind "More…", so a teenager opening the list doesn't see them first (Gen Alpha panel).
const PRESETS = [["🚭", "Smoking"], ["🌬️", "Vaping"], ["🍬", "Sugar"], ["📱", "Doom-scrolling"], ["🥤", "Soda"], ["☕", "Too much coffee", { mode: "limit", limit: 2, unit: "cups" }],
  ["🍔", "Fast food"], ["🍫", "Late-night snacking"], ["🎮", "Gaming late"],
  ["⏰", "Hitting snooze"], ["😠", "Losing my temper"], ["💅", "Nail biting"], ["💸", "Impulse buying"],
  ["🍺", "Alcohol"], ["💊", "Too many painkillers", { mode: "limit", limit: null, unit: "pills" }], ["🎰", "Gambling"], ["🔞", "Porn"]];
// Stopping some of these all at once after daily use can be medically dangerous (alcohol,
// opioid painkillers like tramadol or codeine, sleeping pills) — say so, and never promise results.
const CARE = /alcohol|drink|beer|wine|whisk|vodka|pain ?killer|pill|tramadol|codeine|opioid|morphine|sleeping|benzo|xanax|valium|كحول|خمر|مسكن|ترامادول|منوم/i;
const careNote = () => '<div class="warn small"><b>⚠️ <span>Stopping safely</span></b><div>If you\'ve been using this every day, talk to a doctor or pharmacist before stopping all at once — for some people, stopping suddenly is dangerous. Cutting down step by step is often safer.</div></div>';
// Where to get help, for the trackers where outside support matters most. Phone numbers only once
// verified for that country: Egypt's addiction helpline 16023 (Fund for Drug Control and Treatment
// of Addiction) covers drugs and alcohol, so it's shown for those trackers to people in Egypt.
const inEgypt = () => { try { if (Intl.DateTimeFormat().resolvedOptions().timeZone === "Africa/Cairo") return true; } catch (e) { /* ignore */ } return (state.settings.currency || "") === "EGP"; };
const supportNote = q => {
  if (!CARE.test(q.name) && !/gambl|bet|قمار|رهان/i.test(q.name)) return "";
  const egypt = CARE.test(q.name) && inEgypt();
  return '<div class="card pad small stack-xs"><div>🤝 <span>You don\'t have to do this alone. Your doctor, a pharmacist or a local addiction support service can help — and so can someone you trust.</span></div>' +
    (egypt ? '<div>📞 <span>In Egypt: addiction helpline</span> <a href="tel:16023" class="bold tabnum" data-no-tr>16023</a> <span class="muted">(free, confidential)</span></div>' : "") + "</div>";
};
// Replacement ideas by what's being quit (matched on the name).
const REPLACE = {
  "smok|cigar|vap|shisha": ["Chew gum", "5 slow deep breaths", "Drink a glass of water", "A 5-minute walk"],
  "alcohol|drink|beer|wine": ["A cold soft drink or juice", "Call a friend", "Leave before the next round", "A walk after work"],
  "pain|pill|tramadol|codeine": ["Ask a pharmacist about other pain relief", "A warm or cold pack", "Rest, stretch and drink water", "Write down when the pain started"],
  "gambl|bet": ["Wait 24 hours", "Call someone you trust", "Put the money in savings now"],
  "porn": ["Leave the room", "Go for a walk", "Pray or make dhikr", "Put the phone in another room"],
  "snack|late": ["Brush your teeth", "A cup of tea", "Get ready for bed"],
  "nail": ["Keep your hands busy", "File the nail instead", "Hold something in your hand"],
  "temper|angry|shout": ["Leave the room for 2 minutes", "5 slow deep breaths", "Make wudu or wash your face", "Say it later, not now"],
  "snooze": ["Put the alarm across the room", "Sit up straight away", "Open the curtains"],
  "sugar|sweet|soda|dessert": ["Fruit or nuts", "Sparkling water", "Brush your teeth", "A cup of tea"],
  "scroll|social|phone|tiktok|instagram": ["Read 2 pages", "Put the phone in another room", "Stretch for 2 minutes", "Message a friend"],
  "coffee|caffeine": ["Herbal tea", "A glass of water", "A short walk outside"],
  "gaming": ["Set a 30-minute timer", "Get ready for bed", "Read instead"],
  "buy|shopping|spend": ["Wait 24 hours", "Add it to a wish list", "Check the budget first"],
  "": ["A 5-minute walk", "Drink a glass of water", "Call someone", "5 slow deep breaths"]
};
// What happens in the body after the last cigarette (WHO). Hours.
const BODY = [[0.33, "Heart rate and blood pressure drop"], [12, "Carbon monoxide in the blood returns to normal"], [336, "Circulation and lung function start to improve (2 weeks – 3 months)"],
  [720, "Coughing and shortness of breath decrease (1–9 months)"], [8760, "Risk of heart disease is about half a smoker's (1 year)"], [43800, "Stroke risk falls to a non-smoker's (5–15 years)"]]; // WHO gives a 5–15 year range

function startMs(q) {
  const [y, m, d] = String(q.start).split("-").map(Number);
  const [hh, mm] = String(q.startTime || "00:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
}
export function quitDays(q) { return q.mode === "limit" ? limitRun(q) : Math.max(0, Math.floor((Date.now() - startMs(q)) / 86400000)); }

// Cut-down trackers count uses a day against your limit. A day counts once it's over and you
// stayed within the limit; going over today resets the run.
const calToday = () => addDays(new Date(), 0); // uses are logged by calendar date, not habit day
const usesOn = (q, d) => (q.uses || []).filter(u => keyOf(new Date(u.at)) === keyOf(d)).length;
const within = (q, d) => usesOn(q, d) <= (+q.limit || 0);
function limitRun(q) {
  const start = fromKey(q.start);
  if (!within(q, new Date())) return 0;
  let n = 0;
  for (let d = addDays(calToday(), -1), i = 0; d >= start && i < 3000 && within(q, d); d = addDays(d, -1), i++) n++;
  return n;
}
function limitBest(q) {
  let best = 0, run = 0;
  for (let d = fromKey(q.start), i = 0; d < calToday() && i < 3000; d = addDays(d, 1), i++) { run = within(q, d) ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}
function quitHours(q) { return Math.max(0, Math.floor((Date.now() - startMs(q)) / 3600000) % 24); }
function saved(q) { return q.perDay ? Math.round((Date.now() - startMs(q)) / 86400000 * q.perDay) : null; }
function longest(q) {
  if (q.mode === "limit") return Math.max(limitBest(q), limitRun(q));
  const runs = (q.slips || []).map(s => s.days || 0);
  return Math.max(quitDays(q), ...runs, 0);
}
const mLabel = m => m < 30 ? m + "d" : m < 365 ? Math.round(m / 30) + "mo" : (m / 365) + "y";
const cur = () => state.settings.currency || "EGP";

export function openQuitEditor(id) {
  const q = id ? deepClone(findQuit(id)) : { id: uid(), name: "", emoji: "🚭", start: keyOf(new Date()), startTime: "", perDay: null, why: "", slips: [], _new: true };
  openOverlay(renderQuitEditor, { form: q, push: !!id });
}

function renderQuitEditor() {
  const q = ui.form;
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', q._new ? "Quit a habit" : "Edit", '<button class="link" data-action="save-quit">Save</button>');
  h += '<div class="ov-body">';
  h += '<div class="row" style="align-items:flex-end"><button type="button" class="emo-btn" data-action="quit-emoji">' + q.emoji + '</button><div class="field grow"><label>What are you quitting?</label><input data-bind="name" value="' + esc(q.name) + '" placeholder="e.g. Smoking, sugar, scrolling at night" data-rerender></div></div>';
  if (q._new) h += '<div class="chips">' + PRESETS.map((p, i) => [p, i]).slice(0, q._more ? PRESETS.length : 9).map(([[e, n], i]) => '<button type="button" class="chip" data-action="quit-preset" data-id="' + i + '"><span class="emo">' + e + "</span>" + n + "</button>").join("") +
    '<button type="button" class="chip" data-action="quit-more">' + (q._more ? "Fewer" : "More…") + "</button></div>";
  if (CARE.test(q.name)) h += careNote();
  const limit = q.mode === "limit";
  h += '<div class="seg" style="--cols:2"><button type="button" class="' + (limit ? "" : "on") + '" data-action="quit-mode" data-id="quit">🚫 <span>Stop completely</span></button><button type="button" class="' + (limit ? "on" : "") + '" data-action="quit-mode" data-id="limit">📉 <span>Cut down</span></button></div>';
  if (limit) {
    h += '<div class="row"><div class="field" style="width:110px"><label>No more than</label><input type="number" min="0" inputmode="numeric" data-bind="limit" value="' + (q.limit == null || q.limit === "" ? "" : +q.limit) + '" placeholder="?"></div><div class="field grow"><label>a day of…</label><input data-bind="unit" value="' + esc(q.unit || "") + '" placeholder="pills, cups, drinks" maxlength="16"></div></div>' +
      '<div class="hint">' + (CARE.test(q.name) ? "Use the limit your doctor or pharmacist agreed with you — Waqti can't tell you a safe amount." : "Every day you stay within your limit counts. Lower it step by step when you're ready.") + "</div>";
    h += '<div class="field"><label>Counting from</label><input type="date" data-bind="start" value="' + esc(q.start) + '" max="' + keyOf(new Date()) + '"></div>';
  } else {
    h += '<div class="row"><div class="field grow"><label>Free since</label><input type="date" data-bind="start" value="' + esc(q.start) + '" max="' + keyOf(new Date()) + '"></div><div class="field grow"><label>Time (optional)</label><input type="time" data-bind="startTime" value="' + esc(q.startTime || "") + '"></div></div>';
    h += '<div class="field"><label>Money saved per day (' + cur() + ", optional)</label><input type=\"number\" min=\"0\" inputmode=\"decimal\" data-bind=\"perDay\" value=\"" + (q.perDay == null ? "" : q.perDay) + '" placeholder="e.g. 60"></div>';
  }
  h += '<div class="card pad">' + toggleRow("🔒 Keep private", "private", !!q.private, "The lock screen says “Waqti reminder” instead of the name, and there's no share card", false) + "</div>";
  h += '<div class="field"><label>Why it matters to you (shown when it gets hard)</label><textarea data-bind="why" maxlength="200" placeholder="For my kids, my lungs, my wallet…">' + esc(q.why || "") + "</textarea></div>";
  // What to do instead — shown during an urge and in the heads-up reminder.
  const ideas = REPLACE[(Object.keys(REPLACE).find(k => new RegExp(k, "i").test(q.name)) || "")] || REPLACE[""];
  h += '<div class="field"><label>Instead, I will…</label><input data-bind="replacement" value="' + esc(q.replacement || "") + '" placeholder="e.g. chew gum and take 5 deep breaths" maxlength="80"></div>' +
    '<div class="chips">' + ideas.map(x => '<button type="button" class="chip" data-action="set" data-path="replacement" data-val="' + esc(x) + '">' + esc(x) + "</button>").join("") + "</div>";
  if (!q._new) h += '<button class="btn danger sm" data-action="del-quit" data-id="' + q.id + '">Delete tracker</button>';
  return h + "</div>";
}

export function openQuit(id) { openOverlay(() => renderQuit(id), { form: null }); }

function renderQuit(id) {
  const q = findQuit(id);
  if (!q) return ovHead('<button class="link" data-action="close">Back</button>', "", "");
  const days = quitDays(q), sv = saved(q);
  const next = MILES.find(m => m > days);
  let h = ovHead('<button class="link" data-action="close">Back</button>', esc(q.name), '<button class="link" data-action="edit-quit" data-id="' + q.id + '">Edit</button>');
  h += '<div class="ov-body">';
  if (q.mode === "limit") return h + renderLimit(q, days, next) + "</div>";
  h += '<div class="card pad center stack-xs"><div class="emo" style="font-size:34px">' + q.emoji + '</div><div class="small muted">Free for</div><div class="tabnum" style="font-size:58px;font-weight:700;font-family:var(--serif);color:var(--accent);line-height:1">' + days + '</div><div class="bold">' + (days === 1 ? "day" : "days") + " " + quitHours(q) + "h</div>" +
    (next ? '<div class="tiny muted">' + plural(next - days, "day") + " to your " + mLabel(next) + " milestone</div>" : "") + "</div>";
  h += '<div class="tiles">' + (sv != null ? '<div class="tile"><div class="big tabnum">' + sv.toLocaleString() + '</div><div class="lbl muted">' + cur() + " saved</div></div>" : "") +
    '<div class="tile"><div class="big tabnum">' + longest(q) + '</div><div class="lbl muted">Longest run (days)</div></div>' +
    (sv == null ? '<div class="tile"><div class="big tabnum">' + (q.slips || []).length + '</div><div class="lbl muted">Restarts</div></div>' : "") + "</div>";
  if (q.why) h += '<div class="card pad"><div class="eyebrow">Your why</div><div data-no-tr style="margin-top:4px;font-family:var(--serif);font-size:16px">“' + esc(q.why) + "”</div></div>";
  h += '<div class="card pad stack-sm"><div class="small bold">Milestones</div><div class="chips">' + MILES.map(m => '<span class="chip' + (days >= m ? " on" : "") + '"' + (m === next ? ' style="border:2px dashed var(--accent)"' : "") + ">" + (days >= m ? "✓ " : "") + mLabel(m) + "</span>").join("") + "</div></div>";
  if (CARE.test(q.name)) h += careNote();
  h += supportNote(q);
  h += '<button class="btn" data-action="urge" data-id="' + q.id + '">🌊 I have an urge</button>';
  const risk = riskyWindow(q), urges = (q.urges || []).filter(u => u.passed).length;
  if (risk) h += '<div class="card pad stack-sm"><div class="small bold">⏰ <span>Your hardest time</span></div><div class="small"><span class="tabnum">' + fmtTime(risk.from) + "–" + fmtTime(risk.to % 1440) + '</span> · <span class="tabnum">' + risk.n + " / " + risk.of + "</span> <span>urges and slips</span></div>" +
    '<div class="toggle-row"><div><div class="small bold">Heads-up 15 minutes before</div><div class="hint">' + (q.replacement ? "<span>With your plan:</span> " + esc(q.replacement) : "Add what you'll do instead in Edit") + "</div></div>" +
    '<label class="switch"><input type="checkbox" aria-label="Heads-up 15 minutes before" data-action="quit-risk" data-id="' + q.id + '"' + (q.riskRemind !== false ? " checked" : "") + "><span></span></label></div></div>";
  else if (urges) h += '<div class="okbox"><span>Urges you rode out:</span> <b class="tabnum">' + urges + "</b> 💪</div>";
  if (/smok|cigar|vap|shisha/i.test(q.name)) {
    const hrs = (Date.now() - startMs(q)) / 3600e3;
    h += '<div class="card pad stack-xs"><div class="small bold">🫁 <span>Your body since you stopped</span></div>' + BODY.map(([at, t]) => '<div class="small' + (hrs >= at ? "" : " muted") + '">' + (hrs >= at ? "✓ " : "○ ") + "<span>" + t + "</span></div>").join("") + '<div class="tiny muted">Source: World Health Organization</div></div>';
  }
  if (!q.private) h += '<button class="btn sec" data-action="celebrate" data-id="' + q.id + '">Share my progress</button>';
  h += '<button class="btn sec" data-action="slip" data-id="' + q.id + '">I slipped — restart the counter</button>';
  if ((q.slips || []).length) h += '<div class="card pad stack-xs"><div class="small bold">History</div>' + q.slips.slice().reverse().slice(0, 8).map(s => '<div class="spread small"><span>' + fmtDate(s.date) + '</span><span class="muted">' + plural(s.days, "day") + " run</span></div>").join("") + "</div>";
  return h + "</div>";
}

// Cut-down trackers: days within the limit, today's count with − / +, and the last 7 days.
function renderLimit(q, days, next) {
  const u = usesOn(q, new Date()), lim = +q.limit || 0, unit = q.unit || "times", over = u > lim;
  let h = '<div class="card pad center stack-xs"><div class="emo" style="font-size:34px">' + q.emoji + '</div><div class="small muted">Within your limit for</div><div class="tabnum" style="font-size:58px;font-weight:700;font-family:var(--serif);color:var(--accent);line-height:1">' + days + '</div><div class="bold">' + (days === 1 ? "day" : "days") + "</div>" +
    (next ? '<div class="tiny muted">' + plural(next - days, "day") + " to your " + mLabel(next) + " milestone</div>" : "") + "</div>";
  h += '<div class="card pad stack-sm"><div class="spread"><div class="small bold">Today</div><div class="tiny muted"><span>Limit:</span> <span class="tabnum">' + lim + '</span> <span data-no-tr>' + esc(unit) + "</span></div></div>" +
    '<div class="row" style="justify-content:center;gap:16px"><button class="icon-btn" style="width:48px;height:48px;font-size:22px" data-action="quit-use" data-dir="-" data-id="' + q.id + '" aria-label="One less"' + (u ? "" : " disabled") + '>−</button>' +
    '<div class="center"><div class="tabnum" style="font-size:34px;font-weight:700;font-family:var(--serif);color:' + (over ? "var(--danger)" : "inherit") + '">' + u + '<span class="muted" style="font-size:18px"> / ' + lim + "</span></div></div>" +
    '<button class="icon-btn" style="width:48px;height:48px;font-size:22px" data-action="quit-use" data-dir="+" data-id="' + q.id + '" aria-label="Log one">+</button></div>' +
    (over ? '<div class="small center" style="color:var(--danger)">Over your limit today — tomorrow is a fresh start.</div>' : '<div class="hint center">Tap + each time. Only you see this.</div>') + "</div>";
  const week = Array.from({ length: 7 }, (_, i) => addDays(calToday(), i - 6)).filter(d => d >= fromKey(q.start));
  if (week.length > 1) h += '<div class="card pad stack-xs"><div class="small bold">Last 7 days</div><div class="row" style="justify-content:space-between">' +
    week.map(d => { const n = usesOn(q, d), ok = n <= lim; return '<div class="center"><div class="tiny muted">' + DAY_SHORT[d.getDay()] + '</div><div class="tabnum bold" style="color:' + (ok ? "var(--accent)" : "var(--danger)") + '">' + n + "</div></div>"; }).join("") + "</div></div>";
  h += '<div class="tiles"><div class="tile"><div class="big tabnum">' + longest(q) + '</div><div class="lbl muted">Longest run (days)</div></div></div>';
  if (CARE.test(q.name)) h += careNote();
  h += supportNote(q);
  if (q.why) h += '<div class="card pad"><div class="eyebrow">Your why</div><div data-no-tr style="margin-top:4px;font-family:var(--serif);font-size:16px">“' + esc(q.why) + "”</div></div>";
  h += '<button class="btn sec" data-action="urge" data-id="' + q.id + '">🌊 I have an urge</button>';
  return h;
}

function renderCelebrate(id) {
  const q = findQuit(id); if (!q) return "";
  const days = quitDays(q), sv = saved(q);
  return ovHead('<button class="link" data-action="close">Close</button>', '<span style="color:var(--on-accent)">Milestone</span>', "") +
    '<div class="ov-body"><div class="center" style="padding:14px 0"><div class="emo" style="font-size:52px">🎉</div><div style="opacity:.9;margin-top:4px">You\'ve stayed free for</div><div style="font-size:64px;font-weight:700;font-family:var(--serif);line-height:1">' + days + '</div><div style="font-size:20px;font-weight:600">days</div></div>' +
    '<div class="share-card"><div class="tiny" style="letter-spacing:.08em;opacity:.8">WAQTI</div><div class="spread"><div><div style="font-size:30px;font-weight:800;font-family:var(--serif)">' + days + ' days</div><div class="small" style="opacity:.9">free of ' + esc(q.name.toLowerCase()) + "</div></div><div class=\"emo\" style=\"font-size:38px\">🔥</div></div>" + (sv != null ? '<div class="small" style="opacity:.9">' + sv.toLocaleString() + " " + cur() + " saved</div>" : "") + "</div>" +
    '<button class="btn" data-action="share-quit" data-id="' + q.id + '" style="background:#fff;color:#0f766e">Share</button>' +
    '<div class="center tiny" style="opacity:.8">Opens your phone\'s share sheet — or copies the text.</div></div>';
}

on("quit-emoji", () => openEmojiPicker(ui.form.emoji, e => { ui.form.emoji = e; rerenderOverlay(); }));
on("quit-preset", id => {
  const [e, n, extra] = PRESETS[+id];
  // Trackers people rarely want seen on a lock screen start private (it can be switched off).
  Object.assign(ui.form, { emoji: e, name: n, mode: "quit", limit: null, unit: "", private: CARE.test(n) || /gambl|porn/i.test(n) }, extra || {});
  rerenderOverlay();
});
on("quit-more", () => { ui.form._more = !ui.form._more; rerenderOverlay(); });
on("quit-mode", id => { ui.form.mode = id; rerenderOverlay(); });
on("quit-use", (id, el) => {
  const q = findQuit(id); if (!q) return;
  if (el.dataset.dir === "-") { const k = keyOf(new Date()), i = (q.uses || []).map(u => keyOf(new Date(u.at)) === k).lastIndexOf(true); if (i >= 0) q.uses.splice(i, 1); }
  else q.uses = (q.uses || []).concat([{ at: Date.now() }]).slice(-500);
  save(); rerenderOverlay(); ui.render();
  if (el.dataset.dir !== "-" && !within(q, new Date())) toast("Over your limit today — tomorrow is a fresh start");
});
on("add-quit", () => openQuitEditor());
on("edit-quit", id => openQuitEditor(id));
on("open-quit", id => openQuit(id));
on("save-quit", () => {
  const q = ui.form;
  q.name = (q.name || "").trim();
  if (!q.name) { toast("Name it first"); return; }
  q.perDay = q.perDay === "" || q.perDay == null || isNaN(+q.perDay) ? null : +q.perDay;
  if (q.mode === "limit" && (q.limit === "" || q.limit == null || isNaN(+q.limit))) { toast("Set your daily limit first"); return; }
  if (q.mode === "limit") { q.limit = Math.max(0, Math.round(+q.limit)); q.unit = (q.unit || "").trim(); q.perDay = null; q.startTime = ""; }
  const isNew = q._new; delete q._new; delete q._more;
  rememberEmoji(q.emoji);
  if (isNew) state.quits.push(q); else { const i = state.quits.findIndex(x => x.id === q.id); if (i >= 0) state.quits[i] = q; }
  save(); closeOverlay(); toast(isNew ? "Tracking started 🔥" : "Saved");
});
on("del-quit", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = "Tap again to delete"; return; }
  state.quits = state.quits.filter(x => x.id !== id); save(); closeOverlay({ all: true }); toast("Deleted");
});
on("slip", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = "Restart from now? Tap again"; return; }
  const q = findQuit(id); if (!q) return;
  q.slips = (q.slips || []).concat([{ date: keyOf(new Date()), days: quitDays(q), at: Date.now() }]);
  q.start = keyOf(new Date());
  const n = new Date(); q.startTime = String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0");
  save(); rerenderOverlay(); toast("Counter restarted — one slip doesn't erase your progress 💪");
});
/* ---------- riding out an urge: two minutes, breathing, your why and your plan ---------- */
let urgeTimer = null;
function renderUrge(id) {
  const q = findQuit(id); if (!q) return "";
  return ovHead('<button class="link" data-action="urge-end" data-id="' + q.id + '">Close</button>', "Ride it out", "") +
    '<div class="ov-body center stack"><div class="small muted">Urges peak and fade within a few minutes. Breathe with the circle.</div>' +
    '<div class="breathe" aria-hidden="true"></div><div id="urge-phase" class="bold" aria-live="polite">Breathe in…</div>' +
    '<div id="urge-left" class="tabnum" style="font-size:40px;font-family:var(--serif);font-weight:700">2:00</div>' +
    (q.why ? '<div class="card pad"><div class="eyebrow">Your why</div><div data-no-tr style="font-family:var(--serif);font-size:16px;margin-top:4px">“' + esc(q.why) + "”</div></div>" : "") +
    '<div class="card pad small"><b>Instead:</b> <span>' + esc(q.replacement || "drink a glass of water and walk for 5 minutes") + "</span></div>" +
    '<button class="btn" data-action="urge-passed" data-id="' + q.id + '">It passed 💪</button><button class="btn ghost" data-action="urge-slipped" data-id="' + q.id + '">I slipped</button></div>';
}
function stopUrge() { if (urgeTimer) { clearInterval(urgeTimer); urgeTimer = null; } }
on("urge", id => {
  openOverlay(() => renderUrge(id), { push: true, form: null });
  stopUrge();
  const end = Date.now() + 120000;
  urgeTimer = setInterval(() => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000)), l = document.getElementById("urge-left"), p = document.getElementById("urge-phase");
    if (!l) { stopUrge(); return; }
    l.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    if (p) p.textContent = left === 0 ? "Well done. How do you feel?" : (Math.floor((120 - left) / 4) % 2 ? "Breathe out…" : "Breathe in…");
    if (!left) stopUrge();
  }, 1000);
});
const logUrge = (id, passed) => { const q = findQuit(id); if (q) { q.urges = (q.urges || []).concat([{ at: Date.now(), passed }]).slice(-200); save(); } };
on("urge-passed", id => { stopUrge(); logUrge(id, true); closeOverlay(); toast("You rode it out 💪 — that's how habits change"); });
on("urge-slipped", id => {
  stopUrge(); logUrge(id, false); closeOverlay();
  const q = findQuit(id);
  if (q && q.mode === "limit") { q.uses = (q.uses || []).concat([{ at: Date.now() }]).slice(-500); save(); rerenderOverlay(); toast(within(q, new Date()) ? "Logged — still within your limit" : "Over your limit today — tomorrow is a fresh start"); return; }
  const b = document.querySelector('[data-action="slip"]'); if (b) b.click(); });
on("urge-end", () => { stopUrge(); closeOverlay(); });
on("quit-risk", (id, el) => { const q = findQuit(id); if (q) { q.riskRemind = !!el.checked; save(); } });

on("celebrate", id => openOverlay(() => renderCelebrate(id), { cls: "celebrate", push: true, form: null }));
on("share-quit", async id => {
  const q = findQuit(id); if (!q) return;
  const sv = saved(q);
  const txt = "I'm " + quitDays(q) + " days free of " + q.name.toLowerCase() + " with Waqti" + (sv != null ? " — " + sv.toLocaleString() + " " + cur() + " saved" : "") + " 🔥";
  if (navigator.share) { try { await navigator.share({ text: txt }); return; } catch (e) { /* cancelled */ } }
  try { await navigator.clipboard.writeText(txt); toast("Copied — paste it anywhere"); } catch (e) { toast(txt); }
});
