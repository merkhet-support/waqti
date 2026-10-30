// Ready-made habits. Schedules/reminders here are sensible defaults the user can change.

export const CATEGORIES = ["Daily Rhythm", "Sleep", "Fitness", "Nutrition", "Health", "Grooming", "Faith", "Growth", "Family", "Dates", "Home", "Bills", "Car", "Pets", "Documents", "Money", "Social", "Work"];

const rt = (anchor, offset, nag) => ({ on: true, mode: "routine", anchor, offset, nag: nag || 0 });
const at = (...times) => ({ on: true, mode: "times", times });

export const TEMPLATES = [
  { name: "Drink water", emoji: "💧", category: "Nutrition", type: "count", target: 8, unit: "glasses", schedule: { kind: "daily" }, reminders: { on: true, mode: "interval", interval: { every: 120, from: "09:00", to: "21:00" } }, starter: true },
  { name: "Exercise", emoji: "🏃", category: "Fitness", auto: { source: "workout", minMinutes: 20 }, schedule: { kind: "perWeek", perWeek: 3 }, reminders: rt("workEnd", 60), starter: true },
  { name: "Gym", emoji: "🏋️", category: "Fitness", schedule: { kind: "days", days: [0, 2, 4] }, reminders: at("18:00") },
  { name: "Walk", emoji: "🚶", category: "Fitness", type: "count", target: 8000, step: 1000, unit: "steps", auto: { source: "steps" }, schedule: { kind: "daily" }, reminders: at("19:00") },
  { name: "Stretch", emoji: "🤸", category: "Fitness", schedule: { kind: "daily" }, reminders: rt("wake", 15) },
  { name: "Healthy breakfast", emoji: "🥗", category: "Nutrition", schedule: { kind: "daily" }, reminders: rt("wake", 30) },
  { name: "Take vitamins", emoji: "🍊", category: "Health", schedule: { kind: "daily" }, reminders: rt("wake", 45, 30) },
  // doses: one reminder per dose, placed relative to the person's own wake-up / bedtime.
  { name: "Take medicine", emoji: "💊", category: "Health", type: "count", target: 2, unit: "doses", schedule: { kind: "daily" }, reminders: { on: true, mode: "times", times: ["09:00", "21:00"], nag: 15 }, doses: [["wake", 30], ["bed", -90]], notes: "Set the times and number of doses to match your prescription." },
  { name: "Refill prescription", emoji: "🏥", category: "Health", schedule: { kind: "weeks", days: [4], n: 4 }, reminders: at("18:00"), notes: "Order before you run out." },
  { name: "Floss & brush", emoji: "🦷", category: "Health", schedule: { kind: "daily" }, reminders: rt("bed", -20) },
  { name: "Read 10 minutes", emoji: "📖", category: "Growth", type: "count", target: 10, step: 5, unit: "min", schedule: { kind: "daily" }, reminders: rt("bed", -45), starter: true },
  { name: "Journal", emoji: "✍️", category: "Growth", schedule: { kind: "daily" }, reminders: rt("bed", -60) },
  { name: "Learn something", emoji: "🧠", category: "Growth", schedule: { kind: "perWeek", perWeek: 4 }, reminders: at("20:00") },
  { name: "No phone in bed", emoji: "📵", category: "Sleep", schedule: { kind: "daily" }, reminders: rt("bed", -15) },
  { name: "Skincare", emoji: "🧴", category: "Grooming", schedule: { kind: "daily" }, reminders: rt("bed", -40) },
  { name: "Haircut", emoji: "✂️", category: "Grooming", schedule: { kind: "weeks", days: [5], n: 3 }, reminders: at("11:00") },
  { name: "Beard trim", emoji: "🧔", category: "Grooming", schedule: { kind: "weeks", days: [4], n: 1 }, reminders: at("20:00") },
  { name: "Nails", emoji: "💅", category: "Grooming", schedule: { kind: "weeks", days: [6], n: 2 }, reminders: at("12:00") },
  { name: "Tidy up", emoji: "🧹", category: "Home", schedule: { kind: "perWeek", perWeek: 2 }, reminders: at("18:30") },
  { name: "Laundry", emoji: "🧺", category: "Home", schedule: { kind: "days", days: [6] }, reminders: at("10:00") },
  { name: "Water the plants", emoji: "🪴", category: "Home", schedule: { kind: "interval", n: 3 }, reminders: at("09:00") },
  { name: "Meal prep", emoji: "🍱", category: "Nutrition", schedule: { kind: "days", days: [5] }, reminders: at("16:00") },
  { name: "Check budget", emoji: "💰", category: "Money", schedule: { kind: "monthly", monthDay: 1 }, reminders: at("20:00") },
  { name: "Save money", emoji: "🐷", category: "Money", schedule: { kind: "weeks", days: [4], n: 1 }, reminders: at("21:00") },
  { name: "Call family", emoji: "📞", category: "Family", schedule: { kind: "days", days: [5] }, reminders: at("19:00") },
  { name: "Plan tomorrow", emoji: "📝", category: "Work", schedule: { kind: "daily", onlyOn: "work" }, reminders: rt("workEnd", -15) },
  { name: "Deep work block", emoji: "🎯", category: "Work", schedule: { kind: "daily", onlyOn: "work" }, reminders: rt("workStart", 30) },
  { name: "Call Mom", emoji: "👩", category: "Family", schedule: { kind: "daily" }, reminders: rt("workEnd", 30), notes: "Even 5 minutes counts." },
  { name: "Check on my wife", emoji: "💞", category: "Family", schedule: { kind: "daily" }, reminders: rt("wake", 360), notes: "A quick message or call during your day." },
  { name: "Check on my husband", emoji: "💞", category: "Family", schedule: { kind: "daily" }, reminders: rt("wake", 360), notes: "A quick message or call during your day." },
  { name: "Family time", emoji: "👨‍👩‍👧", category: "Family", schedule: { kind: "perWeek", perWeek: 3 }, reminders: rt("workEnd", 90), notes: "Phones away, full attention." },
  { name: "Visit family", emoji: "🏡", category: "Family", schedule: { kind: "days", days: [5] }, reminders: at("12:00") },
  { name: "Check the home before bed", emoji: "🔒", category: "Home", schedule: { kind: "daily" }, reminders: rt("bed", -30), notes: "Gas, doors and locks, lights, water heater." },
  // Bills, car, pets and important dates (whole packs: + → Ready-made packs).
  { name: "Pay rent", emoji: "🏠", category: "Bills", schedule: { kind: "monthly", monthDay: 1 }, reminders: Object.assign(at("10:00"), { lead: [3] }), notes: "Tick it when it's paid." },
  { name: "Pay a bill", emoji: "🧾", category: "Bills", schedule: { kind: "monthly", monthDay: 15 }, reminders: Object.assign(at("10:00"), { lead: [3] }) },
  { name: "Oil change", emoji: "🛢️", category: "Car", schedule: { kind: "months", n: 6 }, reminders: Object.assign(at("10:00"), { lead: [7] }) },
  { name: "Renew car licence", emoji: "🪪", category: "Car", schedule: { kind: "yearly", month: 1, monthDay: 1 }, reminders: Object.assign(at("10:00"), { lead: [30, 7] }), notes: "Set the date it expires." },
  { name: "Feed the pet", emoji: "🐾", category: "Pets", type: "count", target: 2, unit: "meals", schedule: { kind: "daily" }, reminders: at("08:00", "19:00") },
  { name: "Walk the dog", emoji: "🐕", category: "Pets", type: "count", target: 2, unit: "walks", schedule: { kind: "daily" }, reminders: at("07:30", "18:30") },
  { name: "Vet check-up", emoji: "💉", category: "Pets", schedule: { kind: "yearly", month: 1, monthDay: 1 }, reminders: Object.assign(at("10:00"), { lead: [7] }), notes: "Vaccines and a check-up. Set the date your vet gave you." },
  { name: "Birthday", emoji: "🎂", category: "Dates", schedule: { kind: "yearly", month: 1, monthDay: 1 }, reminders: Object.assign(at("09:00"), { lead: [7, 1] }), notes: "Set the date, and whose birthday it is in the name." },
  { name: "Wedding anniversary", emoji: "💍", category: "Dates", schedule: { kind: "yearly", month: 1, monthDay: 1 }, reminders: Object.assign(at("09:00"), { lead: [7, 1] }) },
  { name: "Mother's Day", emoji: "💐", category: "Dates", schedule: { kind: "yearly", occasion: "mothers-day" }, reminders: Object.assign(at("09:00"), { lead: [7, 1] }) }
];

// Shown first in onboarding: the most needed habits mixed with the ones only this app does well.
// The rest appear under "Show more". Each pitch is the one-line reason it's special here.
// The setup's "What do you want to improve?" question: each goal brings its habits to the top.
export const GOALS = [
  { id: "health", emoji: "💪", label: "Feel healthier & stronger", habits: ["Exercise", "Walk", "Drink water", "Stretch", "Healthy breakfast", "Gym"] },
  { id: "sleep", emoji: "😴", label: "Sleep better", habits: ["No phone in bed", "Read 10 minutes", "Stretch"] },
  { id: "focus", emoji: "🎯", label: "Get more done", habits: ["Plan tomorrow", "Deep work block", "Learn something", "Tidy up"] },
  { id: "calm", emoji: "🧘", label: "Less stress, more calm", habits: ["Journal", "Walk", "No phone in bed", "Stretch"] },
  { id: "care", emoji: "💊", label: "Stay on top of my health care", habits: ["Take medicine", "Take vitamins", "Refill prescription", "Floss & brush"] },
  { id: "family", emoji: "👨‍👩‍👧", label: "Be there for family", habits: ["Call Mom", "Family time", "Visit family", "Call family"] },
  { id: "money", emoji: "💰", label: "Money under control", habits: ["Check budget", "Save money", "Meal prep"] },
  { id: "self", emoji: "✨", label: "Look after myself", habits: ["Skincare", "Haircut", "Beard trim", "Nails"] },
  { id: "home", emoji: "🏡", label: "A calm, tidy home", habits: ["Tidy up", "Laundry", "Water the plants", "Check the home before bed"] }
];

export const FEATURED = [
  ["Drink water", "Reminders every 2 hours while you're awake"],
  ["Haircut", "Every 3 weeks on Friday — not just daily habits"],
  ["Walk", "Steps fill in by themselves from your phone"],
  ["Exercise", "3 times a week, any days — done when your workout syncs"],
  ["Take medicine", "Each dose timed to your wake-up and bedtime, with a nudge if you forget"],
  ["Read 10 minutes", "Before bed, whenever your bedtime is"],
  ["Plan tomorrow", "Only on work days, before your shift ends"],
  ["Call Mom", "Every day after work — even 5 minutes counts"]
];
