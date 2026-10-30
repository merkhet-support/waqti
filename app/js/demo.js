// Demo mode for store screenshots and the click-through smoke test: "?demo=<person>" loads an
// example person in memory only. Nothing is ever saved (the store's test mode), so a real user's
// data is never touched. Extra URL options: lang=ar|en, view=<tab>, open=<action>[:<id>], step=<setup step>.
//   people: nurse (night shifts), worship (Muslim, Cairo), church (Coptic), life (bills, car, dates), fresh (setup)

import { blankState, newHabit, __useTestState, state } from "./store.js";
import { keyOf, addDays, today } from "./dates.js";
import { defaultFaith, applyFaith, applyRoutine } from "./faith.js";
import { WHATS_NEW_ID } from "./ui/whats-new.js";
import { isScheduled } from "./schedule.js";

const q = new URLSearchParams(location.search);
export const demoName = () => q.get("demo");

// A habit with a believable past: done most days, a couple of gaps.
function habit(over, doneDays, todayValue) {
  const h = newHabit(Object.assign({ schedule: { kind: "daily", days: [], n: 1, perWeek: 3, monthDay: 1, onlyOn: "any", start: keyOf(addDays(today(), -40)) } }, over));
  for (let i = 1; i <= (doneDays || 0); i++) if (i % 9 !== 4) h.history[keyOf(addDays(today(), -i))] = h.type === "count" ? (+h.target || 1) : true;
  if (todayValue != null) h.history[keyOf(today())] = todayValue;
  return h;
}
const at = (...times) => ({ on: true, mode: "times", times, nag: 0 });

function base(name) {
  const s = blankState();
  s.onboarded = true; s.profile.name = name; s.whatsNewSeen = WHATS_NEW_ID;
  s.meta.firstOpen = Date.now() - 45 * 86400e3; s.meta.lastOpen = keyOf(today()); s.reviewSeen = null;
  s.meta.top3Asked = true; s.meta.connectDismissed = true; s.meta.welcomeSeen = 99;
  s.settings.notify.enabled = true; s.settings.lang = q.get("lang") === "ar" ? "ar" : "en";
  s.settings.theme = q.get("theme") === "dark" ? "dark" : "light"; // store screenshots: light unless asked
  return s;
}

const PEOPLE = {
  nurse() {
    const s = base("Mona");
    Object.assign(s.profile.schedule, { shift: "rotating", rotation: { on: 4, off: 4, anchor: keyOf(addDays(today(), -1)) }, workStart: "19:00", workEnd: "07:00",
      sleep: { work: { bed: "08:30", wake: "15:30" }, off: { bed: "00:30", wake: "08:30" }, sameOnOff: false } });
    s.settings.dayStartHour = 12;
    return [s, () => {
      applyRoutine();
      state.habits.push(
        habit({ name: "Drink water", emoji: "💧", category: "Nutrition", type: "count", target: 8, unit: "glasses", reminders: { on: true, mode: "interval", interval: { every: 120, from: "16:00", to: "07:00" } } }, 30, 5),
        habit({ name: "Walk", emoji: "🚶", category: "Fitness", type: "count", target: 6000, step: 1000, unit: "steps", reminders: at("17:00") }, 25, 3000),
        habit({ name: "Read 10 minutes", emoji: "📖", category: "Growth", reminders: at("07:45"), key: true }, 22),
        habit({ name: "Call Mom", emoji: "👩", category: "Family", reminders: at("18:00") }, 18, true),
        habit({ name: "Take vitamins", emoji: "🍊", category: "Health", reminders: at("16:00") }, 28, true));
      state.lists = [{ id: "l1", name: "Groceries", emoji: "🛒", key: "x", mine: true, owner: "me", members: [{ id: "me", name: "Mona" }, { id: "a", name: "Karim" }],
        items: [["Milk", true, "Karim"], ["Bread", false, "Mona"], ["Eggs", false, "Karim"], ["Tomatoes", false, "Mona"], ["Coffee", true, "Mona"]].map(([text, done, by], i) => ({ id: "i" + i, text, done, by, at: Date.now() - i * 6e5, v: i + 1 })), dirty: false }];
    }];
  },
  worship() {
    const s = base("Ahmed");
    s.profile.schedule.shift = "day";
    return [s, () => {
      const f = defaultFaith("muslim"); f.muslim.fasting.monThu = true; s.profile.faith = f; applyFaith(f);
      state.habits.filter(h => /^faith:(fajr|dhuhr|asr|maghrib|isha|quran|adhkar-am)$/.test(h.source || "")).forEach((h, i) => {
        for (let d = 1; d <= 30; d++) if ((d + i) % 11) h.history[keyOf(addDays(today(), -d))] = h.type === "count" ? (+h.target || 1) : true;
        h.schedule.start = keyOf(addDays(today(), -40));
        if (/fajr|dhuhr|quran/.test(h.source)) h.history[keyOf(today())] = h.type === "count" ? (+h.target || 1) : true;
      });
      state.habits.push(habit({ name: "Drink water", emoji: "💧", category: "Nutrition", type: "count", target: 8, unit: "glasses", key: true, reminders: { on: true, mode: "interval", interval: { every: 120, from: "09:00", to: "21:00" } } }, 20, 4));
    }];
  },
  church() {
    const s = base("Mina");
    s.profile.schedule.shift = "day";
    return [s, () => {
      const f = defaultFaith("christian"); f.christian.prayerMode = "agpeya"; s.profile.faith = f; applyFaith(f);
      state.habits.filter(h => /^faith:/.test(h.source || "")).forEach((h, i) => { h.schedule.start = keyOf(addDays(today(), -40)); for (let d = 1; d <= 30; d++) if ((d + i) % 7) h.history[keyOf(addDays(today(), -d))] = h.type === "count" ? (+h.target || 1) : true; if (i < 2) h.history[keyOf(today())] = h.type === "count" ? (+h.target || 1) : true; });
      state.habits.push(habit({ name: "Read the Bible", emoji: "📖", category: "Faith", type: "count", target: 1, unit: "chapter", key: true, reminders: at("21:00") }, 25));
    }];
  },
  life() {
    const s = base("Sara");
    s.profile.schedule.shift = "day";
    return [s, () => {
      const t = today(), md = n => addDays(t, n).getDate(), ym = n => { const d = addDays(t, n); return { month: d.getMonth() + 1, monthDay: d.getDate() }; };
      // Earlier months paid on time; only a bill due in the last few days (dueIn < 0) is still open.
      const bill = (name, emoji, dueIn, amount) => {
        const h = newHabit({ name, emoji, category: "Bills", private: true, bill: { amount }, schedule: { kind: "monthly", monthDay: md(dueIn), start: keyOf(addDays(t, -60)) }, reminders: Object.assign(at("10:00"), { lead: [3] }) });
        for (let i = 1; i <= 60; i++) { const d = addDays(t, -i); if (isScheduled(h, d) && !(dueIn < 0 && i === -dueIn)) h.history[keyOf(d)] = true; }
        return h;
      };
      state.habits.push(bill("Internet", "🌐", 3, 450), bill("Rent", "🏠", 9, 6000), bill("Phone plan", "📱", 12, 250), bill("Netflix / streaming", "📺", -2, 190));
      state.vehicles = [{ id: "v1", name: "Corolla", odo: 50200, odoAt: Date.now() - 3 * 86400e3 }];
      const car = (name, emoji, months, km, last) => newHabit({ name: name + " · Corolla", emoji, category: "Car", car: { vid: "v1", everyKm: km, lastOdo: last }, schedule: { kind: "months", n: months, start: keyOf(addDays(t, 60)) }, reminders: Object.assign(at("10:00"), { lead: [7] }) });
      state.habits.push(car("Oil change", "🛢️", 6, 5000, 45000), car("Tyre rotation & pressure", "🛞", 6, 10000, 45000), car("Full service", "🔧", 12, 15000, 40000));
      state.habits.push(newHabit({ name: "Mom's birthday", emoji: "🎂", category: "Dates", schedule: Object.assign({ kind: "yearly", start: keyOf(addDays(t, -400)) }, ym(5)), reminders: Object.assign(at("09:00"), { lead: [7, 1] }) }));
      state.habits.push(newHabit({ name: "Renew: Residency / Iqama", emoji: "🏷️", category: "Documents", private: true, schedule: Object.assign({ kind: "yearly", start: keyOf(addDays(t, 20)), end: keyOf(addDays(t, 20)) }, ym(20)), reminders: Object.assign(at("10:00"), { lead: [60, 30, 7] }) }));
      state.habits.push(habit({ name: "Drink water", emoji: "💧", category: "Nutrition", type: "count", target: 8, unit: "glasses", key: true, reminders: { on: true, mode: "interval", interval: { every: 120, from: "09:00", to: "21:00" } } }, 20, 3),
        habit({ name: "Walk", emoji: "🚶", category: "Fitness", type: "count", target: 6000, step: 1000, unit: "steps", reminders: at("18:00") }, 15, 2000));
    }];
  },
  fresh() { const s = blankState(); s.settings.lang = q.get("lang") === "ar" ? "ar" : "en"; return [s, () => {}]; }
};

// Called by app.js right after loading: swaps in the example person (in memory only).
export function startDemo() {
  const name = demoName();
  if (!name || !PEOPLE[name]) return null;
  const [s, fill] = PEOPLE[name]();
  __useTestState(s);
  fill();
  if (q.get("view")) state.view = q.get("view");
  return { after };
}

// After the first render: open what the screenshot needs.
async function after() {
  const fire = (action, id) => { const b = document.createElement("button"); b.dataset.action = action; if (id) b.dataset.id = id; b.style.display = "none"; document.body.appendChild(b); b.click(); b.remove(); };
  const open = q.get("open"), step = q.get("step");
  if (step != null) {
    const [{ startOnboarding }, core, faith] = await Promise.all([import("./ui/onboarding.js"), import("./ui/core.js"), import("./faith.js")]);
    startOnboarding();
    await new Promise(r => setTimeout(r, 200));
    const f = core.ui.form;
    if (q.get("shift") === "night") Object.assign(f.schedule, { shift: "night", workStart: "19:00", workEnd: "07:00", sleep: Object.assign(f.schedule.sleep, { work: { bed: "08:30", wake: "15:30" } }) }), f.settings.dayStartHour = 12;
    if (q.get("faith")) f.faith = faith.defaultFaith(q.get("faith"));
    if (q.get("picks")) q.get("picks").split(",").forEach(i => { f.picks[+i] = true; });
    f.step = +step; core.rerenderOverlay();
    if (q.get("scroll")) setTimeout(() => { const el = document.querySelector(q.get("scroll")); if (el) el.scrollIntoView({ block: "center" }); }, 300);
    return;
  }
  if (open) {
    const [action, id] = open.split(":");
    const target = id === "first" ? (state.habits.find(h => h.key) || state.habits[0] || {}).id : id === "car" ? (state.vehicles[0] || {}).id : id;
    setTimeout(() => fire(action, target), 150);
  }
}
