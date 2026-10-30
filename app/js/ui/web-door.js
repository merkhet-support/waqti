// The public website (CONFIG.shareBase) is a shop window, not the app: it shows demos that save
// nothing and points to the store, so nobody uses the full app (Pro included) free in a browser.
// Request and list links still land here for people without the app: they get "Open in the app",
// a copy button for pasting into the app, and the store link. The phone app, the private preview
// and local testing (any other address) run the full app as before.

import { CONFIG } from "../config.js";
import { esc, toast } from "../util.js";
import { on } from "./core.js";
import { extractCode } from "../requests.js";

const nativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export const isPublicWeb = () => !nativeApp() && !!CONFIG.shareBase && location.href.startsWith(CONFIG.shareBase);

const DEMOS = [
  ["fresh", "✨", "Set up your own day", "Try the full setup — nothing is saved"],
  ["nurse", "🌙", "A night-shift nurse", "4 nights on, 4 off — the day resets at sleep"],
  ["worship", "🕌", "A Muslim day in Cairo", "Prayer times, Quran and Monday–Thursday fasts"],
  ["church", "⛪", "A Coptic Orthodox day", "Agpeya hours and the church's fasts"],
  ["life", "🚗", "Bills, car and dates", "Paid and unpaid bills, oil change by km, birthdays"]
];

const lang = () => new URLSearchParams(location.search).get("lang") === "ar" || document.documentElement.lang === "ar" ? "&lang=ar" : "";
const sharedLink = () => (location.hash.includes("waqti=") && extractCode(location.hash) ? location.hash : "");

function storeButton() {
  return CONFIG.playUrl
    ? '<a class="btn" href="' + esc(CONFIG.playUrl) + '" rel="noopener">Get Waqti on Google Play</a>'
    : '<div class="card pad small center"><span class="emo">📱</span> <b>The Android app is coming soon.</b><br><span class="muted">iPhone after that.</span></div>';
}

export function viewDoor(el) {
  const link = sharedLink();
  const linkCard = link
    ? '<div class="card pad stack-sm"><div class="bold"><span class="emo">📨</span> <span>Someone sent you a Waqti request or list</span></div>' +
      '<div class="small muted">It opens in the Waqti app on your phone, where your data stays private.</div>' +
      '<a class="btn" href="waqti://r' + esc(link) + '">Open in the Waqti app</a>' +
      '<button class="btn sec" data-action="door-copy">Copy the link</button>' +
      '<div class="tiny muted">Or open Waqti → Me → Requests &amp; people, and paste it there.</div></div>'
    : "";
  el.innerHTML = '<div class="ob" style="max-width:520px;margin:0 auto;padding-inline:16px">' +
    '<div class="center"><img src="icons/icon.svg" alt="" class="ob-logo" style="margin-inline:auto"><h1 class="ob-title">Waqti lives on your phone</h1>' +
    '<p class="small muted">Your habits, tasks and prayers, on your clock. Free, private, no account.</p></div>' +
    linkCard + storeButton() +
    '<div class="sect-title">Try a demo</div><div class="card">' +
    DEMOS.map(([id, icon, title, desc]) => '<a class="li" style="color:inherit;text-decoration:none" href="?demo=' + id + lang() + '"><span class="lic">' + icon + '</span><span class="grow"><span class="small bold" style="display:block">' + title + '</span><span class="tiny muted">' + desc + '</span></span><span class="chev">›</span></a>').join("") +
    '</div><p class="tiny muted center">Demos run in your browser and are wiped when you close the page.</p>' +
    '<p class="tiny center"><a href="../">Waqti website</a> · <a href="../privacy-policy.html">Privacy</a> · <a href="../terms.html">Terms</a></p></div>';
}

// A slim bar on top of every public demo screen: it's a demo, and how to get the real app.
export function demoBar() {
  return '<div class="card pad tiny row" style="gap:8px;margin-bottom:10px;background:var(--accent-soft);border-color:transparent"><span class="grow"><b>Demo</b> · <span>nothing is saved</span></span><a href="./' + (lang() ? "?lang=ar" : "") + '" style="font-weight:600;color:var(--accent-ink, var(--accent));text-decoration:none">Get the app ›</a></div>';
}

on("door-copy", async () => {
  const text = CONFIG.shareBase + sharedLink();
  try { await navigator.clipboard.writeText(text); toast("Link copied"); }
  catch (e) { prompt("Copy this link:", text); }
});
