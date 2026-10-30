// Screens for requests between people: "Ask someone", an incoming request (accept / change / decline),
// the Requests & people hub, and the share step that sends a link over WhatsApp, SMS, email…

import { state, save } from "../store.js";
import { esc, toast } from "../util.js";
import { keyOf, fromKey, today, addDays, fmtTime, fmtDate, relDay, weekOrder, DAY_LONG } from "../dates.js";
import { REMIND_OPTIONS, newTask } from "../tasks.js";
import {
  createRequest, resendRequest, cancelRequest, answer, receive, decodeMessage, extractCode, linkFor, shareText,
  allowSender, blockSender, incomingWaiting, contact, ensureIdentity
} from "../requests.js";
import { on, ui, openOverlay, closeOverlay, rerenderOverlay, overlayOpen } from "./core.js";
import { ovHead, selectEl, daysPicker } from "./components.js";
import { openEmojiPicker } from "./emoji-picker.js";
import { extractKey } from "../lists.js";

// absolute = true for text sent to someone else ("Tomorrow" would be wrong when they read it later).
export function whenText(t, absolute) {
  if (t.repeat) {
    const r = t.repeat;
    const every = r.kind === "daily" ? "Every day" : r.kind === "monthly" ? "Monthly on day " + (t.date ? +t.date.slice(8, 10) : 1)
      : "Every " + weekOrder().filter(d => r.days.includes(d)).map(d => DAY_LONG[d]).join(", ");
    return every + (t.time ? " · " + fmtTime(t.time) : "");
  }
  if (!t.date) return t.time ? fmtTime(t.time) : "";
  const d = fromKey(t.date);
  const day = !absolute && ["Today", "Tomorrow"].includes(relDay(d)) ? relDay(d) : fmtDate(d, { weekday: "short", day: "numeric", month: "short" });
  return day + (t.time ? " · " + fmtTime(t.time) : "");
}
const remindText = t => t.remind == null || t.remind === "" ? "" : (REMIND_OPTIONS.find(o => o[0] === +t.remind) || [0, ""])[1];
const STATUS = { sent: ["⏳", "Waiting"], accepted: ["✅", "Accepted"], changed: ["✏️", "Accepted with a change"], declined: ["❌", "Declined"], cancelled: ["🚫", "Cancelled"], new: ["📨", "New"], updated: ["🔄", "Updated"] };
const badge = s => { const x = STATUS[s] || STATUS.sent; return '<span class="req-status ' + s + '"><span class="emo">' + x[0] + "</span> <span>" + x[1] + "</span></span>"; };

/* ---------- the details form (shared by Ask and Change & accept) ---------- */
function detailsForm(t, opts) {
  const tk = keyOf(today()), tm = keyOf(addDays(today(), 1));
  const mode = !t.date ? "none" : t.date === tk ? "today" : t.date === tm ? "tomorrow" : "pick";
  let h = '<div class="row" style="align-items:flex-end"><button type="button" class="emo-btn" data-action="req-emoji" aria-label="Choose an icon">' + (t.emoji || "📌") + "</button>" +
    '<div class="field grow"><label for="r-title">' + (opts.titleLabel || "What should they do?") + '</label><input id="r-title" data-bind="' + opts.p + 'title" value="' + esc(t.title) + '" placeholder="e.g. Pick up Grandma from the airport" maxlength="120"></div></div>';
  h += '<div class="card pad stack-sm"><div class="small bold">When</div><div class="seg" style="--cols:4">' +
    [["today", "Today", tk], ["tomorrow", "Tomorrow", tm], ["pick", "Pick a day", t.date || tk], ["none", "No date", ""]].map(([k, l, v]) =>
      '<button type="button" class="' + (mode === k ? "on" : "") + '" data-action="req-date" data-id="' + v + '" data-mode="' + k + '">' + l + "</button>").join("") + "</div>";
  if (mode === "pick") h += '<input class="input" type="date" data-bind="' + opts.p + 'date" value="' + esc(t.date) + '" data-rerender>';
  const rk = t.repeat ? t.repeat.kind : "once";
  h += '<div class="small bold">Repeat</div><div class="seg" style="--cols:4">' + [["once", "Once"], ["daily", "Every day"], ["days", "Weekly"], ["monthly", "Monthly"]].map(([k, l]) =>
    '<button type="button" class="' + (rk === k ? "on" : "") + '" data-action="req-repeat" data-id="' + k + '">' + l + "</button>").join("") + "</div>";
  if (rk === "days") h += daysPicker(opts.p + "repeat.days", t.repeat.days || []);
  if (t.repeat) h += '<div class="hint">They\'ll get it as a habit with its own reminder' + (rk === "monthly" && t.date ? " — on day " + (+t.date.slice(8, 10)) + " of each month" : "") + ".</div>";
  h += '<div class="row"><div class="field grow"><label>Time (optional)</label><input type="time" data-bind="' + opts.p + 'time" value="' + esc(t.time || "") + '"></div>' +
    '<div class="field grow"><label>Reminder</label>' + selectEl(opts.p + "remind", REMIND_OPTIONS.map(o => [o[0] == null ? "null" : o[0], o[1]]), t.remind == null ? "null" : t.remind) + "</div></div></div>";
  if (opts.notes !== false) h += '<div class="field"><label>Note (optional)</label><textarea data-bind="' + opts.p + 'notes" maxlength="500" placeholder="Flight MS 778, Terminal 3…">' + esc(t.notes || "") + "</textarea></div>";
  return h;
}
const formTask = () => ui.form.edit ? ui.form.edit : ui.form;
on("req-emoji", () => { const t = formTask(); openEmojiPicker(t.emoji, e => { t.emoji = e; rerenderOverlay(); }); });
on("req-date", (v, el) => {
  const t = formTask(), mode = el.dataset.mode;
  t.date = mode === "none" ? "" : v;
  if (mode === "pick" && (!t.date || t.date === keyOf(today()) || t.date === keyOf(addDays(today(), 1)))) t.date = keyOf(addDays(today(), 2));
  rerenderOverlay();
});
on("req-repeat", kind => {
  const t = formTask();
  if (kind === "once") t.repeat = null;
  else if (kind === "days") t.repeat = { kind: "days", days: t.repeat && t.repeat.days ? t.repeat.days : [t.date ? fromKey(t.date).getDay() : today().getDay()] };
  else t.repeat = { kind };
  rerenderOverlay();
});
function cleanTask(t) {
  t.title = (t.title || "").trim();
  if (t.remind === "null" || t.remind === "" || t.remind === undefined) t.remind = null; else t.remind = +t.remind;
  if (t.repeat && t.repeat.kind === "days" && !(t.repeat.days || []).length) t.repeat = null;
  return t;
}

/* ---------- Ask someone ---------- */
export function openAsk(prefill, resend) {
  const f = Object.assign({ to: "", title: "", emoji: "", date: keyOf(today()), time: "", remind: 60, notes: "" }, prefill || {});
  f._resend = resend ? resend.id : null;
  openOverlay(renderAsk, { form: f, push: true });
  setTimeout(() => { const n = document.getElementById(f._resend ? "r-title" : "r-to"); if (n) n.focus(); }, 50);
}
function renderAsk() {
  const f = ui.form;
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', f._resend ? "Edit request" : "Ask someone", "") + '<div class="ov-body">';
  if (!f._resend) h += '<div class="field"><label for="r-to">Who are you asking?</label><input id="r-to" data-bind="to" value="' + esc(f.to) + '" placeholder="e.g. John, Mom, the family group" maxlength="40"></div>';
  h += detailsForm(f, { p: "" });
  h += '<div class="hint">You\'ll send a link by WhatsApp, SMS or email. They can accept, change it, or say no — and you\'ll see their answer when they send it back.</div>';
  h += '<button class="btn" data-action="req-send">' + (f._resend ? "Send the update" : "📨 <span>Send request</span>") + "</button></div>";
  return h;
}
on("req-send", async () => {
  const f = cleanTask(ui.form);
  if (!f.title) { toast("Write what you're asking for"); return; }
  if (!state.profile.name) { toast("Add your name in Settings → Profile so they know who's asking"); }
  let r, code;
  if (f._resend) { r = state.requests.find(x => x.id === f._resend); code = await resendRequest(r, f); }
  else ({ request: r, code } = await createRequest(f, f.to));
  save();
  closeOverlay();
  openShare("req", r, code);
});

/* ---------- share step ---------- */
function openShare(kind, r, code, task) {
  const shown = task || r.task;
  const link = linkFor(code), text = shareText(kind, Object.assign({}, r, { task: shown }), whenText(shown, true), link);
  const title = { req: "Send your request", accepted: "Let them know", changed: "Send your change", declined: "Let them know", cancel: "Send the cancellation" }[kind];
  const who = kind === "req" ? r.to : r.from && r.from.name;
  openShareText(title, text, kind === "req" ? "When they answer, they'll send you a link back. Tap it (or paste it in Requests) to see their reply." : "", who);
}
// The "send this message" step, shared by requests and family lists.
export function openShareText(title, text, hint, who) {
  openOverlay(() => ovHead("<span></span>", esc(title), '<button class="link" data-action="close">Done</button>') + '<div class="ov-body">' +
    '<div class="small muted">' + (who ? '<span>Send this to</span> <b data-no-tr>' + esc(who) + "</b> <span>— any app works.</span>" : "Send this link — any app works.") + "</div>" +
    '<div class="card pad share-preview small" data-no-tr>' + esc(text).replace(/\n/g, "<br>") + "</div>" +
    '<button class="btn" data-action="req-share">📤 <span>Share…</span></button>' +
    '<button class="btn sec" data-action="req-copy">📋 <span>Copy message</span></button>' +
    (hint ? '<div class="hint">' + esc(hint) + "</div>" : "") + "</div>",
  { form: { text }, push: true });
}
on("req-share", async () => {
  const { text } = ui.form;
  const c = window.Capacitor, sh = c && c.Plugins && c.Plugins.Share;
  try {
    if (sh && c.isNativePlatform && c.isNativePlatform()) { await sh.share({ text, dialogTitle: "Send with…" }); return; }
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  copy(text);
});
on("req-copy", () => copy(ui.form.text));
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied — paste it in WhatsApp, SMS or email"); }
  catch (e) { toast("Couldn't copy — select the message and copy it"); }
}

/* ---------- an incoming request ---------- */
export function openIncoming(r, trust) {
  openOverlay(renderIncoming, { form: { rid: r.id, trust: trust || null, edit: null, declining: false, note: "" }, push: true });
}
function renderIncoming() {
  const f = ui.form, r = state.requests.find(x => x.id === f.rid);
  if (!r) return ovHead('<button class="link" data-action="close">Close</button>', "Request", "") + '<div class="ov-body"><div class="hint">This request was removed.</div></div>';
  const c = contact(r.from.id);
  let h = ovHead('<button class="link" data-action="close">Close</button>', "Request", "") + '<div class="ov-body">';
  h += '<div class="row"><span class="emo" style="font-size:30px">📨</span><div class="grow"><div class="small muted">From</div><div class="sect-title">' + esc(r.from.name) + "</div>" +
    '<div class="tiny">' + (r.verified ? '<span class="up">🔒 <span>Signed by their phone</span></span>' : '<span class="muted">Not signed — only accept if you expected it</span>') + "</div></div>" + badge(r.status) + "</div>";
  if (r.pendingAllow && !(c && c.allowed)) {
    return h + '<div class="warn stack-sm"><div class="small bold">First request from ' + esc(r.from.name) + '</div><div class="small">Only allow people you know. Once allowed, their requests come straight to this list — you still decide on each one.</div>' +
      // Fraud panel: a "request" is an easy disguise for a payment scam.
      '<div class="small">⚠️ <span>Names can be faked. Waqti never asks you to pay, send codes or share passwords — if a request does, block it.</span></div>' +
      '<div class="row"><button class="btn sm" data-action="req-allow">Allow ' + esc(r.from.name) + '</button><button class="btn danger sm" data-action="req-block">Block</button></div></div>' + preview(r.task) + "</div>";
  }
  if (r.status === "updated") h += '<div class="okbox">🔄 ' + esc(r.from.name) + " updated this request.</div>";
  if (r.status === "cancelled") h += '<div class="warn small">🚫 ' + esc(r.from.name) + " cancelled this request" + (r.taskId ? "" : " — it was removed from your list") + ".</div>";
  if (f.edit) {
    h += '<div class="small bold">Change it, then accept</div>' + detailsForm(f.edit, { p: "edit.", titleLabel: "Task", notes: false });
    h += '<div class="field"><label>Message (optional)</label><input data-bind="note" value="' + esc(f.note) + '" placeholder="Can\'t on Tuesday — Wednesday works" maxlength="300"></div>';
    h += '<button class="btn" data-action="req-answer" data-id="changed">✏️ <span>Accept with this change</span></button><button class="btn ghost" data-action="req-edit-cancel">Back</button></div>';
    return h;
  }
  h += preview(r.task);
  if (f.declining) {
    h += '<div class="field"><label>Message (optional)</label><input data-bind="note" value="' + esc(f.note) + '" placeholder="Sorry, I\'m at work then" maxlength="300"></div>';
    h += '<button class="btn danger" data-action="req-answer" data-id="declined">❌ <span>Decline</span></button><button class="btn ghost" data-action="req-decline-cancel">Back</button></div>';
    return h;
  }
  if (r.status !== "cancelled") {
    h += '<button class="btn" data-action="req-answer" data-id="accepted">✅ <span>' + (r.status === "accepted" ? "Accepted — send again" : "Accept") + "</span></button>" +
      '<div class="row"><button class="btn sec sm" data-action="req-edit">✏️ <span>Change & accept</span></button><button class="btn sec sm" data-action="req-decline">❌ <span>Decline</span></button></div>';
    if (r.taskId || r.habitId) h += '<div class="hint">' + (r.habitId ? "It's in your habits with its reminder." : "It's on your list with its reminder.") + "</div>";
  }
  h += '<button class="btn ghost" data-action="req-block-from" style="color:var(--danger)">Block ' + esc(r.from.name) + "</button>";
  return h + "</div>";
}
function preview(t) {
  const rem = remindText(t);
  return '<div class="card pad stack-xs req-preview"><div class="row"><span class="emo" style="font-size:24px">' + (t.emoji || "📌") + '</span><div class="bold" style="font-size:16px" data-no-tr>' + esc(t.title) + "</div></div>" +
    (t.date || t.time ? '<div class="small">📅 ' + esc(whenText(t)) + "</div>" : "") + (rem ? '<div class="small">🔔 ' + esc(rem) + "</div>" : "") +
    (t.notes ? '<div class="small muted" data-no-tr>' + esc(t.notes) + "</div>" : "") + "</div>";
}
const current = () => state.requests.find(x => x.id === ui.form.rid);
on("req-allow", () => { allowSender(current()); save(); rerenderOverlay(); toast("Allowed"); });
on("req-block", () => { blockSender(current()); save(); closeOverlay(); ui.render(); toast("Blocked — you won't see their requests"); });
on("req-block-from", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = "Tap again to block"; return; }
  blockSender(current()); save(); closeOverlay(); ui.render(); toast("Blocked — you won't see their requests");
});
on("req-edit", () => { ui.form.edit = Object.assign({}, current().task); rerenderOverlay(); });
on("req-edit-cancel", () => { ui.form.edit = null; rerenderOverlay(); });
on("req-decline", () => { ui.form.declining = true; rerenderOverlay(); });
on("req-decline-cancel", () => { ui.form.declining = false; rerenderOverlay(); });
on("req-answer", async status => {
  const r = current(), f = ui.form;
  if (status === "changed") { cleanTask(f.edit); if (!f.edit.title) { toast("Give it a name"); return; } }
  const code = await answer(r, status, f.edit, f.note);
  save();
  closeOverlay();
  toast(status === "declined" ? "Declined" : r.habitId ? "Added to your habits ✓" : "Added to your tasks ✓");
  openShare(status, r, code, status === "changed" ? r.mine : r.task);
});

/* ---------- a request you sent ---------- */
export function openOutgoing(r) { openOverlay(renderOutgoing, { form: { rid: r.id }, push: true }); }
function renderOutgoing() {
  const r = current();
  if (!r) return ovHead('<button class="link" data-action="close">Close</button>', "Request", "") + "";
  let h = ovHead('<button class="link" data-action="close">Close</button>', "Your request", "") + '<div class="ov-body">';
  h += '<div class="small muted">' + (r.to ? "<span>Sent to</span> <b>" + esc(r.to) + "</b>" : "Sent") + "</div>" + preview(r.task);
  const peers = Object.values(r.peers);
  h += '<div class="card pad stack-sm"><div class="small bold">Answers</div>' + (peers.length ? peers.map(p =>
    '<div class="stack-xs"><div class="spread"><b class="small" data-no-tr>' + esc(p.name) + "</b>" + badge(p.status) + "</div>" +
    (p.status === "changed" && p.task ? '<div class="small">→ <span data-no-tr>' + esc(p.task.title) + "</span>" + (p.task.date || p.task.time ? " · " + esc(whenText(p.task)) : "") + "</div>" : "") +
    (p.note ? '<div class="small muted" data-no-tr>“' + esc(p.note) + "”</div>" : "") + "</div>").join('<hr class="sep">')
    : '<div class="hint">No answer yet. When they reply, they\'ll send you a link — tap it or paste it in Requests.</div>') + "</div>";
  if (r.status !== "cancelled") {
    h += '<div class="row"><button class="btn sec sm" data-action="req-resend">✏️ <span>Edit & resend</span></button><button class="btn sec sm" data-action="req-share-again">📤 <span>Send again</span></button></div>' +
      '<button class="btn danger sm" data-action="req-cancel">Cancel this request</button>';
  } else h += '<div class="warn small">🚫 You cancelled this request.</div>';
  return h + "</div>";
}
on("req-resend", () => { const r = current(); closeOverlay(); openAsk(Object.assign({}, r.task), r); });
on("req-share-again", async () => {
  const r = current();
  const code = await resendRequest(r, r.task); save(); closeOverlay(); openShare("req", r, code);
});
on("req-cancel", async (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = "Tap again to cancel it"; return; }
  const r = current(); const code = await cancelRequest(r); save(); closeOverlay(); openShare("cancel", r, code);
});

/* ---------- hub: Requests & people ---------- */
export function openRequests() { openOverlay(renderHub, { form: { paste: "" }, push: true }); }
function renderHub() {
  const inc = state.requests.filter(r => r.dir === "in"), out = state.requests.filter(r => r.dir === "out");
  const waiting = incomingWaiting();
  let h = ovHead('<button class="link" data-action="close">Close</button>', "Requests", '<button class="link" data-action="req-new">+ Ask</button>') + '<div class="ov-body">';
  h += '<div class="card pad stack-sm"><div class="small bold">Got a request link?</div><div class="row"><input class="input grow" data-bind="paste" placeholder="Paste the link or message here" autocomplete="off"><button class="btn xs" data-action="req-paste">Open</button></div>' +
    '<div class="hint">Links open Waqti by themselves on your phone. Pasting works everywhere.</div></div>';
  const row = (r, sub, b) => '<button class="habit" data-action="req-open" data-id="' + r.id + '"><div class="emoji">' + (r.task.emoji || "📌") + '</div><div class="grow"><div class="name ellipsis" data-no-tr>' + esc(r.task.title) + '</div><div class="meta ellipsis">' + sub + "</div></div>" + b + "</button>";
  if (waiting.length) h += '<div class="group-label"><span class="eyebrow">Waiting for you</span><span class="line"></span></div>' + waiting.map(r => row(r, "<span>From</span> " + esc(r.from.name) + (r.task.date || r.task.time ? " · " + esc(whenText(r.task)) : ""), badge(r.status))).join("");
  if (out.length) h += '<div class="group-label"><span class="eyebrow">Sent</span><span class="line"></span></div>' + out.slice(0, 30).map(r => {
    const ps = Object.values(r.peers), last = ps.sort((a, b) => b.at - a.at)[0];
    return row(r, (r.to ? "<span>To</span> " + esc(r.to) : "") + (r.task.date || r.task.time ? " · " + esc(whenText(r.task)) : ""), badge(r.status === "cancelled" ? "cancelled" : last ? last.status : "sent"));
  }).join("");
  const earlier = inc.filter(r => !waiting.includes(r));
  if (earlier.length) h += '<div class="group-label"><span class="eyebrow">Received</span><span class="line"></span></div>' + earlier.slice(0, 30).map(r => row(r, "<span>From</span> " + esc(r.from.name), badge(r.status))).join("");
  if (!inc.length && !out.length) h += '<div class="center stack-sm card pad"><div style="font-size:34px">🤝</div><div class="bold">Plan things together</div><div class="small muted">Ask someone to pick up groceries on Friday or collect Grandma on Tuesday. They accept, change it, or say no — no accounts needed.</div><button class="btn" data-action="req-new">📨 <span>Ask someone</span></button></div>';
  const people = state.contacts;
  if (people.length) h += '<div class="group-label"><span class="eyebrow">People</span><span class="line"></span></div><div class="card pad stack-sm">' + people.map(c =>
    '<div class="spread"><div class="small"><b data-no-tr>' + esc(c.name) + '</b> <span class="muted">· ' + (c.allowed ? "Allowed" : "Blocked") + "</span></div>" +
    '<div class="row" style="gap:6px"><button class="btn xs sec" data-action="req-toggle-person" data-id="' + esc(c.id) + '">' + (c.allowed ? "Block" : "Unblock") + '</button><button class="btn xs sec" data-action="req-forget" data-id="' + esc(c.id) + '">Remove</button></div></div>').join("") +
    '<div class="hint">Only allowed people\'s requests reach your list. Removed people need your "Allow" again.</div></div>';
  return h + "</div>";
}
on("req-new", () => { closeOverlay(); openAsk(); });
on("req-open", id => {
  const r = state.requests.find(x => x.id === id); if (!r) return;
  if (r.dir === "in") openIncoming(r); else openOutgoing(r);
});
on("req-paste", async () => {
  const code = extractCode(ui.form.paste), key = extractKey(ui.form.paste);
  if (!code) { toast("That doesn't look like a Waqti request link"); return; }
  closeOverlay();
  await handleCode(code, key);
});
on("req-toggle-person", id => { const c = contact(id); if (c) { c.allowed = !c.allowed; save(); rerenderOverlay(); } });
on("req-forget", id => { state.contacts = state.contacts.filter(c => c.id !== id); save(); rerenderOverlay(); });
on("open-requests", () => openRequests());
on("ask-someone", () => openAsk());

/* ---------- arriving links ---------- */
export async function handleCode(code, key) {
  await ensureIdentity();
  const m = await decodeMessage(code);
  if (!m) { toast("This link is broken or incomplete — ask them to send it again"); return; }
  if (m.t === "list") { const ul = await import("./lists.js"); return ul.handleListMessage(m, key); }
  const res = receive(m);
  save();
  if (overlayOpen()) closeOverlay({ all: true });
  ui.render();
  switch (res.kind) {
    case "request": openIncoming(res.request, res.trust); break;
    case "reply": toast({ accepted: "✅ " + m.from.name + " accepted", changed: "✏️ " + m.from.name + " accepted with a change", declined: "❌ " + m.from.name + " declined" }[res.status] || "Reply received"); openOutgoing(res.request); break;
    case "cancelled": toast("🚫 " + m.from.name + " cancelled a request"); openIncoming(res.request); break;
    case "duplicate": if (res.request) (res.request.dir === "in" ? openIncoming(res.request) : openOutgoing(res.request)); else toast("Already opened"); break;
    case "blocked": toast("Ignored — you blocked this person"); break;
    case "mismatch": openMismatch(m); break;
    case "own": toast("That's your own request — send it to someone else"); break;
    default: toast("This request isn't on this phone (maybe it was deleted)");
  }
}
function openMismatch(m) {
  openOverlay(() => ovHead('<button class="link" data-action="close">Close</button>', "Check this request", "") + '<div class="ov-body"><div class="warn stack-sm">' +
    '<div class="bold small">⚠️ <span>This doesn\'t match the</span> <span data-no-tr>' + esc(m.from.name) + "</span> <span>you allowed before</span></div>" +
    '<div class="small">It may come from a new phone — or from someone else using their name. Ask them directly before trusting it. It wasn\'t added.</div></div></div>', { form: {}, push: true });
}

/* ---------- Today card ---------- */
export function requestsCard() {
  const w = incomingWaiting().filter(r => !r.pendingAllow || (contact(r.from.id) || {}).allowed);
  const fresh = incomingWaiting().filter(r => r.pendingAllow && !(contact(r.from.id) || {}).allowed);
  const all = w.concat(fresh);
  if (!all.length) return "";
  const r = all[0];
  return '<button class="card pad row req-card" data-action="req-open" data-id="' + r.id + '"><span class="emo" style="font-size:24px">📨</span><span class="grow"><span class="small bold" style="display:block"><span data-no-tr>' + esc(r.from.name) + "</span> <span>sent you a request</span></span>" +
    '<span class="tiny muted ellipsis" style="display:block" data-no-tr>' + esc((r.task.emoji ? r.task.emoji + " " : "") + r.task.title) + "</span>" +
    (all.length > 1 ? '<span class="tiny muted"><span>+' + (all.length - 1) + "</span> <span>more waiting</span></span>" : "") + '</span><span class="faint">›</span></button>';
}
