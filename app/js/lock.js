// Optional PIN lock. It keeps a glance at an unlocked phone away from medicine, mood, sleep and
// quit logs. It isn't encryption: the data is still on the phone, protected by the phone's own lock.
// Only a salted SHA-256 of the PIN is kept. Forgetting the PIN never costs data: turning the lock
// off takes a 60-second wait instead, so someone picking up the phone can't do it at a glance.

import { state, save } from "./store.js";
import { tr } from "./i18n.js";

const AWAY_MS = 60e3;       // lock again after a minute in the background
const FORGET_WAIT = 60;     // seconds before a forgotten PIN can be removed
let hiddenAt = 0, shown = false;

const lockCfg = () => (state && state.settings && state.settings.lock) || null;
export const lockOn = () => !!(lockCfg() && lockCfg().on && lockCfg().hash);

// PBKDF2 (100,000 rounds) makes each guess slow, so a short PIN can't be tried instantly by someone
// who copied the app's data. PINs saved with the first version (one SHA-256) still open, and are
// upgraded on the next unlock.
const ROUNDS = 100000;
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
async function hash(pin, salt, alg) {
  const bytes = new TextEncoder().encode(salt + ":" + pin);
  if (alg !== "pbkdf2") return hex(await crypto.subtle.digest("SHA-256", bytes));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: ROUNDS }, key, 256));
}
export async function setPin(pin) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  state.settings.lock = { on: true, salt, alg: "pbkdf2", hash: await hash(pin, salt, "pbkdf2") };
  save();
}
export function removeLock() { state.settings.lock = { on: false, salt: null, hash: null }; save(); }
export async function checkPin(pin) {
  const c = lockCfg();
  if (!c || (await hash(pin, c.salt, c.alg)) !== c.hash) return false;
  if (c.alg !== "pbkdf2") await setPin(pin); // upgrade an old SHA-256 PIN
  return true;
}

function el() { return document.getElementById("lock-screen"); }
export function showLock() {
  if (!lockOn() || shown) return;
  shown = true;
  const d = document.createElement("div");
  d.id = "lock-screen";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.innerHTML = '<div class="lock-box"><div class="lock-icon" aria-hidden="true">🔒</div><div class="sect-title">' + tr("Waqti is locked") + "</div>" +
    '<form id="lock-form" class="stack-sm"><input id="lock-pin" class="input" type="password" inputmode="numeric" autocomplete="off" maxlength="8" aria-label="' + tr("PIN") + '" placeholder="' + tr("PIN") + '">' +
    '<button class="btn" type="submit">' + tr("Unlock") + "</button></form>" +
    '<div id="lock-msg" class="small" aria-live="polite"></div>' +
    '<button class="link small" id="lock-forgot" type="button">' + tr("Forgot your PIN?") + "</button></div>";
  document.body.appendChild(d);
  document.body.classList.add("locked");
  const input = d.querySelector("#lock-pin");
  setTimeout(() => input.focus(), 50);
  d.querySelector("#lock-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (await checkPin(input.value)) hideLock();
    else { input.value = ""; d.querySelector("#lock-msg").textContent = tr("That PIN didn't match. Try again."); }
  });
  d.querySelector("#lock-forgot").addEventListener("click", () => forgot(d));
}
function forgot(d) {
  const msg = d.querySelector("#lock-msg"), btn = d.querySelector("#lock-forgot");
  btn.hidden = true;
  let left = FORGET_WAIT;
  const tick = () => {
    if (!el()) return;
    if (left <= 0) {
      msg.innerHTML = tr("You can turn the lock off now. Your data stays as it is.") + ' <button class="btn xs soft" id="lock-remove" type="button">' + tr("Turn off the lock") + "</button>";
      d.querySelector("#lock-remove").addEventListener("click", () => { removeLock(); hideLock(); });
      return;
    }
    msg.textContent = tr("To turn the lock off, wait {n} seconds. Your data stays as it is.", { n: left });
    left--; setTimeout(tick, 1000);
  };
  tick();
}
export function hideLock() {
  const d = el(); if (d) d.remove();
  document.body.classList.remove("locked");
  shown = false;
}

export function initLock() {
  showLock();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) showLock();
  });
}
