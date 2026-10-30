// Shared family lists: the lists screen, one list, and joining from an invite link.

import { state, save } from "../store.js";
import { esc, toast } from "../util.js";
import { ensureIdentity, linkFor, allow } from "../requests.js";
import { newList, addItem, toggleItem, removeItem, clearDone, visibleItems, openCount, listMessage, receiveList, leaveList, listsAvailable } from "../lists.js";
import { on, ui, openOverlay, closeOverlay, rerenderOverlay, overlayOpen } from "./core.js";
import { ovHead, check, proTag, proSheet } from "./components.js";
import { canCreateList, canInvite, FREE } from "../pro.js";
import { openShareText } from "./requests.js";
import { tr } from "../i18n.js";

const EMOJIS = ["🛒", "🏠", "🧹", "🎁", "🧳", "💊", "📚", "🍽️"];

/* ---------- all lists ---------- */
export function openLists() { openOverlay(renderLists, { form: { name: "", emoji: "🛒" }, push: true }); }
function renderLists() {
  const f = ui.form;
  let h = ovHead('<button class="link" data-action="close">Close</button>', "Family lists", "") + '<div class="ov-body">';
  if (!listsAvailable()) return h + '<div class="warn">Shared lists need a newer browser or the phone app.</div></div>';
  h += state.lists.map(l => '<button class="habit" data-action="list-open" data-id="' + l.id + '"><div class="emoji">' + l.emoji + '</div><div class="grow"><div class="name ellipsis" data-no-tr>' + esc(l.name) + '</div><div class="meta"><span class="tabnum">' + openCount(l) + "</span> <span>to get</span> · <span>" + l.members.length + " " + (l.members.length === 1 ? "person" : "people") + "</span>" + (l.dirty ? " · <span>changes not sent</span>" : "") + "</div></div><span class=\"faint\">›</span></button>").join("");
  h += '<div class="card pad stack-sm"><div class="small bold">New list</div><div class="row emo-pick">' + EMOJIS.map(e => '<button type="button" class="chip' + (f.emoji === e ? " on" : "") + '" data-action="set" data-path="emoji" data-val="' + e + '"><span class="emo">' + e + "</span></button>").join("") + "</div>" +
    '<div class="row"><input class="input grow" data-bind="name" value="' + esc(f.name) + '" placeholder="e.g. Groceries, Home jobs, Eid shopping" maxlength="40"><button class="btn xs" data-action="list-create">Create' + (canCreateList() ? "" : proTag("moreLists")) + "</button></div></div>";
  h += '<div class="hint">🔒 Each list is locked with its own key that only the people you invite get. Changes travel as links you send — no account needed.</div>';
  return h + "</div>";
}
on("list-create", async () => {
  if (!canCreateList()) return proSheet("🛒", "More lists with Pro", tr("Your free plan includes {n} shared list of your own. Pro adds as many as you need: home jobs, a trip, Ramadan shopping. Lists other people share with you are always free.", { n: FREE.lists }));
  await ensureIdentity();
  const l = newList(ui.form.name, ui.form.emoji);
  save(); closeOverlay(); openList(l.id);
});
on("open-lists", () => openLists());
on("list-open", id => openList(id));

/* ---------- one list ---------- */
export function openList(id) { openOverlay(renderList, { form: { lid: id, draft: "" }, push: true }); setTimeout(() => { const n = document.getElementById("list-draft"); if (n && !state.lists.find(x => x.id === id).items.length) n.focus(); }, 60); }
const cur = () => state.lists.find(x => x.id === ui.form.lid);
function renderList() {
  const l = cur();
  if (!l) return ovHead('<button class="link" data-action="close">Close</button>', "List", "") + '<div class="ov-body"><div class="hint">This list was removed.</div></div>';
  let h = ovHead('<button class="link" data-action="close">Close</button>', '<span class="emo">' + l.emoji + '</span> <span data-no-tr>' + esc(l.name) + "</span>", "") + '<div class="ov-body">';
  h += '<form class="row" id="list-add-form"><input id="list-draft" class="input grow" data-bind="draft" value="' + esc(ui.form.draft) + '" placeholder="Add an item…" maxlength="120" autocomplete="off" enterkeyhint="done"><button class="btn xs" type="submit">Add</button></form>';
  const items = visibleItems(l);
  h += items.length ? '<div class="stack-xs">' + items.map(it => '<div class="habit list-item' + (it.done ? " is-done" : "") + '">' +
    check(it.done, 'data-action="list-toggle" data-id="' + it.id + '" aria-label="' + (it.done ? "Mark not done" : "Mark done") + '"') +
    '<div class="grow"><div class="name' + (it.done ? " strike-t" : "") + '" data-no-tr>' + esc(it.text) + '</div><div class="meta" data-no-tr>' + esc(it.by || "") + "</div></div>" +
    '<button class="icon-btn sm" data-action="list-remove" data-id="' + it.id + '" aria-label="Remove ' + esc(it.text) + '">✕</button></div>').join("") + "</div>"
    : '<div class="hint center">Nothing on this list yet.</div>';
  if (items.some(x => x.done)) h += '<button class="btn ghost" data-action="list-clear">Clear ticked items</button>';
  h += '<div class="card pad stack-sm"><div class="small bold">People</div><div class="small" data-no-tr>' + l.members.map(p => esc(p.name)).join(" · ") + "</div>" +
    '<button class="btn' + (l.dirty ? "" : " sec") + ' sm" data-action="list-send">📤 <span>' + (l.dirty ? "Send your changes" : "Send the list again") + "</span></button>" +
    '<button class="btn sec sm" data-action="list-invite">➕ <span>Invite someone</span>' + (canInvite(l) ? "" : proTag("biggerLists")) + "</button>" +
    '<div class="hint">' + (l.dirty ? "Your changes are saved here. Send them to the family so their lists match." : "When someone sends you their changes, tap the link to merge them in.") + "</div></div>";
  h += '<button class="btn ghost" data-action="list-leave" style="color:var(--danger)">Leave this list</button>';
  return h + "</div>";
}
document.addEventListener("submit", e => {
  if (!e.target || e.target.id !== "list-add-form") return;
  e.preventDefault();
  const l = cur(); if (!l) return;
  if (addItem(l, ui.form.draft)) { ui.form.draft = ""; save(); rerenderOverlay(); const n = document.getElementById("list-draft"); if (n) n.focus(); }
});
on("list-toggle", id => { toggleItem(cur(), id); save(); rerenderOverlay(); });
on("list-remove", id => { removeItem(cur(), id); save(); rerenderOverlay(); });
on("list-clear", () => { clearDone(cur()); save(); rerenderOverlay(); });
on("list-send", async () => {
  const l = cur(); const code = await listMessage(l, false); save();
  openShareText("Send your changes", tr("{list} — updated ({n} to get)", { list: l.emoji + " " + l.name, n: openCount(l) }) + "\n\n" + tr("Open in Waqti: {link}", { link: linkFor(code) }), "Send it to the family group. Only people already on this list can open it.");
});
on("list-invite", async () => {
  const l = cur();
  if (!canInvite(l)) return proSheet("👨‍👩‍👧", "Bigger lists with Pro", tr("Free lists hold up to {n} people. Pro has no limit, so the whole family can be on it.", { n: FREE.members }));
  const code = await listMessage(l, true); save();
  openShareText("Invite someone", tr("{name} shared the list {list} with you on Waqti.", { name: state.profile.name || tr("Someone"), list: l.emoji + " " + l.name }) + "\n\n" + tr("Open in Waqti: {link}", { link: linkFor(code) }) + "\n" + tr("Joining a shared list is always free."), "This link contains the list's key — send it only to people who should see the list.");
});
on("list-leave", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = "Tap again to leave"; return; }
  leaveList(cur()); save(); closeOverlay(); toast("You left the list");
});

/* ---------- arriving list links ---------- */
const listCapOf = res => (res.list && res.list.cap) || (res.data && res.data.cap) || FREE.members;
export async function handleListMessage(m, key) {
  const res = await receiveList(m, key);
  save();
  if (overlayOpen()) closeOverlay({ all: true });
  ui.render();
  if (res.kind === "joined") { toast("Joined " + res.list.name + " 🎉"); openList(res.list.id); }
  else if (res.kind === "updated") { toast("✓ " + res.list.name + " updated"); openList(res.list.id); }
  else if (res.kind === "new-person") {
    openOverlay(() => ovHead('<button class="link" data-action="close">Not now</button>', "Shared list", "") + '<div class="ov-body center stack">' +
      '<div style="font-size:40px" class="emo">' + esc(res.data.emoji || "🛒") + '</div><div class="sect-title"><span data-no-tr>' + esc(m.from.name) + "</span> <span>invited you to</span> <span data-no-tr>" + esc(res.data.name || "") + "</span></div>" +
      '<div class="small muted">Only join lists from people you know. Joining also allows their requests.</div>' +
      '<button class="btn" data-action="list-join">Join the list</button><button class="btn ghost" data-action="list-block" style="color:var(--danger)">Block</button></div>', { form: { m, key }, push: true });
  }
  else if (res.kind === "full") toast(tr("This list is full ({n} people). The person who made it can add more people with Pro.", { n: listCapOf(res) }));
  else if (res.kind === "needs-invite") toast("This list isn't on your phone — ask for the invite link");
  else if (res.kind === "bad-key") toast("This link doesn't match the list's key — ask them to send it again");
  else if (res.kind === "blocked") toast("Ignored — you blocked this person");
  else if (res.kind === "mismatch") toast("⚠️ This doesn't match the person you allowed before — not added");
}
on("list-join", async () => { const { m, key } = ui.form; allow(m.from); m._allowed = true; closeOverlay(); await handleListMessage(m, key); });
on("list-block", () => { const { m } = ui.form; import("../requests.js").then(r => { r.block(m.from); save(); closeOverlay(); toast("Blocked"); }); });

/* ---------- Today strip ---------- */
export function listsStrip() {
  if (!state.lists.length) return "";
  return '<div class="lists-strip">' + state.lists.slice(0, 4).map(l => '<button class="chip" data-action="list-open" data-id="' + l.id + '"><span class="emo">' + l.emoji + '</span> <span data-no-tr>' + esc(l.name) + '</span> <span class="muted tabnum">' + openCount(l) + "</span>" + (l.dirty ? ' <span class="dot-badge" aria-label="Changes not sent"></span>' : "") + "</button>").join("") + "</div>";
}
