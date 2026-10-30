// Shared family lists (groceries, home jobs…), end-to-end encrypted.
//
// Each list has its own random AES-GCM key. The key travels only inside the invite link
// ("…#waqti=<message>&k=<key>"), sent person-to-person. Updates carry the list encrypted with that
// key, so whatever carries them — WhatsApp today, a sync server later — only sees scrambled data.
// Messages are also signed by the sender's phone (see requests.js).
//
// Merging: every change gets a version from a counter that only moves forward (a Lamport clock,
// bumped past anything seen from others), so a phone whose clock is wrong can't lose its edits.
// Same version → later time wins → then the editor's id, so every phone picks the same winner.
// Deletions are kept as tombstones for 14 days so they don't come back from an older copy.

import { state } from "./store.js";
import { uid, cleanEmoji } from "./util.js";
import { encodeMessage, trustOf, allow, deflate, inflate } from "./requests.js";
import { canUse, FREE } from "./pro.js";

const subtle = () => (globalThis.crypto && crypto.subtle) || null;
const b64 = bytes => { let s = ""; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64 = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const TOMBSTONE_DAYS = 14;

export const listsAvailable = () => !!subtle();

export function newList(name, emoji) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const me = state.me || {};
  const l = { id: uid() + uid(), name: (name || "").trim() || "Family list", emoji: emoji || "🛒", key: b64(raw), items: [], members: [{ id: me.id || "me", name: state.profile.name || "Me" }], mine: true, owner: me.id || "", dirty: false, createdAt: Date.now(), updatedAt: Date.now() };
  state.lists.unshift(l);
  return l;
}

/* ---------- items ---------- */
const meName = () => (state.profile.name || "").trim() || "Me";
// Stamp a local change: next version, time, and who made it.
function stamp(l, it) { l.clock = (l.clock || 0) + 1; it.v = l.clock; it.at = Date.now(); it.dev = (state.me && state.me.id) || ""; }
export function addItem(l, text) {
  text = String(text || "").trim().slice(0, 120);
  if (!text) return null;
  const it = { id: uid(), text, done: false, by: meName() };
  stamp(l, it); l.items.push(it); touch(l);
  return it;
}
export function toggleItem(l, id) { const it = l.items.find(x => x.id === id); if (!it) return; it.done = !it.done; it.by = meName(); stamp(l, it); touch(l); }
export function removeItem(l, id) { const it = l.items.find(x => x.id === id); if (!it) return; it.del = true; stamp(l, it); touch(l); }
export function clearDone(l) { l.items.forEach(it => { if (it.done && !it.del) { it.del = true; stamp(l, it); } }); touch(l); }
export const visibleItems = l => l.items.filter(x => !x.del).sort((a, b) => (a.done - b.done) || a.at - b.at);
export const openCount = l => l.items.filter(x => !x.del && !x.done).length;
function touch(l) { l.dirty = true; l.updatedAt = Date.now(); }

// Does change b beat change a? Higher version, then later time, then editor id.
export function newer(b, a) {
  const vb = +b.v || 0, va = +a.v || 0;
  if (vb !== va) return vb > va;
  const tb = +b.at || 0, ta = +a.at || 0;
  if (tb !== ta) return tb > ta;
  return String(b.dev || "") > String(a.dev || "");
}
// Merge another copy's items into ours (the winning change per item is kept).
export function mergeItems(mine, theirs) {
  const byId = new Map(mine.map(x => [x.id, x]));
  for (const t of theirs || []) {
    if (!t || !t.id) continue;
    const cur = byId.get(t.id);
    if (!cur || newer(t, cur)) byId.set(t.id, { id: t.id, text: String(t.text || "").slice(0, 120), done: !!t.done, by: String(t.by || "").slice(0, 40), at: +t.at || Date.now(), v: +t.v || 0, dev: String(t.dev || "").slice(0, 40), del: !!t.del });
  }
  const cutoff = Date.now() - TOMBSTONE_DAYS * 86400e3;
  return Array.from(byId.values()).filter(x => !(x.del && x.at < cutoff));
}
const maxV = items => (items || []).reduce((m, x) => Math.max(m, +x.v || 0), 0);

/* ---------- size limit ---------- */
// The person who made the list sets how many people it holds (0 = no limit, with Pro). The limit
// travels inside the encrypted list, and every member's phone keeps to it: someone past the limit
// can't join, and changes from them aren't merged — so forwarding an old invite link doesn't help.
// Only the owner's copy can change the limit; lists made before limits existed have none.
export function listCap(l) {
  if (l.mine && l.owner) return canUse("biggerLists") ? 0 : FREE.members;
  return +l.cap || 0;
}
const isFull = (l, id) => { const cap = listCap(l); return !!cap && !l.members.some(p => p.id === id) && l.members.length >= cap; };

/* ---------- encryption ---------- */
async function keyOf(l) { return subtle().importKey("raw", unb64(l.key), "AES-GCM", false, ["encrypt", "decrypt"]); }
// Compressed before encrypting (encrypted data can't be compressed) — "z" marks compressed content.
export async function seal(l) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = new TextEncoder().encode(JSON.stringify({ name: l.name, emoji: l.emoji, items: l.items, members: l.members, owner: l.owner || "", cap: listCap(l) }));
  const packed = await deflate(raw);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, await keyOf(l), packed || raw));
  return (packed ? "z" : "") + b64(iv) + "." + b64(ct);
}
export async function open(keyB64, blob) {
  let [iv, ct] = String(blob).split(".");
  const packed = iv[0] === "z"; if (packed) iv = iv.slice(1);
  const k = await subtle().importKey("raw", unb64(keyB64), "AES-GCM", false, ["decrypt"]);
  const pt = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: unb64(iv) }, k, unb64(ct)));
  return JSON.parse(new TextDecoder().decode(packed ? await inflate(pt) : pt));
}

/* ---------- links ---------- */
// invite = true adds the key to the link (only for people you're adding to the list).
export async function listMessage(l, invite) {
  const code = await encodeMessage({ t: "list", lid: l.id, enc: await seal(l) });
  l.dirty = false;
  return invite ? code + "&k=" + l.key : code;
}
export function extractKey(text) { const m = String(text || "").match(/[&?]k=([A-Za-z0-9_-]{40,})/); return m ? m[1] : null; }

// Returns { kind: "joined" | "updated" | "needs-invite" | "bad-key" | "blocked" | "mismatch" | "new-person", list }
export async function receiveList(m, keyFromLink) {
  const trust = trustOf(m);
  if (trust === "blocked") return { kind: "blocked" };
  if (trust === "mismatch") return { kind: "mismatch" };
  let l = state.lists.find(x => x.id === m.lid);
  const key = (l && l.key) || keyFromLink;
  if (!key) return { kind: "needs-invite" };
  let data;
  try { data = await open(key, m.enc); } catch (e) { return { kind: "bad-key" }; }
  if (!l) {
    const meId = state.me && state.me.id;
    if (isFull({ members: mergeMembers(data.members, m.from).filter(p => p.id !== meId), cap: data.cap }, meId)) return { kind: "full", data };
    if (trust === "new" && !m._allowed) return { kind: "new-person", data, key };
    l = { id: m.lid, name: String(data.name || "Family list").slice(0, 40), emoji: cleanEmoji(data.emoji) || "🛒", key, items: [], members: [], mine: false, owner: String(data.owner || ""), cap: +data.cap || 0, dirty: false, createdAt: Date.now(), updatedAt: Date.now() };
    state.lists.unshift(l);
    allow(m.from);
    l.items = mergeItems([], data.items);
    l.clock = maxV(l.items);
    l.members = mergeMembers(data.members, m.from);
    return { kind: "joined", list: l };
  }
  if (!l.mine && l.owner && m.from && m.from.id === l.owner) l.cap = +data.cap || 0; // the owner changed plans
  if (isFull(l, m.from && m.from.id)) return { kind: "full", data, list: l };
  l.items = mergeItems(l.items, data.items);
  l.clock = Math.max(l.clock || 0, maxV(data.items));
  // Everyone already here stays; newcomers (the sender first) fill whatever room is left.
  const merged = mergeMembers(l.members.concat(data.members || []), m.from), cap = listCap(l);
  const known = p => l.members.some(x => x.id === p.id), sender = p => m.from && p.id === m.from.id;
  l.members = !cap ? merged : merged.filter(known).concat(merged.filter(p => !known(p)).sort((a, b) => sender(b) - sender(a))).slice(0, Math.max(cap, l.members.length));
  if (data.name) l.name = String(data.name).slice(0, 40);
  l.updatedAt = Date.now();
  return { kind: "updated", list: l };
}
function mergeMembers(list, from) {
  const out = [], seen = new Set();
  for (const p of (list || []).concat(from ? [{ id: from.id, name: from.name }] : [])) {
    if (!p || !p.id || seen.has(p.id)) continue;
    seen.add(p.id); out.push({ id: p.id, name: String(p.name || "").slice(0, 40) });
  }
  const me = state.me && state.me.id;
  if (me && !seen.has(me)) out.push({ id: me, name: state.profile.name || "Me" });
  return out.filter(p => p.id !== "me" || !me);
}
export function leaveList(l) { state.lists = state.lists.filter(x => x !== l); }
