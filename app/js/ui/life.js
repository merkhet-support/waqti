// Life admin: ready-made packs (car, bills, important dates, pets, period), the Today cards that
// go with them (coming up, unpaid bills, car service due by distance), and the car, bills and
// cycle screens under Me.

import { state, save, newHabit, activeHabits, findHabit } from "../store.js";
import { esc, toast, uid } from "../util.js";
import { today, addDays, keyOf, fromKey, fmtDate, daysBetween, daysInMonth } from "../dates.js";
import { isScheduled, status, tap, kmLeft } from "../schedule.js";
import { on, ui, openOverlay, closeOverlay, rerenderOverlay, openSheet, closeSheet } from "./core.js";
import { ovHead, proTag, proSheet } from "./components.js";
import { canUse, FREE } from "../pro.js";
import { tr } from "../i18n.js";
import { REGIONS, region } from "../occasions.js";
import { cycleCfg, avgCycle, avgLength, periodOn, nextStart, irregular, logStart, logEnd, removeStart, lastStart } from "../cycle.js";

const cur = () => state.settings.currency || "EGP";
const money = n => (+n || 0).toLocaleString() + " " + cur();
const addMonths = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); x.setDate(Math.min(d.getDate(), daysInMonth(x))); return x; };
const dateRow = (label, path, val) => '<div class="field"><label>' + label + '</label><input type="date" data-bind="' + path + '" value="' + esc(val || "") + '"></div>';
const checkLine = (path, on, emoji, title, extra) => '<label class="checkrow"><input type="checkbox" data-bind="' + path + '"' + (on ? " checked" : "") + ' data-rerender><span class="emo">' + emoji + '</span><span class="grow small bold">' + title + "</span>" + (extra || "") + "</label>";

function make(over) {
  const h = newHabit(over);
  h.reminders = Object.assign(h.reminders, over.reminders || {});
  state.habits.push(h);
  return h;
}
const remindAt = (time, lead) => ({ on: true, mode: "times", times: [time], lead: lead || [], nag: 0 });

/* ---------- packs picked during setup ---------- */
// [id, action that opens its form, emoji, label]
export const PACKS = [["car", "pack-car", "🚗", "Car"], ["bills", "pack-bills", "🧾", "Bills & subscriptions"], ["dates", "pack-dates", "🎂", "Birthdays & dates"],
  ["pets", "pack-pets", "🐾", "Pets"], ["health", "pack-health", "🩺", "Health check-ups"], ["home", "pack-home", "🛠️", "Home upkeep"],
  ["docs", "pack-docs", "🛂", "Documents & IDs"], ["cycle", "open-cycle", "🌸", "Period tracker"]];
const pending = () => (state.meta && state.meta.pendingPacks) || [];
function packDone(id) { if (state.meta && state.meta.pendingPacks) state.meta.pendingPacks = state.meta.pendingPacks.filter(x => x !== id); }
// Today, after setup: one tap opens each pack picked during setup.
function setupCard() {
  const list = PACKS.filter(p => pending().includes(p[0]));
  if (!list.length) return "";
  return '<div class="card pad stack-sm"><div class="row"><span class="emo" style="font-size:22px">📦</span><div class="grow"><div class="small bold">Finish setting up</div><div class="tiny muted">A minute each. You can also find them under + → Ready-made packs.</div></div>' +
    '<button class="link small" data-action="packs-later" aria-label="Dismiss">✕</button></div><div class="chips">' +
    list.map(([id, action, e, l]) => '<button type="button" class="chip" data-action="' + action + '"><span class="emo">' + e + "</span><span>" + tr(l) + "</span></button>").join("") + "</div></div>";
}
on("packs-later", () => { state.meta.pendingPacks = []; save(); ui.render(); });

/* ---------- the packs sheet ---------- */
on("open-packs", () => {
  closeSheet();
  setTimeout(() => openSheet('<div class="sheet-head"><div class="sect-title">Ready-made packs</div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    pack("pack-car", "🚗", "Car", "Oil, tyres, service, licence and insurance, by date and by kilometres") +
    pack("pack-bills", "🧾", "Home & bills", "Rent, electricity, internet, phone, subscriptions, credit card") +
    pack("pack-dates", "🎂", "Important dates", "Birthdays, anniversaries, Mother's and Father's Day, Valentine's") +
    pack("pack-pets", "🐾", "Pets", "Feeding, walks, vaccines, deworming, flea treatment") +
    pack("pack-health", "🩺", "Health check-ups", "Dentist, yearly check-up, eye test, blood test") +
    pack("pack-home", "🛠️", "Home upkeep", "AC filters, water filter, water heater, pest control") +
    pack("pack-docs", "🛂", "Documents & IDs", "ID, passport, licence, residency / iqama, visa — before they expire") +
    pack("open-cycle", "🌸", "Period tracker", "Log it, see the next one coming, private by default") + "</div>"), 60);
});
const pack = (action, icon, title, desc) => '<button class="li card" data-action="' + action + '" style="border-radius:14px"><span class="lic">' + icon + '</span><span class="grow"><span class="small bold" style="display:block">' + title + '</span><span class="tiny muted">' + desc + '</span></span><span class="chev">›</span></button>';

/* ---------- car ---------- */
const CAR_ITEMS = [
  ["oil", "🛢️", "Oil change", 6, 5000], ["tyres", "🛞", "Tyre rotation & pressure", 6, 10000], ["service", "🔧", "Full service", 12, 15000],
  ["brakes", "🛑", "Brake check", 12, 20000], ["battery", "🔋", "Battery check", 12, 0], ["wash", "🧽", "Car wash", 0, 0]
];
on("pack-car", () => {
  closeSheet();
  if ((state.vehicles || []).length >= FREE.cars && !canUse("moreCars")) return setTimeout(() => proSheet("🚗", "More cars with Pro", "Your free plan covers one car. Pro adds every car in the family, each with its own kilometres."), 80);
  const f = { name: tr("My car"), odo: "", licence: "", insurance: "", pick: {} };
  CAR_ITEMS.forEach(i => { f.pick[i[0]] = i[0] !== "wash" && i[0] !== "battery"; });
  openOverlay(renderCarPack, { form: f, push: true });
});
function renderCarPack() {
  const f = ui.form;
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', "Car", '<button class="link" data-action="car-create">Add</button>') + '<div class="ov-body">';
  h += '<div class="row"><div class="field grow"><label>Car</label><input data-bind="name" value="' + esc(f.name) + '" maxlength="30" placeholder="e.g. Corolla"></div>' +
    '<div class="field" style="width:130px"><label>Kilometres now</label><input type="number" min="0" inputmode="numeric" data-bind="odo" value="' + esc(f.odo) + '" placeholder="e.g. 45000"></div></div>';
  h += '<div class="card pad stack-xs"><div class="small bold">Maintenance</div>' + CAR_ITEMS.map(([id, e, n, m, km]) => checkLine("pick." + id, f.pick[id], e, tr(n),
    '<span class="tiny muted">' + (id === "wash" ? tr("every 2 weeks") : tr("every {m} months", { m }) + (km ? " · " + km.toLocaleString() + " km" : "")) + "</span>")).join("") +
    '<div class="hint">Whichever comes first: the date or the distance. Update the kilometres now and then from Me → your car.</div></div>';
  h += '<div class="card pad stack-xs"><div class="small bold">Renewals</div>' + dateRow(tr("Licence expires on"), "licence", f.licence) + dateRow(tr("Insurance renews on"), "insurance", f.insurance) +
    '<div class="hint">Reminded 30 days and 7 days before, every year.</div></div>';
  return h + "</div>";
}
on("car-create", () => {
  const f = ui.form, t = today(), odo = Math.max(0, Math.round(+f.odo || 0));
  const v = { id: uid(), name: (f.name || "").trim() || tr("My car"), odo, odoAt: Date.now() };
  state.vehicles.push(v);
  let n = 0;
  CAR_ITEMS.forEach(([id, e, name, months, km]) => {
    if (!f.pick[id]) return;
    const schedule = id === "wash" ? { kind: "interval", n: 14, start: keyOf(addDays(t, 7)) } : { kind: "months", n: months, start: keyOf(addMonths(t, months)) };
    make({ name: tr(name) + " · " + v.name, emoji: e, category: "Car", schedule, reminders: remindAt("10:00", id === "wash" ? [] : [7]), car: { vid: v.id, everyKm: km, lastOdo: odo } });
    n++;
  });
  [["licence", "🪪", "Renew car licence"], ["insurance", "🛡️", "Renew car insurance"]].forEach(([k, e, name]) => {
    if (!f[k]) return;
    const d = fromKey(f[k]);
    make({ name: tr(name) + " · " + v.name, emoji: e, category: "Car", schedule: { kind: "yearly", month: d.getMonth() + 1, monthDay: d.getDate(), start: keyOf(t) }, reminders: remindAt("10:00", [30, 7]) });
    n++;
  });
  packDone("car"); save(); closeOverlay({ all: true }); ui.render(); toast(tr("{n} car reminders added 🚗", { n }));
});

/* ---------- bills ---------- */
const BILLS = [["rent", "🏠", "Rent", 1], ["power", "⚡", "Electricity", 10], ["water", "💧", "Water", 10], ["gas", "🔥", "Gas", 10], ["net", "🌐", "Internet", 15],
  ["phone", "📱", "Phone plan", 15], ["card", "💳", "Credit card payment", 25], ["stream", "📺", "Netflix / streaming", 5], ["gym", "🏋️", "Gym membership", 1]];
on("pack-bills", () => {
  closeSheet();
  const f = { pick: {}, day: {}, amount: {}, other: "", otherDay: 1, otherAmount: "" };
  BILLS.forEach(b => { f.pick[b[0]] = ["rent", "power", "net", "phone"].includes(b[0]); f.day[b[0]] = b[3]; f.amount[b[0]] = ""; });
  openOverlay(renderBillsPack, { form: f, push: true });
});
const daySel = (path, v) => '<select class="input sm" data-bind="' + path + '" data-num style="width:74px" aria-label="Due day">' + Array.from({ length: 31 }, (_, i) => '<option value="' + (i + 1) + '"' + (+v === i + 1 ? " selected" : "") + ">" + (i + 1) + "</option>").join("") + "</select>";
function renderBillsPack() {
  const f = ui.form;
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', "Home & bills", '<button class="link" data-action="bills-create">Add</button>') + '<div class="ov-body">';
  h += '<div class="small muted">Pick your bills, the day each is due and, if you like, the amount. You get a heads-up 3 days before, and a bill stays on Today until you tick it paid.</div>';
  h += '<div class="card pad stack-xs">' + BILLS.map(([id, e, n]) => checkLine("pick." + id, f.pick[id], e, tr(n), f.pick[id]
    ? '<span class="row" style="gap:6px"><span class="tiny muted">day</span>' + daySel("day." + id, f.day[id]) + '<input class="input sm" type="number" min="0" inputmode="decimal" data-bind="amount.' + id + '" value="' + esc(f.amount[id]) + '" placeholder="' + esc(cur()) + '" style="width:92px" aria-label="Amount"></span>' : "")).join("") + "</div>";
  h += '<div class="card pad stack-xs"><div class="small bold">Another bill or subscription</div><div class="row" style="gap:6px"><input class="input grow" data-bind="other" value="' + esc(f.other) + '" placeholder="e.g. School fees, Spotify" maxlength="40">' +
    daySel("otherDay", f.otherDay) + '<input class="input sm" type="number" min="0" inputmode="decimal" data-bind="otherAmount" value="' + esc(f.otherAmount) + '" placeholder="' + esc(cur()) + '" style="width:92px" aria-label="Amount"></div></div>';
  h += '<div class="hint">🔒 Bills are private: the lock screen just says “Waqti reminder”. Waqti never pays anything for you.</div>';
  return h + "</div>";
}
on("bills-create", () => {
  const f = ui.form, list = BILLS.filter(b => f.pick[b[0]]).map(([id, e, n]) => [e, tr(n), f.day[id], f.amount[id]]);
  if ((f.other || "").trim()) list.push(["🧾", f.other.trim(), f.otherDay, f.otherAmount]);
  list.forEach(([e, name, day, amount]) => make({ name, emoji: e, category: "Bills", private: true, bill: { amount: amount === "" || isNaN(+amount) ? null : +amount },
    schedule: { kind: "monthly", monthDay: +day || 1, start: keyOf(today()) }, reminders: remindAt("10:00", [3]) }));
  packDone("bills"); save(); closeOverlay({ all: true }); ui.render(); toast(tr("{n} bills added 🧾", { n: list.length }));
});

/* ---------- important dates ---------- */
const DATES = [["mom", "🎂", "Mom's birthday"], ["dad", "🎂", "Dad's birthday"], ["partner", "🎂", "My partner's birthday"], ["wedding", "💍", "Wedding anniversary"]];
const FIXED = [["mothers", "💐", "Mother's Day", { occasion: "mothers-day" }], ["fathers", "👔", "Father's Day", { occasion: "fathers-day" }], ["valentine", "💝", "Valentine's Day", { month: 2, monthDay: 14 }]];
on("pack-dates", () => {
  closeSheet();
  openOverlay(renderDatesPack, { form: { d: {}, fixed: { mothers: true, fathers: false, valentine: false }, region: region(), other: "", otherDate: "" }, push: true });
});
function renderDatesPack() {
  const f = ui.form;
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', "Important dates", '<button class="link" data-action="dates-create">Add</button>') + '<div class="ov-body">';
  h += '<div class="small muted">Fill in the ones you want. Each comes every year, with a heads-up a week before (time to plan or buy a gift) and on the day.</div>';
  h += '<div class="card pad stack-xs">' + DATES.map(([id, e, n]) => dateRow(e + " " + tr(n), "d." + id, f.d[id])).join("") + "</div>";
  h += '<div class="card pad stack-xs">' + FIXED.map(([id, e, n]) => checkLine("fixed." + id, f.fixed[id], e, tr(n))).join("") +
    '<div class="field"><label>Mother\'s and Father\'s Day dates for</label><select class="input" data-bind="region">' + REGIONS.map(([v, l]) => '<option value="' + v + '"' + (f.region === v ? " selected" : "") + ">" + esc(tr(l)) + "</option>").join("") + "</select></div></div>";
  h += '<div class="card pad stack-xs"><div class="small bold">Another date</div><input class="input" data-bind="other" value="' + esc(f.other) + '" placeholder="e.g. Sara\'s birthday, our first date" maxlength="40">' + dateRow(tr("Date"), "otherDate", f.otherDate) + "</div>";
  return h + "</div>";
}
on("dates-create", () => {
  const f = ui.form, t = today(), yearly = (name, emoji, extra) => make({ name, emoji, category: "Dates", schedule: Object.assign({ kind: "yearly", start: keyOf(t) }, extra), reminders: remindAt("09:00", [7, 1]) });
  let n = 0;
  state.settings.region = f.region;
  DATES.forEach(([id, e, name]) => { if (f.d[id]) { const d = fromKey(f.d[id]); yearly(tr(name), e, { month: d.getMonth() + 1, monthDay: d.getDate() }); n++; } });
  FIXED.forEach(([id, e, name, extra]) => { if (f.fixed[id]) { yearly(tr(name), e, extra); n++; } });
  if ((f.other || "").trim() && f.otherDate) { const d = fromKey(f.otherDate); yearly(f.other.trim(), "📅", { month: d.getMonth() + 1, monthDay: d.getDate() }); n++; }
  packDone("dates"); save(); closeOverlay({ all: true }); ui.render(); toast(tr("{n} dates added 🎂", { n }));
});

/* ---------- pets ---------- */
on("pack-pets", () => {
  closeSheet();
  openOverlay(renderPetsPack, { form: { name: "", kind: "dog", vaccine: "", pick: { feed: true, walk: true, vaccine: true, worm: true, flea: true, groom: false, litter: true } }, push: true });
});
const PET_ITEMS = kind => [
  ["feed", "🍽️", "Feed {pet}", "twice a day"], kind === "dog" && ["walk", "🦮", "Walk {pet}", "twice a day"], kind === "cat" && ["litter", "🧹", "Clean {pet}'s litter box", "every day"],
  ["worm", "💊", "Deworm {pet}", "every 3 months"], (kind === "dog" || kind === "cat") && ["flea", "🪲", "Flea & tick treatment for {pet}", "every month"],
  kind === "dog" && ["groom", "✂️", "Groom {pet}", "every 2 months"]
].filter(Boolean);
function renderPetsPack() {
  const f = ui.form;
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', "Pets", '<button class="link" data-action="pets-create">Add</button>') + '<div class="ov-body">';
  h += '<div class="row"><div class="field grow"><label>Name</label><input data-bind="name" value="' + esc(f.name) + '" maxlength="20" placeholder="e.g. Luna"></div></div>';
  h += '<div class="seg" style="--cols:4">' + [["dog", "🐕 Dog"], ["cat", "🐈 Cat"], ["bird", "🐦 Bird"], ["other", "🐾 Other"]].map(([v, l]) => '<button type="button" class="' + (f.kind === v ? "on" : "") + '" data-action="set" data-path="kind" data-val="' + v + '">' + l + "</button>").join("") + "</div>";
  const pet = (f.name || "").trim() || tr("your pet");
  h += '<div class="card pad stack-xs">' + PET_ITEMS(f.kind).map(([id, e, n, when]) => checkLine("pick." + id, f.pick[id], e, esc(tr(n, { pet })), '<span class="tiny muted">' + tr(when) + "</span>")).join("") +
    checkLine("pick.vaccine", f.pick.vaccine, "💉", esc(tr("{pet}'s vaccines", { pet })), '<span class="tiny muted">' + tr("every year") + "</span>") +
    (f.pick.vaccine ? dateRow(tr("Next vaccine date (from your vet)"), "vaccine", f.vaccine) : "") + "</div>";
  h += '<div class="hint">Your vet knows best: change any of these to match what they recommend.</div>';
  return h + "</div>";
}
on("pets-create", () => {
  const f = ui.form, t = today(), pet = (f.name || "").trim();
  if (!pet) { toast("Give your pet a name first"); return; }
  const cfg = { feed: [{ kind: "daily" }, "count", 2, "meals", ["08:00", "19:00"]], walk: [{ kind: "daily" }, "count", 2, "walks", ["07:30", "18:30"]], litter: [{ kind: "daily" }, "check", 1, "", ["20:00"]],
    worm: [{ kind: "months", n: 3, start: keyOf(addMonths(t, 3)) }, "check", 1, "", ["10:00"], [3]], flea: [{ kind: "months", n: 1, start: keyOf(addMonths(t, 1)) }, "check", 1, "", ["10:00"], [2]],
    groom: [{ kind: "months", n: 2, start: keyOf(addMonths(t, 2)) }, "check", 1, "", ["10:00"], [3]] };
  let n = 0;
  PET_ITEMS(f.kind).forEach(([id, e, name]) => {
    if (!f.pick[id]) return;
    const [schedule, type, target, unit, times, lead] = cfg[id];
    make({ name: tr(name, { pet }), emoji: e, category: "Pets", type, target, unit, pet, schedule: Object.assign({ start: keyOf(t) }, schedule), reminders: { on: true, mode: "times", times, lead: lead || [], nag: 0 } });
    n++;
  });
  if (f.pick.vaccine) {
    const d = f.vaccine ? fromKey(f.vaccine) : addMonths(t, 12);
    make({ name: tr("{pet}'s vaccines", { pet }), emoji: "💉", category: "Pets", pet, schedule: { kind: "yearly", month: d.getMonth() + 1, monthDay: d.getDate(), start: keyOf(t) }, reminders: remindAt("10:00", [14, 3]) });
    n++;
  }
  packDone("pets"); save(); closeOverlay({ all: true }); ui.render(); toast(tr("{n} reminders added for {pet} 🐾", { n, pet }));
});

/* ---------- simple packs: health check-ups, home upkeep (every few months), documents (expiry dates) ---------- */
// [id, emoji, name, every N months (0 = a one-time expiry date), on by default]
const SIMPLE = {
  health: { title: "Health check-ups", cat: "Health", intro: "Regular check-ups, each on its own rhythm. Set the next date if you already have one booked.",
    items: [["dentist", "🦷", "Dentist check-up", 6, true], ["checkup", "🩺", "Yearly check-up", 12, true], ["eyes", "👁️", "Eye test", 24, false], ["blood", "🩸", "Blood test", 12, false], ["skin", "🧴", "Skin check", 12, false]],
    note: "Your doctor knows best: change any of these to match what they recommend." },
  home: { title: "Home upkeep", cat: "Home", intro: "The jobs that only matter when they're forgotten.",
    items: [["ac", "❄️", "Clean the AC filters", 3, true], ["filter", "🚰", "Change the water filter", 6, true], ["heater", "🔥", "Water heater check", 12, true], ["pest", "🐜", "Pest control", 6, false], ["smoke", "🔔", "Smoke alarm battery", 12, false], ["deep", "🧽", "Deep clean", 3, false]] },
  docs: { title: "Documents & IDs", cat: "Documents", intro: "Fill in the expiry dates you know. You're reminded 60, 30 and 7 days before — time to book an appointment.",
    items: [["id", "🪪", "National ID", 0], ["passport", "🛂", "Passport", 0], ["licence", "🚘", "Driving licence", 0], ["residency", "🏷️", "Residency / Iqama", 0], ["visa", "✈️", "Visa", 0], ["insurance", "🏥", "Health insurance", 0]],
    note: "🔒 Private by default: only the name shows in Waqti, and the lock screen says “Waqti reminder”." }
};
["health", "home", "docs"].forEach(k => on("pack-" + k, () => {
  closeSheet();
  const f = { kind: k, pick: {}, next: {} };
  SIMPLE[k].items.forEach(i => { f.pick[i[0]] = !!i[4]; f.next[i[0]] = ""; });
  openOverlay(renderSimplePack, { form: f, push: true });
}));
function renderSimplePack() {
  const f = ui.form, p = SIMPLE[f.kind];
  let h = ovHead('<button class="link" data-action="close">Cancel</button>', p.title, '<button class="link" data-action="simple-create">Add</button>') + '<div class="ov-body">';
  h += '<div class="small muted">' + p.intro + "</div>";
  if (f.kind === "docs") h += '<div class="field"><label>Whose documents?' + proTag("familyDocs") + '</label><input data-bind="who" value="' + esc(f.who || "") + '" maxlength="24" placeholder="' + esc(tr("Mine — or a family member's name")) + '"></div>';
  h += '<div class="card pad stack-xs">' + p.items.map(([id, e, n, months]) => months
    ? checkLine("pick." + id, f.pick[id], e, tr(n), '<span class="tiny muted">' + (months === 12 ? tr("every year") : months === 24 ? tr("every 2 years") : tr("every {m} months", { m: months })) + "</span>") +
      (f.pick[id] ? '<div class="inline" style="padding-inline-start:34px"><span class="tiny muted">Next one (optional)</span><input class="input sm" type="date" data-bind="next.' + id + '" value="' + esc(f.next[id]) + '"></div>' : "")
    : dateRow(e + " " + tr(n) + " — " + tr("expires on"), "next." + id, f.next[id])).join("") + "</div>";
  if (p.note) h += '<div class="hint">' + p.note + "</div>";
  return h + "</div>";
}
on("simple-create", () => {
  const f = ui.form, p = SIMPLE[f.kind], t = today(), who = (f.who || "").trim();
  if (who && !canUse("familyDocs")) return proSheet("🛂", "Family documents with Pro", "Your own documents are free. Pro keeps track of your spouse's, children's and parents' IDs, passports and residencies too.");
  let n = 0;
  p.items.forEach(([id, e, name, months]) => {
    if (months) {
      if (!f.pick[id]) return;
      const first = f.next[id] ? fromKey(f.next[id]) : addMonths(t, months);
      make({ name: tr(name), emoji: e, category: p.cat, schedule: { kind: "months", n: months, start: keyOf(first) }, reminders: remindAt("10:00", [7]) });
    } else {
      if (!f.next[id]) return;
      const d = fromKey(f.next[id]); // a one-time date: a yearly rule that starts and ends on it
      make({ name: tr("Renew: {doc}", { doc: tr(name) }) + (who ? " · " + who : ""), emoji: e, category: p.cat, private: true, schedule: { kind: "yearly", month: d.getMonth() + 1, monthDay: d.getDate(), start: keyOf(d), end: keyOf(d) }, reminders: remindAt("10:00", [60, 30, 7]) });
    }
    n++;
  });
  packDone(f.kind); save(); closeOverlay({ all: true }); ui.render(); toast(tr("{n} reminders added ✓", { n }));
});

/* ---------- Today: coming up, unpaid bills, car service by distance ---------- */
export function lifeCards(t) {
  return setupCard() + billsDueCard(t) + carDueCard(t) + comingUpCard(t) + kmCheckCard();
}
// Bills whose due day has passed without being ticked (in the last 3 weeks) stay until paid.
function unpaid(t) {
  const out = [];
  for (const h of activeHabits().filter(x => x.category === "Bills")) {
    for (let i = 1; i <= 21; i++) { const d = addDays(t, -i); if (isScheduled(h, d)) { if (status(h, d) === "open") out.push({ h, d }); break; } }
  }
  return out;
}
function billsDueCard(t) {
  const list = unpaid(t);
  if (!list.length) return "";
  return '<div class="card pad stack-xs"><div class="small bold">🧾 <span>Not marked paid yet</span></div>' + list.map(({ h, d }) =>
    '<div class="spread small"><span><span data-no-tr>' + h.emoji + " " + esc(h.name) + '</span> <span class="tiny muted">· <span>due</span> ' + esc(fmtDate(d, { weekday: "short", day: "numeric", month: "short" })) + (h.bill && h.bill.amount ? " · " + esc(money(h.bill.amount)) : "") + "</span></span>" +
    '<button class="btn xs soft" data-action="bill-paid" data-id="' + h.id + '" data-day="' + keyOf(d) + '">Paid</button></div>').join("") + "</div>";
}
on("bill-paid", (id, el) => {
  const h = findHabit(id), d = fromKey(el.dataset.day);
  if (!h) return;
  if (status(h, d) !== "done") tap(h, d);
  save(); ui.render(); toast("Marked paid ✓");
});
function carDueCard(t) {
  const due = activeHabits().filter(h => h.car && kmLeft(h) != null && kmLeft(h) <= 500 && status(h, t) !== "done");
  if (!due.length) return "";
  return '<div class="card pad stack-xs"><div class="small bold">🚗 <span>Due by distance</span></div>' + due.map(h => {
    const left = kmLeft(h);
    return '<div class="spread small"><span><span data-no-tr>' + h.emoji + " " + esc(h.name) + '</span> <span class="tiny muted">· ' + (left <= 0 ? tr("{km} km overdue", { km: (-left).toLocaleString() }) : tr("in {km} km", { km: left.toLocaleString() })) + "</span></span>" +
      '<button class="btn xs soft" data-action="car-done" data-id="' + h.id + '">Done</button></div>';
  }).join("") + "</div>";
}
on("car-done", id => {
  const h = findHabit(id); if (!h) return;
  const t = today();
  if (status(h, t) !== "done") tap(h, t);
  const v = state.vehicles.find(x => x.id === h.car.vid); if (v) h.car.lastOdo = +v.odo || 0;
  save(); ui.render(); toast("Done — the kilometres start again from here ✓");
});
// The next few things with a heads-up (birthdays, renewals, vet), within their heads-up window.
function comingUpCard(t) {
  const items = [];
  for (const h of activeHabits()) {
    const lead = (h.reminders && h.reminders.lead) || [];
    if (!lead.length) continue;
    const max = Math.max(...lead);
    for (let i = 1; i <= max; i++) { const d = addDays(t, i); if (isScheduled(h, d)) { if (status(h, d) !== "done") items.push({ h, d, i }); break; } }
  }
  if (!items.length) return "";
  items.sort((a, b) => a.i - b.i);
  // Bills can be ticked paid before they're due (the heads-ups then stop); documents can be marked renewed.
  return '<div class="card pad stack-xs"><div class="small bold">📅 <span>Coming up</span></div>' + items.slice(0, 5).map(({ h, d, i }) => {
    const btn = h.category === "Bills" ? '<button class="btn xs soft" data-action="bill-paid" data-id="' + h.id + '" data-day="' + keyOf(d) + '">Paid</button>'
      : h.category === "Documents" ? '<button class="btn xs soft" data-action="doc-renewed" data-id="' + h.id + '">Renewed</button>' : "";
    return '<div class="spread small"><button data-action="open-habit-list" data-id="' + h.id + '" style="flex:1;min-width:0;background:none;border:0;padding:4px 0;font:inherit;color:inherit;text-align:start"><span data-no-tr>' + h.emoji + " " + esc(h.name) + '</span> <span class="tiny muted">· ' + (i === 1 ? tr("tomorrow") : tr("in {n} days", { n: i })) + (h.bill && h.bill.amount ? " · " + esc(money(h.bill.amount)) : "") + "</span></button>" + btn + "</div>";
  }).join("") + "</div>";
}
on("doc-renewed", id => {
  const h = findHabit(id); if (!h) return;
  openSheet('<div class="sheet-head"><div class="sect-title">' + h.emoji + ' <span data-no-tr>' + esc(h.name) + '</span></div></div><div class="sheet-body stack-sm" style="padding:0 16px 18px">' +
    '<div class="field"><label for="doc-next">New expiry date</label><input id="doc-next" class="input" type="date" min="' + keyOf(today()) + '"></div>' +
    '<button class="btn" data-action="doc-renewed-save" data-id="' + id + '">Save</button></div>');
});
on("doc-renewed-save", (id, el) => {
  const h = findHabit(id), v = el.closest("#sheet").querySelector("#doc-next").value;
  if (!h || !v) { toast("Pick the new expiry date"); return; }
  const d = fromKey(v);
  Object.assign(h.schedule, { kind: "yearly", month: d.getMonth() + 1, monthDay: d.getDate(), start: v, end: v });
  save(); closeSheet(); ui.render(); toast(tr("Renewed ✓ We'll remind you before {d}", { d: fmtDate(d, { day: "numeric", month: "short", year: "numeric" }) }));
});
// Once a month: ask for the car's kilometres, so service-by-distance stays right.
function kmCheckCard() {
  const v = (state.vehicles || []).find(x => !x.odoAt || Date.now() - x.odoAt > 30 * 86400e3);
  if (!v) return "";
  return '<div class="card pad stack-xs"><div class="small bold">🚗 ' + esc(tr("How many km on the {car} now?", { car: v.name })) + '</div>' +
    '<div class="row"><input id="km-now" class="input grow" type="number" min="' + (+v.odo || 0) + '" inputmode="numeric" placeholder="' + (+v.odo || 0).toLocaleString() + '"><button class="btn xs" data-action="km-save" data-id="' + v.id + '">Save</button></div>' +
    '<div class="tiny muted">' + esc(tr("Once a month keeps oil and service reminders on time.")) + "</div></div>";
}
on("km-save", (id, el) => {
  const v = state.vehicles.find(x => x.id === id), n = Math.round(+el.closest(".card").querySelector("#km-now").value);
  if (!v || !(n > 0)) { toast("Type the reading on the dashboard"); return; }
  if (n < (+v.odo || 0)) { toast("That's lower than the last reading"); return; }
  v.odo = n; v.odoAt = Date.now(); save(); ui.render(); toast("Kilometres updated");
});

/* ---------- Me: bills this month, cars ---------- */
export function lifeRows() {
  const bills = activeHabits().filter(h => h.category === "Bills"), t = today();
  let rows = "";
  if (bills.length) {
    const ms = new Date(t.getFullYear(), t.getMonth(), 1), due = [];
    for (let d = ms; d.getMonth() === t.getMonth(); d = addDays(d, 1)) bills.forEach(h => { if (isScheduled(h, d)) due.push({ h, d }); });
    const paid = due.filter(x => status(x.h, x.d) === "done").length, total = due.reduce((a, x) => a + (+((x.h.bill || {}).amount) || 0), 0);
    rows += meRow("open-bills", "", "🧾", tr("Bills this month"), due.length ? '<span class="tabnum">' + paid + "/" + due.length + "</span> <span>paid</span>" + (total ? " · " + esc(money(total)) : "") : "");
  }
  rows += (state.vehicles || []).map(v => meRow("open-car", v.id, "🚗", '<span data-no-tr>' + esc(v.name) + "</span>", '<span class="tabnum">' + (+v.odo || 0).toLocaleString() + "</span> km")).join("");
  // Only once it's turned on: a row anyone can see shouldn't hint at it otherwise (it lives under Ready-made packs).
  if (state.cycle && state.cycle.on) rows += meRow("open-cycle", "", "🌸", tr("Period tracker"), "");
  rows += meRow("open-packs", "", "📦", tr("Ready-made packs"), "");
  return rows;
}
const meRow = (action, id, icon, title, val) => '<button class="li" data-action="' + action + '"' + (id ? ' data-id="' + id + '"' : "") + '><span class="lic">' + icon + '</span><span class="grow small bold">' + title + "</span>" + (val ? '<span class="val">' + val + "</span>" : "") + '<span class="chev">›</span></button>';

// Bills by month: this month and next are free; earlier months (the history) and sending a month's
// bills to the family are Pro.
const billRows = (y, m) => {
  const bills = state.habits.filter(h => h.category === "Bills"), rows = [];
  for (let d = new Date(y, m, 1); d.getMonth() === ((m % 12) + 12) % 12; d = addDays(d, 1)) bills.forEach(b => { if (isScheduled(Object.assign({}, b, { archived: false }), d)) rows.push({ b, d }); });
  return rows;
};
on("bills-month", id => {
  const off = (ui.form.off || 0) + (+id);
  if (off < 0 && !canUse("billsHistory")) return proSheet("🧾", "Bills history with Pro", "See every earlier month: what you paid, when, and the totals.");
  ui.form.off = Math.min(1, off); rerenderOverlay();
});
on("bills-share", async () => {
  if (!canUse("billsHistory")) return proSheet("🧾", "Send bills to the family with Pro", "Send this month's bills — what's paid and what's left — to your family in one message.");
  const t = today(), base = new Date(t.getFullYear(), t.getMonth() + (ui.form.off || 0), 1), rows = billRows(base.getFullYear(), base.getMonth());
  const txt = fmtDate(base, { month: "long", year: "numeric" }) + "\n" + rows.map(({ b, d }) => (status(b, d) === "done" ? "✅ " : "⬜ ") + b.name + " · " + fmtDate(d, { day: "numeric", month: "short" }) + (b.bill && b.bill.amount ? " · " + money(b.bill.amount) : "")).join("\n");
  if (navigator.share) { try { await navigator.share({ text: txt }); return; } catch (e) { /* cancelled */ } }
  try { await navigator.clipboard.writeText(txt); toast("Copied — paste it in the family chat"); } catch (e) { toast(txt); }
});
on("open-bills", () => openOverlay(() => {
  const t = today(), off = ui.form.off || 0, base = new Date(t.getFullYear(), t.getMonth() + off, 1);
  let h = ovHead('<button class="link" data-action="close">Close</button>', "Bills", "") + '<div class="ov-body stack-sm">';
  h += '<div class="spread"><button class="link small" data-action="bills-month" data-id="-1">‹ ' + esc(tr("Earlier")) + (off <= 0 ? proTag("billsHistory") : "") + '</button><div class="bold">' + esc(fmtDate(base, { month: "long", year: "numeric" })) + '</div><button class="link small" data-action="bills-month" data-id="1"' + (off >= 1 ? " disabled" : "") + ">" + esc(tr("Next")) + " ›</button></div>";
  const rows = billRows(base.getFullYear(), base.getMonth());
  const total = rows.reduce((a, x) => a + (+((x.b.bill || {}).amount) || 0), 0), left = rows.filter(x => status(x.b, x.d) !== "done").reduce((a, x) => a + (+((x.b.bill || {}).amount) || 0), 0);
  if (total) h += '<div class="tiles"><div class="tile"><div class="big tabnum">' + esc(money(total)) + '</div><div class="lbl muted">This month</div></div><div class="tile"><div class="big tabnum">' + esc(money(left)) + '</div><div class="lbl muted">Still to pay</div></div></div>';
  h += rows.map(({ b, d }) => { const done = status(b, d) === "done";
    return '<div class="card pad spread"><div class="small"><div class="bold" data-no-tr>' + b.emoji + " " + esc(b.name) + '</div><div class="tiny muted">' + esc(fmtDate(d, { weekday: "short", day: "numeric", month: "short" })) + (b.bill && b.bill.amount ? " · " + esc(money(b.bill.amount)) : "") + "</div></div>" +
      (done ? '<span class="badge live">✓ Paid</span>' : '<button class="btn xs soft" data-action="bill-paid-ov" data-id="' + b.id + '" data-day="' + keyOf(d) + '">Paid</button>') + "</div>"; }).join("") || '<div class="hint">No bills due this month.</div>';
  if (rows.length) h += '<button class="btn sec sm" data-action="bills-share">👨‍👩‍👧 <span>Send to the family</span>' + proTag("billsHistory") + "</button>";
  return h + '<button class="btn sec" data-action="pack-bills">+ Add bills</button></div>';
}, { push: true, form: { off: 0 } }));
on("bill-paid-ov", (id, el) => { const b = findHabit(id), d = fromKey(el.dataset.day); if (b && status(b, d) !== "done") tap(b, d); save(); rerenderOverlay(); ui.render(); });

on("open-car", id => openOverlay(() => renderCar(id), { push: true, form: { odo: "" } }));
function renderCar(id) {
  const v = state.vehicles.find(x => x.id === id);
  if (!v) return ovHead('<button class="link" data-action="close">Back</button>', "", "");
  const items = activeHabits().filter(h => h.car && h.car.vid === id || (h.category === "Car" && h.name.endsWith("· " + v.name)));
  let h = ovHead('<button class="link" data-action="close">Back</button>', '<span data-no-tr>' + esc(v.name) + "</span>", "") + '<div class="ov-body stack-sm">';
  h += '<div class="card pad stack-sm"><div class="spread"><div class="small bold">Kilometres</div><div class="sect-title tabnum">' + (+v.odo || 0).toLocaleString() + " km</div></div>" +
    '<div class="row"><input class="input grow" type="number" min="0" inputmode="numeric" data-bind="odo" placeholder="' + esc(tr("New reading")) + '"><button class="btn xs" data-action="car-odo" data-id="' + id + '">Update</button></div>' +
    (v.odoAt ? '<div class="tiny muted"><span>Updated</span> ' + esc(fmtDate(new Date(v.odoAt), { day: "numeric", month: "short" })) + "</div>" : "") + "</div>";
  h += items.map(x => { const left = kmLeft(x); let next = null; for (let i = 0, d = today(); i < 800 && !next; i++, d = addDays(d, 1)) if (isScheduled(x, d)) next = d;
    return '<button class="card pad spread" data-action="open-habit-list" data-id="' + x.id + '" style="width:100%;text-align:start;font:inherit;color:inherit"><div class="small"><div class="bold" data-no-tr>' + x.emoji + " " + esc(x.name.replace(" · " + v.name, "")) + '</div><div class="tiny muted">' +
      (next ? esc(fmtDate(next, { day: "numeric", month: "short", year: "numeric" })) : "") + (left != null ? " · " + (left <= 0 ? tr("{km} km overdue", { km: (-left).toLocaleString() }) : tr("in {km} km", { km: left.toLocaleString() })) : "") + '</div></div><span class="faint">›</span></button>'; }).join("");
  h += '<button class="btn ghost" data-action="car-remove" data-id="' + id + '" style="color:var(--danger)">Remove this car</button>';
  return h + "</div>";
}
on("car-odo", id => {
  const v = state.vehicles.find(x => x.id === id), n = Math.round(+ui.form.odo);
  if (!v || !(n >= 0) || ui.form.odo === "") { toast("Type the reading on the dashboard"); return; }
  if (n < (+v.odo || 0)) { toast("That's lower than the last reading"); return; }
  v.odo = n; v.odoAt = Date.now(); ui.form.odo = "";
  save(); rerenderOverlay(); ui.render(); toast("Kilometres updated");
});
on("car-remove", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = tr("Tap again: remove the car and archive its reminders"); return; }
  state.habits.forEach(h => { if (h.car && h.car.vid === id) h.archived = true; });
  state.vehicles = state.vehicles.filter(x => x.id !== id);
  save(); closeOverlay(); ui.render(); toast("Car removed — its reminders are archived");
});

/* ---------- period tracker ---------- */
on("open-cycle", () => { closeSheet(); openOverlay(renderCycle, { push: true, form: { other: "" } }); });
function renderCycle() {
  const c = cycleCfg(), t = today(), muslim = state.profile.faith && state.profile.faith.religion === "muslim";
  let h = ovHead('<button class="link" data-action="close">Close</button>', "Period tracker", "") + '<div class="ov-body stack-sm">';
  if (!c.on) {
    h += '<div class="card pad stack-sm"><div class="emo" style="font-size:34px">🌸</div><div class="small">Log when your period starts and ends. Waqti estimates the next one from your own dates and can remind you a couple of days before.</div>' +
      '<div class="small muted">🔒 Only on this phone. Reminders say “Waqti reminder” on the lock screen. You can add a PIN lock in Settings.</div>' +
      '<div class="tiny muted">Estimates only — not for contraception or diagnosis.</div>' +
      '<button class="btn" data-action="cycle-on">Start tracking</button></div>';
    return h + "</div>";
  }
  const p = periodOn(t), ns = nextStart(t);
  if (p) h += '<div class="card pad center stack-xs"><div class="small muted">Period</div><div class="sect-title tabnum">' + tr("Day {n}", { n: p.day }) + '</div>' +
    (p.open ? '<button class="btn" data-action="cycle-end">It ended today</button>' : '<div class="tiny muted"><span>Ended</span> ' + esc(fmtDate(fromKey(p.end), { day: "numeric", month: "short" })) + "</div>") + "</div>";
  else h += '<div class="card pad center stack-xs"><div class="small muted">' + (ns ? "Next period, estimated" : "No dates yet") + "</div>" +
    (ns ? '<div class="sect-title">' + esc(fmtDate(ns, { weekday: "short", day: "numeric", month: "long" })) + '</div><div class="tiny muted">' + (daysBetween(t, ns) === 0 ? tr("around today") : tr("in about {n} days", { n: daysBetween(t, ns) })) + "</div>" : "") +
    '<button class="btn" data-action="cycle-start">It started today</button></div>';
  h += '<div class="card pad stack-xs"><div class="small bold">Started on another day?</div><div class="row"><input class="input grow" type="date" data-bind="other" max="' + keyOf(t) + '"><button class="btn xs soft" data-action="cycle-start-on">Log</button></div></div>';
  const starts = (c.starts || []).slice().sort().reverse().slice(0, 6);
  if (starts.length) h += '<div class="card pad stack-xs"><div class="spread"><div class="small bold">History</div><div class="tiny muted"><span>Average cycle</span> <b class="tabnum">' + avgCycle() + "</b> <span>days</span> · <span>period</span> <b class=\"tabnum\">" + avgLength() + "</b></div></div>" +
    starts.map((k, i) => { const prev = starts[i + 1], len = prev ? daysBetween(fromKey(prev), fromKey(k)) : null;
      return '<div class="spread small"><span>' + esc(fmtDate(fromKey(k), { day: "numeric", month: "short", year: "numeric" })) + (c.ends[k] ? ' <span class="tiny muted">→ ' + esc(fmtDate(fromKey(c.ends[k]), { day: "numeric", month: "short" })) + "</span>" : "") + "</span>" +
        '<span class="row" style="gap:8px">' + (len ? '<span class="tiny muted tabnum">' + len + " " + tr("days") + "</span>" : "") + '<button class="link small" data-action="cycle-del" data-id="' + k + '" aria-label="Remove">✕</button></span></div>'; }).join("") + "</div>";
  if (irregular()) h += '<div class="hint">Your cycles vary a lot or are outside 21–35 days. That can be normal, but it\'s worth mentioning to a doctor.</div>';
  h += '<div class="card pad stack-xs"><label class="checkrow"><input type="checkbox" data-action="cycle-remind"' + (c.remind ? " checked" : "") + '><span class="grow small bold">Remind me 2 days before</span></label>' +
    (muslim ? '<label class="checkrow"><input type="checkbox" data-action="cycle-excuse"' + (c.autoExcuse ? " checked" : "") + '><span class="grow"><span class="small bold" style="display:block">Start Excused days with it</span><span class="hint">Prayer and fast reminders stop from the day it starts until you log the end.</span></span></label>' : "") + "</div>";
  h += '<div class="tiny muted center">Estimates only — not for contraception or diagnosis.</div><button class="btn ghost" data-action="cycle-off" style="color:var(--danger)">Turn off and delete these dates</button>';
  return h + "</div>";
}
on("cycle-on", () => { const c = cycleCfg(); c.on = true; packDone("cycle"); save(); rerenderOverlay(); ui.render(); });
on("cycle-start", () => { logStart(today()); save(); rerenderOverlay(); ui.render(); toast("Logged 🌸"); });
on("cycle-start-on", () => { const k = ui.form.other; if (!k) { toast("Pick the day it started"); return; } logStart(fromKey(k)); ui.form.other = ""; save(); rerenderOverlay(); ui.render(); toast("Logged 🌸"); });
on("cycle-end", () => { logEnd(today()); save(); rerenderOverlay(); ui.render(); toast("Logged — welcome back 🤍"); });
on("cycle-del", k => { removeStart(k); save(); rerenderOverlay(); ui.render(); });
on("cycle-remind", (id, el) => { cycleCfg().remind = el.checked ? 2 : 0; save(); });
on("cycle-excuse", (id, el) => { cycleCfg().autoExcuse = !!el.checked; save(); });
on("cycle-off", (id, el) => {
  if (!el.dataset.confirm) { el.dataset.confirm = "1"; el.textContent = tr("Tap again to delete all period dates"); return; }
  (cycleCfg().starts || []).slice().forEach(removeStart);
  state.cycle = { on: false, starts: [], ends: {}, remind: 2, autoExcuse: true };
  save(); closeOverlay(); ui.render(); toast("Period tracker turned off");
});
export { lastStart };
