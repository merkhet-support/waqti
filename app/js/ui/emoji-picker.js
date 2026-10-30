// Phone-keyboard style emoji picker in a bottom sheet: category tabs, search,
// recents, and a field that accepts any emoji from the device keyboard.

import { EMOJI_CATS, searchEmoji } from "../emoji-data.js";
import { state, rememberEmoji } from "../store.js";
import { openSheet, closeSheet, setSheetBody, on } from "./core.js";
import { esc, firstEmoji, SEARCH_SVG, toast } from "../util.js";

let pickCb = null;

function grid(list) {
  return '<div class="emo-grid">' + list.map(e => '<button type="button" data-action="emoji-pick" data-id="' + esc(e) + '" aria-label="' + esc(e) + '">' + e + "</button>").join("") + "</div>";
}

function allSections() {
  let h = "";
  if (state.recentEmoji.length) h += '<div class="emo-cat" id="emo-recent">Recently used</div>' + grid(state.recentEmoji);
  for (const c of EMOJI_CATS) h += '<div class="emo-cat" id="emo-' + c.id + '">' + c.name + "</div>" + grid(c.items.map(i => i.e));
  return h;
}

export function openEmojiPicker(current, cb) {
  pickCb = cb;
  const tabs = (state.recentEmoji.length ? [{ id: "recent", icon: "🕘" }] : []).concat(EMOJI_CATS);
  openSheet(
    '<div class="sheet-head">' +
      '<div class="spread"><div class="sect-title">Choose an icon</div><button class="link" data-action="sheet-close">Done</button></div>' +
      '<div class="search">' + SEARCH_SVG + '<input class="input" id="emo-search" type="search" placeholder="Search emoji — e.g. water, gym, pray" data-oninput="emoji-search" autocomplete="off"></div>' +
      '<input class="emo-own" id="emo-own" placeholder="…or type any emoji from your keyboard 😊" data-oninput="emoji-own" aria-label="Type an emoji" enterkeyhint="done">' +
    "</div>" +
    '<div class="sheet-body" id="emo-body">' + allSections() + "</div>" +
    '<div class="emo-tabs" role="tablist">' + tabs.map(t => '<button type="button" data-action="emoji-tab" data-id="' + t.id + '" class="' + (t.id === tabs[0].id ? "on" : "") + '" aria-label="' + (t.name || "Recent") + '">' + t.icon + "</button>").join("") + "</div>"
  );
  // inputs inside the sheet aren't part of a form model, so wire them directly
  const s = document.getElementById("emo-search");
  s.addEventListener("input", () => {
    const q = s.value;
    setSheetBody("#emo-body", q.trim() ? (searchEmoji(q).length ? grid(searchEmoji(q)) : '<div class="center small muted" style="padding:30px 10px">No match. Try another word, or use your keyboard\'s emoji in the box above.</div>') : allSections());
  });
  const own = document.getElementById("emo-own");
  own.addEventListener("input", () => {
    const e = firstEmoji(own.value);
    if (e) choose(e);
    else if (own.value.trim()) { own.value = ""; toast("Please pick an emoji, not text"); }
  });
}

function choose(e) {
  rememberEmoji(e);
  const cb = pickCb; pickCb = null;
  closeSheet();
  if (cb) cb(e);
}

on("emoji-pick", id => choose(id));
on("sheet-close", () => closeSheet());
on("emoji-tab", (id, el) => {
  document.querySelectorAll(".emo-tabs button").forEach(b => b.classList.toggle("on", b === el));
  const s = document.getElementById("emo-search");
  if (s && s.value) { s.value = ""; setSheetBody("#emo-body", allSections()); }
  const target = document.getElementById("emo-" + id), body = document.getElementById("emo-body");
  if (target && body) body.scrollTo({ top: target.offsetTop - body.offsetTop, behavior: "smooth" });
});
