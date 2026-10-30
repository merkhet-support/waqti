// Qibla compass and the reminder-sound picker (Adhan, church bell, chime).

import { state, save } from "../store.js";
import { esc, toast } from "../util.js";
import { faithCfg, prayerLocation } from "../faith.js";
import { today } from "../dates.js";
import { PRAYERS } from "../prayer.js";
import { qiblaBearing, distanceKm, compassPoint } from "../qibla.js";
import { SOUNDS, soundsFor, soundAllowed, soundReady, soundById, defaultFaithSound, preview, stopPreview, detectSounds } from "../sounds.js";
import { canUse } from "../pro.js";
import { on, openOverlay, closeOverlay, rerenderOverlay, ui } from "./core.js";
import { ovHead } from "./components.js";

/* ---------- Qibla ---------- */
let heading = null, listening = false, aligned = false;
export function openQibla() {
  const loc = prayerLocation(today());
  if (!loc || loc.lat == null) { toast("Set your city in Faith settings first"); return; }
  heading = null; aligned = false;
  openOverlay(renderQibla, { form: { loc }, push: true });
}
function renderQibla() {
  const { loc } = ui.form, b = qiblaBearing(loc.lat, loc.lng), km = Math.round(distanceKm(loc.lat, loc.lng));
  const rot = heading == null ? b : b - heading;
  let h = ovHead('<button class="link" data-action="qibla-close">Close</button>', "Qibla", "") + '<div class="ov-body center stack">';
  h += '<div class="qibla" role="img" aria-label="Qibla direction ' + Math.round(b) + ' degrees from north">' +
    '<div class="qibla-dial" style="transform:rotate(' + (heading == null ? 0 : -heading) + 'deg)"><span class="n">N</span><span class="e">E</span><span class="s">S</span><span class="w">W</span></div>' +
    '<div class="qibla-arrow' + (aligned ? " on" : "") + '" style="transform:rotate(' + rot + 'deg)"><span>🕋</span></div></div>';
  h += '<div class="sect-title tabnum">' + Math.round(b) + "° " + compassPoint(b) + '</div><div class="small muted"><span>from north</span> · <span class="tabnum">' + km.toLocaleString() + " km</span> <span>to Makkah</span> · <span data-no-tr>" + esc(loc.name || "") + "</span></div>";
  if (aligned) h += '<div class="okbox">✅ You\'re facing the Qibla</div>';
  if (heading == null) h += '<button class="btn" data-action="qibla-start">🧭 <span>Use my phone\'s compass</span></button><div class="hint">Hold your phone flat, away from magnets and metal. Without a compass, the arrow shows the direction from north.</div>';
  else h += '<div class="hint">Turn until the Kaaba points straight up. If it seems off, move your phone in a figure 8 to calibrate.</div>';
  return h + "</div>";
}
function onOrient(e) {
  const ov = document.querySelector(".qibla");
  if (!ov) { stopCompass(); return; }
  let hd = null;
  if (typeof e.webkitCompassHeading === "number") hd = e.webkitCompassHeading;           // iOS
  else if (e.absolute && typeof e.alpha === "number") hd = (360 - e.alpha) % 360;          // Android
  if (hd == null) return;
  const first = heading == null;
  heading = hd;
  const b = qiblaBearing(ui.form.loc.lat, ui.form.loc.lng);
  const diff = Math.abs(((b - hd + 540) % 360) - 180);
  const now = diff < 5, changed = now !== aligned;
  if (now && !aligned) { try { navigator.vibrate && navigator.vibrate(40); } catch (err) { /* ignore */ } }
  aligned = now;
  // Text changes (first reading, aligned / not) re-render; otherwise just turn the dial and arrow.
  if (first || changed) { rerenderOverlay(); return; }
  const dial = ov.querySelector(".qibla-dial"), arrow = ov.querySelector(".qibla-arrow");
  if (dial) dial.style.transform = "rotate(" + (-hd) + "deg)";
  if (arrow) arrow.style.transform = "rotate(" + (b - hd) + "deg)";
}
function stopCompass() {
  window.removeEventListener("deviceorientationabsolute", onOrient, true);
  window.removeEventListener("deviceorientation", onOrient, true);
  listening = false;
}
on("qibla-start", async () => {
  try {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== "granted") { toast("Compass access was declined — the arrow shows the direction from north"); return; }
    }
  } catch (e) { /* older browsers don't ask */ }
  if (listening) return;
  listening = true;
  window.addEventListener("ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation", onOrient, true);
  setTimeout(() => { if (heading == null && document.querySelector(".qibla")) toast("No compass found on this device"); }, 2500);
});
on("qibla-close", () => { stopCompass(); closeOverlay(); });
on("open-qibla", () => openQibla());

/* ---------- reminder sounds ---------- */
export async function openSounds() {
  await detectSounds();
  const s = Object.assign({ faith: null, habits: "default", perPrayer: {} }, state.settings.sounds || {});
  if (!s.faith || !soundAllowed(soundById(s.faith))) s.faith = defaultFaithSound(faithCfg().religion);
  openOverlay(renderSounds, { form: s, push: true });
}
function soundRow(path, s, cur) {
  const missing = !soundReady(s), locked = !missing && !soundAllowed(s);
  return '<div class="li sound-row' + (cur === s.id ? " on" : "") + (missing ? " soon" : "") + '"><button type="button" class="grow sound-pick" data-action="' + (missing ? "sound-soon" : locked ? "pro-locked" : "set") + '" data-path="' + path + '" data-val="' + s.id + '" aria-pressed="' + (cur === s.id) + '"' + (missing ? ' aria-disabled="true"' : "") + ">" +
    '<span class="radio' + (cur === s.id ? " on" : "") + '"></span><span class="small">' + esc(s.label) + "</span>" +
    (missing ? ' <span class="badge plain">Coming soon</span>' : locked ? ' <span class="badge plain">Pro</span>' : "") + "</button>" +
    (s.file && !missing ? '<button type="button" class="icon-btn sm" data-action="sound-preview" data-id="' + s.id + '" aria-label="Play ' + esc(s.label) + '">▶</button>' : "") + "</div>";
}
on("sound-soon", () => toast("This recording is coming in a future update"));
function renderSounds() {
  const f = ui.form, religion = faithCfg().religion;
  let h = ovHead('<button class="link" data-action="sounds-close">Cancel</button>', "Reminder sounds", '<button class="link" data-action="sounds-save">Save</button>') + '<div class="ov-body">';
  if (religion) {
    h += '<div class="eyebrow">' + (religion === "muslim" ? "Prayer reminders" : religion === "christian" ? "Prayer & church reminders" : "Faith reminders") + '</div><div class="list">' +
      soundsFor(religion).filter(s => s.faith || s.id === "chime" || s.id === "default").map(s => soundRow("faith", s, f.faith)).join("") + "</div>";
    if (religion === "muslim" && soundsFor("muslim").some(s => s.faith === "muslim" && soundReady(s))) {
      const opts = soundsFor("muslim").filter(s => s.faith === "muslim" || s.id === "default");
      const locked = !canUse("perPrayerSound");
      h += '<div class="eyebrow">A different sound per prayer' + (locked ? ' <span class="badge plain">Pro</span>' : "") + '</div><div class="card pad stack-sm">' +
        PRAYERS.map(p => '<div class="spread"><span class="small bold">' + p.name + '</span><select class="input sm" data-bind="perPrayer.' + p.id + '"' + (locked ? " disabled" : "") + ' style="width:62%"><option value="">Same as above</option>' +
          opts.filter(soundAllowed).map(s => '<option value="' + s.id + '"' + (f.perPrayer[p.id] === s.id ? " selected" : "") + ">" + esc(s.label) + "</option>").join("") + "</select></div>").join("") + "</div>";
    }
  }
  h += '<div class="eyebrow">Other habits & tasks</div><div class="list">' + SOUNDS.filter(s => !s.faith).map(s => soundRow("habits", s, f.habits)).join("") + "</div>";
  h += '<div class="hint">Custom sounds play in the Android and iPhone app. In the browser, notifications use your device\'s sound.</div>';
  return h + '<button class="btn" data-action="sounds-save">Save</button></div>';
}
on("sound-preview", async id => {
  const r = await preview(id);
  if (r === "missing") toast("This sound hasn't been added to the app yet");
});
on("pro-locked", () => toast("Part of Waqti Pro"));
on("sounds-close", () => { stopPreview(); closeOverlay(); });
on("sounds-save", () => {
  stopPreview();
  const f = ui.form;
  Object.keys(f.perPrayer || {}).forEach(k => { if (!f.perPrayer[k]) delete f.perPrayer[k]; });
  state.settings.sounds = { faith: f.faith, habits: f.habits, perPrayer: f.perPrayer || {} };
  save(); closeOverlay(); toast("Sounds saved — " + soundById(f.faith).label);
});
on("open-sounds", () => openSounds());
