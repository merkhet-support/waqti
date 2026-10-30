// "What's new": shown once to people who update, so new features don't go unnoticed.
// New users skip it (setup marks it seen). Reopen any time from Settings → What's new.

import { state, save } from "../store.js";
import { on, openOverlay, closeOverlay, overlayOpen } from "./core.js";
import { ovHead } from "./components.js";
import { openReview } from "./review.js";
import { weeklyReview } from "../review.js";

export const WHATS_NEW_ID = "2.11";
const ITEMS = [
  ["📦", "Ready-made packs", "Tap + → Ready-made packs: your car, home bills, important dates, pets, health check-ups, home upkeep, documents & IDs and a period tracker, each set up in a minute."],
  ["🧾", "Bills that wait until paid", "Rent, internet, phone, subscriptions and credit cards: a heads-up 3 days before, and they stay on Today until you tick them paid."],
  ["🎂", "Every year, with a heads-up", "Birthdays, anniversaries, Mother's Day for your country, renewals — any habit can now repeat every year or every few months, with a reminder days ahead."],
  ["🚗", "Car service by kilometres", "Oil, tyres and service come due by date or distance, whichever is first. Update the kilometres from Me."],
  ["🤍", "Excused days", "Excused from prayer or fasting — your period, after childbirth, illness or travel? Tap Excused on Today: those reminders stop and your streaks are kept. Free, and only on your phone."],
  ["🔒", "Privacy on the lock screen", "Mark any habit or quit tracker private: the lock screen just says “Waqti reminder”. You can also lock Waqti with a PIN."],
  ["💊", "Safer medicine reminders", "Medicine keeps reminding through rest days and sick breaks, and each dose is ticked on its own."],
  ["📉", "Quit or cut down", "More things to quit — vaping, alcohol, painkillers, gambling, snooze — and a cut-down mode that counts days within your own limit."],
  ["🗒️", "Plan your day", "Meetings, tasks and habits on one timeline, with your free gaps. Drop a task into a gap, see today's focus, and wrap up after work."],
  ["👤", "Everything in Me", "Insights, your weekly review, Faith, fasting, quit trackers, lists and requests — always in the same place."],
  ["🌊", "Help with urges", "Tap “I have an urge” for two minutes of breathing with your reason and your plan. Waqti learns your hardest time and gives you a heads-up."],
  ["😴", "Sleep", "One tap in the morning logs last night and ticks your sleep habits. See how days off shift your bedtime, and turn on a wind-down reminder."],
  ["✂️", "Shorter forms", "New habits ask only what matters first. Colour, category, dates and notes wait under More options."],
  ["🌍", "Summer prayer times far north", "In the UK and northern Europe, choose how Fajr and Isha are set when the sky never gets fully dark."],
  ["🗓️", "Every fast of the year", "A fasting calendar for every faith — Coptic, Greek and Russian Orthodox, Catholic, Sunni and Shia, Jewish and Hindu — with when each fast starts and ends."],
  ["🕌", "Sunni and Shia", "Pick your tradition: the four Sunni schools (Hanafi Asr), or Shia Ja'fari times with joined prayers, Dua Kumayl, Muharram, Arba'een and the Nights of Qadr. The Hijri date can follow your country's moon sighting."],
  ["🔔", "Bundled reminders", "Habits due at the same time arrive as one reminder — “💊 Diabetes medicine + 2 more” — with a Done all button."],
  ["📅", "Monthly look-back", "The first review of each month shows how the month went next to the ones before, so a slow slide doesn't go unnoticed."],
  ["🌅", "Sunrise & sunset for every faith", "Shabbat candles and Havdalah, puja at sunrise, Rehras at sunset — or any habit “at sunset” — follow the sun in your city all year."],
  ["💡", "Smarter weekly tips", "Tips change from week to week, and after a couple of weeks they offer to make the change for you."],
  ["✝️", "Church fasting seasons", "Great Lent, Jonah, the Apostles' and Nativity fasts (or Lent and Advent) switch on by themselves each year, worked out from Easter. Turn them on in Faith setup."],
  ["🏁", "End dates", "Give a habit an end date — a course of medicine, a 30-day challenge — and it steps aside by itself when it's done."],
  ["🌱", "Welcome back", "Away for a while? Waqti greets you, suggests one small step, and can count the days you were away as a break."],
  ["💪", "Never miss twice", "One missed day no longer breaks a streak — two in a row do. Take a rest day or pause for sickness or travel from Today."],
  ["🛒", "Family lists", "Shared groceries and home jobs, locked with a key only your family has. Tap + → Family list."],
  ["🔁", "Repeating requests", "Ask someone for “Groceries every Friday” — it becomes a habit with its own reminder on their phone."],
  ["🕋", "Qibla & prayer sounds", "A Qibla compass in Faith, the next prayer on Today, and reminder sounds — Adhan, church bell or a soft chime."],
  ["😊", "How was today?", "One tap in the evening. Your weekly review shows which habits lift your days — and when you really do them."],
  ["☁️", "Automatic backup", "In the phone app, Waqti is saved with your phone's own backup, so a new phone brings everything back."],
  ["📨", "Ask someone", "Send a request like “Pick up Grandma, Tuesday 4 PM” by WhatsApp or SMS. They accept, change it, or say no — and only people you allow can send you requests. Tap + → Ask someone."],
  ["🗓️", "Weekly review", "At the start of each week: how last week went, your wins, and one specific tip — like moving a reminder earlier on work days. Find it on Today, in Insights, or from the weekly notification."],
  ["🔥", "Streaks survive schedule changes", "Change a habit's days and the streak you already built stays."],
  ["🎨", "A colour for every habit", "Pick one in the habit editor, or leave it on Auto."],
  ["🎉", "Celebrations", "A little burst when you tick something off, and a big one for a perfect day."]
];

export function maybeShowWhatsNew() {
  if (!state || !state.onboarded || overlayOpen() || state.whatsNewSeen === WHATS_NEW_ID) return;
  openWhatsNew();
}

export function openWhatsNew() {
  state.whatsNewSeen = WHATS_NEW_ID; save();
  openOverlay(() => ovHead('<button class="link" data-action="close">Close</button>', "What's new", "") +
    '<div class="ov-body stack">' +
    ITEMS.map(([e, t, d]) => '<div class="feat"><div class="fi">' + e + '</div><div class="small"><b>' + t + "</b><div class=\"muted\" style=\"margin-top:2px\">" + d + "</div></div></div>").join("") +
    (weeklyReview() ? '<button class="btn" data-action="wn-review">🗓️ <span>See my weekly review</span></button><button class="btn ghost" data-action="close">Got it</button>'
      : '<button class="btn" data-action="close">Got it</button>') + "</div>");
}

on("whats-new", () => openWhatsNew());
on("wn-review", () => { closeOverlay({ all: true }); openReview(); });
