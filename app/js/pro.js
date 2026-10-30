// Free vs Pro. Every feature that may become paid is listed here, so moving one between tiers is a
// one-word change. Until in-app purchases exist (CONFIG.showPremium), everything is free: the
// stores reject apps that show features you can't actually buy.
// Limits only stop new additions: rest days already taken, breaks already running and lists
// already shared stay as they are.

import { state } from "./store.js";
import { CONFIG } from "./config.js";

export const FEATURES = {
  extraSounds: "pro",       // extra Adhan reciters and bell sets (one Adhan, one bell and a chime stay free)
  perPrayerSound: "pro",    // a different sound for each prayer
  extraRestDays: "pro",     // 4 rest days a month instead of 1 ("streak insurance")
  pauses: "pro",            // sick / travel breaks, and "I was away — keep my streaks"
  streakRepair: "pro",      // once a month, mend a streak that broke in the last week
  moreLists: "pro",         // more than one shared list of your own (joining other people's is always free)
  biggerLists: "pro",       // more than FREE.members people on a list you invite to
  moreCars: "pro",          // a second car and more (one car's maintenance stays free)
  familyDocs: "pro",        // document expiry dates for family members (your own stay free)
  billsHistory: "pro",      // earlier months of bills, and sending a month's bills to the family
  qibla: "free",            // expected free in this market
  forgivingStreaks: "free"  // never miss twice — keeps people going after a bad day, keep free
};
export const FREE = { restDays: 1, lists: 1, members: 4, cars: 1 };
export const PRO = { restDays: 4, repairs: 1 };

export const isPro = () => !!(state && state.pro && state.pro.active);
export function canUse(feature) {
  if (!CONFIG.showPremium) return true;
  return FEATURES[feature] !== "pro" || isPro();
}
// Would a "Pro" tag mean anything to this person right now?
export const showProTag = feature => !!CONFIG.showPremium && !canUse(feature);

// Streak repairs left this calendar month (state.repairs holds the day each one was used).
export function repairsLeft() {
  if (!canUse("streakRepair")) return 0;
  const n = new Date(), ym = n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0");
  return Math.max(0, PRO.repairs - (state.repairs || []).filter(k => k.slice(0, 7) === ym).length);
}
export const restPerMonth = () => canUse("extraRestDays") ? PRO.restDays : FREE.restDays;
const ownLists = () => (state.lists || []).filter(l => l.mine !== false).length;
export const canCreateList = () => canUse("moreLists") || ownLists() < FREE.lists;
export const canInvite = l => canUse("biggerLists") || (l.members || []).length < FREE.members;
