// Requests between people, with no account or server: a request ("Pick up Grandma, Tue 4 PM")
// travels as a link sent over WhatsApp/SMS. The other person accepts it (it becomes a task with
// its reminder), accepts it with changes, or declines — and their answer travels back as a link.
//
// • The details sit in the link's #fragment, which browsers never send to a server.
// • Each phone has its own signing key (ECDSA P-256). The first request someone accepts from a
//   person pins that person's key; later messages that don't match it are flagged, not applied.
// • Nothing reaches your list unless you tap a link and choose to accept. New people need an
//   explicit "Allow"; blocked people are ignored.

import { state, newHabit } from "./store.js";
import { uid, cleanEmoji } from "./util.js";
import { newTask } from "./tasks.js";
import { keyOf, today, toMin, fromMin } from "./dates.js";
import { keepPastSchedule } from "./schedule.js";
import { CONFIG } from "./config.js";
import { tr } from "./i18n.js";

const PARAM = "waqti=";
export const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_LINK_BYTES = 512 * 1024; // a decompressed message larger than this is refused (no "zip bomb" links)
const subtle = () => (globalThis.crypto && crypto.subtle) || null;

/* ---------- identity ---------- */
export async function ensureIdentity() {
  if (state.me && state.me.id) return state.me;
  const me = { id: uid() + uid(), pub: null, priv: null };
  const s = subtle();
  if (s) {
    try {
      const kp = await s.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const jwk = await s.exportKey("jwk", kp.privateKey);
      me.priv = jwk;
      me.pub = jwk.x + "." + jwk.y;
    } catch (e) { /* unsigned fallback */ }
  }
  state.me = me;
  return me;
}

async function sign(body) {
  const s = subtle(), me = state.me;
  if (!s || !me.priv) return null;
  const key = await s.importKey("jwk", me.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await s.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(body));
  return b64(new Uint8Array(sig));
}

async function verify(body, sig, pub) {
  const s = subtle();
  if (!s || !sig || !pub) return false;
  try {
    const [x, y] = pub.split(".");
    const key = await s.importKey("jwk", { kty: "EC", crv: "P-256", x, y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await s.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64(sig), new TextEncoder().encode(body));
  } catch (e) { return false; }
}

/* ---------- encoding ---------- */
function b64(bytes) { let s = ""; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

export async function encodeMessage(msg) {
  const me = await ensureIdentity();
  const m = Object.assign({ v: 1, mid: uid(), ts: Date.now(), from: { id: me.id, name: (state.profile.name || "").trim() || "Someone", pub: me.pub } }, msg);
  const body = JSON.stringify(m);
  const sig = await sign(body);
  const packed = await deflate(new TextEncoder().encode(body));
  return (packed ? "z" + b64(packed) : b64(new TextEncoder().encode(body))) + (sig ? "." + sig : "");
}

// Links are compressed (deflate) when the browser supports it — roughly half the length.
// A leading "z" marks a compressed message; old links without it still open.
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
// "deflate-raw" is newer (Chrome 103, Safari 16.4); older WebViews only have zlib "deflate".
// Reading tries both, so a link from either kind of phone opens on the other.
export async function deflate(bytes) {
  try {
    if (typeof CompressionStream !== "function") return null;
    try { return await pipe(bytes, new CompressionStream("deflate-raw")); }
    catch (e) { return await pipe(bytes, new CompressionStream("deflate")); }
  } catch (e) { return null; }
}
// Decompresses with a size cap: a tiny link must not be able to expand into hundreds of megabytes.
async function pipeCapped(bytes, stream) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader(), parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_LINK_BYTES) { try { await reader.cancel(); } catch (e) { /* ignore */ } throw new Error("too large"); }
    parts.push(value);
  }
  const out = new Uint8Array(total); let o = 0;
  parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}
export async function inflate(bytes) {
  try { return await pipeCapped(bytes, new DecompressionStream("deflate-raw")); }
  catch (e) { if (/too large/.test(e.message)) throw e; return await pipeCapped(bytes, new DecompressionStream("deflate")); }
}

// Accepts a full link, a pasted message containing a link, or the bare code.
export function extractCode(text) {
  const t = String(text || "").trim();
  const i = t.indexOf(PARAM);
  const code = i >= 0 ? t.slice(i + PARAM.length) : t;
  const m = code.match(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?/);
  return m && m[0].length > 40 ? m[0] : null;
}

// code = base64url(message JSON) + "." + base64url(signature)
export async function decodeMessage(code) {
  try {
    const [b, sig] = code.split(".");
    const body = new TextDecoder().decode(b[0] === "z" ? await inflate(unb64(b.slice(1))) : unb64(b));
    const m = JSON.parse(body);
    if (!m || m.v !== 1 || !m.from || !m.from.id || !m.t) return null;
    // Everything here comes from someone else: ids go into the page's markup, so they must be plain ids.
    if (!["req", "res", "cancel", "list"].includes(m.t)) return null;
    for (const k of ["mid", "rid", "lid"]) if (m[k] != null && !SAFE_ID.test(String(m[k]))) return null;
    if (!SAFE_ID.test(String(m.from.id)) || (m.from.pub != null && !/^[A-Za-z0-9_.-]{1,200}$/.test(String(m.from.pub)))) return null;
    m.from.name = String(m.from.name || "").slice(0, 40);
    m.rev = Math.max(0, Math.floor(+m.rev || 0));
    m.verified = await verify(body, sig, m.from.pub);
    return m;
  } catch (e) { return null; }
}

export function linkFor(code) {
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const base = CONFIG.shareBase || (native || location.protocol === "file:" ? "waqti://r" : location.origin + location.pathname);
  return base + "#" + PARAM + code;
}

/* ---------- contacts ---------- */
export function contact(id) { return (state.contacts || []).find(c => c.id === id); }
function remember(from, allowed) {
  let c = contact(from.id);
  if (!c) { c = { id: from.id, name: from.name, pub: from.pub || null, allowed, added: Date.now() }; state.contacts.push(c); }
  c.name = from.name || c.name;
  if (allowed != null) c.allowed = allowed;
  if (!c.pub && from.pub) c.pub = from.pub;
  return c;
}
export function allow(from) { return remember(from, true); }
export function block(from) { return remember(from, false); }

// Who sent this, and can we trust it? "blocked" | "new" | "mismatch" | "ok"
export function trustOf(m) {
  const c = contact(m.from.id);
  if (c && c.allowed === false) return "blocked";
  if (c && c.pub && (!m.verified || c.pub !== m.from.pub)) return "mismatch";
  if (!c || !c.allowed) return "new";
  return "ok";
}

/* ---------- task details carried in a request ---------- */
const FIELDS = ["title", "emoji", "date", "time", "remind", "notes", "repeat"];
// repeat: null (once) | { kind: "daily" } | { kind: "days", days: [0-6] } | { kind: "monthly" } (on the start date's day)
function cleanRepeat(r) {
  if (!r || !r.kind) return null;
  if (r.kind === "daily" || r.kind === "monthly") return { kind: r.kind };
  if (r.kind === "days") { const days = (r.days || []).map(Number).filter(d => d >= 0 && d <= 6); return days.length ? { kind: "days", days: Array.from(new Set(days)).sort() } : null; }
  return null;
}
export function pickTask(t) {
  const o = {};
  FIELDS.forEach(k => { o[k] = t[k] == null ? (k === "remind" || k === "repeat" ? null : "") : t[k]; });
  o.title = String(o.title).slice(0, 120); o.notes = String(o.notes || "").slice(0, 500); o.repeat = cleanRepeat(o.repeat);
  // Everything here can come from someone else's link: only an emoji, a YYYY-MM-DD date and an HH:MM time get through.
  o.emoji = cleanEmoji(o.emoji);
  o.date = /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : "";
  o.time = /^\d{2}:\d{2}$/.test(o.time) ? o.time : "";
  o.remind = o.remind == null || isNaN(+o.remind) ? null : Math.max(0, Math.min(1440, Math.round(+o.remind)));
  return o;
}
const sameTask = (a, b) => FIELDS.every(k => JSON.stringify(a[k] == null ? "" : a[k]) === JSON.stringify(b[k] == null ? "" : b[k]));

// A repeating request becomes a habit (schedule + reminder); a one-off becomes a task.
function scheduleOf(det) {
  const start = det.date || keyOf(today());
  const r = det.repeat;
  if (r.kind === "days") return { kind: "days", days: r.days, start };
  if (r.kind === "monthly") return { kind: "monthly", monthDay: +start.slice(8, 10), start };
  return { kind: "daily", start };
}
function applyAsHabit(r, det) {
  let h = r.habitId && state.habits.find(x => x.id === r.habitId);
  if (!h) { h = newHabit({ category: "Family" }); state.habits.push(h); r.habitId = h.id; }
  const before = { schedule: JSON.parse(JSON.stringify(h.schedule)), pastSchedules: h.pastSchedules, createdAt: h.createdAt };
  Object.assign(h, { name: det.title, emoji: det.emoji || "📌", notes: det.notes || "", archived: false, fromName: r.from.name, requestId: r.id, source: "request:" + r.id });
  h.schedule = Object.assign({ days: [], n: 1, perWeek: 3, monthDay: 1, onlyOn: "any" }, scheduleOf(det));
  keepPastSchedule(before, h);
  const rem = det.remind == null ? null : +det.remind;
  if (det.time && rem != null) h.reminders = Object.assign(h.reminders, { on: true, mode: "times", times: [fromMin(((toMin(det.time) - Math.min(rem, 720)) % 1440 + 1440) % 1440)] });
  else if (det.time) h.reminders = Object.assign(h.reminders, { on: true, mode: "times", times: [det.time] });
  else h.reminders.on = false;
}
function retireHabit(r) {
  const h = r.habitId && state.habits.find(x => x.id === r.habitId);
  if (!h) return;
  if (Object.keys(h.history).length) h.archived = true; else state.habits = state.habits.filter(x => x !== h);
  r.habitId = null;
}

/* ---------- sending ---------- */
export async function createRequest(task, toLabel) {
  const r = { id: uid() + uid(), dir: "out", rev: 1, to: (toLabel || "").trim(), task: pickTask(task), peers: {}, status: "sent", createdAt: Date.now(), updatedAt: Date.now() };
  state.requests.unshift(r);
  return { request: r, code: await encodeMessage({ t: "req", rid: r.id, rev: r.rev, task: r.task, to: r.to }) };
}

export async function resendRequest(r, task) {
  r.task = pickTask(task); r.rev++; r.updatedAt = Date.now();
  Object.values(r.peers).forEach(p => { p.status = "sent"; });
  return encodeMessage({ t: "req", rid: r.id, rev: r.rev, task: r.task, to: r.to });
}

export async function cancelRequest(r) {
  r.status = "cancelled"; r.updatedAt = Date.now();
  return encodeMessage({ t: "cancel", rid: r.id });
}

/* ---------- answering ---------- */
// status: "accepted" | "changed" | "declined". Accepting adds (or updates) the task on this phone.
export async function answer(r, status, changed, note) {
  r.status = status; r.note = note || ""; r.updatedAt = Date.now();
  if (status === "changed") r.mine = pickTask(changed);
  if (status === "accepted" || status === "changed") {
    const det = status === "changed" ? r.mine : r.task;
    if (det.repeat) {
      if (r.taskId) { state.tasks = state.tasks.filter(x => x.id !== r.taskId); r.taskId = null; }
      applyAsHabit(r, det);
    } else {
      retireHabit(r);
      let t = r.taskId && state.tasks.find(x => x.id === r.taskId);
      if (!t) { t = newTask({ carry: true }); state.tasks.push(t); r.taskId = t.id; }
      const d = pickTask(det); delete d.repeat;
      Object.assign(t, d, { fromName: r.from.name, requestId: r.id });
      if (t.remind === "" || t.remind === undefined) t.remind = null;
      if (t.done && status !== "accepted") t.done = false;
    }
  } else {
    if (r.taskId) { state.tasks = state.tasks.filter(x => x.id !== r.taskId); r.taskId = null; }
    retireHabit(r);
  }
  return encodeMessage({ t: "res", rid: r.id, rev: r.rev, status, task: status === "changed" ? r.mine : null, note: r.note });
}

/* ---------- receiving ---------- */
// Applies a decoded message. Returns { kind, request, trust } for the UI to show.
//   kind: "request" (new/updated incoming), "reply", "cancelled", "blocked", "mismatch", "duplicate", "unknown"
export function receive(m) {
  const me = state.me && state.me.id;
  if (me && m.from.id === me) return { kind: "own" };
  const seen = state.seenMessages || (state.seenMessages = []);
  if (seen.includes(m.mid)) return { kind: "duplicate", request: state.requests.find(r => r.id === m.rid) };
  const trust = trustOf(m);
  if (trust === "blocked") return { kind: "blocked" };

  if (m.t === "res") {
    const r = state.requests.find(x => x.id === m.rid && x.dir === "out");
    if (!r) return { kind: "unknown" };
    const known = r.peers[m.from.id];
    if (trust === "mismatch") return { kind: "mismatch", request: r, from: m.from };
    if (known && known.rev > m.rev) return { kind: "duplicate", request: r };
    r.peers[m.from.id] = { name: m.from.name, status: m.status, task: m.task ? pickTask(m.task) : null, note: String(m.note || "").slice(0, 300), rev: m.rev, at: m.ts };
    r.updatedAt = Date.now();
    allow(m.from); // you sent them the request, so their answers are welcome
    markSeen(m);
    return { kind: "reply", request: r, from: m.from, status: m.status };
  }

  if (trust === "mismatch") return { kind: "mismatch", from: m.from };
  let r = state.requests.find(x => x.id === m.rid && x.dir === "in");
  if (m.t === "cancel") {
    if (!r || r.from.id !== m.from.id) return { kind: "unknown" };
    r.status = "cancelled"; r.updatedAt = Date.now();
    if (r.taskId) { state.tasks = state.tasks.filter(x => x.id !== r.taskId); r.taskId = null; }
    retireHabit(r);
    markSeen(m);
    return { kind: "cancelled", request: r };
  }
  if (m.t !== "req" || !m.task || !m.task.title) return { kind: "unknown" };
  if (r && r.from.id !== m.from.id) return { kind: "unknown" };
  if (r && m.rev <= r.rev) return { kind: "duplicate", request: r };
  const task = pickTask(m.task);
  if (r) {
    const unchanged = sameTask(task, r.task);
    Object.assign(r, { task, rev: m.rev, updatedAt: Date.now(), status: unchanged ? r.status : "updated" });
  } else {
    r = { id: m.rid, dir: "in", rev: m.rev, from: { id: m.from.id, name: m.from.name }, task, status: "new", verified: !!m.verified, createdAt: Date.now(), updatedAt: Date.now() };
    state.requests.unshift(r);
  }
  // A brand-new person waits behind "Allow"; the request is kept but marked as such.
  r.pendingAllow = trust === "new";
  r.fromPub = m.from.pub || null;
  markSeen(m);
  return { kind: "request", request: r, trust };
}

function markSeen(m) {
  state.seenMessages.push(m.mid);
  if (state.seenMessages.length > 300) state.seenMessages.splice(0, state.seenMessages.length - 300);
}

export function allowSender(r) { allow({ id: r.from.id, name: r.from.name, pub: r.fromPub }); r.pendingAllow = false; }
export function blockSender(r) {
  block({ id: r.from.id, name: r.from.name, pub: r.fromPub });
  state.requests = state.requests.filter(x => !(x.dir === "in" && x.from.id === r.from.id && !x.taskId && !x.habitId));
}

export function incomingWaiting() { return (state.requests || []).filter(r => r.dir === "in" && (r.status === "new" || r.status === "updated")); }

// Text to send along with a link, so it reads well in WhatsApp even without Waqti installed.
// Written in the sender's app language.
export function shareText(kind, r, when, link) {
  const name = (state.profile.name || "").trim() || tr("Someone");
  const what = (r.task.emoji ? r.task.emoji + " " : "") + r.task.title + (when ? " — " + when : "");
  const key = { req: "{name} is asking you: {what}", accepted: "✅ {name} accepted: {what}", changed: "✏️ {name} accepted with a change: {what}", declined: "❌ {name} can't do: {what}", cancel: "🚫 {name} cancelled: {what}" }[kind];
  return tr(key, { name, what }) + "\n\n" + tr("Open in Waqti: {link}", { link });
}
